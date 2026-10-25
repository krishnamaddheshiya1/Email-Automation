import {
  CampaignStep,
  DelayUnit,
} from "@/types/database";
import { CampaignExecutionRepository, DueEnrollmentItem } from "../repositories/campaign-execution.repository";
import { CampaignRepository } from "../repositories/campaign.repository";
import { LeadRepository } from "../repositories/lead.repository";
import { TemplateRepository } from "../repositories/template.repository";
import { SuppressionRepository } from "../repositories/suppression.repository";
import { EmailService, emailService as defaultEmailService } from "./email.service";
import { EmailMessageRepository } from "../repositories/email-message.repository";
import { renderTemplate } from "@/lib/utils/template";
import { emailRegex } from "@/lib/validations/email";

export interface ExecutionCycleOptions {
  businessId?: string;
  campaignId?: string;
  limit?: number;
  retryFailed?: boolean;
}

export interface EnrollmentExecutionResult {
  enrollmentId: string;
  leadId: string;
  campaignId: string;
  success: boolean;
  stepNumber?: number;
  status: string;
  skippedIdempotent?: boolean;
  messageId?: string;
  error?: string;
  provider?: string;
  providerMessageId?: string;
  sender?: string;
  recipient?: string;
  acceptedByProvider?: boolean;
  errorCode?: string;
}

export interface ExecutionCycleSummary {
  processed: number;
  succeeded: number;
  failed: number;
  stopped: number;
  completed: number;
  retried: number;
  results: EnrollmentExecutionResult[];
  diagnostic?: string;
}

import {
  DeliverySafetyService,
  deliverySafetyService as defaultDeliverySafetyService,
} from "./delivery-safety.service";

export class CampaignExecutionService {
  private executionRepo: CampaignExecutionRepository;
  private campaignRepo: CampaignRepository;
  private leadRepo: LeadRepository;
  private templateRepo: TemplateRepository;
  private suppressionRepo: SuppressionRepository;
  private emailService: EmailService;
  private safetyService: DeliverySafetyService;
  private messageRepo: EmailMessageRepository;

  constructor(
    executionRepo: CampaignExecutionRepository = new CampaignExecutionRepository(),
    campaignRepo: CampaignRepository = new CampaignRepository(),
    leadRepo: LeadRepository = new LeadRepository(),
    templateRepo: TemplateRepository = new TemplateRepository(),
    suppressionRepo: SuppressionRepository = new SuppressionRepository(),
    emailService: EmailService = defaultEmailService,
    safetyService: DeliverySafetyService = defaultDeliverySafetyService,
    messageRepo: EmailMessageRepository = new EmailMessageRepository()
  ) {
    this.executionRepo = executionRepo;
    this.campaignRepo = campaignRepo;
    this.leadRepo = leadRepo;
    this.templateRepo = templateRepo;
    this.suppressionRepo = suppressionRepo;
    this.emailService = emailService;
    this.safetyService = safetyService;
    this.messageRepo = messageRepo;
  }

  /**
   * Calculates next run timestamp in UTC based on previous execution time and step delay.
   * Never calculates future steps from campaign enrollment time.
   */
  calculateNextRunAt(baseDate: Date, delayValue: number, delayUnit: DelayUnit): Date {
    const baseMs = baseDate.getTime();
    if (!delayValue || delayValue <= 0) {
      // Immediately executable (<= NOW)
      return new Date(baseMs - 1000);
    }

    let addMs = 0;
    const unit = String(delayUnit || "days").toLowerCase();
    if (unit === "minutes") {
      addMs = delayValue * 60 * 1000;
    } else if (unit === "hours") {
      addMs = delayValue * 60 * 60 * 1000;
    } else {
      // Default to days
      addMs = delayValue * 24 * 60 * 60 * 1000;
    }

    return new Date(baseMs + addMs);
  }

  /**
   * Initializes enrollments for a campaign when activated or new contacts are enrolled.
   * Finds the first active step and calculates its initial next_run_at.
   */
  async initializeCampaignEnrollments(
    campaignId: string,
    businessId: string
  ): Promise<number> {
    const campaign = await this.campaignRepo.findByIdAndBusinessId(campaignId, businessId);
    if (!campaign) {
      throw new Error("Campaign not found or access denied.");
    }
    if (campaign.status.toUpperCase() !== "ACTIVE") {
      return 0;
    }

    const steps = await this.campaignRepo.findStepsByCampaignId(campaignId);
    const activeSteps = steps
      .filter((s) => s.status.toUpperCase() === "ACTIVE")
      .sort((a, b) => a.step_number - b.step_number);

    if (activeSteps.length === 0) {
      return 0;
    }

    const firstStep = activeSteps[0];
    const initialNextRunAt = this.calculateNextRunAt(
      new Date(),
      firstStep.delay_value,
      firstStep.delay_unit
    );

    return this.executionRepo.initializeEnrollmentsForCampaign(
      campaignId,
      businessId,
      firstStep,
      initialNextRunAt
    );
  }

  /**
   * Resets failed enrollments back to ENROLLED for recovery when issues are resolved.
   */
  async retryFailedEnrollments(campaignId: string, businessId: string): Promise<number> {
    return this.executionRepo.resetFailedEnrollments(campaignId, businessId);
  }

  /**
   * Processes all due campaign enrollments across businesses or for a specific campaign.
   */
  async processDueEnrollments(
    options: ExecutionCycleOptions = {}
  ): Promise<ExecutionCycleSummary> {
    const batchSize =
      options.limit ||
      parseInt(process.env.CAMPAIGN_WORKER_BATCH_SIZE || "20", 10);
    const maxRetries = parseInt(process.env.CAMPAIGN_MAX_RETRIES || "3", 10);
    const devSendLimit =
      process.env.NODE_ENV !== "production"
        ? parseInt(process.env.CAMPAIGN_DEV_SEND_LIMIT || "5", 10)
        : null;

    // If targeting a specific campaign, perform status check and auto-heal uninitialized enrollments
    if (options.campaignId && options.businessId) {
      const camp = await this.campaignRepo.findByIdAndBusinessId(options.campaignId, options.businessId);
      if (camp) {
        const campStatus = (camp.status || "DRAFT").toUpperCase();
        if (campStatus === "PAUSED") {
          return {
            processed: 0,
            succeeded: 0,
            failed: 0,
            stopped: 0,
            completed: 0,
            retried: 0,
            results: [],
            diagnostic: "Campaign is currently paused. Please resume the campaign to run due jobs.",
          };
        }
        if (campStatus === "DRAFT") {
          return {
            processed: 0,
            succeeded: 0,
            failed: 0,
            stopped: 0,
            completed: 0,
            retried: 0,
            results: [],
            diagnostic: "Campaign is in DRAFT status. Please activate the campaign to execute sequence steps.",
          };
        }
        if (campStatus === "ARCHIVED") {
          return {
            processed: 0,
            succeeded: 0,
            failed: 0,
            stopped: 0,
            completed: 0,
            retried: 0,
            results: [],
            diagnostic: "Campaign is archived. No sequence steps can be executed.",
          };
        }

        // Auto-heal / initialize any pending enrollments for active campaign
        try {
          if (options.retryFailed) {
            await this.executionRepo.resetFailedEnrollments(options.campaignId, options.businessId);
          }
          await this.initializeCampaignEnrollments(options.campaignId, options.businessId);
        } catch {
          // Non-blocking initialization fallback
        }
      }
    }

    // Atomically claim due jobs
    let claimed = await this.executionRepo.claimDueEnrollments(
      batchSize,
      options.businessId,
      options.campaignId,
      options.retryFailed
    );

    // Enforce dev send safety limit if in non-production environment
    if (devSendLimit && claimed.length > devSendLimit) {
      claimed = claimed.slice(0, devSendLimit);
    }

    if (claimed.length === 0 && options.campaignId && options.businessId) {
      const enrollments = await this.campaignRepo.findEnrollments(options.campaignId, options.businessId, { limit: 100 });
      if (enrollments.total === 0) {
        return {
          processed: 0,
          succeeded: 0,
          failed: 0,
          stopped: 0,
          completed: 0,
          retried: 0,
          results: [],
          diagnostic: "No contacts are enrolled in this campaign.",
        };
      }

      const steps = await this.campaignRepo.findStepsByCampaignId(options.campaignId);
      const activeSteps = steps.filter((s) => (s.status || "ACTIVE").toUpperCase() === "ACTIVE");
      if (activeSteps.length === 0) {
        return {
          processed: 0,
          succeeded: 0,
          failed: 0,
          stopped: 0,
          completed: 0,
          retried: 0,
          results: [],
          diagnostic: "Campaign has no active steps configured.",
        };
      }

      const activeEnrollments = enrollments.data.filter((e) =>
        ["ENROLLED", "RUNNING", "WAITING"].includes(e.status.toUpperCase()) ||
        Boolean(options.retryFailed) ||
        (e.status.toUpperCase() === "FAILED" && Boolean((e.metadata as Record<string, unknown> | undefined)?.retry_eligible) && Number(e.retry_count || 0) < 3)
      );
      if (activeEnrollments.length === 0) {
        const allCompleted = enrollments.data.every((e) => e.status.toUpperCase() === "COMPLETED");
        return {
          processed: 0,
          succeeded: 0,
          failed: 0,
          stopped: 0,
          completed: 0,
          retried: 0,
          results: [],
          diagnostic: allCompleted
            ? "All enrolled contacts have already completed the campaign sequence."
            : "No active enrollments available (all contacts are stopped, completed, or failed).",
        };
      }

      // Check future next_run_at
      const futureDates = activeEnrollments
        .map((e) => (e.next_run_at ? new Date(e.next_run_at).getTime() : null))
        .filter((t): t is number => t !== null && t > Date.now());

      if (futureDates.length > 0) {
        const earliestFuture = new Date(Math.min(...futureDates));
        return {
          processed: 0,
          succeeded: 0,
          failed: 0,
          stopped: 0,
          completed: 0,
          retried: 0,
          results: [],
          diagnostic: `Next step execution is scheduled for ${earliestFuture.toLocaleString()} (step delay not yet reached).`,
        };
      }

      return {
        processed: 0,
        succeeded: 0,
        failed: 0,
        stopped: 0,
        completed: 0,
        retried: 0,
        results: [],
        diagnostic: "No due enrollments are currently ready for execution.",
      };
    }

    const summary: ExecutionCycleSummary = {
      processed: 0,
      succeeded: 0,
      failed: 0,
      stopped: 0,
      completed: 0,
      retried: 0,
      results: [],
    };

    for (const item of claimed) {
      summary.processed++;
      try {
        const result = await this.processEnrollmentItem(item, maxRetries);
        summary.results.push(result);

        if (result.success) {
          summary.succeeded++;
          if (result.status === "COMPLETED") {
            summary.completed++;
          }
        } else if (result.status === "STOPPED") {
          summary.stopped++;
        } else if (result.status === "FAILED") {
          summary.failed++;
        } else if (result.status === "RUNNING") {
          summary.retried++;
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Unexpected execution failure";
        summary.failed++;
        summary.results.push({
          enrollmentId: item.enrollment.id,
          leadId: item.enrollment.lead_id,
          campaignId: item.campaign.id,
          success: false,
          status: "FAILED",
          error: message,
        });

        await this.executionRepo.updateEnrollment(item.enrollment.id, {
          status: "FAILED",
          last_error: message,
        });
      }
    }

    return summary;
  }

  /**
   * Processes an individual claimed enrollment item.
   */
  async processEnrollmentItem(
    item: DueEnrollmentItem,
    maxRetries: number
  ): Promise<EnrollmentExecutionResult> {
    const { enrollment, campaign } = item;

    // 1. Verify Campaign State
    if (campaign.status.toUpperCase() === "PAUSED") {
      // Do not execute future jobs; retain existing next_run_at
      await this.executionRepo.updateEnrollment(enrollment.id, {
        status: "PAUSED",
      });
      return {
        enrollmentId: enrollment.id,
        leadId: enrollment.lead_id,
        campaignId: campaign.id,
        success: false,
        status: "PAUSED",
        error: "Campaign is currently paused.",
      };
    }

    if (campaign.status.toUpperCase() === "ARCHIVED") {
      await this.executionRepo.updateEnrollment(enrollment.id, {
        status: "STOPPED",
        stopped_at: new Date().toISOString(),
        last_error: "CAMPAIGN_ARCHIVED",
      });
      return {
        enrollmentId: enrollment.id,
        leadId: enrollment.lead_id,
        campaignId: campaign.id,
        success: false,
        status: "STOPPED",
        error: "Campaign is archived.",
      };
    }

    if (campaign.status.toUpperCase() !== "ACTIVE") {
      return {
        enrollmentId: enrollment.id,
        leadId: enrollment.lead_id,
        campaignId: campaign.id,
        success: false,
        status: enrollment.status,
        error: `Campaign is in non-executable status: ${campaign.status}`,
      };
    }

    // 2. Load active steps for this campaign
    const steps = await this.campaignRepo.findStepsByCampaignId(campaign.id);
    const activeSteps = steps
      .filter((s) => s.status.toUpperCase() === "ACTIVE")
      .sort((a, b) => a.step_number - b.step_number);

    if (activeSteps.length === 0) {
      // No active steps remain in campaign -> complete enrollment
      await this.executionRepo.updateEnrollment(enrollment.id, {
        status: "COMPLETED",
        completed_at: new Date().toISOString(),
        next_step_id: null,
        next_run_at: null,
      });
      return {
        enrollmentId: enrollment.id,
        leadId: enrollment.lead_id,
        campaignId: campaign.id,
        success: true,
        status: "COMPLETED",
      };
    }

    // 3. Determine Step to Execute
    let stepToExecute: CampaignStep | undefined;
    if (!enrollment.current_step || enrollment.current_step === 0) {
      stepToExecute = activeSteps[0];
    } else {
      stepToExecute = activeSteps.find((s) => s.step_number > (enrollment.current_step ?? 0));
    }

    if (!stepToExecute) {
      // All steps already completed
      await this.executionRepo.updateEnrollment(enrollment.id, {
        status: "COMPLETED",
        completed_at: new Date().toISOString(),
        next_step_id: null,
        next_run_at: null,
      });
      return {
        enrollmentId: enrollment.id,
        leadId: enrollment.lead_id,
        campaignId: campaign.id,
        success: true,
        status: "COMPLETED",
      };
    }

    // 4. Validate Contact (Lead)
    const contact = await this.leadRepo.findByIdAndBusinessId(
      enrollment.lead_id,
      campaign.business_id
    );
    if (!contact) {
      const errCode = "CONTACT_NOT_FOUND_OR_CROSS_TENANT";
      const errMsg = "Contact not found or does not belong to this business.";
      await this.executionRepo.updateEnrollment(enrollment.id, {
        status: "FAILED",
        stopped_at: new Date().toISOString(),
        last_error: `${errCode}: ${errMsg}`,
        metadata: {
          ...(enrollment.metadata || {}),
          last_error_code: errCode,
          last_error_message: errMsg,
          failed_step: stepToExecute.step_number,
          failed_at: new Date().toISOString(),
          retry_eligible: false,
        },
      });
      return {
        enrollmentId: enrollment.id,
        leadId: enrollment.lead_id,
        campaignId: campaign.id,
        success: false,
        status: "FAILED",
        stepNumber: stepToExecute.step_number,
        errorCode: errCode,
        error: errMsg,
      };
    }

    console.log(
      `[CAMPAIGN_EXECUTION_STARTED] workspaceId=${campaign.business_id} campaignId=${campaign.id} enrollmentId=${enrollment.id} contactId=${contact.id} stepNumber=${stepToExecute.step_number} stepId=${stepToExecute.id}`
    );

    // 4b. Stop Sequence If Contact Has Replied
    const contactStatus = String(contact.status || "").toLowerCase();
    if (
      String(enrollment.status).toUpperCase() === "REPLIED" ||
      contactStatus === "replied"
    ) {
      await this.executionRepo.updateEnrollment(enrollment.id, {
        status: "REPLIED",
        next_run_at: null,
        stopped_at: enrollment.stopped_at || new Date().toISOString(),
        last_error: "STOPPED_ON_REPLY: Contact has replied to campaign.",
        metadata: {
          ...(enrollment.metadata || {}),
          last_error_code: "STOPPED_ON_REPLY",
          last_error_message: "Contact has replied to campaign.",
          retry_eligible: false,
        },
      });
      return {
        enrollmentId: enrollment.id,
        leadId: enrollment.lead_id,
        campaignId: campaign.id,
        success: false,
        status: "STOPPED",
        error: "Contact has replied to campaign. Sequence stopped.",
      };
    }

    // 4c. Stop Sequence If Contact Has Unsubscribed
    if (contactStatus === "unsubscribed") {
      const errCode = "CONTACT_UNSUBSCRIBED";
      const errMsg = "Contact has unsubscribed and cannot receive further sequence emails.";
      await this.executionRepo.updateEnrollment(enrollment.id, {
        status: "STOPPED",
        next_run_at: null,
        stopped_at: new Date().toISOString(),
        last_error: `${errCode}: ${errMsg}`,
        metadata: {
          ...(enrollment.metadata || {}),
          last_error_code: errCode,
          last_error_message: errMsg,
          failed_step: stepToExecute.step_number,
          failed_at: new Date().toISOString(),
          retry_eligible: false,
        },
      });
      return {
        enrollmentId: enrollment.id,
        leadId: enrollment.lead_id,
        campaignId: campaign.id,
        success: false,
        status: "STOPPED",
        stepNumber: stepToExecute.step_number,
        errorCode: errCode,
        error: errMsg,
      };
    }

    // 4d. Stop Sequence If Contact Has Previously Bounced
    if (contactStatus === "bounced") {
      const errCode = "CONTACT_BOUNCED";
      const errMsg = "Contact email address previously bounced and cannot be sent to.";
      await this.executionRepo.updateEnrollment(enrollment.id, {
        status: "STOPPED",
        next_run_at: null,
        stopped_at: new Date().toISOString(),
        last_error: `${errCode}: ${errMsg}`,
        metadata: {
          ...(enrollment.metadata || {}),
          last_error_code: errCode,
          last_error_message: errMsg,
          failed_step: stepToExecute.step_number,
          failed_at: new Date().toISOString(),
          retry_eligible: false,
        },
      });
      return {
        enrollmentId: enrollment.id,
        leadId: enrollment.lead_id,
        campaignId: campaign.id,
        success: false,
        status: "STOPPED",
        stepNumber: stepToExecute.step_number,
        errorCode: errCode,
        error: errMsg,
      };
    }

    // 5. Validate Contact Email Address
    const recipientEmail = contact.email?.trim().toLowerCase() || "";
    if (!recipientEmail || !emailRegex.test(recipientEmail)) {
      const errCode = "INVALID_EMAIL";
      const errMsg = `Invalid contact email address: "${contact.email || ""}"`;
      await this.executionRepo.updateEnrollment(enrollment.id, {
        status: "STOPPED",
        stopped_at: new Date().toISOString(),
        last_error: `${errCode}: ${errMsg}`,
        metadata: {
          ...(enrollment.metadata || {}),
          last_error_code: errCode,
          last_error_message: errMsg,
          failed_step: stepToExecute.step_number,
          failed_at: new Date().toISOString(),
          retry_eligible: false,
        },
      });
      return {
        enrollmentId: enrollment.id,
        leadId: enrollment.lead_id,
        campaignId: campaign.id,
        success: false,
        status: "STOPPED",
        stepNumber: stepToExecute.step_number,
        errorCode: errCode,
        error: errMsg,
      };
    }

    // 6. Suppression Check
    const isSuppressed = await this.suppressionRepo.isSuppressed(
      campaign.business_id,
      recipientEmail
    );
    if (isSuppressed) {
      const errCode = "RECIPIENT_SUPPRESSED";
      const errMsg = "Recipient is suppressed and cannot receive campaign emails.";
      await this.executionRepo.updateEnrollment(enrollment.id, {
        status: "STOPPED",
        stopped_at: new Date().toISOString(),
        last_error: `${errCode}: ${errMsg}`,
        metadata: {
          ...(enrollment.metadata || {}),
          last_error_code: errCode,
          last_error_message: errMsg,
          failed_step: stepToExecute.step_number,
          failed_at: new Date().toISOString(),
          retry_eligible: false,
        },
      });
      return {
        enrollmentId: enrollment.id,
        leadId: enrollment.lead_id,
        campaignId: campaign.id,
        success: false,
        status: "STOPPED",
        stepNumber: stepToExecute.step_number,
        errorCode: errCode,
        error: errMsg,
      };
    }

    // 7. Validate Step Email Template
    if (!stepToExecute.template_id) {
      const errCode = "MISSING_TEMPLATE";
      const errMsg = `Step ${stepToExecute.step_number} is missing an email template.`;
      await this.executionRepo.updateEnrollment(enrollment.id, {
        status: "FAILED",
        last_error: `${errCode}: ${errMsg}`,
        metadata: {
          ...(enrollment.metadata || {}),
          last_error_code: errCode,
          last_error_message: errMsg,
          failed_step: stepToExecute.step_number,
          failed_at: new Date().toISOString(),
          retry_eligible: true,
        },
      });
      return {
        enrollmentId: enrollment.id,
        leadId: enrollment.lead_id,
        campaignId: campaign.id,
        success: false,
        status: "FAILED",
        stepNumber: stepToExecute.step_number,
        errorCode: errCode,
        error: errMsg,
      };
    }

    const template = await this.templateRepo.findByIdAndBusinessId(
      stepToExecute.template_id,
      campaign.business_id
    );
    if (!template) {
      const errCode = "TEMPLATE_NOT_FOUND_OR_CROSS_TENANT";
      const errMsg = "Template not found or does not belong to this business.";
      await this.executionRepo.updateEnrollment(enrollment.id, {
        status: "FAILED",
        last_error: `${errCode}: ${errMsg}`,
        metadata: {
          ...(enrollment.metadata || {}),
          last_error_code: errCode,
          last_error_message: errMsg,
          failed_step: stepToExecute.step_number,
          failed_at: new Date().toISOString(),
          retry_eligible: true,
        },
      });
      return {
        enrollmentId: enrollment.id,
        leadId: enrollment.lead_id,
        campaignId: campaign.id,
        success: false,
        status: "FAILED",
        stepNumber: stepToExecute.step_number,
        errorCode: errCode,
        error: errMsg,
      };
    }

    if (template.status?.toLowerCase() === "archived") {
      const errCode = "TEMPLATE_ARCHIVED";
      const errMsg = `Template "${template.name}" is archived.`;
      await this.executionRepo.updateEnrollment(enrollment.id, {
        status: "FAILED",
        last_error: `${errCode}: ${errMsg}`,
        metadata: {
          ...(enrollment.metadata || {}),
          last_error_code: errCode,
          last_error_message: errMsg,
          failed_step: stepToExecute.step_number,
          failed_at: new Date().toISOString(),
          retry_eligible: true,
        },
      });
      return {
        enrollmentId: enrollment.id,
        leadId: enrollment.lead_id,
        campaignId: campaign.id,
        success: false,
        status: "FAILED",
        stepNumber: stepToExecute.step_number,
        errorCode: errCode,
        error: errMsg,
      };
    }

    // 8. Idempotency Check & Pre-send Duplicate Protection
    const idempotencyKey = `${campaign.business_id}:${campaign.id}:${enrollment.id}:step_${stepToExecute.step_number}`;
    const existingLog = await this.executionRepo.findExecutionLogByIdempotencyKey(
      idempotencyKey
    );

    // Double check email_messages table to guarantee duplicate send protection even across log store fallbacks
    const alreadySentMessage = await this.messageRepo.findSentMessageForStep(
      campaign.id,
      stepToExecute.id,
      contact.id
    );

    if ((existingLog && existingLog.status === "SUCCESS") || alreadySentMessage) {
      console.warn(
        `[DUPLICATE_SEND_PREVENTED] contact: ${contact.id} campaign: ${campaign.id} step: ${stepToExecute.id} reason: "Step already dispatched to this contact"`
      );

      // Step already dispatched! Advance to next step or complete
      const nextStep = activeSteps.find((s) => s.step_number > stepToExecute!.step_number);
      if (nextStep) {
        const baseTime = new Date(
          existingLog?.completed_at || alreadySentMessage?.sent_at || Date.now()
        );
        const nextRunAt = this.calculateNextRunAt(
          baseTime,
          nextStep.delay_value,
          nextStep.delay_unit
        );
        await this.executionRepo.updateEnrollment(enrollment.id, {
          current_step: stepToExecute.step_number,
          next_step_id: nextStep.id,
          next_run_at: nextRunAt.toISOString(),
          status: "WAITING",
          retry_count: 0,
          last_error: null,
        });
      } else {
        await this.executionRepo.updateEnrollment(enrollment.id, {
          current_step: stepToExecute.step_number,
          next_step_id: null,
          next_run_at: null,
          status: "COMPLETED",
          completed_at: new Date().toISOString(),
          retry_count: 0,
          last_error: null,
        });
      }
      return {
        enrollmentId: enrollment.id,
        leadId: enrollment.lead_id,
        campaignId: campaign.id,
        success: true,
        status: nextStep ? "WAITING" : "COMPLETED",
        stepNumber: stepToExecute.step_number,
        messageId: alreadySentMessage?.id || existingLog?.email_message_id || undefined,
        acceptedByProvider: true,
      };
    }

    // 9. Pre-flight Execution Log
    let execLog = existingLog;
    if (!execLog) {
      execLog = await this.executionRepo.createExecutionLog({
        business_id: campaign.business_id,
        campaign_id: campaign.id,
        campaign_step_id: stepToExecute.id,
        enrollment_id: enrollment.id,
        lead_id: contact.id,
        attempt_number: (enrollment.retry_count || 0) + 1,
        status: "CLAIMED",
        idempotency_key: idempotencyKey,
        email_message_id: null,
        error: null,
        completed_at: null,
      });
    }

    // 10. Render Template Tokens
    const contactContext = {
      first_name: contact.first_name || "",
      last_name: contact.last_name || "",
      email: contact.email || "",
      company_name: contact.company_name || "",
      job_title: contact.job_title || "",
    };
    const senderIdentity = await this.emailService.resolveSenderIdentity(campaign.business_id);
    if (!senderIdentity.fromEmail || !emailRegex.test(senderIdentity.fromEmail)) {
      const errCode = "INVALID_SENDER_CONFIGURATION";
      const errMsg = "Sender email is not properly configured or missing for this workspace.";
      await this.executionRepo.updateEnrollment(enrollment.id, {
        status: "FAILED",
        stopped_at: new Date().toISOString(),
        last_error: `${errCode}: ${errMsg}`,
        metadata: {
          ...(enrollment.metadata || {}),
          last_error_code: errCode,
          last_error_message: errMsg,
          failed_step: stepToExecute.step_number,
          failed_at: new Date().toISOString(),
          retry_eligible: true,
        },
      });
      return {
        enrollmentId: enrollment.id,
        leadId: enrollment.lead_id,
        campaignId: campaign.id,
        success: false,
        status: "FAILED",
        stepNumber: stepToExecute.step_number,
        errorCode: errCode,
        error: errMsg,
      };
    }

    // 10b. Business Sending Limits Check (Strict Hard Limit Enforcement)
    const limitCheck = await this.safetyService.checkLimits(campaign.business_id);
    if (!limitCheck.allowed) {
      const isDailyOrMonthly =
        limitCheck.code === "DAILY_EMAIL_LIMIT_REACHED" ||
        limitCheck.code === "MONTHLY_EMAIL_LIMIT_REACHED" ||
        limitCheck.reason?.includes("DAILY") ||
        limitCheck.reason?.includes("MONTHLY");

      const errorCode =
        limitCheck.code ||
        (limitCheck.reason?.includes("MONTHLY")
          ? "MONTHLY_EMAIL_LIMIT_REACHED"
          : "DAILY_EMAIL_LIMIT_REACHED");
      const errorMessage = limitCheck.reason || `Sending limit reached: ${errorCode}`;

      await this.executionRepo.updateEnrollment(enrollment.id, {
        status: isDailyOrMonthly ? "STOPPED" : "RUNNING",
        next_run_at: isDailyOrMonthly ? null : new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        last_error: `BLOCKED_BY_SENDING_LIMIT: ${errorCode}`,
        metadata: {
          ...(enrollment.metadata || {}),
          last_error_code: errorCode,
          last_error_message: errorMessage,
          failed_step: stepToExecute.step_number,
          failed_at: new Date().toISOString(),
          retry_eligible: true,
        },
      });
      return {
        enrollmentId: enrollment.id,
        leadId: enrollment.lead_id,
        campaignId: campaign.id,
        success: false,
        status: isDailyOrMonthly ? "STOPPED" : "RUNNING",
        stepNumber: stepToExecute.step_number,
        errorCode,
        error: `Business sending limit reached (${errorCode}). Outreach step blocked.`,
      };
    }

    const senderContext = {
      sender_name: senderIdentity.fromName,
      sender_email: senderIdentity.fromEmail,
      business_name: senderIdentity.fromName || "Our Team",
    };

    const templateBody =
      template.body ||
      (template as unknown as Record<string, unknown>).body_text ||
      (template as unknown as Record<string, unknown>).body_html ||
      "";

    const rendered = renderTemplate(
      { subject: template.subject || "", body: String(templateBody) },
      contactContext,
      senderContext
    );

    // 11. Dispatch Email through Phase 7 EmailService
    console.log(
      `[EMAIL_SEND_ATTEMPT] workspaceId=${campaign.business_id} campaignId=${campaign.id} enrollmentId=${enrollment.id} recipient=${recipientEmail} stepNumber=${stepToExecute.step_number}`
    );

    let sendResult: Awaited<ReturnType<typeof this.emailService.sendEmail>>;
    try {
      sendResult = await this.emailService.sendEmail(
        campaign.business_id,
        contact.owner_user_id || "system",
        {
          to: recipientEmail,
          leadId: contact.id,
          templateId: template.id,
          campaignId: campaign.id,
          campaignStepId: stepToExecute.id,
          senderIdentityId: campaign.sender_identity_id || undefined,
          subject: rendered.subject,
          body: rendered.body,
        }
      );
    } catch (dispatchErr: unknown) {
      const errorMessage =
        dispatchErr instanceof Error ? dispatchErr.message : "Dispatch execution failed";

      let errorCode = "DISPATCH_FAILED";
      const errLower = errorMessage.toLowerCase();
      if (errLower.includes("attachment") && (errLower.includes("no longer exists") || errLower.includes("not found") || errLower.includes("storage"))) {
        errorCode = "ATTACHMENT_NOT_FOUND";
      } else if (errLower.includes("suppressed")) {
        errorCode = "RECIPIENT_SUPPRESSED";
      } else if (errLower.includes("sender") && (errLower.includes("configured") || errLower.includes("verified") || errLower.includes("domain"))) {
        errorCode = "INVALID_SENDER_CONFIGURATION";
      } else if (errLower.includes("template")) {
        errorCode = "TEMPLATE_ERROR";
      } else if (errLower.includes("resend") || errLower.includes("api key") || errLower.includes("api authorization")) {
        errorCode = "RESEND_API_ERROR";
      } else if ((dispatchErr as { code?: string })?.code) {
        errorCode = (dispatchErr as { code: string }).code!;
      }

      console.error(
        `[CAMPAIGN_EXECUTION_FAILED] workspaceId=${campaign.business_id} campaignId=${campaign.id} enrollmentId=${enrollment.id} errorCode=${errorCode} errorMessage=${errorMessage}`
      );

      // PRE-CHECK: Verify if the step email was already dispatched despite the exception
      const alreadySent = await this.messageRepo.findSentMessageForStep(
        campaign.id,
        stepToExecute.id,
        contact.id
      );

      if (alreadySent) {
        console.warn(
          `[CampaignExecution] Dispatch exception caught but email was already dispatched (${alreadySent.id}): ${errorMessage}`
        );
        const nextStep = activeSteps.find((s) => s.step_number > stepToExecute!.step_number);
        if (nextStep) {
          const nextRunAt = this.calculateNextRunAt(
            new Date(alreadySent.sent_at || Date.now()),
            nextStep.delay_value,
            nextStep.delay_unit
          );
          await this.executionRepo.updateEnrollment(enrollment.id, {
            current_step: stepToExecute.step_number,
            next_step_id: nextStep.id,
            next_run_at: nextRunAt.toISOString(),
            status: "WAITING",
            retry_count: 0,
            last_error: null,
          });
        } else {
          await this.executionRepo.updateEnrollment(enrollment.id, {
            current_step: stepToExecute.step_number,
            next_step_id: null,
            next_run_at: null,
            status: "COMPLETED",
            completed_at: new Date().toISOString(),
            stopped_at: null,
            retry_count: 0,
            last_error: null,
          });
        }
        return {
          enrollmentId: enrollment.id,
          leadId: enrollment.lead_id,
          campaignId: campaign.id,
          success: true,
          status: nextStep ? "WAITING" : "COMPLETED",
          stepNumber: stepToExecute.step_number,
          messageId: alreadySent.id,
          acceptedByProvider: true,
        };
      }

      await this.executionRepo.updateExecutionLog(execLog.id, {
        status: "FAILED",
        error: errorMessage,
      });

      const isPermanentException =
        errorCode === "ATTACHMENT_NOT_FOUND" ||
        errLower.includes("no longer exists in storage") ||
        errLower.includes("missing from storage") ||
        errLower.includes("attachment record id") ||
        errLower.includes("suppressed") ||
        errLower.includes("template not found") ||
        errLower.includes("template is archived") ||
        errLower.includes("sender email is not properly configured");

      if (isPermanentException) {
        await this.executionRepo.updateEnrollment(enrollment.id, {
          status: "FAILED",
          last_error: `${errorCode}: ${errorMessage}`,
          next_run_at: null,
          stopped_at: new Date().toISOString(),
          metadata: {
            ...(enrollment.metadata || {}),
            last_error_code: errorCode,
            last_error_message: errorMessage,
            failed_step: stepToExecute.step_number,
            failed_at: new Date().toISOString(),
            retry_eligible: false,
          },
        });
      } else {
        const newRetryCount = (enrollment.retry_count || 0) + 1;
        if (newRetryCount <= maxRetries) {
          const backoffMinutes = Math.min(Math.pow(2, newRetryCount), 60);
          const nextRunAt = new Date(Date.now() + backoffMinutes * 60 * 1000);
          await this.executionRepo.updateEnrollment(enrollment.id, {
            retry_count: newRetryCount,
            next_run_at: nextRunAt.toISOString(),
            status: "RUNNING",
            last_error: `${errorCode}: ${errorMessage}`,
            metadata: {
              ...(enrollment.metadata || {}),
              last_error_code: errorCode,
              last_error_message: errorMessage,
              failed_step: stepToExecute.step_number,
              failed_at: new Date().toISOString(),
              retry_eligible: true,
            },
          });
        } else {
          await this.executionRepo.updateEnrollment(enrollment.id, {
            status: "FAILED",
            last_error: `MAX_RETRIES_EXCEEDED: ${errorMessage}`,
            next_run_at: null,
            stopped_at: new Date().toISOString(),
            metadata: {
              ...(enrollment.metadata || {}),
              last_error_code: "MAX_RETRIES_EXCEEDED",
              last_error_message: errorMessage,
              failed_step: stepToExecute.step_number,
              failed_at: new Date().toISOString(),
              retry_eligible: false,
            },
          });
        }
      }

      return {
        enrollmentId: enrollment.id,
        leadId: enrollment.lead_id,
        campaignId: campaign.id,
        success: false,
        status: "FAILED",
        stepNumber: stepToExecute.step_number,
        errorCode,
        error: errorMessage,
      };
    }

    // 12. Evaluate Send Result
    if (sendResult.success) {
      const nowIso = new Date().toISOString();
      const actualSendTime = new Date(sendResult.message.sent_at || nowIso);
      const providerMsgId =
        sendResult.providerResult?.providerMessageId ||
        sendResult.message.provider_message_id ||
        undefined;

      console.log(
        `[EMAIL_PROVIDER_ACCEPTED] workspaceId=${campaign.business_id} campaignId=${campaign.id} enrollmentId=${enrollment.id} providerMessageId=${providerMsgId || "accepted"}`
      );
      console.log(
        `[EMAIL_MESSAGE_CREATED] messageId=${sendResult.message.id} status=${sendResult.message.status}`
      );
      console.log(
        `[CAMPAIGN_STEP_COMPLETED] stepNumber=${stepToExecute.step_number} enrollmentId=${enrollment.id}`
      );

      // Complete execution log (non-blocking audit record)
      try {
        await this.executionRepo.updateExecutionLog(execLog.id, {
          status: "SUCCESS",
          email_message_id: sendResult.message.id,
          completed_at: nowIso,
        });
      } catch (logErr) {
        console.warn(`[CampaignExecution] Non-blocking execution log update warning for ${execLog.id}:`, logErr);
      }

      // Find next active step
      const nextStep = activeSteps.find((s) => s.step_number > stepToExecute!.step_number);
      if (nextStep) {
        // Calculate next_run_at strictly from actual successful send timestamp
        const nextRunAt = this.calculateNextRunAt(
          actualSendTime,
          nextStep.delay_value,
          nextStep.delay_unit
        );

        console.log(
          `[CAMPAIGN_NEXT_STEP_SCHEDULED] nextStepNumber=${nextStep.step_number} nextRunAt=${nextRunAt.toISOString()}`
        );

        await this.executionRepo.updateEnrollment(enrollment.id, {
          current_step: stepToExecute.step_number,
          next_step_id: nextStep.id,
          next_run_at: nextRunAt.toISOString(),
          status: "WAITING",
          retry_count: 0,
          last_error: null,
          is_manual_override: Boolean(enrollment.is_manual_override),
          started_at: enrollment.started_at || actualSendTime.toISOString(),
        });

        return {
          enrollmentId: enrollment.id,
          leadId: enrollment.lead_id,
          campaignId: campaign.id,
          success: true,
          status: "WAITING",
          stepNumber: stepToExecute.step_number,
          messageId: sendResult.message.id,
          provider: sendResult.providerResult?.provider || "resend",
          providerMessageId: providerMsgId,
          sender: senderIdentity.fromEmail,
          recipient: recipientEmail,
          acceptedByProvider: true,
        };
      } else {
        // Final step reached -> Mark enrollment COMPLETED
        await this.executionRepo.updateEnrollment(enrollment.id, {
          current_step: stepToExecute.step_number,
          next_step_id: null,
          next_run_at: null,
          status: "COMPLETED",
          completed_at: nowIso,
          stopped_at: null,
          retry_count: 0,
          last_error: null,
          is_manual_override: false,
          started_at: enrollment.started_at || actualSendTime.toISOString(),
        });

        return {
          enrollmentId: enrollment.id,
          leadId: enrollment.lead_id,
          campaignId: campaign.id,
          success: true,
          status: "COMPLETED",
          stepNumber: stepToExecute.step_number,
          messageId: sendResult.message.id,
          provider: sendResult.providerResult?.provider || "resend",
          providerMessageId: providerMsgId,
          sender: senderIdentity.fromEmail,
          recipient: recipientEmail,
          acceptedByProvider: true,
        };
      }
    } else {
      // 13. Dispatch Failed -> Handle Retries / Permanent Failure
      const errorMessage = sendResult.providerResult?.error?.message || "Delivery failed";
      const errorCode = sendResult.providerResult?.error?.code || "DISPATCH_FAILED";

      console.error(
        `[CAMPAIGN_EXECUTION_FAILED] workspaceId=${campaign.business_id} campaignId=${campaign.id} enrollmentId=${enrollment.id} errorCode=${errorCode} errorMessage=${errorMessage}`
      );

      await this.executionRepo.updateExecutionLog(execLog.id, {
        status: "FAILED",
        error: errorMessage,
      });

      // Permanent failure checks
      const isPermanent =
        errorCode === "RECIPIENT_SUPPRESSED" ||
        errorMessage.toLowerCase().includes("suppressed") ||
        errorMessage.toLowerCase().includes("invalid recipient");

      if (isPermanent) {
        await this.executionRepo.updateEnrollment(enrollment.id, {
          status: "STOPPED",
          stopped_at: new Date().toISOString(),
          last_error: `${errorCode}: ${errorMessage}`,
          metadata: {
            ...(enrollment.metadata || {}),
            last_error_code: errorCode,
            last_error_message: errorMessage,
            failed_step: stepToExecute.step_number,
            failed_at: new Date().toISOString(),
            retry_eligible: false,
          },
        });

        return {
          enrollmentId: enrollment.id,
          leadId: enrollment.lead_id,
          campaignId: campaign.id,
          success: false,
          status: "STOPPED",
          stepNumber: stepToExecute.step_number,
          error: errorMessage,
          errorCode,
          provider: sendResult.providerResult?.provider || "resend",
          sender: senderIdentity.fromEmail,
          recipient: recipientEmail,
          acceptedByProvider: false,
        };
      }

      // Transient failure -> Exponential backoff retry
      const newRetryCount = (enrollment.retry_count || 0) + 1;
      if (newRetryCount <= maxRetries) {
        // Backoff: 2^retryCount minutes (capped at 60 minutes)
        const backoffMinutes = Math.min(Math.pow(2, newRetryCount), 60);
        const nextRunAt = new Date(Date.now() + backoffMinutes * 60 * 1000);

        await this.executionRepo.updateEnrollment(enrollment.id, {
          retry_count: newRetryCount,
          next_run_at: nextRunAt.toISOString(),
          status: "RUNNING",
          last_error: `${errorCode}: ${errorMessage}`,
          metadata: {
            ...(enrollment.metadata || {}),
            last_error_code: errorCode,
            last_error_message: errorMessage,
            failed_step: stepToExecute.step_number,
            failed_at: new Date().toISOString(),
            retry_eligible: true,
          },
        });

        return {
          enrollmentId: enrollment.id,
          leadId: enrollment.lead_id,
          campaignId: campaign.id,
          success: false,
          status: "RUNNING",
          stepNumber: stepToExecute.step_number,
          error: `Attempt ${newRetryCount} failed. Retrying at ${nextRunAt.toISOString()}`,
          errorCode,
          provider: sendResult.providerResult?.provider || "resend",
          sender: senderIdentity.fromEmail,
          recipient: recipientEmail,
          acceptedByProvider: false,
        };
      } else {
        // Max retries exceeded -> Mark FAILED
        await this.executionRepo.updateEnrollment(enrollment.id, {
          retry_count: newRetryCount,
          status: "FAILED",
          stopped_at: new Date().toISOString(),
          last_error: `MAX_RETRIES_EXCEEDED: ${errorMessage}`,
          metadata: {
            ...(enrollment.metadata || {}),
            last_error_code: "MAX_RETRIES_EXCEEDED",
            last_error_message: errorMessage,
            failed_step: stepToExecute.step_number,
            failed_at: new Date().toISOString(),
            retry_eligible: false,
          },
        });

        return {
          enrollmentId: enrollment.id,
          leadId: enrollment.lead_id,
          campaignId: campaign.id,
          success: false,
          status: "FAILED",
          stepNumber: stepToExecute.step_number,
          error: `Max retries (${maxRetries}) exceeded: ${errorMessage}`,
          errorCode,
          provider: sendResult.providerResult?.provider || "resend",
          sender: senderIdentity.fromEmail,
          recipient: recipientEmail,
          acceptedByProvider: false,
        };
      }
    }
  }

  /**
   * Executes a single campaign enrollment by ID end-to-end.
   * Centralizes the execution workflow so any route/worker can invoke it consistently.
   */
  async executeCampaignEnrollment(
    enrollmentId: string,
    businessId?: string
  ): Promise<EnrollmentExecutionResult> {
    const enrollment = await this.executionRepo.findEnrollmentById(enrollmentId, businessId);
    if (!enrollment) {
      throw new Error(`Enrollment "${enrollmentId}" not found or cross-tenant access denied.`);
    }

    const campaign = await this.campaignRepo.findByIdAndBusinessId(
      enrollment.campaign_id,
      enrollment.business_id
    );
    if (!campaign) {
      throw new Error(`Campaign "${enrollment.campaign_id}" not found or cross-tenant access denied.`);
    }

    // Atomically claim the enrollment
    const claimedEnrollment = await this.executionRepo.updateEnrollment(enrollment.id, {
      status: "RUNNING",
      started_at: enrollment.started_at || new Date().toISOString(),
    });

    const maxRetries = parseInt(process.env.CAMPAIGN_MAX_RETRIES || "3", 10);
    return this.processEnrollmentItem(
      { enrollment: claimedEnrollment, campaign },
      maxRetries
    );
  }

  /**
   * Resets and re-enables a failed enrollment for retry.
   */
  async retryFailedEnrollment(enrollmentId: string, businessId?: string): Promise<boolean> {
    return this.executionRepo.resetFailedEnrollment(enrollmentId, businessId);
  }

  /**
   * Retrieves live execution metrics and summary for a campaign.
   */
  async getCampaignExecutionSummary(campaignId: string, businessId: string) {
    return this.executionRepo.getExecutionSummary(campaignId, businessId);
  }

  /**
   * Lists execution logs for a campaign.
   */
  async listCampaignExecutionLogs(campaignId: string, businessId: string, limit = 50) {
    return this.executionRepo.listExecutionLogs(campaignId, businessId, limit);
  }
}

export const campaignExecutionService = new CampaignExecutionService();
