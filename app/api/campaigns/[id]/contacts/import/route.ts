import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AuthService, campaignService } from "@/server/services";
import { validateUuid } from "@/lib/security/input-validation";
import { convertSpreadsheetToCsv } from "@/lib/utils/spreadsheet";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const idValidation = validateUuid(id, "Campaign ID");
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

    const contentType = request.headers.get("content-type") || "";
    let csvContent = "";
    let filename = "contacts.csv";
    let columnMapping: Record<string, string> | undefined;
    let rangeType: "all" | "range" = "all";
    let startRow: number | undefined;
    let endRow: number | undefined;
    let allowOverride = true;

    const maxMb = parseInt(process.env.CONTACT_IMPORT_MAX_FILE_MB || "10", 10);
    const maxBytes = maxMb * 1024 * 1024;

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const file = formData.get("file");

      if (!file || typeof file === "string") {
        return NextResponse.json(
          { success: false, error: "No spreadsheet or CSV file was provided." },
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

      filename = fileObj.name || "contacts.csv";
      const lowerName = filename.toLowerCase();
      if (!lowerName.endsWith(".csv") && !lowerName.endsWith(".xlsx") && !lowerName.endsWith(".xls")) {
        return NextResponse.json(
          { success: false, error: "Invalid file type. Only CSV (.csv) and Excel (.xlsx, .xls) files are supported." },
          { status: 400 }
        );
      }

      const arrayBuffer = await fileObj.arrayBuffer();
      try {
        csvContent = convertSpreadsheetToCsv(Buffer.from(arrayBuffer), filename);
      } catch (err: unknown) {
        return NextResponse.json(
          { success: false, error: err instanceof Error ? err.message : "Failed to parse spreadsheet file." },
          { status: 400 }
        );
      }

      const rtRaw = formData.get("range_type") || formData.get("rangeType");
      if (rtRaw === "range" || rtRaw === "all") rangeType = rtRaw;

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

      const mappingRaw = formData.get("column_mapping") || formData.get("columnMapping");
      if (typeof mappingRaw === "string" && mappingRaw.trim()) {
        try {
          columnMapping = JSON.parse(mappingRaw);
        } catch {
          // Fall back to auto-mapping
        }
      }

      const overrideRaw = formData.get("allow_override") || formData.get("allowOverride");
      if (overrideRaw !== null && overrideRaw !== undefined) {
        allowOverride = String(overrideRaw).toLowerCase() === "true" || overrideRaw === "1";
      }
    } else if (contentType.includes("application/json")) {
      const body = await request.json();
      csvContent = body.csv || "";
      if (body.filename) filename = body.filename;
      if (body.range_type || body.rangeType) {
        rangeType = body.range_type || body.rangeType;
      }
      if (body.start_row !== undefined || body.startRow !== undefined) {
        startRow = body.start_row !== undefined ? body.start_row : body.startRow;
      }
      if (body.end_row !== undefined || body.endRow !== undefined) {
        endRow = body.end_row !== undefined ? body.end_row : body.endRow;
      }
      if (body.column_mapping || body.columnMapping) {
        columnMapping = body.column_mapping || body.columnMapping;
      }
      if (body.allow_override !== undefined || body.allowOverride !== undefined) {
        allowOverride = Boolean(body.allow_override ?? body.allowOverride);
      }

      const lowerName = filename.toLowerCase();
      if (lowerName.endsWith(".xlsx") || lowerName.endsWith(".xls")) {
        try {
          csvContent = convertSpreadsheetToCsv(csvContent, filename);
        } catch (err: unknown) {
          return NextResponse.json(
            { success: false, error: err instanceof Error ? err.message : "Failed to parse spreadsheet content." },
            { status: 400 }
          );
        }
      }
    } else {
      csvContent = await request.text();
    }

    if (!csvContent || !csvContent.trim()) {
      return NextResponse.json(
        { success: false, error: "Spreadsheet content cannot be empty." },
        { status: 400 }
      );
    }

    const result = await campaignService.importAndEnrollContacts(
      id,
      session.business.id,
      {
        csvContent,
        filename,
        columnMapping,
        rangeType,
        startRow,
        endRow,
        ownerUserId: session.user.id,
        allowOverride,
      }
    );

    return NextResponse.json({
      ...result,
      message: `Processed ${result.totalSelected} row(s): ${result.enrolledCount} enrolled into campaign (${result.newContactsCount} new, ${result.existingContactsCount} existing, ${result.alreadyEnrolledCount} already enrolled).`,
    });
  } catch (err: unknown) {
    const errObj = err as Record<string, unknown>;
    const isLimitReached =
      errObj?.code === "DAILY_EMAIL_LIMIT_REACHED" ||
      errObj?.code === "MONTHLY_EMAIL_LIMIT_REACHED" ||
      (err instanceof Error &&
        (err.message.includes("DAILY_EMAIL_LIMIT_REACHED") ||
          err.message.includes("MONTHLY_EMAIL_LIMIT_REACHED")));

    if (isLimitReached) {
      const code =
        (errObj?.code as string) ||
        (String(errObj?.message || "").includes("MONTHLY")
          ? "MONTHLY_EMAIL_LIMIT_REACHED"
          : "DAILY_EMAIL_LIMIT_REACHED");
      return NextResponse.json(
        {
          success: false,
          error: code,
          code,
          limitType: errObj?.limitType || (code === "MONTHLY_EMAIL_LIMIT_REACHED" ? "monthly" : "daily"),
          dailySent: errObj?.dailySent,
          dailyLimit: errObj?.dailyLimit || 1500,
          dailyRemaining: errObj?.dailyRemaining,
          monthlySent: errObj?.monthlySent,
          monthlyLimit: errObj?.monthlyLimit || 50000,
          monthlyRemaining: errObj?.monthlyRemaining,
          attemptedCount: errObj?.attemptedCount,
          message: err instanceof Error ? err.message : "Sending limit reached.",
        },
        { status: 429 }
      );
    }

    const message = err instanceof Error ? err.message : "Failed to import contacts into campaign";
    const status =
      message.includes("not found") || message.includes("access denied")
        ? 404
        : message.includes("range") ||
          message.includes("empty") ||
          message.includes("format") ||
          message.includes("exceeds") ||
          message.includes("mapping") ||
          message.includes("positive integers")
        ? 400
        : 500;

    return NextResponse.json({ success: false, error: message }, { status });
  }
}
