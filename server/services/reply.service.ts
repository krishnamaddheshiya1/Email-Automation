import crypto from "crypto";
import {
  ConversationRepository,
  LeadRepository,
  EmailMessageRepository,
  CampaignRepository,
  SenderIdentityRepository,
  BusinessRepository,
  SafetyAuditRepository,
  AttachmentRepository,
} from "@/server/repositories";
import {
  EmailProvider,
  InboundEmailProvider,
} from "@/server/providers/email/email-provider.interface";
import { ResendEmailProvider } from "@/server/providers/email/resend.provider";
import { emailService } from "./email.service";
import {
  Conversation,
  ConversationMessage,
  ConversationDetail,
  ConversationListParams,
  ConversationListResult,
} from "@/types/database";

export interface InboundProcessResult {
  success: boolean;
  idempotent?: boolean;
  conversation?: Conversation;
  message?: ConversationMessage;
  error?: string;
}

export class ReplyService {
  private conversationRepo: ConversationRepository;
  private leadRepo: LeadRepository;
  private messageRepo: EmailMessageRepository;
  private campaignRepo: CampaignRepository;
  private senderRepo: SenderIdentityRepository;
  private businessRepo: BusinessRepository;
  private auditRepo: SafetyAuditRepository;
  private attachmentRepo: AttachmentRepository;
  private provider: EmailProvider & InboundEmailProvider;

  constructor(dependencies?: {
    conversationRepo?: ConversationRepository;
    leadRepo?: LeadRepository;
    messageRepo?: EmailMessageRepository;
    campaignRepo?: CampaignRepository;
    senderRepo?: SenderIdentityRepository;
    businessRepo?: BusinessRepository;
    auditRepo?: SafetyAuditRepository;
    attachmentRepo?: AttachmentRepository;
    provider?: EmailProvider & InboundEmailProvider;
  }) {
    this.conversationRepo = dependencies?.conversationRepo || new ConversationRepository();
    this.leadRepo = dependencies?.leadRepo || new LeadRepository();
    this.messageRepo = dependencies?.messageRepo || new EmailMessageRepository();
    this.campaignRepo = dependencies?.campaignRepo || new CampaignRepository();
    this.senderRepo = dependencies?.senderRepo || new SenderIdentityRepository();
    this.businessRepo = dependencies?.businessRepo || new BusinessRepository();
    this.auditRepo = dependencies?.auditRepo || new SafetyAuditRepository();
    this.attachmentRepo = dependencies?.attachmentRepo || new AttachmentRepository();
    this.provider = dependencies?.provider || (new ResendEmailProvider() as EmailProvider & InboundEmailProvider);
  }

  setProvider(provider: EmailProvider & InboundEmailProvider): void {
    this.provider = provider;
  }

  getProvider(): EmailProvider & InboundEmailProvider {
    return this.provider;
  }

  /**
   * Processes an incoming webhook containing an inbound customer reply.
   *
   * 1. Cryptographically verifies webhook authenticity
   * 2. Parses and normalizes inbound email payload
   * 3. Enforces idempotency via provider_message_id
   * 4. Identifies the destination business/tenant securely
   * 5. Performs contact matching (creates unknown sender if new)
   * 6. Performs campaign association (In-Reply-To, References, or fallback)
   * 7. Threads into conversation (creates new or appends to existing)
   * 8. Records delivery analytics and safety audit events
   */
  async processInboundWebhook(
    rawBody: string,
    headers: Record<string, string | string[] | undefined>,
    secretOverride?: string
  ): Promise<InboundProcessResult> {
    // 1. Authenticate webhook
    const isValid = await this.provider.verifyWebhook(rawBody, headers, secretOverride);
    if (!isValid) {
      return {
        success: false,
        error: "Invalid webhook signature or unauthenticated inbound request.",
      };
    }

    // 2. Parse payload
    let parsedBody: unknown;
    try {
      parsedBody = typeof rawBody === "string" ? JSON.parse(rawBody) : rawBody;
    } catch {
      return {
        success: false,
        error: "Malformed inbound webhook JSON payload.",
      };
    }

    const inbound = this.provider.parseInboundEmail(parsedBody, headers);
    if (!inbound) {
      return {
        success: false,
        error: "Could not parse inbound email payload.",
      };
    }

    const normalized = this.provider.normalizeMessage(inbound);
    const { email: senderEmail, name: senderName } = this.provider.identifySender(normalized);

    // If body text/html is empty or headers are needed and provider supports fetching received email, fetch it
    if (
      typeof this.provider.fetchReceivedEmail === "function" &&
      normalized.provider_message_id &&
      (!normalized.body_text || normalized.body_text.trim().length === 0 || !normalized.in_reply_to)
    ) {
      try {
        const fetched = await this.provider.fetchReceivedEmail(normalized.provider_message_id);
        if (fetched) {
          if (fetched.text && (!normalized.body_text || normalized.body_text.trim().length === 0)) {
            normalized.body_text = fetched.text;
          }
          if (fetched.html && (!normalized.body_html || normalized.body_html.trim().length === 0)) {
            normalized.body_html = fetched.html;
          }
          if (fetched.inReplyTo && !normalized.in_reply_to) {
            normalized.in_reply_to = fetched.inReplyTo;
          }
          if (fetched.references && !normalized.references) {
            normalized.references = fetched.references;
          }
          if (fetched.headers) {
            normalized.headers = { ...(normalized.headers || {}), ...fetched.headers };
            if (!normalized.in_reply_to && fetched.headers["in-reply-to"]) {
              normalized.in_reply_to = fetched.headers["in-reply-to"];
            }
            if (!normalized.references && fetched.headers["references"]) {
              normalized.references = fetched.headers["references"];
            }
          }
          if (fetched.attachments && fetched.attachments.length > 0 && (!normalized.attachments || normalized.attachments.length === 0)) {
            normalized.attachments = fetched.attachments;
          }
          if (fetched.subject && (!normalized.subject || normalized.subject === "No Subject")) {
            normalized.subject = fetched.subject;
          }
        }
      } catch (err) {
        console.warn("[ReplyService] Failed to fetch full received email content:", err);
      }
    }

    // 3. IDEMPOTENCY CHECK
    // If this provider message ID was already processed, acknowledge without duplicating
    if (normalized.provider_message_id) {
      const existingMsg = await this.conversationRepo.findMessageByProviderId(
        normalized.provider_message_id
      );
      if (existingMsg) {
        const existingConvo = await this.conversationRepo.findConversationById(
          existingMsg.conversation_id,
          existingMsg.business_id
        );
        return {
          success: true,
          idempotent: true,
          conversation: existingConvo || undefined,
          message: existingMsg,
        };
      }
    }

    // 4. IDENTIFY BUSINESS / TENANT
    let businessId: string | null = null;
    let originalMessage: Awaited<ReturnType<typeof this.messageRepo.findByProviderMessageId>> = null;
    let referencedConversationId: string | null = null;
    let campaignId: string | null = null;
    let campaignStepId: string | null = null;

    const isUuid = (val: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);

    const findMessageByRef = async (refStr: string) => {
      const clean = refStr.replace(/[<>]/g, "").trim();
      if (!clean) return null;

      // Check conversation_messages first for existing conversation thread continuity
      try {
        const convoMsg = await this.conversationRepo.findMessageByProviderId(clean);
        if (convoMsg) {
          referencedConversationId = convoMsg.conversation_id;
          if (!businessId) businessId = convoMsg.business_id;
          const parentConvo = await this.conversationRepo.findConversationById(convoMsg.conversation_id, convoMsg.business_id);
          if (parentConvo?.campaign_id) {
            campaignId = parentConvo.campaign_id;
          }
        }
      } catch {}

      // Check email_messages
      let msg = await this.messageRepo.findByProviderMessageId(clean);
      if (msg) return msg;

      const stripped = clean.replace(/@.*$/, "").trim();
      if (stripped && stripped !== clean) {
        try {
          const convoMsgStripped = await this.conversationRepo.findMessageByProviderId(stripped);
          if (convoMsgStripped) {
            referencedConversationId = convoMsgStripped.conversation_id;
            if (!businessId) businessId = convoMsgStripped.business_id;
            const parentConvo = await this.conversationRepo.findConversationById(convoMsgStripped.conversation_id, convoMsgStripped.business_id);
            if (parentConvo?.campaign_id) {
              campaignId = parentConvo.campaign_id;
            }
          }
        } catch {}

        msg = await this.messageRepo.findByProviderMessageId(stripped);
        if (msg) return msg;
      }

      if (isUuid(clean)) {
        msg = await this.messageRepo.findById(clean);
        if (msg) return msg;
      }
      if (isUuid(stripped)) {
        msg = await this.messageRepo.findById(stripped);
        if (msg) return msg;
      }
      return null;
    };

    // 4a. Check In-Reply-To header
    if (normalized.in_reply_to) {
      originalMessage = await findMessageByRef(normalized.in_reply_to);
      if (originalMessage) {
        businessId = originalMessage.business_id;
      }
    }

    // 4b. Check References header if not found
    if ((!businessId || !originalMessage) && normalized.references) {
      const refList = Array.isArray(normalized.references)
        ? normalized.references
        : String(normalized.references).split(/\s+/);

      for (const ref of refList) {
        const matched = await findMessageByRef(ref);
        if (matched) {
          originalMessage = matched;
          businessId = matched.business_id;
          break;
        }
      }
    }

    console.log(
      `[ReplyWebhook] Inbound webhook received: sender=${senderEmail}, recipient=${normalized.recipient_email}, providerMessageId=${normalized.provider_message_id}, inReplyTo=${normalized.in_reply_to || "none"}, references=${Array.isArray(normalized.references) ? normalized.references.join(", ") : normalized.references || "none"}`
    );

    // 4c. Check if sender email was sent an outbound message recently (database-first)
    if (!originalMessage && senderEmail) {
      try {
        const recentOutbound = await this.messageRepo.findRecentByRecipientEmail(senderEmail, businessId || undefined);
        if (recentOutbound) {
          originalMessage = recentOutbound;
          if (!businessId) businessId = recentOutbound.business_id;
        }
      } catch (err) {
        console.warn("[ReplyService] Error matching recent outbound message:", err);
      }
    }

    // 4d. Check if sender email exists in leads (database-first)
    if (!businessId && senderEmail) {
      try {
        const lead = await this.leadRepo.findByEmailGlobal(senderEmail);
        if (lead) {
          businessId = lead.business_id;
        }
      } catch (err) {
        console.warn("[ReplyService] Error matching lead by email:", err);
      }
    }

    // 4e. Check recipient email against configured Sender Identities across all businesses
    if (!businessId && normalized.recipient_email) {
      const recipientNorm = normalized.recipient_email.toLowerCase();
      try {
        const allBusinesses = await this.businessRepo.findAll();
        for (const b of allBusinesses) {
          const senders = await this.senderRepo.listByBusinessId(b.id);
          const matched = senders.find(
            (s) =>
              s.from_email.toLowerCase() === recipientNorm ||
              (s.reply_to_email && s.reply_to_email.toLowerCase() === recipientNorm)
          );
          if (matched) {
            businessId = b.id;
            break;
          }
        }
      } catch {}
    }

    // 4f. Fallback: Check if recipient matches business settings
    if (!businessId && normalized.recipient_email) {
      const recipientNorm = normalized.recipient_email.toLowerCase();
      try {
        const allBusinesses = await this.businessRepo.findAll();
        const matchedBiz = allBusinesses.find((b) => {
          const settings = (b.settings || {}) as Record<string, unknown>;
          const emailConfig = (settings.email_sender || {}) as Record<string, string>;
          return (
            emailConfig.from_email?.toLowerCase() === recipientNorm ||
            emailConfig.reply_to?.toLowerCase() === recipientNorm
          );
        });
        if (matchedBiz) {
          businessId = matchedBiz.id;
        }
      } catch {}
    }

    // 4g. Single tenant environment fallback
    if (!businessId) {
      try {
        const allBusinesses = await this.businessRepo.findAll();
        if (allBusinesses.length === 1) {
          businessId = allBusinesses[0].id;
        }
      } catch {}
    }

    // 4h. If STILL unidentified, safe rejection & audit log
    if (!businessId) {
      try {
        const allBusinesses = await this.businessRepo.findAll();
        const fallbackBizId = allBusinesses[0]?.id;
        if (fallbackBizId) {
          await this.auditRepo.createLog({
            business_id: fallbackBizId,
            event_type: "security_violation",
            recipient_email: normalized.recipient_email,
            reason: "Inbound email received without verifiable tenant destination",
            metadata: {
              sender_email: senderEmail,
              subject: normalized.subject,
              provider_message_id: normalized.provider_message_id,
            },
          });
        }
      } catch {}

      return {
        success: false,
        error: "Unidentified tenant destination for inbound email.",
      };
    }

    // 5. CONTACT MATCHING
    let contact = await this.leadRepo.findByEmail(businessId, senderEmail);

    if (contact) {
      // Update contact status to replied
      try {
        await this.leadRepo.update(contact.id, { status: "replied" });
      } catch {}
    } else {
      // Create unknown sender contact in this tenant
      const firstName = senderName || "Unknown";
      const lastName = senderName ? "" : "Sender";
      contact = await this.leadRepo.create({
        business_id: businessId,
        first_name: firstName,
        last_name: lastName,
        email: senderEmail,
        status: "replied",
        source: "inbound_reply",
        lead_score: 50,
        phone: null,
        company_name: null,
        job_title: null,
        industry: null,
        website: null,
        owner_user_id: null,
        metadata: {
          created_via: "inbound_reply",
          inbound_subject: normalized.subject,
        },
      });
    }

    // 6. CAMPAIGN MATCHING
    if (!campaignId) {
      if (originalMessage?.campaign_id) {
        campaignId = originalMessage.campaign_id;
        campaignStepId = originalMessage.campaign_step_id || null;
      } else {
        // Fallback matching: check if contact is in an active or recent campaign
        try {
          const enrollments = await this.campaignRepo.findEnrollmentsByLead(contact.id, businessId);
          const activeEnrollments = enrollments.filter((e) =>
            ["ENROLLED", "RUNNING"].includes(e.status.toUpperCase())
          );
          if (activeEnrollments.length > 0) {
            campaignId = activeEnrollments[0].campaign_id;
          } else if (enrollments.length > 0) {
            campaignId = enrollments[0].campaign_id;
          }
        } catch {}

        if (!campaignId) {
          const campaigns = await this.campaignRepo.findByBusinessId(businessId);
          const activeCampaigns = campaigns.filter((c) => String(c.status).toUpperCase() === "ACTIVE");
          if (activeCampaigns.length === 1) {
            // Single active campaign in business
            campaignId = activeCampaigns[0].id;
          }
        }
      }
    } else if (originalMessage?.campaign_step_id) {
      campaignStepId = originalMessage.campaign_step_id;
    }

    const receivedAt = normalized.received_at || new Date().toISOString();

    // 6b. STOP CAMPAIGN FOLLOW-UPS ON CUSTOMER REPLY
    // When a customer replies, any active campaign enrollment must immediately halt with status REPLIED.
    try {
      await this.campaignRepo.stopEnrollmentsOnReply(
        businessId,
        contact.id,
        receivedAt,
        campaignId
      );
    } catch (stopErr) {
      console.warn("[ReplyService] Failed to stop enrollments on reply:", stopErr);
    }

    // 7. CONVERSATION THREADING
    // Prefer directly referenced conversation thread if matched from prior message
    let conversation: Conversation | null = null;
    if (referencedConversationId) {
      conversation = await this.conversationRepo.findConversationById(referencedConversationId, businessId);
    }

    if (!conversation) {
      conversation = await this.conversationRepo.findConversationByContact(
        businessId,
        contact.id,
        campaignId
      );
    }

    // If still not found and campaignId is present, check if there's an existing conversation without campaign
    if (!conversation && campaignId) {
      conversation = await this.conversationRepo.findConversationByContact(
        businessId,
        contact.id,
        null
      );
    }

    if (conversation) {
      // If conversation existed without campaign_id but we now resolved one, associate it
      if (!conversation.campaign_id && campaignId) {
        await this.conversationRepo.updateConversation(conversation.id, businessId, {
          campaign_id: campaignId,
        });
      }

      conversation = await this.conversationRepo.recordInboundActivity(
        conversation.id,
        businessId,
        receivedAt
      );
    } else {
      conversation = await this.conversationRepo.createConversation({
        business_id: businessId,
        lead_id: contact.id,
        campaign_id: campaignId,
        subject: normalized.subject || "No Subject",
        status: "active",
        unread_count: 1,
        last_message_at: receivedAt,
      });
    }

    if (!conversation) {
      return {
        success: false,
        error: "Failed to create or update conversation thread.",
      };
    }

    // 8. RECORD INBOUND MESSAGE
    const createdMessage = await this.conversationRepo.createMessage({
      conversation_id: conversation.id,
      business_id: businessId,
      direction: "INBOUND",
      sender_email: senderEmail,
      recipient_email: normalized.recipient_email,
      subject: normalized.subject || "No Subject",
      body_text: normalized.body_text,
      body_html: normalized.body_html,
      provider_message_id: normalized.provider_message_id,
      in_reply_to: normalized.in_reply_to,
      received_at: receivedAt,
      attachments: normalized.attachments,
    });

    console.log(
      `[ReplyWebhook] Inbound message created: id=${createdMessage.id}, conversationId=${conversation.id}, matchedContactId=${contact.id}, unreadCount=${conversation.unread_count}`
    );

    // 9. RECORD EMAIL EVENT FOR CAMPAIGN / RECIPIENT ANALYTICS
    try {
      await this.messageRepo.createEvent({
        business_id: businessId,
        email_message_id: originalMessage?.id || null,
        campaign_id: campaignId,
        campaign_step_id: campaignStepId,
        lead_id: contact.id,
        event_type: "replied",
        provider_event_id: normalized.provider_message_id,
        event_timestamp: receivedAt,
        metadata: {
          conversation_id: conversation.id,
          conversation_message_id: createdMessage.id,
          sender_email: senderEmail,
          subject: normalized.subject,
        },
      });
    } catch {}

    // 10. RECORD SAFETY AUDIT LOG
    await this.auditRepo.createLog({
      business_id: businessId,
      event_type: "webhook_received",
      recipient_email: senderEmail,
      lead_id: contact.id,
      campaign_id: campaignId,
      reason: "Inbound email reply recorded into inbox",
      metadata: {
        conversation_id: conversation.id,
        conversation_message_id: createdMessage.id,
        subject: normalized.subject,
      },
    });

    return {
      success: true,
      conversation,
      message: createdMessage,
    };
  }

  /**
   * Records an inbound customer reply directly for a tenant.
   * Useful for internal relay, webhook forwarders, and client simulation.
   */
  async recordCustomerReply(
    businessId: string,
    input: {
      fromEmail: string;
      fromName?: string;
      subject: string;
      body: string;
      htmlBody?: string;
      campaignId?: string;
      inReplyTo?: string;
      recipientEmail?: string;
    }
  ): Promise<InboundProcessResult> {
    const senderEmail = input.fromEmail.trim().toLowerCase();
    const senderName = input.fromName?.trim() || senderEmail.split("@")[0];
    const subject = input.subject?.trim() || "No Subject";
    const bodyText = input.body || "";
    const bodyHtml = input.htmlBody || `<p>${bodyText}</p>`;
    const receivedAt = new Date().toISOString();
    const providerMessageId = `sim_reply_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;

    // 1. Contact matching
    let contact = await this.leadRepo.findByEmail(businessId, senderEmail);
    if (contact) {
      try {
        await this.leadRepo.update(contact.id, { status: "replied" });
      } catch {}
    } else {
      contact = await this.leadRepo.create({
        business_id: businessId,
        first_name: senderName,
        last_name: "",
        email: senderEmail,
        status: "replied",
        source: "inbound_reply",
        lead_score: 50,
        phone: null,
        company_name: null,
        job_title: null,
        industry: null,
        website: null,
        owner_user_id: null,
        metadata: { created_via: "direct_reply", inbound_subject: subject },
      });
    }

    // 2. Campaign matching
    let campaignId = input.campaignId || null;
    let campaignStepId: string | null = null;
    let originalMessage: Awaited<ReturnType<typeof this.messageRepo.findByProviderMessageId>> = null;

    if (input.inReplyTo) {
      originalMessage = await this.messageRepo.findByProviderMessageId(input.inReplyTo);
      if (originalMessage?.campaign_id) {
        campaignId = originalMessage.campaign_id;
        campaignStepId = originalMessage.campaign_step_id || null;
      }
    }

    if (!campaignId) {
      try {
        const enrollments = await this.campaignRepo.findEnrollmentsByLead(contact.id, businessId);
        if (enrollments.length > 0) {
          campaignId = enrollments[0].campaign_id;
        }
      } catch {}
    }

    // 3. Stop campaign follow-ups on customer reply
    try {
      await this.campaignRepo.stopEnrollmentsOnReply(
        businessId,
        contact.id,
        receivedAt,
        campaignId
      );
    } catch {}

    // 4. Conversation threading
    let conversation = await this.conversationRepo.findConversationByContact(
      businessId,
      contact.id,
      campaignId
    );

    if (conversation) {
      conversation = await this.conversationRepo.recordInboundActivity(
        conversation.id,
        businessId,
        receivedAt
      );
    } else {
      conversation = await this.conversationRepo.createConversation({
        business_id: businessId,
        lead_id: contact.id,
        campaign_id: campaignId,
        subject,
        status: "active",
        unread_count: 1,
        last_message_at: receivedAt,
      });
    }

    if (!conversation) {
      return { success: false, error: "Failed to create conversation thread." };
    }

    // 5. Record inbound message
    const createdMessage = await this.conversationRepo.createMessage({
      conversation_id: conversation.id,
      business_id: businessId,
      direction: "INBOUND",
      sender_email: senderEmail,
      recipient_email: input.recipientEmail || "contact@opsiys.in",
      subject,
      body_text: bodyText,
      body_html: bodyHtml,
      provider_message_id: providerMessageId,
      in_reply_to: input.inReplyTo || null,
      received_at: receivedAt,
    });

    // 6. Record email event
    try {
      await this.messageRepo.createEvent({
        business_id: businessId,
        email_message_id: originalMessage?.id || null,
        campaign_id: campaignId,
        campaign_step_id: campaignStepId,
        lead_id: contact.id,
        event_type: "replied",
        provider_event_id: providerMessageId,
        event_timestamp: receivedAt,
        metadata: {
          conversation_id: conversation.id,
          conversation_message_id: createdMessage.id,
          sender_email: senderEmail,
          subject,
        },
      });
    } catch {}

    return {
      success: true,
      conversation,
      message: createdMessage,
    };
  }

  /**
   * Retrieves paginated conversations for a business with search and filtering.
   */
  async listConversations(params: ConversationListParams): Promise<ConversationListResult> {
    if (!params.businessId) {
      throw new Error("Business ID is required for multi-tenant isolation.");
    }
    return this.conversationRepo.listConversations(params);
  }

  /**
   * Calculates high-level reply and conversation metrics for a business.
   */
  async getReplyMetrics(businessId: string): Promise<{
    inboundReplies: number;
    activeThreads: number;
    sequencesHalted: number;
    unreadCount: number;
  }> {
    if (!businessId) {
      throw new Error("Business ID is required for metrics calculation.");
    }

    let activeThreads = 0;
    let unreadCount = 0;
    let inboundReplies = 0;
    let sequencesHalted = 0;

    try {
      const convList = await this.conversationRepo.listConversations({
        businessId,
        limit: 1,
      });
      activeThreads = convList.total;
      unreadCount = convList.unread_total;
    } catch (err) {
      console.warn("[ReplyService] Failed to list conversations for metrics:", err);
    }

    try {
      inboundReplies = await this.conversationRepo.countInboundMessages(businessId);
    } catch (err) {
      console.warn("[ReplyService] Failed to count inbound messages:", err);
    }

    try {
      sequencesHalted = await this.campaignRepo.countRepliedLeads(businessId);
    } catch (err) {
      console.warn("[ReplyService] Failed to count halted sequences:", err);
    }

    return {
      inboundReplies: Math.max(inboundReplies, activeThreads),
      activeThreads,
      sequencesHalted,
      unreadCount,
    };
  }

  /**
   * Retrieves conversation detail and threaded messages for a business.
   */
  async getConversationDetail(
    conversationId: string,
    businessId: string
  ): Promise<ConversationDetail | null> {
    if (!conversationId || !businessId) {
      throw new Error("Conversation ID and Business ID are required.");
    }

    const convo = await this.conversationRepo.findConversationById(conversationId, businessId);
    if (!convo) return null;

    const contact = await this.leadRepo.findByIdAndBusinessId(convo.lead_id, businessId);
    const campaign = convo.campaign_id
      ? await this.campaignRepo.findByIdAndBusinessId(convo.campaign_id, businessId)
      : null;
    const messages = await this.conversationRepo.listMessagesForConversation(
      conversationId,
      businessId
    );

    const contactName = contact
      ? `${contact.first_name || ""} ${contact.last_name || ""}`.trim() || contact.email
      : "Unknown Contact";
    const contactEmail = contact ? contact.email : "";

    const hasAttachments = messages.some((m) => m.attachments && m.attachments.length > 0);
    const latestMessage = messages[messages.length - 1];
    const snippet = (latestMessage?.body_text || latestMessage?.subject || convo.subject).slice(0, 150);

    return {
      ...convo,
      contact_id: convo.lead_id,
      contact_name: contactName,
      contact_email: contactEmail,
      campaign_name: campaign ? campaign.name : null,
      has_attachments: hasAttachments,
      snippet,
      messages,
    };
  }

  /**
   * Marks a conversation as read.
   */
  async markAsRead(conversationId: string, businessId: string): Promise<Conversation | null> {
    return this.conversationRepo.markAsRead(conversationId, businessId);
  }

  /**
   * Marks a conversation as unread.
   */
  async markAsUnread(conversationId: string, businessId: string): Promise<Conversation | null> {
    return this.conversationRepo.markAsUnread(conversationId, businessId);
  }

  /**
   * Sends an outbound reply to an active conversation thread.
   */
  async sendReply(
    conversationId: string,
    businessId: string,
    userId: string,
    input: {
      body: string;
      subject?: string;
      attachmentIds?: string[];
    }
  ): Promise<{ message: ConversationMessage; conversation: Conversation }> {
    if (!businessId) {
      throw new Error("Business ID is required for multi-tenant isolation.");
    }
    if (!conversationId) {
      throw new Error("Conversation ID is required.");
    }

    const conversation = await this.conversationRepo.findConversationById(
      conversationId,
      businessId
    );
    if (!conversation) {
      throw new Error("Conversation not found or unauthorized.");
    }

    const contact = await this.leadRepo.findByIdAndBusinessId(conversation.lead_id, businessId);
    if (!contact) {
      throw new Error("Contact associated with conversation not found.");
    }

    const replySubject =
      input.subject?.trim() ||
      (conversation.subject.startsWith("Re:")
        ? conversation.subject
        : `Re: ${conversation.subject}`);

    const replyBody = input.body?.trim();
    if (!replyBody) {
      throw new Error("Reply message body cannot be empty.");
    }

    // Dispatch via emailService
    const sendResult = await emailService.sendEmail(businessId, userId, {
      to: contact.email,
      leadId: contact.id,
      campaignId: conversation.campaign_id || undefined,
      subject: replySubject,
      body: replyBody,
      attachmentIds: input.attachmentIds,
      metadata: {
        is_reply: true,
        conversation_id: conversation.id,
      },
    });

    if (!sendResult.success) {
      throw new Error(
        sendResult.providerResult?.error?.message || "Failed to dispatch email reply through provider."
      );
    }

    // Resolve attachment metadata for conversation message display
    const msgAttachments: Array<{
      id: string;
      filename: string;
      contentType: string;
      file_size?: number;
    }> = [];
    if (input.attachmentIds && input.attachmentIds.length > 0) {
      for (const attId of input.attachmentIds) {
        const att = await this.attachmentRepo.findByIdAndBusinessId(attId, businessId);
        if (att) {
          msgAttachments.push({
            id: att.id,
            filename: att.filename,
            contentType: att.mime_type,
            file_size: att.file_size,
          });
        }
      }
    }

    const now = new Date().toISOString();
    const createdMessage = await this.conversationRepo.createMessage({
      conversation_id: conversation.id,
      business_id: businessId,
      direction: "OUTBOUND",
      sender_email: sendResult.message.from_email,
      recipient_email: contact.email,
      subject: replySubject,
      body_text: replyBody,
      body_html: `<p>${replyBody.replace(/\n/g, "<br/>")}</p>`,
      provider_message_id: sendResult.message.provider_message_id || null,
      in_reply_to: null,
      received_at: now,
      read_at: now,
      attachments: msgAttachments,
    });

    // Update conversation timestamp, status and mark as read
    const updatedConvo = await this.conversationRepo.updateConversation(conversation.id, businessId, {
      last_message_at: now,
      status: "active",
      unread_count: 0,
    });

    await this.conversationRepo.markAsRead(conversation.id, businessId);

    return {
      message: createdMessage,
      conversation: updatedConvo || conversation,
    };
  }
}

export const replyService = new ReplyService();
