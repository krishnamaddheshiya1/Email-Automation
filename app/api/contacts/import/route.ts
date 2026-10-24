import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AuthService, contactService } from "@/server/services";
import { ContactImportMode } from "@/types/database";
import { rateLimiter, RATE_LIMIT_PROFILES, createRateLimitResponse } from "@/server/security/rate-limiter";
import { convertSpreadsheetToCsv } from "@/lib/utils/spreadsheet";

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
    let rangeType: "all" | "range" = "all";
    let startRow: number | undefined;
    let endRow: number | undefined;

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
        if (!lowerName.endsWith(".csv") && !lowerName.endsWith(".xlsx") && !lowerName.endsWith(".xls")) {
          return NextResponse.json(
            { success: false, error: "Invalid file type. Only CSV (.csv) and Excel (.xlsx, .xls) files are supported." },
            { status: 400 }
          );
        }
      }

      const arrayBuffer = await fileObj.arrayBuffer();
      csvContent = convertSpreadsheetToCsv(Buffer.from(arrayBuffer), filename);

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

      const rtRaw = formData.get("range_type") || formData.get("rangeType");
      if (rtRaw === "range" || rtRaw === "all") {
        rangeType = rtRaw;
      }
      const srRaw = formData.get("start_row") || formData.get("startRow");
      if (srRaw !== null && srRaw !== undefined && srRaw !== "") {
        const parsed = parseInt(String(srRaw), 10);
        if (!isNaN(parsed)) startRow = parsed;
      }
      const erRaw = formData.get("end_row") || formData.get("endRow");
      if (erRaw !== null && erRaw !== undefined && erRaw !== "") {
        const parsed = parseInt(String(erRaw), 10);
        if (!isNaN(parsed)) endRow = parsed;
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
      if (body.range_type || body.rangeType) {
        rangeType = body.range_type || body.rangeType;
      }
      if (body.start_row !== undefined || body.startRow !== undefined) {
        startRow = body.start_row !== undefined ? body.start_row : body.startRow;
      }
      if (body.end_row !== undefined || body.endRow !== undefined) {
        endRow = body.end_row !== undefined ? body.end_row : body.endRow;
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
        rangeType,
        startRow,
        endRow,
      }
    );

    return NextResponse.json({
      success: true,
      summary,
      message: `Import completed: ${summary.importedCount} imported, ${summary.skippedCount} skipped.`,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to import CSV";
    const status =
      message.includes("required") ||
      message.includes("empty") ||
      message.includes("limit") ||
      message.includes("Malformed") ||
      message.includes("range") ||
      message.includes("exceed") ||
      message.includes("Start row") ||
      message.includes("End row")
        ? 400
        : 500;
    return NextResponse.json(
      { success: false, error: message },
      { status }
    );
  }
}
