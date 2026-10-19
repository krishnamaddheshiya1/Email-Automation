/**
 * Phase 8: Campaign Execution Engine Worker
 *
 * Standalone background worker process that polls for due campaign enrollments,
 * claims them atomically, and processes step executions through CampaignExecutionService.
 *
 * Can be run via:
 *   npm run worker
 */

import { campaignExecutionService } from "../server/services/campaign-execution.service";

const DEFAULT_INTERVAL_SECONDS = 60;
const DEFAULT_BATCH_SIZE = 20;

export interface WorkerCycleStats {
  processed: number;
  successful: number;
  failed: number;
  stopped: number;
  completed: number;
}

let isRunning = false;
let shouldStop = false;
let activeCyclePromise: Promise<WorkerCycleStats> | null = null;

/**
 * Executes a single worker cycle: claims due enrollments and dispatches them.
 */
export async function runWorkerCycle(options?: {
  batchSize?: number;
  campaignId?: string;
  businessId?: string;
}): Promise<WorkerCycleStats> {
  const batchSize =
    (options?.batchSize !== undefined
      ? options.batchSize
      : parseInt(process.env.CAMPAIGN_WORKER_BATCH_SIZE || "", 10)) ||
    DEFAULT_BATCH_SIZE;

  const cycleStart = new Date().toISOString();
  console.log(`[Worker] [${cycleStart}] Starting execution cycle (batchSize: ${batchSize})...`);

  try {
    const summary = await campaignExecutionService.processDueEnrollments({
      limit: batchSize,
      campaignId: options?.campaignId,
      businessId: options?.businessId,
    });

    console.log(
      `[Worker] Cycle complete: ${summary.processed} processed (${summary.succeeded} succeeded, ${summary.failed} failed, ${summary.stopped} stopped, ${summary.completed} completed).`
    );

    return {
      processed: summary.processed,
      successful: summary.succeeded,
      failed: summary.failed,
      stopped: summary.stopped,
      completed: summary.completed,
    };
  } catch (error) {
    console.error("[Worker] Error in execution cycle:", error);
    return {
      processed: 0,
      successful: 0,
      failed: 1,
      stopped: 0,
      completed: 0,
    };
  }
}

/**
 * Starts the continuous worker loop with graceful shutdown support.
 */
export async function startWorker(): Promise<void> {
  if (isRunning) {
    console.log("[Worker] Worker is already running.");
    return;
  }

  isRunning = true;
  shouldStop = false;

  const intervalSeconds =
    parseInt(process.env.CAMPAIGN_WORKER_INTERVAL_SECONDS || "", 10) ||
    DEFAULT_INTERVAL_SECONDS;

  console.log(`[Worker] Started campaign execution worker.`);
  console.log(`[Worker] Polling interval: ${intervalSeconds}s | Default batch size: ${process.env.CAMPAIGN_WORKER_BATCH_SIZE || DEFAULT_BATCH_SIZE}`);

  const shutdown = async (signal: string) => {
    if (shouldStop) return;
    console.log(`\n[Worker] Received ${signal}. Initiating graceful shutdown...`);
    shouldStop = true;
    isRunning = false;

    if (activeCyclePromise) {
      console.log("[Worker] Waiting for in-flight cycle to complete...");
      await activeCyclePromise;
    }

    console.log("[Worker] Clean exit complete. Goodbye.");
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  while (!shouldStop) {
    try {
      activeCyclePromise = runWorkerCycle();
      await activeCyclePromise;
    } catch (err) {
      console.error("[Worker] Unhandled cycle error:", err);
    } finally {
      activeCyclePromise = null;
    }

    if (shouldStop) break;

    // Sleep until next cycle interval or until shutdown requested
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, intervalSeconds * 1000);
      const checkInterval = setInterval(() => {
        if (shouldStop) {
          clearTimeout(timer);
          clearInterval(checkInterval);
          resolve();
        }
      }, 500);
    });
  }
}

// Auto-run when executed directly via CLI
if (
  process.argv[1]?.endsWith("worker/index.ts") ||
  process.argv[1]?.endsWith("worker\\index.ts") ||
  process.argv[1]?.endsWith("worker")
) {
  startWorker().catch((err) => {
    console.error("[Worker] Fatal error starting worker:", err);
    process.exit(1);
  });
}
