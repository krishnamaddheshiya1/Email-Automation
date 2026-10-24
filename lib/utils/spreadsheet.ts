import * as XLSX from "xlsx";

/**
 * Converts a CSV or Excel (XLSX/XLS) buffer, ArrayBuffer, or string to RFC-4180 CSV text.
 * Reuses standard parsing across all spreadsheet formats.
 */
export function convertSpreadsheetToCsv(
  data: Buffer | ArrayBuffer | Uint8Array | string,
  filename = "contacts.csv"
): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
    let workbook: XLSX.WorkBook;
    if (typeof data === "string") {
      workbook = XLSX.read(data, { type: "binary" });
    } else if (typeof Buffer !== "undefined" && Buffer.isBuffer(data)) {
      workbook = XLSX.read(data, { type: "buffer" });
    } else {
      const uint8 = data instanceof Uint8Array ? data : new Uint8Array(data);
      workbook = XLSX.read(uint8, { type: "array" });
    }

    if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
      throw new Error("Excel spreadsheet contains no worksheets.");
    }
    const firstSheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[firstSheetName];
    if (!sheet) {
      throw new Error("Excel worksheet could not be read.");
    }
    return XLSX.utils.sheet_to_csv(sheet);
  }

  if (typeof data === "string") {
    return data;
  }
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(data)) {
    return data.toString("utf-8");
  }
  return new TextDecoder("utf-8").decode(data);
}
