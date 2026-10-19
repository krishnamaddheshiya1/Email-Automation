import fs from "fs";
import path from "path";
import crypto from "crypto";
import { query, isDbConfigured } from "../db/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { Attachment, CampaignStepAttachment, TemplateAttachment } from "../../types/attachment";

export interface CreateAttachmentInput {
  business_id: string;
  campaign_id?: string | null;
  template_id?: string | null;
  filename: string;
  original_filename: string;
  mime_type: string;
  file_size: number;
  storage_key: string;
  storage_provider?: string;
  storage_url?: string | null;
  uploaded_by?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Resilient local file-backed persistence store for attachments.
 * Used when direct PostgreSQL (DATABASE_URL) is unconfigured or unavailable.
 */
class LocalAttachmentStore {
  private static attachmentsFile = path.resolve(process.cwd(), ".data/attachments.json");
  private static templateAttachmentsFile = path.resolve(process.cwd(), ".data/template_attachments.json");
  private static stepAttachmentsFile = path.resolve(process.cwd(), ".data/campaign_step_attachments.json");

  private static attachmentsCache: Attachment[] | null = null;
  private static templateAttachmentsCache: TemplateAttachment[] | null = null;
  private static stepAttachmentsCache: CampaignStepAttachment[] | null = null;

  private static loadAttachments(): Attachment[] {
    if (this.attachmentsCache !== null) return this.attachmentsCache;
    try {
      if (fs.existsSync(this.attachmentsFile)) {
        const raw = fs.readFileSync(this.attachmentsFile, "utf-8");
        this.attachmentsCache = JSON.parse(raw);
        return this.attachmentsCache || [];
      }
    } catch {
      // Ignore read error
    }
    this.attachmentsCache = [];
    return this.attachmentsCache;
  }

  private static saveAttachments(): void {
    try {
      const dir = path.dirname(this.attachmentsFile);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.attachmentsFile, JSON.stringify(this.attachmentsCache || [], null, 2), "utf-8");
    } catch (err) {
      console.warn("Could not save to local attachments store:", err);
    }
  }

  private static loadTemplateAttachments(): TemplateAttachment[] {
    if (this.templateAttachmentsCache !== null) return this.templateAttachmentsCache;
    try {
      if (fs.existsSync(this.templateAttachmentsFile)) {
        const raw = fs.readFileSync(this.templateAttachmentsFile, "utf-8");
        this.templateAttachmentsCache = JSON.parse(raw);
        return this.templateAttachmentsCache || [];
      }
    } catch {
      // Ignore read error
    }
    this.templateAttachmentsCache = [];
    return this.templateAttachmentsCache;
  }

  private static saveTemplateAttachments(): void {
    try {
      const dir = path.dirname(this.templateAttachmentsFile);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.templateAttachmentsFile, JSON.stringify(this.templateAttachmentsCache || [], null, 2), "utf-8");
    } catch (err) {
      console.warn("Could not save to local template attachments store:", err);
    }
  }

  private static loadStepAttachments(): CampaignStepAttachment[] {
    if (this.stepAttachmentsCache !== null) return this.stepAttachmentsCache;
    try {
      if (fs.existsSync(this.stepAttachmentsFile)) {
        const raw = fs.readFileSync(this.stepAttachmentsFile, "utf-8");
        this.stepAttachmentsCache = JSON.parse(raw);
        return this.stepAttachmentsCache || [];
      }
    } catch {
      // Ignore read error
    }
    this.stepAttachmentsCache = [];
    return this.stepAttachmentsCache;
  }

  private static saveStepAttachments(): void {
    try {
      const dir = path.dirname(this.stepAttachmentsFile);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.stepAttachmentsFile, JSON.stringify(this.stepAttachmentsCache || [], null, 2), "utf-8");
    } catch (err) {
      console.warn("Could not save to local step attachments store:", err);
    }
  }

  static create(input: CreateAttachmentInput): Attachment {
    const list = this.loadAttachments();
    const now = new Date().toISOString();
    const item: Attachment = {
      id: crypto.randomUUID(),
      business_id: input.business_id,
      campaign_id: input.campaign_id || null,
      template_id: input.template_id || null,
      filename: input.filename,
      original_filename: input.original_filename,
      mime_type: input.mime_type,
      file_size: input.file_size,
      storage_key: input.storage_key,
      storage_provider: input.storage_provider || "local",
      storage_url: input.storage_url || null,
      uploaded_by: input.uploaded_by || null,
      metadata: input.metadata || {},
      deleted_at: null,
      created_at: now,
      updated_at: now,
    };
    list.unshift(item);
    this.saveAttachments();
    return item;
  }

  static findByIdAndBusinessId(id: string, businessId: string): Attachment | null {
    const list = this.loadAttachments();
    return list.find((a) => a.id === id && a.business_id === businessId && !a.deleted_at) || null;
  }

  static findByCampaignId(campaignId: string, businessId: string): Attachment[] {
    const list = this.loadAttachments();
    return list
      .filter((a) => a.campaign_id === campaignId && a.business_id === businessId && !a.deleted_at)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }

  static findByTemplateId(templateId: string, businessId: string): Attachment[] {
    const junctions = this.loadTemplateAttachments().filter(
      (ta) => ta.template_id === templateId && ta.business_id === businessId
    );
    const junctionIds = new Set(junctions.map((ta) => ta.attachment_id));
    const list = this.loadAttachments();
    return list
      .filter(
        (a) =>
          (junctionIds.has(a.id) || a.template_id === templateId) &&
          a.business_id === businessId &&
          !a.deleted_at
      )
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }

  static listByBusiness(businessId: string, limit = 50, offset = 0): Attachment[] {
    const list = this.loadAttachments();
    return list
      .filter((a) => a.business_id === businessId && !a.deleted_at)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(offset, offset + limit);
  }

  static attachToTemplate(
    templateId: string,
    attachmentId: string,
    businessId: string
  ): TemplateAttachment {
    const list = this.loadTemplateAttachments();
    const existing = list.find((ta) => ta.template_id === templateId && ta.attachment_id === attachmentId);
    if (existing) return existing;

    const record: TemplateAttachment = {
      id: crypto.randomUUID(),
      business_id: businessId,
      template_id: templateId,
      attachment_id: attachmentId,
      created_at: new Date().toISOString(),
    };
    list.push(record);
    this.saveTemplateAttachments();
    return record;
  }

  static detachFromTemplate(
    templateId: string,
    attachmentId: string,
    businessId: string
  ): boolean {
    const list = this.loadTemplateAttachments();
    const idx = list.findIndex(
      (ta) => ta.template_id === templateId && ta.attachment_id === attachmentId && ta.business_id === businessId
    );
    if (idx !== -1) {
      list.splice(idx, 1);
      this.saveTemplateAttachments();
    }

    // Also clear template_id on attachment if present
    const attList = this.loadAttachments();
    const att = attList.find((a) => a.id === attachmentId && a.template_id === templateId);
    if (att) {
      att.template_id = null;
      this.saveAttachments();
    }

    return true;
  }

  static findTemplateAttachments(
    templateId: string,
    businessId: string
  ): (TemplateAttachment & { attachment: Attachment })[] {
    const junctions = this.loadTemplateAttachments().filter(
      (ta) => ta.template_id === templateId && ta.business_id === businessId
    );
    const attachments = this.loadAttachments();
    return junctions
      .map((ta) => {
        const att = attachments.find((a) => a.id === ta.attachment_id && !a.deleted_at);
        if (!att) return null;
        return { ...ta, attachment: att };
      })
      .filter(Boolean) as (TemplateAttachment & { attachment: Attachment })[];
  }

  static attachToStep(
    campaignStepId: string,
    attachmentId: string,
    campaignId: string,
    businessId: string
  ): CampaignStepAttachment {
    const list = this.loadStepAttachments();
    const existing = list.find(
      (s) => s.campaign_step_id === campaignStepId && s.attachment_id === attachmentId
    );
    if (existing) return existing;

    const record: CampaignStepAttachment = {
      id: crypto.randomUUID(),
      business_id: businessId,
      campaign_id: campaignId,
      campaign_step_id: campaignStepId,
      attachment_id: attachmentId,
      created_at: new Date().toISOString(),
    };
    list.push(record);
    this.saveStepAttachments();
    return record;
  }

  static detachFromStep(
    campaignStepId: string,
    attachmentId: string,
    businessId: string
  ): boolean {
    const list = this.loadStepAttachments();
    const idx = list.findIndex(
      (s) => s.campaign_step_id === campaignStepId && s.attachment_id === attachmentId && s.business_id === businessId
    );
    if (idx === -1) return false;
    list.splice(idx, 1);
    this.saveStepAttachments();
    return true;
  }

  static findStepAttachments(
    campaignStepId: string,
    businessId: string
  ): (CampaignStepAttachment & { attachment: Attachment })[] {
    const junctions = this.loadStepAttachments().filter(
      (s) => s.campaign_step_id === campaignStepId && s.business_id === businessId
    );
    const attachments = this.loadAttachments();
    return junctions
      .map((s) => {
        const att = attachments.find((a) => a.id === s.attachment_id && !a.deleted_at);
        if (!att) return null;
        return { ...s, attachment: att };
      })
      .filter(Boolean) as (CampaignStepAttachment & { attachment: Attachment })[];
  }

  static softDelete(id: string, businessId: string): boolean {
    const list = this.loadAttachments();
    const att = list.find((a) => a.id === id && a.business_id === businessId && !a.deleted_at);
    if (!att) return false;
    att.deleted_at = new Date().toISOString();
    this.saveAttachments();
    return true;
  }

  static hardDelete(id: string, businessId: string): boolean {
    const list = this.loadAttachments();
    const idx = list.findIndex((a) => a.id === id && a.business_id === businessId);
    if (idx === -1) return false;
    list.splice(idx, 1);
    this.saveAttachments();
    return true;
  }
}

export class AttachmentRepository {
  private queryFn: typeof query;
  private isCustomQuery: boolean;

  constructor(queryFn?: typeof query) {
    this.isCustomQuery = Boolean(queryFn);
    this.queryFn = queryFn || query;
  }

  private useDatabase(): boolean {
    return this.isCustomQuery || isDbConfigured();
  }

  async create(input: CreateAttachmentInput): Promise<Attachment> {
    if (this.useDatabase()) {
      try {
        const sql = `
          INSERT INTO attachments (
            business_id,
            campaign_id,
            template_id,
            filename,
            original_filename,
            mime_type,
            file_size,
            storage_key,
            storage_provider,
            storage_url,
            uploaded_by,
            metadata,
            created_at,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())
          RETURNING *;
        `;
        const params = [
          input.business_id,
          input.campaign_id || null,
          input.template_id || null,
          input.filename,
          input.original_filename,
          input.mime_type,
          input.file_size,
          input.storage_key,
          input.storage_provider || "local",
          input.storage_url || null,
          input.uploaded_by || null,
          JSON.stringify(input.metadata || {}),
        ];

        const result = await this.queryFn<Attachment>(sql, params);
        return result.rows[0];
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }

    try {
      const admin = createAdminClient();
      const { data, error } = await admin
        .from("attachments")
        .insert({
          business_id: input.business_id,
          campaign_id: input.campaign_id || null,
          template_id: input.template_id || null,
          filename: input.filename,
          original_filename: input.original_filename,
          mime_type: input.mime_type,
          file_size: input.file_size,
          storage_key: input.storage_key,
          storage_provider: input.storage_provider || "local",
          storage_url: input.storage_url || null,
          uploaded_by: input.uploaded_by || null,
          metadata: input.metadata || {},
        })
        .select("*")
        .single();
      if (!error && data) return data as Attachment;
    } catch {
      // Fallback to local file store
    }

    return LocalAttachmentStore.create(input);
  }

  async findByIdAndBusinessId(id: string, businessId: string): Promise<Attachment | null> {
    if (this.useDatabase()) {
      try {
        const sql = `
          SELECT * FROM attachments
          WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL;
        `;
        const result = await this.queryFn<Attachment>(sql, [id, businessId]);
        return result.rows[0] || null;
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }

    try {
      const admin = createAdminClient();
      const { data, error } = await admin
        .from("attachments")
        .select("*")
        .eq("id", id)
        .eq("business_id", businessId)
        .is("deleted_at", null)
        .maybeSingle();
      if (!error && data) return data as Attachment;
    } catch {
      // Fallback
    }

    return LocalAttachmentStore.findByIdAndBusinessId(id, businessId);
  }

  async findByCampaignId(campaignId: string, businessId: string): Promise<Attachment[]> {
    if (this.useDatabase()) {
      try {
        const sql = `
          SELECT * FROM attachments
          WHERE campaign_id = $1 AND business_id = $2 AND deleted_at IS NULL
          ORDER BY created_at DESC;
        `;
        const result = await this.queryFn<Attachment>(sql, [campaignId, businessId]);
        return result.rows;
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }

    try {
      const admin = createAdminClient();
      const { data, error } = await admin
        .from("attachments")
        .select("*")
        .eq("campaign_id", campaignId)
        .eq("business_id", businessId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false });
      if (!error && data) return data as Attachment[];
    } catch {
      // Fallback
    }

    return LocalAttachmentStore.findByCampaignId(campaignId, businessId);
  }

  async findByTemplateId(templateId: string, businessId: string): Promise<Attachment[]> {
    if (this.useDatabase()) {
      try {
        const sql = `
          SELECT DISTINCT a.* FROM attachments a
          JOIN template_attachments ta ON ta.attachment_id = a.id
          WHERE ta.template_id = $1
            AND a.business_id = $2
            AND a.deleted_at IS NULL
          ORDER BY a.created_at DESC;
        `;
        const result = await this.queryFn<Attachment>(sql, [templateId, businessId]);
        return result.rows;
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }

    try {
      const admin = createAdminClient();
      const { data: junctions } = await admin
        .from("template_attachments")
        .select("attachment_id")
        .eq("template_id", templateId)
        .eq("business_id", businessId);

      if (junctions && junctions.length > 0) {
        const attIds = junctions.map((j) => j.attachment_id);
        const { data: atts, error } = await admin
          .from("attachments")
          .select("*")
          .in("id", attIds)
          .eq("business_id", businessId)
          .is("deleted_at", null)
          .order("created_at", { ascending: false });
        if (!error && atts) return atts as Attachment[];
      }
    } catch {
      // Fallback
    }

    return LocalAttachmentStore.findByTemplateId(templateId, businessId);
  }

  async listByBusiness(businessId: string, limit = 50, offset = 0): Promise<Attachment[]> {
    if (this.useDatabase()) {
      try {
        const sql = `
          SELECT * FROM attachments
          WHERE business_id = $1 AND deleted_at IS NULL
          ORDER BY created_at DESC
          LIMIT $2 OFFSET $3;
        `;
        const result = await this.queryFn<Attachment>(sql, [businessId, limit, offset]);
        return result.rows;
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }

    try {
      const admin = createAdminClient();
      const { data, error } = await admin
        .from("attachments")
        .select("*")
        .eq("business_id", businessId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);
      if (!error && data) return data as Attachment[];
    } catch {
      // Fallback
    }

    return LocalAttachmentStore.listByBusiness(businessId, limit, offset);
  }

  async attachToTemplate(
    templateId: string,
    attachmentId: string,
    businessId: string
  ): Promise<TemplateAttachment> {
    if (this.useDatabase()) {
      try {
        const sql = `
          INSERT INTO template_attachments (
            business_id,
            template_id,
            attachment_id,
            created_at
          )
          VALUES ($1, $2, $3, NOW())
          ON CONFLICT (template_id, attachment_id) DO UPDATE
          SET created_at = NOW()
          RETURNING *;
        `;
        const result = await this.queryFn<TemplateAttachment>(sql, [
          businessId,
          templateId,
          attachmentId,
        ]);
        return result.rows[0];
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }

    try {
      const admin = createAdminClient();
      const { data, error } = await admin
        .from("template_attachments")
        .upsert(
          {
            business_id: businessId,
            template_id: templateId,
            attachment_id: attachmentId,
          },
          { onConflict: "template_id,attachment_id" }
        )
        .select("*")
        .single();
      if (!error && data) return data as TemplateAttachment;
    } catch {
      // Fallback
    }

    return LocalAttachmentStore.attachToTemplate(templateId, attachmentId, businessId);
  }

  async detachFromTemplate(
    templateId: string,
    attachmentId: string,
    businessId: string
  ): Promise<boolean> {
    if (this.useDatabase()) {
      try {
        const sql1 = `
          DELETE FROM template_attachments
          WHERE template_id = $1 AND attachment_id = $2 AND business_id = $3;
        `;
        const sql2 = `
          UPDATE attachments SET template_id = NULL
          WHERE id = $2 AND template_id = $1 AND business_id = $3;
        `;
        const result = await this.queryFn(sql1, [templateId, attachmentId, businessId]);
        await this.queryFn(sql2, [templateId, attachmentId, businessId]);
        return (result.rowCount ?? 0) > 0;
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }

    try {
      const admin = createAdminClient();
      await admin
        .from("template_attachments")
        .delete()
        .eq("template_id", templateId)
        .eq("attachment_id", attachmentId)
        .eq("business_id", businessId);
      await admin
        .from("attachments")
        .update({ template_id: null })
        .eq("id", attachmentId)
        .eq("template_id", templateId)
        .eq("business_id", businessId);
    } catch {
      // Fallback
    }

    return LocalAttachmentStore.detachFromTemplate(templateId, attachmentId, businessId);
  }

  async findTemplateAttachments(
    templateId: string,
    businessId: string
  ): Promise<(TemplateAttachment & { attachment: Attachment })[]> {
    if (this.useDatabase()) {
      try {
        const sql = `
          SELECT 
            ta.*,
            row_to_json(a.*) as attachment
          FROM template_attachments ta
          JOIN attachments a ON a.id = ta.attachment_id
          WHERE ta.template_id = $1 
            AND ta.business_id = $2
            AND a.deleted_at IS NULL
          ORDER BY ta.created_at ASC;
        `;
        const result = await this.queryFn<{
          id: string;
          business_id: string;
          template_id: string;
          attachment_id: string;
          created_at: string;
          attachment: Attachment;
        }>(sql, [templateId, businessId]);
        return result.rows;
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }

    return LocalAttachmentStore.findTemplateAttachments(templateId, businessId);
  }

  async attachToStep(
    campaignStepId: string,
    attachmentId: string,
    campaignId: string,
    businessId: string
  ): Promise<CampaignStepAttachment> {
    if (this.useDatabase()) {
      try {
        const sql = `
          INSERT INTO campaign_step_attachments (
            business_id,
            campaign_id,
            campaign_step_id,
            attachment_id,
            created_at
          )
          VALUES ($1, $2, $3, $4, NOW())
          ON CONFLICT (campaign_step_id, attachment_id) DO UPDATE
          SET created_at = NOW()
          RETURNING *;
        `;
        const result = await this.queryFn<CampaignStepAttachment>(sql, [
          businessId,
          campaignId,
          campaignStepId,
          attachmentId,
        ]);
        return result.rows[0];
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }

    try {
      const admin = createAdminClient();
      const { data, error } = await admin
        .from("campaign_step_attachments")
        .upsert(
          {
            business_id: businessId,
            campaign_id: campaignId,
            campaign_step_id: campaignStepId,
            attachment_id: attachmentId,
          },
          { onConflict: "campaign_step_id,attachment_id" }
        )
        .select("*")
        .single();
      if (!error && data) return data as CampaignStepAttachment;
    } catch {
      // Fallback
    }

    return LocalAttachmentStore.attachToStep(campaignStepId, attachmentId, campaignId, businessId);
  }

  async detachFromStep(
    campaignStepId: string,
    attachmentId: string,
    businessId: string
  ): Promise<boolean> {
    if (this.useDatabase()) {
      try {
        const sql = `
          DELETE FROM campaign_step_attachments
          WHERE campaign_step_id = $1 AND attachment_id = $2 AND business_id = $3;
        `;
        const result = await this.queryFn(sql, [campaignStepId, attachmentId, businessId]);
        return (result.rowCount ?? 0) > 0;
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }

    try {
      const admin = createAdminClient();
      await admin
        .from("campaign_step_attachments")
        .delete()
        .eq("campaign_step_id", campaignStepId)
        .eq("attachment_id", attachmentId)
        .eq("business_id", businessId);
    } catch {
      // Fallback
    }

    return LocalAttachmentStore.detachFromStep(campaignStepId, attachmentId, businessId);
  }

  async findStepAttachments(
    campaignStepId: string,
    businessId: string
  ): Promise<(CampaignStepAttachment & { attachment: Attachment })[]> {
    if (this.useDatabase()) {
      try {
        const sql = `
          SELECT 
            csa.*,
            row_to_json(a.*) as attachment
          FROM campaign_step_attachments csa
          JOIN attachments a ON a.id = csa.attachment_id
          WHERE csa.campaign_step_id = $1 
            AND csa.business_id = $2
            AND a.deleted_at IS NULL
          ORDER BY csa.created_at ASC;
        `;
        const result = await this.queryFn<{
          id: string;
          business_id: string;
          campaign_id: string;
          campaign_step_id: string;
          attachment_id: string;
          created_at: string;
          attachment: Attachment;
        }>(sql, [campaignStepId, businessId]);
        return result.rows;
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }

    return LocalAttachmentStore.findStepAttachments(campaignStepId, businessId);
  }

  async isReferencedByActiveCampaign(
    attachmentId: string,
    businessId: string
  ): Promise<{ isReferenced: boolean; activeCampaignNames: string[] }> {
    if (this.useDatabase()) {
      try {
        const sql = `
          SELECT DISTINCT c.name
          FROM campaigns c
          WHERE c.business_id = $1 
            AND UPPER(c.status) = 'ACTIVE'
            AND (
              c.id IN (
                SELECT campaign_id FROM attachments 
                WHERE id = $2 AND business_id = $1 AND deleted_at IS NULL
              )
              OR c.id IN (
                SELECT campaign_id FROM campaign_step_attachments
                WHERE attachment_id = $2 AND business_id = $1
              )
              OR c.id IN (
                SELECT cs.campaign_id FROM campaign_steps cs
                JOIN template_attachments ta ON ta.template_id = cs.template_id
                WHERE ta.attachment_id = $2 AND ta.business_id = $1
              )
              OR c.id IN (
                SELECT cs.campaign_id FROM campaign_steps cs
                JOIN attachments a ON a.template_id = cs.template_id
                WHERE a.id = $2 AND a.business_id = $1 AND a.deleted_at IS NULL
              )
            );
        `;
        const result = await this.queryFn<{ name: string }>(sql, [businessId, attachmentId]);
        const names = result.rows.map((r) => r.name);
        return {
          isReferenced: names.length > 0,
          activeCampaignNames: names,
        };
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }

    // Default safe check for local fallback mode
    return {
      isReferenced: false,
      activeCampaignNames: [],
    };
  }

  async softDelete(id: string, businessId: string): Promise<boolean> {
    if (this.useDatabase()) {
      try {
        const sql = `
          UPDATE attachments
          SET deleted_at = NOW(), updated_at = NOW()
          WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL;
        `;
        const result = await this.queryFn(sql, [id, businessId]);
        return (result.rowCount ?? 0) > 0;
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }

    try {
      const admin = createAdminClient();
      await admin
        .from("attachments")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", id)
        .eq("business_id", businessId);
    } catch {
      // Fallback
    }

    return LocalAttachmentStore.softDelete(id, businessId);
  }

  async hardDelete(id: string, businessId: string): Promise<boolean> {
    if (this.useDatabase()) {
      try {
        const sql = `
          DELETE FROM attachments
          WHERE id = $1 AND business_id = $2;
        `;
        const result = await this.queryFn(sql, [id, businessId]);
        return (result.rowCount ?? 0) > 0;
      } catch (err) {
        if (this.isCustomQuery) throw err;
      }
    }

    return LocalAttachmentStore.hardDelete(id, businessId);
  }
}
