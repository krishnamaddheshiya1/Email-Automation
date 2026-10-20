import {
  EmailProvider,
  InboundEmailProvider,
  SendEmailPayload,
  EmailSendResult,
} from "../providers/email/email-provider.interface";
import { ResendEmailProvider } from "../providers/email/resend.provider";
import { MockEmailProvider } from "../providers/email/mock.provider";
import {
  EmailMessageRepository,
  CreateEmailMessageInput,
  LocalEmailStore,
} from "../repositories/email-message.repository";
import { SuppressionRepository } from "../repositories/suppression.repository";
import { LeadRepository } from "../repositories/lead.repository";
import { TemplateRepository } from "../repositories/template.repository";
import { BusinessRepository } from "../repositories/business.repository";
import { EmailProviderRepository } from "../repositories/email-provider.repository";
import { SenderIdentityRepository } from "../repositories/sender-identity.repository";
import { CampaignRepository } from "../repositories/campaign.repository";
import { decryptSecret } from "../utils/encryption";
import {
  renderTemplate,
  TemplateContactContext,
  TemplateSenderContext,
} from "@/lib/utils/template";
import { emailAddressSchema, emailRegex } from "@/lib/validations/email";
import { EmailMessage, EmailEvent, MessageStatus } from "@/types/database";
import { EmailAttachment } from "@/types/attachment";
import { getAppBaseUrl } from "@/lib/config/site";
import { replyService } from "./reply.service";

export interface SendEmailOptions {
  to: string;
  leadId?: string;
  templateId?: string;
  campaignId?: string;
  campaignStepId?: string;
  senderIdentityId?: string;
  subject?: string;
  body?: string;
  fromName?: string;
  fromEmail?: string;
  replyTo?: string;
  metadata?: Record<string, unknown>;
  attachments?: EmailAttachment[];
  attachmentIds?: string[];
}

export interface SendEmailResult {
  success: boolean;
  message: EmailMessage;
  providerResult: EmailSendResult;
  renderedSubject: string;
  renderedBody: string;
}

export interface WebhookProcessResult {
  success: boolean;
  idempotent?: boolean;
  error?: string;
  event?: EmailEvent;
  message?: EmailMessage | null;
}

import {
  DeliverySafetyService,
  deliverySafetyService as defaultDeliverySafetyService,
} from "./delivery-safety.service";
import {
  AttachmentService,
  attachmentService as defaultAttachmentService,
} from "./attachment.service";

export class EmailService {
  private provider: EmailProvider;
  private messageRepo: EmailMessageRepository;
  private suppressionRepo: SuppressionRepository;
  private leadRepo: LeadRepository;
  private templateRepo: TemplateRepository;
  private businessRepo: BusinessRepository;
  private safetyService: DeliverySafetyService;
  private emailProviderRepo: EmailProviderRepository;
  private senderRepo: SenderIdentityRepository;
  private campaignRepo: CampaignRepository;
  private attachmentService: AttachmentService;

  constructor(
    provider?: EmailProvider,
    messageRepo?: EmailMessageRepository,
    suppressionRepo?: SuppressionRepository,
    leadRepo?: LeadRepository,
    templateRepo?: TemplateRepository,
    businessRepo?: BusinessRepository,
    safetyService?: DeliverySafetyService,
    emailProviderRepo?: EmailProviderRepository,
    senderRepo?: SenderIdentityRepository,
    campaignRepo?: CampaignRepository,
    attachmentService?: AttachmentService
  ) {
    if (provider) {
      this.provider = provider;
    } else if (process.env.NODE_ENV === "test" || process.env.FORCE_MOCK_EMAIL === "true") {
      this.provider = new MockEmailProvider();
    } else {
      this.provider = new ResendEmailProvider();
    }

    this.messageRepo = messageRepo || new EmailMessageRepository();
    this.suppressionRepo = suppressionRepo || new SuppressionRepository();
    this.leadRepo = leadRepo || new LeadRepository();
    this.templateRepo = templateRepo || new TemplateRepository();
    this.businessRepo = businessRepo || new BusinessRepository();
    this.safetyService = safetyService || defaultDeliverySafetyService;
    this.emailProviderRepo = emailProviderRepo || new EmailProviderRepository();
    this.senderRepo = senderRepo || new SenderIdentityRepository();
    this.campaignRepo = campaignRepo || new CampaignRepository();
    this.attachmentService = attachmentService || defaultAttachmentService;
  }

  /**
   * Resolves the email provider to use for dispatching.
   * If a business has an active custom provider, it uses that provider with decrypted credentials.
   * Otherwise falls back to system provider.
   */
  async resolveProviderForBusiness(businessId: string): Promise<EmailProvider> {
    if (this.provider.name === "mock") {
      return this.provider;
    }

    const providerConfig = await this.emailProviderRepo.findActiveByBusinessId(businessId);
    if (providerConfig && providerConfig.encrypted_api_key && providerConfig.status === "ACTIVE") {
      try {
        const decryptedKey = decryptSecret(providerConfig.encrypted_api_key);
        return new ResendEmailProvider({ apiKey: decryptedKey });
      } catch (err) {
        console.error(`[EmailService] Failed to decrypt provider credentials for business ${businessId}:`, err);
      }
    }

    return this.provider;
  }

  /**
   * Helper to retrieve configured provider instance with decrypted credentials for a business.
   */
  async getDecryptedProviderForBusiness(businessId: string): Promise<ResendEmailProvider | null> {
    const providerConfig = await this.emailProviderRepo.findActiveByBusinessId(businessId);
    if (providerConfig && providerConfig.encrypted_api_key && providerConfig.status === "ACTIVE") {
      const decryptedKey = decryptSecret(providerConfig.encrypted_api_key);
      return new ResendEmailProvider({ apiKey: decryptedKey });
    }
    return null;
  }

  /**
   * Sets or replaces the email provider (e.g. for switching to Mock in test suites).
   */
  setProvider(provider: EmailProvider): void {
    this.provider = provider;
    if ("parseInboundEmail" in provider) {
      replyService.setProvider(provider as unknown as (EmailProvider & InboundEmailProvider));
    }
  }

  /**
   * Returns current provider name and configuration readiness without leaking secrets.
   */
  getProviderInfo(): { name: string; isConfigured: boolean } {
    const isConfigured =
      this.provider.name === "mock"
        ? true
        : this.provider instanceof ResendEmailProvider
        ? this.provider.isConfigured()
        : Boolean(process.env.RESEND_API_KEY);

    return {
      name: this.provider.name,
      isConfigured,
    };
  }

  /**
   * Resolves safe sender identity for a business.
   */
  async resolveSenderIdentity(
    businessId: string,
    override?: { fromName?: string; fromEmail?: string; replyTo?: string }
  ): Promise<{ fromName: string; fromEmail: string; replyTo: string | undefined }> {
    const business = await this.businessRepo.findById(businessId);
    const settings = (business?.settings || {}) as Record<string, unknown>;
    const emailConfig = (settings.email_sender || {}) as Record<string, string>;

    const defaultFromName = process.env.EMAIL_FROM_NAME || business?.name || "Notification";
    const defaultFromEmail = process.env.EMAIL_FROM_ADDRESS || "onboarding@resend.dev";
    const defaultReplyTo = process.env.EMAIL_REPLY_TO || undefined;

    const fromName = override?.fromName?.trim() || emailConfig.from_name || defaultFromName;
    const fromEmail = (override?.fromEmail?.trim() || emailConfig.from_email || defaultFromEmail).toLowerCase();
    const replyTo = override?.replyTo?.trim() || emailConfig.reply_to || defaultReplyTo;

    // Validate fromEmail syntax
    const validFrom = emailAddressSchema.safeParse(fromEmail);
    if (!validFrom.success) {
      throw new Error(`Invalid configured sender email address: "${fromEmail}".`);
    }

    if (replyTo) {
      const validReply = emailAddressSchema.safeParse(replyTo);
      if (!validReply.success) {
        throw new Error(`Invalid configured reply-to email address: "${replyTo}".`);
      }
    }

    return {
      fromName,
      fromEmail,
      replyTo: replyTo || undefined,
    };
  }

  /**
   * Core Email Delivery Engine
   *
   * Executes the 10-step strict delivery rule:
   * 1. Multi-tenant business validation
   * 2. Recipient syntax validation & normalization
   * 3. Contact lookup & authorization
   * 4. Mandatory suppression list check
   * 5. Phase 5 template rendering
   * 6. Sender identity validation
   * 7. Pre-flight record creation (QUEUED -> SENDING)
   * 8. Call provider adapter
   * 9. Persist provider message ID
   * 10. Update status to SENT or FAILED
   */
  async sendEmail(
    businessId: string,
    userId: string,
    options: SendEmailOptions
  ): Promise<SendEmailResult> {
    if (!businessId) {
      throw new Error("Business ID is required for multi-tenant isolation.");
    }

    // 1. Validate & normalize recipient email
    const rawTo = options.to?.trim() || "";
    if (!rawTo) {
      throw new Error("Recipient email address is required.");
    }
    const normalizedTo = rawTo.toLowerCase();
    if (!emailRegex.test(normalizedTo)) {
      throw new Error(`Invalid recipient email address format: "${rawTo}".`);
    }

    // 2. Contact scoping & association
    let lead = options.leadId
      ? await this.leadRepo.findByIdAndBusinessId(options.leadId, businessId)
      : null;

    if (!lead) {
      // Find contact by email in this business
      lead = await this.leadRepo.findByEmail(businessId, normalizedTo);
    }

    if (!lead) {
      // Create a managed lead record for recipient tracking
      lead = await this.leadRepo.create({
        business_id: businessId,
        email: normalizedTo,
        first_name: null,
        last_name: null,
        phone: null,
        company_name: null,
        job_title: null,
        industry: null,
        website: null,
        status: "new",
        source: "direct_send",
        lead_score: 0,
        owner_user_id: null,
        metadata: {},
      });
    }

    // 3. MANDATORY SUPPRESSION CHECK
    // If recipient email is suppressed: DO NOT SEND.
    const isSuppressed = await this.suppressionRepo.isSuppressed(businessId, normalizedTo);
    if (isSuppressed) {
      throw new Error("Recipient is suppressed and cannot receive email.");
    }

    // 3b. BUSINESS SENDING LIMIT CHECK
    const limitCheck = await this.safetyService.checkLimits(businessId);
    if (!limitCheck.allowed) {
      throw new Error(limitCheck.reason || "Business sending limit exceeded.");
    }

    // 4. Resolve template or direct content
    let rawSubject = options.subject || "";
    let rawBody = options.body || "";

    if (options.templateId) {
      const template = await this.templateRepo.findByIdAndBusinessId(options.templateId, businessId);
      if (!template) {
        throw new Error("Specified template does not exist or access denied.");
      }
      rawSubject = template.subject;
      rawBody = template.body;
    }

    if (!rawSubject.trim()) {
      throw new Error("Email subject cannot be empty.");
    }
    if (!rawBody.trim()) {
      throw new Error("Email body cannot be empty.");
    }

    // 5. Template Rendering via Phase 5 engine
    const contactContext: TemplateContactContext = {
      first_name: lead.first_name,
      last_name: lead.last_name,
      email: lead.email,
      company_name: lead.company_name,
      job_title: lead.job_title,
      industry: lead.industry,
      website: lead.website,
    };

    let sender: { fromName: string; fromEmail: string; replyTo: string | undefined };
    let effectiveSenderId = options.senderIdentityId;
    if (!effectiveSenderId && options.campaignId) {
      const campaign = await this.campaignRepo.findByIdAndBusinessId(options.campaignId, businessId);
      if (campaign?.sender_identity_id) {
        effectiveSenderId = campaign.sender_identity_id;
      }
    }

    if (effectiveSenderId) {
      const senderIdentity = await this.senderRepo.findByIdAndBusinessId(effectiveSenderId, businessId);
      if (!senderIdentity) {
        throw new Error("Specified sender identity does not exist or access denied.");
      }
      if (senderIdentity.status !== "ACTIVE") {
        throw new Error("Specified sender identity is not active.");
      }
      sender = {
        fromName: senderIdentity.from_name,
        fromEmail: senderIdentity.from_email,
        replyTo: senderIdentity.reply_to_email || options.replyTo || undefined,
      };
    } else {
      sender = await this.resolveSenderIdentity(businessId, {
        fromName: options.fromName,
        fromEmail: options.fromEmail,
        replyTo: options.replyTo,
      });
    }

    const business = await this.businessRepo.findById(businessId);
    const senderContext: TemplateSenderContext = {
      sender_name: sender.fromName,
      business_name: business?.name || "Workspace",
    };

    const rendered = renderTemplate(
      { subject: rawSubject, body: rawBody },
      contactContext,
      senderContext,
      { sanitize: true }
    );

    // 5b. Unsubscribe URL Generation & Footer Injection for Campaign Emails
    let finalHtmlBody = rendered.body;
    if (options.campaignId) {
      const token = this.safetyService.generateUnsubscribeToken({
        businessId,
        leadId: lead.id,
        email: normalizedTo,
        campaignId: options.campaignId,
      });
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
      const unsubscribeUrl = `${baseUrl}/unsubscribe?token=${token}`;
      finalHtmlBody = this.safetyService.ensureUnsubscribeLink(
        rendered.body,
        unsubscribeUrl,
        senderContext.business_name || undefined
      );

      // Production safety check: do not allow sending without unsubscribe mechanism
      if (
        process.env.NODE_ENV === "production" &&
        !finalHtmlBody.toLowerCase().includes("unsubscribe")
      ) {
        throw new Error("Missing required unsubscribe mechanism in campaign email.");
      }
    }

    // 5b. Resolve and prepare attachments
    let resolvedAttachments: EmailAttachment[] = options.attachments ? [...options.attachments] : [];
    const attachmentIdsToLoad: string[] = [];

    if (options.attachmentIds && options.attachmentIds.length > 0) {
      attachmentIdsToLoad.push(...options.attachmentIds);
    }

    if (options.campaignStepId) {
      const stepAtts = await this.attachmentService.getStepAttachments(
        options.campaignStepId,
        businessId
      );
      if (stepAtts.length > 0) {
        attachmentIdsToLoad.push(...stepAtts.map((s) => s.id));
      }
    }

    // Automatically inherit attachments from email template if templateId is specified
    if (options.templateId) {
      const templateAtts = await this.attachmentService.getTemplateAttachments(
        options.templateId,
        businessId
      );
      if (templateAtts.length > 0) {
        attachmentIdsToLoad.push(...templateAtts.map((t) => t.id));
      }
    }

    if (attachmentIdsToLoad.length > 0) {
      const loaded = await this.attachmentService.prepareAttachmentsForEmail(
        Array.from(new Set(attachmentIdsToLoad)),
        businessId
      );
      resolvedAttachments = [...resolvedAttachments, ...loaded];
    }

    // 6. Pre-flight create email_messages record in QUEUED status
    const messageInput: CreateEmailMessageInput = {
      business_id: businessId,
      lead_id: lead.id,
      campaign_id: options.campaignId || null,
      campaign_step_id: options.campaignStepId || null,
      template_id: options.templateId || null,
      direction: "outbound",
      from_email: sender.fromEmail,
      to_email: normalizedTo,
      reply_to: sender.replyTo || null,
      subject: rendered.subject,
      body: finalHtmlBody,
      status: "SENDING",
      metadata: {
        ...(options.metadata || {}),
        variables_found: rendered.variablesFound,
        missing_variables: rendered.missingVariables,
        sent_by_user_id: userId,
        attachments: resolvedAttachments.map((a) => ({
          filename: a.filename,
          contentType: a.contentType,
          size: a.size,
        })),
      },
    };

    const emailRecord = await this.messageRepo.create(messageInput);

    // Inject open tracking pixel into outgoing HTML body
    const baseUrl = getAppBaseUrl();
    const trackingPixel = `<img src="${baseUrl}/api/email/open/${emailRecord.id}" width="1" height="1" style="display:none !important;" alt="" />`;
    const finalDispatchedHtml = finalHtmlBody.includes("</body>")
      ? finalHtmlBody.replace("</body>", `${trackingPixel}</body>`)
      : `${finalHtmlBody}${trackingPixel}`;

    // 7. Dispatch via Resolved Provider Adapter
    const sendPayload: SendEmailPayload = {
      to: normalizedTo,
      fromEmail: sender.fromEmail,
      fromName: sender.fromName,
      replyTo: sender.replyTo,
      subject: rendered.subject,
      html: finalDispatchedHtml,
      attachments:
        resolvedAttachments.length > 0
          ? resolvedAttachments.map((a) => ({
              filename: a.filename,
              content: a.content,
              contentType: a.contentType,
            }))
          : undefined,
    };

    const dispatchProvider = await this.resolveProviderForBusiness(businessId);
    const providerResult = await dispatchProvider.sendEmail(sendPayload);

    // 8. Update email_messages record with provider result
    let finalRecord: EmailMessage;

    if (providerResult.success && providerResult.providerMessageId) {
      finalRecord = await this.messageRepo.updateProviderMessageId(
        emailRecord.id,
        providerResult.providerMessageId,
        "SENT"
      );

      // Record successful send against business limits
      await this.safetyService.recordSend(businessId);

      // Create initial SENT audit event
      await this.messageRepo.createEvent({
        business_id: businessId,
        email_message_id: finalRecord.id,
        campaign_id: options.campaignId || null,
        campaign_step_id: options.campaignStepId || null,
        lead_id: lead.id,
        event_type: "SENT",
        provider_event_id: `evt_send_${providerResult.providerMessageId}`,
        metadata: {
          provider: this.provider.name,
          recipient: normalizedTo,
          attachments_count: resolvedAttachments.length,
        },
      });
    } else {
      const errorMeta = {
        ...(emailRecord.metadata || {}),
        error_code: providerResult.error?.code || "PROVIDER_FAILURE",
        error_message: providerResult.error?.message || "Failed to deliver email through provider.",
      };
      finalRecord = await this.messageRepo.updateStatus(emailRecord.id, "FAILED", errorMeta);
    }

    return {
      success: providerResult.success,
      message: finalRecord,
      providerResult,
      renderedSubject: rendered.subject,
      renderedBody: finalHtmlBody,
    };
  }

  /**
   * Dispatches an explicit test email requested by the user from Settings.
   */
  async sendTestEmail(
    businessId: string,
    userId: string,
    input: {
      to: string;
      subject?: string;
      body?: string;
      templateId?: string;
      senderIdentityId?: string;
      attachmentIds?: string[];
    }
  ): Promise<SendEmailResult> {
    const defaultSubject = input.subject?.trim() || "Test Email from Email Automation Platform";
    const defaultBody =
      input.body?.trim() ||
      "<p>Hello {{first_name}},</p><p>This is a verified test email sent from <strong>{{business_name}}</strong> to confirm your email delivery configuration.</p><p>Best regards,<br>{{sender_name}}</p>";

    return this.sendEmail(businessId, userId, {
      to: input.to,
      subject: defaultSubject,
      body: defaultBody,
      templateId: input.templateId,
      senderIdentityId: input.senderIdentityId,
      attachmentIds: input.attachmentIds,
      metadata: { is_test_email: true },
    });
  }

  /**
   * Processes an incoming provider webhook event.
   *
   * 1. Cryptographically verifies signature
   * 2. Enforces idempotency via provider_event_id
   * 3. Finds email_message by provider_message_id
   * 4. Records email_event
   * 5. Updates email_message status (DELIVERED, BOUNCED, COMPLAINED, etc.)
   * 6. Automatically records bounced / complained emails into suppressions table
   */
  async processWebhook(
    rawBody: string | Record<string, unknown>,
    headers: Record<string, string | string[] | undefined> = {},
    secretOverride?: string
  ): Promise<WebhookProcessResult> {
    const safeHeaders = headers || {};
    const bodyStr = typeof rawBody === "string" ? rawBody : JSON.stringify(rawBody);

    // 1. Signature verification
    const isValid = await this.provider.verifyWebhookSignature(bodyStr, safeHeaders, secretOverride);
    if (!isValid) {
      return {
        success: false,
        error: "Invalid webhook signature or unauthenticated request.",
      };
    }

    // 2. Parse normalized event
    let parsedBody: unknown;
    try {
      parsedBody = typeof rawBody === "string" ? JSON.parse(rawBody) : rawBody;
    } catch {
      return {
        success: false,
        error: "Malformed webhook JSON payload.",
      };
    }

    // Early check for inbound customer replies (email.received or direct inbound payload structure)
    const rawType = parsedBody && typeof parsedBody === "object" ? String((parsedBody as Record<string, unknown>).type || "").toLowerCase() : "";
    const parsedObj = parsedBody && typeof parsedBody === "object" ? (parsedBody as Record<string, unknown>) : {};
    const hasFromField = "from" in parsedObj || ("data" in parsedObj && typeof parsedObj.data === "object" && parsedObj.data !== null && "from" in (parsedObj.data as Record<string, unknown>));

    if (rawType === "email.received" || rawType === "received" || (hasFromField && !rawType)) {
      const inboundRes = await replyService.processInboundWebhook(bodyStr, headers, secretOverride);
      return {
        success: inboundRes.success,
        idempotent: inboundRes.idempotent,
        error: inboundRes.error,
        message: null,
      };
    }

    const event = this.provider.parseWebhookEvent(parsedBody, headers);
    if (!event) {
      if (hasFromField) {
        const inboundRes = await replyService.processInboundWebhook(bodyStr, headers, secretOverride);
        return {
          success: inboundRes.success,
          idempotent: inboundRes.idempotent,
          error: inboundRes.error,
          message: null,
        };
      }
      return {
        success: false,
        error: "Could not parse or unrecognized webhook event type.",
      };
    }

    // Check if this event represents an inbound email reply
    if (event.eventType === "RECEIVED") {
      const inboundRes = await replyService.processInboundWebhook(bodyStr, headers, secretOverride);
      return {
        success: inboundRes.success,
        idempotent: inboundRes.idempotent,
        error: inboundRes.error,
        message: null,
      };
    }

    // 3. IDEMPOTENCY CHECK
    // If providerEventId has already been recorded, acknowledge without creating duplicate records
    console.log(
      `[WEBHOOK RECEIVED] eventType=${event.eventType} providerMessageId=${event.providerMessageId} providerEventId=${event.providerEventId}`
    );

    const existingEvent = await this.messageRepo.findEventByProviderEventId(event.providerEventId);
    if (existingEvent) {
      console.log(
        `[EmailWebhook] Idempotent duplicate event skipped: providerEventId=${event.providerEventId}`
      );
      return {
        success: true,
        idempotent: true,
        event: existingEvent,
      };
    }

    // 4. Find matching email_message by provider_message_id
    const message = await this.messageRepo.findByProviderMessageId(event.providerMessageId);
    if (!message) {
      // Event for message not tracked in this platform or from external sender
      console.log(
        `[EmailWebhook] No internal email message found matching providerMessageId=${event.providerMessageId}`
      );
      return {
        success: true,
        message: null,
      };
    }

    // 5. Create email_event record with campaign tracking attributes
    const createdEvent = await this.messageRepo.createEvent({
      business_id: message.business_id,
      email_message_id: message.id,
      campaign_id: message.campaign_id || null,
      campaign_step_id: message.campaign_step_id || null,
      lead_id: message.lead_id || null,
      event_type: event.eventType,
      provider_event_id: event.providerEventId,
      event_timestamp: event.timestamp,
      metadata: {
        raw_event: event.raw,
        reason: event.reason,
      },
    });

    // 6. Update message status based on event type with terminal status protection
    let nextStatus: MessageStatus | null = null;
    const isPermanentBounce = event.isPermanent !== false;
    const currentStatus = (message.status || "").toUpperCase();
    const isTerminalFailure = currentStatus === "BOUNCED" || currentStatus === "COMPLAINED";

    let updatedMessage = message;

    if (event.eventType === "OPENED") {
      // Record real email open event and update message
      updatedMessage = await this.messageRepo.recordOpen(message.id, event.timestamp);
    } else {
      if (event.eventType === "DELIVERED") {
        // Do not allow DELIVERED to overwrite a terminal bounce or complaint
        if (!isTerminalFailure) {
          nextStatus = "DELIVERED";
        }
      } else if (event.eventType === "BOUNCED") {
        nextStatus = isPermanentBounce ? "BOUNCED" : "FAILED";
      } else if (event.eventType === "COMPLAINED") {
        nextStatus = "COMPLAINED";
      } else if (event.eventType === "FAILED") {
        if (!isTerminalFailure && currentStatus !== "DELIVERED" && currentStatus !== "OPENED") {
          nextStatus = "FAILED";
        }
      } else if (event.eventType === "SENT") {
        // An out-of-order SENT event must not revert DELIVERED, OPENED or terminal failure
        if (currentStatus === "QUEUED" || currentStatus === "SENDING" || currentStatus === "DRAFT") {
          nextStatus = "SENT";
        }
      } else if (event.eventType === "DELIVERY_DELAYED") {
        // Keep current status, record delay notice in message metadata
        try {
          await this.messageRepo.updateStatus(message.id, (message.status || "SENT") as MessageStatus, {
            ...(message.metadata || {}),
            delivery_delayed: true,
            delivery_delayed_reason: event.reason || "Provider reported temporary delivery delay",
            latest_event: event.eventType,
            latest_event_id: event.providerEventId,
          });
        } catch {}
      }

      if (nextStatus) {
        const bounceSubtype =
          (event.raw && typeof event.raw === "object"
            ? (event.raw as Record<string, unknown>).data &&
              typeof (event.raw as Record<string, unknown>).data === "object"
              ? ((event.raw as Record<string, unknown>).data as Record<string, unknown>).subtype ||
                ((((event.raw as Record<string, unknown>).data as Record<string, unknown>).bounce as Record<string, unknown>)?.subtype)
              : undefined
            : undefined) || "general";

        updatedMessage = await this.messageRepo.updateStatus(message.id, nextStatus, {
          latest_event: event.eventType,
          latest_event_id: event.providerEventId,
          reason: event.reason,
          bounce_type: event.bounceType,
          bounce_subtype: String(bounceSubtype),
          transient: event.eventType === "BOUNCED" && !isPermanentBounce,
        });
      }
    }

    console.log(
      `[WEBHOOK RECEIVED] eventType=${event.eventType} providerMessageId=${event.providerMessageId} matchedInternalId=${message.id} status=${updatedMessage.status || currentStatus} openCount=${updatedMessage.open_count || (message.open_count || 0)}`
    );

    // 7. AUTO-SUPPRESSION ON HARD BOUNCE OR COMPLAINT & CONTACT STATUS UPDATE
    // Protect business reputation by suppressing recipient and stopping active campaign sequences
    const recipient = event.recipientEmail || message.to_email;
    if (recipient) {
      if (event.eventType === "BOUNCED") {
        if (message.lead_id) {
          try {
            await this.leadRepo.update(message.lead_id, { status: "bounced" });
          } catch {}
        }
        await this.safetyService.handleBounce(
          message.business_id,
          recipient,
          isPermanentBounce,
          event.reason,
          message.lead_id || undefined,
          message.campaign_id || undefined
        );
      } else if (event.eventType === "COMPLAINED") {
        if (message.lead_id) {
          try {
            await this.leadRepo.update(message.lead_id, { status: "unsubscribed" });
          } catch {}
        }
        await this.safetyService.handleComplaint(
          message.business_id,
          recipient,
          event.reason,
          message.lead_id || undefined,
          message.campaign_id || undefined
        );
      }
    }

    return {
      success: true,
      event: createdEvent,
      message: updatedMessage,
    };
  }

  /**
   * Synchronizes email delivery statuses (Delivered, Opened, Bounced, Complained)
   * with the external email provider (Resend).
   *
   * This bridges the gap when running in environments where inbound provider webhooks
   * cannot reach the application directly (such as local development or firewalled networks),
   * and provides a resilient polling fallback for production.
   */
  async syncProviderStatuses(businessId?: string): Promise<{
    synced: number;
    delivered: number;
    opened: number;
    bounced: number;
    complained: number;
  }> {
    const counts = { synced: 0, delivered: 0, opened: 0, bounced: 0, complained: 0 };
    try {
      const activeBusinessId = businessId || "";
      const provider = activeBusinessId
        ? await this.resolveProviderForBusiness(activeBusinessId)
        : this.provider;

      if (!provider || typeof provider.listEmails !== "function") {
        return counts;
      }

      // 1. Fetch recent emails from provider in batch
      const listRes = await provider.listEmails({ limit: 100 });
      const providerEmails = listRes.success && listRes.data ? listRes.data : [];
      const providerMap = new Map<string, { last_event: string; created_at?: string; to?: string[] }>();
      for (const item of providerEmails) {
        if (item.id) {
          providerMap.set(item.id, {
            last_event: String(item.last_event || "").toLowerCase(),
            created_at: item.created_at,
            to: item.to,
          });
        }
      }

      // 2. Retrieve messages from local store or database that have a provider_message_id
      const allMessages = activeBusinessId
        ? await this.messageRepo.listByBusiness(activeBusinessId)
        : (await this.messageRepo.listByBusiness("")).length > 0
        ? await this.messageRepo.listByBusiness("")
        : LocalEmailStore.load().messages;

      // Filter messages that might have status updates: SENT, DELIVERED, WAITING
      const pendingMessages = allMessages.filter(
        (m) =>
          m.provider_message_id &&
          (!m.status || ["SENT", "DELIVERED", "WAITING", "QUEUED"].includes(String(m.status).toUpperCase()))
      );

      for (const msg of pendingMessages) {
        const provId = msg.provider_message_id!;
        let provData = providerMap.get(provId);

        // If not in the batch list, query individually if getEmail is available and provId is a valid UUID
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(provId);
        if (!provData && isUuid && typeof provider.getEmail === "function") {
          const singleRes = await provider.getEmail(provId);
          if (singleRes.success && singleRes.last_event) {
            provData = {
              last_event: String(singleRes.last_event).toLowerCase(),
            };
          }
        }

        if (!provData || !provData.last_event) continue;

        const currentSt = String(msg.status || "").toUpperCase();
        const eventType = provData.last_event;
        const eventTimestamp = provData.created_at || new Date().toISOString();

        if (eventType === "opened" && currentSt !== "OPENED") {
          await this.messageRepo.recordOpen(msg.id, eventTimestamp);
          await this.messageRepo.createEvent({
            business_id: msg.business_id,
            email_message_id: msg.id,
            campaign_id: msg.campaign_id || null,
            campaign_step_id: msg.campaign_step_id || null,
            lead_id: msg.lead_id || null,
            event_type: "OPENED",
            provider_event_id: `sync_evt_open_${provId}`,
            event_timestamp: eventTimestamp,
            metadata: { source: "provider_sync", provider: provider.name },
          });
          counts.opened++;
          counts.synced++;
        } else if (
          (eventType === "delivered" || eventType === "opened") &&
          (currentSt === "SENT" || currentSt === "QUEUED" || currentSt === "WAITING")
        ) {
          await this.messageRepo.updateStatus(msg.id, "DELIVERED", {
            delivered_at: eventTimestamp,
            sync_source: "provider_sync",
          });
          await this.messageRepo.createEvent({
            business_id: msg.business_id,
            email_message_id: msg.id,
            campaign_id: msg.campaign_id || null,
            campaign_step_id: msg.campaign_step_id || null,
            lead_id: msg.lead_id || null,
            event_type: "DELIVERED",
            provider_event_id: `sync_evt_del_${provId}`,
            event_timestamp: eventTimestamp,
            metadata: { source: "provider_sync", provider: provider.name },
          });
          counts.delivered++;
          counts.synced++;
        } else if (eventType === "bounced" && currentSt !== "BOUNCED") {
          await this.messageRepo.updateStatus(msg.id, "BOUNCED", {
            bounce_type: "hard",
            bounce_message: "Bounced by recipient mail provider",
            sync_source: "provider_sync",
          });
          await this.messageRepo.createEvent({
            business_id: msg.business_id,
            email_message_id: msg.id,
            campaign_id: msg.campaign_id || null,
            campaign_step_id: msg.campaign_step_id || null,
            lead_id: msg.lead_id || null,
            event_type: "BOUNCED",
            provider_event_id: `sync_evt_bounce_${provId}`,
            event_timestamp: eventTimestamp,
            metadata: { source: "provider_sync", provider: provider.name },
          });
          if (msg.lead_id) {
            try {
              await this.leadRepo.update(msg.lead_id, { status: "bounced" });
            } catch {}
          }
          await this.safetyService.handleBounce(
            msg.business_id,
            msg.to_email,
            true,
            "Bounced by recipient mail provider",
            msg.lead_id || undefined,
            msg.campaign_id || undefined
          );
          counts.bounced++;
          counts.synced++;
        } else if (eventType === "complained" && currentSt !== "COMPLAINED") {
          await this.messageRepo.updateStatus(msg.id, "COMPLAINED", {
            sync_source: "provider_sync",
          });
          if (msg.lead_id) {
            try {
              await this.leadRepo.update(msg.lead_id, { status: "unsubscribed" });
            } catch {}
          }
          await this.safetyService.handleComplaint(
            msg.business_id,
            msg.to_email,
            "Recipient marked email as spam",
            msg.lead_id || undefined,
            msg.campaign_id || undefined
          );
          counts.complained++;
          counts.synced++;
        }
      }
    } catch (err) {
      console.warn("[EmailService] Provider status sync error:", err instanceof Error ? err.message : err);
    }
    return counts;
  }

  /**
   * Directly records an email open event (triggered by open tracking pixel).
   */
  async recordEmailOpen(messageId: string): Promise<boolean> {
    try {
      const msg =
        (await this.messageRepo.findById(messageId)) ||
        (await this.messageRepo.findByProviderMessageId(messageId));

      if (!msg) return false;

      const now = new Date().toISOString();
      const updated = await this.messageRepo.recordOpen(msg.id, now);

      console.log(
        `[OpenTracking] Tracking pixel open recorded: messageId=${msg.id}, providerMessageId=${msg.provider_message_id || "none"}, openCountBefore=${msg.open_count || 0}, openCountAfter=${updated.open_count || (msg.open_count || 0) + 1}`
      );

      await this.messageRepo.createEvent({
        business_id: msg.business_id,
        email_message_id: msg.id,
        campaign_id: msg.campaign_id || null,
        campaign_step_id: msg.campaign_step_id || null,
        lead_id: msg.lead_id || null,
        event_type: "OPENED",
        provider_event_id: `pixel_open_${msg.id}_${Date.now()}`,
        event_timestamp: now,
        metadata: { source: "tracking_pixel" },
      });

      return true;
    } catch (err) {
      console.warn("[EmailService] Failed to record open pixel event:", err);
      return false;
    }
  }
}

export const emailService = new EmailService();
