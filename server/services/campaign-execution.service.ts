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
  constructor(
    private executionRepo: CampaignExecutionRepository = new CampaignExecutionRepository(),
    private campaignRepo: CampaignRepository = new CampaignRepository(),
    private leadRepo: LeadRepository = new LeadRepository(),
    private templateRepo: TemplateRepository = new TemplateRepository(),
    private suppressionRepo: SuppressionRepository = new SuppressionRepository(),
    private emailService: EmailService = defaultEmailService,
    private safetyService: DeliverySafetyService = defaultDeliverySafetyService,
    private messageRepo: EmailMessageRepository = new EmailMessageRepository()
  ) {}

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
      options.campaignId
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
        ["ENROLLED", "RUNNING"].includes(e.status.toUpperCase())
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
      await this.executionRepo.updateEnrollment(enrollment.id, {
        status: "FAILED",
        stopped_at: new Date().toISOString(),
        last_error: "CONTACT_NOT_FOUND_OR_CROSS_TENANT",
      });
      return {
        enrollmentId: enrollment.id,
        leadId: enrollment.lead_id,
        campaignId: campaign.id,
        success: false,
        status: "FAILED",
        error: "Contact not found or does not belong to this business.",
      };
    }

    // 4b. Stop Sequence If Contact Has Replied
    if (
      String(enrollment.status).toUpperCase() === "REPLIED" ||
      String(contact.status).toLowerCase() === "replied"
    ) {
      await this.executionRepo.updateEnrollment(enrollment.id, {
        status: "REPLIED",
        next_run_at: null,
        stopped_at: enrollment.stopped_at || new Date().toISOString(),
        last_error: "STOPPED_ON_REPLY",
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

    // 5. Validate Contact Email Address
    const recipientEmail = contact.email?.trim().toLowerCase() || "";
    if (!recipientEmail || !emailRegex.test(recipientEmail)) {
      await this.executionRepo.updateEnrollment(enrollment.id, {
        status: "STOPPED",
        stopped_at: new Date().toISOString(),
        last_error: "INVALID_EMAIL",
      });
      return {
        enrollmentId: enrollment.id,
        leadId: enrollment.lead_id,
        campaignId: campaign.id,
        success: false,
        status: "STOPPED",
        error: `Invalid contact email address: "${contact.email}"`,
      };
    }

    // 6. Suppression Check
    const isSuppressed = await this.suppressionRepo.isSuppressed(
      campaign.business_id,
      recipientEmail
    );
    if (isSuppressed) {
      await this.executionRepo.updateEnrollment(enrollment.id, {
        status: "STOPPED",
        stopped_at: new Date().toISOString(),
        last_error: "RECIPIENT_SUPPRESSED",
      });
      return {
        enrollmentId: enrollment.id,
        leadId: enrollment.lead_id,
        campaignId: campaign.id,
        success: false,
        status: "STOPPED",
        error: "Recipient is suppressed and cannot receive campaign emails.",
      };
    }

    // 7. Validate Step Email Template
    if (!stepToExecute.template_id) {
      await this.executionRepo.updateEnrollment(enrollment.id, {
        status: "FAILED",
        last_error: "MISSING_TEMPLATE",
      });
      return {
        enrollmentId: enrollment.id,
        leadId: enrollment.lead_id,
        campaignId: campaign.id,
        success: false,
        status: "FAILED",
        error: `Step ${stepToExecute.step_number} is missing an email template.`,
      };
    }

    const template = await this.templateRepo.findByIdAndBusinessId(
      stepToExecute.template_id,
      campaign.business_id
    );
    if (!template) {
      await this.executionRepo.updateEnrollment(enrollment.id, {
        status: "FAILED",
        last_error: "TEMPLATE_NOT_FOUND_OR_CROSS_TENANT",
      });
      return {
        enrollmentId: enrollment.id,
        leadId: enrollment.lead_id,
        campaignId: campaign.id,
        success: false,
        status: "FAILED",
        error: "Template not found or does not belong to this business.",
      };
    }

    if (template.status?.toLowerCase() === "archived") {
      await this.executionRepo.updateEnrollment(enrollment.id, {
        status: "FAILED",
        last_error: "TEMPLATE_ARCHIVED",
      });
      return {
        enrollmentId: enrollment.id,
        leadId: enrollment.lead_id,
        campaignId: campaign.id,
        success: false,
        status: "FAILED",
        error: `Template "${template.name}" is archived.`,
      };
    }

    // 8. Idempotency Check
    const idempotencyKey = `${campaign.business_id}:${campaign.id}:${enrollment.id}:step_${stepToExecute.step_number}`;
    const existingLog = await this.executionRepo.findExecutionLogByIdempotencyKey(
      idempotencyKey
    );

    if (existingLog && existingLog.status === "SUCCESS") {
      // Step already dispatched! Advance to next step or complete
      const nextStep = activeSteps.find((s) => s.step_number > stepToExecute!.step_number);
      if (nextStep) {
        const baseTime = new Date(existingLog.completed_at || Date.now());
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
        skippedIdempotent: true,
        messageId: existingLog.email_message_id || undefined,
      };
    }

    // 8b. Pre-send Duplicate-Send Protection Check
    const isManualOverride = Boolean(enrollment.is_manual_override);
    if (!isManualOverride) {
      const alreadySent = await this.messageRepo.hasMessageForStep(
        campaign.id,
        stepToExecute.id,
        contact.id
      );

      if (alreadySent) {
        console.warn(
          `[DUPLICATE_SEND_PREVENTED] contact: ${contact.id} campaign: ${campaign.id} step: ${stepToExecute.id} reason: "Step already sent to this contact"`
        );

        const nextStep = activeSteps.find((s) => s.step_number > stepToExecute!.step_number);
        if (nextStep) {
          const nextRunAt = this.calculateNextRunAt(
            new Date(),
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
          skippedIdempotent: true,
        };
      }
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
      await this.executionRepo.updateEnrollment(enrollment.id, {
        status: "FAILED",
        last_error: "INVALID_SENDER_CONFIGURATION",
      });
      return {
        enrollmentId: enrollment.id,
        leadId: enrollment.lead_id,
        campaignId: campaign.id,
        success: false,
        status: "FAILED",
        error: "Sender email is not properly configured.",
      };
    }

    // 10b. Business Sending Limits Check
    const limitCheck = await this.safetyService.checkLimits(campaign.business_id);
    if (!limitCheck.allowed) {
      const backoffMs = limitCheck.reason?.includes("HOURLY") ? 15 * 60 * 1000 : 60 * 60 * 1000;
      const nextRunAt = new Date(Date.now() + backoffMs);
      await this.executionRepo.updateEnrollment(enrollment.id, {
        status: "RUNNING",
        next_run_at: nextRunAt.toISOString(),
        last_error: `SEND_LIMIT_REACHED: ${limitCheck.reason}`,
      });
      return {
        enrollmentId: enrollment.id,
        leadId: enrollment.lead_id,
        campaignId: campaign.id,
        success: false,
        status: "RUNNING",
        stepNumber: stepToExecute.step_number,
        error: `Business sending limit reached (${limitCheck.reason}). Deferred until ${nextRunAt.toISOString()}`,
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

      await this.executionRepo.updateExecutionLog(execLog.id, {
        status: "FAILED",
        error: errorMessage,
      });

      await this.executionRepo.updateEnrollment(enrollment.id, {
        status: "FAILED",
        last_error: errorMessage,
      });

      return {
        enrollmentId: enrollment.id,
        leadId: enrollment.lead_id,
        campaignId: campaign.id,
        success: false,
        status: "FAILED",
        stepNumber: stepToExecute.step_number,
        error: errorMessage,
      };
    }

    // 12. Evaluate Send Result
    if (sendResult.success) {
      const nowIso = new Date().toISOString();
      const actualSendTime = new Date(sendResult.message.sent_at || nowIso);

      // Complete execution log
      await this.executionRepo.updateExecutionLog(execLog.id, {
        status: "SUCCESS",
        email_message_id: sendResult.message.id,
        completed_at: nowIso,
      });

      // Find next active step
      const nextStep = activeSteps.find((s) => s.step_number > stepToExecute!.step_number);
      if (nextStep) {
        // Calculate next_run_at strictly from actual successful send timestamp
        const nextRunAt = this.calculateNextRunAt(
          actualSendTime,
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
          providerMessageId:
            sendResult.providerResult?.providerMessageId ||
            sendResult.message.provider_message_id ||
            undefined,
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
          providerMessageId:
            sendResult.providerResult?.providerMessageId ||
            sendResult.message.provider_message_id ||
            undefined,
          sender: senderIdentity.fromEmail,
          recipient: recipientEmail,
          acceptedByProvider: true,
        };
      }
    } else {
      // 13. Dispatch Failed -> Handle Retries / Permanent Failure
      const errorMessage = sendResult.providerResult?.error?.message || "Delivery failed";
      const errorCode = sendResult.providerResult?.error?.code || "DISPATCH_FAILED";

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
          last_error: errorCode,
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
