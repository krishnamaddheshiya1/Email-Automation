"use client";

import React, { useState, useRef, useMemo } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import {
  CsvPreviewResult,
  CsvImportSummary,
  ContactImportMode,
} from "@/types/database";
import { validateRowRange } from "@/lib/validations/contact";
import { parseCsv } from "@/lib/utils/csv";
import { convertSpreadsheetToCsv } from "@/lib/utils/spreadsheet";

interface CsvImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

type ImportStepNumber = 1 | 2 | 3 | 4 | 5 | 6;

const STEP_DEFINITIONS = [
  { num: 1, label: "Upload" },
  { num: 2, label: "Preview" },
  { num: 3, label: "Map" },
  { num: 4, label: "Validate" },
  { num: 5, label: "Import" },
  { num: 6, label: "Results" },
] as const;

function getContactSummary(
  contact: Record<string, string> | null | undefined,
  headers: string[],
  columnMapping?: Record<string, string>
) {
  if (!contact) return { email: "—", details: "No data available" };

  // Find email
  let email = "";
  if (columnMapping) {
    const emailHeader = Object.entries(columnMapping).find(([, f]) => f === "email")?.[0];
    if (emailHeader && contact[emailHeader]) email = contact[emailHeader];
  }
  if (!email) {
    const entry = Object.entries(contact).find(([k]) => k.toLowerCase().includes("email"));
    if (entry) email = entry[1];
  }
  if (!email) {
    const entry = Object.values(contact).find((v) => v.includes("@"));
    if (entry) email = entry;
  }

  // Find name
  let name = "";
  if (columnMapping) {
    const fnHeader = Object.entries(columnMapping).find(([, f]) => f === "first_name")?.[0];
    const lnHeader = Object.entries(columnMapping).find(([, f]) => f === "last_name")?.[0];
    const fn = fnHeader ? contact[fnHeader] : "";
    const ln = lnHeader ? contact[lnHeader] : "";
    if (fn || ln) name = [fn, ln].filter(Boolean).join(" ");
  }
  if (!name) {
    const entry = Object.entries(contact).find(([k]) => {
      const lower = k.toLowerCase();
      return lower.includes("name") && !lower.includes("company");
    });
    if (entry) name = entry[1];
  }

  // Find company
  let company = "";
  if (columnMapping) {
    const compHeader = Object.entries(columnMapping).find(([, f]) => f === "company_name")?.[0];
    if (compHeader) company = contact[compHeader];
  }
  if (!company) {
    const entry = Object.entries(contact).find(([k]) => {
      const lower = k.toLowerCase();
      return lower.includes("company") || lower.includes("org");
    });
    if (entry) company = entry[1];
  }

  const otherFields = Object.entries(contact)
    .filter(([k, v]) => v && k !== email && !v.includes("@"))
    .slice(0, 2)
    .map(([, v]) => v)
    .join(" · ");

  return {
    email: email || contact[headers[0]] || "—",
    details: [name, company].filter(Boolean).join(" · ") || otherFields || "Contact Record",
  };
}

function ContactPreviewCard({
  id,
  title,
  rowNumber,
  contact,
  headers,
  columnMapping,
}: {
  id?: string;
  title: string;
  rowNumber: number;
  contact: Record<string, string> | null | undefined;
  headers: string[];
  columnMapping?: Record<string, string>;
}) {
  const summary = getContactSummary(contact, headers, columnMapping);
  return (
    <div
      id={id}
      className="p-3 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 shadow-xs"
    >
      <div className="flex items-center justify-between text-[11px] mb-1">
        <span className="font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          {title}
        </span>
        <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
          Row #{rowNumber}
        </span>
      </div>
      <div className="text-xs font-semibold text-slate-900 dark:text-white truncate">
        {summary.email}
      </div>
      <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
        {summary.details}
      </div>
    </div>
  );
}

export function CsvImportModal({
  isOpen,
  onClose,
  onSuccess,
}: CsvImportModalProps) {
  const [step, setStep] = useState<ImportStepNumber>(1);
  const [file, setFile] = useState<File | null>(null);
  const [pasteMode, setPasteMode] = useState(false);
  const [pastedCsv, setPastedCsv] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Preview & Mapping State
  const [previewData, setPreviewData] = useState<CsvPreviewResult | null>(null);
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});
  const [importMode, setImportMode] = useState<ContactImportMode>("CREATE_ONLY");
  const [csvContentCache, setCsvContentCache] = useState<string>("");

  // Row Range Selection State
  const [rangeMode, setRangeMode] = useState<"all" | "range">("all");
  const [startRowInput, setStartRowInput] = useState<string>("1");
  const [endRowInput, setEndRowInput] = useState<string>("");

  // Summary State
  const [summary, setSummary] = useState<CsvImportSummary | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const resetState = () => {
    setStep(1);
    setFile(null);
    setPastedCsv("");
    setError(null);
    setPreviewData(null);
    setColumnMapping({});
    setImportMode("CREATE_ONLY");
    setCsvContentCache("");
    setRangeMode("all");
    setStartRowInput("1");
    setEndRowInput("");
    setSummary(null);
    setLoading(false);
  };

  const handleClose = () => {
    resetState();
    onClose();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selected = e.target.files[0];
      const lower = selected.name.toLowerCase();
      if (!lower.endsWith(".csv") && !lower.endsWith(".xlsx") && !lower.endsWith(".xls")) {
        setError("Invalid file type. Only CSV (.csv) and Excel (.xlsx, .xls) files are supported.");
        setFile(null);
        if (e.target) e.target.value = "";
        return;
      }
      setFile(selected);
      setError(null);
    }
  };

  // Step 1 -> Step 2: Fetch Preview
  const handleProceedToPreview = async () => {
    setError(null);
    setLoading(true);

    try {
      let content = "";
      let filename = "contacts.csv";

      if (pasteMode) {
        if (!pastedCsv.trim()) {
          throw new Error("Please paste CSV text to preview.");
        }
        content = pastedCsv;
      } else {
        if (!file) {
          throw new Error("Please select a CSV or Excel file to preview.");
        }
        filename = file.name;
        const arrayBuf = await file.arrayBuffer();
        content = convertSpreadsheetToCsv(arrayBuf, filename);
      }

      setCsvContentCache(content);

      const res = await fetch("/api/contacts/import/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv: content, filename }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to generate CSV preview.");
      }

      setPreviewData(data);
      // Initialize column mapping from detected mapping
      const initialMapping: Record<string, string> = {};
      for (const h of data.headers) {
        initialMapping[h] = data.detectedMapping[h] || "ignore";
      }
      setColumnMapping(initialMapping);
      setStartRowInput("1");
      setEndRowInput(String(data.totalRows));
      setRangeMode("all");
      setStep(2);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  // Full client-side parsed data rows for zero-latency preview of any row range
  const allParsedDataRows = useMemo(() => {
    if (!csvContentCache) return [];
    try {
      const parsed = parseCsv(csvContentCache);
      if (parsed.length <= 1) return [];
      const headers = parsed[0].map((h) => h.trim());
      return parsed
        .slice(1)
        .filter((r) => r.some((c) => c && c.trim().length > 0))
        .map((r) => {
          const obj: Record<string, string> = {};
          for (let c = 0; c < headers.length; c++) {
            obj[headers[c]] = (r[c] || "").trim();
          }
          return obj;
        });
    } catch {
      return [];
    }
  }, [csvContentCache]);

  // Real-time Range Validation & Live Preview Calculations
  const rangeValidation = useMemo(() => {
    const total = previewData?.totalRows ?? allParsedDataRows.length;
    return validateRowRange(total, {
      rangeType: rangeMode,
      startRow: startRowInput,
      endRow: endRowInput,
    });
  }, [previewData, allParsedDataRows.length, rangeMode, startRowInput, endRowInput]);

  const liveRangeStats = useMemo(() => {
    const totalAvailable = previewData?.totalRows ?? allParsedDataRows.length;
    if (rangeMode === "all") {
      return {
        isValid: true,
        startRow: totalAvailable > 0 ? 1 : 0,
        endRow: totalAvailable,
        selectedCount: totalAvailable,
        totalSelected: totalAvailable,
        firstContact: allParsedDataRows[0] || previewData?.previewRows[0] || null,
        lastContact: allParsedDataRows[totalAvailable - 1] || null,
        errorMessage: null,
      };
    }

    if (!rangeValidation.isValid) {
      return {
        isValid: false,
        startRow: 0,
        endRow: 0,
        selectedCount: 0,
        totalSelected: 0,
        firstContact: null,
        lastContact: null,
        errorMessage: rangeValidation.error || "Invalid range",
      };
    }

    const start = rangeValidation.startRow || 1;
    const end = rangeValidation.endRow || totalAvailable;
    const selectedCount = end - start + 1;

    return {
      isValid: true,
      startRow: start,
      endRow: end,
      selectedCount,
      totalSelected: selectedCount,
      firstContact: allParsedDataRows[start - 1] || null,
      lastContact: allParsedDataRows[end - 1] || null,
      errorMessage: null,
    };
  }, [previewData, allParsedDataRows, rangeMode, rangeValidation]);

  // Step 4 -> Step 5/6: Execute Import
  const handleExecuteImport = async () => {
    const hasEmail = Object.values(columnMapping).some((val) => val === "email");
    if (!hasEmail) {
      setError("Email column mapping is required.");
      return;
    }

    if (rangeMode === "range" && !liveRangeStats.isValid) {
      setError(liveRangeStats.errorMessage || "Please fix row range errors before importing.");
      return;
    }

    setError(null);
    setStep(5); // Show Import progress step
    setLoading(true);

    try {
      const res = await fetch("/api/contacts/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          csv: csvContentCache,
          filename: previewData?.filename || "contacts.csv",
          column_mapping: columnMapping,
          mode: importMode,
          range_type: rangeMode,
          start_row: rangeMode === "range" ? liveRangeStats.startRow : undefined,
          end_row: rangeMode === "range" ? liveRangeStats.endRow : undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to import contacts");
      }

      setSummary(data.summary);
      onSuccess(); // Immediately refresh underlying contacts list
      setStep(6); // Show Results step
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred during import");
      setStep(4); // Return to Validate step on failure
    } finally {
      setLoading(false);
    }
  };

  // Download Rejected Rows CSV
  const handleDownloadRejectedCsv = () => {
    if (!summary?.rejectedCsv) return;
    const blob = new Blob([summary.rejectedCsv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `rejected_contacts_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const isEmailMapped = Object.values(columnMapping).some((val) => val === "email");

  const getStepTitle = () => {
    switch (step) {
      case 1:
        return "Step 1: Upload CSV";
      case 2:
        return "Step 2: Preview Rows";
      case 3:
        return "Step 3: Map Columns";
      case 4:
        return "Step 4: Validate & Import Options";
      case 5:
        return "Step 5: Importing Contacts";
      case 6:
        return "Step 6: Import Results";
      default:
        return "Import Contacts";
    }
  };

  const getStepDescription = () => {
    switch (step) {
      case 1:
        return "Upload a CSV file or paste raw RFC-4180 CSV data.";
      case 2:
        return "Inspect sample rows from your uploaded CSV before configuring mappings.";
      case 3:
        return "Match your CSV headers to contact attributes (Email required).";
      case 4:
        return "Review deliverability safety checks and configure duplicate handling.";
      case 5:
        return "Processing contacts, checking suppression lists, and normalizing data...";
      case 6:
        return "Summary of contacts processed, imported, and skipped.";
      default:
        return "";
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={getStepTitle()}
      description={getStepDescription()}
      className={step === 2 || step === 3 ? "max-w-4xl" : "max-w-xl"}
    >
      {/* 6-Step Visual Progress Stepper */}
      <div className="mb-5 pb-3 border-b border-slate-100 dark:border-slate-800">
        <div className="flex items-center justify-between">
          {STEP_DEFINITIONS.map((s, idx) => {
            const isCompleted = step > s.num;
            const isCurrent = step === s.num;
            return (
              <React.Fragment key={s.num}>
                <div className="flex flex-col items-center">
                  <div
                    className={`h-7 w-7 rounded-full flex items-center justify-center text-xs font-semibold transition ${
                      isCompleted
                        ? "bg-emerald-600 text-white"
                        : isCurrent
                        ? "bg-blue-600 text-white ring-2 ring-blue-200 dark:ring-blue-900"
                        : "bg-slate-100 dark:bg-slate-800 text-slate-400"
                    }`}
                  >
                    {isCompleted ? "✓" : s.num}
                  </div>
                  <span
                    className={`text-[10px] mt-1 font-medium hidden sm:block ${
                      isCurrent
                        ? "text-blue-600 dark:text-blue-400 font-bold"
                        : isCompleted
                        ? "text-slate-700 dark:text-slate-300"
                        : "text-slate-400"
                    }`}
                  >
                    {s.label}
                  </span>
                </div>
                {idx < STEP_DEFINITIONS.length - 1 && (
                  <div
                    className={`flex-1 h-0.5 mx-1 transition ${
                      step > s.num ? "bg-emerald-500" : "bg-slate-200 dark:bg-slate-800"
                    }`}
                  />
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-rose-50 p-3 text-xs text-rose-700 border border-rose-200 dark:bg-rose-950/40 dark:border-rose-900 dark:text-rose-400">
          <p className="font-semibold">Import Error</p>
          <p>{error}</p>
        </div>
      )}

      {/* STEP 1: UPLOAD CSV */}
      {step === 1 && (
        <div className="space-y-4">
          <div className="flex rounded-lg border border-slate-200 dark:border-slate-800 p-1 bg-slate-50 dark:bg-slate-900 text-xs">
            <button
              type="button"
              className={`flex-1 py-1.5 font-medium rounded-md transition ${
                !pasteMode
                  ? "bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm"
                  : "text-slate-500 hover:text-slate-900 dark:hover:text-white"
              }`}
              onClick={() => {
                setPasteMode(false);
                setError(null);
              }}
            >
              Upload CSV File
            </button>
            <button
              type="button"
              className={`flex-1 py-1.5 font-medium rounded-md transition ${
                pasteMode
                  ? "bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm"
                  : "text-slate-500 hover:text-slate-900 dark:hover:text-white"
              }`}
              onClick={() => {
                setPasteMode(true);
                setError(null);
              }}
            >
              Paste CSV Text
            </button>
          </div>

          {!pasteMode ? (
            <div>
              <div
                className="mt-2 flex justify-center rounded-xl border border-dashed border-slate-300 dark:border-slate-700 px-6 pt-5 pb-6 hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer"
                onClick={() => fileInputRef.current?.click()}
              >
                <div className="space-y-2 text-center">
                  <svg
                    className="mx-auto h-10 w-10 text-slate-400"
                    stroke="currentColor"
                    fill="none"
                    viewBox="0 0 48 48"
                  >
                    <path
                      d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02"
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <div className="text-xs text-slate-600 dark:text-slate-400">
                    <span className="font-semibold text-blue-600 hover:text-blue-500">
                      {file ? file.name : "Click to select a CSV or Excel file"}
                    </span>
                    {!file && (
                      <p className="text-[11px] text-slate-500 mt-1">
                        Standard CSV or Excel (.xlsx, .xls) format · Maximum 10MB
                      </p>
                    )}
                  </div>
                </div>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                onChange={handleFileChange}
                className="hidden"
              />
            </div>
          ) : (
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Paste RFC-4180 CSV Data (First row must contain headers)
              </label>
              <textarea
                rows={6}
                value={pastedCsv}
                onChange={(e) => setPastedCsv(e.target.value)}
                placeholder="email,first_name,last_name,company&#10;sarah@example.com,Sarah,Connor,Cyberdyne&#10;john@example.com,John,Doe,Acme Inc"
                className="w-full text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 p-2.5 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          )}

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
            <Button variant="outline" size="sm" onClick={handleClose} disabled={loading}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleProceedToPreview}
              disabled={loading || (!file && !pastedCsv.trim())}
            >
              {loading ? "Analyzing CSV..." : "Continue to Preview (Step 2) →"}
            </Button>
          </div>
        </div>
      )}

      {/* STEP 2: PREVIEW ROWS & ROW RANGE SELECTION */}
      {step === 2 && previewData && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 p-3 bg-slate-50 dark:bg-slate-800/60 rounded-lg border border-slate-200 dark:border-slate-700 text-xs">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-slate-800 dark:text-slate-200">
                {previewData.filename}
              </span>
              <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300 font-medium">
                {previewData.totalRows.toLocaleString()} contacts available
              </span>
            </div>
            <span className="text-slate-500 text-xs">
              Showing first {previewData.previewRows.length} rows for data inspection
            </span>
          </div>

          {/* IMPORT RANGE SELECTION */}
          <div className="p-4 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
              <div>
                <span className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                  <svg className="w-4 h-4 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4h18M3 10h18M3 16h18" />
                  </svg>
                  Import Range
                </span>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Choose whether to import the entire file or choose a specific row range (refers to contact data rows, not header).
                </p>
              </div>

              {/* Mode Toggle Buttons: [ Entire file ] OR [ Start row ] — [ End row ] */}
              <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 p-0.5 bg-white dark:bg-slate-800 text-xs">
                <button
                  type="button"
                  id="btn-range-entire-file"
                  onClick={() => {
                    setRangeMode("all");
                    setError(null);
                  }}
                  className={`px-3 py-1 font-semibold rounded-md transition ${
                    rangeMode === "all"
                      ? "bg-blue-600 text-white shadow-xs"
                      : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                  }`}
                >
                  [ Entire file ]
                </button>
                <button
                  type="button"
                  id="btn-range-custom-range"
                  onClick={() => {
                    setRangeMode("range");
                    if (!endRowInput || endRowInput === String(previewData.totalRows)) {
                      setEndRowInput(String(Math.min(10, previewData.totalRows)));
                    }
                    setError(null);
                  }}
                  className={`px-3 py-1 font-semibold rounded-md transition ${
                    rangeMode === "range"
                      ? "bg-blue-600 text-white shadow-xs"
                      : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                  }`}
                >
                  [ Start row ] — [ End row ]
                </button>
              </div>
            </div>

            {/* Custom Range Input Fields */}
            {rangeMode === "range" && (
              <div className="space-y-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Start row (e.g. 1)
                    </label>
                    <input
                      type="number"
                      id="input-start-row"
                      min={1}
                      max={previewData.totalRows}
                      value={startRowInput}
                      onChange={(e) => {
                        setStartRowInput(e.target.value);
                        setError(null);
                      }}
                      placeholder="e.g. 1"
                      className="w-full text-xs font-mono py-1.5 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      End row (e.g. 10)
                    </label>
                    <input
                      type="number"
                      id="input-end-row"
                      min={1}
                      max={previewData.totalRows}
                      value={endRowInput}
                      onChange={(e) => {
                        setEndRowInput(e.target.value);
                        setError(null);
                      }}
                      placeholder={`e.g. ${Math.min(10, previewData.totalRows)}`}
                      className="w-full text-xs font-mono py-1.5 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>

                {/* Preset Range Chips */}
                <div className="flex flex-wrap items-center gap-1.5 text-[11px] pt-1">
                  <span className="text-slate-500 font-medium">Quick examples:</span>
                  <button
                    type="button"
                    onClick={() => {
                      setStartRowInput("1");
                      setEndRowInput(String(Math.min(10, previewData.totalRows)));
                    }}
                    className="px-2 py-0.5 rounded bg-slate-200/80 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition font-mono text-[10px]"
                  >
                    1–10
                  </button>
                  {previewData.totalRows >= 30 && (
                    <button
                      type="button"
                      onClick={() => {
                        setStartRowInput("10");
                        setEndRowInput("30");
                      }}
                      className="px-2 py-0.5 rounded bg-slate-200/80 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition font-mono text-[10px]"
                    >
                      10–30
                    </button>
                  )}
                  {previewData.totalRows >= 50 && (
                    <button
                      type="button"
                      onClick={() => {
                        setStartRowInput("31");
                        setEndRowInput("50");
                      }}
                      className="px-2 py-0.5 rounded bg-slate-200/80 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition font-mono text-[10px]"
                    >
                      31–50
                    </button>
                  )}
                  {previewData.totalRows >= 200 && (
                    <button
                      type="button"
                      onClick={() => {
                        setStartRowInput("101");
                        setEndRowInput("200");
                      }}
                      className="px-2 py-0.5 rounded bg-slate-200/80 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition font-mono text-[10px]"
                    >
                      101–200
                    </button>
                  )}
                  {previewData.totalRows >= 10 && (
                    <button
                      type="button"
                      onClick={() => {
                        const start = Math.max(1, previewData.totalRows - 9);
                        setStartRowInput(String(start));
                        setEndRowInput(String(previewData.totalRows));
                      }}
                      className="px-2 py-0.5 rounded bg-slate-200/80 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition font-mono text-[10px]"
                    >
                      Last 10 ({Math.max(1, previewData.totalRows - 9)}–{previewData.totalRows})
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Validation Message Display */}
            {rangeMode === "range" && !liveRangeStats.isValid && (
              <div
                id="range-validation-error"
                className="rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 p-2.5 text-xs text-rose-700 dark:text-rose-400 flex items-center gap-2"
              >
                <span className="font-bold">⚠ Range Validation:</span>
                <span>{liveRangeStats.errorMessage}</span>
              </div>
            )}

            {/* LIVE PREVIEW CARD */}
            <div className="p-3.5 bg-white dark:bg-slate-900/90 rounded-lg border border-slate-200 dark:border-slate-800 space-y-3">
              <div className="grid grid-cols-3 gap-2 text-center pb-2.5 border-b border-slate-100 dark:border-slate-800">
                <div>
                  <span className="text-[11px] text-slate-500 block font-medium">Selected:</span>
                  <span
                    id="range-preview-selected"
                    className="font-bold text-sm text-blue-600 dark:text-blue-400"
                  >
                    {liveRangeStats.isValid ? `${liveRangeStats.selectedCount} contacts` : "0 contacts"}
                  </span>
                </div>
                <div>
                  <span className="text-[11px] text-slate-500 block font-medium">Available:</span>
                  <span
                    id="range-preview-available"
                    className="font-bold text-sm text-slate-800 dark:text-slate-200"
                  >
                    {previewData.totalRows} contacts
                  </span>
                </div>
                <div>
                  <span className="text-[11px] text-slate-500 block font-medium">Total selected contacts:</span>
                  <span
                    id="range-preview-total"
                    className="font-bold text-sm text-emerald-600 dark:text-emerald-400"
                  >
                    {liveRangeStats.isValid ? liveRangeStats.selectedCount : 0}
                  </span>
                </div>
              </div>

              {/* First & Last Selected Contact Previews */}
              {liveRangeStats.isValid && liveRangeStats.totalSelected > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <ContactPreviewCard
                    id="first-selected-contact"
                    title="First selected contact"
                    rowNumber={liveRangeStats.startRow}
                    contact={liveRangeStats.firstContact}
                    headers={previewData.headers}
                    columnMapping={columnMapping}
                  />
                  <ContactPreviewCard
                    id="last-selected-contact"
                    title="Last selected contact"
                    rowNumber={liveRangeStats.endRow}
                    contact={liveRangeStats.lastContact}
                    headers={previewData.headers}
                    columnMapping={columnMapping}
                  />
                </div>
              )}
            </div>
          </div>

          {/* TABLE OF SAMPLE ROWS */}
          <div className="overflow-x-auto max-h-56 border border-slate-200 dark:border-slate-800 rounded-lg">
            <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-800 text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/70 sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold text-slate-500 w-12">#</th>
                  {previewData.headers.map((h) => (
                    <th
                      key={h}
                      className="px-3 py-2 text-left font-semibold text-slate-700 dark:text-slate-300 whitespace-nowrap"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-900">
                {previewData.previewRows.map((row, idx) => {
                  const dataRowNum = idx + 1;
                  const isInRange =
                    rangeMode === "all" ||
                    (liveRangeStats.isValid &&
                      dataRowNum >= liveRangeStats.startRow &&
                      dataRowNum <= liveRangeStats.endRow);
                  return (
                    <tr
                      key={idx}
                      className={`transition ${
                        isInRange
                          ? "bg-blue-50/30 hover:bg-blue-50/60 dark:bg-blue-950/20 dark:hover:bg-blue-950/40"
                          : "opacity-45 hover:opacity-75"
                      }`}
                    >
                      <td className="px-3 py-1.5 text-slate-400 font-mono text-[10px]">
                        {dataRowNum}
                        {isInRange && (
                          <span className="ml-1 text-blue-600 font-bold">•</span>
                        )}
                      </td>
                      {previewData.headers.map((h) => (
                        <td
                          key={h}
                          className="px-3 py-1.5 text-slate-600 dark:text-slate-300 whitespace-nowrap max-w-[200px] truncate"
                        >
                          {row[h] || "—"}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex justify-between items-center pt-3 border-t border-slate-100 dark:border-slate-800">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setStep(1)}
            >
              ← Back to Upload
            </Button>
            <Button
              size="sm"
              onClick={() => {
                if (rangeMode === "range" && !liveRangeStats.isValid) {
                  setError(liveRangeStats.errorMessage || "Please fix row range validation errors.");
                  return;
                }
                setError(null);
                setStep(3);
              }}
              disabled={rangeMode === "range" && !liveRangeStats.isValid}
            >
              Continue to Map Columns (Step 3) →
            </Button>
          </div>
        </div>
      )}

      {/* STEP 3: MAP COLUMNS */}
      {step === 3 && previewData && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 p-3 bg-slate-50 dark:bg-slate-800/60 rounded-lg border border-slate-200 dark:border-slate-700 text-xs">
            <span className="text-slate-700 dark:text-slate-300 font-medium">
              Match CSV headers to contact attributes.
            </span>
            {isEmailMapped ? (
              <span className="text-emerald-600 dark:text-emerald-400 font-semibold text-xs flex items-center gap-1">
                ✓ Email mapped
              </span>
            ) : (
              <span className="text-rose-600 dark:text-rose-400 font-semibold text-xs flex items-center gap-1">
                ⚠ Email mapping required
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg max-h-72 overflow-y-auto">
            {previewData.headers.map((header) => {
              const currentVal = columnMapping[header] || "ignore";
              const isMappedToEmail = currentVal === "email";
              return (
                <div
                  key={header}
                  className={`p-2.5 border rounded-md transition ${
                    isMappedToEmail
                      ? "border-blue-300 bg-blue-50/40 dark:border-blue-800 dark:bg-blue-950/20"
                      : "border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40"
                  }`}
                >
                  <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 truncate mb-1">
                    {header}
                  </label>
                  <select
                    value={currentVal}
                    onChange={(e) => {
                      setColumnMapping((prev) => ({
                        ...prev,
                        [header]: e.target.value,
                      }));
                    }}
                    className="w-full text-xs py-1.5 px-2 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="ignore">-- Do not import --</option>
                    {previewData.availableFields.map((f) => (
                      <option key={f.key} value={f.key}>
                        {f.label} {f.required ? "(Required)" : ""}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>

          <div className="flex justify-between items-center pt-3 border-t border-slate-100 dark:border-slate-800">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setStep(2)}
            >
              ← Back to Preview
            </Button>
            <Button
              size="sm"
              onClick={() => {
                if (!isEmailMapped) {
                  setError("You must map at least one column to Email.");
                  return;
                }
                setError(null);
                setStep(4);
              }}
              disabled={!isEmailMapped}
            >
              Continue to Validate (Step 4) →
            </Button>
          </div>
        </div>
      )}

      {/* STEP 4: VALIDATE & OPTIONS */}
      {step === 4 && previewData && (
        <div className="space-y-4">
          {/* Selected Import Range Review Card */}
          <div className="p-4 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                <svg className="w-4 h-4 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
                Import Range
              </span>
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-blue-100 text-blue-800 dark:bg-blue-900/60 dark:text-blue-300">
                  {rangeMode === "all" ? "Entire file" : `Rows ${liveRangeStats.startRow}–${liveRangeStats.endRow}`}
                </span>
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline font-medium"
                >
                  Change Range
                </button>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 text-center text-xs py-2 bg-white dark:bg-slate-800/90 rounded-lg border border-slate-200 dark:border-slate-700">
              <div>
                <span className="text-[10px] text-slate-500 block font-medium">Selected:</span>
                <span className="font-bold text-sm text-blue-600 dark:text-blue-400">
                  {liveRangeStats.selectedCount} contacts
                </span>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 block font-medium">Available:</span>
                <span className="font-bold text-sm text-slate-800 dark:text-slate-200">
                  {previewData.totalRows} contacts
                </span>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 block font-medium">Total selected contacts:</span>
                <span className="font-bold text-sm text-emerald-600 dark:text-emerald-400">
                  {liveRangeStats.selectedCount}
                </span>
              </div>
            </div>

            {liveRangeStats.isValid && liveRangeStats.totalSelected > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
                <ContactPreviewCard
                  title="First selected contact"
                  rowNumber={liveRangeStats.startRow}
                  contact={liveRangeStats.firstContact}
                  headers={previewData.headers}
                  columnMapping={columnMapping}
                />
                <ContactPreviewCard
                  title="Last selected contact"
                  rowNumber={liveRangeStats.endRow}
                  contact={liveRangeStats.lastContact}
                  headers={previewData.headers}
                  columnMapping={columnMapping}
                />
              </div>
            )}
          </div>

          {/* Validation Checklist Card */}
          <div className="p-4 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg space-y-2.5">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
              Deliverability & Safety Checklist
            </h4>
            <div className="space-y-2 text-xs">
              <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
                <span>✓</span>
                <span>Email column mapped correctly for recipient outreach.</span>
              </div>
              <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
                <span>✓</span>
                <span>Automatic suppression check: unsubscribed and hard bounced emails will be safely quarantined.</span>
              </div>
              <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
                <span>✓</span>
                <span>Multi-tenant isolation: contacts will only be accessible to your authenticated business.</span>
              </div>
              <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400">
                <span>✓</span>
                <span>
                  Total records to process: <strong>{liveRangeStats.selectedCount.toLocaleString()}</strong>
                  {rangeMode === "range"
                    ? ` (data rows ${liveRangeStats.startRow} through ${liveRangeStats.endRow} of ${previewData.totalRows} available)`
                    : ` (all ${previewData.totalRows} available rows)`}
                </span>
              </div>
            </div>
          </div>

          {/* Import Behavior Mode Selector */}
          <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg">
            <label className="block text-xs font-semibold text-slate-800 dark:text-slate-200 mb-2">
              Duplicate Handling Mode
            </label>
            <div className="space-y-2 text-xs">
              <label className="flex items-start gap-2.5 cursor-pointer p-2 rounded hover:bg-slate-50 dark:hover:bg-slate-800/50">
                <input
                  type="radio"
                  name="importMode"
                  value="CREATE_ONLY"
                  checked={importMode === "CREATE_ONLY"}
                  onChange={() => setImportMode("CREATE_ONLY")}
                  className="mt-0.5 text-blue-600 focus:ring-blue-500"
                />
                <div>
                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                    Create Only (Recommended)
                  </span>
                  <p className="text-slate-500 text-[11px] mt-0.5">
                    Skip existing contacts already in your business database to prevent accidental overwrite.
                  </p>
                </div>
              </label>

              <label className="flex items-start gap-2.5 cursor-pointer p-2 rounded hover:bg-slate-50 dark:hover:bg-slate-800/50">
                <input
                  type="radio"
                  name="importMode"
                  value="CREATE_OR_UPDATE"
                  checked={importMode === "CREATE_OR_UPDATE"}
                  onChange={() => setImportMode("CREATE_OR_UPDATE")}
                  className="mt-0.5 text-blue-600 focus:ring-blue-500"
                />
                <div>
                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                    Create or Update
                  </span>
                  <p className="text-slate-500 text-[11px] mt-0.5">
                    Update existing contacts with non-empty fields provided in the CSV.
                  </p>
                </div>
              </label>
            </div>
          </div>

          <div className="flex justify-between items-center pt-3 border-t border-slate-100 dark:border-slate-800">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setStep(3)}
              disabled={loading}
            >
              ← Back to Map
            </Button>
            <Button
              size="sm"
              onClick={handleExecuteImport}
              disabled={loading || !isEmailMapped || (rangeMode === "range" && !liveRangeStats.isValid)}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              Start Import ({liveRangeStats.selectedCount.toLocaleString()} contacts) →
            </Button>
          </div>
        </div>
      )}

      {/* STEP 5: IMPORT IN PROGRESS */}
      {step === 5 && (
        <div className="py-12 px-4 text-center space-y-4">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-blue-600 border-t-transparent" />
          <div>
            <h4 className="text-sm font-semibold text-slate-900 dark:text-white">
              Importing Contacts in Bulk...
            </h4>
            <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
              Validating emails, running suppression and duplicate checks, and securely importing into your database.
            </p>
          </div>
          <div className="pt-2 text-[11px] font-mono text-slate-400">
            Please do not close this window.
          </div>
        </div>
      )}

      {/* STEP 6: RESULTS SUMMARY */}
      {step === 6 && summary && (
        <div className="space-y-4">
          {summary.range && (
            <div className="p-3 bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900 rounded-lg text-xs flex flex-wrap items-center justify-between gap-2 text-blue-900 dark:text-blue-300">
              <span className="font-semibold flex items-center gap-1.5">
                <span>🎯</span>
                <span>
                  Import Scope:{" "}
                  {summary.range.type === "range"
                    ? `Rows ${summary.range.startRow} through ${summary.range.endRow}`
                    : "Entire file"}
                </span>
              </span>
              <span className="text-[11px] text-blue-700 dark:text-blue-400">
                {summary.totalRows} selected out of {summary.range.totalAvailable} total available contacts
              </span>
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-lg border border-slate-200 dark:border-slate-700 text-center">
              <span className="text-xl font-bold text-slate-900 dark:text-white">
                {summary.totalRows}
              </span>
              <span className="block text-[11px] text-slate-500">Total Rows</span>
            </div>
            <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 rounded-lg border border-emerald-200 dark:border-emerald-800 text-center">
              <span className="text-xl font-bold text-emerald-600 dark:text-emerald-400">
                {summary.importedCount}
              </span>
              <span className="block text-[11px] text-emerald-700 dark:text-emerald-300">Imported</span>
            </div>
            <div className="p-3 bg-amber-50 dark:bg-amber-950/40 rounded-lg border border-amber-200 dark:border-amber-800 text-center">
              <span className="text-xl font-bold text-amber-600 dark:text-amber-400">
                {summary.duplicateCount}
              </span>
              <span className="block text-[11px] text-amber-700 dark:text-amber-300">Duplicates</span>
            </div>
            <div className="p-3 bg-rose-50 dark:bg-rose-950/40 rounded-lg border border-rose-200 dark:border-rose-800 text-center">
              <span className="text-xl font-bold text-rose-600 dark:text-rose-400">
                {summary.invalidCount}
              </span>
              <span className="block text-[11px] text-rose-700 dark:text-rose-300">Invalid</span>
            </div>
            <div className="p-3 bg-purple-50 dark:bg-purple-950/40 rounded-lg border border-purple-200 dark:border-purple-800 text-center">
              <span className="text-xl font-bold text-purple-600 dark:text-purple-400">
                {summary.suppressedCount}
              </span>
              <span className="block text-[11px] text-purple-700 dark:text-purple-300">Suppressed</span>
            </div>
            <div className="p-3 bg-slate-100 dark:bg-slate-800 rounded-lg border border-slate-300 dark:border-slate-700 text-center">
              <span className="text-xl font-bold text-slate-700 dark:text-slate-300">
                {summary.failedCount}
              </span>
              <span className="block text-[11px] text-slate-500">Failed</span>
            </div>
          </div>

          {/* Rejected Rows Table if any */}
          {summary.rejectedRows.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Skipped / Rejected Rows ({summary.rejectedRows.length})
                </span>
                {summary.rejectedCsv && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleDownloadRejectedCsv}
                    className="text-xs h-7"
                  >
                    Download Rejected CSV
                  </Button>
                )}
              </div>
              <div className="max-h-40 overflow-y-auto border border-slate-200 dark:border-slate-800 rounded-lg text-xs">
                <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-800">
                  <thead className="bg-slate-50 dark:bg-slate-800/80 sticky top-0">
                    <tr>
                      <th className="px-3 py-1.5 text-left font-semibold text-slate-600 dark:text-slate-300">Row</th>
                      <th className="px-3 py-1.5 text-left font-semibold text-slate-600 dark:text-slate-300">Email</th>
                      <th className="px-3 py-1.5 text-left font-semibold text-slate-600 dark:text-slate-300">Reason</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-900">
                    {summary.rejectedRows.map((r, i) => (
                      <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                        <td className="px-3 py-1 text-slate-500 whitespace-nowrap">#{r.row}</td>
                        <td className="px-3 py-1 text-slate-700 dark:text-slate-300 whitespace-nowrap truncate max-w-[150px]">
                          {r.email || "—"}
                        </td>
                        <td className="px-3 py-1 text-rose-600 dark:text-rose-400 font-medium">
                          {r.reason}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
            <Button
              size="sm"
              onClick={() => {
                onSuccess();
                handleClose();
              }}
            >
              Done & View Contacts
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
