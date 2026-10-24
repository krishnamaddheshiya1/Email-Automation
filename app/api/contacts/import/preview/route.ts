import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AuthService, contactService } from "@/server/services";
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

    const contentType = request.headers.get("content-type") || "";
    let csvContent = "";
    let filename = "contacts.csv";

    const maxMb = parseInt(process.env.CONTACT_IMPORT_MAX_FILE_MB || "10", 10);
    const maxBytes = maxMb * 1024 * 1024;

    let rangeType: "all" | "range" = "all";
    let startRow: number | undefined;
    let endRow: number | undefined;

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const file = formData.get("file");

      if (!file || typeof file === "string") {
        return NextResponse.json(
          { success: false, error: "No valid CSV or spreadsheet file was provided." },
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

    const preview = await contactService.previewCsv(
      session.business.id,
      csvContent,
      filename,
      {
        rangeType,
        startRow,
        endRow,
      }
    );

    return NextResponse.json({
      success: true,
      ...preview,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to preview CSV";
    return NextResponse.json(
      { success: false, error: message },
      { status: 400 }
    );
  }
}
