import fs from "fs";
import path from "path";
import crypto from "crypto";
import { query, isDbConfigured } from "../db/client";
import { createAdminClient } from "@/lib/supabase/admin";
import type { QueryResultRow } from "pg";
import {
  Conversation,
  ConversationMessage,
  ConversationMessageDirection,
  ConversationListParams,
  ConversationListResult,
  ConversationListItem,
  ConversationStatus,
} from "@/types/database";

export interface CreateConversationInput {
  id?: string;
  business_id: string;
  lead_id: string;
  campaign_id?: string | null;
  subject: string;
  status?: ConversationStatus;
  last_message_at?: string | null;
  unread_count?: number;
}

export interface CreateConversationMessageInput {
  id?: string;
  conversation_id: string;
  business_id: string;
  direction: ConversationMessageDirection;
  sender_email: string;
  recipient_email: string;
  subject: string;
  body_text?: string | null;
  body_html?: string | null;
  provider_message_id?: string | null;
  in_reply_to?: string | null;
  received_at?: string | null;
  read_at?: string | null;
  attachments?: Array<{
    id?: string;
    filename: string;
    content_type?: string;
    contentType?: string;
    file_size?: number;
    url?: string;
    storage_key?: string;
  }>;
}

interface LocalStoreData {
  conversations: Conversation[];
  messages: ConversationMessage[];
}

class LocalConversationStore {
  private static filePath = path.resolve(process.cwd(), ".data/conversations.json");
  private static messagesFilePath = path.resolve(process.cwd(), ".data/conversation_messages.json");
  private static cache: LocalStoreData | null = null;

  private static load(): LocalStoreData {
    if (this.cache !== null) return this.cache;
    const store: LocalStoreData = { conversations: [], messages: [] };

    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, "utf-8");
        store.conversations = JSON.parse(raw) || [];
      }
    } catch {}

    try {
      if (fs.existsSync(this.messagesFilePath)) {
        const raw = fs.readFileSync(this.messagesFilePath, "utf-8");
        store.messages = JSON.parse(raw) || [];
      }
    } catch {}

    this.cache = store;
    return this.cache;
  }

  private static save(): void {
    if (!this.cache) return;
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      fs.writeFileSync(this.filePath, JSON.stringify(this.cache.conversations, null, 2), "utf-8");
      fs.writeFileSync(this.messagesFilePath, JSON.stringify(this.cache.messages, null, 2), "utf-8");
    } catch (err) {
      console.warn("[LocalConversationStore] Failed to save:", err);
    }
  }

  static createConversation(input: CreateConversationInput): Conversation {
    const store = this.load();
    const now = new Date().toISOString();
    const id = input.id || crypto.randomUUID();
    const convo: Conversation = {
      id,
      business_id: input.business_id,
      lead_id: input.lead_id,
      campaign_id: input.campaign_id || null,
      subject: input.subject || "No Subject",
      status: input.status || "active",
      last_message_at: input.last_message_at || now,
      unread_count: input.unread_count !== undefined ? input.unread_count : 0,
      created_at: now,
      updated_at: now,
    };

    const idx = store.conversations.findIndex((c) => c.id === id);
    if (idx >= 0) {
      store.conversations[idx] = convo;
    } else {
      store.conversations.unshift(convo);
    }
    this.save();
    return convo;
  }

  static findConversationById(id: string, businessId: string): Conversation | null {
    const store = this.load();
    return store.conversations.find((c) => c.id === id && c.business_id === businessId) || null;
  }

  static updateConversation(
    id: string,
    businessId: string,
    patch: Partial<Conversation>
  ): Conversation | null {
    const store = this.load();
    const idx = store.conversations.findIndex((c) => c.id === id && c.business_id === businessId);
    if (idx < 0) return null;

    const existing = store.conversations[idx];
    const updated: Conversation = {
      ...existing,
      ...patch,
      updated_at: new Date().toISOString(),
    };
    store.conversations[idx] = updated;
    this.save();
    return updated;
  }

  static createMessage(input: CreateConversationMessageInput): ConversationMessage {
    const store = this.load();
    const now = new Date().toISOString();
    const id = input.id || crypto.randomUUID();
    const msg: ConversationMessage = {
      id,
      conversation_id: input.conversation_id,
      business_id: input.business_id,
      direction: (input.direction.toUpperCase() === "INBOUND" ? "INBOUND" : "OUTBOUND"),
      sender_email: input.sender_email.trim().toLowerCase(),
      recipient_email: input.recipient_email.trim().toLowerCase(),
      subject: input.subject,
      body_text: input.body_text !== undefined ? input.body_text : null,
      body_html: input.body_html !== undefined ? input.body_html : null,
      provider_message_id: input.provider_message_id || null,
      in_reply_to: input.in_reply_to || null,
      received_at: input.received_at || now,
      read_at: input.read_at || null,
      attachments: input.attachments || [],
      created_at: now,
    };

    store.messages.push(msg);
    this.save();
    return msg;
  }

  static findMessageByProviderId(providerMessageId: string): ConversationMessage | null {
    const store = this.load();
    return store.messages.find((m) => m.provider_message_id === providerMessageId) || null;
  }

  static listMessages(conversationId: string, businessId: string): ConversationMessage[] {
    const store = this.load();
    return store.messages
      .filter((m) => m.conversation_id === conversationId && m.business_id === businessId)
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  }

  static markMessagesAsRead(conversationId: string, businessId: string): void {
    const store = this.load();
    const now = new Date().toISOString();
    let changed = false;
    for (const msg of store.messages) {
      if (msg.conversation_id === conversationId && msg.business_id === businessId && !msg.read_at) {
        msg.read_at = now;
        changed = true;
      }
    }
    if (changed) this.save();
  }

  static markLatestMessageAsUnread(conversationId: string, businessId: string): void {
    const store = this.load();
    const msgs = store.messages
      .filter((m) => m.conversation_id === conversationId && m.business_id === businessId && m.direction === "INBOUND")
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    if (msgs.length > 0) {
      msgs[0].read_at = null;
      this.save();
    }
  }

  static countInboundMessages(businessId: string): number {
    const store = this.load();
    return store.messages.filter(
      (m) => m.business_id === businessId && m.direction === "INBOUND"
    ).length;
  }

  static listAllConversations(businessId: string): Conversation[] {
    const store = this.load();
    return store.conversations.filter((c) => c.business_id === businessId);
  }

  static getAllMessages(businessId: string): ConversationMessage[] {
    const store = this.load();
    return store.messages.filter((m) => m.business_id === businessId);
  }
}

export class ConversationRepository {
  private queryFn: typeof query;
  private isCustomQuery: boolean;

  constructor(customQuery?: typeof query) {
    this.isCustomQuery = Boolean(customQuery);
    this.queryFn = customQuery || query;
  }

  private useDatabase(): boolean {
    return this.isCustomQuery || isDbConfigured();
  }

  private normalizeConversation(r: Record<string, unknown>): Conversation {
    return {
      id: String(r.id),
      business_id: String(r.business_id),
      lead_id: String(r.lead_id),
      campaign_id: r.campaign_id ? String(r.campaign_id) : null,
      subject: String(r.subject || "No Subject"),
      status: (r.status as ConversationStatus) || "active",
      last_message_at: r.last_message_at ? new Date(String(r.last_message_at)).toISOString() : null,
      unread_count: Number(r.unread_count || 0),
      created_at: new Date(String(r.created_at || Date.now())).toISOString(),
      updated_at: new Date(String(r.updated_at || Date.now())).toISOString(),
    };
  }

  private normalizeMessage(r: Record<string, unknown>): ConversationMessage {
    let attachments: ConversationMessage["attachments"] = [];
    if (r.attachments) {
      if (typeof r.attachments === "string") {
        try {
          attachments = JSON.parse(r.attachments);
        } catch {}
      } else if (Array.isArray(r.attachments)) {
        attachments = r.attachments;
      }
    }

    return {
      id: String(r.id),
      conversation_id: String(r.conversation_id),
      business_id: String(r.business_id),
      direction: String(r.direction || "INBOUND").toUpperCase() as ConversationMessageDirection,
      sender_email: String(r.sender_email || "").toLowerCase(),
      recipient_email: String(r.recipient_email || "").toLowerCase(),
      subject: String(r.subject || ""),
      body_text: r.body_text ? String(r.body_text) : null,
      body_html: r.body_html ? String(r.body_html) : null,
      provider_message_id: r.provider_message_id ? String(r.provider_message_id) : null,
      in_reply_to: r.in_reply_to ? String(r.in_reply_to) : null,
      received_at: r.received_at ? new Date(String(r.received_at)).toISOString() : null,
      read_at: r.read_at ? new Date(String(r.read_at)).toISOString() : null,
      attachments,
      created_at: new Date(String(r.created_at || Date.now())).toISOString(),
    };
  }

  /**
   * Creates or updates a conversation.
   */
  async createConversation(input: CreateConversationInput): Promise<Conversation> {
    const id = input.id || crypto.randomUUID();
    const status = input.status || "active";
    const subject = input.subject || "No Subject";
    const unreadCount = input.unread_count !== undefined ? input.unread_count : 0;
    const lastMsgAt = input.last_message_at || new Date().toISOString();

    if (this.useDatabase()) {
      try {
        const sql = `
          INSERT INTO conversations (
            id, business_id, lead_id, campaign_id, subject, status,
            last_message_at, unread_count, created_at, updated_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW()
          ) ON CONFLICT (id) DO UPDATE SET
            status = EXCLUDED.status,
            last_message_at = EXCLUDED.last_message_at,
            unread_count = EXCLUDED.unread_count,
            updated_at = NOW()
          RETURNING *;
        `;
        const res = await this.queryFn<QueryResultRow>(sql, [
          id,
          input.business_id,
          input.lead_id,
          input.campaign_id || null,
          subject,
          status,
          lastMsgAt,
          unreadCount,
        ]);
        const record = this.normalizeConversation(res.rows[0]);
        LocalConversationStore.createConversation({ ...input, id });
        return record;
      } catch (err: unknown) {
        const error = err as { code?: string; message?: string };
        console.error(`[ConversationRepository] createConversation DB error:`, {
          operation: "INSERT",
          table: "conversations",
          code: error?.code,
          message: error?.message,
          recordId: id,
          businessId: input.business_id,
        });
        if (this.isCustomQuery) throw err;
      }
    }

    try {
      const admin = createAdminClient();
      const { data, error } = await admin
        .from("conversations")
        .insert({
          id,
          business_id: input.business_id,
          lead_id: input.lead_id,
          campaign_id: input.campaign_id || null,
          subject,
          status,
          last_message_at: lastMsgAt,
          unread_count: unreadCount,
        })
        .select()
        .single();
      if (!error && data) {
        const record = this.normalizeConversation(data);
        LocalConversationStore.createConversation({ ...input, id });
        return record;
      }
    } catch {}

    return LocalConversationStore.createConversation({ ...input, id });
  }

  /**
   * Retrieves a conversation by ID and Business ID.
   */
  async findConversationById(id: string, businessId: string): Promise<Conversation | null> {
    if (this.useDatabase()) {
      try {
        const sql = `SELECT * FROM conversations WHERE id = $1 AND business_id = $2 LIMIT 1;`;
        const res = await this.queryFn<QueryResultRow>(sql, [id, businessId]);
        if (res.rows.length > 0) return this.normalizeConversation(res.rows[0]);
        return null;
      } catch (err: unknown) {
        const error = err as { code?: string; message?: string };
        console.error(`[ConversationRepository] findConversationById DB error:`, {
          operation: "SELECT",
          table: "conversations",
          code: error?.code,
          message: error?.message,
          recordId: id,
          businessId,
        });
        if (this.isCustomQuery) throw err;
        return null;
      }
    }

    try {
      const admin = createAdminClient();
      const { data, error } = await admin
        .from("conversations")
        .select("*")
        .eq("id", id)
        .eq("business_id", businessId)
        .maybeSingle();
      if (!error && data) return this.normalizeConversation(data);
    } catch {}

    return LocalConversationStore.findConversationById(id, businessId);
  }

  /**
   * Finds existing active conversation for a contact and optional campaign.
   */
  async findConversationByContact(
    businessId: string,
    leadId: string,
    campaignId?: string | null
  ): Promise<Conversation | null> {
    if (this.useDatabase()) {
      try {
        let sql = `SELECT * FROM conversations WHERE business_id = $1 AND lead_id = $2`;
        const params: unknown[] = [businessId, leadId];
        if (campaignId) {
          sql += ` AND campaign_id = $3`;
          params.push(campaignId);
        }
        sql += ` ORDER BY last_message_at DESC NULLS LAST LIMIT 1;`;
        const res = await this.queryFn<QueryResultRow>(sql, params);
        if (res.rows.length > 0) return this.normalizeConversation(res.rows[0]);
        return null;
      } catch (err: unknown) {
        const error = err as { code?: string; message?: string };
        console.error(`[ConversationRepository] findConversationByContact DB error:`, {
          operation: "SELECT",
          table: "conversations",
          code: error?.code,
          message: error?.message,
          leadId,
          businessId,
        });
        if (this.isCustomQuery) throw err;
        return null;
      }
    }

    const localList = LocalConversationStore.listAllConversations(businessId);
    const matches = localList.filter((c) => {
      if (c.lead_id !== leadId) return false;
      if (campaignId && c.campaign_id !== campaignId) return false;
      return true;
    });
    matches.sort((a, b) => new Date(b.last_message_at || 0).getTime() - new Date(a.last_message_at || 0).getTime());
    return matches[0] || null;
  }

  /**
   * Updates conversation fields.
   */
  async updateConversation(
    id: string,
    businessId: string,
    patch: Partial<Conversation>
  ): Promise<Conversation | null> {
    if (this.useDatabase()) {
      try {
        const sets: string[] = [];
        const params: unknown[] = [id, businessId];
        let pIndex = 3;

        if (patch.subject !== undefined) {
          sets.push(`subject = $${pIndex++}`);
          params.push(patch.subject);
        }
        if (patch.status !== undefined) {
          sets.push(`status = $${pIndex++}`);
          params.push(patch.status);
        }
        if (patch.campaign_id !== undefined) {
          sets.push(`campaign_id = $${pIndex++}`);
          params.push(patch.campaign_id);
        }
        if (patch.last_message_at !== undefined) {
          sets.push(`last_message_at = $${pIndex++}`);
          params.push(patch.last_message_at);
        }
        if (patch.unread_count !== undefined) {
          sets.push(`unread_count = $${pIndex++}`);
          params.push(patch.unread_count);
        }

        if (sets.length > 0) {
          sets.push(`updated_at = NOW()`);
          const sql = `
            UPDATE conversations
            SET ${sets.join(", ")}
            WHERE id = $1 AND business_id = $2
            RETURNING *;
          `;
          const res = await this.queryFn<QueryResultRow>(sql, params);
          if (res.rows[0]) {
            const norm = this.normalizeConversation(res.rows[0]);
            LocalConversationStore.updateConversation(id, businessId, patch);
            return norm;
          }
          return null;
        }
      } catch (err: unknown) {
        const error = err as { code?: string; message?: string };
        console.error(`[ConversationRepository] updateConversation DB error:`, {
          operation: "UPDATE",
          table: "conversations",
          code: error?.code,
          message: error?.message,
          recordId: id,
          businessId,
        });
        if (this.isCustomQuery) throw err;
        return null;
      }
    }

    try {
      const admin = createAdminClient();
      const patchData: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };
      if (patch.subject !== undefined) patchData.subject = patch.subject;
      if (patch.status !== undefined) patchData.status = patch.status;
      if (patch.campaign_id !== undefined) patchData.campaign_id = patch.campaign_id;
      if (patch.last_message_at !== undefined) patchData.last_message_at = patch.last_message_at;
      if (patch.unread_count !== undefined) patchData.unread_count = patch.unread_count;

      const { data, error } = await admin
        .from("conversations")
        .update(patchData)
        .eq("id", id)
        .eq("business_id", businessId)
        .select()
        .single();
      if (!error && data) {
        const norm = this.normalizeConversation(data);
        LocalConversationStore.updateConversation(id, businessId, patch);
        return norm;
      }
    } catch {}

    return LocalConversationStore.updateConversation(id, businessId, patch);
  }

  /**
   * Increments unread count and updates last_message_at.
   */
  async recordInboundActivity(
    id: string,
    businessId: string,
    receivedAt: string
  ): Promise<Conversation | null> {
    if (this.useDatabase()) {
      try {
        const sql = `
          UPDATE conversations
          SET unread_count = unread_count + 1,
              last_message_at = $3,
              status = 'active',
              updated_at = NOW()
          WHERE id = $1 AND business_id = $2
          RETURNING *;
        `;
        const res = await this.queryFn<QueryResultRow>(sql, [id, businessId, receivedAt]);
        if (res.rows[0]) {
          const norm = this.normalizeConversation(res.rows[0]);
          LocalConversationStore.updateConversation(id, businessId, {
            unread_count: norm.unread_count,
            last_message_at: receivedAt,
            status: "active",
          });
          return norm;
        }
        return null;
      } catch (err: unknown) {
        const error = err as { code?: string; message?: string };
        console.error(`[ConversationRepository] recordInboundActivity DB error:`, {
          operation: "UPDATE",
          table: "conversations",
          code: error?.code,
          message: error?.message,
          recordId: id,
          businessId,
        });
        if (this.isCustomQuery) throw err;
        return null;
      }
    }

    const current = LocalConversationStore.findConversationById(id, businessId);
    return LocalConversationStore.updateConversation(id, businessId, {
      unread_count: (current?.unread_count || 0) + 1,
      last_message_at: receivedAt,
      status: "active",
    });
  }

  /**
   * Resets unread count to 0 and marks messages as read.
   */
  async markAsRead(id: string, businessId: string): Promise<Conversation | null> {
    if (this.useDatabase()) {
      try {
        await this.queryFn(
          `UPDATE conversation_messages SET read_at = NOW() WHERE conversation_id = $1 AND business_id = $2 AND read_at IS NULL;`,
          [id, businessId]
        );
        const res = await this.queryFn<QueryResultRow>(
          `UPDATE conversations SET unread_count = 0, updated_at = NOW() WHERE id = $1 AND business_id = $2 RETURNING *;`,
          [id, businessId]
        );
        LocalConversationStore.markMessagesAsRead(id, businessId);
        LocalConversationStore.updateConversation(id, businessId, { unread_count: 0 });
        if (res.rows[0]) return this.normalizeConversation(res.rows[0]);
        return null;
      } catch (err: unknown) {
        const error = err as { code?: string; message?: string };
        console.error(`[ConversationRepository] markAsRead DB error:`, {
          operation: "UPDATE",
          table: "conversations",
          code: error?.code,
          message: error?.message,
          recordId: id,
          businessId,
        });
        if (this.isCustomQuery) throw err;
        return null;
      }
    }

    LocalConversationStore.markMessagesAsRead(id, businessId);
    return LocalConversationStore.updateConversation(id, businessId, { unread_count: 0 });
  }

  /**
   * Sets unread count to 1 and marks latest message as unread.
   */
  async markAsUnread(id: string, businessId: string): Promise<Conversation | null> {
    if (this.useDatabase()) {
      try {
        const res = await this.queryFn<QueryResultRow>(
          `UPDATE conversations SET unread_count = GREATEST(1, unread_count), updated_at = NOW() WHERE id = $1 AND business_id = $2 RETURNING *;`,
          [id, businessId]
        );
        LocalConversationStore.markLatestMessageAsUnread(id, businessId);
        LocalConversationStore.updateConversation(id, businessId, { unread_count: 1 });
        if (res.rows[0]) return this.normalizeConversation(res.rows[0]);
        return null;
      } catch (err: unknown) {
        const error = err as { code?: string; message?: string };
        console.error(`[ConversationRepository] markAsUnread DB error:`, {
          operation: "UPDATE",
          table: "conversations",
          code: error?.code,
          message: error?.message,
          recordId: id,
          businessId,
        });
        if (this.isCustomQuery) throw err;
        return null;
      }
    }

    LocalConversationStore.markLatestMessageAsUnread(id, businessId);
    return LocalConversationStore.updateConversation(id, businessId, { unread_count: 1 });
  }

  // ==========================================
  // Message Methods
  // ==========================================

  /**
   * Persists a conversation message.
   */
  async createMessage(input: CreateConversationMessageInput): Promise<ConversationMessage> {
    const id = input.id || crypto.randomUUID();
    const dir = input.direction.toUpperCase() === "INBOUND" ? "INBOUND" : "OUTBOUND";
    const fromVal = input.sender_email.trim().toLowerCase();
    const toVal = input.recipient_email.trim().toLowerCase();
    const receivedAt = input.received_at || new Date().toISOString();
    const attachmentsJson = JSON.stringify(input.attachments || []);

    if (this.useDatabase()) {
      try {
        const sql = `
          INSERT INTO conversation_messages (
            id, conversation_id, business_id, direction, sender_email,
            recipient_email, subject, body_text, body_html, provider_message_id,
            in_reply_to, received_at, read_at, attachments, created_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, NOW()
          ) ON CONFLICT (id) DO UPDATE SET
            body_text = COALESCE(EXCLUDED.body_text, conversation_messages.body_text),
            body_html = COALESCE(EXCLUDED.body_html, conversation_messages.body_html),
            provider_message_id = COALESCE(EXCLUDED.provider_message_id, conversation_messages.provider_message_id)
          RETURNING *;
        `;
        const res = await this.queryFn<QueryResultRow>(sql, [
          id,
          input.conversation_id,
          input.business_id,
          dir,
          fromVal,
          toVal,
          input.subject,
          input.body_text || null,
          input.body_html || null,
          input.provider_message_id || null,
          input.in_reply_to || null,
          receivedAt,
          input.read_at || null,
          attachmentsJson,
        ]);
        const record = this.normalizeMessage(res.rows[0]);
        LocalConversationStore.createMessage({ ...input, id });
        return record;
      } catch (err: unknown) {
        const error = err as { code?: string; message?: string };
        console.error(`[ConversationRepository] createMessage DB error:`, {
          operation: "INSERT",
          table: "conversation_messages",
          code: error?.code,
          message: error?.message,
          recordId: id,
          conversationId: input.conversation_id,
          businessId: input.business_id,
        });
        if (this.isCustomQuery) throw err;
      }
    }

    try {
      const admin = createAdminClient();
      const { data, error } = await admin
        .from("conversation_messages")
        .insert({
          id,
          conversation_id: input.conversation_id,
          business_id: input.business_id,
          direction: dir,
          sender_email: fromVal,
          recipient_email: toVal,
          subject: input.subject,
          body_text: input.body_text || null,
          body_html: input.body_html || null,
          provider_message_id: input.provider_message_id || null,
          in_reply_to: input.in_reply_to || null,
          received_at: receivedAt,
          read_at: input.read_at || null,
          attachments: input.attachments || [],
        })
        .select()
        .single();
      if (!error && data) {
        const record = this.normalizeMessage(data);
        LocalConversationStore.createMessage({ ...input, id });
        return record;
      }
    } catch {}

    return LocalConversationStore.createMessage({ ...input, id });
  }

  /**
   * Finds a message by external provider message ID (used for idempotency).
   */
  async findMessageByProviderId(providerMessageId: string): Promise<ConversationMessage | null> {
    if (!providerMessageId) return null;

    if (this.useDatabase()) {
      try {
        const sql = `SELECT * FROM conversation_messages WHERE provider_message_id = $1 LIMIT 1;`;
        const res = await this.queryFn<QueryResultRow>(sql, [providerMessageId]);
        if (res.rows.length > 0) return this.normalizeMessage(res.rows[0]);
        return null;
      } catch (err: unknown) {
        const error = err as { code?: string; message?: string };
        console.error(`[ConversationRepository] findMessageByProviderId DB error:`, {
          operation: "SELECT",
          table: "conversation_messages",
          code: error?.code,
          message: error?.message,
          providerMessageId,
        });
        if (this.isCustomQuery) throw err;
        return null;
      }
    }

    return LocalConversationStore.findMessageByProviderId(providerMessageId);
  }

  /**
   * Lists all messages in a conversation.
   */
  async listMessagesForConversation(
    conversationId: string,
    businessId: string
  ): Promise<ConversationMessage[]> {
    if (this.useDatabase()) {
      try {
        const sql = `
          SELECT * FROM conversation_messages
          WHERE conversation_id = $1 AND business_id = $2
          ORDER BY created_at ASC;
        `;
        const res = await this.queryFn<QueryResultRow>(sql, [conversationId, businessId]);
        if (res.rows.length > 0) return res.rows.map((r) => this.normalizeMessage(r));
        return [];
      } catch (err: unknown) {
        const error = err as { code?: string; message?: string };
        console.error(`[ConversationRepository] listMessagesForConversation DB error:`, {
          operation: "SELECT",
          table: "conversation_messages",
          code: error?.code,
          message: error?.message,
          conversationId,
          businessId,
        });
        if (this.isCustomQuery) throw err;
        return [];
      }
    }

    try {
      const admin = createAdminClient();
      const { data, error } = await admin
        .from("conversation_messages")
        .select("*")
        .eq("conversation_id", conversationId)
        .eq("business_id", businessId)
        .order("created_at", { ascending: true });
      if (!error && data && data.length > 0) {
        return data.map((d) => this.normalizeMessage(d));
      }
    } catch {}

    return LocalConversationStore.listMessages(conversationId, businessId);
  }

  async countInboundMessages(businessId: string): Promise<number> {
    if (this.useDatabase()) {
      try {
        const res = await this.queryFn<{ count: string }>(
          `SELECT COUNT(*) as count FROM conversation_messages WHERE business_id = $1 AND direction = 'INBOUND'`,
          [businessId]
        );
        return Number(res.rows[0]?.count || 0);
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }
    return LocalConversationStore.countInboundMessages(businessId);
  }

  // ==========================================
  // List, Search & Filter Methods
  // ==========================================

  /**
   * Server-side paginated list with Gmail-style search and filter tabs.
   */
  async listConversations(params: ConversationListParams): Promise<ConversationListResult> {
    const { businessId, filter = "all", search = "", page = 1, limit = 25 } = params;
    const offset = Math.max(0, (page - 1) * limit);

    if (this.useDatabase()) {
      try {
        const whereClauses = [`c.business_id = $1`];
        const queryParams: unknown[] = [businessId];
        let pIndex = 2;

        if (params.leadId) {
          whereClauses.push(`c.lead_id = $${pIndex++}`);
          queryParams.push(params.leadId);
        }

        if (params.campaignId) {
          whereClauses.push(`c.campaign_id = $${pIndex++}`);
          queryParams.push(params.campaignId);
        }

        if (filter === "unread") {
          whereClauses.push(`c.unread_count > 0`);
        } else if (filter === "read") {
          whereClauses.push(`c.unread_count = 0`);
        } else if (filter === "campaign") {
          whereClauses.push(`c.campaign_id IS NOT NULL`);
        } else if (filter === "unknown") {
          whereClauses.push(`(l.source = 'inbound_reply' OR l.first_name ILIKE '%Unknown%' OR l.last_name ILIKE '%Sender%')`);
        } else if (filter === "attachments") {
          whereClauses.push(`EXISTS (
            SELECT 1 FROM conversation_messages cm
            WHERE cm.conversation_id = c.id
              AND cm.attachments IS NOT NULL
              AND jsonb_typeof(cm.attachments) = 'array'
              AND jsonb_array_length(cm.attachments) > 0
          )`);
        }

        if (search.trim().length > 0) {
          const s = `%${search.trim().toLowerCase()}%`;
          whereClauses.push(`(
            LOWER(c.subject) LIKE $${pIndex}
            OR LOWER(l.email) LIKE $${pIndex}
            OR LOWER(CONCAT(l.first_name, ' ', l.last_name)) LIKE $${pIndex}
            OR LOWER(COALESCE(camp.name, '')) LIKE $${pIndex}
            OR EXISTS (
              SELECT 1 FROM conversation_messages cm
              WHERE cm.conversation_id = c.id
                AND (LOWER(cm.body_text) LIKE $${pIndex} OR LOWER(cm.body_html) LIKE $${pIndex})
            )
          )`);
          queryParams.push(s);
          pIndex++;
        }

        const whereSql = whereClauses.join(" AND ");

        // Total count
        const countSql = `
          SELECT COUNT(DISTINCT c.id) AS total,
                 COUNT(DISTINCT CASE WHEN c.unread_count > 0 THEN c.id END) AS unread_total
          FROM conversations c
          LEFT JOIN leads l ON l.id = c.lead_id
          LEFT JOIN campaigns camp ON camp.id = c.campaign_id
          WHERE ${whereSql};
        `;
        const countRes = await this.queryFn<QueryResultRow>(countSql, queryParams);
        const total = Number(countRes.rows[0]?.total || 0);
        const unreadTotal = Number(countRes.rows[0]?.unread_total || 0);

        // Fetch rows
        queryParams.push(limit);
        const limitParam = `$${pIndex++}`;
        queryParams.push(offset);
        const offsetParam = `$${pIndex++}`;

        const dataSql = `
          SELECT
            c.*,
            l.first_name,
            l.last_name,
            l.email AS lead_email,
            camp.name AS campaign_name,
            EXISTS (
              SELECT 1 FROM conversation_messages cm
              WHERE cm.conversation_id = c.id
                AND cm.attachments IS NOT NULL
                AND jsonb_typeof(cm.attachments) = 'array'
                AND jsonb_array_length(cm.attachments) > 0
            ) AS has_attachments,
            (
              SELECT COALESCE(cm.body_text, cm.subject)
              FROM conversation_messages cm
              WHERE cm.conversation_id = c.id
              ORDER BY cm.created_at DESC
              LIMIT 1
            ) AS latest_body
          FROM conversations c
          LEFT JOIN leads l ON l.id = c.lead_id
          LEFT JOIN campaigns camp ON camp.id = c.campaign_id
          WHERE ${whereSql}
          ORDER BY c.last_message_at DESC NULLS LAST, c.created_at DESC
          LIMIT ${limitParam} OFFSET ${offsetParam};
        `;
        const dataRes = await this.queryFn<QueryResultRow>(dataSql, queryParams);

        const items: ConversationListItem[] = dataRes.rows.map((r) => {
          const contactName = `${r.first_name || ""} ${r.last_name || ""}`.trim() || String(r.lead_email || "Unknown Contact");
          const unreadCount = Number(r.unread_count || 0);
          return {
            id: String(r.id),
            business_id: String(r.business_id),
            lead_id: String(r.lead_id),
            contact_id: String(r.lead_id),
            contact_name: contactName,
            contact_email: String(r.lead_email || ""),
            campaign_id: r.campaign_id ? String(r.campaign_id) : null,
            campaign_name: r.campaign_name ? String(r.campaign_name) : null,
            subject: String(r.subject || "No Subject"),
            status: (r.status as ConversationStatus) || "active",
            last_message_at: r.last_message_at ? new Date(String(r.last_message_at)).toISOString() : null,
            unread_count: unreadCount,
            is_unread: unreadCount > 0,
            has_attachments: Boolean(r.has_attachments),
            snippet: String(r.latest_body || r.subject || "").slice(0, 150),
            created_at: new Date(String(r.created_at)).toISOString(),
          };
        });

        return {
          conversations: items,
          total,
          unread_total: unreadTotal,
          page,
          limit,
          totalPages: Math.ceil(total / limit) || 1,
        };
      } catch (err: unknown) {
        const error = err as { code?: string; message?: string };
        console.error(`[ConversationRepository] listConversations query failed:`, {
          operation: "SELECT",
          table: "conversations",
          code: error?.code,
          message: error?.message,
          businessId,
        });
        if (this.isCustomQuery) throw err;
        return {
          conversations: [],
          total: 0,
          unread_total: 0,
          page,
          limit,
          totalPages: 1,
        };
      }
    }

    // Fallback: Local Store
    const allConvos = LocalConversationStore.listAllConversations(businessId);
    const allMsgs = LocalConversationStore.getAllMessages(businessId);

    // Read leads and campaigns from local storage for hydration
    const leadsRaw = (() => {
      try {
        const p = path.resolve(process.cwd(), ".data/leads.json");
        return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf-8")) : [];
      } catch {
        return [];
      }
    })();
    const leads: Array<{ id: string; email: string; first_name?: string; last_name?: string; source?: string }> =
      Array.isArray(leadsRaw) ? leadsRaw : [];

    const campRaw = (() => {
      try {
        const p = path.resolve(process.cwd(), ".data/campaigns.json");
        return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf-8")) : [];
      } catch {
        return [];
      }
    })();
    const campaigns: Array<{ id: string; name: string }> = Array.isArray(campRaw) ? campRaw : [];

    let filtered = allConvos.map((c) => {
      const lead = leads.find((l) => l.id === c.lead_id);
      const camp = campaigns.find((ca) => ca.id === c.campaign_id);
      const convoMsgs = allMsgs.filter((m) => m.conversation_id === c.id);
      convoMsgs.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      const latestMsg = convoMsgs[0];
      const hasAttachments = convoMsgs.some((m) => m.attachments && m.attachments.length > 0);
      const contactName = `${lead?.first_name || ""} ${lead?.last_name || ""}`.trim() || lead?.email || "Unknown Contact";

      return {
        ...c,
        contact_id: c.lead_id,
        contact_name: contactName,
        contact_email: lead?.email || "",
        campaign_name: camp?.name || null,
        has_attachments: hasAttachments,
        is_unread: c.unread_count > 0,
        snippet: (latestMsg?.body_text || latestMsg?.subject || c.subject).slice(0, 150),
        lead_source: lead?.source,
        messages: convoMsgs,
      };
    });

    // Apply Filter
    if (params.leadId) {
      filtered = filtered.filter((c) => c.lead_id === params.leadId);
    }
    if (params.campaignId) {
      filtered = filtered.filter((c) => c.campaign_id === params.campaignId);
    }

    if (filter === "unread") {
      filtered = filtered.filter((c) => c.unread_count > 0);
    } else if (filter === "read") {
      filtered = filtered.filter((c) => c.unread_count === 0);
    } else if (filter === "campaign") {
      filtered = filtered.filter((c) => Boolean(c.campaign_id));
    } else if (filter === "unknown") {
      filtered = filtered.filter(
        (c) =>
          c.lead_source === "inbound_reply" ||
          c.contact_name.toLowerCase().includes("unknown") ||
          c.contact_name.toLowerCase().includes("sender")
      );
    } else if (filter === "attachments") {
      filtered = filtered.filter((c) => c.has_attachments);
    }

    // Apply Search
    if (search.trim().length > 0) {
      const q = search.trim().toLowerCase();
      filtered = filtered.filter((c) => {
        return (
          c.subject.toLowerCase().includes(q) ||
          c.contact_name.toLowerCase().includes(q) ||
          c.contact_email.toLowerCase().includes(q) ||
          (c.campaign_name && c.campaign_name.toLowerCase().includes(q)) ||
          c.messages.some((m) => (m.body_text || "").toLowerCase().includes(q) || (m.body_html || "").toLowerCase().includes(q))
        );
      });
    }

    filtered.sort((a, b) => new Date(b.last_message_at || 0).getTime() - new Date(a.last_message_at || 0).getTime());

    const total = filtered.length;
    const unreadTotal = allConvos.filter((c) => c.unread_count > 0).length;
    const paginated = filtered.slice(offset, offset + limit);

    return {
      conversations: paginated.map((item) => ({
        id: item.id,
        business_id: item.business_id,
        lead_id: item.lead_id,
        contact_id: item.contact_id,
        contact_name: item.contact_name,
        contact_email: item.contact_email,
        campaign_id: item.campaign_id,
        campaign_name: item.campaign_name,
        subject: item.subject,
        status: item.status,
        last_message_at: item.last_message_at,
        unread_count: item.unread_count,
        is_unread: item.is_unread,
        has_attachments: item.has_attachments,
        snippet: item.snippet,
        created_at: item.created_at,
      })),
      total,
      unread_total: unreadTotal,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }
}
