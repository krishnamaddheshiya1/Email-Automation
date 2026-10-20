import fs from "fs";
import path from "path";
import crypto from "crypto";
import { query, isDbConfigured } from "../db/client";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  EmailMessage,
  EmailEvent,
  MessageStatus,
  EmailEventType,
  MessageDirection,
} from "@/types/database";
import type { QueryResultRow } from "pg";

export interface CreateEmailMessageInput {
  id?: string;
  business_id: string;
  lead_id: string;
  campaign_id?: string | null;
  campaign_step_id?: string | null;
  template_id?: string | null;
  direction?: MessageDirection;
  provider_message_id?: string | null;
  from_email: string;
  to_email: string;
  reply_to?: string | null;
  subject: string;
  body: string;
  status?: MessageStatus;
  scheduled_at?: string | null;
  sent_at?: string | null;
  metadata?: Record<string, unknown>;
}

export interface CreateEmailEventInput {
  id?: string;
  business_id: string;
  email_message_id?: string | null;
  campaign_id?: string | null;
  campaign_step_id?: string | null;
  lead_id?: string | null;
  enrollment_id?: string | null;
  event_type: EmailEventType;
  provider_event_id?: string | null;
  event_timestamp?: string;
  metadata?: Record<string, unknown>;
}

interface LocalEmailStoreData {
  messages: EmailMessage[];
  events: EmailEvent[];
}

export class LocalEmailStore {
  private static filePath = path.resolve(process.cwd(), ".data/email_messages.json");
  private static cache: LocalEmailStoreData | null = null;
  private static lastMtime = 0;

  static load(): LocalEmailStoreData {
    try {
      if (fs.existsSync(this.filePath)) {
        const stat = fs.statSync(this.filePath);
        if (this.cache !== null && stat.mtimeMs === this.lastMtime) {
          return this.cache;
        }
        const raw = fs.readFileSync(this.filePath, "utf-8");
        this.cache = JSON.parse(raw);
        this.lastMtime = stat.mtimeMs;
        if (this.cache) {
          this.cache.messages = this.cache.messages || [];
          this.cache.events = this.cache.events || [];
          return this.cache;
        }
      }
    } catch {
      // Ignore read error
    }
    this.cache = { messages: [], events: [] };
    return this.cache;
  }

  private static save(): void {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        this.filePath,
        JSON.stringify(this.cache || { messages: [], events: [] }, null, 2),
        "utf-8"
      );
      this.lastMtime = fs.statSync(this.filePath).mtimeMs;
    } catch (err) {
      console.warn("Could not save to local email store:", err);
    }
  }

  static createMessage(input: CreateEmailMessageInput): EmailMessage {
    const store = this.load();
    const now = new Date().toISOString();
    const messageId = input.id || crypto.randomUUID();
    const message: EmailMessage = {
      id: messageId,
      business_id: input.business_id,
      lead_id: input.lead_id,
      campaign_id: input.campaign_id || null,
      campaign_step_id: input.campaign_step_id || null,
      template_id: input.template_id || null,
      direction: input.direction || "outbound",
      provider_message_id: input.provider_message_id || null,
      from_email: input.from_email.trim().toLowerCase(),
      to_email: input.to_email.trim().toLowerCase(),
      reply_to: input.reply_to || null,
      subject: input.subject,
      body: input.body,
      status: (input.status || "QUEUED").toUpperCase() as MessageStatus,
      scheduled_at: input.scheduled_at || null,
      sent_at: input.sent_at || null,
      metadata: input.metadata || {},
      created_at: now,
      updated_at: now,
    };

    const existingIdx = store.messages.findIndex((m) => m.id === messageId);
    if (existingIdx !== -1) {
      store.messages[existingIdx] = message;
    } else {
      store.messages.unshift(message);
    }
    this.save();
    return message;
  }

  static findMessageById(id: string): EmailMessage | null {
    const store = this.load();
    return store.messages.find((m) => m.id === id) || null;
  }

  static findMessageByProviderId(providerMessageId: string): EmailMessage | null {
    const store = this.load();
    return store.messages.find((m) => m.provider_message_id === providerMessageId) || null;
  }

  static updateMessage(id: string, patch: Partial<EmailMessage>): EmailMessage | null {
    const store = this.load();
    const idx = store.messages.findIndex((m) => m.id === id);
    if (idx === -1) return null;
    const existing = store.messages[idx];
    const updated: EmailMessage = {
      ...existing,
      ...patch,
      status: (patch.status ? patch.status.toUpperCase() : existing.status) as MessageStatus,
      updated_at: new Date().toISOString(),
    };
    store.messages[idx] = updated;
    this.save();
    return updated;
  }

  static recordOpen(id: string, openedAt?: string): EmailMessage | null {
    const store = this.load();
    const idx = store.messages.findIndex((m) => m.id === id);
    if (idx === -1) return null;
    const existing = store.messages[idx];
    const nowIso = openedAt || new Date().toISOString();
    const currentSt = String(existing.status || "").toLowerCase();
    const nextStatus = ["sent", "delivered"].includes(currentSt) ? "OPENED" : existing.status;
    const updated: EmailMessage = {
      ...existing,
      status: nextStatus as MessageStatus,
      opened_at: existing.opened_at || nowIso,
      first_opened_at: existing.first_opened_at || existing.opened_at || nowIso,
      last_opened_at: nowIso,
      open_count: (existing.open_count || 0) + 1,
      metadata: {
        ...(existing.metadata || {}),
        is_opened: true,
        first_opened_at: existing.first_opened_at || existing.opened_at || nowIso,
        last_opened_at: nowIso,
      },
      updated_at: nowIso,
    };
    store.messages[idx] = updated;
    this.save();
    return updated;
  }

  static listMessages(businessId: string): EmailMessage[] {
    const store = this.load();
    return store.messages.filter((m) => m.business_id === businessId);
  }

  static createEvent(input: CreateEmailEventInput): EmailEvent {
    const store = this.load();
    const now = new Date().toISOString();
    const eventId = input.id || crypto.randomUUID();
    const event: EmailEvent = {
      id: eventId,
      business_id: input.business_id,
      email_message_id: input.email_message_id || null,
      campaign_id: input.campaign_id || null,
      campaign_step_id: input.campaign_step_id || null,
      lead_id: input.lead_id || null,
      enrollment_id: input.enrollment_id || null,
      event_type: input.event_type.toUpperCase() as EmailEventType,
      provider_event_id: input.provider_event_id || null,
      event_timestamp: input.event_timestamp || now,
      metadata: input.metadata || {},
      created_at: now,
    };
    store.events.push(event);
    this.save();
    return event;
  }

  static findEventByProviderEventId(providerEventId: string): EmailEvent | null {
    const store = this.load();
    return store.events.find((e) => e.provider_event_id === providerEventId) || null;
  }

  static listEvents(emailMessageId: string): EmailEvent[] {
    const store = this.load();
    return store.events.filter((e) => e.email_message_id === emailMessageId);
  }

  static findContactedLeadIds(campaignId: string, businessId: string): Set<string> {
    const store = this.load();
    const set = new Set<string>();
    for (const m of store.messages) {
      if (
        m.campaign_id === campaignId &&
        m.business_id === businessId &&
        ["sending", "sent", "delivered", "opened"].includes(String(m.status || "").toLowerCase())
      ) {
        if (m.lead_id) set.add(m.lead_id);
      }
    }
    return set;
  }

  static hasMessageForStep(campaignId: string, stepId: string, leadId: string): boolean {
    const store = this.load();
    return store.messages.some(
      (m) =>
        m.campaign_id === campaignId &&
        (m.campaign_step_id === stepId || (m as { step_id?: string }).step_id === stepId) &&
        m.lead_id === leadId &&
        ["sending", "sent", "delivered", "opened"].includes(String(m.status || "").toLowerCase())
    );
  }
}

export class EmailMessageRepository {
  private queryFn: typeof query;
  private isCustomQuery: boolean;

  constructor(customQuery?: typeof query) {
    this.isCustomQuery = Boolean(customQuery);
    this.queryFn = customQuery || query;
  }

  private useDatabase(): boolean {
    return this.isCustomQuery || isDbConfigured();
  }

  /**
   * Persists a new email message record in QUEUED / SENDING status.
   */
  async create(input: CreateEmailMessageInput): Promise<EmailMessage> {
    const messageId = input.id || crypto.randomUUID();
    const statusVal = (input.status || "QUEUED").toLowerCase();
    const fromVal = input.from_email.trim().toLowerCase();
    const toVal = input.to_email.trim().toLowerCase();

    const meta = {
      direction: input.direction || "outbound",
      reply_to: input.reply_to || null,
      open_count: 0,
      is_opened: false,
      ...(input.metadata || {}),
    };

    // 1. Direct PostgreSQL query
    if (this.useDatabase()) {
      try {
        const res = await this.queryFn<QueryResultRow>(
          `INSERT INTO email_messages (
            id, business_id, lead_id, campaign_id, step_id, template_id,
            sender_email, recipient_email, subject, body, status,
            provider_message_id, sent_at, metadata, open_count, reply_to,
            created_at, updated_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, 0, $15, NOW(), NOW()
          ) RETURNING *;`,
          [
            messageId,
            input.business_id,
            input.lead_id,
            input.campaign_id || null,
            input.campaign_step_id || null,
            input.template_id || null,
            fromVal,
            toVal,
            input.subject,
            input.body,
            statusVal,
            input.provider_message_id || null,
            input.sent_at || null,
            JSON.stringify(meta),
            input.reply_to || null,
          ]
        );
        return this.normalizeMessage(res.rows[0]);
      } catch (err: unknown) {
        const dbErr = err as { code?: string; message?: string };
        console.error(`[DB ERROR] Table: email_messages, Operation: INSERT (SQL), Code: ${dbErr?.code}, Message: ${dbErr?.message}, Record: ${messageId}`);
        if (this.isCustomQuery) throw err;
      }
    }

    // 2. Supabase PostgREST client
    try {
      const admin = createAdminClient();
      const { data: inserted, error } = await admin
        .from("email_messages")
        .insert({
          id: messageId,
          business_id: input.business_id,
          lead_id: input.lead_id,
          campaign_id: input.campaign_id || null,
          step_id: input.campaign_step_id || null,
          template_id: input.template_id || null,
          sender_email: fromVal,
          recipient_email: toVal,
          subject: input.subject,
          body: input.body,
          status: statusVal,
          provider_message_id: input.provider_message_id || null,
          sent_at: input.sent_at || null,
          metadata: meta,
          open_count: 0,
          reply_to: input.reply_to || null,
        })
        .select()
        .single();

      if (!error && inserted) {
        return this.normalizeMessage(inserted);
      }
      if (error) {
        console.error(`[DB ERROR] Table: email_messages, Operation: INSERT (PostgREST), Code: ${error.code}, Message: ${error.message}, Record: ${messageId}`);
        throw new Error(`Database error saving email message: ${error.message}`);
      }
    } catch (err) {
      console.error(`[DB ERROR] Table: email_messages, Operation: INSERT, Record: ${messageId}, Error:`, err);
      if (process.env.NODE_ENV === "production" || isDbConfigured()) {
        throw err;
      }
    }

    if (!isDbConfigured() && process.env.NODE_ENV !== "production") {
      return LocalEmailStore.createMessage({ ...input, id: messageId });
    }
    throw new Error(`Failed to insert email_message ${messageId} into database.`);
  }

  /**
   * Retrieves an email message by primary key.
   */
  async findById(id: string): Promise<EmailMessage | null> {
    if (this.useDatabase()) {
      try {
        const res = await this.queryFn<QueryResultRow>(
          `SELECT * FROM email_messages WHERE id = $1;`,
          [id]
        );
        if (res.rows[0]) return this.normalizeMessage(res.rows[0]);
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }

    try {
      const admin = createAdminClient();
      const { data, error } = await admin
        .from("email_messages")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (!error && data) return this.normalizeMessage(data);
    } catch {
      // Fallback
    }

    return LocalEmailStore.findMessageById(id);
  }

  /**
   * Retrieves an email message by business ID and message ID.
   */
  async findByIdAndBusinessId(id: string, businessId: string): Promise<EmailMessage | null> {
    if (this.useDatabase()) {
      try {
        const res = await this.queryFn<QueryResultRow>(
          `SELECT * FROM email_messages WHERE id = $1 AND business_id = $2;`,
          [id, businessId]
        );
        if (res.rows[0]) return this.normalizeMessage(res.rows[0]);
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }

    try {
      const admin = createAdminClient();
      const { data, error } = await admin
        .from("email_messages")
        .select("*")
        .eq("id", id)
        .eq("business_id", businessId)
        .maybeSingle();
      if (!error && data) return this.normalizeMessage(data);
    } catch {
      // Fallback
    }

    const localMsg = LocalEmailStore.findMessageById(id);
    return localMsg && localMsg.business_id === businessId ? localMsg : null;
  }

  /**
   * Finds an email message by external provider message ID (used by webhooks).
   */
  async findByProviderMessageId(providerMessageId: string): Promise<EmailMessage | null> {
    if (!providerMessageId) return null;

    if (this.useDatabase()) {
      try {
        const res = await this.queryFn<QueryResultRow>(
          `SELECT * FROM email_messages WHERE provider_message_id = $1 LIMIT 1;`,
          [providerMessageId]
        );
        if (res.rows[0]) return this.normalizeMessage(res.rows[0]);
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }

    try {
      const admin = createAdminClient();
      const { data, error } = await admin
        .from("email_messages")
        .select("*")
        .eq("provider_message_id", providerMessageId)
        .maybeSingle();
      if (!error && data) return this.normalizeMessage(data);
    } catch {
      // Fallback
    }

    return LocalEmailStore.findMessageByProviderId(providerMessageId);
  }

  /**
   * Finds the most recent outbound email message sent to a recipient email.
   */
  async findRecentByRecipientEmail(recipientEmail: string, businessId?: string): Promise<EmailMessage | null> {
    if (!recipientEmail) return null;
    const cleanEmail = recipientEmail.trim().toLowerCase();

    if (this.useDatabase()) {
      try {
        let sql = `SELECT * FROM email_messages WHERE LOWER(to_email) = $1`;
        const params: unknown[] = [cleanEmail];
        if (businessId) {
          sql += ` AND business_id = $2`;
          params.push(businessId);
        }
        sql += ` ORDER BY created_at DESC LIMIT 1;`;
        const res = await this.queryFn<QueryResultRow>(sql, params);
        if (res.rows[0]) return this.normalizeMessage(res.rows[0]);
      } catch (err: unknown) {
        console.error("Database error in EmailMessageRepository.findRecentByRecipientEmail:", err);
      }
    }

    try {
      const admin = createAdminClient();
      let query = admin
        .from("email_messages")
        .select("*")
        .ilike("to_email", cleanEmail);
      if (businessId) {
        query = query.eq("business_id", businessId);
      }
      const { data, error } = await query
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!error && data) return this.normalizeMessage(data);
    } catch {}

    const local = LocalEmailStore.load().messages
      .filter((m) => {
        const matchesEmail = (m.to_email || "").toLowerCase() === cleanEmail;
        const matchesBusiness = !businessId || m.business_id === businessId;
        return matchesEmail && matchesBusiness;
      })
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    return local[0] || null;
  }

  /**
   * Finds all contact IDs that have already received an email (sending, sent, delivered, or opened)
   * for a specific campaign in a business tenant.
   */
  async findContactedLeadIds(campaignId: string, businessId: string): Promise<Set<string>> {
    const contacted = new Set<string>();

    if (this.useDatabase()) {
      try {
        const res = await this.queryFn<QueryResultRow>(
          `SELECT DISTINCT lead_id FROM email_messages 
           WHERE campaign_id = $1 AND business_id = $2 
             AND LOWER(status) IN ('sending', 'sent', 'delivered', 'opened');`,
          [campaignId, businessId]
        );
        for (const r of res.rows) {
          if (r.lead_id) contacted.add(String(r.lead_id));
        }
        return contacted;
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }

    try {
      const admin = createAdminClient();
      const { data, error } = await admin
        .from("email_messages")
        .select("lead_id, status, metadata, sent_at")
        .eq("campaign_id", campaignId)
        .eq("business_id", businessId);
      if (!error && data) {
        for (const row of data) {
          const st = String(row.status || "").toLowerCase();
          const meta = (row.metadata as Record<string, unknown>) || {};
          if (
            ["sending", "sent", "delivered", "opened"].includes(st) ||
            meta.is_opened === true ||
            row.sent_at != null
          ) {
            if (row.lead_id) contacted.add(row.lead_id);
          }
        }
        return contacted;
      }
    } catch {}

    return LocalEmailStore.findContactedLeadIds(campaignId, businessId);
  }

  /**
   * Updates provider message ID and optional status.
   */
  async updateProviderMessageId(
    id: string,
    providerMessageId: string,
    status?: MessageStatus,
    sentAt?: string
  ): Promise<EmailMessage> {
    const statusVal = status ? status.toLowerCase() : undefined;
    const sentAtVal = sentAt || new Date().toISOString();

    if (this.useDatabase()) {
      try {
        const res = await this.queryFn<QueryResultRow>(
          `UPDATE email_messages
           SET provider_message_id = $1,
               status = COALESCE($2, status),
               sent_at = COALESCE($3, sent_at),
               updated_at = NOW()
           WHERE id = $4
           RETURNING *;`,
          [providerMessageId, statusVal, sentAtVal, id]
        );
        if (res.rows[0]) {
          const norm = this.normalizeMessage(res.rows[0]);
          LocalEmailStore.updateMessage(id, { provider_message_id: providerMessageId, status, sent_at: sentAtVal });
          return norm;
        }
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }

    try {
      const admin = createAdminClient();
      const patch: Record<string, unknown> = {
        provider_message_id: providerMessageId,
        sent_at: sentAtVal,
        updated_at: new Date().toISOString(),
      };
      if (statusVal) {
        const validStatus = ["draft", "queued", "sent", "delivered", "bounced", "failed"].includes(statusVal)
          ? statusVal
          : "sent";
        patch.status = validStatus;
      }

      const { data, error } = await admin
        .from("email_messages")
        .update(patch)
        .eq("id", id)
        .select()
        .single();
      if (!error && data) {
        const norm = this.normalizeMessage(data);
        LocalEmailStore.updateMessage(id, { provider_message_id: providerMessageId, status, sent_at: sentAtVal });
        return norm;
      }
    } catch {
      // Fallback
    }

    const updated = LocalEmailStore.updateMessage(id, {
      provider_message_id: providerMessageId,
      status,
      sent_at: sentAtVal,
    });
    if (!updated) throw new Error("Email message not found.");
    return updated;
  }

  /**
   * Updates message status (e.g. DELIVERED, BOUNCED, FAILED).
   */
  async updateStatus(
    id: string,
    status: MessageStatus,
    metadata?: Record<string, unknown>
  ): Promise<EmailMessage> {
    const statusVal = status.toLowerCase();
    const isDelivered = status.toUpperCase() === "DELIVERED";
    const isBounced = status.toUpperCase() === "BOUNCED";
    const bounceType = metadata?.bounce_type ? String(metadata.bounce_type) : null;
    const bounceSubtype = metadata?.bounce_subtype ? String(metadata.bounce_subtype) : null;
    const bounceMessage = metadata?.reason ? String(metadata.reason) : null;

    if (this.useDatabase()) {
      try {
        const res = await this.queryFn<QueryResultRow>(
          `UPDATE email_messages
           SET status = $1,
               delivered_at = CASE WHEN $3 = true THEN COALESCE(delivered_at, NOW()) ELSE delivered_at END,
               bounced_at = CASE WHEN $4 = true THEN COALESCE(bounced_at, NOW()) ELSE bounced_at END,
               bounce_type = COALESCE($5, bounce_type),
               bounce_subtype = COALESCE($6, bounce_subtype),
               bounce_message = COALESCE($7, bounce_message),
               metadata = COALESCE(metadata, '{}'::jsonb) || $8::jsonb,
               updated_at = NOW()
           WHERE id = $2
           RETURNING *;`,
          [
            statusVal,
            id,
            isDelivered,
            isBounced,
            bounceType,
            bounceSubtype,
            bounceMessage,
            JSON.stringify(metadata || {}),
          ]
        );
        if (res.rows[0]) {
          const norm = this.normalizeMessage(res.rows[0]);
          LocalEmailStore.updateMessage(id, {
            status,
            metadata: { ...(norm.metadata || {}), ...(metadata || {}) },
            delivered_at: isDelivered ? new Date().toISOString() : undefined,
            bounced_at: isBounced ? new Date().toISOString() : undefined,
            bounce_type: bounceType,
            bounce_subtype: bounceSubtype,
            bounce_message: bounceMessage,
          });
          return norm;
        }
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }

    try {
      const admin = createAdminClient();
      const { data: existing } = await admin
        .from("email_messages")
        .select("id, status, metadata")
        .eq("id", id)
        .maybeSingle();

      const existingMeta = (existing?.metadata as Record<string, unknown>) || {};
      const updatedMeta: Record<string, unknown> = {
        ...existingMeta,
        ...(metadata || {}),
      };
      if (isDelivered) {
        updatedMeta.delivered_at = updatedMeta.delivered_at || new Date().toISOString();
      }
      if (isBounced) {
        updatedMeta.bounced_at = updatedMeta.bounced_at || new Date().toISOString();
        if (bounceType) updatedMeta.bounce_type = bounceType;
        if (bounceSubtype) updatedMeta.bounce_subtype = bounceSubtype;
        if (bounceMessage) updatedMeta.bounce_message = bounceMessage;
      }

      let validStatus = statusVal;
      if (statusVal === "opened") {
        validStatus = "delivered";
        updatedMeta.is_opened = true;
      } else if (!["draft", "queued", "sent", "delivered", "bounced", "failed"].includes(statusVal)) {
        validStatus = "delivered";
      }

      const patch: Record<string, unknown> = {
        status: validStatus,
        metadata: updatedMeta,
        updated_at: new Date().toISOString(),
      };
      if (isDelivered) patch.delivered_at = updatedMeta.delivered_at;
      if (isBounced) {
        patch.bounced_at = updatedMeta.bounced_at;
        patch.bounce_type = bounceType;
        patch.bounce_subtype = bounceSubtype;
        patch.bounce_message = bounceMessage;
      }

      const { data, error } = await admin
        .from("email_messages")
        .update(patch)
        .eq("id", id)
        .select()
        .single();
      if (!error && data) {
        const norm = this.normalizeMessage(data);
        LocalEmailStore.updateMessage(id, {
          status,
          metadata: updatedMeta,
          delivered_at: isDelivered ? new Date().toISOString() : undefined,
          bounced_at: isBounced ? new Date().toISOString() : undefined,
          bounce_type: bounceType,
          bounce_subtype: bounceSubtype,
          bounce_message: bounceMessage,
        });
        return norm;
      }
      if (error) {
        console.error(`[DB ERROR] Table: email_messages, Operation: UPDATE status, Code: ${error.code}, Message: ${error.message}, Record: ${id}`);
        throw new Error(`Database error updating message status: ${error.message}`);
      }
    } catch (err) {
      if (process.env.NODE_ENV === "production" || isDbConfigured()) {
        throw err;
      }
    }

    const updated = LocalEmailStore.updateMessage(id, {
      status,
      metadata,
      delivered_at: isDelivered ? new Date().toISOString() : undefined,
      bounced_at: isBounced ? new Date().toISOString() : undefined,
      bounce_type: bounceType,
      bounce_subtype: bounceSubtype,
      bounce_message: bounceMessage,
    });
    if (!updated) throw new Error("Email message not found.");
    return updated;
  }

  /**
   * Records an open event for an email message.
   * Increments open_count, records opened_at, and transitions status to OPENED.
   */
  async recordOpen(id: string, openedAt?: string): Promise<EmailMessage> {
    const nowIso = openedAt || new Date().toISOString();

    if (this.useDatabase()) {
      try {
        const res = await this.queryFn<QueryResultRow>(
          `UPDATE email_messages
           SET open_count = COALESCE(open_count, 0) + 1,
               opened_at = $2,
               first_opened_at = COALESCE(first_opened_at, opened_at, $2),
               last_opened_at = $2,
               status = CASE WHEN LOWER(status) IN ('sent', 'delivered') THEN 'opened' ELSE status END,
               metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('is_opened', true, 'last_opened_at', $2, 'open_count', COALESCE(open_count, 0) + 1),
               updated_at = NOW()
           WHERE id = $1
           RETURNING *;`,
          [id, nowIso]
        );
        if (res.rows[0]) {
          LocalEmailStore.recordOpen(id, openedAt);
          return this.normalizeMessage(res.rows[0]);
        }
      } catch (err: unknown) {
        const dbErr = err as { code?: string; message?: string };
        console.error(`[DB ERROR] Table: email_messages, Operation: recordOpen (SQL), Code: ${dbErr?.code}, Message: ${dbErr?.message}, Record: ${id}`);
        if (this.isCustomQuery) throw err;
      }
    }

    try {
      const admin = createAdminClient();
      const { data: existing } = await admin
        .from("email_messages")
        .select("id, status, open_count, opened_at, first_opened_at, metadata")
        .eq("id", id)
        .maybeSingle();

      const existingMeta = (existing?.metadata as Record<string, unknown>) || {};
      const currentCount = typeof existing?.open_count === "number" ? existing.open_count : (typeof existingMeta.open_count === "number" ? existingMeta.open_count : 0);
      const nextCount = currentCount + 1;
      const initialOpen = (existing?.first_opened_at as string) || (existing?.opened_at as string) || (existingMeta.first_opened_at as string) || (existingMeta.opened_at as string) || nowIso;

      const updatedMeta = {
        ...existingMeta,
        open_count: nextCount,
        opened_at: nowIso,
        first_opened_at: initialOpen,
        last_opened_at: nowIso,
        is_opened: true,
      };

      const currentSt = String(existing?.status || "").toLowerCase();
      const nextStatus = currentSt === "bounced" ? "bounced" : "opened";

      const { data, error } = await admin
        .from("email_messages")
        .update({
          open_count: nextCount,
          opened_at: nowIso,
          first_opened_at: initialOpen,
          last_opened_at: nowIso,
          metadata: updatedMeta,
          status: nextStatus,
          updated_at: nowIso,
        })
        .eq("id", id)
        .select()
        .single();
      if (!error && data) {
        LocalEmailStore.recordOpen(id, openedAt);
        return this.normalizeMessage(data);
      }
      if (error) {
        console.error(`[DB ERROR] Table: email_messages, Operation: recordOpen (PostgREST), Code: ${error.code}, Message: ${error.message}, Record: ${id}`);
      }
    } catch (err) {
      if (process.env.NODE_ENV === "production" || isDbConfigured()) {
        throw err;
      }
    }

    const localUpdated = LocalEmailStore.recordOpen(id, openedAt);
    if (!localUpdated) throw new Error("Email message not found.");
    return localUpdated;
  }

  /**
   * Lists messages for a business.
   */
  async listByBusiness(businessId: string): Promise<EmailMessage[]> {
    if (this.useDatabase()) {
      try {
        const res = await this.queryFn<QueryResultRow>(
          `SELECT * FROM email_messages WHERE business_id = $1 ORDER BY created_at DESC;`,
          [businessId]
        );
        if (res.rows.length > 0) return res.rows.map((r) => this.normalizeMessage(r));
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }

    try {
      const admin = createAdminClient();
      const { data, error } = await admin
        .from("email_messages")
        .select("*")
        .eq("business_id", businessId)
        .order("created_at", { ascending: false });
      if (!error && data && data.length > 0) {
        return data.map((r) => this.normalizeMessage(r));
      }
    } catch {
      // Fallback
    }

    return LocalEmailStore.listMessages(businessId);
  }

  // ==========================================
  // Email Events Methods
  // ==========================================

  /**
   * Persists an email event (SENT, DELIVERED, BOUNCED, etc.).
   */
  async createEvent(input: CreateEmailEventInput): Promise<EmailEvent> {
    const eventId = input.id || crypto.randomUUID();
    const eventTypeVal = input.event_type.toLowerCase();
    const now = input.event_timestamp || new Date().toISOString();
    const eventData = {
      business_id: input.business_id,
      campaign_id: input.campaign_id || null,
      campaign_step_id: input.campaign_step_id || null,
      lead_id: input.lead_id || null,
      enrollment_id: input.enrollment_id || null,
      provider_event_id: input.provider_event_id || null,
      event_timestamp: now,
      ...(input.metadata || {}),
    };

    if (this.useDatabase()) {
      try {
        const res = await this.queryFn<QueryResultRow>(
          `INSERT INTO email_events (
            id, business_id, email_message_id, message_id, campaign_id, campaign_step_id,
            lead_id, enrollment_id, event_type, provider_event_id,
            event_timestamp, metadata, event_data, created_at
          ) VALUES (
            $1, $2, $3, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, NOW()
          ) RETURNING *;`,
          [
            eventId,
            input.business_id,
            input.email_message_id || null,
            input.campaign_id || null,
            input.campaign_step_id || null,
            input.lead_id || null,
            input.enrollment_id || null,
            eventTypeVal,
            input.provider_event_id || null,
            now,
            JSON.stringify(input.metadata || {}),
            JSON.stringify(eventData),
          ]
        );
        const record = this.normalizeEvent(res.rows[0]);
        LocalEmailStore.createEvent({ ...input, id: eventId });
        return record;
      } catch (err: unknown) {
        const dbErr = err as { code?: string; message?: string };
        console.error(`[DB ERROR] Table: email_events, Operation: INSERT (SQL), Code: ${dbErr?.code}, Message: ${dbErr?.message}`);
        if (this.isCustomQuery) throw err;
      }
    }

    try {
      const admin = createAdminClient();
      const { data, error } = await admin
        .from("email_events")
        .insert({
          id: eventId,
          business_id: input.business_id,
          email_message_id: input.email_message_id || null,
          message_id: input.email_message_id || null,
          campaign_id: input.campaign_id || null,
          campaign_step_id: input.campaign_step_id || null,
          lead_id: input.lead_id || null,
          enrollment_id: input.enrollment_id || null,
          event_type: eventTypeVal,
          provider_event_id: input.provider_event_id || null,
          event_timestamp: now,
          event_data: eventData,
          metadata: input.metadata || {},
          created_at: now,
        })
        .select()
        .single();
      if (!error && data) {
        const record = this.normalizeEvent(data);
        LocalEmailStore.createEvent({ ...input, id: eventId });
        return record;
      }
      if (error) {
        console.error(`[DB ERROR] Table: email_events, Operation: INSERT (PostgREST), Code: ${error.code}, Message: ${error.message}`);
      }
    } catch (err) {
      if (process.env.NODE_ENV === "production" || isDbConfigured()) {
        throw err;
      }
    }

    return LocalEmailStore.createEvent({ ...input, id: eventId });
  }

  /**
   * Finds an event by external provider event ID (used for idempotency).
   */
  async findEventByProviderEventId(providerEventId: string): Promise<EmailEvent | null> {
    if (!providerEventId) return null;

    if (this.useDatabase()) {
      try {
        const res = await this.queryFn<QueryResultRow>(
          `SELECT * FROM email_events WHERE provider_event_id = $1 OR event_data->>'provider_event_id' = $1 LIMIT 1;`,
          [providerEventId]
        );
        if (res.rows[0]) return this.normalizeEvent(res.rows[0]);
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }

    try {
      const admin = createAdminClient();
      const { data, error } = await admin
        .from("email_events")
        .select("*")
        .or(`provider_event_id.eq.${providerEventId},event_data->>provider_event_id.eq.${providerEventId}`)
        .maybeSingle();
      if (!error && data) return this.normalizeEvent(data);
    } catch {}

    return LocalEmailStore.findEventByProviderEventId(providerEventId);
  }

  /**
   * Lists all audit events for a single email message.
   */
  async listEventsForMessage(emailMessageId: string): Promise<EmailEvent[]> {
    if (this.useDatabase()) {
      try {
        const res = await this.queryFn<QueryResultRow>(
          `SELECT * FROM email_events WHERE email_message_id = $1 ORDER BY event_timestamp ASC;`,
          [emailMessageId]
        );
        if (res.rows.length > 0) return res.rows.map((r) => this.normalizeEvent(r));
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }

    try {
      const admin = createAdminClient();
      const { data, error } = await admin
        .from("email_events")
        .select("*")
        .eq("message_id", emailMessageId)
        .order("created_at", { ascending: true });
      if (!error && data && data.length > 0) {
        return data.map((r) => this.normalizeEvent(r));
      }
    } catch {}

    return LocalEmailStore.listEvents(emailMessageId);
  }

  /**
   * Checks whether a message has already been sent/queued for a specific campaign step and contact.
   */
  async hasMessageForStep(campaignId: string, stepId: string, leadId: string): Promise<boolean> {
    if (this.useDatabase()) {
      try {
        const res = await this.queryFn<QueryResultRow>(
          `SELECT id FROM email_messages
           WHERE campaign_id = $1 AND (campaign_step_id = $2 OR step_id = $2) AND lead_id = $3
             AND LOWER(status) IN ('sending', 'sent', 'delivered', 'opened')
           LIMIT 1;`,
          [campaignId, stepId, leadId]
        );
        if (res.rows.length > 0) return true;
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }

    try {
      const admin = createAdminClient();
      const { data, error } = await admin
        .from("email_messages")
        .select("id")
        .eq("campaign_id", campaignId)
        .eq("step_id", stepId)
        .eq("lead_id", leadId)
        .limit(1);
      if (!error && data && data.length > 0) return true;
    } catch {
      // Fallback
    }

    return LocalEmailStore.hasMessageForStep(campaignId, stepId, leadId);
  }

  // ==========================================
  // Normalization Helpers
  // ==========================================

  private normalizeMessage(row: unknown): EmailMessage {
    const r = row as Record<string, unknown>;
    const meta = typeof r.metadata === "string" ? JSON.parse(r.metadata) : (r.metadata as Record<string, unknown>) || {};
    return {
      id: String(r.id),
      business_id: String(r.business_id),
      lead_id: String(r.lead_id),
      campaign_id: r.campaign_id ? String(r.campaign_id) : null,
      campaign_step_id: r.campaign_step_id ? String(r.campaign_step_id) : r.step_id ? String(r.step_id) : null,
      template_id: r.template_id ? String(r.template_id) : null,
      direction: (r.direction ? String(r.direction) : meta.direction || "outbound") as MessageDirection,
      provider_message_id: r.provider_message_id ? String(r.provider_message_id) : null,
      from_email: String(r.from_email || r.sender_email || ""),
      to_email: String(r.to_email || r.recipient_email || ""),
      reply_to: r.reply_to ? String(r.reply_to) : meta.reply_to ? String(meta.reply_to) : null,
      subject: String(r.subject || ""),
      body: String(r.body || ""),
      status: (meta.is_opened || (typeof meta.open_count === "number" && meta.open_count > 0) || String(r.status).toUpperCase() === "OPENED")
        ? ("OPENED" as MessageStatus)
        : (String(r.status || "QUEUED").toUpperCase() as MessageStatus),
      scheduled_at: r.scheduled_at ? String(r.scheduled_at) : null,
      sent_at: r.sent_at ? String(r.sent_at) : null,
      delivered_at: r.delivered_at ? String(r.delivered_at) : meta.delivered_at ? String(meta.delivered_at) : null,
      bounced_at: r.bounced_at ? String(r.bounced_at) : meta.bounced_at ? String(meta.bounced_at) : null,
      opened_at: r.opened_at ? String(r.opened_at) : meta.opened_at ? String(meta.opened_at) : null,
      first_opened_at: r.first_opened_at ? String(r.first_opened_at) : meta.first_opened_at ? String(meta.first_opened_at) : null,
      last_opened_at: r.last_opened_at ? String(r.last_opened_at) : meta.last_opened_at ? String(meta.last_opened_at) : null,
      open_count: typeof r.open_count === "number" ? r.open_count : typeof meta.open_count === "number" ? meta.open_count : 0,
      bounce_type: r.bounce_type ? String(r.bounce_type) : meta.bounce_type ? String(meta.bounce_type) : null,
      bounce_subtype: r.bounce_subtype ? String(r.bounce_subtype) : meta.bounce_subtype ? String(meta.bounce_subtype) : null,
      bounce_message: r.bounce_message ? String(r.bounce_message) : meta.bounce_message ? String(meta.bounce_message) : null,
      metadata: meta,
      created_at: String(r.created_at),
      updated_at: String(r.updated_at),
    };
  }

  private normalizeEvent(row: unknown): EmailEvent {
    const r = row as Record<string, unknown>;
    const meta = typeof r.metadata === "string"
      ? JSON.parse(r.metadata)
      : typeof r.event_data === "string"
      ? JSON.parse(r.event_data)
      : (r.metadata as Record<string, unknown>) || (r.event_data as Record<string, unknown>) || {};

    return {
      id: String(r.id),
      business_id: String(r.business_id || meta.business_id || ""),
      email_message_id: r.email_message_id ? String(r.email_message_id) : r.message_id ? String(r.message_id) : null,
      campaign_id: r.campaign_id ? String(r.campaign_id) : (meta.campaign_id ? String(meta.campaign_id) : null),
      campaign_step_id: r.campaign_step_id ? String(r.campaign_step_id) : (meta.campaign_step_id ? String(meta.campaign_step_id) : null),
      lead_id: r.lead_id ? String(r.lead_id) : (meta.lead_id ? String(meta.lead_id) : null),
      enrollment_id: r.enrollment_id ? String(r.enrollment_id) : (meta.enrollment_id ? String(meta.enrollment_id) : null),
      event_type: String(r.event_type || "SENT").toUpperCase() as EmailEventType,
      provider_event_id: r.provider_event_id ? String(r.provider_event_id) : null,
      event_timestamp: String(r.event_timestamp || r.created_at || new Date().toISOString()),
      metadata: meta,
      created_at: String(r.created_at || new Date().toISOString()),
    };
  }
}
