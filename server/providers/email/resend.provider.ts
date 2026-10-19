import { Resend } from "resend";
import crypto from "crypto";
import fs from "fs";
import path from "path";
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

export interface ResendProviderOptions {
  apiKey?: string;
  webhookSecret?: string;
}

function readEnvFallback(key: string): string {
  if (process.env[key] && process.env[key]!.trim().length > 0) {
    return process.env[key]!.trim();
  }
  try {
    const envPath = path.resolve(process.cwd(), ".env.local");
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, "utf-8");
      const match = content.match(new RegExp(`^${key}=(.*)$`, "m"));
      if (match) {
        let val = match[1].trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        process.env[key] = val;
        return val;
      }
    }
  } catch {
    // Ignore fallback error
  }
  return "";
}

/**
 * Resend Email Provider Adapter
 *
 * Wraps the official Resend Node.js SDK and translates domain requests/responses
 * to platform-normalized structures. Never leaks secrets, tokens, or raw provider exceptions.
 */
export class ResendEmailProvider implements EmailProvider, InboundEmailProvider {
  readonly name = "resend";
  private resend: Resend | null = null;
  private apiKey: string;
  private webhookSecret: string;

  constructor(options: ResendProviderOptions = {}) {
    this.apiKey = options.apiKey !== undefined ? options.apiKey : "";
    this.webhookSecret = options.webhookSecret !== undefined ? options.webhookSecret : "";
  }

  private getApiKey(): string {
    return this.apiKey || readEnvFallback("RESEND_API_KEY");
  }

  private getWebhookSecret(): string {
    return this.webhookSecret || readEnvFallback("RESEND_WEBHOOK_SECRET");
  }

  private getClient(): Resend | null {
    const key = this.getApiKey();
    if (!key) return null;
    if (!this.resend || this.apiKey !== key) {
      try {
        this.apiKey = key;
        this.resend = new Resend(key);
      } catch (err) {
        console.warn("[ResendEmailProvider] Failed to initialize Resend client:", err instanceof Error ? err.message : "Unknown error");
        return null;
      }
    }
    return this.resend;
  }

  /**
   * Safe check whether Resend API key is configured without exposing secret values.
   */
  isConfigured(): boolean {
    const key = this.getApiKey();
    return Boolean(key && key.trim().length > 0);
  }

  /**
   * Dispatches an email via Resend API and returns a normalized result.
   */
  async sendEmail(payload: SendEmailPayload): Promise<EmailSendResult> {
    const client = this.getClient();
    const apiKey = this.getApiKey();

    if (!client || !apiKey) {
      return {
        success: false,
        status: "FAILED",
        provider: "resend",
        error: {
          code: "EMAIL_PROVIDER_NOT_CONFIGURED",
          message: "Email provider is not configured. Please configure an active email provider in Settings.",
        },
      };
    }

    try {
      // Safe diagnostic log without credentials
      console.log(`[ResendEmailProvider] Dispatching email to: ${payload.to}, subject: "${payload.subject}"`);

      const fromAddress = payload.fromName
        ? `${payload.fromName.trim()} <${payload.fromEmail.trim()}>`
        : payload.fromEmail.trim();

      const { data, error } = await client.emails.send({
        from: fromAddress,
        to: [payload.to.trim().toLowerCase()],
        subject: payload.subject,
        html: payload.html,
        text: payload.text,
        replyTo: payload.replyTo?.trim() || undefined,
        headers: payload.headers,
        attachments:
          payload.attachments && payload.attachments.length > 0
            ? payload.attachments.map((att) => ({
                filename: att.filename,
                content: Buffer.isBuffer(att.content)
                  ? att.content.toString("base64")
                  : att.content,
                contentType: att.contentType,
              }))
            : undefined,
      });

      if (error) {
        console.warn(`[ResendEmailProvider] Resend returned API error: ${error.name} - ${error.message}`);
        return {
          success: false,
          status: "FAILED",
          provider: "resend",
          error: {
            code: error.name || "RESEND_API_ERROR",
            message: error.message || "Failed to dispatch email via Resend.",
          },
        };
      }

      if (!data || !data.id) {
        return {
          success: false,
          status: "FAILED",
          provider: "resend",
          error: {
            code: "RESEND_EMPTY_RESPONSE",
            message: "Resend did not return a valid provider message ID.",
          },
        };
      }

      return {
        success: true,
        providerMessageId: data.id,
        status: "SENT",
        provider: "resend",
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unexpected Resend transport error";
      console.error(`[ResendEmailProvider] Transport exception: ${message}`);
      return {
        success: false,
        status: "FAILED",
        provider: "resend",
        error: {
          code: "RESEND_TRANSPORT_ERROR",
          message,
        },
      };
    }
  }

  /**
   * Retrieves live status and metadata for an email by its Resend message ID.
   */
  async getEmail(emailId: string): Promise<{
    success: boolean;
    last_event?: string;
    data?: Record<string, unknown>;
    error?: string;
  }> {
    const client = this.getClient();
    if (!client) {
      return { success: false, error: "Resend client not configured." };
    }
    try {
      const res = await client.emails.get(emailId);
      if (res.error) {
        return { success: false, error: res.error.message };
      }
      return {
        success: true,
        last_event: res.data?.last_event,
        data: res.data as unknown as Record<string, unknown>,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error fetching email from Resend";
      return { success: false, error: msg };
    }
  }

  /**
   * Lists recently sent emails from Resend.
   */
  async listEmails(options?: { limit?: number }): Promise<{
    success: boolean;
    data?: Array<{ id: string; to: string[]; subject: string; last_event: string; created_at: string }>;
    error?: string;
  }> {
    const client = this.getClient();
    if (!client) {
      return { success: false, error: "Resend client not configured." };
    }
    try {
      const limit = options?.limit || 50;
      if (typeof client.emails.list === "function") {
        const res = await client.emails.list({ limit });
        if (res.error) {
          return { success: false, error: res.error.message };
        }
        return {
          success: true,
          data: (res.data?.data || []) as Array<{ id: string; to: string[]; subject: string; last_event: string; created_at: string }>,
        };
      }
      return { success: false, error: "emails.list is not supported by current SDK." };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error listing emails from Resend";
      return { success: false, error: msg };
    }
  }

  /**
   * Cryptographically verifies incoming Resend/Svix webhook signatures.
   */
  async verifyWebhookSignature(
    rawBody: string,
    headers: Record<string, string | string[] | undefined>,
    secretOverride?: string
  ): Promise<boolean> {
    const secret = secretOverride || this.getWebhookSecret();
    if (!secret) {
      console.warn("[ResendEmailProvider] Webhook verification failed: No webhook secret configured.");
      return false;
    }

    // Normalize header keys to lowercase
    const normalizedHeaders: Record<string, string> = {};
    for (const [k, v] of Object.entries(headers)) {
      normalizedHeaders[k.toLowerCase()] = Array.isArray(v) ? v[0] : v || "";
    }

    const svixId = normalizedHeaders["svix-id"] || normalizedHeaders["webhook-id"];
    const svixTimestamp = normalizedHeaders["svix-timestamp"] || normalizedHeaders["webhook-timestamp"];
    const svixSignature = normalizedHeaders["svix-signature"] || normalizedHeaders["webhook-signature"];

    // 1. Try standard Svix / standardwebhooks verification via Resend SDK
    const client = this.getClient();
    if (client && svixId && svixTimestamp && svixSignature) {
      try {
        client.webhooks.verify({
          payload: rawBody,
          headers: {
            id: svixId,
            timestamp: svixTimestamp,
            signature: svixSignature,
          },
          webhookSecret: secret,
        });
        return true;
      } catch (err) {
        console.warn("[ResendEmailProvider] SDK webhook verification error:", err instanceof Error ? err.message : err);
      }
    }

    // 2. Direct HMAC SHA-256 fallback verification
    try {
      const rawSecret = secret.startsWith("whsec_")
        ? Buffer.from(secret.slice(6), "base64")
        : Buffer.from(secret, "utf-8");

      // Check standard timestamp + payload signature format: "${svixId}.${svixTimestamp}.${rawBody}"
      if (svixId && svixTimestamp && svixSignature) {
        const toSign = `${svixId}.${svixTimestamp}.${rawBody}`;
        const computed = crypto.createHmac("sha256", rawSecret).update(toSign).digest("base64");
        const signatures = svixSignature.split(" ").map((s) => s.replace(/^v1,/, ""));
        if (signatures.some((sig) => crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(computed)))) {
          return true;
        }
      }

      // Check direct header signature: resend-signature or signature
      const directSig = normalizedHeaders["resend-signature"] || normalizedHeaders["x-resend-signature"] || normalizedHeaders["signature"];
      if (directSig) {
        const computed = crypto.createHmac("sha256", rawSecret).update(rawBody).digest("hex");
        const cleanSig = directSig.replace(/^sha256=/, "");
        if (cleanSig.length === computed.length && crypto.timingSafeEqual(Buffer.from(cleanSig), Buffer.from(computed))) {
          return true;
        }
      }
    } catch {
      // Signature mismatch
    }

    return false;
  }

  /**
   * Translates Resend webhook payload into normalized application domain event.
   */
  parseWebhookEvent(
    body: unknown,
    headers?: Record<string, string | string[] | undefined>
  ): NormalizedWebhookEvent | null {
    if (!body || typeof body !== "object") return null;

    const b = body as Record<string, unknown>;
    const rawType = String(b.type || "").toLowerCase();
    const data = (b.data && typeof b.data === "object" ? b.data : {}) as Record<string, unknown>;

    // Map Resend event type to normalized application event
    let eventType: WebhookNormalizedEventType | null = null;
    if (rawType === "email.sent" || rawType === "sent") {
      eventType = "SENT";
    } else if (rawType === "email.delivered" || rawType === "delivered") {
      eventType = "DELIVERED";
    } else if (rawType === "email.delivery_delayed" || rawType === "delivery_delayed") {
      eventType = "DELIVERY_DELAYED";
    } else if (rawType === "email.bounced" || rawType === "bounced" || rawType === "email.suppressed" || rawType === "suppressed") {
      eventType = "BOUNCED";
    } else if (rawType === "email.complained" || rawType === "complained") {
      eventType = "COMPLAINED";
    } else if (rawType === "email.opened" || rawType === "opened") {
      eventType = "OPENED";
    } else if (rawType === "email.clicked" || rawType === "clicked") {
      eventType = "CLICKED";
    } else if (rawType === "email.failed" || rawType === "failed") {
      eventType = "FAILED";
    } else if (rawType === "email.received" || rawType === "received") {
      eventType = "RECEIVED";
    }

    if (!eventType) return null;

    // Determine provider message ID
    const providerMessageId = String(
      data.email_id || data.id || b.email_id || b.message_id || ""
    );
    if (!providerMessageId) return null;

    // Determine provider event ID (for idempotency)
    const svixId = headers
      ? String(headers["svix-id"] || headers["webhook-id"] || "")
      : "";
    const providerEventId = String(
      b.id || data.event_id || svixId || `${providerMessageId}_${eventType}_${String(b.created_at || Date.now())}`
    );

    // Determine recipient email
    let recipientEmail: string | undefined;
    if (Array.isArray(data.to) && data.to[0]) {
      recipientEmail = String(data.to[0]).toLowerCase();
    } else if (typeof data.to === "string") {
      recipientEmail = data.to.toLowerCase();
    } else if (typeof b.recipient === "string") {
      recipientEmail = b.recipient.toLowerCase();
    }

    // Determine bounce / complaint reason and permanent vs transient failure if provided
    let reason: string | undefined;
    let bounceType: string | undefined;
    let isPermanent = true;

    if (rawType.includes("suppressed")) {
      bounceType = "suppressed";
      reason = "Recipient email suppressed by provider";
      isPermanent = true;
    }

    if (data.bounce && typeof data.bounce === "object") {
      const bo = data.bounce as Record<string, unknown>;
      bounceType = String(bo.type || "");
      reason = String(bo.message || bo.type || "");
      if (
        bounceType.toLowerCase() === "transient" ||
        reason.toLowerCase().includes("transient") ||
        reason.toLowerCase().includes("temporary") ||
        reason.toLowerCase().includes("soft")
      ) {
        isPermanent = false;
      }
    } else if (data.bounce_type) {
      bounceType = String(data.bounce_type);
      reason = String(data.bounce_type);
      if (
        bounceType.toLowerCase() === "transient" ||
        reason.toLowerCase().includes("transient") ||
        reason.toLowerCase().includes("soft")
      ) {
        isPermanent = false;
      }
    } else if (data.reason) {
      reason = String(data.reason);
      if (
        reason.toLowerCase().includes("transient") ||
        reason.toLowerCase().includes("soft") ||
        reason.toLowerCase().includes("temporary")
      ) {
        isPermanent = false;
      }
    }

    return {
      providerEventId,
      providerMessageId,
      eventType,
      recipientEmail,
      timestamp: String(b.created_at || data.created_at || new Date().toISOString()),
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

    // Sender extraction
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

    // Recipient extraction
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

  /**
   * Fetches the full content of an inbound received email from Resend API if webhook payload was partial.
   */
  async fetchReceivedEmail(
    emailId: string
  ): Promise<{ text?: string; html?: string; raw?: unknown } | null> {
    const client = this.getClient();
    if (!client || !emailId) return null;
    try {
      const receivingApi = (client.emails as unknown as { receiving?: { get?: (id: string) => Promise<{ data?: unknown; error?: unknown }> } })?.receiving;
      if (receivingApi && typeof receivingApi.get === "function") {
        const { data, error } = await receivingApi.get(emailId);
        if (!error && data) {
          const d = data as Record<string, unknown>;
          return {
            text: (d.text || d.body_text || d.body) as string | undefined,
            html: (d.html || d.body_html) as string | undefined,
            raw: data,
          };
        }
      }

      const { data, error } = await client.emails.get(emailId);
      if (!error && data) {
        const d = data as unknown as Record<string, unknown>;
        return {
          text: (d.text || d.body_text || d.body) as string | undefined,
          html: (d.html || d.body_html) as string | undefined,
          raw: data,
        };
      }
    } catch (err) {
      console.warn(
        `[ResendEmailProvider] Could not fetch received email ${emailId}:`,
        err instanceof Error ? err.message : err
      );
    }
    return null;
  }
}
