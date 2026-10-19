import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AuthService, contactService } from "@/server/services";
import { z } from "zod";
import { contactStatusEnum } from "@/lib/validations/contact";

const bulkActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("update_status"),
    ids: z.array(z.string().uuid("Invalid contact ID format")).min(1, "Select at least one contact"),
    status: contactStatusEnum,
  }),
  z.object({
    action: z.literal("archive"),
    ids: z.array(z.string().uuid("Invalid contact ID format")).min(1, "Select at least one contact"),
  }),
  z.object({
    action: z.literal("delete_permanent"),
    ids: z.array(z.string().uuid("Invalid contact ID format")).min(1, "Select at least one contact"),
  }),
]);

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
    const validation = bulkActionSchema.safeParse(body);

    if (!validation.success) {
      const firstError = validation.error.issues[0]?.message || "Validation failed";
      return NextResponse.json(
        { success: false, error: firstError, details: validation.error.format() },
        { status: 400 }
      );
    }

    const data = validation.data;
    if (data.action === "update_status") {
      const result = await contactService.bulkUpdateStatus(
        session.business.id,
        data.ids,
        data.status
      );
      return NextResponse.json({
        success: true,
        count: result.updatedCount,
        message: `Successfully updated ${result.updatedCount} contact(s).`,
      });
    } else if (data.action === "archive") {
      const result = await contactService.bulkArchive(
        session.business.id,
        data.ids
      );
      return NextResponse.json({
        success: true,
        count: result.archivedCount,
        message: `Successfully archived ${result.archivedCount} contact(s).`,
      });
    } else if (data.action === "delete_permanent") {
      const result = await contactService.bulkDeletePermanent(
        session.business.id,
        data.ids
      );
      return NextResponse.json({
        success: true,
        count: result.deletedCount,
        message: `Successfully permanently deleted ${result.deletedCount} contact(s).`,
      });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Bulk action failed";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
