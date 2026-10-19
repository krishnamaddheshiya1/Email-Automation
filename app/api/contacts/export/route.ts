import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AuthService, contactService } from "@/server/services";

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const session = await AuthService.getCurrentSession(supabase);

    if (!session) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search") || undefined;
    const status = searchParams.get("status") || undefined;
    const source = searchParams.get("source") || undefined;
    const sortBy = (searchParams.get("sortBy") as "created_at" | "name" | "lead_score") || undefined;
    const sortOrder = (searchParams.get("sortOrder") as "asc" | "desc") || undefined;

    const csvContent = await contactService.exportCsv(session.business.id, {
      search,
      status,
      source,
      sortBy,
      sortOrder,
    });

    const timestamp = new Date().toISOString().split("T")[0];
    const filename = `contacts-${timestamp}.csv`;

    return new NextResponse(csvContent, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to export contacts";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
