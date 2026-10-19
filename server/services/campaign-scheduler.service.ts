import { campaignExecutionService } from "./campaign-execution.service";

/**
 * Background Scheduler Service for Multi-Step Campaigns
 *
 * Automatically checks for and executes due campaign steps across active campaigns
 * without requiring manual user clicks.
 *
 * Features:
 * - Deterministic, non-overlapping execution cycles (concurrency lock)
 * - Safe error handling (worker never crashes)
 * - Lightweight timer with unref() to allow clean node shutdown
 * - Manual trigger via .tick() for immediate execution
 */
export class CampaignScheduler {
  private timer: NodeJS.Timeout | null = null;
  private isProcessing = false;
  private lastRunAt: string | null = null;
  private cycleCount = 0;
  private intervalMs: number;

  constructor(intervalMs = 5000) {
    this.intervalMs = intervalMs;
  }

  /**
   * Starts the background scheduler loop if not already running.
   */
  start(customIntervalMs?: number): void {
    if (this.timer) return;
    if (customIntervalMs) this.intervalMs = customIntervalMs;

    this.timer = setInterval(() => {
      this.tick().catch((err) => {
        console.warn("[CampaignScheduler] Unhandled cycle error:", err instanceof Error ? err.message : err);
      });
    }, this.intervalMs);

    if (this.timer.unref) {
      this.timer.unref();
    }
  }

  /**
   * Stops the background scheduler loop.
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Ensures the scheduler is active. Safe to call multiple times.
   */
  ensureStarted(customIntervalMs?: number): void {
    if (!this.timer) {
      this.start(customIntervalMs);
    }
  }

  /**
   * Performs a single execution cycle across all businesses/campaigns.
   * Concurrency lock prevents parallel overlapping execution.
   */
  async tick(options?: { businessId?: string; campaignId?: string; limit?: number }): Promise<void> {
    if (this.isProcessing) {
      return;
    }

    this.isProcessing = true;
    try {
      this.cycleCount++;
      this.lastRunAt = new Date().toISOString();
      const summary = await campaignExecutionService.processDueEnrollments(options);
      if (summary.processed > 0) {
        console.log(
          `[CampaignScheduler] Executed cycle #${this.cycleCount}: ${summary.processed} due processed (${summary.succeeded} sent, ${summary.failed} failed, ${summary.completed} completed).`
        );
      }

      // Periodically sync provider delivery/open/bounce statuses in background every 3 cycles
      if (this.cycleCount % 3 === 0) {
        try {
          const { emailService } = await import("./email.service");
          await emailService.syncProviderStatuses(options?.businessId);
        } catch {}
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Scheduler cycle failure";
      console.warn(`[CampaignScheduler] Execution cycle error: ${message}`);
    } finally {
      this.isProcessing = false;
    }
  }

  getStatus(): {
    running: boolean;
    isProcessing: boolean;
    lastRunAt: string | null;
    cycleCount: number;
    intervalMs: number;
  } {
    return {
      running: this.timer !== null,
      isProcessing: this.isProcessing,
      lastRunAt: this.lastRunAt,
      cycleCount: this.cycleCount,
      intervalMs: this.intervalMs,
    };
  }
}

export const campaignScheduler = new CampaignScheduler();
