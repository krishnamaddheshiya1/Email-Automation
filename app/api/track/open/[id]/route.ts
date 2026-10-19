import { NextRequest, NextResponse } from "next/server";
import { emailService } from "@/server/services/email.service";

// 1x1 transparent GIF binary
const TRANSPARENT_1X1_GIF = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64"
);

/**
 * GET /api/track/open/[id]
 *
 * Real-time tracking alias for email open events.
 * Resolves email open tracking pixels embedded in campaign messages.
 * Records open event, updates unique open counts, and returns 1x1 transparent GIF.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;

    if (id) {
      await emailService.recordEmailOpen(id).catch((err) => {
        console.warn("[Tracking Alias] Failed to record open for id:", id, err);
      });
    }

    return new NextResponse(TRANSPARENT_1X1_GIF, {
      status: 200,
      headers: {
        "Content-Type": "image/gif",
        "Content-Length": String(TRANSPARENT_1X1_GIF.length),
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
        Pragma: "no-cache",
        Expires: "0",
      },
    });
  } catch (err: unknown) {
    console.warn("[Tracking Alias] Handler exception:", err);
    return new NextResponse(TRANSPARENT_1X1_GIF, {
      status: 200,
      headers: {
        "Content-Type": "image/gif",
      },
    });
  }
}
