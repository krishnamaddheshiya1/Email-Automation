import {
  CampaignRepository,
  CampaignListParams,
  CampaignListResult,
} from "../repositories/campaign.repository";
import { TemplateRepository } from "../repositories/template.repository";
import { LeadRepository } from "../repositories/lead.repository";
import {
  Campaign,
  CampaignStep,
  CampaignLead,
  CampaignStatus,
  CampaignStepStatus,
  Lead,
} from "@/types/database";
import {
  CreateCampaignInput,
  UpdateCampaignInput,
  CreateCampaignStepInput,
  UpdateCampaignStepInput,
  createCampaignSchema,
  updateCampaignSchema,
  createCampaignStepSchema,
  updateCampaignStepSchema,
} from "@/lib/validations/campaign";
import { SuppressionRepository } from "../repositories/suppression.repository";
import { SenderIdentityRepository } from "../repositories/sender-identity.repository";
import { EmailProviderRepository } from "../repositories/email-provider.repository";
import { SafetyAuditRepository } from "../repositories/safety-audit.repository";
import { EmailMessageRepository } from "../repositories/email-message.repository";
import { emailRegex } from "@/lib/validations/email";
import { emailService as defaultEmailService } from "./email.service";
import { campaignExecutionService } from "./campaign-execution.service";

export interface CampaignValidationChecklist {
  activeSteps: boolean;
  contactsEnrolled: boolean;
  templatesValid: boolean;
  senderConfigured: boolean;
  providerConfigured?: boolean;
  unsubscribeEnabled: boolean;
  noCriticalErrors: boolean;
}

export interface CampaignValidationResult {
  valid: boolean;
  errors: string[];
  checklist?: CampaignValidationChecklist;
}

export interface ContactEligibilityItem extends Lead {
  is_eligible: boolean;
  ineligible_reason: string | null;
  already_contacted: boolean;
}

export interface CampaignContactEligibilityResult {
  contacts: ContactEligibilityItem[];
  summary: {
    total: number;
    eligible: number;
    ineligible: number;
    already_contacted: number;
    suppressed: number;
    enrolled: number;
    bounced: number;
    replied: number;
  };
}

export class CampaignService {
  private repository: CampaignRepository;
  private templateRepo: TemplateRepository;
  private leadRepo: LeadRepository;
  private suppressionRepo: SuppressionRepository;
  private senderRepo: SenderIdentityRepository;
  private emailProviderRepo: EmailProviderRepository;
  private safetyAuditRepo: SafetyAuditRepository;
  private messageRepo: EmailMessageRepository;

  constructor(
    repository?: CampaignRepository,
    templateRepo?: TemplateRepository,
    leadRepo?: LeadRepository,
    suppressionRepo?: SuppressionRepository,
    senderRepo?: SenderIdentityRepository,
    emailProviderRepo?: EmailProviderRepository,
    safetyAuditRepo?: SafetyAuditRepository,
    messageRepo?: EmailMessageRepository
  ) {
    this.repository = repository || new CampaignRepository();
    this.templateRepo = templateRepo || new TemplateRepository();
    this.leadRepo = leadRepo || new LeadRepository();
    this.suppressionRepo = suppressionRepo || new SuppressionRepository();
    this.senderRepo = senderRepo || new SenderIdentityRepository();
    this.emailProviderRepo = emailProviderRepo || new EmailProviderRepository();
    this.safetyAuditRepo = safetyAuditRepo || new SafetyAuditRepository();
    this.messageRepo = messageRepo || new EmailMessageRepository();
  }

  /**
   * Retrieves a paginated list of campaigns scoped strictly to the authenticated business.
   */
  async listCampaigns(
    businessId: string,
    params: Omit<CampaignListParams, "businessId">
  ): Promise<CampaignListResult> {
    if (!businessId) {
      throw new Error("Business ID is required for multi-tenant isolation.");
    }
    return this.repository.list({ ...params, businessId });
  }

  /**
   * Retrieves a single campaign with steps and contact count, scoped strictly to the business.
   */
  async getCampaign(
    id: string,
    businessId: string
  ): Promise<Campaign & { steps: CampaignStep[]; contact_count: number }> {
    if (!id || !businessId) {
      throw new Error("Campaign ID and Business ID are required.");
    }

    const campaign = await this.repository.findByIdAndBusinessId(id, businessId);
    if (!campaign) {
      throw new Error("Campaign not found or access denied.");
    }

    const [steps, contact_count] = await Promise.all([
      this.repository.findStepsByCampaignId(id),
      this.repository.countEnrolledLeads(id),
    ]);

    return {
      ...campaign,
      steps,
      contact_count,
    };
  }

  /**
   * Creates a new campaign scoped to the business.
   */
  async createCampaign(
    businessId: string,
    rawInput: CreateCampaignInput
  ): Promise<Campaign> {
    if (!businessId) {
      throw new Error("Business ID is required.");
    }

    const validation = createCampaignSchema.safeParse(rawInput);
    if (!validation.success) {
      const firstError = validation.error.issues[0]?.message || "Validation failed";
      throw new Error(firstError);
    }

    const { name, description, timezone, status, sender_identity_id, settings } = validation.data;

    return this.repository.create({
      business_id: businessId,
      name,
      description: description || null,
      timezone: timezone || "UTC",
      status: (status?.toUpperCase() as CampaignStatus) || "DRAFT",
      sender_identity_id: sender_identity_id || null,
      settings: settings || {},
    });
  }

  /**
   * Updates an existing campaign belonging to the business.
   */
  async updateCampaign(
    id: string,
    businessId: string,
    rawInput: UpdateCampaignInput
  ): Promise<Campaign> {
    if (!id || !businessId) {
      throw new Error("Campaign ID and Business ID are required.");
    }

    const validation = updateCampaignSchema.safeParse(rawInput);
    if (!validation.success) {
      const firstError = validation.error.issues[0]?.message || "Validation failed";
      throw new Error(firstError);
    }

    const existing = await this.repository.findByIdAndBusinessId(id, businessId);
    if (!existing) {
      throw new Error("Campaign not found or access denied.");
    }

    const patch: Partial<Campaign> = {};
    if (validation.data.name !== undefined) patch.name = validation.data.name;
    if (validation.data.description !== undefined) patch.description = validation.data.description;
    if (validation.data.timezone !== undefined) patch.timezone = validation.data.timezone;
    if (validation.data.status !== undefined) {
      patch.status = validation.data.status.toUpperCase() as CampaignStatus;
    }
    if (validation.data.sender_identity_id !== undefined) {
      patch.sender_identity_id = validation.data.sender_identity_id || null;
      if (validation.data.sender_identity_id !== existing.sender_identity_id) {
        await this.safetyAuditRepo.createLog({
          business_id: businessId,
          campaign_id: id,
          event_type: "campaign_sender_changed",
          reason: `Campaign sender identity updated to ${validation.data.sender_identity_id || "null"}`,
          metadata: {
            previous_sender_identity_id: existing.sender_identity_id || null,
            new_sender_identity_id: validation.data.sender_identity_id || null,
          },
        });
      }
    }
    if (validation.data.settings !== undefined) patch.settings = validation.data.settings;

    return this.repository.update(id, businessId, patch);
  }

  /**
   * Validates whether a campaign is eligible for activation.
   */
  async validateCampaign(
    campaignId: string,
    businessId: string
  ): Promise<CampaignValidationResult> {
    const errors: string[] = [];

    const campaign = await this.repository.findByIdAndBusinessId(campaignId, businessId);
    if (!campaign) {
      return { valid: false, errors: ["Campaign not found or access denied."] };
    }

    // Rule 1: Campaign has a valid non-empty name
    if (!campaign.name || !campaign.name.trim()) {
      errors.push("Campaign name is required.");
    }

    // Rule 2: Has a valid timezone
    if (!campaign.timezone || !campaign.timezone.trim()) {
      errors.push("Campaign timezone is required.");
    }

    // Check steps
    const steps = await this.repository.findStepsByCampaignId(campaignId);
    const activeSteps = steps.filter(
      (s) => (s.status || "ACTIVE").toUpperCase() === "ACTIVE"
    );

    // Rule 3: Campaign has at least 1 active step
    if (activeSteps.length === 0) {
      errors.push("Campaign must have at least 1 active step.");
    } else {
      // Sort active steps by step_number
      activeSteps.sort((a, b) => a.step_number - b.step_number);

      // Rule 4: Steps are ordered sequentially without gaps or duplicates
      const stepNumbers = activeSteps.map((s) => s.step_number);
      const uniqueNumbers = new Set(stepNumbers);
      if (uniqueNumbers.size !== stepNumbers.length) {
        errors.push("Step numbers must be unique within the campaign.");
      }

      for (let i = 0; i < activeSteps.length; i++) {
        const step = activeSteps[i];
        const expectedNumber = i + 1;
        if (step.step_number !== expectedNumber) {
          errors.push(
            `Steps must be ordered sequentially without gaps (expected Step ${expectedNumber}, found Step ${step.step_number}).`
          );
          break;
        }
      }

      // Rule 5: Delays are valid (>= 0)
      for (const step of activeSteps) {
        if (step.delay_value === undefined || step.delay_value === null || step.delay_value < 0) {
          errors.push(`Step ${step.step_number} (${step.name}) delay cannot be negative.`);
        }
      }

      // Rule 6: All active steps have templates selected and templates exist, belong to business, not archived
      for (const step of activeSteps) {
        if (!step.template_id) {
          errors.push(`Step ${step.step_number} ("${step.name}") does not have an email template selected.`);
        } else {
          const tpl = await this.templateRepo.findByIdAndBusinessId(step.template_id, businessId);
          if (!tpl) {
            errors.push(
              `Step ${step.step_number} references a template that does not exist or does not belong to your business.`
            );
          } else if (tpl.status?.toLowerCase() === "archived") {
            errors.push(
              `Step ${step.step_number} references an archived template ("${tpl.name}"). Please select an active template.`
            );
          }
        }
      }
    }

    // Rule 7: Has at least 1 contact enrolled
    const contactCount = await this.repository.countEnrolledLeads(campaignId);
    if (contactCount === 0) {
      errors.push("Campaign must have at least 1 enrolled contact.");
    }

    // Rule 8: Sender & Email Provider configuration
    let senderConfigured = false;
    let providerConfigured = false;

    if (campaign.sender_identity_id) {
      const sender = await this.senderRepo.findByIdAndBusinessId(
        campaign.sender_identity_id,
        businessId
      );
      if (!sender) {
        errors.push("The selected sender identity does not exist or does not belong to your business.");
      } else if (sender.status !== "ACTIVE") {
        errors.push(`The selected sender identity ("${sender.from_email}") is inactive.`);
      } else if (sender.verification_status === "FAILED") {
        errors.push(`The selected sender identity ("${sender.from_email}") has failed verification.`);
      } else {
        senderConfigured = true;
      }
    } else {
      // Check if business has an active verified sender or fallback
      const senders = await this.senderRepo.listByBusinessId(businessId);
      const activeSender = senders.find(
        (s) => s.status === "ACTIVE" && s.verification_status !== "FAILED"
      );
      if (activeSender) {
        senderConfigured = true;
      } else {
        try {
          const sender = await defaultEmailService.resolveSenderIdentity(businessId);
          if (sender && sender.fromEmail && emailRegex.test(sender.fromEmail)) {
            senderConfigured = true;
          }
        } catch {
          senderConfigured = false;
        }
      }
    }

    if (!senderConfigured) {
      errors.push("Sender identity is not configured. Please configure an active sender identity in Settings.");
    }

    // Provider check
    const activeProvider = await this.emailProviderRepo.findActiveByBusinessId(businessId);
    if (activeProvider && activeProvider.status === "ACTIVE") {
      providerConfigured = true;
    } else if (process.env.RESEND_API_KEY || defaultEmailService.getProviderInfo().isConfigured) {
      providerConfigured = true;
    }

    if (!providerConfigured) {
      errors.push("Email provider is not configured or inactive. Please configure your email provider in Settings.");
    }

    // Rule 9: Unsubscribe mechanism enabled
    const unsubscribeEnabled = true;

    const checklist: CampaignValidationChecklist = {
      activeSteps: activeSteps.length > 0,
      contactsEnrolled: contactCount > 0,
      templatesValid: activeSteps.length > 0 && activeSteps.every((s) => Boolean(s.template_id)),
      senderConfigured: senderConfigured && providerConfigured,
      providerConfigured,
      unsubscribeEnabled,
      noCriticalErrors: errors.length === 0,
    };

    return {
      valid: errors.length === 0,
      errors,
      checklist,
    };
  }

  /**
   * Activates a campaign after strict validation.
   */
  async activateCampaign(
    id: string,
    businessId: string
  ): Promise<{ campaign: Campaign; validation: CampaignValidationResult }> {
    const validation = await this.validateCampaign(id, businessId);
    if (!validation.valid) {
      throw new Error(`Cannot activate campaign: ${validation.errors.join("; ")}`);
    }

    const updated = await this.repository.update(id, businessId, { status: "ACTIVE" });
    try {
      await campaignExecutionService.initializeCampaignEnrollments(id, businessId);
    } catch {
      // Non-blocking initialization fallback
    }
    return { campaign: updated, validation };
  }

  /**
   * Pauses an active campaign.
   */
  async pauseCampaign(id: string, businessId: string): Promise<Campaign> {
    const existing = await this.repository.findByIdAndBusinessId(id, businessId);
    if (!existing) {
      throw new Error("Campaign not found or access denied.");
    }
    if (existing.status.toUpperCase() !== "ACTIVE") {
      throw new Error(`Cannot pause campaign in "${existing.status}" status.`);
    }

    return this.repository.update(id, businessId, { status: "PAUSED" });
  }

  /**
   * Resumes a paused campaign back to active.
   */
  async resumeCampaign(id: string, businessId: string): Promise<Campaign> {
    const existing = await this.repository.findByIdAndBusinessId(id, businessId);
    if (!existing) {
      throw new Error("Campaign not found or access denied.");
    }
    if (existing.status.toUpperCase() !== "PAUSED") {
      throw new Error(`Cannot resume campaign in "${existing.status}" status.`);
    }

    const validation = await this.validateCampaign(id, businessId);
    if (!validation.valid) {
      throw new Error(`Cannot resume campaign: ${validation.errors.join("; ")}`);
    }

    const updated = await this.repository.update(id, businessId, { status: "ACTIVE" });
    try {
      await campaignExecutionService.initializeCampaignEnrollments(id, businessId);
    } catch {
      // Non-blocking initialization fallback
    }
    return updated;
  }

  /**
   * Archives a campaign.
   */
  async archiveCampaign(id: string, businessId: string): Promise<Campaign> {
    const existing = await this.repository.findByIdAndBusinessId(id, businessId);
    if (!existing) {
      throw new Error("Campaign not found or access denied.");
    }

    return this.repository.archive(id, businessId);
  }

  /**
   * Duplicates a campaign with all its steps as a DRAFT.
   */
  async duplicateCampaign(
    id: string,
    businessId: string,
    newName?: string
  ): Promise<{ campaign: Campaign; steps: CampaignStep[] }> {
    return this.repository.duplicate(id, businessId, newName);
  }

  /**
   * Deletes a campaign if scoped to business.
   */
  async deleteCampaign(id: string, businessId: string): Promise<boolean> {
    const existing = await this.repository.findByIdAndBusinessId(id, businessId);
    if (!existing) {
      throw new Error("Campaign not found or access denied.");
    }
    return this.repository.delete(id, businessId);
  }

  // ==========================================
  // Campaign Step Methods
  // ==========================================

  /**
   * Retrieves steps for a campaign, ensuring business ownership.
   */
  async getSteps(campaignId: string, businessId: string): Promise<CampaignStep[]> {
    const campaign = await this.repository.findByIdAndBusinessId(campaignId, businessId);
    if (!campaign) {
      throw new Error("Campaign not found or access denied.");
    }
    return this.repository.findStepsByCampaignId(campaignId);
  }

  /**
   * Adds a step to a campaign.
   */
  async addStep(
    campaignId: string,
    businessId: string,
    rawInput: CreateCampaignStepInput
  ): Promise<CampaignStep> {
    const campaign = await this.repository.findByIdAndBusinessId(campaignId, businessId);
    if (!campaign) {
      throw new Error("Campaign not found or access denied.");
    }

    const validation = createCampaignStepSchema.safeParse(rawInput);
    if (!validation.success) {
      const firstError = validation.error.issues[0]?.message || "Validation failed";
      throw new Error(firstError);
    }

    const { name, step_number, template_id, delay_value, delay_unit, status, settings } =
      validation.data;

    // If template_id is provided, verify it belongs to this business
    if (template_id) {
      const template = await this.templateRepo.findByIdAndBusinessId(template_id, businessId);
      if (!template) {
        throw new Error("Selected template does not exist or access denied.");
      }
    }

    // Determine step_number if not provided
    const existingSteps = await this.repository.findStepsByCampaignId(campaignId);
    let finalStepNumber = step_number;
    if (!finalStepNumber) {
      finalStepNumber =
        existingSteps.length > 0 ? Math.max(...existingSteps.map((s) => s.step_number)) + 1 : 1;
    }

    const created = await this.repository.createStep({
      campaign_id: campaignId,
      name,
      step_number: finalStepNumber,
      template_id: template_id || null,
      delay_value: delay_value ?? (finalStepNumber === 1 ? 0 : 1),
      delay_unit: delay_unit || "days",
      status: (status?.toUpperCase() as CampaignStepStatus) || "ACTIVE",
      settings: settings || {},
    });

    if (finalStepNumber === 1 || existingSteps.length === 0) {
      try {
        await campaignExecutionService.initializeCampaignEnrollments(campaignId, businessId);
      } catch {
        // Non-blocking
      }
    }

    return created;
  }

  /**
   * Updates a step in a campaign.
   */
  async updateStep(
    campaignId: string,
    stepId: string,
    businessId: string,
    rawInput: UpdateCampaignStepInput
  ): Promise<CampaignStep> {
    const campaign = await this.repository.findByIdAndBusinessId(campaignId, businessId);
    if (!campaign) {
      throw new Error("Campaign not found or access denied.");
    }

    const existingStep = await this.repository.findStepById(stepId);
    if (!existingStep || existingStep.campaign_id !== campaignId) {
      throw new Error("Step not found in this campaign.");
    }

    const validation = updateCampaignStepSchema.safeParse(rawInput);
    if (!validation.success) {
      const firstError = validation.error.issues[0]?.message || "Validation failed";
      throw new Error(firstError);
    }

    const patch: Partial<CampaignStep> = {};
    if (validation.data.name !== undefined) patch.name = validation.data.name;
    if (validation.data.step_number !== undefined) patch.step_number = validation.data.step_number;
    if (validation.data.delay_value !== undefined) patch.delay_value = validation.data.delay_value;
    if (validation.data.delay_unit !== undefined) patch.delay_unit = validation.data.delay_unit;
    if (validation.data.status !== undefined) {
      patch.status = validation.data.status.toUpperCase() as CampaignStepStatus;
    }
    if (validation.data.settings !== undefined) patch.settings = validation.data.settings;

    if (validation.data.template_id !== undefined) {
      if (validation.data.template_id) {
        const template = await this.templateRepo.findByIdAndBusinessId(
          validation.data.template_id,
          businessId
        );
        if (!template) {
          throw new Error("Selected template does not exist or access denied.");
        }
        patch.template_id = validation.data.template_id;
      } else {
        patch.template_id = null;
      }
    }

    return this.repository.updateStep(stepId, campaignId, patch);
  }

  /**
   * Deletes a step from a campaign and re-sequences step numbers deterministically.
   */
  async deleteStep(
    campaignId: string,
    stepId: string,
    businessId: string
  ): Promise<boolean> {
    const campaign = await this.repository.findByIdAndBusinessId(campaignId, businessId);
    if (!campaign) {
      throw new Error("Campaign not found or access denied.");
    }

    const deleted = await this.repository.deleteStep(stepId, campaignId);
    if (!deleted) return false;

    // Deterministically resequence remaining steps (1, 2, 3...)
    const remaining = await this.repository.findStepsByCampaignId(campaignId);
    remaining.sort((a, b) => a.step_number - b.step_number);
    for (let i = 0; i < remaining.length; i++) {
      const expectedNum = i + 1;
      if (remaining[i].step_number !== expectedNum) {
        await this.repository.updateStep(remaining[i].id, campaignId, {
          step_number: expectedNum,
        });
      }
    }

    return true;
  }

  /**
   * Reorders all steps in a campaign according to the specified array of step IDs.
   */
  async reorderSteps(
    campaignId: string,
    businessId: string,
    stepIds: string[]
  ): Promise<CampaignStep[]> {
    const campaign = await this.repository.findByIdAndBusinessId(campaignId, businessId);
    if (!campaign) {
      throw new Error("Campaign not found or access denied.");
    }

    const steps = await this.repository.findStepsByCampaignId(campaignId);
    const stepMap = new Map(steps.map((s) => [s.id, s]));

    // Validate that all stepIds exist in this campaign
    for (const sid of stepIds) {
      if (!stepMap.has(sid)) {
        throw new Error(`Step ID ${sid} not found in this campaign.`);
      }
    }

    // Phase 1: Set temporary step numbers to prevent unique constraint conflicts during swap
    for (let i = 0; i < stepIds.length; i++) {
      await this.repository.updateStep(stepIds[i], campaignId, {
        step_number: 10000 + i + 1,
      });
    }

    // Phase 2: Assign final sequential 1-indexed step numbers
    const updatedSteps: CampaignStep[] = [];
    for (let i = 0; i < stepIds.length; i++) {
      const sid = stepIds[i];
      const newNum = i + 1;
      const updated = await this.repository.updateStep(sid, campaignId, {
        step_number: newNum,
      });
      updatedSteps.push(updated);
    }

    return updatedSteps;
  }

  // ==========================================
  // Campaign Contact Enrollment Methods
  // ==========================================

  /**
   * Lists enrolled contacts for a campaign.
   */
  async getEnrolledContacts(
    campaignId: string,
    businessId: string,
    params: { status?: string; search?: string; page?: number; limit?: number } = {}
  ): Promise<{ data: (CampaignLead & { lead?: Lead })[]; total: number }> {
    const campaign = await this.repository.findByIdAndBusinessId(campaignId, businessId);
    if (!campaign) {
      throw new Error("Campaign not found or access denied.");
    }

    return this.repository.findEnrollments(campaignId, businessId, params);
  }

  /**
   * Enrolls contacts into a campaign.
   * Strictly validates business ownership, normalizes email, prevents duplicate enrollments,
   * blocks enrollment for suppressed recipients, and checks against already-contacted leads
   * unless manual override is explicitly confirmed.
   */
  async enrollContacts(
    campaignId: string,
    businessId: string,
    contactIds: string[],
    options?: { allowOverride?: boolean }
  ): Promise<{ enrolledCount: number; skippedCount: number }> {
    const campaign = await this.repository.findByIdAndBusinessId(campaignId, businessId);
    if (!campaign) {
      throw new Error("Campaign not found or access denied.");
    }

    const allowOverride = Boolean(options?.allowOverride);

    // Pre-enrollment duplicate check
    const contactedLeadIds = await this.messageRepo.findContactedLeadIds(campaignId, businessId);
    if (!allowOverride) {
      const alreadyContacted = contactIds.filter((cid) => contactedLeadIds.has(cid));
      if (alreadyContacted.length > 0) {
        const err = new Error("ALREADY_CONTACTED: This contact has already received an email from this campaign.");
        (err as unknown as { code: string }).code = "ALREADY_CONTACTED";
        throw err;
      }
    }

    // Load existing enrolled contacts for this campaign to prevent duplicate emails
    const existingEnrollments = await this.repository.findEnrollments(campaignId, businessId, { limit: 10000 });
    const enrolledEmails = new Set<string>();
    for (const item of existingEnrollments.data) {
      if (item.lead?.email && item.status.toUpperCase() !== "REMOVED") {
        enrolledEmails.add(item.lead.email.trim().toLowerCase());
      }
    }

    // Verify all contact IDs belong to this business, are not suppressed, and not duplicate
    const validContacts: Array<{ id: string; email: string; firstName: string; lastName: string; companyName: string }> = [];
    const addedInBatch = new Set<string>();
    let skippedCount = 0;

    for (const cid of contactIds) {
      const contact = await this.leadRepo.findByIdAndBusinessId(cid, businessId);
      if (!contact || !contact.email) {
        skippedCount++;
        continue;
      }

      const normalizedEmail = contact.email.trim().toLowerCase();
      if (!emailRegex.test(normalizedEmail)) {
        skippedCount++;
        continue;
      }

      // Check if recipient is suppressed for this business
      const isSuppressed = await this.suppressionRepo.isSuppressed(businessId, normalizedEmail);
      if (isSuppressed) {
        skippedCount++;
        continue;
      }

      // Check if normalized email is already enrolled in this campaign unless allowOverride is true
      if (!allowOverride && enrolledEmails.has(normalizedEmail)) {
        skippedCount++;
        continue;
      }

      if (addedInBatch.has(normalizedEmail)) {
        skippedCount++;
        continue;
      }

      addedInBatch.add(normalizedEmail);
      validContacts.push({
        id: contact.id,
        email: normalizedEmail,
        firstName: contact.first_name || "",
        lastName: contact.last_name || "",
        companyName: contact.company_name || "",
      });
    }

    if (validContacts.length === 0) {
      return { enrolledCount: 0, skippedCount };
    }

    // Resolve Step 1 to initialize next_step_id and next_run_at immediately
    const steps = await this.repository.findStepsByCampaignId(campaignId);
    const activeSteps = steps
      .filter((s) => (s.status || "ACTIVE").toUpperCase() === "ACTIVE")
      .sort((a, b) => a.step_number - b.step_number);
    const firstStep = activeSteps[0] || null;

    let initialNextRunAt: Date | null = null;
    if (firstStep) {
      if (!firstStep.delay_value || firstStep.delay_value <= 0) {
        // Immediately runnable (<= NOW)
        initialNextRunAt = new Date(Date.now() - 1000);
      } else {
        initialNextRunAt = campaignExecutionService.calculateNextRunAt(
          new Date(),
          firstStep.delay_value,
          firstStep.delay_unit
        );
      }
    }

    const res = await this.repository.enrollLeads(
      campaignId,
      businessId,
      validContacts.map((c) => c.id),
      {
        firstStepId: firstStep?.id || null,
        nextRunAt: initialNextRunAt ? initialNextRunAt.toISOString() : null,
        isManualOverride: allowOverride,
        contacts: validContacts.map((c) => ({
          id: c.id,
          email: c.email,
          metadata: {
            email: c.email,
            first_name: c.firstName,
            last_name: c.lastName,
            company_name: c.companyName,
          },
        })),
      }
    );

    if (res.enrolled.length > 0 && campaign.status.toUpperCase() === "ACTIVE") {
      try {
        await campaignExecutionService.initializeCampaignEnrollments(campaignId, businessId);
      } catch {
        // Non-blocking initialization fallback
      }
    }
    return {
      enrolledCount: res.enrolled.length,
      skippedCount: skippedCount + res.skippedCount,
    };
  }

  /**
   * Retrieves contact eligibility for enrolling in this campaign.
   * Scrutinizes bounce status, suppression lists, active enrollments, prior responses,
   * and previous campaign contacts for duplicate protection.
   */
  async getContactEligibility(
    campaignId: string,
    businessId: string
  ): Promise<CampaignContactEligibilityResult> {
    const campaign = await this.repository.findByIdAndBusinessId(campaignId, businessId);
    if (!campaign) {
      throw new Error("Campaign not found or access denied.");
    }

    // 1. Fetch all contacts for this business
    const allContacts = await this.leadRepo.findByBusinessId(businessId);

    // 2. Fetch contacted lead IDs for this campaign
    const contactedLeadIds = await this.messageRepo.findContactedLeadIds(campaignId, businessId);

    // 3. Fetch existing enrollments for this campaign
    const enrollmentsResult = await this.repository.findEnrollments(campaignId, businessId, { limit: 10000 });
    const enrollmentMap = new Map<string, CampaignLead>();
    for (const enr of enrollmentsResult.data) {
      if (enr.lead_id) {
        enrollmentMap.set(enr.lead_id, enr);
      }
    }

    // 4. Batch check suppressions
    const emailsToCheck = allContacts
      .map((c) => (c.email ? c.email.trim().toLowerCase() : ""))
      .filter(Boolean);
    const suppressedSet = await this.suppressionRepo.findSuppressedEmails(businessId, emailsToCheck);

    const items: ContactEligibilityItem[] = [];

    for (const contact of allContacts) {
      const email = (contact.email || "").trim().toLowerCase();
      const enrollment = enrollmentMap.get(contact.id);
      const enrStatus = (enrollment?.status || "").toUpperCase();
      const alreadyContacted = contactedLeadIds.has(contact.id);

      let isEligible = true;
      let ineligibleReason: string | null = null;

      if (!email || !emailRegex.test(email)) {
        isEligible = false;
        ineligibleReason = "Invalid Email";
      } else if (
        String(contact.status || "").toLowerCase() === "bounced" ||
        enrStatus === "BOUNCED"
      ) {
        isEligible = false;
        ineligibleReason = "Bounced";
      } else if (
        suppressedSet.has(email) ||
        String(contact.status || "").toLowerCase() === "unsubscribed"
      ) {
        isEligible = false;
        ineligibleReason = "Suppressed";
      } else if (
        enrStatus === "REPLIED" ||
        Boolean(enrollment?.metadata?.replied)
      ) {
        isEligible = false;
        ineligibleReason = "Replied";
      } else if (enrStatus === "COMPLETED") {
        isEligible = false;
        ineligibleReason = "Campaign Completed";
      } else if (["ENROLLED", "RUNNING", "WAITING"].includes(enrStatus)) {
        isEligible = false;
        ineligibleReason = "Already Enrolled";
      } else if (alreadyContacted) {
        isEligible = false;
        ineligibleReason = "Already Contacted";
      }

      items.push({
        ...contact,
        is_eligible: isEligible,
        ineligible_reason: ineligibleReason,
        already_contacted: alreadyContacted,
      });
    }

    const summary = {
      total: items.length,
      eligible: items.filter((c) => c.is_eligible).length,
      ineligible: items.filter((c) => !c.is_eligible).length,
      already_contacted: items.filter((c) => c.already_contacted).length,
      suppressed: items.filter((c) => c.ineligible_reason === "Suppressed").length,
      enrolled: items.filter((c) => c.ineligible_reason === "Already Enrolled").length,
      bounced: items.filter((c) => c.ineligible_reason === "Bounced").length,
      replied: items.filter((c) => c.ineligible_reason === "Replied").length,
    };

    return { contacts: items, summary };
  }

  /**
   * Removes an enrolled contact from a campaign.
   */
  async removeContact(
    campaignId: string,
    contactId: string,
    businessId: string
  ): Promise<boolean> {
    const campaign = await this.repository.findByIdAndBusinessId(campaignId, businessId);
    if (!campaign) {
      throw new Error("Campaign not found or access denied.");
    }

    return this.repository.removeLead(campaignId, contactId, businessId);
  }
}

export const campaignService = new CampaignService();
