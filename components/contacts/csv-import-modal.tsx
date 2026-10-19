"use client";

import React, { useState, useRef } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import {
  CsvPreviewResult,
  CsvImportSummary,
  ContactImportMode,
} from "@/types/database";

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
      if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
        setError(
          "Excel files (.xlsx, .xls) are not supported. Please export or save your file as CSV (.csv) before importing."
        );
        setFile(null);
        if (e.target) e.target.value = "";
        return;
      }
      if (!lower.endsWith(".csv")) {
        setError("Invalid file type. Only CSV (.csv) files are supported.");
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
          throw new Error("Please select a CSV file to preview.");
        }
        filename = file.name;
        content = await file.text();
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
      setStep(2);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  // Step 4 -> Step 5/6: Execute Import
  const handleExecuteImport = async () => {
    const hasEmail = Object.values(columnMapping).some((val) => val === "email");
    if (!hasEmail) {
      setError("Email column mapping is required.");
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
                      {file ? file.name : "Click to select a .csv file"}
                    </span>
                    {!file && (
                      <p className="text-[11px] text-slate-500 mt-1">
                        Standard RFC-4180 CSV format · Maximum 10MB · Excel (.xlsx, .xls) files are not supported
                      </p>
                    )}
                  </div>
                </div>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
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

      {/* STEP 2: PREVIEW ROWS (FIRST 20 ROWS) */}
      {step === 2 && previewData && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 p-3 bg-slate-50 dark:bg-slate-800/60 rounded-lg border border-slate-200 dark:border-slate-700 text-xs">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-slate-800 dark:text-slate-200">
                {previewData.filename}
              </span>
              <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300 font-medium">
                {previewData.totalRows.toLocaleString()} rows detected
              </span>
            </div>
            <span className="text-slate-500 text-xs">
              Showing first {previewData.previewRows.length} rows for inspection
            </span>
          </div>

          <div className="overflow-x-auto max-h-72 border border-slate-200 dark:border-slate-800 rounded-lg">
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
                {previewData.previewRows.map((row, idx) => (
                  <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="px-3 py-1.5 text-slate-400 font-mono text-[10px]">{idx + 1}</td>
                    {previewData.headers.map((h) => (
                      <td
                        key={h}
                        className="px-3 py-1.5 text-slate-600 dark:text-slate-300 whitespace-nowrap max-w-[200px] truncate"
                      >
                        {row[h] || "—"}
                      </td>
                    ))}
                  </tr>
                ))}
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
              onClick={() => setStep(3)}
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
                <span>Total records to process: <strong>{previewData.totalRows.toLocaleString()}</strong></span>
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
              disabled={loading || !isEmailMapped}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              Start Import ({previewData.totalRows.toLocaleString()} rows) →
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
