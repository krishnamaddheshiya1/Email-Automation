import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AuthService, contactService } from "@/server/services";
import { updateContactSchema } from "@/lib/validations/contact";
import { validateUuid } from "@/lib/security/input-validation";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const session = await AuthService.getCurrentSession(supabase);

    if (!session) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { id } = await params;
    const idValidation = validateUuid(id, "Contact ID");
    if (!idValidation.valid) {
      return NextResponse.json({ success: false, error: idValidation.error }, { status: 400 });
    }

    const contact = await contactService.getContact(session.business.id, id);

    return NextResponse.json({
      success: true,
      data: contact,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to retrieve contact";
    const status = message === "Contact not found" ? 404 : 500;
    return NextResponse.json(
      { success: false, error: message },
      { status }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const session = await AuthService.getCurrentSession(supabase);

    if (!session) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { id } = await params;
    const idValidation = validateUuid(id, "Contact ID");
    if (!idValidation.valid) {
      return NextResponse.json({ success: false, error: idValidation.error }, { status: 400 });
    }

    const body = await request.json();
    const validation = updateContactSchema.safeParse(body);

    if (!validation.success) {
      const firstError = validation.error.issues[0]?.message || "Validation failed";
      return NextResponse.json(
        { success: false, error: firstError, details: validation.error.format() },
        { status: 400 }
      );
    }

    const updated = await contactService.updateContact(
      session.business.id,
      id,
      validation.data
    );

    return NextResponse.json({
      success: true,
      data: updated,
      message: "Contact updated successfully",
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to update contact";
    let status = 500;
    if (message === "Contact not found") status = 404;
    else if (message.includes("already exists")) status = 409;

    return NextResponse.json(
      { success: false, error: message },
      { status }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const session = await AuthService.getCurrentSession(supabase);

    if (!session) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { id } = await params;
    const idValidation = validateUuid(id, "Contact ID");
    if (!idValidation.valid) {
      return NextResponse.json({ success: false, error: idValidation.error }, { status: 400 });
    }

    await contactService.deleteContact(session.business.id, id);

    return NextResponse.json({
      success: true,
      message: "Contact deleted permanently",
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to delete contact";
    const status = message === "Contact not found" ? 404 : 500;
    return NextResponse.json(
      { success: false, error: message },
      { status }
    );
  }
}
