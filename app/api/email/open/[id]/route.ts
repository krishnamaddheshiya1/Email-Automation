import { NextRequest, NextResponse } from "next/server";
import { emailService } from "@/server/services/email.service";

// 1x1 transparent GIF binary
const TRANSPARENT_1X1_GIF = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64"
);

/**
 * GET /api/email/open/[id]
 *
 * Real-time email open tracking endpoint.
 * Fetched automatically by recipient email clients (Gmail, Outlook, Apple Mail, Webmail).
 * Marks the email as OPENED, increments open counts, creates email events, and updates analytics.
 * Returns an invisible 1x1 transparent GIF with anti-caching headers.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;

    if (id) {
      await emailService.recordEmailOpen(id).catch((err) => {
        console.warn("[Open Tracking] Failed to record open for id:", id, err);
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
    console.warn("[Open Tracking] Handler exception:", err);
    return new NextResponse(TRANSPARENT_1X1_GIF, {
      status: 200,
      headers: {
        "Content-Type": "image/gif",
      },
    });
  }
}
