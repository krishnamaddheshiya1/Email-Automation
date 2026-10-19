/**
 * Phase 15: File Attachments Domain Types & Contracts
 */

export type AttachmentCategory =
  | "image"
  | "document"
  | "spreadsheet"
  | "video"
  | "archive";

export interface Attachment {
  id: string;
  business_id: string;
  campaign_id: string | null;
  template_id?: string | null;
  filename: string;
  original_filename: string;
  mime_type: string;
  file_size: number;
  storage_key: string;
  storage_provider: string;
  storage_url: string | null;
  uploaded_by: string | null;
  metadata: Record<string, unknown>;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CampaignStepAttachment {
  id: string;
  business_id: string;
  campaign_id: string;
  campaign_step_id: string;
  attachment_id: string;
  created_at: string;
  attachment?: Attachment;
}

export interface TemplateAttachment {
  id: string;
  business_id: string;
  template_id: string;
  attachment_id: string;
  created_at: string;
  attachment?: Attachment;
}

export interface AttachmentMetadataResponse {
  id: string;
  filename: string;
  original_filename: string;
  mime_type: string;
  file_size: number;
  category: AttachmentCategory;
  campaign_id: string | null;
  template_id?: string | null;
  uploaded_by: string | null;
  created_at: string;
  download_url?: string;
  thumbnail_url?: string;
}

export interface EmailAttachment {
  filename: string;
  content: Buffer | string;
  contentType: string;
  size?: number;
}
