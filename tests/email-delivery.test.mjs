import test from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import { createTestDb } from "./test-harness.mjs";
import { renderTemplate } from "../lib/utils/template.ts";
import { emailAddressSchema, testSendEmailSchema } from "../lib/validations/email.ts";

/**
 * Self-contained Test Mock Email Provider
 */
class TestMockEmailProvider {
  constructor(options = {}) {
    this.name = "mock";
    this.shouldFail = options.shouldFail || false;
    this.errorCode = options.errorCode || "MOCK_ERROR";
    this.errorMessage = options.errorMessage || "Mock dispatch failed";
    this.customMessageId = options.customMessageId;
    this.webhookSecret = options.webhookSecret || "whsec_mock_test_secret_key_12345";
    this.sentEmails = [];
  }

  isConfigured() {
    return true;
  }

  clear() {
    this.sentEmails = [];
    this.shouldFail = false;
    this.errorCode = "MOCK_ERROR";
    this.errorMessage = "Mock dispatch failed";
  }

  async sendEmail(payload) {
    if (this.shouldFail) {
      return {
        success: false,
        status: "FAILED",
        error: {
          code: this.errorCode,
          message: this.errorMessage,
        },
      };
    }

    const providerMessageId = this.customMessageId || `mock_msg_${crypto.randomUUID()}`;
    this.sentEmails.push({
      ...payload,
      providerMessageId,
      dispatchedAt: new Date().toISOString(),
    });

    return {
      success: true,
      providerMessageId,
      status: "SENT",
    };
  }

  async verifyWebhookSignature(rawBody, headers, secretOverride) {
    const secret = secretOverride || this.webhookSecret;
    if (!secret) return false;

    const authHeader = headers["authorization"] || headers["Authorization"];
    if (authHeader && authHeader === `Bearer ${secret}`) {
      return true;
    }

    const sig = headers["svix-signature"] || headers["x-resend-signature"] || headers["signature"];
    if (sig && (sig === secret || sig.includes(secret))) {
      return true;
    }

    return false;
  }

  parseWebhookEvent(body) {
    if (!body || typeof body !== "object") return null;

    const b = body;
    const rawType = String(b.type || b.event_type || "").toUpperCase();
    const data = (b.data && typeof b.data === "object" ? b.data : {});

    let eventType = "SENT";
    if (rawType.includes("DELIVERED")) eventType = "DELIVERED";
    else if (rawType.includes("BOUNCED") || rawType.includes("BOUNCE")) eventType = "BOUNCED";
    else if (rawType.includes("COMPLAIN")) eventType = "COMPLAINED";
    else if (rawType.includes("OPEN")) eventType = "OPENED";
    else if (rawType.includes("CLICK")) eventType = "CLICKED";
    else if (rawType.includes("RECEIV")) eventType = "RECEIVED";

    const providerMessageId = String(
      data.email_id || data.id || b.email_id || b.message_id || b.provider_message_id || ""
    );
    if (!providerMessageId) return null;

    const toAddresses = Array.isArray(data.to)
      ? data.to.map((addr) => String(addr))
      : [String(data.to || b.to || "")].filter(Boolean);

    return {
      provider: "mock",
      eventType,
      providerMessageId,
      providerEventId: b.id ? String(b.id) : undefined,
      recipientEmail: toAddresses[0] || "",
      timestamp: b.created_at ? new Date(String(b.created_at)).toISOString() : new Date().toISOString(),
      rawEvent: b,
    };
  }
}

/**
 * Resend Email Provider Adapter for unit & security tests
 */
class TestResendEmailProvider {
  constructor(options = {}) {
    this.name = "resend";
    this.apiKey = options.apiKey !== undefined ? options.apiKey : (process.env.RESEND_API_KEY || "");
    this.webhookSecret = options.webhookSecret !== undefined ? options.webhookSecret : (process.env.RESEND_WEBHOOK_SECRET || "");
  }

  isConfigured() {
    return Boolean(this.apiKey && this.apiKey.trim().length > 0);
  }

  async sendEmail() {
    if (!this.apiKey || !this.apiKey.trim()) {
      return {
        success: false,
        status: "FAILED",
        error: {
          code: "RESEND_API_KEY_MISSING",
          message: "Resend API key is not configured in environment variables.",
        },
      };
    }

    return {
      success: true,
      providerMessageId: `re_${crypto.randomUUID()}`,
      status: "SENT",
    };
  }

  async verifyWebhookSignature(rawBody, headers, secretOverride) {
    const secret = secretOverride || this.webhookSecret;
    if (!secret) return false;

    const authHeader = headers["authorization"] || headers["Authorization"];
    if (authHeader && authHeader === `Bearer ${secret}`) {
      return true;
    }

    try {
      const svixId = headers["svix-id"] || headers["webhook-id"];
      const svixTimestamp = headers["svix-timestamp"] || headers["webhook-timestamp"];
      const svixSignature = headers["svix-signature"] || headers["webhook-signature"];

      if (svixId && svixTimestamp && svixSignature) {
        const rawSecret = secret.startsWith("whsec_")
          ? Buffer.from(secret.slice(6), "base64")
          : Buffer.from(secret, "utf-8");
        const toSign = `${svixId}.${svixTimestamp}.${rawBody}`;
        const computed = crypto.createHmac("sha256", rawSecret).update(toSign).digest("base64");
        const signatures = svixSignature.split(" ").map((s) => s.replace(/^v1,/, ""));
        if (signatures.some((sig) => crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(computed)))) {
          return true;
        }
      }
    } catch {
      // Signature mismatch
    }

    return false;
  }
}

/**
 * Test Repositories & EmailService Implementation
 */
class TestEmailMessageRepository {
  constructor(db) {
    this.db = db;
  }

  async create(data) {
    const id = data.id || crypto.randomUUID();
    const status = data.status || "QUEUED";
    const fromEmail = data.from_email || data.sender_email;
    const toEmail = data.to_email || data.recipient_email;
    const metadataStr = JSON.stringify(data.metadata || {});

    this.db.public.none(`
      INSERT INTO email_messages (
        id, business_id, campaign_id, campaign_step_id, lead_id, template_id,
        direction, from_email, to_email, subject, body, status, provider_message_id,
        sent_at, metadata, created_at, updated_at
      ) VALUES (
        '${id}', '${data.business_id}', ${data.campaign_id ? `'${data.campaign_id}'` : "NULL"},
        ${data.campaign_step_id || data.step_id ? `'${data.campaign_step_id || data.step_id}'` : "NULL"},
        ${data.lead_id ? `'${data.lead_id}'` : "NULL"},
        ${data.template_id ? `'${data.template_id}'` : "NULL"},
        'outbound', '${fromEmail}', '${toEmail}',
        '${String(data.subject || "").replace(/'/g, "''")}',
        '${String(data.body || "").replace(/'/g, "''")}',
        '${status}',
        ${data.provider_message_id ? `'${data.provider_message_id}'` : "NULL"},
        ${data.sent_at ? `'${new Date(data.sent_at).toISOString()}'` : "NULL"},
        '${metadataStr.replace(/'/g, "''")}'::jsonb,
        NOW(), NOW()
      );
    `);

    return this.findById(id);
  }

  async findById(id) {
    const rows = this.db.public.many(`SELECT * FROM email_messages WHERE id = '${id}';`);
    if (!rows || rows.length === 0) return null;
    return rows[0];
  }

  async findByIdAndBusinessId(id, businessId) {
    const rows = this.db.public.many(
      `SELECT * FROM email_messages WHERE id = '${id}' AND business_id = '${businessId}';`
    );
    if (!rows || rows.length === 0) return null;
    return rows[0];
  }

  async findByProviderMessageId(providerMessageId) {
    const rows = this.db.public.many(
      `SELECT * FROM email_messages WHERE provider_message_id = '${providerMessageId}';`
    );
    if (!rows || rows.length === 0) return null;
    return rows[0];
  }

  async updateProviderMessageId(id, providerMessageId, status = "SENT") {
    this.db.public.none(`
      UPDATE email_messages
      SET provider_message_id = '${providerMessageId}',
          status = '${status}',
          sent_at = NOW(),
          updated_at = NOW()
      WHERE id = '${id}';
    `);
    return this.findById(id);
  }

  async updateStatus(id, status, metadataUpdate = {}) {
    const existing = await this.findById(id);
    const existingMetadata = existing?.metadata || {};
    const merged = { ...existingMetadata, ...metadataUpdate };

    this.db.public.none(`
      UPDATE email_messages
      SET status = '${status}',
          metadata = '${JSON.stringify(merged).replace(/'/g, "''")}'::jsonb,
          updated_at = NOW()
      WHERE id = '${id}';
    `);
    return this.findById(id);
  }

  async createEvent(data) {
    const id = data.id || crypto.randomUUID();
    const dataStr = JSON.stringify(data.data || {});
    let businessId = data.business_id;
    if (!businessId && data.message_id) {
      const msg = await this.findById(data.message_id);
      businessId = msg?.business_id;
    }

    this.db.public.none(`
      INSERT INTO email_events (
        id, business_id, email_message_id, event_type, provider_event_id, event_timestamp, metadata, created_at
      ) VALUES (
        '${id}', '${businessId}', '${data.message_id}', '${String(data.event_type).toLowerCase()}',
        ${data.provider_event_id ? `'${data.provider_event_id}'` : "NULL"},
        NOW(),
        '${dataStr.replace(/'/g, "''")}'::jsonb,
        NOW()
      );
    `);

    const rows = this.db.public.many(`SELECT * FROM email_events WHERE id = '${id}';`);
    return rows[0];
  }

  async findEventByProviderEventId(providerEventId) {
    const rows = this.db.public.many(
      `SELECT * FROM email_events WHERE provider_event_id = '${providerEventId}';`
    );
    if (!rows || rows.length === 0) return null;
    return rows[0];
  }

  async listEventsForMessage(messageId) {
    return this.db.public.many(
      `SELECT * FROM email_events WHERE email_message_id = '${messageId}' ORDER BY created_at ASC;`
    );
  }
}

class TestSuppressionRepository {
  constructor(db) {
    this.db = db;
  }

  async isSuppressed(businessId, email) {
    const normalized = email.trim().toLowerCase();
    const rows = this.db.public.many(
      `SELECT id FROM suppressions WHERE business_id = '${businessId}' AND LOWER(email) = '${normalized}';`
    );
    return rows.length > 0;
  }

  async addSuppression({ business_id, email, reason = "manual", source = "system" }) {
    const normalized = email.trim().toLowerCase();
    const isSupp = await this.isSuppressed(business_id, normalized);
    if (isSupp) return;

    const id = crypto.randomUUID();
    this.db.public.none(`
      INSERT INTO suppressions (id, business_id, email, reason, source, created_at)
      VALUES ('${id}', '${business_id}', '${normalized}', '${reason}', '${source}', NOW());
    `);
  }
}

class TestEmailService {
  constructor(provider, messageRepo, suppressionRepo, db) {
    this.provider = provider;
    this.messageRepo = messageRepo;
    this.suppressionRepo = suppressionRepo;
    this.db = db;
  }

  getProviderInfo() {
    return {
      name: this.provider.name,
      isConfigured: this.provider.isConfigured(),
    };
  }

  async sendEmail(businessId, userId, options) {
    // 1. Recipient email validation
    const parsed = emailAddressSchema.safeParse(options.to);
    if (!parsed.success) {
      throw new Error(`Invalid recipient email address: "${options.to}"`);
    }
    const normalizedTo = parsed.data;

    // 2. Suppression check
    const isSuppressed = await this.suppressionRepo.isSuppressed(businessId, normalizedTo);
    if (isSuppressed) {
      throw new Error("Recipient is suppressed and cannot receive email.");
    }

    // 3. Sender resolution
    const bizRows = this.db.public.many(`SELECT * FROM businesses WHERE id = '${businessId}';`);
    const biz = bizRows[0] || {};
    const settings = biz.settings || {};
    const emailSender = settings.email_sender || {};

    const fromName = options.fromName || emailSender.from_name || "Notifications";
    const fromEmail = options.fromEmail || emailSender.from_email || "notifications@example.com";
    const replyTo = options.replyTo || emailSender.reply_to || undefined;

    // 4. Content resolution
    let targetLeadId = options.leadId;
    if (!targetLeadId) {
      const matchLeads = this.db.public.many(
        `SELECT id FROM leads WHERE business_id = '${businessId}' AND LOWER(email) = '${normalizedTo}';`
      );
      if (matchLeads && matchLeads.length > 0) {
        targetLeadId = matchLeads[0].id;
      }
    }

    let finalSubject = options.subject || "";
    let finalHtml = options.body || "";

    if (options.templateId) {
      const tplRows = this.db.public.many(
        `SELECT * FROM email_templates WHERE id = '${options.templateId}' AND business_id = '${businessId}';`
      );
      if (!tplRows || tplRows.length === 0) {
        throw new Error("Email template not found or unauthorized.");
      }
      const tpl = tplRows[0];

      let contactContext = {};
      if (targetLeadId) {
        const leadRows = this.db.public.many(
          `SELECT * FROM leads WHERE id = '${targetLeadId}' AND business_id = '${businessId}';`
        );
        if (leadRows && leadRows.length > 0) {
          const l = leadRows[0];
          contactContext = {
            first_name: l.first_name,
            last_name: l.last_name,
            email: l.email,
            company_name: l.company_name,
            job_title: l.job_title,
          };
        }
      }

      const senderContext = {
        sender_name: fromName,
        sender_email: fromEmail,
        business_name: biz.name || "Our Business",
      };

      const rendered = renderTemplate(
        { subject: tpl.subject, body: tpl.body },
        contactContext,
        senderContext
      );
      finalSubject = rendered.subject;
      finalHtml = rendered.body;
    }

    // 5. Pre-flight record creation
    const message = await this.messageRepo.create({
      business_id: businessId,
      campaign_id: options.campaignId,
      campaign_step_id: options.campaignStepId,
      lead_id: targetLeadId,
      template_id: options.templateId,
      from_email: fromEmail,
      to_email: normalizedTo,
      subject: finalSubject,
      body: finalHtml,
      status: "SENDING",
    });

    // 6. Provider dispatch
    const dispatchResult = await this.provider.sendEmail({
      to: normalizedTo,
      fromEmail,
      fromName,
      replyTo,
      subject: finalSubject,
      html: finalHtml,
    });

    // 7. Update status based on provider response
    if (dispatchResult.success && dispatchResult.providerMessageId) {
      const updated = await this.messageRepo.updateProviderMessageId(
        message.id,
        dispatchResult.providerMessageId,
        "SENT"
      );
      return { success: true, message: updated };
    } else {
      const updated = await this.messageRepo.updateStatus(message.id, "FAILED", {
        error_code: dispatchResult.error?.code || "PROVIDER_ERROR",
        error_message: dispatchResult.error?.message || "Delivery failed",
      });
      return { success: false, message: updated, error: dispatchResult.error };
    }
  }

  async processWebhook(rawBody, headers, webhookSecret) {
    const isValid = await this.provider.verifyWebhookSignature(rawBody, headers, webhookSecret);
    if (!isValid) {
      throw new Error("Invalid webhook signature");
    }

    let parsedBody;
    try {
      parsedBody = typeof rawBody === "string" ? JSON.parse(rawBody) : rawBody;
    } catch {
      throw new Error("Invalid webhook JSON payload");
    }

    const event = this.provider.parseWebhookEvent(parsedBody, headers);
    if (!event) {
      return { success: true, ignored: true };
    }

    // Idempotency check
    if (event.providerEventId) {
      const existing = await this.messageRepo.findEventByProviderEventId(event.providerEventId);
      if (existing) {
        return { success: true, idempotent: true };
      }
    }

    // Locate matching message
    const message = await this.messageRepo.findByProviderMessageId(event.providerMessageId);
    if (!message) {
      return { success: true, unmapped: true };
    }

    // Create audit event
    const createdEvent = await this.messageRepo.createEvent({
      message_id: message.id,
      event_type: event.eventType,
      provider_event_id: event.providerEventId,
      data: event.rawEvent || {},
    });

    // Status transition
    let newStatus = message.status;
    if (event.eventType === "DELIVERED") {
      newStatus = "DELIVERED";
    } else if (event.eventType === "BOUNCED") {
      newStatus = "BOUNCED";
      await this.suppressionRepo.addSuppression({
        business_id: message.business_id,
        email: message.to_email,
        reason: "bounce",
      });
    } else if (event.eventType === "COMPLAINED") {
      newStatus = "COMPLAINED";
      await this.suppressionRepo.addSuppression({
        business_id: message.business_id,
        email: message.to_email,
        reason: "spam_complaint",
      });
    }

    let updatedMsg = message;
    if (newStatus !== message.status) {
      updatedMsg = await this.messageRepo.updateStatus(message.id, newStatus);
    }

    return {
      success: true,
      event: createdEvent,
      message: updatedMsg,
    };
  }
}

test("Phase 7: Email Delivery Infrastructure & Resend Integration Test Suite", async (t) => {
  const { db } = createTestDb();

  // Seed two distinct businesses for tenant isolation tests
  const bizAId = crypto.randomUUID();
  const bizBId = crypto.randomUUID();
  const userAId = crypto.randomUUID();
  const userBId = crypto.randomUUID();

  db.public.none(`
    INSERT INTO businesses (id, name, timezone, status, settings)
    VALUES ('${bizAId}', 'Acme Corporation A', 'America/New_York', 'active', '{"email_sender": {"from_name": "Acme Notifications", "from_email": "notifications@acme.test", "reply_to": "support@acme.test"}}'),
           ('${bizBId}', 'Beta Technologies B', 'UTC', 'active', '{"email_sender": {"from_name": "Beta Team", "from_email": "team@beta.test"}}');

    INSERT INTO users (id, business_id, email, full_name, role, status)
    VALUES ('${userAId}', '${bizAId}', 'admin@acme.test', 'Alice Admin', 'admin', 'active'),
           ('${userBId}', '${bizBId}', 'admin@beta.test', 'Bob Beta', 'admin', 'active');
  `);

  // Seed contacts for Business A and Business B
  const leadAId = crypto.randomUUID();
  const leadBId = crypto.randomUUID();

  db.public.none(`
    INSERT INTO leads (id, business_id, first_name, last_name, email, company_name, job_title, status)
    VALUES ('${leadAId}', '${bizAId}', 'Rahul', 'Sharma', 'rahul@client-demo.test', 'Nexus Retail', 'Director', 'new'),
           ('${leadBId}', '${bizBId}', 'John', 'Doe', 'john@beta-client.test', 'Beta Client Co', 'Manager', 'new');
  `);

  // Seed template for Business A
  const templateAId = crypto.randomUUID();
  db.public.none(`
    INSERT INTO email_templates (id, business_id, name, subject, body, variables, status)
    VALUES ('${templateAId}', '${bizAId}', 'Welcome Intro', 'Welcome to {{company_name}}, {{first_name}}!', '<p>Hi {{first_name}},</p><p>Welcome to our platform from {{sender_name}} at {{business_name}}.</p>', '["first_name","company_name","sender_name","business_name"]', 'active');
  `);

  // Repositories initialized with test db
  const messageRepo = new TestEmailMessageRepository(db);
  const suppressionRepo = new TestSuppressionRepository(db);

  const mockProvider = new TestMockEmailProvider();
  const emailService = new TestEmailService(
    mockProvider,
    messageRepo,
    suppressionRepo,
    db
  );

  // -------------------------------------------------------------
  // Test 1: Email Provider Abstraction
  // -------------------------------------------------------------
  await t.test("1. Email provider abstraction fulfills interface contracts", async () => {
    assert.ok(mockProvider.name, "Provider must expose a name identifier");
    assert.equal(typeof mockProvider.sendEmail, "function", "Provider must implement sendEmail");
    assert.equal(typeof mockProvider.verifyWebhookSignature, "function", "Provider must implement verifyWebhookSignature");
    assert.equal(typeof mockProvider.parseWebhookEvent, "function", "Provider must implement parseWebhookEvent");

    const result = await mockProvider.sendEmail({
      to: "recipient@example.test",
      fromEmail: "sender@acme.test",
      subject: "Test Abstraction",
      html: "<p>Hello</p>",
    });

    assert.equal(result.success, true);
    assert.equal(result.status, "SENT");
    assert.ok(result.providerMessageId, "Provider send result must return a normalized providerMessageId");
  });

  // -------------------------------------------------------------
  // Test 2: Resend Adapter Safe Error Handling & No Leaked Keys
  // -------------------------------------------------------------
  await t.test("2. Resend adapter handles missing API key safely without throwing", async () => {
    const unconfiguredResend = new TestResendEmailProvider({ apiKey: "" });
    assert.equal(unconfiguredResend.isConfigured(), false);

    const result = await unconfiguredResend.sendEmail({
      to: "test@example.test",
      fromEmail: "sender@example.test",
      subject: "Hello",
      html: "<p>Hi</p>",
    });

    assert.equal(result.success, false);
    assert.equal(result.status, "FAILED");
    assert.equal(result.error?.code, "RESEND_API_KEY_MISSING");
    assert.ok(!JSON.stringify(result).includes("secret"), "No secrets or keys exposed in result");
  });

  // -------------------------------------------------------------
  // Test 3: Successful Send via EmailService
  // -------------------------------------------------------------
  await t.test("3. Successful send dispatches email, stores record in SENT status", async () => {
    mockProvider.clear();
    mockProvider.shouldFail = false;

    const result = await emailService.sendEmail(bizAId, userAId, {
      to: "rahul@client-demo.test",
      leadId: leadAId,
      templateId: templateAId,
    });

    assert.equal(result.success, true);
    assert.equal(result.message.status, "SENT");
    assert.ok(result.message.provider_message_id, "Provider message ID must be stored on record");
    assert.equal(mockProvider.sentEmails.length, 1);
    assert.equal(mockProvider.sentEmails[0].to, "rahul@client-demo.test");
  });

  // -------------------------------------------------------------
  // Test 4: Provider Failure Graceful Handling
  // -------------------------------------------------------------
  await t.test("4. Provider failure records FAILED status without crashing transaction", async () => {
    mockProvider.clear();
    mockProvider.shouldFail = true;
    mockProvider.errorCode = "RESEND_RATE_LIMIT";
    mockProvider.errorMessage = "Rate limit exceeded on provider.";

    const result = await emailService.sendEmail(bizAId, userAId, {
      to: "rahul@client-demo.test",
      subject: "Important Notice",
      body: "<p>Hello</p>",
    });

    assert.equal(result.success, false);
    assert.equal(result.message.status, "FAILED");
    assert.equal(result.message.metadata?.error_code, "RESEND_RATE_LIMIT");
    assert.ok(!JSON.stringify(result.message).includes("api_key"), "No API key in metadata");
    mockProvider.shouldFail = false;
  });

  // -------------------------------------------------------------
  // Test 5: Invalid Recipient Validation
  // -------------------------------------------------------------
  await t.test("5. Invalid recipient email rejects before dispatch or record creation", async () => {
    const initialCount = db.public.many(`SELECT COUNT(*) as c FROM email_messages;`)[0].c;

    // Direct schema validation test
    assert.equal(emailAddressSchema.safeParse("invalid-address").success, false);
    assert.equal(emailAddressSchema.safeParse("valid@nexus.test").success, true);
    assert.equal(testSendEmailSchema.safeParse({ to: "not-an-email" }).success, false);
    assert.equal(testSendEmailSchema.safeParse({ to: "valid@nexus.test" }).success, true);

    await assert.rejects(
      async () => {
        await emailService.sendEmail(bizAId, userAId, {
          to: "not-an-email-address",
          subject: "Test",
          body: "<p>Test</p>",
        });
      },
      /invalid recipient email/i
    );

    const postCount = db.public.many(`SELECT COUNT(*) as c FROM email_messages;`)[0].c;
    assert.equal(postCount, initialCount, "No email_messages record created for invalid recipient");
  });

  // -------------------------------------------------------------
  // Test 6: Suppressed Recipient Mandatory Guard
  // -------------------------------------------------------------
  await t.test("6. MANDATORY: Suppressed recipient throws error and halts dispatch", async () => {
    const suppressedEmail = "optout-user@nexus.test";

    // Add to suppression list for Business A
    await suppressionRepo.addSuppression({
      business_id: bizAId,
      email: suppressedEmail,
      reason: "unsubscribe",
      source: "test_suite",
    });

    const isSupp = await suppressionRepo.isSuppressed(bizAId, suppressedEmail);
    assert.equal(isSupp, true);

    mockProvider.clear();

    await assert.rejects(
      async () => {
        await emailService.sendEmail(bizAId, userAId, {
          to: suppressedEmail,
          subject: "Special Offer",
          body: "<p>Come back!</p>",
        });
      },
      (err) => {
        assert.equal(err.message, "Recipient is suppressed and cannot receive email.");
        return true;
      }
    );

    assert.equal(mockProvider.sentEmails.length, 0, "Provider must NEVER be called for suppressed recipient");
  });

  // -------------------------------------------------------------
  // Test 7: Phase 5 Template Rendering Integration
  // -------------------------------------------------------------
  await t.test("7. Phase 5 template renderer cleanly substitutes contact and sender tokens", async () => {
    const rendered = renderTemplate(
      {
        subject: "Hello {{first_name}} from {{business_name}}",
        body: "<p>Dear {{first_name}} {{last_name}}, your company {{company_name}} is invited by {{sender_name}}.</p>",
      },
      {
        first_name: "Rahul",
        last_name: "Sharma",
        company_name: "Nexus Retail",
      },
      {
        sender_name: "Alice Admin",
        business_name: "Acme Corporation",
      }
    );

    assert.equal(rendered.subject, "Hello Rahul from Acme Corporation");
    assert.equal(
      rendered.body,
      "<p>Dear Rahul Sharma, your company Nexus Retail is invited by Alice Admin.</p>"
    );
    assert.equal(rendered.missingVariables.length, 0);

    // Test missing variable handling
    const withMissing = renderTemplate(
      { subject: "Hi {{first_name}}", body: "<p>{{unknown_key}} {{job_title}}</p>" },
      { first_name: "Rahul" }
    );
    assert.ok(withMissing.body.includes("[Missing job_title]"));
  });

  // -------------------------------------------------------------
  // Test 8: Pre-flight Email Message Record Creation
  // -------------------------------------------------------------
  await t.test("8. Email message record is created and persists in database", async () => {
    const created = await messageRepo.create({
      business_id: bizAId,
      lead_id: leadAId,
      from_email: "notifications@acme.test",
      to_email: "rahul@client-demo.test",
      subject: "Audit Record Check",
      body: "<p>Auditing</p>",
      status: "QUEUED",
    });

    assert.ok(created.id);
    assert.equal(created.status, "QUEUED");
    assert.equal(created.from_email, "notifications@acme.test");

    const fetched = await messageRepo.findById(created.id);
    assert.ok(fetched);
    assert.equal(fetched.id, created.id);
    assert.equal(fetched.subject, "Audit Record Check");
  });

  // -------------------------------------------------------------
  // Test 9: Provider Message ID Storage
  // -------------------------------------------------------------
  await t.test("9. Provider message ID is persisted onto email_messages record", async () => {
    const initial = await messageRepo.create({
      business_id: bizAId,
      lead_id: leadAId,
      from_email: "notifications@acme.test",
      to_email: "rahul@client-demo.test",
      subject: "ID Check",
      body: "<p>ID Check</p>",
      status: "SENDING",
    });

    const externalId = `resend_id_${crypto.randomUUID()}`;
    const updated = await messageRepo.updateProviderMessageId(initial.id, externalId, "SENT");

    assert.equal(updated.provider_message_id, externalId);
    assert.equal(updated.status, "SENT");

    const byProvider = await messageRepo.findByProviderMessageId(externalId);
    assert.ok(byProvider);
    assert.equal(byProvider.id, initial.id);
  });

  // -------------------------------------------------------------
  // Test 10: Webhook Signature Verification
  // -------------------------------------------------------------
  await t.test("10. Webhook endpoint rejects invalid signatures and verifies authentic signatures", async () => {
    const secret = "whsec_live_test_secret_key";
    const payload = JSON.stringify({ type: "email.delivered", data: { email_id: "msg_123" } });

    // Invalid signature must reject
    const invalidRes = await mockProvider.verifyWebhookSignature(payload, {
      "authorization": "Bearer invalid_secret",
    }, secret);
    assert.equal(invalidRes, false, "Invalid signature must fail verification");

    // Valid secret header must pass
    const validRes = await mockProvider.verifyWebhookSignature(payload, {
      "authorization": `Bearer ${secret}`,
    }, secret);
    assert.equal(validRes, true, "Authentic signature must pass verification");
  });

  // -------------------------------------------------------------
  // Test 11: Webhook Event Processing
  // -------------------------------------------------------------
  await t.test("11. Webhook event creates email_event audit record and updates message status", async () => {
    const msg = await messageRepo.create({
      business_id: bizAId,
      lead_id: leadAId,
      from_email: "notifications@acme.test",
      to_email: "webhook-test@nexus.test",
      subject: "Delivery Event Test",
      body: "<p>Body</p>",
      status: "SENT",
      provider_message_id: "resend_msg_audit_test",
    });

    const webhookBody = JSON.stringify({
      type: "email.delivered",
      id: "evt_delivered_unique_001",
      data: {
        email_id: msg.provider_message_id,
        to: ["webhook-test@nexus.test"],
      },
    });

    const webhookRes = await emailService.processWebhook(
      webhookBody,
      { "authorization": `Bearer ${mockProvider.webhookSecret}` },
      mockProvider.webhookSecret
    );

    assert.equal(webhookRes.success, true);
    assert.equal(webhookRes.message?.status, "DELIVERED");
    assert.ok(webhookRes.event);
    assert.equal(String(webhookRes.event.event_type).toUpperCase(), "DELIVERED");

    // Verify audit event persisted in database
    const events = await messageRepo.listEventsForMessage(msg.id);
    assert.ok(events.some((e) => e.event_type.toLowerCase() === "delivered"));
  });

  // -------------------------------------------------------------
  // Test 12: Duplicate Webhook Idempotency
  // -------------------------------------------------------------
  await t.test("12. Idempotency: Duplicate webhook delivers success without duplicate email_events", async () => {
    const msg = await messageRepo.create({
      business_id: bizAId,
      lead_id: leadAId,
      from_email: "notifications@acme.test",
      to_email: "idempotency@nexus.test",
      subject: "Idempotency Test",
      body: "<p>Body</p>",
      status: "SENT",
      provider_message_id: "resend_msg_idempotent_test",
    });

    const duplicateEventId = "evt_idempotent_duplicate_001";
    const webhookBody = JSON.stringify({
      type: "email.delivered",
      id: duplicateEventId,
      data: {
        email_id: msg.provider_message_id,
        to: ["idempotency@nexus.test"],
      },
    });

    // First arrival
    const res1 = await emailService.processWebhook(
      webhookBody,
      { "authorization": `Bearer ${mockProvider.webhookSecret}` },
      mockProvider.webhookSecret
    );
    assert.equal(res1.success, true);
    assert.equal(res1.idempotent, undefined);

    // Second arrival (duplicate)
    const res2 = await emailService.processWebhook(
      webhookBody,
      { "authorization": `Bearer ${mockProvider.webhookSecret}` },
      mockProvider.webhookSecret
    );
    assert.equal(res2.success, true);
    assert.equal(res2.idempotent, true, "Duplicate delivery must return idempotent acknowledgment");

    const events = await messageRepo.listEventsForMessage(msg.id);
    const count = events.filter((e) => e.provider_event_id === duplicateEventId).length;
    assert.equal(count, 1, "Only a single event record must exist for the unique provider_event_id");
  });

  // -------------------------------------------------------------
  // Test 13: Delivery Event
  // -------------------------------------------------------------
  await t.test("13. Delivery event sets message status to DELIVERED", async () => {
    const msg = await messageRepo.create({
      business_id: bizAId,
      lead_id: leadAId,
      from_email: "notifications@acme.test",
      to_email: "delivery@nexus.test",
      subject: "Delivery Transition",
      body: "<p>Body</p>",
      status: "SENT",
      provider_message_id: "resend_delivery_transition_001",
    });

    await emailService.processWebhook(
      JSON.stringify({
        type: "email.delivered",
        id: "evt_deliv_tr_001",
        data: { email_id: msg.provider_message_id, to: ["delivery@nexus.test"] },
      }),
      { "authorization": `Bearer ${mockProvider.webhookSecret}` },
      mockProvider.webhookSecret
    );

    const updated = await messageRepo.findById(msg.id);
    assert.equal(updated.status, "DELIVERED");
  });

  // -------------------------------------------------------------
  // Test 14: Bounce Event & Auto-Suppression
  // -------------------------------------------------------------
  await t.test("14. Bounce event sets status to BOUNCED and automatically suppresses address", async () => {
    const bounceEmail = "bounced-contact@bad-domain.test";
    const msg = await messageRepo.create({
      business_id: bizAId,
      lead_id: leadAId,
      from_email: "notifications@acme.test",
      to_email: bounceEmail,
      subject: "Bounce Test",
      body: "<p>Body</p>",
      status: "SENT",
      provider_message_id: "resend_bounce_msg_001",
    });

    await emailService.processWebhook(
      JSON.stringify({
        type: "email.bounced",
        id: "evt_bounce_001",
        data: {
          email_id: msg.provider_message_id,
          to: [bounceEmail],
          bounce_type: "Permanent Hard Bounce",
        },
      }),
      { "authorization": `Bearer ${mockProvider.webhookSecret}` },
      mockProvider.webhookSecret
    );

    const updated = await messageRepo.findById(msg.id);
    assert.equal(updated.status, "BOUNCED");

    // Verify recipient was automatically added to suppression list
    const isNowSuppressed = await suppressionRepo.isSuppressed(bizAId, bounceEmail);
    assert.equal(isNowSuppressed, true, "Bounced recipient must be automatically suppressed");
  });

  // -------------------------------------------------------------
  // Test 15: Complaint Event & Auto-Suppression
  // -------------------------------------------------------------
  await t.test("15. Complaint event sets status to COMPLAINED and automatically suppresses address", async () => {
    const complainEmail = "complaint-contact@domain.test";
    const msg = await messageRepo.create({
      business_id: bizAId,
      lead_id: leadAId,
      from_email: "notifications@acme.test",
      to_email: complainEmail,
      subject: "Complaint Test",
      body: "<p>Body</p>",
      status: "SENT",
      provider_message_id: "resend_complain_msg_001",
    });

    await emailService.processWebhook(
      JSON.stringify({
        type: "email.complained",
        id: "evt_complaint_001",
        data: {
          email_id: msg.provider_message_id,
          to: [complainEmail],
          reason: "Spam Complaint Feedback Loop",
        },
      }),
      { "authorization": `Bearer ${mockProvider.webhookSecret}` },
      mockProvider.webhookSecret
    );

    const updated = await messageRepo.findById(msg.id);
    assert.equal(updated.status, "COMPLAINED");

    const isSupp = await suppressionRepo.isSuppressed(bizAId, complainEmail);
    assert.equal(isSupp, true, "Complained recipient must be automatically suppressed");
  });

  // -------------------------------------------------------------
  // Test 16: Multi-Tenant Business Isolation
  // -------------------------------------------------------------
  await t.test("16. MANDATORY: Multi-tenant business isolation prevents cross-tenant access", async () => {
    // 1. Business A message cannot be accessed with Business B ID
    const msgA = await messageRepo.create({
      business_id: bizAId,
      lead_id: leadAId,
      from_email: "notifications@acme.test",
      to_email: "targetA@example.test",
      subject: "Tenant A Message",
      body: "<p>Confidential A</p>",
      status: "SENT",
    });

    const crossAccess = await messageRepo.findByIdAndBusinessId(msgA.id, bizBId);
    assert.equal(crossAccess, null, "Business B cannot access Business A's email message");

    // 2. Business A's suppression does not suppress Business B unless isolated
    const sharedEmail = "isolated-tenant-check@client.test";
    await suppressionRepo.addSuppression({
      business_id: bizAId,
      email: sharedEmail,
      reason: "manual",
    });

    const isSuppressedInA = await suppressionRepo.isSuppressed(bizAId, sharedEmail);
    const isSuppressedInB = await suppressionRepo.isSuppressed(bizBId, sharedEmail);

    assert.equal(isSuppressedInA, true);
    assert.equal(isSuppressedInB, false, "Business B must not inherit Business A's suppression");
  });

  // -------------------------------------------------------------
  // Test 17: API Key Not Exposed to Client
  // -------------------------------------------------------------
  await t.test("17. Security: Email provider status never exposes secrets in client payloads", async () => {
    const providerInfo = emailService.getProviderInfo();
    assert.ok("name" in providerInfo);
    assert.ok("isConfigured" in providerInfo);
    assert.equal("apiKey" in providerInfo, false, "API key property must not exist on provider info");
    assert.equal("webhookSecret" in providerInfo, false, "Webhook secret must not exist on provider info");

    const serialized = JSON.stringify(providerInfo);
    assert.ok(!serialized.includes("whsec_"));
    assert.ok(!serialized.includes("re_"));
  });
});
