import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AuthService, contactService } from "@/server/services";

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

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const file = formData.get("file");

      if (!file || typeof file === "string") {
        return NextResponse.json(
          { success: false, error: "No valid CSV file was provided." },
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
    } else if (contentType.includes("application/json")) {
      const body = await request.json();
      csvContent = body.csv || "";
      if (body.filename) filename = body.filename;
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
      filename
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
