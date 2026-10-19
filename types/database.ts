/**
 * Database Domain Models & Enums for Email Automation Platform
 * Represents the 12 core PostgreSQL tables with strict TypeScript types.
 */

// ==========================================
// Status Enums & Literal Unions
// ==========================================
export type BusinessStatus = "active" | "suspended" | "archived";
export type UserRole = "owner" | "admin" | "member" | "viewer";
export type UserStatus = "active" | "inactive" | "invited";
export type LeadStatus =
  | "new"
  | "contacted"
  | "replied"
  | "interested"
  | "not_interested"
  | "qualified"
  | "unqualified"
  | "converted"
  | "bounced"
  | "unsubscribed"
  | "archived"
  | "NEW"
  | "CONTACTED"
  | "REPLIED"
  | "INTERESTED"
  | "NOT_INTERESTED"
  | "QUALIFIED"
  | "UNQUALIFIED"
  | "CONVERTED"
  | "BOUNCED"
  | "UNSUBSCRIBED"
  | "ARCHIVED";
export type CampaignStatus =
  | "draft"
  | "scheduled"
  | "active"
  | "paused"
  | "completed"
  | "archived"
  | "DRAFT"
  | "SCHEDULED"
  | "ACTIVE"
  | "PAUSED"
  | "COMPLETED"
  | "ARCHIVED";
export type CampaignStepStatus =
  | "active"
  | "paused"
  | "disabled"
  | "archived"
  | "ACTIVE"
  | "PAUSED"
  | "DISABLED"
  | "ARCHIVED";
export const ENROLLMENT_STATUSES = [
  "ENROLLED",
  "RUNNING",
  "WAITING",
  "PAUSED",
  "COMPLETED",
  "STOPPED",
  "FAILED",
  "REMOVED",
  "REPLIED",
  "enrolled",
  "running",
  "waiting",
  "paused",
  "completed",
  "stopped",
  "failed",
  "removed",
  "replied",
] as const;

export type EnrollmentStatus = (typeof ENROLLMENT_STATUSES)[number];
export type CampaignLeadStatus = EnrollmentStatus;
export type DelayUnit = "minutes" | "hours" | "days";
export type TemplateStatus = "active" | "draft" | "archived";
export type MessageDirection = "outbound" | "inbound";
export const MESSAGE_STATUSES = [
  "QUEUED",
  "SENDING",
  "SENT",
  "DELIVERED",
  "OPENED",
  "BOUNCED",
  "FAILED",
  "COMPLAINED",
  "draft",
  "queued",
  "sending",
  "sent",
  "delivered",
  "opened",
  "bounced",
  "failed",
  "complained",
  "cancelled",
] as const;

export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

export const EMAIL_EVENT_TYPES = [
  "SENT",
  "DELIVERED",
  "BOUNCED",
  "COMPLAINED",
  "FAILED",
  "UNSUBSCRIBED",
  "OPENED",
  "CLICKED",
  "RECEIVED",
  "sent",
  "delivered",
  "bounced",
  "complained",
  "failed",
  "unsubscribed",
  "opened",
  "clicked",
  "received",
  "replied",
  "REPLIED",
  "DELIVERY_DELAYED",
  "delivery_delayed",
] as const;

export type EmailEventType = (typeof EMAIL_EVENT_TYPES)[number];
export type ConversationStatus = "active" | "open" | "replied" | "closed" | "archived";
export type AutomationRunStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";
export type SuppressionReason =
  | "UNSUBSCRIBED"
  | "HARD_BOUNCE"
  | "COMPLAINT"
  | "MANUAL"
  | "INVALID"
  | "unsubscribe"
  | "bounce"
  | "spam_complaint"
  | "manual"
  | "invalid";

export type SafetyAuditEventType =
  | "unsubscribe"
  | "hard_bounce"
  | "complaint"
  | "manual_suppression"
  | "suppression_removal"
  | "campaign_blocked"
  | "send_limit_reached"
  | "provider_connected"
  | "provider_validation_failed"
  | "provider_disabled"
  | "provider_health_check"
  | "sender_created"
  | "sender_updated"
  | "sender_disabled"
  | "campaign_sender_changed"
  | "import_started"
  | "import_completed"
  | "import_failed"
  | "bulk_enrollment_started"
  | "bulk_enrollment_completed"
  | "auth_login_success"
  | "auth_login_failed"
  | "auth_registered"
  | "campaign_created"
  | "campaign_activated"
  | "campaign_paused"
  | "campaign_resumed"
  | "campaign_completed"
  | "test_email_sent"
  | "webhook_received"
  | "security_violation"
  | "rate_limit_exceeded"
  | "attachment_uploaded"
  | "attachment_deleted"
  | "attachment_attached"
  | "attachment_removed"
  | "attachment_rejected"
  | "attachment_send_failed";

export type EmailProviderStatus = "ACTIVE" | "INACTIVE" | "ERROR";
export type EmailProviderType = "RESEND";

export interface EmailProviderConfig {
  id: string;
  business_id: string;
  provider: EmailProviderType;
  status: EmailProviderStatus;
  encrypted_api_key: string;
  last_checked_at: string | null;
  last_error: string | null;
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export type SenderIdentityStatus = "ACTIVE" | "INACTIVE";
export type SenderVerificationStatus = "PENDING" | "VERIFIED" | "FAILED";

export interface SenderIdentity {
  id: string;
  business_id: string;
  provider_id: string | null;
  from_name: string;
  from_email: string;
  reply_to_email: string | null;
  status: SenderIdentityStatus;
  verification_status: SenderVerificationStatus;
  created_at: string;
  updated_at: string;
}

export interface SafetyAuditLog {
  id: string;
  business_id: string;
  event_type: SafetyAuditEventType;
  recipient_email: string | null;
  lead_id: string | null;
  campaign_id: string | null;
  reason: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface BusinessSendingLimits {
  daily_send_limit: number;
  hourly_send_limit: number;
  send_rate_per_minute: number;
}

export interface BusinessSendCounter {
  business_id: string;
  period_type: "daily" | "hourly";
  period_key: string;
  count: number;
  created_at: string;
  updated_at: string;
}

// ==========================================
// 1. Businesses
// ==========================================
export interface Business {
  id: string;
  name: string;
  industry: string | null;
  website: string | null;
  timezone: string;
  status: BusinessStatus;
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export type NewBusiness = Omit<Business, "id" | "created_at" | "updated_at"> & {
  id?: string;
  timezone?: string;
  status?: BusinessStatus;
  settings?: Record<string, unknown>;
};

// ==========================================
// 2. Users
// ==========================================
export interface User {
  id: string;
  business_id: string;
  email: string;
  full_name: string;
  role: UserRole;
  status: UserStatus;
  created_at: string;
  updated_at: string;
}

export type NewUser = Omit<User, "id" | "created_at" | "updated_at"> & {
  id?: string;
  role?: UserRole;
  status?: UserStatus;
};

// ==========================================
// 3. Leads
// ==========================================
export interface Lead {
  id: string;
  business_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  phone: string | null;
  company_name: string | null;
  job_title: string | null;
  industry: string | null;
  website: string | null;
  source: string | null;
  status: LeadStatus;
  lead_score: number;
  owner_user_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export type NewLead = Omit<Lead, "id" | "created_at" | "updated_at"> & {
  id?: string;
  status?: LeadStatus;
  lead_score?: number;
  metadata?: Record<string, unknown>;
};

// ==========================================
// 4. Campaigns
// ==========================================
export interface Campaign {
  id: string;
  business_id: string;
  name: string;
  description: string | null;
  status: CampaignStatus;
  timezone: string;
  settings: Record<string, unknown>;
  sender_identity_id?: string | null;
  created_at: string;
  updated_at: string;
}

export type NewCampaign = Omit<Campaign, "id" | "created_at" | "updated_at"> & {
  id?: string;
  status?: CampaignStatus;
  timezone?: string;
  settings?: Record<string, unknown>;
  sender_identity_id?: string | null;
};

// ==========================================
// 5. Campaign Steps
// ==========================================
export interface CampaignStep {
  id: string;
  campaign_id: string;
  step_number: number;
  name: string;
  delay_value: number;
  delay_unit: DelayUnit;
  status: CampaignStepStatus;
  template_id: string | null;
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export type NewCampaignStep = Omit<
  CampaignStep,
  "id" | "created_at" | "updated_at"
> & {
  id?: string;
  delay_value?: number;
  delay_unit?: DelayUnit;
  status?: CampaignStepStatus;
  settings?: Record<string, unknown>;
};

// ==========================================
// 5b. Campaign Leads / Enrollments
// ==========================================
export interface CampaignLead {
  id: string;
  campaign_id: string;
  lead_id: string;
  business_id: string;
  status: CampaignLeadStatus;
  email?: string | null;
  current_step?: number | null;
  current_step_id?: string | null;
  next_step_id?: string | null;
  next_run_at?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  stopped_at?: string | null;
  last_error?: string | null;
  retry_count?: number;
  is_manual_override?: boolean;
  enrolled_at: string;
  metadata?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
  total_steps?: number;
  emails_sent_count?: number;
  delivered_count?: number;
  opened_count?: number;
  bounced_count?: number;
  replied?: boolean;
  last_email_status?: string | null;
  last_event_type?: string | null;
}

export type CampaignEnrollment = CampaignLead;

export type NewCampaignLead = Omit<
  CampaignLead,
  "id" | "enrolled_at" | "created_at" | "updated_at"
> & {
  id?: string;
  status?: CampaignLeadStatus;
  current_step?: number | null;
  next_step_id?: string | null;
  next_run_at?: string | null;
  enrolled_at?: string;
  metadata?: Record<string, unknown>;
};

// ==========================================
// 5c. Campaign Execution Logs (Audit & Idempotency)
// ==========================================
export type ExecutionLogStatus = "PENDING" | "CLAIMED" | "SUCCESS" | "FAILED" | "SKIPPED";

export interface CampaignExecutionLog {
  id: string;
  business_id: string;
  campaign_id: string;
  campaign_step_id: string;
  enrollment_id: string;
  lead_id: string;
  email_message_id: string | null;
  attempt_number: number;
  status: ExecutionLogStatus;
  idempotency_key: string;
  error: string | null;
  created_at: string;
  completed_at: string | null;
}

// ==========================================
// 6. Email Templates
// ==========================================
export interface EmailTemplate {
  id: string;
  business_id: string;
  name: string;
  subject: string;
  body: string;
  variables: string[];
  status: TemplateStatus;
  created_at: string;
  updated_at: string;
}

export type NewEmailTemplate = Omit<
  EmailTemplate,
  "id" | "created_at" | "updated_at"
> & {
  id?: string;
  variables?: string[];
  status?: TemplateStatus;
};

// ==========================================
// 7. Email Messages
// ==========================================
export interface EmailMessage {
  id: string;
  business_id: string;
  lead_id: string;
  campaign_id: string | null;
  campaign_step_id: string | null;
  template_id: string | null;
  direction: MessageDirection;
  provider_message_id: string | null;
  from_email: string;
  to_email: string;
  reply_to: string | null;
  subject: string;
  body: string;
  status: MessageStatus;
  scheduled_at: string | null;
  sent_at: string | null;
  delivered_at?: string | null;
  bounced_at?: string | null;
  opened_at?: string | null;
  first_opened_at?: string | null;
  last_opened_at?: string | null;
  open_count?: number;
  bounce_type?: string | null;
  bounce_subtype?: string | null;
  bounce_message?: string | null;
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export type NewEmailMessage = Omit<
  EmailMessage,
  "id" | "created_at" | "updated_at"
> & {
  id?: string;
  direction?: MessageDirection;
  status?: MessageStatus;
  delivered_at?: string | null;
  bounced_at?: string | null;
};

// ==========================================
// 8. Email Events
// ==========================================
export interface EmailEvent {
  id: string;
  business_id: string;
  email_message_id: string | null;
  campaign_id?: string | null;
  campaign_step_id?: string | null;
  lead_id?: string | null;
  enrollment_id?: string | null;
  event_type: EmailEventType;
  provider_event_id: string | null;
  event_timestamp: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export type NewEmailEvent = Omit<EmailEvent, "id" | "created_at"> & {
  id?: string;
  event_timestamp?: string;
  metadata?: Record<string, unknown>;
};

// ==========================================
// 8b. Campaign Analytics & Metrics Interfaces
// ==========================================
export interface CampaignAnalyticsOverview {
  campaign_id: string;
  campaign_name: string;
  campaign_status: CampaignStatus;
  created_at: string;
  total_enrolled: number;
  total_active: number;
  total_pending: number;
  total_completed: number;
  total_stopped: number;
  total_sent: number;
  total_delivered: number;
  total_opened?: number;
  total_unique_opens?: number;
  total_bounced: number;
  total_failed: number;
  total_complained: number;
  total_unsubscribed: number;
  total_replied?: number;
  delivery_rate: number;
  open_rate?: number;
  bounce_rate: number;
  complaint_rate: number;
  unsubscribe_rate: number;
  reply_rate?: number;
}

export interface CampaignTimelinePoint {
  date: string;
  sent: number;
  delivered: number;
  opened?: number;
  bounced: number;
  failed: number;
  complained: number;
  unsubscribed: number;
}

export interface StepAnalyticsItem {
  step_id: string;
  step_number: number;
  step_name: string;
  status: string;
  scheduled?: number;
  sent: number;
  delivered: number;
  opened?: number;
  open_rate?: number;
  replies?: number;
  bounced: number;
  failed: number;
  complained: number;
  unsubscribed: number;
  delivery_rate: number;
  bounce_rate: number;
}

export interface ContactEmailHistoryItem {
  id: string;
  campaign_id: string | null;
  campaign_name: string | null;
  campaign_step_id: string | null;
  step_number: number | null;
  step_name: string | null;
  from_email: string;
  from_name: string | null;
  to_email: string;
  subject: string;
  status: MessageStatus;
  sent_at: string | null;
  delivered_at: string | null;
  bounced_at: string | null;
  bounce_reason: string | null;
  complaint_reason: string | null;
  created_at: string;
}

export interface EmailMessageDetail extends EmailMessage {
  lead_name: string | null;
  campaign_name: string | null;
  step_name: string | null;
  step_number: number | null;
  events: EmailEvent[];
}

// ==========================================
// 9. Conversations & Messages
// ==========================================
export type ConversationMessageDirection = "INBOUND" | "OUTBOUND";

export interface ConversationMessageAttachment {
  id?: string;
  filename: string;
  content_type?: string;
  contentType?: string;
  file_size?: number;
  url?: string;
  storage_key?: string;
}

export interface ConversationMessage {
  id: string;
  conversation_id: string;
  business_id: string;
  direction: ConversationMessageDirection;
  sender_email: string;
  recipient_email: string;
  subject: string;
  body_text: string | null;
  body_html: string | null;
  provider_message_id: string | null;
  in_reply_to: string | null;
  received_at: string | null;
  read_at: string | null;
  attachments?: ConversationMessageAttachment[];
  created_at: string;
}

export interface Conversation {
  id: string;
  business_id: string;
  lead_id: string;
  campaign_id: string | null;
  subject: string;
  status: ConversationStatus;
  last_message_at: string | null;
  unread_count: number;
  created_at: string;
  updated_at: string;
}

export type NewConversation = Omit<
  Conversation,
  "id" | "created_at" | "updated_at"
> & {
  id?: string;
  campaign_id?: string | null;
  subject?: string;
  status?: ConversationStatus;
  unread_count?: number;
};

export interface ConversationDetail extends Conversation {
  contact_id: string;
  contact_name: string;
  contact_email: string;
  campaign_name: string | null;
  has_attachments: boolean;
  snippet: string;
  messages: ConversationMessage[];
}

export type ConversationFilterType =
  | "all"
  | "unread"
  | "read"
  | "attachments"
  | "campaign"
  | "unknown";

export interface ConversationListParams {
  businessId: string;
  leadId?: string;
  campaignId?: string;
  filter?: ConversationFilterType;
  search?: string;
  page?: number;
  limit?: number;
}

export interface ConversationListItem {
  id: string;
  business_id: string;
  lead_id: string;
  contact_id: string;
  contact_name: string;
  contact_email: string;
  campaign_id: string | null;
  campaign_name: string | null;
  subject: string;
  status: ConversationStatus;
  last_message_at: string | null;
  unread_count: number;
  is_unread: boolean;
  has_attachments: boolean;
  snippet: string;
  created_at: string;
}

export interface ConversationListResult {
  conversations: ConversationListItem[];
  total: number;
  unread_total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// ==========================================
// 10. Automation Runs
// ==========================================
export interface AutomationRun {
  id: string;
  business_id: string;
  workflow_name: string;
  lead_id: string | null;
  campaign_id: string | null;
  status: AutomationRunStatus;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export type NewAutomationRun = Omit<
  AutomationRun,
  "id" | "created_at" | "updated_at"
> & {
  id?: string;
  status?: AutomationRunStatus;
  metadata?: Record<string, unknown>;
};

// ==========================================
// 11. Activities
// ==========================================
export interface Activity {
  id: string;
  business_id: string;
  lead_id: string;
  activity_type: string;
  description: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export type NewActivity = Omit<Activity, "id" | "created_at"> & {
  id?: string;
  metadata?: Record<string, unknown>;
};

// ==========================================
// 12. Suppressions
// ==========================================
export interface Suppression {
  id: string;
  business_id: string;
  email: string;
  reason: SuppressionReason;
  source: string | null;
  created_at: string;
  updated_at: string;
}

export type NewSuppression = Omit<
  Suppression,
  "id" | "created_at" | "updated_at"
> & {
  id?: string;
  reason?: SuppressionReason;
};

// ==========================================
// 13. Contact Imports
// ==========================================
export type ContactImportStatus = "PROCESSING" | "COMPLETED" | "FAILED" | "PARTIAL";
export type ContactImportMode = "CREATE_ONLY" | "CREATE_OR_UPDATE";

export interface ContactImportError {
  row: number;
  email?: string;
  reason: string;
  data?: Record<string, string>;
}

export interface ContactImport {
  id: string;
  business_id: string;
  filename: string;
  total_rows: number;
  imported_count: number;
  duplicate_count: number;
  invalid_count: number;
  suppressed_count: number;
  failed_count: number;
  status: ContactImportStatus;
  errors: ContactImportError[];
  created_at: string;
  completed_at: string | null;
}

export type NewContactImport = {
  id?: string;
  business_id: string;
  filename: string;
  total_rows?: number;
  imported_count?: number;
  duplicate_count?: number;
  invalid_count?: number;
  suppressed_count?: number;
  failed_count?: number;
  status?: ContactImportStatus;
  errors?: ContactImportError[];
  completed_at?: string | null;
};

export interface CsvPreviewFieldOption {
  key: string;
  label: string;
  required?: boolean;
}

export interface CsvPreviewResult {
  filename: string;
  totalRows: number;
  headers: string[];
  previewRows: Record<string, string>[];
  detectedMapping: Record<string, string>;
  availableFields: CsvPreviewFieldOption[];
}

export interface CsvImportSummary {
  totalRows: number;
  validRows: number;
  importedCount: number;
  skippedCount: number;
  duplicateCount: number;
  invalidCount: number;
  suppressedCount: number;
  failedCount: number;
  status: ContactImportStatus;
  rejectedRows: ContactImportError[];
  rejectedCsv?: string;
}

export interface BulkEnrollPreviewResult {
  totalSelected: number;
  eligibleCount: number;
  suppressedCount: number;
  alreadyEnrolledCount: number;
}

export * from "./attachment";

