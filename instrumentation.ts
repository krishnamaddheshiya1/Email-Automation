/**
 * Next.js Instrumentation Hook
 * Runs once when the server boots.
 * Initializes background campaign scheduler for due multi-step follow-ups.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    try {
      const { campaignScheduler } = await import("@/server/services/campaign-scheduler.service");
      campaignScheduler.ensureStarted(5000);
    } catch (e) {
      console.warn("[Instrumentation] Could not initialize campaign scheduler:", e);
    }
  }
}
