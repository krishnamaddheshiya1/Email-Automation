import { NextRequest, NextResponse } from "next/server";
import { deliverySafetyService } from "@/server/services/delivery-safety.service";

/**
 * Public Unsubscribe Endpoint
 *
 * Validates cryptographically signed unsubscribe token and adds recipient to suppression.
 * Does not require authentication or login.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get("token");

    if (!token) {
      return NextResponse.json(
        { success: false, error: "Missing required unsubscribe token." },
        { status: 400 }
      );
    }

    const result = await deliverySafetyService.handleUnsubscribe(token);
    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error || "Invalid unsubscribe token." },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "You have been unsubscribed successfully.",
      email: result.email,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unsubscribe processing error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const token = body.token;

    if (!token) {
      return NextResponse.json(
        { success: false, error: "Missing required unsubscribe token." },
        { status: 400 }
      );
    }

    const result = await deliverySafetyService.handleUnsubscribe(token);
    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error || "Invalid unsubscribe token." },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "You have been unsubscribed successfully.",
      email: result.email,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unsubscribe processing error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
