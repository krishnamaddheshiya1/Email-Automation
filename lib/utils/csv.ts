/**
 * RFC-4180 compliant CSV Parser and Serializer
 * Zero dependencies, handles quoted cells, multiline content, escaped quotes, BOM.
 */

export const DEFAULT_COLUMN_ALIASES: Record<string, string> = {
  // Email
  email: "email",
  "email address": "email",
  email_address: "email",
  "e-mail": "email",
  mail: "email",
  recipient: "email",

  // First name
  first_name: "first_name",
  firstname: "first_name",
  "first name": "first_name",
  fname: "first_name",
  first: "first_name",

  // Last name
  last_name: "last_name",
  lastname: "last_name",
  "last name": "last_name",
  lname: "last_name",
  last: "last_name",
  surname: "last_name",

  // Full name
  name: "full_name",
  "full name": "full_name",
  fullname: "full_name",

  // Phone
  phone: "phone",
  "phone number": "phone",
  phone_number: "phone",
  mobile: "phone",
  "mobile number": "phone",
  mobile_number: "phone",
  telephone: "phone",
  tel: "phone",

  // Company
  company: "company_name",
  company_name: "company_name",
  "company name": "company_name",
  organization: "company_name",
  org: "company_name",
  business: "company_name",

  // Job title
  job_title: "job_title",
  "job title": "job_title",
  title: "job_title",
  position: "job_title",
  role: "job_title",
  designation: "job_title",

  // Industry
  industry: "industry",
  sector: "industry",

  // Website
  website: "website",
  url: "website",
  web: "website",

  // Source
  source: "source",
  "lead source": "source",
  lead_source: "source",
  origin: "source",

  // Status
  status: "status",
  "lead status": "status",
  lead_status: "status",

  // Score
  lead_score: "lead_score",
  "lead score": "lead_score",
  score: "lead_score",
};


/**
 * Protect against formula injection in spreadsheets (Excel, Google Sheets, Calc)
 * Prefix cells beginning with =, +, -, @, \t, or \r with a single quote.
 */
export function sanitizeCsvValue(val: unknown): string {
  if (val === null || val === undefined) {
    return "";
  }
  let str = String(val);
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  return str;
}

export function escapeCsvField(val: unknown, sanitize = true): string {
  if (val === null || val === undefined) {
    return "";
  }
  const str = sanitize ? sanitizeCsvValue(val) : String(val);
  // If string contains comma, quote, or newline, escape double quotes and wrap in quotes
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function toCsv(
  headers: string[],
  rows: (string | number | null | undefined | boolean)[][],
  sanitize = true
): string {
  const headerLine = headers.map((h) => escapeCsvField(h, sanitize)).join(",");
  const dataLines = rows.map((row) => row.map((cell) => escapeCsvField(cell, sanitize)).join(","));
  return [headerLine, ...dataLines].join("\r\n");
}

export function parseCsv(csvText: string, options: { strict?: boolean } = { strict: true }): string[][] {
  // Strip UTF-8 BOM if present
  let text = csvText;
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }

  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = "";
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < text.length && text[i + 1] === '"') {
          // Escaped quote
          currentCell += '"';
          i += 2;
          continue;
        } else {
          // Closing quote
          inQuotes = false;
          i++;
          continue;
        }
      } else {
        currentCell += char;
        i++;
        continue;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
        i++;
        continue;
      } else if (char === ",") {
        currentRow.push(currentCell.trim());
        currentCell = "";
        i++;
        continue;
      } else if (char === "\r") {
        if (i + 1 < text.length && text[i + 1] === "\n") {
          i++; // Skip \r in \r\n
        }
        currentRow.push(currentCell.trim());
        rows.push(currentRow);
        currentRow = [];
        currentCell = "";
        i++;
        continue;
      } else if (char === "\n") {
        currentRow.push(currentCell.trim());
        rows.push(currentRow);
        currentRow = [];
        currentCell = "";
        i++;
        continue;
      } else {
        currentCell += char;
        i++;
        continue;
      }
    }
  }

  if (inQuotes && options.strict !== false) {
    throw new Error("Malformed CSV: unclosed quote detected.");
  }

  // Push last cell/row if remaining
  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell.trim());
    rows.push(currentRow);
  }

  // Filter out any trailing completely empty rows
  return rows.filter((row) => row.some((cell) => cell.length > 0));
}

export function parseCsvToObjects(csvText: string): {
  headers: string[];
  rows: Record<string, string>[];
} {
  const parsed = parseCsv(csvText);
  if (parsed.length === 0) {
    return { headers: [], rows: [] };
  }

  const rawHeaders = parsed[0];
  const headers = rawHeaders.map((h) => h.trim().toLowerCase());
  const rows: Record<string, string>[] = [];

  for (let r = 1; r < parsed.length; r++) {
    const row = parsed[r];
    const rowObj: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      const header = headers[c];
      if (header) {
        rowObj[header] = (row[c] || "").trim();
      }
    }
    rows.push(rowObj);
  }

  return { headers, rows };
}
