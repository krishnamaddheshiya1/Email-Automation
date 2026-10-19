import { NextResponse } from "next/server";
import { HealthService } from "@/server/services";


/**
 * Health check endpoint for monitoring and uptime probes.
 * Adheres strictly to the decoupled server service layer architecture.
 *
 * GET /api/health
 */
export async function GET() {
  const health = HealthService.getHealth();
  return NextResponse.json(health, { status: 200 });
}
