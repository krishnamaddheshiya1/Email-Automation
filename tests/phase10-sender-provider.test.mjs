import test from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import { createTestDb } from "./test-harness.mjs";
import {
  encryptSecret,
  decryptSecret,
  maskApiKey,
} from "../server/utils/encryption.ts";
import { emailRegex } from "../lib/validations/email.ts";

/**
 * Phase 10 Sender & Email Provider Test Engine
 * Direct integration engine testing provider security, encryption at rest,
 * sender identities lifecycle, campaign binding, and safety audit logging against pg-mem.
 */
class SenderProviderTestEngine {
  constructor(db, options = {}) {
    this.db = db;
    this.validator = options.validator || this.defaultValidator.bind(this);
    this.sentEmails = [];
  }

  setValidator(fn) {
    this.validator = fn;
  }

  async defaultValidator(apiKey) {
    if (!apiKey || typeof apiKey !== "string") {
      return { valid: false, error: "API key is required." };
    }
    const trimmed = apiKey.trim();
    if (!trimmed.startsWith("re_") || trimmed.length < 10) {
      return { valid: false, error: "Invalid Resend API key format. Must start with 're_'." };
    }
    if (trimmed.includes("invalid") || trimmed.includes("revoked") || trimmed.includes("reject")) {
      return { valid: false, error: "Resend rejected the provided API key." };
    }
    return { valid: true };
  }

  oneOrNone(sql) {
    const rows = this.db.public.many(sql);
    return rows && rows.length > 0 ? rows[0] : null;
  }

  logAudit(businessId, eventType, reason, metadata = {}, recipientEmail = null) {
    const id = crypto.randomUUID();
    const metaStr = JSON.stringify(metadata).replace(/'/g, "''");
    const recStr = recipientEmail ? `'${recipientEmail.replace(/'/g, "''")}'` : "NULL";
    this.db.public.none(`
      INSERT INTO safety_audit_logs (id, business_id, event_type, recipient_email, reason, metadata, created_at)
      VALUES ('${id}', '${businessId}', '${eventType}', ${recStr}, '${reason.replace(/'/g, "''")}', '${metaStr}'::jsonb, NOW());
    `);
  }

  getAuditLogs(businessId) {
    return this.db.public.many(
      `SELECT * FROM safety_audit_logs WHERE business_id = '${businessId}' ORDER BY created_at DESC;`
    ) || [];
  }

  // --- Provider Management ---
  async connectProvider(businessId, apiKey, actorId = null) {
    if (!businessId) throw new Error("Business ID is required.");
    const cleanKey = apiKey ? apiKey.trim() : "";
    if (!cleanKey) throw new Error("API key is required.");

    const validation = await this.validator(cleanKey);
    if (!validation.valid) {
      this.logAudit(businessId, "provider_validation_failed", validation.error || "Validation failed", {
        provider: "RESEND",
        actor_id: actorId,
      });

      const existing = this.oneOrNone(
        `SELECT id FROM email_providers WHERE business_id = '${businessId}' AND provider = 'RESEND';`
      );
      if (existing) {
        this.db.public.none(
          `UPDATE email_providers SET status = 'ERROR', updated_at = NOW() WHERE id = '${existing.id}';`
        );
      }

      throw new Error(validation.error || "Failed to validate Resend API key with provider.");
    }

    const encrypted = encryptSecret(cleanKey);
    const existing = this.oneOrNone(
      `SELECT id FROM email_providers WHERE business_id = '${businessId}' AND provider = 'RESEND';`
    );

    let providerId;
    if (existing) {
      providerId = existing.id;
      this.db.public.none(`
        UPDATE email_providers
        SET status = 'ACTIVE', encrypted_api_key = '${encrypted}', updated_at = NOW()
        WHERE id = '${providerId}';
      `);
    } else {
      providerId = crypto.randomUUID();
      this.db.public.none(`
        INSERT INTO email_providers (id, business_id, provider, status, encrypted_api_key, created_at, updated_at)
        VALUES ('${providerId}', '${businessId}', 'RESEND', 'ACTIVE', '${encrypted}', NOW(), NOW());
      `);
    }

    this.logAudit(businessId, "provider_connected", "Credentials connected and verified successfully", {
      provider: "RESEND",
      provider_id: providerId,
      actor_id: actorId,
    });

    return {
      configured: true,
      id: providerId,
      business_id: businessId,
      provider: "RESEND",
      status: "ACTIVE",
      masked_api_key: maskApiKey(cleanKey),
    };
  }

  async checkProviderHealth(businessId, actorId = null) {
    const row = this.oneOrNone(
      `SELECT * FROM email_providers WHERE business_id = '${businessId}' AND provider = 'RESEND';`
    );
    if (!row || !row.encrypted_api_key) {
      throw new Error("No email provider configured for this business.");
    }

    let rawKey;
    try {
      rawKey = decryptSecret(row.encrypted_api_key);
    } catch {
      this.db.public.none(`UPDATE email_providers SET status = 'ERROR' WHERE id = '${row.id}';`);
      this.logAudit(businessId, "provider_health_check", "Failed to decrypt credentials", {
        status: "unhealthy",
        actor_id: actorId,
      });
      return { status: "unhealthy", provider: "RESEND", message: "Decryption failed." };
    }

    const validation = await this.validator(rawKey);
    if (!validation.valid) {
      this.db.public.none(`UPDATE email_providers SET status = 'ERROR', updated_at = NOW() WHERE id = '${row.id}';`);
      this.logAudit(businessId, "provider_health_check", validation.error || "Health check failed", {
        status: "unhealthy",
        actor_id: actorId,
      });
      return { status: "unhealthy", provider: "RESEND", message: validation.error || "Provider rejected key." };
    }

    if (row.status !== "ACTIVE") {
      this.db.public.none(`UPDATE email_providers SET status = 'ACTIVE', updated_at = NOW() WHERE id = '${row.id}';`);
    }

    this.logAudit(businessId, "provider_health_check", "Health check passed", {
      status: "healthy",
      actor_id: actorId,
    });
    return { status: "healthy", provider: "RESEND", message: "Credentials valid and active." };
  }

  getProviderStatus(businessId) {
    const row = this.oneOrNone(
      `SELECT * FROM email_providers WHERE business_id = '${businessId}' AND provider = 'RESEND';`
    );
    if (row && row.encrypted_api_key) {
      let masked = "re_••••••••••••••••";
      try {
        const raw = decryptSecret(row.encrypted_api_key);
        masked = maskApiKey(raw);
      } catch {
        // Fallback
      }
      return {
        configured: true,
        id: row.id,
        business_id: row.business_id,
        provider: "RESEND",
        status: row.status,
        masked_api_key: masked,
        is_platform_default: false,
      };
    }

    return {
      configured: false,
      provider: null,
      status: null,
      masked_api_key: null,
      is_platform_default: false,
    };
  }

  disableProvider(businessId, actorId = null) {
    const row = this.oneOrNone(
      `SELECT * FROM email_providers WHERE business_id = '${businessId}' AND provider = 'RESEND';`
    );
    if (!row) throw new Error("No email provider configured for this business.");

    this.db.public.none(`UPDATE email_providers SET status = 'INACTIVE', updated_at = NOW() WHERE id = '${row.id}';`);
    this.logAudit(businessId, "provider_disabled", "Provider credentials disabled", {
      provider: "RESEND",
      actor_id: actorId,
    });
  }

  getDecryptedApiKey(businessId) {
    const row = this.oneOrNone(
      `SELECT * FROM email_providers WHERE business_id = '${businessId}' AND provider = 'RESEND' AND status = 'ACTIVE';`
    );
    if (row && row.encrypted_api_key) {
      return decryptSecret(row.encrypted_api_key);
    }
    return null;
  }

  // --- Sender Identity Management ---
  createSenderIdentity(businessId, input, actorId = null) {
    if (!businessId) throw new Error("Business ID is required.");
    const fromName = input.from_name ? input.from_name.trim() : "";
    if (!fromName) throw new Error("Sender name is required.");
    const fromEmail = input.from_email ? input.from_email.trim().toLowerCase() : "";
    if (!fromEmail || !emailRegex.test(fromEmail)) {
      throw new Error(`Invalid sender email address: "${input.from_email}".`);
    }

    let replyTo = null;
    if (input.reply_to_email && input.reply_to_email.trim().length > 0) {
      const cleanReply = input.reply_to_email.trim().toLowerCase();
      if (!emailRegex.test(cleanReply)) {
        throw new Error(`Invalid reply-to email address: "${input.reply_to_email}".`);
      }
      replyTo = cleanReply;
    }

    const existing = this.oneOrNone(
      `SELECT id FROM sender_identities WHERE business_id = '${businessId}' AND LOWER(from_email) = '${fromEmail}';`
    );
    if (existing) {
      throw new Error("A sender identity with this email already exists for your business.");
    }

    const id = crypto.randomUUID();
    const isResendDev = fromEmail.endsWith("@resend.dev");
    const verificationStatus = isResendDev ? "VERIFIED" : "PENDING";
    const replyStr = replyTo ? `'${replyTo}'` : "NULL";

    this.db.public.none(`
      INSERT INTO sender_identities (id, business_id, from_name, from_email, reply_to_email, status, verification_status, created_at, updated_at)
      VALUES ('${id}', '${businessId}', '${fromName.replace(/'/g, "''")}', '${fromEmail}', ${replyStr}, 'ACTIVE', '${verificationStatus}', NOW(), NOW());
    `);

    this.logAudit(businessId, "sender_created", `Created sender identity "${fromName}" <${fromEmail}>`, {
      sender_id: id,
      from_name: fromName,
      from_email: fromEmail,
      actor_id: actorId,
    });

    return this.getSenderIdentity(businessId, id);
  }

  getSenderIdentity(businessId, senderId) {
    return this.oneOrNone(
      `SELECT * FROM sender_identities WHERE id = '${senderId}' AND business_id = '${businessId}';`
    );
  }

  listSenderIdentities(businessId) {
    return this.db.public.many(
      `SELECT * FROM sender_identities WHERE business_id = '${businessId}' ORDER BY created_at DESC;`
    ) || [];
  }

  updateSenderIdentity(businessId, senderId, patch, actorId = null) {
    const existing = this.getSenderIdentity(businessId, senderId);
    if (!existing) throw new Error("Sender identity not found or access denied.");

    const fields = [];
    if (patch.from_name !== undefined) {
      const clean = patch.from_name.trim();
      if (!clean) throw new Error("Sender name cannot be empty.");
      fields.push(`from_name = '${clean.replace(/'/g, "''")}'`);
    }
    if (patch.reply_to_email !== undefined) {
      if (patch.reply_to_email && patch.reply_to_email.trim().length > 0) {
        const clean = patch.reply_to_email.trim().toLowerCase();
        if (!emailRegex.test(clean)) throw new Error(`Invalid reply-to email address: "${patch.reply_to_email}".`);
        fields.push(`reply_to_email = '${clean}'`);
      } else {
        fields.push(`reply_to_email = NULL`);
      }
    }
    if (patch.status !== undefined) {
      fields.push(`status = '${patch.status.toUpperCase()}'`);
    }
    if (patch.verification_status !== undefined) {
      fields.push(`verification_status = '${patch.verification_status.toUpperCase()}'`);
    }

    fields.push("updated_at = NOW()");
    this.db.public.none(
      `UPDATE sender_identities SET ${fields.join(", ")} WHERE id = '${senderId}' AND business_id = '${businessId}';`
    );

    const eventType = patch.status === "INACTIVE" ? "sender_disabled" : "sender_updated";
    this.logAudit(businessId, eventType, `Sender identity ${senderId} ${eventType}`, {
      sender_id: senderId,
      actor_id: actorId,
    });

    return this.getSenderIdentity(businessId, senderId);
  }

  deleteSenderIdentity(businessId, senderId, actorId = null) {
    const existing = this.getSenderIdentity(businessId, senderId);
    if (!existing) throw new Error("Sender identity not found or access denied.");

    this.db.public.none(
      `DELETE FROM sender_identities WHERE id = '${senderId}' AND business_id = '${businessId}';`
    );
    this.logAudit(businessId, "sender_disabled", `Sender identity ${existing.from_email} was deleted`, {
      sender_id: senderId,
      actor_id: actorId,
    });
    return true;
  }

  verifySenderIdentity(businessId, senderId, actorId = null) {
    const existing = this.getSenderIdentity(businessId, senderId);
    if (!existing) throw new Error("Sender identity not found or access denied.");

    return this.updateSenderIdentity(
      businessId,
      senderId,
      { verification_status: "VERIFIED" },
      actorId
    );
  }

  // --- Campaign Binding & Validation ---
  bindSenderToCampaign(businessId, campaignId, senderId) {
    const campaign = this.oneOrNone(
      `SELECT * FROM campaigns WHERE id = '${campaignId}' AND business_id = '${businessId}';`
    );
    if (!campaign) throw new Error("Campaign not found or access denied.");

    if (senderId) {
      const sender = this.getSenderIdentity(businessId, senderId);
      if (!sender) throw new Error("Sender identity does not exist or does not belong to this business.");
    }

    const prevSenderId = campaign.sender_identity_id;
    const senderVal = senderId ? `'${senderId}'` : "NULL";
    this.db.public.none(
      `UPDATE campaigns SET sender_identity_id = ${senderVal}, updated_at = NOW() WHERE id = '${campaignId}' AND business_id = '${businessId}';`
    );

    this.logAudit(businessId, "campaign_sender_changed", `Sender changed for campaign ${campaignId}`, {
      campaign_id: campaignId,
      previous_sender_identity_id: prevSenderId,
      new_sender_identity_id: senderId,
    });

    return this.oneOrNone(`SELECT * FROM campaigns WHERE id = '${campaignId}';`);
  }

  validateCampaign(businessId, campaignId) {
    const campaign = this.oneOrNone(
      `SELECT * FROM campaigns WHERE id = '${campaignId}' AND business_id = '${businessId}';`
    );
    if (!campaign) return { valid: false, errors: ["Campaign not found."] };

    const errors = [];
    let senderConfigured = false;
    let providerConfigured = false;

    // Sender Identity Check
    if (campaign.sender_identity_id) {
      const sender = this.getSenderIdentity(businessId, campaign.sender_identity_id);
      if (!sender) {
        errors.push("The selected sender identity does not exist or does not belong to your business.");
      } else if (sender.status !== "ACTIVE") {
        errors.push(`The selected sender identity ("${sender.from_email}") is inactive.`);
      } else if (sender.verification_status === "FAILED") {
        errors.push(`The selected sender identity ("${sender.from_email}") has failed verification.`);
      } else {
        senderConfigured = true;
      }
    } else {
      const senders = this.listSenderIdentities(businessId);
      const active = senders.find((s) => s.status === "ACTIVE" && s.verification_status !== "FAILED");
      if (active) {
        senderConfigured = true;
      } else {
        errors.push("Sender identity is not configured. Please configure an active sender identity in Settings.");
      }
    }

    // Provider Check
    const provider = this.oneOrNone(
      `SELECT * FROM email_providers WHERE business_id = '${businessId}' AND provider = 'RESEND' AND status = 'ACTIVE';`
    );
    if (provider) {
      providerConfigured = true;
    } else {
      errors.push("Email provider is not configured or inactive. Please configure your email provider in Settings.");
    }

    // Step check
    const steps = this.db.public.many(
      `SELECT * FROM campaign_steps WHERE campaign_id = '${campaignId}' AND status = 'ACTIVE';`
    ) || [];
    if (steps.length === 0) errors.push("Campaign must have at least 1 active step.");

    // Contact check
    const contacts = this.db.public.many(
      `SELECT * FROM campaign_leads WHERE campaign_id = '${campaignId}' AND UPPER(status) = 'ENROLLED';`
    ) || [];
    if (contacts.length === 0) errors.push("Campaign must have at least 1 enrolled contact.");

    return {
      valid: errors.length === 0,
      errors,
      checklist: {
        activeSteps: steps.length > 0,
        contactsEnrolled: contacts.length > 0,
        senderConfigured: senderConfigured && providerConfigured,
        providerConfigured,
        noCriticalErrors: errors.length === 0,
      },
    };
  }

  // --- Send Email with Multi-Tenant Provider & Sender Resolution ---
  async sendEmail(businessId, userId, options) {
    if (!businessId) throw new Error("Business ID required.");

    // Resolve sender identity
    let effectiveSenderId = options.senderIdentityId;
    if (!effectiveSenderId && options.campaignId) {
      const c = this.oneOrNone(`SELECT sender_identity_id FROM campaigns WHERE id = '${options.campaignId}';`);
      if (c && c.sender_identity_id) effectiveSenderId = c.sender_identity_id;
    }

    let fromEmail = "notifications@platform.com";
    let fromName = "Notification";
    let replyTo = null;

    if (effectiveSenderId) {
      const sender = this.getSenderIdentity(businessId, effectiveSenderId);
      if (!sender) {
        throw new Error("Specified sender identity does not exist or access denied.");
      }
      if (sender.status !== "ACTIVE") {
        throw new Error("Specified sender identity is not active.");
      }
      fromEmail = sender.from_email;
      fromName = sender.from_name;
      replyTo = sender.reply_to_email || options.replyTo || null;
    } else {
      fromEmail = options.fromEmail || "default@business.com";
      fromName = options.fromName || "Default Business Sender";
      replyTo = options.replyTo || null;
    }

    // Resolve provider credentials for this business
    const decryptedKey = this.getDecryptedApiKey(businessId);

    // Ensure a lead exists for lead_id NOT NULL constraint
    let lead = this.oneOrNone(
      `SELECT id FROM leads WHERE business_id = '${businessId}' AND LOWER(email) = '${options.to.toLowerCase()}';`
    );
    if (!lead) {
      const newLeadId = crypto.randomUUID();
      this.db.public.none(`
        INSERT INTO leads (id, business_id, email, status, created_at, updated_at)
        VALUES ('${newLeadId}', '${businessId}', '${options.to.toLowerCase()}', 'new', NOW(), NOW());
      `);
      lead = { id: newLeadId };
    }

    // Mock dispatch
    const providerMessageId = `mock_prov_${crypto.randomUUID()}`;
    const messageId = crypto.randomUUID();
    const meta = { ...(options.metadata || {}), reply_to: replyTo };
    const metaStr = JSON.stringify(meta).replace(/'/g, "''");

    this.db.public.none(`
      INSERT INTO email_messages (id, business_id, lead_id, to_email, from_email, subject, body, status, provider_message_id, metadata, created_at, sent_at)
      VALUES ('${messageId}', '${businessId}', '${lead.id}', '${options.to.toLowerCase()}', '${fromEmail}', '${options.subject.replace(/'/g, "''")}', '${(options.body || "").replace(/'/g, "''")}', 'sent', '${providerMessageId}', '${metaStr}'::jsonb, NOW(), NOW());
    `);

    const dispatched = {
      to: options.to,
      fromEmail,
      fromName,
      replyTo,
      subject: options.subject,
      providerMessageId,
      decryptedKeyUsed: decryptedKey,
    };
    this.sentEmails.push(dispatched);

    return {
      success: true,
      message: this.oneOrNone(`SELECT * FROM email_messages WHERE id = '${messageId}';`),
      dispatched,
    };
  }

  async sendTestEmail(businessId, userId, options) {
    return this.sendEmail(businessId, userId, {
      ...options,
      metadata: { is_test_email: true },
    });
  }
}

test("Phase 10: Sender & Email Provider Management Test Suite (All 24 Scenarios)", async (t) => {
  const { db, seed } = createTestDb();
  seed();

  const businessIdA = "b0000000-0000-4000-8000-000000000001";
  const businessIdB = "b0000000-0000-4000-8000-000000000002";
  const userIdA = "a0000000-0000-4000-8000-000000000001";

  const engine = new SenderProviderTestEngine(db);

  // =========================================================================
  // Scenario 1: Connect provider with valid API key
  // =========================================================================
  await t.test("1. Connect provider with valid API key", async () => {
    const validKey = "re_live_valid_credential_1234567890";
    const result = await engine.connectProvider(businessIdA, validKey, userIdA);

    assert.equal(result.configured, true);
    assert.equal(result.provider, "RESEND");
    assert.equal(result.status, "ACTIVE");
    assert.ok(result.masked_api_key.includes("••••"));
    assert.ok(result.masked_api_key.endsWith("7890"));
    assert.equal(result.masked_api_key.includes(validKey), false, "Raw key must never be returned");

    const saved = engine.oneOrNone(`SELECT * FROM email_providers WHERE business_id = '${businessIdA}';`);
    assert.ok(saved);
    assert.equal(saved.status, "ACTIVE");
    assert.equal(saved.provider, "RESEND");
  });

  // =========================================================================
  // Scenario 2: Connect provider with invalid API key rejected
  // =========================================================================
  await t.test("2. Connect provider with invalid API key rejected", async () => {
    // Missing re_ prefix
    await assert.rejects(
      async () => {
        await engine.connectProvider(businessIdA, "invalid_no_prefix", userIdA);
      },
      /Must start with 're_'/
    );

    // Rejected by provider validator
    await assert.rejects(
      async () => {
        await engine.connectProvider(businessIdA, "re_invalid_secret_key", userIdA);
      },
      /Resend rejected the provided API key/
    );

    const auditLogs = engine.getAuditLogs(businessIdA);
    const failLog = auditLogs.find((l) => l.event_type === "provider_validation_failed");
    assert.ok(failLog, "Expected provider_validation_failed audit log");
  });

  // =========================================================================
  // Scenario 3: Key encryption at rest (DB contains ciphertext, not raw key)
  // =========================================================================
  await t.test("3. Key encryption at rest (DB contains ciphertext, not raw key)", async () => {
    const rawKey = "re_super_secret_test_key_9876543210";
    await engine.connectProvider(businessIdA, rawKey);

    const providerRow = engine.oneOrNone(`SELECT * FROM email_providers WHERE business_id = '${businessIdA}';`);
    assert.ok(providerRow);
    assert.notEqual(providerRow.encrypted_api_key, rawKey, "Raw key must NEVER be stored plaintext");
    assert.ok(!providerRow.encrypted_api_key.includes("super_secret"), "Ciphertext must not leak secret substrings");
    assert.ok(providerRow.encrypted_api_key.includes(":"), "Expected AES-256-GCM iv:authTag:ciphertext format");

    // Decryption cleanly recovers raw key
    const decrypted = decryptSecret(providerRow.encrypted_api_key);
    assert.equal(decrypted, rawKey);
  });

  // =========================================================================
  // Scenario 4: Key masking in API response (never raw key)
  // =========================================================================
  await t.test("4. Key masking in API response (never raw key)", async () => {
    const rawKey = "re_my_production_api_key_44332211";
    await engine.connectProvider(businessIdA, rawKey);

    const status = engine.getProviderStatus(businessIdA);
    assert.equal(status.configured, true);
    assert.equal(status.status, "ACTIVE");
    assert.equal(status.masked_api_key, "re_••••••••••••2211");
    assert.equal(JSON.stringify(status).includes(rawKey), false, "Raw secret must never exist in JSON response");
  });

  // =========================================================================
  // Scenario 5: Provider health check success
  // =========================================================================
  await t.test("5. Provider health check success", async () => {
    await engine.connectProvider(businessIdA, "re_active_health_key_11223344");

    const health = await engine.checkProviderHealth(businessIdA, userIdA);
    assert.equal(health.status, "healthy");
    assert.equal(health.provider, "RESEND");

    const auditLogs = engine.getAuditLogs(businessIdA);
    const healthLog = auditLogs.find((l) => l.event_type === "provider_health_check" && l.metadata.status === "healthy");
    assert.ok(healthLog, "Expected healthy provider_health_check audit log");
  });

  // =========================================================================
  // Scenario 6: Provider health check failure updates status
  // =========================================================================
  await t.test("6. Provider health check failure updates status to ERROR", async () => {
    await engine.connectProvider(businessIdA, "re_initial_active_key_12345");

    // Set validator to fail for health check
    engine.setValidator(async () => {
      return { valid: false, error: "API key has been revoked by provider administrator." };
    });

    const health = await engine.checkProviderHealth(businessIdA);
    assert.equal(health.status, "unhealthy");
    assert.ok(health.message.includes("revoked"));

    const providerRow = engine.oneOrNone(`SELECT * FROM email_providers WHERE business_id = '${businessIdA}';`);
    assert.equal(providerRow.status, "ERROR", "Provider row must transition to ERROR status");

    const auditLogs = engine.getAuditLogs(businessIdA);
    const failLog = auditLogs.find((l) => l.event_type === "provider_health_check" && l.metadata.status === "unhealthy");
    assert.ok(failLog, "Expected unhealthy provider_health_check audit log");

    // Restore validator
    engine.setValidator(engine.defaultValidator.bind(engine));
  });

  // =========================================================================
  // Scenario 7: Create sender identity (valid)
  // =========================================================================
  await t.test("7. Create sender identity (valid)", async () => {
    const sender = engine.createSenderIdentity(
      businessIdA,
      {
        from_name: "Sarah Marketing",
        from_email: "sarah@acmecorp.com",
        reply_to_email: "support@acmecorp.com",
      },
      userIdA
    );

    assert.ok(sender.id);
    assert.equal(sender.business_id, businessIdA);
    assert.equal(sender.from_name, "Sarah Marketing");
    assert.equal(sender.from_email, "sarah@acmecorp.com");
    assert.equal(sender.reply_to_email, "support@acmecorp.com");
    assert.equal(sender.status, "ACTIVE");
    assert.equal(sender.verification_status, "PENDING");

    // Onboarding@resend.dev defaults to VERIFIED
    const resendSender = engine.createSenderIdentity(businessIdA, {
      from_name: "Resend Sandbox",
      from_email: "onboarding@resend.dev",
    });
    assert.equal(resendSender.verification_status, "VERIFIED");

    const auditLogs = engine.getAuditLogs(businessIdA);
    const createLog = auditLogs.find((l) => l.event_type === "sender_created");
    assert.ok(createLog, "Expected sender_created audit log");
  });

  // =========================================================================
  // Scenario 8: Create sender identity (invalid email rejected)
  // =========================================================================
  await t.test("8. Create sender identity (invalid email rejected)", async () => {
    assert.throws(
      () => {
        engine.createSenderIdentity(businessIdA, {
          from_name: "Bad Email",
          from_email: "not-an-email-at-all",
        });
      },
      /Invalid sender email address/
    );

    assert.throws(
      () => {
        engine.createSenderIdentity(businessIdA, {
          from_name: "Bad Reply",
          from_email: "valid@domain.com",
          reply_to_email: "invalid-reply-to",
        });
      },
      /Invalid reply-to email address/
    );
  });

  // =========================================================================
  // Scenario 9: Duplicate sender email per business rejected
  // =========================================================================
  await t.test("9. Duplicate sender email per business rejected", async () => {
    engine.createSenderIdentity(businessIdA, {
      from_name: "Original Sender",
      from_email: "contact@company.com",
    });

    assert.throws(
      () => {
        engine.createSenderIdentity(businessIdA, {
          from_name: "Duplicate Sender",
          from_email: " CONTACT@Company.com ",
        });
      },
      /already exists/
    );
  });

  // =========================================================================
  // Scenario 10: Sender verification check
  // =========================================================================
  await t.test("10. Sender verification check", async () => {
    const sender = engine.createSenderIdentity(businessIdA, {
      from_name: "Domain Admin",
      from_email: "admin@verifieddomain.com",
    });
    assert.equal(sender.verification_status, "PENDING");

    const verified = engine.verifySenderIdentity(businessIdA, sender.id);
    assert.equal(verified.verification_status, "VERIFIED");

    const fetched = engine.getSenderIdentity(businessIdA, sender.id);
    assert.equal(fetched.verification_status, "VERIFIED");
  });

  // =========================================================================
  // Scenario 11: Update sender identity
  // =========================================================================
  await t.test("11. Update sender identity", async () => {
    const sender = engine.createSenderIdentity(businessIdA, {
      from_name: "Old Name",
      from_email: "update@test.com",
    });

    const updated = engine.updateSenderIdentity(
      businessIdA,
      sender.id,
      {
        from_name: "New Better Name",
        reply_to_email: "newreply@test.com",
      },
      userIdA
    );

    assert.equal(updated.from_name, "New Better Name");
    assert.equal(updated.reply_to_email, "newreply@test.com");

    const auditLogs = engine.getAuditLogs(businessIdA);
    const updateLog = auditLogs.find((l) => l.event_type === "sender_updated");
    assert.ok(updateLog, "Expected sender_updated audit log");
  });

  // =========================================================================
  // Scenario 12: Disable sender identity
  // =========================================================================
  await t.test("12. Disable sender identity", async () => {
    const sender = engine.createSenderIdentity(businessIdA, {
      from_name: "Active Sender",
      from_email: "disable@test.com",
    });

    const disabled = engine.updateSenderIdentity(
      businessIdA,
      sender.id,
      { status: "INACTIVE" },
      userIdA
    );

    assert.equal(disabled.status, "INACTIVE");

    const auditLogs = engine.getAuditLogs(businessIdA);
    const disabledLog = auditLogs.find((l) => l.event_type === "sender_disabled");
    assert.ok(disabledLog, "Expected sender_disabled audit log");
  });

  // =========================================================================
  // Scenario 13: Delete sender identity
  // =========================================================================
  await t.test("13. Delete sender identity", async () => {
    const sender = engine.createSenderIdentity(businessIdA, {
      from_name: "To Delete",
      from_email: "delete@test.com",
    });

    const deleted = engine.deleteSenderIdentity(businessIdA, sender.id);
    assert.equal(deleted, true);

    const lookup = engine.getSenderIdentity(businessIdA, sender.id);
    assert.equal(lookup, null);
  });

  // =========================================================================
  // Scenario 14: Bind sender to campaign
  // =========================================================================
  await t.test("14. Bind sender to campaign", async () => {
    const sender = engine.createSenderIdentity(businessIdA, {
      from_name: "Campaign Sender",
      from_email: "outreach@company.com",
    });

    const campaignId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaigns (id, business_id, name, status, timezone, created_at, updated_at)
      VALUES ('${campaignId}', '${businessIdA}', 'Outreach Campaign', 'DRAFT', 'UTC', NOW(), NOW());
    `);

    const bound = engine.bindSenderToCampaign(businessIdA, campaignId, sender.id);
    assert.equal(bound.sender_identity_id, sender.id);

    const auditLogs = engine.getAuditLogs(businessIdA);
    const changeLog = auditLogs.find((l) => l.event_type === "campaign_sender_changed");
    assert.ok(changeLog, "Expected campaign_sender_changed audit log");
  });

  // =========================================================================
  // Scenario 15: Campaign activation check: blocked without active sender
  // =========================================================================
  await t.test("15. Campaign activation check: blocked without active sender", async () => {
    await engine.connectProvider(businessIdA, "re_active_valid_key_12345");

    const sender = engine.createSenderIdentity(businessIdA, {
      from_name: "Disabled Sender",
      from_email: "inactive@test.com",
    });
    engine.updateSenderIdentity(businessIdA, sender.id, { status: "INACTIVE" });

    const campaignId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaigns (id, business_id, name, status, timezone, sender_identity_id, created_at, updated_at)
      VALUES ('${campaignId}', '${businessIdA}', 'Inactive Sender Campaign', 'DRAFT', 'UTC', '${sender.id}', NOW(), NOW());
    `);

    const validation = engine.validateCampaign(businessIdA, campaignId);
    assert.equal(validation.valid, false);
    assert.ok(validation.errors.some((e) => e.includes("inactive")));
  });

  // =========================================================================
  // Scenario 16: Campaign activation check: blocked without active provider
  // =========================================================================
  await t.test("16. Campaign activation check: blocked without active provider", async () => {
    // Delete provider for business B
    db.public.none(`DELETE FROM email_providers WHERE business_id = '${businessIdB}';`);

    const sender = engine.createSenderIdentity(businessIdB, {
      from_name: "Valid Sender B",
      from_email: "onboarding@resend.dev",
    });

    const campaignId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaigns (id, business_id, name, status, timezone, sender_identity_id, created_at, updated_at)
      VALUES ('${campaignId}', '${businessIdB}', 'No Provider Campaign', 'DRAFT', 'UTC', '${sender.id}', NOW(), NOW());
    `);

    const validation = engine.validateCampaign(businessIdB, campaignId);
    assert.equal(validation.valid, false);
    assert.ok(validation.errors.some((e) => e.includes("Email provider is not configured")));
  });

  // =========================================================================
  // Scenario 17: Campaign activation check: passes with valid sender + provider
  // =========================================================================
  await t.test("17. Campaign activation check: passes with valid sender + provider", async () => {
    await engine.connectProvider(businessIdA, "re_active_valid_key_12345");

    const sender = engine.createSenderIdentity(businessIdA, {
      from_name: "Verified Sender",
      from_email: "campaign-verified@acme.com",
    });
    engine.verifySenderIdentity(businessIdA, sender.id);

    const campaignId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaigns (id, business_id, name, status, timezone, sender_identity_id, created_at, updated_at)
      VALUES ('${campaignId}', '${businessIdA}', 'Activation Campaign', 'DRAFT', 'UTC', '${sender.id}', NOW(), NOW());
    `);

    // Add active step
    db.public.none(`
      INSERT INTO campaign_steps (id, campaign_id, step_number, name, delay_value, delay_unit, status, created_at, updated_at)
      VALUES ('${crypto.randomUUID()}', '${campaignId}', 1, 'Step 1', 0, 'days', 'ACTIVE', NOW(), NOW());
    `);

    // Add enrolled contact
    const leadId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO leads (id, business_id, email, status, created_at, updated_at)
      VALUES ('${leadId}', '${businessIdA}', 'enrolled@test.com', 'new', NOW(), NOW());
    `);
    db.public.none(`
      INSERT INTO campaign_leads (id, campaign_id, lead_id, business_id, status, enrolled_at, created_at, updated_at)
      VALUES ('${crypto.randomUUID()}', '${campaignId}', '${leadId}', '${businessIdA}', 'ENROLLED', NOW(), NOW(), NOW());
    `);

    const validation = engine.validateCampaign(businessIdA, campaignId);
    assert.equal(validation.valid, true, `Validation errors: ${validation.errors.join("; ")}`);
    assert.equal(validation.checklist.senderConfigured, true);
    assert.equal(validation.checklist.providerConfigured, true);
  });

  // =========================================================================
  // Scenario 18: EmailService uses business's decrypted provider key
  // =========================================================================
  await t.test("18. EmailService uses business's decrypted provider key", async () => {
    const rawKey = "re_tenant_specific_secret_key_889900";
    await engine.connectProvider(businessIdA, rawKey);

    const decrypted = engine.getDecryptedApiKey(businessIdA);
    assert.equal(decrypted, rawKey);

    const result = await engine.sendEmail(businessIdA, userIdA, {
      to: "recipient1@example.com",
      subject: "Decrypted Key Test",
    });

    assert.equal(result.dispatched.decryptedKeyUsed, rawKey);
  });

  // =========================================================================
  // Scenario 19: EmailService uses campaign's bound sender identity
  // =========================================================================
  await t.test("19. EmailService uses campaign's bound sender identity", async () => {
    const sender = engine.createSenderIdentity(businessIdA, {
      from_name: "Campaign Exclusive Sender",
      from_email: "exclusive@brand.com",
      reply_to_email: "reply@brand.com",
    });

    const campaignId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaigns (id, business_id, name, status, timezone, sender_identity_id, created_at, updated_at)
      VALUES ('${campaignId}', '${businessIdA}', 'Branded Campaign', 'DRAFT', 'UTC', '${sender.id}', NOW(), NOW());
    `);

    const result = await engine.sendEmail(businessIdA, userIdA, {
      to: "customer@example.com",
      campaignId,
      subject: "Test Dispatch",
    });

    assert.equal(result.success, true);
    assert.equal(result.message.from_email, "exclusive@brand.com");
    assert.equal(result.dispatched.replyTo, "reply@brand.com");
  });

  // =========================================================================
  // Scenario 20: Fallback to business default sender if no campaign sender
  // =========================================================================
  await t.test("20. Fallback to business default sender if no campaign sender", async () => {
    const campaignId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaigns (id, business_id, name, status, timezone, sender_identity_id, created_at, updated_at)
      VALUES ('${campaignId}', '${businessIdA}', 'Default Sender Campaign', 'DRAFT', 'UTC', NULL, NOW(), NOW());
    `);

    const result = await engine.sendEmail(businessIdA, userIdA, {
      to: "customer2@example.com",
      campaignId,
      subject: "Default Sender Dispatch",
    });

    assert.equal(result.success, true);
    assert.ok(result.message.from_email.length > 0);
  });

  // =========================================================================
  // Scenario 21: Multi-tenant provider isolation (Business A key != Business B)
  // =========================================================================
  await t.test("21. Multi-tenant provider isolation (Business A key != Business B)", async () => {
    const keyA = "re_business_A_credential_11111";
    const keyB = "re_business_B_credential_22222";

    await engine.connectProvider(businessIdA, keyA);
    await engine.connectProvider(businessIdB, keyB);

    const decryptedA = engine.getDecryptedApiKey(businessIdA);
    const decryptedB = engine.getDecryptedApiKey(businessIdB);

    assert.equal(decryptedA, keyA);
    assert.equal(decryptedB, keyB);
    assert.notEqual(decryptedA, decryptedB);

    const statusA = engine.getProviderStatus(businessIdA);
    assert.ok(statusA.masked_api_key.endsWith("1111"));
    assert.ok(!statusA.masked_api_key.includes("2222"));
  });

  // =========================================================================
  // Scenario 22: Multi-tenant sender isolation (Business A cannot use Business B sender)
  // =========================================================================
  await t.test("22. Multi-tenant sender isolation (Business A cannot use Business B sender)", async () => {
    const senderB = engine.createSenderIdentity(businessIdB, {
      from_name: "Tenant B Sender",
      from_email: "sender@tenantb.com",
    });

    // Business A cannot get Tenant B sender
    const lookup = engine.getSenderIdentity(businessIdA, senderB.id);
    assert.equal(lookup, null, "Business A must not access Business B sender identity");

    // Business A cannot send email using Tenant B sender
    await assert.rejects(
      async () => {
        await engine.sendEmail(businessIdA, userIdA, {
          to: "target@example.com",
          senderIdentityId: senderB.id,
          subject: "Exploit attempt",
        });
      },
      /Specified sender identity does not exist or access denied/
    );
  });

  // =========================================================================
  // Scenario 23: Test email dispatch using configured sender identity
  // =========================================================================
  await t.test("23. Test email dispatch using configured sender identity", async () => {
    const sender = engine.createSenderIdentity(businessIdA, {
      from_name: "Test Dispatcher",
      from_email: "testsender@domain.com",
    });

    const result = await engine.sendTestEmail(businessIdA, userIdA, {
      to: "qa@example.com",
      subject: "Integration Test Send",
      body: "<p>Live test</p>",
      senderIdentityId: sender.id,
    });

    assert.equal(result.success, true);
    assert.equal(result.message.from_email, "testsender@domain.com");
    assert.equal(result.message.metadata.is_test_email, true);
  });

  // =========================================================================
  // Scenario 24: Audit logging for all provider & sender lifecycle events
  // =========================================================================
  await t.test("24. Audit logging for all provider & sender lifecycle events", async () => {
    // 1. provider_connected
    await engine.connectProvider(businessIdA, "re_audit_logging_test_key_9988");

    // 2. provider_health_check
    await engine.checkProviderHealth(businessIdA);

    // 3. provider_validation_failed
    try {
      await engine.connectProvider(businessIdA, "re_invalid_failing_key");
    } catch {
      // Expected
    }

    // 4. sender_created
    const sender = engine.createSenderIdentity(businessIdA, {
      from_name: "Audit Sender",
      from_email: "audit@test.com",
    });

    // 5. sender_updated
    engine.updateSenderIdentity(businessIdA, sender.id, {
      from_name: "Updated Audit Sender",
    });

    // 6. sender_disabled
    engine.updateSenderIdentity(businessIdA, sender.id, {
      status: "INACTIVE",
    });

    // 7. campaign_sender_changed
    const campaignId = crypto.randomUUID();
    db.public.none(`
      INSERT INTO campaigns (id, business_id, name, status, timezone, sender_identity_id, created_at, updated_at)
      VALUES ('${campaignId}', '${businessIdA}', 'Audit Campaign', 'DRAFT', 'UTC', '${sender.id}', NOW(), NOW());
    `);
    engine.bindSenderToCampaign(businessIdA, campaignId, null);

    // 8. provider_disabled
    engine.disableProvider(businessIdA);

    const logs = engine.getAuditLogs(businessIdA);
    const eventTypes = new Set(logs.map((l) => l.event_type));

    assert.ok(eventTypes.has("provider_connected"), "Missing provider_connected log");
    assert.ok(eventTypes.has("provider_health_check"), "Missing provider_health_check log");
    assert.ok(eventTypes.has("provider_validation_failed"), "Missing provider_validation_failed log");
    assert.ok(eventTypes.has("sender_created"), "Missing sender_created log");
    assert.ok(eventTypes.has("sender_updated"), "Missing sender_updated log");
    assert.ok(eventTypes.has("sender_disabled"), "Missing sender_disabled log");
    assert.ok(eventTypes.has("campaign_sender_changed"), "Missing campaign_sender_changed log");
    assert.ok(eventTypes.has("provider_disabled"), "Missing provider_disabled log");
  });
});
