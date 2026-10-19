import crypto from "crypto";
import {
  EmailProvider,
  InboundEmailProvider,
  SendEmailPayload,
  EmailSendResult,
  NormalizedWebhookEvent,
  WebhookNormalizedEventType,
  NormalizedInboundEmail,
  InboundEmailAttachment,
} from "./email-provider.interface";

export interface MockProviderOptions {
  shouldFail?: boolean;
  errorCode?: string;
  errorMessage?: string;
  customMessageId?: string;
  webhookSecret?: string;
}

/**
 * Mock Email Provider for unit and integration testing.
 *
 * Simulates real provider interactions, tracks dispatches in-memory,
 * and eliminates the need for live network calls or paid external services in tests.
 */
export class MockEmailProvider implements EmailProvider, InboundEmailProvider {
  readonly name = "mock";
  public sentEmails: SendEmailPayload[] = [];
  public shouldFail: boolean;
  public errorCode: string;
  public errorMessage: string;
  public customMessageId?: string;
  public webhookSecret: string;

  constructor(options: MockProviderOptions = {}) {
    this.shouldFail = options.shouldFail || false;
    this.errorCode = options.errorCode || "MOCK_TRANSPORT_ERROR";
    this.errorMessage = options.errorMessage || "Simulated mock provider failure.";
    this.customMessageId = options.customMessageId;
    this.webhookSecret = options.webhookSecret || "mock_webhook_secret_key";
  }

  async sendEmail(payload: SendEmailPayload): Promise<EmailSendResult> {
    this.sentEmails.push(payload);

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

    const providerMessageId =
      this.customMessageId || `mock_msg_${crypto.randomUUID()}`;

    return {
      success: true,
      providerMessageId,
      status: "SENT",
    };
  }

  async getEmail(emailId: string): Promise<{
    success: boolean;
    last_event?: string;
    data?: Record<string, unknown>;
    error?: string;
  }> {
    return {
      success: true,
      last_event: "delivered",
      data: { id: emailId, last_event: "delivered" },
    };
  }

  async listEmails(): Promise<{
    success: boolean;
    data?: Array<{ id: string; to: string[]; subject: string; last_event: string; created_at: string }>;
    error?: string;
  }> {
    return {
      success: true,
      data: [],
    };
  }

  async verifyWebhookSignature(
    rawBody: string,
    headers: Record<string, string | string[] | undefined>,
    secretOverride?: string
  ): Promise<boolean> {
    if (!headers || Object.keys(headers).length === 0) return true;
    const secret = secretOverride || this.webhookSecret;
    const authHeader = headers["authorization"] || headers["x-webhook-secret"] || headers["x-signature"];
    const sigStr = Array.isArray(authHeader) ? authHeader[0] : authHeader;

    if (sigStr && (sigStr === secret || sigStr === `Bearer ${secret}`)) {
      return true;
    }

    // Direct HMAC check if signature provided
    const directSig = headers["resend-signature"] || headers["x-resend-signature"] || headers["svix-signature"];
    if (directSig && secret) {
      const computed = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
      const clean = String(directSig).replace(/^sha256=/, "").replace(/^v1,/, "");
      if (clean === computed) return true;
    }

    // Explicit test flag in rawBody
    if (rawBody.includes('"__test_valid_signature__":true')) {
      return true;
    }

    return false;
  }

  parseWebhookEvent(body: unknown): NormalizedWebhookEvent | null {
    if (!body || typeof body !== "object") return null;

    const b = body as Record<string, unknown>;
    const rawType = String(b.type || b.event_type || "").toUpperCase();
    const data = (b.data && typeof b.data === "object" ? b.data : {}) as Record<string, unknown>;

    let eventType: WebhookNormalizedEventType = "SENT";
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

    const providerEventId = String(
      b.id || data.event_id || b.provider_event_id || `mock_evt_${crypto.randomUUID()}`
    );

    let reason: string | undefined;
    let bounceType: string | undefined;
    let isPermanent = true;

    const bounceObj = (data.bounce || b.bounce) as Record<string, unknown> | undefined;
    if (bounceObj && typeof bounceObj === "object") {
      bounceType = String(bounceObj.type || bounceObj.bounceType || "");
      reason = String(bounceObj.message || bounceObj.reason || bounceType);
      if (
        bounceType.toLowerCase() === "transient" ||
        reason.toLowerCase().includes("transient") ||
        reason.toLowerCase().includes("temporary") ||
        reason.toLowerCase().includes("soft")
      ) {
        isPermanent = false;
      }
    } else if (data.bounce_type || b.bounce_type) {
      bounceType = String(data.bounce_type || b.bounce_type);
      reason = String(data.reason || b.reason || bounceType);
      if (
        bounceType.toLowerCase() === "transient" ||
        reason.toLowerCase().includes("transient") ||
        reason.toLowerCase().includes("soft")
      ) {
        isPermanent = false;
      }
    }

    const recipientEmail = Array.isArray(data.to)
      ? String(data.to[0])
      : typeof data.to === "string"
      ? data.to
      : typeof b.recipient === "string"
      ? b.recipient
      : undefined;

    return {
      providerEventId,
      providerMessageId,
      eventType,
      recipientEmail,
      timestamp: new Date().toISOString(),
      reason,
      bounceType,
      isPermanent,
      raw: b,
    };
  }

  async verifyWebhook(
    rawBody: string,
    headers: Record<string, string | string[] | undefined>,
    secret?: string
  ): Promise<boolean> {
    return this.verifyWebhookSignature(rawBody, headers, secret);
  }

  parseInboundEmail(
    body: unknown,
    headers?: Record<string, string | string[] | undefined>
  ): NormalizedInboundEmail | null {
    if (!body || typeof body !== "object") return null;
    const b = body as Record<string, unknown>;
    const data = (b.data && typeof b.data === "object" ? b.data : b) as Record<string, unknown>;

    // Extract sender
    let senderEmail = "";
    let senderName: string | undefined;
    const rawFrom = String(data.from || data.sender || data.from_email || b.from || "");
    const match = rawFrom.match(/^(.*?)\s*<([^>]+)>$/);
    if (match) {
      senderName = match[1].replace(/^["']|["']$/g, "").trim() || undefined;
      senderEmail = match[2].trim().toLowerCase();
    } else {
      senderEmail = rawFrom.trim().toLowerCase();
    }

    if (!senderEmail) return null;

    // Extract recipient
    let recipientEmail = "";
    if (Array.isArray(data.to) && data.to[0]) {
      recipientEmail = String(data.to[0]).trim().toLowerCase();
    } else if (typeof data.to === "string") {
      recipientEmail = data.to.trim().toLowerCase();
    } else if (data.recipient_email) {
      recipientEmail = String(data.recipient_email).trim().toLowerCase();
    }

    const rawHeaders: Record<string, string> = {};
    if (data.headers && typeof data.headers === "object") {
      for (const [k, v] of Object.entries(data.headers as Record<string, unknown>)) {
        rawHeaders[k.toLowerCase()] = String(v);
      }
    }
    if (headers) {
      for (const [k, v] of Object.entries(headers)) {
        if (typeof v === "string") rawHeaders[k.toLowerCase()] = v;
      }
    }

    const inReplyTo = (data.in_reply_to || rawHeaders["in-reply-to"] || null) as string | null;
    const references = (data.references || rawHeaders["references"] || null) as string[] | string | null;
    const providerMessageId = String(
      data.email_id || data.id || b.email_id || b.message_id || data.provider_message_id || `inbound_${crypto.randomUUID()}`
    );

    const attachments: InboundEmailAttachment[] = [];
    if (Array.isArray(data.attachments)) {
      for (const a of data.attachments) {
        if (typeof a === "object" && a !== null) {
          const att = a as Record<string, unknown>;
          attachments.push({
            filename: String(att.filename || "attachment"),
            contentType: String(att.contentType || att.content_type || "application/octet-stream"),
            size: typeof att.size === "number" ? att.size : undefined,
            content: typeof att.content === "string" ? att.content : undefined,
          });
        }
      }
    }

    return {
      message_id: crypto.randomUUID(),
      provider_message_id: providerMessageId,
      sender_email: senderEmail,
      sender_name: senderName,
      recipient_email: recipientEmail,
      subject: String(data.subject || b.subject || "No Subject"),
      body_text: String(data.text || data.body_text || data.body || b.text || ""),
      body_html: String(data.html || data.body_html || b.html || ""),
      in_reply_to: inReplyTo,
      references,
      received_at: String(data.created_at || b.created_at || new Date().toISOString()),
      attachments,
      headers: rawHeaders,
      raw: b,
    };
  }

  identifySender(parsed: NormalizedInboundEmail): { email: string; name?: string } {
    return {
      email: parsed.sender_email,
      name: parsed.sender_name,
    };
  }

  normalizeMessage(parsed: NormalizedInboundEmail): NormalizedInboundEmail {
    return {
      ...parsed,
      sender_email: parsed.sender_email.trim().toLowerCase(),
      recipient_email: parsed.recipient_email.trim().toLowerCase(),
    };
  }

  clear(): void {
    this.sentEmails = [];
  }
}
