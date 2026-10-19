import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AuthService, templateService } from "@/server/services";
import { duplicateTemplateSchema } from "@/lib/validations/template";
import { validateUuid } from "@/lib/security/input-validation";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const idValidation = validateUuid(id, "Template ID");
    if (!idValidation.valid) {
      return NextResponse.json({ success: false, error: idValidation.error }, { status: 400 });
    }

    const supabase = await createClient();
    const session = await AuthService.getCurrentSession(supabase);

    if (!session) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    let customName: string | undefined;
    try {
      const body = await request.json();
      const validation = duplicateTemplateSchema.safeParse(body);
      if (validation.success && validation.data.name) {
        customName = validation.data.name;
      }
    } catch {
      // Body is optional for duplicate
    }

    const duplicated = await templateService.duplicateTemplate(
      id,
      session.business.id,
      customName
    );

    return NextResponse.json(
      {
        success: true,
        message: "Template duplicated successfully.",
        template: duplicated,
      },
      { status: 201 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to duplicate template";
    const status = message.includes("not found") || message.includes("access denied") ? 404 : 400;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
