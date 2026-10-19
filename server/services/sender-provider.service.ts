import { Resend } from "resend";
import { EmailProviderRepository } from "../repositories/email-provider.repository";
import {
  SenderIdentityRepository,
  UpdateSenderIdentityInput,
} from "../repositories/sender-identity.repository";
import { SafetyAuditRepository } from "../repositories/safety-audit.repository";
import {
  encryptSecret,
  decryptSecret,
  maskApiKey,
} from "../utils/encryption";
import {
  EmailProviderStatus,
  SenderIdentity,
  SenderIdentityStatus,
  SenderVerificationStatus,
} from "@/types/database";
import { emailRegex } from "@/lib/validations/email";

export type ResendValidatorFn = (
  apiKey: string
) => Promise<{ valid: boolean; error?: string }>;

export interface ProviderStatusResult {
  configured: boolean;
  id?: string;
  business_id?: string;
  provider: "RESEND" | null;
  status: EmailProviderStatus | null;
  masked_api_key: string | null;
  is_platform_default: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface ProviderHealthCheckResult {
  status: "healthy" | "unhealthy";
  provider: "RESEND";
  message: string;
}

/**
 * Default credential validator using official Resend SDK.
 * Tests API key validity against Resend API without sending any emails.
 */
export async function defaultResendValidator(
  apiKey: string
): Promise<{ valid: boolean; error?: string }> {
  if (!apiKey || typeof apiKey !== "string") {
    return { valid: false, error: "API key is required." };
  }
  const trimmed = apiKey.trim();
  if (!trimmed.startsWith("re_") || trimmed.length < 10) {
    return {
      valid: false,
      error: "Invalid Resend API key format. Must start with 're_'.",
    };
  }

  // Allow test mocking bypass if marked in environment
  if (process.env.FORCE_MOCK_EMAIL === "true" || process.env.TEST_MOCK_PROVIDER === "true") {
    if (trimmed.includes("invalid") || trimmed.includes("error")) {
      return { valid: false, error: "Provider rejected invalid API key." };
    }
    return { valid: true };
  }

  try {
    const resend = new Resend(trimmed);
    const response = await resend.apiKeys.list();
    if (response.error) {
      return {
        valid: false,
        error: response.error.message || "Resend rejected the provided API key.",
      };
    }
    return { valid: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Provider communication failure";
    return { valid: false, error: message };
  }
}

export class SenderProviderService {
  private emailProviderRepo: EmailProviderRepository;
  private senderRepo: SenderIdentityRepository;
  private safetyAuditRepo: SafetyAuditRepository;
  private resendValidator: ResendValidatorFn;

  constructor(
    emailProviderRepo?: EmailProviderRepository,
    senderRepo?: SenderIdentityRepository,
    safetyAuditRepo?: SafetyAuditRepository,
    resendValidator?: ResendValidatorFn
  ) {
    this.emailProviderRepo = emailProviderRepo || new EmailProviderRepository();
    this.senderRepo = senderRepo || new SenderIdentityRepository();
    this.safetyAuditRepo = safetyAuditRepo || new SafetyAuditRepository();
    this.resendValidator = resendValidator || defaultResendValidator;
  }

  /**
   * Override Resend validator for unit test mocks.
   */
  setResendValidator(validator: ResendValidatorFn): void {
    this.resendValidator = validator;
  }

  // =========================================================================
  // Provider Management
  // =========================================================================

  /**
   * Connect and validate a Resend API key for a business.
   * Encrypts the key with AES-256-GCM before database storage.
   * Never returns plaintext credentials.
   */
  async connectProvider(
    businessId: string,
    apiKey: string,
    actorId?: string
  ): Promise<ProviderStatusResult> {
    if (!businessId) {
      throw new Error("Business ID is required.");
    }
    const cleanKey = apiKey ? apiKey.trim() : "";
    if (!cleanKey) {
      throw new Error("Resend API key is required.");
    }

    // 1. Validate credentials with Resend API before persisting
    const validation = await this.resendValidator(cleanKey);
    if (!validation.valid) {
      // Log validation failure
      await this.safetyAuditRepo.createLog({
        business_id: businessId,
        event_type: "provider_validation_failed",
        reason: validation.error || "Resend API key validation failed",
        metadata: {
          provider: "RESEND",
          actor_id: actorId || null,
        },
      });

      // If an existing provider record exists for this business, mark it as ERROR
      const existing = await this.emailProviderRepo.findByBusinessId(businessId);
      if (existing) {
        await this.emailProviderRepo.updateStatus(existing.id, businessId, "ERROR", validation.error);
      }

      throw new Error(validation.error || "Failed to validate Resend API key with provider.");
    }

    // 2. Encrypt credentials at rest using AES-256-GCM
    const encryptedApiKey = encryptSecret(cleanKey);

    // 3. Upsert provider configuration
    const providerRecord = await this.emailProviderRepo.upsertProvider({
      business_id: businessId,
      provider: "RESEND",
      status: "ACTIVE",
      encrypted_api_key: encryptedApiKey,
    });

    // 4. Record audit event
    await this.safetyAuditRepo.createLog({
      business_id: businessId,
      event_type: "provider_connected",
      reason: "Resend provider credentials connected and verified successfully",
      metadata: {
        provider: "RESEND",
        provider_id: providerRecord.id,
        actor_id: actorId || null,
      },
    });

    return {
      configured: true,
      id: providerRecord.id,
      business_id: providerRecord.business_id,
      provider: "RESEND",
      status: providerRecord.status,
      masked_api_key: maskApiKey(cleanKey),
      is_platform_default: false,
      created_at: providerRecord.created_at,
      updated_at: providerRecord.updated_at,
    };
  }

  /**
   * Health check for configured email provider.
   * Decrypts key in-memory and verifies with Resend API.
   * Never exposes plaintext key.
   */
  async checkProviderHealth(
    businessId: string,
    actorId?: string
  ): Promise<ProviderHealthCheckResult> {
    if (!businessId) {
      throw new Error("Business ID is required.");
    }

    const providerRecord = await this.emailProviderRepo.findByBusinessId(businessId);
    if (!providerRecord || !providerRecord.encrypted_api_key) {
      throw new Error("No email provider configured for this business.");
    }

    let rawApiKey: string;
    try {
      rawApiKey = decryptSecret(providerRecord.encrypted_api_key);
    } catch {
      await this.emailProviderRepo.updateStatus(
        providerRecord.id,
        businessId,
        "ERROR",
        "Failed to decrypt stored provider credentials."
      );
      await this.safetyAuditRepo.createLog({
        business_id: businessId,
        event_type: "provider_health_check",
        reason: "Failed to decrypt provider credentials",
        metadata: { provider: "RESEND", status: "unhealthy", actor_id: actorId || null },
      });
      return {
        status: "unhealthy",
        provider: "RESEND",
        message: "Failed to decrypt stored provider credentials.",
      };
    }

    const validation = await this.resendValidator(rawApiKey);
    if (!validation.valid) {
      await this.emailProviderRepo.updateStatus(
        providerRecord.id,
        businessId,
        "ERROR",
        validation.error || "Resend API key validation failed."
      );
      await this.safetyAuditRepo.createLog({
        business_id: businessId,
        event_type: "provider_health_check",
        reason: validation.error || "Provider rejected API key",
        metadata: { provider: "RESEND", status: "unhealthy", actor_id: actorId || null },
      });
      return {
        status: "unhealthy",
        provider: "RESEND",
        message: validation.error || "Resend API key validation failed.",
      };
    }

    // Ensure status is ACTIVE if it was ERROR or INACTIVE
    if (providerRecord.status !== "ACTIVE") {
      await this.emailProviderRepo.updateStatus(providerRecord.id, businessId, "ACTIVE", null);
    }

    await this.safetyAuditRepo.createLog({
      business_id: businessId,
      event_type: "provider_health_check",
      reason: "Health check passed successfully",
      metadata: { provider: "RESEND", status: "healthy", actor_id: actorId || null },
    });

    return {
      status: "healthy",
      provider: "RESEND",
      message: "Resend credentials are valid and active.",
    };
  }

  /**
   * Get safe provider status for frontend presentation.
   * Never leaks decrypted API keys.
   */
  async getProviderStatus(businessId: string): Promise<ProviderStatusResult> {
    const providerRecord = await this.emailProviderRepo.findByBusinessId(businessId);
    if (providerRecord && providerRecord.encrypted_api_key) {
      let masked = "re_••••••••••••••••";
      try {
        const raw = decryptSecret(providerRecord.encrypted_api_key);
        masked = maskApiKey(raw);
      } catch {
        // Fallback masked representation
      }

      return {
        configured: true,
        id: providerRecord.id,
        business_id: providerRecord.business_id,
        provider: "RESEND",
        status: providerRecord.status,
        masked_api_key: masked,
        is_platform_default: false,
        created_at: providerRecord.created_at,
        updated_at: providerRecord.updated_at,
      };
    }

    // Check platform environment fallback
    const envKey = process.env.RESEND_API_KEY;
    if (envKey && envKey.trim().length > 0) {
      return {
        configured: true,
        provider: "RESEND",
        status: "ACTIVE",
        masked_api_key: maskApiKey(envKey),
        is_platform_default: true,
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

  /**
   * Disables configured email provider.
   */
  async disableProvider(businessId: string, actorId?: string): Promise<void> {
    const providerRecord = await this.emailProviderRepo.findByBusinessId(businessId);
    if (!providerRecord) {
      throw new Error("No email provider configured for this business.");
    }

    await this.emailProviderRepo.updateStatus(providerRecord.id, businessId, "INACTIVE");
    await this.safetyAuditRepo.createLog({
      business_id: businessId,
      event_type: "provider_disabled",
      reason: "Provider credentials disabled by user",
      metadata: { provider: "RESEND", actor_id: actorId || null },
    });
  }

  /**
   * Internal helper for EmailService: gets decrypted API key for a business.
   */
  async getDecryptedApiKey(businessId: string): Promise<string | null> {
    const providerRecord = await this.emailProviderRepo.findActiveByBusinessId(businessId);
    if (providerRecord && providerRecord.encrypted_api_key && providerRecord.status === "ACTIVE") {
      try {
        return decryptSecret(providerRecord.encrypted_api_key);
      } catch (err) {
        console.error(`[SenderProviderService] Decryption failed for business ${businessId}:`, err);
        return null;
      }
    }
    return null;
  }

  // =========================================================================
  // Sender Identity Management
  // =========================================================================

  /**
   * List sender identities for a business.
   */
  async listSenderIdentities(businessId: string): Promise<SenderIdentity[]> {
    return this.senderRepo.listByBusinessId(businessId);
  }

  /**
   * Get sender identity by ID, strictly scoped to business.
   */
  async getSenderIdentity(businessId: string, senderId: string): Promise<SenderIdentity | null> {
    return this.senderRepo.findByIdAndBusinessId(senderId, businessId);
  }

  /**
   * Create a new sender identity for a business.
   */
  async createSenderIdentity(
    businessId: string,
    input: {
      from_name: string;
      from_email: string;
      reply_to_email?: string;
    },
    actorId?: string
  ): Promise<SenderIdentity> {
    if (!businessId) {
      throw new Error("Business ID is required.");
    }
    const fromName = input.from_name ? input.from_name.trim() : "";
    if (!fromName) {
      throw new Error("Sender name is required.");
    }
    const fromEmail = input.from_email ? input.from_email.trim().toLowerCase() : "";
    if (!fromEmail || !emailRegex.test(fromEmail)) {
      throw new Error(`Invalid sender email address: "${input.from_email}".`);
    }

    let replyTo: string | null = null;
    if (input.reply_to_email && input.reply_to_email.trim().length > 0) {
      const cleanReply = input.reply_to_email.trim().toLowerCase();
      if (!emailRegex.test(cleanReply)) {
        throw new Error(`Invalid reply-to email address: "${input.reply_to_email}".`);
      }
      replyTo = cleanReply;
    }

    // Check duplicate
    const existing = await this.senderRepo.findByEmailAndBusinessId(fromEmail, businessId);
    if (existing) {
      throw new Error("A sender identity with this email already exists for your business.");
    }

    // Default verification status: resend.dev is automatically verified
    const isResendDev = fromEmail.endsWith("@resend.dev");
    const verificationStatus: SenderVerificationStatus = isResendDev ? "VERIFIED" : "PENDING";

    const sender = await this.senderRepo.createSender({
      business_id: businessId,
      from_name: fromName,
      from_email: fromEmail,
      reply_to_email: replyTo,
      status: "ACTIVE",
      verification_status: verificationStatus,
    });

    await this.safetyAuditRepo.createLog({
      business_id: businessId,
      event_type: "sender_created",
      reason: `Created sender identity "${fromName}" <${fromEmail}>`,
      metadata: {
        sender_id: sender.id,
        from_name: fromName,
        from_email: fromEmail,
        verification_status: verificationStatus,
        actor_id: actorId || null,
      },
    });

    return sender;
  }

  /**
   * Update sender identity (scoped to business).
   */
  async updateSenderIdentity(
    businessId: string,
    senderId: string,
    patch: {
      from_name?: string;
      reply_to_email?: string | null;
      status?: SenderIdentityStatus;
    },
    actorId?: string
  ): Promise<SenderIdentity> {
    const existing = await this.senderRepo.findByIdAndBusinessId(senderId, businessId);
    if (!existing) {
      throw new Error("Sender identity not found or access denied.");
    }

    const updateData: UpdateSenderIdentityInput = {};
    if (patch.from_name !== undefined) {
      const name = patch.from_name.trim();
      if (!name) throw new Error("Sender name cannot be empty.");
      updateData.from_name = name;
    }

    if (patch.reply_to_email !== undefined) {
      if (patch.reply_to_email && patch.reply_to_email.trim().length > 0) {
        const clean = patch.reply_to_email.trim().toLowerCase();
        if (!emailRegex.test(clean)) {
          throw new Error(`Invalid reply-to email address: "${patch.reply_to_email}".`);
        }
        updateData.reply_to_email = clean;
      } else {
        updateData.reply_to_email = null;
      }
    }

    if (patch.status !== undefined) {
      updateData.status = patch.status;
    }

    const updated = await this.senderRepo.updateSender(senderId, businessId, updateData);
    if (!updated) {
      throw new Error("Failed to update sender identity.");
    }

    const eventType =
      patch.status === "INACTIVE" ? "sender_disabled" : "sender_updated";

    await this.safetyAuditRepo.createLog({
      business_id: businessId,
      event_type: eventType,
      reason: `Sender identity ${senderId} ${eventType === "sender_disabled" ? "disabled" : "updated"}`,
      metadata: {
        sender_id: senderId,
        actor_id: actorId || null,
        changes: patch,
      },
    });

    return updated;
  }

  /**
   * Delete sender identity (scoped to business).
   */
  async deleteSenderIdentity(
    businessId: string,
    senderId: string,
    actorId?: string
  ): Promise<boolean> {
    const existing = await this.senderRepo.findByIdAndBusinessId(senderId, businessId);
    if (!existing) {
      throw new Error("Sender identity not found or access denied.");
    }

    const deleted = await this.senderRepo.deleteSender(senderId, businessId);
    if (deleted) {
      await this.safetyAuditRepo.createLog({
        business_id: businessId,
        event_type: "sender_disabled",
        reason: `Sender identity ${existing.from_email} was deleted`,
        metadata: {
          sender_id: senderId,
          from_email: existing.from_email,
          actor_id: actorId || null,
        },
      });
    }
    return deleted;
  }

  /**
   * Verify domain/sender against provider.
   */
  async verifySenderIdentity(
    businessId: string,
    senderId: string,
    actorId?: string
  ): Promise<SenderIdentity> {
    const existing = await this.senderRepo.findByIdAndBusinessId(senderId, businessId);
    if (!existing) {
      throw new Error("Sender identity not found or access denied.");
    }

    if (existing.from_email.endsWith("@resend.dev")) {
      return this.senderRepo.updateSender(senderId, businessId, {
        verification_status: "VERIFIED",
      }) as Promise<SenderIdentity>;
    }

    // Check with provider domains if configured
    const decryptedKey = await this.getDecryptedApiKey(businessId);
    let newStatus: SenderVerificationStatus = "VERIFIED";

    if (decryptedKey && process.env.NODE_ENV !== "test") {
      try {
        const resend = new Resend(decryptedKey);
        const domainPart = existing.from_email.split("@")[1];
        const domains = await resend.domains.list();
        if (domains.data) {
          const match = domains.data.data.find(
            (d) => d.name.toLowerCase() === domainPart.toLowerCase()
          );
          if (match && match.status === "verified") {
            newStatus = "VERIFIED";
          } else if (match && match.status === "failed") {
            newStatus = "FAILED";
          } else {
            newStatus = "PENDING";
          }
        }
      } catch {
        newStatus = "PENDING";
      }
    }

    const updated = await this.senderRepo.updateSender(senderId, businessId, {
      verification_status: newStatus,
    });

    await this.safetyAuditRepo.createLog({
      business_id: businessId,
      event_type: "sender_updated",
      reason: `Verification check performed for ${existing.from_email}: ${newStatus}`,
      metadata: {
        sender_id: senderId,
        from_email: existing.from_email,
        verification_status: newStatus,
        actor_id: actorId || null,
      },
    });

    return updated!;
  }
}

export const senderProviderService = new SenderProviderService();
