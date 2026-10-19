import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AuthService, contactService } from "@/server/services";
import { ContactImportMode } from "@/types/database";
import { rateLimiter, RATE_LIMIT_PROFILES, createRateLimitResponse } from "@/server/security/rate-limiter";

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

    const rl = rateLimiter.consumeProfile(`import:${session.business.id}`, RATE_LIMIT_PROFILES.IMPORT);
    if (!rl.allowed) {
      return createRateLimitResponse(rl);
    }

    const contentType = request.headers.get("content-type") || "";
    let csvContent = "";
    let filename = "contacts.csv";
    let columnMapping: Record<string, string> | undefined;
    let mode: ContactImportMode = "CREATE_ONLY";

    const maxMb = parseInt(process.env.CONTACT_IMPORT_MAX_FILE_MB || "10", 10);
    const maxBytes = maxMb * 1024 * 1024;

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const file = formData.get("file");

      if (!file || typeof file === "string") {
        return NextResponse.json(
          { success: false, error: "No valid CSV file was uploaded." },
          { status: 400 }
        );
      }

      const fileObj = file as File;
      if (fileObj.size > maxBytes) {
        return NextResponse.json(
          { success: false, error: `File size exceeds maximum allowed limit of ${maxMb}MB.` },
          { status: 400 }
        );
      }

      if (fileObj.name) {
        filename = fileObj.name;
        const lowerName = filename.toLowerCase();
        if (lowerName.endsWith(".xlsx") || lowerName.endsWith(".xls")) {
          return NextResponse.json(
            {
              success: false,
              error:
                "Excel files (.xlsx, .xls) are not supported. Please export or save your file as CSV (.csv) before importing.",
            },
            { status: 400 }
          );
        }
        if (!lowerName.endsWith(".csv")) {
          return NextResponse.json(
            { success: false, error: "Invalid file type. Only CSV (.csv) files are supported." },
            { status: 400 }
          );
        }
      }

      csvContent = await fileObj.text();

      const mappingRaw = formData.get("column_mapping") || formData.get("columnMapping");
      if (mappingRaw && typeof mappingRaw === "string") {
        try {
          columnMapping = JSON.parse(mappingRaw);
        } catch {
          // Ignore parse error
        }
      }

      const modeRaw = formData.get("mode");
      if (modeRaw === "CREATE_OR_UPDATE" || modeRaw === "CREATE_ONLY") {
        mode = modeRaw as ContactImportMode;
      }
    } else if (contentType.includes("application/json")) {
      const body = await request.json();
      csvContent = body.csv || "";
      if (body.filename) filename = body.filename;
      if (body.column_mapping || body.columnMapping) {
        columnMapping = body.column_mapping || body.columnMapping;
      }
      if (body.mode === "CREATE_OR_UPDATE" || body.mode === "CREATE_ONLY") {
        mode = body.mode;
      }
    } else {
      csvContent = await request.text();
    }

    if (!csvContent || !csvContent.trim()) {
      return NextResponse.json(
        { success: false, error: "CSV file is empty." },
        { status: 400 }
      );
    }

    if (Buffer.byteLength(csvContent, "utf-8") > maxBytes) {
      return NextResponse.json(
        { success: false, error: `File size exceeds maximum allowed limit of ${maxMb}MB.` },
        { status: 400 }
      );
    }

    const summary = await contactService.importCsv(
      session.business.id,
      {
        csvContent,
        filename,
        columnMapping,
        mode,
        ownerUserId: session.user.id,
      }
    );

    return NextResponse.json({
      success: true,
      summary,
      message: `Import completed: ${summary.importedCount} imported, ${summary.skippedCount} skipped.`,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to import CSV";
    const status = message.includes("required") || message.includes("empty") || message.includes("limit") || message.includes("Malformed") ? 400 : 500;
    return NextResponse.json(
      { success: false, error: message },
      { status }
    );
  }
}
