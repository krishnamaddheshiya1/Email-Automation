/**
 * Core Email Provider Interface & Domain Abstraction
 *
 * Decouples the application, campaigns, and delivery logic from specific
 * external email dispatch vendors (e.g. Resend, Amazon SES, Postmark, etc.).
 */

export interface EmailAttachmentPayload {
  filename: string;
  content: Buffer | string;
  contentType: string;
}

export interface SendEmailPayload {
  to: string;
  fromEmail: string;
  fromName?: string;
  replyTo?: string;
  subject: string;
  html: string;
  text?: string;
  headers?: Record<string, string>;
  tags?: Array<{ name: string; value: string }>;
  attachments?: EmailAttachmentPayload[];
}

export interface EmailSendResult {
  success: boolean;
  providerMessageId?: string;
  status: "SENT" | "QUEUED" | "FAILED";
  error?: {
    code?: string;
    message: string;
  };
  provider?: string;
  raw?: unknown;
}

export type WebhookNormalizedEventType =
  | "SENT"
  | "DELIVERED"
  | "BOUNCED"
  | "COMPLAINED"
  | "FAILED"
  | "OPENED"
  | "CLICKED"
  | "RECEIVED"
  | "DELIVERY_DELAYED";

export interface NormalizedWebhookEvent {
  providerEventId: string;
  providerMessageId: string;
  eventType: WebhookNormalizedEventType;
  recipientEmail?: string;
  timestamp: string;
  reason?: string;
  bounceType?: string;
  isPermanent?: boolean;
  raw: Record<string, unknown>;
}

export interface InboundEmailAttachment {
  filename: string;
  contentType: string;
  content?: Buffer | string;
  size?: number;
  storage_key?: string;
}

export interface NormalizedInboundEmail {
  message_id: string;
  provider_message_id: string;
  business_id?: string;
  sender_email: string;
  sender_name?: string;
  recipient_email: string;
  subject: string;
  body_text: string;
  body_html: string;
  in_reply_to: string | null;
  references: string[] | string | null;
  received_at: string;
  attachments: InboundEmailAttachment[];
  headers: Record<string, string>;
  raw?: Record<string, unknown>;
}

export interface FetchedInboundEmail {
  text?: string;
  html?: string;
  subject?: string;
  from?: string;
  to?: string[];
  headers?: Record<string, string>;
  messageId?: string;
  inReplyTo?: string | null;
  references?: string[] | string | null;
  attachments?: InboundEmailAttachment[];
  raw?: unknown;
}

export interface InboundEmailProvider {
  verifyWebhook(
    rawBody: string,
    headers: Record<string, string | string[] | undefined>,
    secret?: string
  ): Promise<boolean>;

  parseInboundEmail(
    body: unknown,
    headers?: Record<string, string | string[] | undefined>
  ): NormalizedInboundEmail | null;

  identifySender(parsed: NormalizedInboundEmail): { email: string; name?: string };

  normalizeMessage(parsed: NormalizedInboundEmail): NormalizedInboundEmail;

  fetchReceivedEmail?(emailId: string): Promise<FetchedInboundEmail | null>;
}

export interface EmailProvider {
  readonly name: string;

  /**
   * Dispatches a single transactional or campaign email through the provider.
   * Returns a normalized result without leaking raw secrets or proprietary structures.
   */
  sendEmail(payload: SendEmailPayload): Promise<EmailSendResult>;

  /**
   * Verifies the authenticity and cryptographic signature of an incoming webhook.
   */
  verifyWebhookSignature(
    rawBody: string,
    headers: Record<string, string | string[] | undefined>,
    secret?: string
  ): Promise<boolean>;

  /**
   * Maps a provider-specific webhook payload into the platform's normalized event structure.
   */
  parseWebhookEvent(
    body: unknown,
    headers?: Record<string, string | string[] | undefined>
  ): NormalizedWebhookEvent | null;

  /**
   * Optional inbound reply parser implementation if supported by the provider.
   */
  parseInboundEmail?(
    body: unknown,
    headers?: Record<string, string | string[] | undefined>
  ): NormalizedInboundEmail | null;

  /**
   * Optional method to fetch live delivery status of an email by provider message ID.
   */
  getEmail?(emailId: string): Promise<{
    success: boolean;
    last_event?: string;
    data?: Record<string, unknown>;
    error?: string;
  }>;

  /**
   * Optional method to list recent emails dispatched through the provider.
   */
  listEmails?(options?: { limit?: number }): Promise<{
    success: boolean;
    data?: Array<{ id: string; to: string[]; subject: string; last_event: string; created_at: string }>;
    error?: string;
  }>;
}
