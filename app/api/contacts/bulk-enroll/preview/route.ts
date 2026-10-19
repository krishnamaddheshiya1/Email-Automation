import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AuthService, contactService } from "@/server/services";
import { bulkEnrollSchema } from "@/lib/validations/contact";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const session = await AuthService.getCurrentSession(supabase);

    if (!session) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const validation = bulkEnrollSchema.safeParse(body);

    if (!validation.success) {
      const firstError = validation.error.issues[0]?.message || "Validation failed";
      return NextResponse.json(
        { success: false, error: firstError, details: validation.error.flatten() },
        { status: 400 }
      );
    }

    const preview = await contactService.bulkEnrollPreview(
      session.business.id,
      validation.data.campaign_id,
      validation.data.contact_ids
    );

    return NextResponse.json({
      success: true,
      ...preview,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to preview bulk enrollment";
    const status = message.includes("not found") || message.includes("access denied") ? 404 : 400;
    return NextResponse.json(
      { success: false, error: message },
      { status }
    );
  }
}
