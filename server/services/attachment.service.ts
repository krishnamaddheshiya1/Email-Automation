import {
  AttachmentRepository,
  CreateAttachmentInput,
} from "../repositories/attachment.repository";
import { SafetyAuditRepository } from "../repositories/safety-audit.repository";
import { CampaignRepository } from "../repositories/campaign.repository";
import {
  StorageProvider,
  getStorageProvider,
} from "../storage";
import {
  validateAttachment,
  generateAttachmentStorageKey,
  getMaxTotalAttachmentSize,
} from "../../lib/validations/attachment";
import {
  Attachment,
  CampaignStepAttachment,
  TemplateAttachment,
  EmailAttachment,
} from "../../types/attachment";
import { TemplateRepository } from "../repositories/template.repository";

export interface UploadAttachmentOptions {
  filename: string;
  mimeType: string;
  buffer: Buffer;
  campaignId?: string | null;
  campaignStepId?: string | null;
  templateId?: string | null;
}

export class AttachmentService {
  private attachmentRepo: AttachmentRepository;
  private safetyAuditRepo: SafetyAuditRepository;
  private campaignRepo: CampaignRepository;
  private templateRepo: TemplateRepository;
  private storage: StorageProvider;

  constructor(
    attachmentRepo?: AttachmentRepository,
    safetyAuditRepo?: SafetyAuditRepository,
    campaignRepo?: CampaignRepository,
    storage?: StorageProvider,
    templateRepo?: TemplateRepository
  ) {
    this.attachmentRepo = attachmentRepo || new AttachmentRepository();
    this.safetyAuditRepo = safetyAuditRepo || new SafetyAuditRepository();
    this.campaignRepo = campaignRepo || new CampaignRepository();
    this.templateRepo = templateRepo || new TemplateRepository();
    this.storage = storage || getStorageProvider();
  }

  /**
   * Uploads and registers a new file attachment strictly scoped to the tenant.
   */
  async uploadAttachment(
    businessId: string,
    userId: string,
    options: UploadAttachmentOptions
  ): Promise<Attachment> {
    if (!businessId) {
      throw new Error("Business ID is required for multi-tenant isolation.");
    }

    const { filename, mimeType, buffer, campaignId, campaignStepId, templateId } = options;

    // 1. Validate Campaign ownership if campaignId provided
    if (campaignId) {
      const campaign = await this.campaignRepo.findByIdAndBusinessId(campaignId, businessId);
      if (!campaign) {
        throw new Error("Campaign not found or access denied.");
      }
    }

    // 1b. Validate Template ownership if templateId provided
    if (templateId) {
      const template = await this.templateRepo.findByIdAndBusinessId(templateId, businessId);
      if (!template) {
        throw new Error("Template not found or access denied.");
      }
    }

    // 2. Server-side validation (Extension, MIME type, magic bytes, file size, filename security)
    const validation = validateAttachment({
      filename,
      mimeType,
      size: buffer.length,
      buffer,
    });

    if (!validation.valid) {
      await this.safetyAuditRepo.createLog({
        business_id: businessId,
        event_type: "attachment_rejected",
        reason: validation.error || "File validation failed",
        metadata: {
          filename,
          mimeType,
          size: buffer.length,
          campaignId: campaignId || null,
          templateId: templateId || null,
        },
      });
      throw new Error(validation.error || "File validation failed.");
    }

    // 3. Generate secure, tenant-isolated storage key
    const storageKey = generateAttachmentStorageKey(
      businessId,
      templateId || campaignId,
      validation.sanitizedFilename
    );

    // 4. Upload binary to storage abstraction
    await this.storage.upload(storageKey, buffer, validation.mimeType, {
      businessId,
      originalFilename: filename,
    });

    // 5. Persist attachment metadata in database
    const createInput: CreateAttachmentInput = {
      business_id: businessId,
      campaign_id: campaignId || null,
      template_id: templateId || null,
      filename: validation.sanitizedFilename,
      original_filename: filename,
      mime_type: validation.mimeType,
      file_size: buffer.length,
      storage_key: storageKey,
      storage_provider: this.storage.name,
      uploaded_by: userId || null,
      metadata: {
        category: validation.category,
        extension: validation.extension,
      },
    };

    const attachment = await this.attachmentRepo.create(createInput);

    // 6. Optionally associate with campaign step or template
    if (campaignStepId && campaignId) {
      await this.attachmentRepo.attachToStep(
        campaignStepId,
        attachment.id,
        campaignId,
        businessId
      );
    }
    if (templateId) {
      await this.attachmentRepo.attachToTemplate(
        templateId,
        attachment.id,
        businessId
      );
    }

    // 7. Record security audit log
    await this.safetyAuditRepo.createLog({
      business_id: businessId,
      event_type: "attachment_uploaded",
      reason: `Uploaded attachment "${validation.sanitizedFilename}" (${buffer.length} bytes)`,
      metadata: {
        attachment_id: attachment.id,
        filename: validation.sanitizedFilename,
        size: buffer.length,
        mime_type: validation.mimeType,
        campaign_id: campaignId || null,
        template_id: templateId || null,
      },
    });

    return attachment;
  }

  /**
   * Retrieves an attachment record ensuring tenant isolation.
   */
  async getAttachment(attachmentId: string, businessId: string): Promise<Attachment> {
    const attachment = await this.attachmentRepo.findByIdAndBusinessId(attachmentId, businessId);
    if (!attachment) {
      throw new Error("Attachment not found or access denied.");
    }
    return attachment;
  }

  /**
   * Downloads binary buffer for an attachment ensuring tenant isolation.
   */
  async downloadAttachment(
    attachmentId: string,
    businessId: string
  ): Promise<{ attachment: Attachment; buffer: Buffer }> {
    const attachment = await this.getAttachment(attachmentId, businessId);

    const exists = await this.storage.exists(attachment.storage_key);
    if (!exists) {
      throw new Error(`Attachment file missing from storage: "${attachment.filename}".`);
    }

    const buffer = await this.storage.download(attachment.storage_key);
    return { attachment, buffer };
  }

  /**
   * Deletes an attachment after ensuring it is not actively referenced by an active campaign.
   */
  async deleteAttachment(
    attachmentId: string,
    businessId: string,
    userId?: string
  ): Promise<boolean> {
    const attachment = await this.getAttachment(attachmentId, businessId);

    // Check if referenced by active campaign (Section 18)
    const { isReferenced, activeCampaignNames } =
      await this.attachmentRepo.isReferencedByActiveCampaign(attachmentId, businessId);

    if (isReferenced) {
      throw new Error(
        `Cannot delete attachment "${attachment.filename}": it is currently referenced by active campaign(s): ${activeCampaignNames.join(
          ", "
        )}. Please pause or complete the campaign first.`
      );
    }

    // Delete from storage
    try {
      await this.storage.delete(attachment.storage_key);
    } catch {
      // Non-blocking if storage object was already absent
    }

    // Soft delete metadata
    const success = await this.attachmentRepo.softDelete(attachmentId, businessId);

    if (success) {
      await this.safetyAuditRepo.createLog({
        business_id: businessId,
        event_type: "attachment_deleted",
        reason: `Deleted attachment "${attachment.filename}"`,
        metadata: {
          attachment_id: attachmentId,
          deleted_by_user_id: userId || null,
        },
      });
    }

    return success;
  }

  /**
   * Lists attachments for a business, optionally filtered by campaign or template.
   */
  async listAttachments(
    businessId: string,
    options?: { campaignId?: string; templateId?: string; limit?: number; offset?: number }
  ): Promise<Attachment[]> {
    if (options?.campaignId) {
      return this.listCampaignAttachments(options.campaignId, businessId);
    }
    if (options?.templateId) {
      return this.getTemplateAttachments(options.templateId, businessId);
    }
    return this.attachmentRepo.listByBusiness(
      businessId,
      options?.limit || 50,
      options?.offset || 0
    );
  }

  /**
   * Lists attachments belonging to a campaign.
   */
  async listCampaignAttachments(campaignId: string, businessId: string): Promise<Attachment[]> {
    const campaign = await this.campaignRepo.findByIdAndBusinessId(campaignId, businessId);
    if (!campaign) {
      throw new Error("Campaign not found or access denied.");
    }
    return this.attachmentRepo.findByCampaignId(campaignId, businessId);
  }

  /**
   * Lists attachments belonging to a template.
   */
  async getTemplateAttachments(templateId: string, businessId: string): Promise<Attachment[]> {
    const template = await this.templateRepo.findByIdAndBusinessId(templateId, businessId);
    if (!template) {
      throw new Error("Template not found or access denied.");
    }
    return this.attachmentRepo.findByTemplateId(templateId, businessId);
  }

  /**
   * Associates an attachment with a template.
   */
  async attachToTemplate(
    templateId: string,
    attachmentId: string,
    businessId: string
  ): Promise<TemplateAttachment> {
    await this.getAttachment(attachmentId, businessId);
    const template = await this.templateRepo.findByIdAndBusinessId(templateId, businessId);
    if (!template) {
      throw new Error("Template not found or access denied.");
    }

    const result = await this.attachmentRepo.attachToTemplate(
      templateId,
      attachmentId,
      businessId
    );

    await this.safetyAuditRepo.createLog({
      business_id: businessId,
      event_type: "attachment_attached",
      reason: `Attached file to template ${templateId}`,
      metadata: { attachment_id: attachmentId, template_id: templateId },
    });

    return result;
  }

  /**
   * Detaches an attachment from a template.
   */
  async detachFromTemplate(
    templateId: string,
    attachmentId: string,
    businessId: string
  ): Promise<boolean> {
    const success = await this.attachmentRepo.detachFromTemplate(
      templateId,
      attachmentId,
      businessId
    );

    if (success) {
      await this.safetyAuditRepo.createLog({
        business_id: businessId,
        event_type: "attachment_removed",
        reason: `Detached file from template ${templateId}`,
        metadata: { attachment_id: attachmentId, template_id: templateId },
      });
    }

    return success;
  }

  /**
   * Associates an attachment with a campaign step.
   */
  async attachToStep(
    campaignStepId: string,
    attachmentId: string,
    campaignId: string,
    businessId: string
  ): Promise<CampaignStepAttachment> {
    // Verify ownership of both attachment and campaign
    await this.getAttachment(attachmentId, businessId);
    const campaign = await this.campaignRepo.findByIdAndBusinessId(campaignId, businessId);
    if (!campaign) {
      throw new Error("Campaign not found or access denied.");
    }

    const result = await this.attachmentRepo.attachToStep(
      campaignStepId,
      attachmentId,
      campaignId,
      businessId
    );

    await this.safetyAuditRepo.createLog({
      business_id: businessId,
      event_type: "attachment_attached",
      reason: `Attached file to campaign step ${campaignStepId}`,
      metadata: { attachment_id: attachmentId, campaign_step_id: campaignStepId, campaign_id: campaignId },
    });

    return result;
  }

  /**
   * Detaches an attachment from a campaign step.
   */
  async detachFromStep(
    campaignStepId: string,
    attachmentId: string,
    businessId: string
  ): Promise<boolean> {
    const success = await this.attachmentRepo.detachFromStep(
      campaignStepId,
      attachmentId,
      businessId
    );

    if (success) {
      await this.safetyAuditRepo.createLog({
        business_id: businessId,
        event_type: "attachment_removed",
        reason: `Detached file from campaign step ${campaignStepId}`,
        metadata: { attachment_id: attachmentId, campaign_step_id: campaignStepId },
      });
    }

    return success;
  }

  /**
   * Retrieves step attachments.
   */
  async getStepAttachments(
    campaignStepId: string,
    businessId: string
  ): Promise<Attachment[]> {
    const stepAttachments = await this.attachmentRepo.findStepAttachments(
      campaignStepId,
      businessId
    );
    return stepAttachments.map((s) => s.attachment).filter(Boolean);
  }

  /**
   * Loads, validates, and prepares attachments for email delivery.
   *
   * SECTION 17 & 23:
   * - If an attachment is missing from storage, throws error and prevents unsafe send.
   * - Enforces MAX_TOTAL_ATTACHMENT_SIZE before delivery.
   */
  async prepareAttachmentsForEmail(
    attachmentIds: string[],
    businessId: string
  ): Promise<EmailAttachment[]> {
    if (!attachmentIds || attachmentIds.length === 0) {
      return [];
    }

    const uniqueIds = Array.from(new Set(attachmentIds));
    const attachments: EmailAttachment[] = [];
    let totalSize = 0;
    const maxTotalSize = getMaxTotalAttachmentSize();

    for (const id of uniqueIds) {
      const att = await this.attachmentRepo.findByIdAndBusinessId(id, businessId);
      if (!att) {
        await this.safetyAuditRepo.createLog({
          business_id: businessId,
          event_type: "attachment_send_failed",
          reason: `Attachment record ID ${id} not found or deleted`,
          metadata: { attachment_id: id },
        });
        throw new Error(`Referenced attachment ID "${id}" does not exist or has been deleted.`);
      }

      // Check storage existence
      const exists = await this.storage.exists(att.storage_key);
      if (!exists) {
        await this.safetyAuditRepo.createLog({
          business_id: businessId,
          event_type: "attachment_send_failed",
          reason: `Attachment file missing from storage: "${att.filename}"`,
          metadata: { attachment_id: id, filename: att.filename, storage_key: att.storage_key },
        });
        throw new Error(
          `Delivery halted: Attachment "${att.filename}" no longer exists in storage.`
        );
      }

      totalSize += Number(att.file_size);
      if (totalSize > maxTotalSize) {
        throw new Error(
          `Total attachment size (${(totalSize / (1024 * 1024)).toFixed(1)} MB) exceeds email provider limit (${(maxTotalSize / (1024 * 1024)).toFixed(1)} MB).`
        );
      }

      const buffer = await this.storage.download(att.storage_key);
      attachments.push({
        filename: att.filename,
        content: buffer,
        contentType: att.mime_type,
        size: Number(att.file_size),
      });
    }

    return attachments;
  }
}

export const attachmentService = new AttachmentService();
