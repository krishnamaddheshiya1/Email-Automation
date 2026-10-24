"use client";

import React, { useState, useRef, useMemo, useEffect } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { validateRowRange } from "@/lib/validations/contact";
import { parseCsv, DEFAULT_COLUMN_ALIASES } from "@/lib/utils/csv";
import { convertSpreadsheetToCsv } from "@/lib/utils/spreadsheet";
import { CampaignContactImportSummary } from "@/types/database";
import { SendingLimitModal, LimitExceededModalData } from "./sending-limit-modal";

export interface CampaignContactImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  campaignId: string;
  campaignName?: string;
  onSuccess: (result: CampaignContactImportSummary) => void;
}

function getContactDisplay(
  contact: Record<string, string> | null | undefined,
  headers: string[],
  columnMapping?: Record<string, string>
) {
  if (!contact) return { name: "—", email: "—", company: "—" };

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

  let firstName = "";
  let lastName = "";
  if (columnMapping) {
    const fnHeader = Object.entries(columnMapping).find(([, f]) => f === "first_name")?.[0];
    const lnHeader = Object.entries(columnMapping).find(([, f]) => f === "last_name")?.[0];
    if (fnHeader && contact[fnHeader]) firstName = contact[fnHeader];
    if (lnHeader && contact[lnHeader]) lastName = contact[lnHeader];
  }
  if (!firstName && !lastName) {
    const nameEntry = Object.entries(contact).find(([k]) => {
      const lower = k.toLowerCase();
      return (lower.includes("name") || lower === "contact") && !lower.includes("company");
    });
    if (nameEntry) {
      firstName = nameEntry[1];
    }
  }

  let company = "";
  if (columnMapping) {
    const compHeader = Object.entries(columnMapping).find(([, f]) => f === "company_name")?.[0];
    if (compHeader && contact[compHeader]) company = contact[compHeader];
  }
  if (!company) {
    const compEntry = Object.entries(contact).find(([k]) => {
      const lower = k.toLowerCase();
      return lower.includes("company") || lower.includes("org");
    });
    if (compEntry) company = compEntry[1];
  }

  const fullName = [firstName, lastName].filter(Boolean).join(" ") || "Unnamed Contact";
  return {
    name: fullName,
    email: email || contact[headers[0]] || "—",
    company: company || "—",
  };
}

export interface CampaignContactImportViewProps {
  campaignId: string;
  campaignName?: string;
  onClose: () => void;
  onSuccess: (result: CampaignContactImportSummary) => void;
}

export function CampaignContactImportView({
  campaignId,
  onClose,
  onSuccess,
}: CampaignContactImportViewProps) {
  const [file, setFile] = useState<File | null>(null);
  const [csvContentCache, setCsvContentCache] = useState<string>("");
  const [parsedHeaders, setParsedHeaders] = useState<string[]>([]);
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});
  const [rangeMode, setRangeMode] = useState<"all" | "range">("all");
  const [startRowInput, setStartRowInput] = useState<string>("1");
  const [endRowInput, setEndRowInput] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [summaryResult, setSummaryResult] = useState<CampaignContactImportSummary | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [quota, setQuota] = useState<{
    dailyLimit: number;
    dailySent: number;
    dailyRemaining: number;
    monthlyLimit: number;
    monthlySent: number;
    monthlyRemaining: number;
    maxSendableNow: number;
  } | null>(null);
  const [limitModalOpen, setLimitModalOpen] = useState(false);
  const [limitModalData, setLimitModalData] = useState<LimitExceededModalData | null>(null);

  useEffect(() => {
    let ignore = false;
    async function loadQuota() {
      try {
        const res = await fetch("/api/email/quota");
        const data = await res.json();
        if (!ignore && data.success && data.quota) {
          setQuota(data.quota);
        }
      } catch {
        // Silently catch
      }
    }
    loadQuota();
    return () => {
      ignore = true;
    };
  }, []);

  const resetState = () => {
    setFile(null);
    setCsvContentCache("");
    setParsedHeaders([]);
    setColumnMapping({});
    setRangeMode("all");
    setStartRowInput("1");
    setEndRowInput("");
    setLoading(false);
    setSubmitting(false);
    setError(null);
    setSummaryResult(null);
  };

  const handleClose = () => {
    resetState();
    onClose();
  };

  // Handle file selection (CSV or XLSX/XLS)
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selected = e.target.files[0];
      const lower = selected.name.toLowerCase();
      if (!lower.endsWith(".csv") && !lower.endsWith(".xlsx") && !lower.endsWith(".xls")) {
        setError("Invalid file type. Please upload a CSV (.csv) or Excel (.xlsx, .xls) spreadsheet.");
        return;
      }

      setError(null);
      setLoading(true);
      setSummaryResult(null);

      try {
        const arrayBuffer = await selected.arrayBuffer();
        const csvText = convertSpreadsheetToCsv(arrayBuffer, selected.name);
        const parsed = parseCsv(csvText);

        if (parsed.length === 0) {
          throw new Error("File contains no data rows.");
        }

        const rawHeaders = parsed[0].map((h) => h.trim());
        const dataRows = parsed.slice(1).filter((r) => r.some((c) => c && c.trim().length > 0));

        if (dataRows.length === 0) {
          throw new Error("Spreadsheet contains a header but no data rows.");
        }

        // Auto-detect column mapping
        const detected: Record<string, string> = {};
        for (const h of rawHeaders) {
          const norm = h.toLowerCase().trim();
          if (DEFAULT_COLUMN_ALIASES[norm]) {
            detected[h] = DEFAULT_COLUMN_ALIASES[norm];
          }
        }

        setFile(selected);
        setCsvContentCache(csvText);
        setParsedHeaders(rawHeaders);
        setColumnMapping(detected);
        setStartRowInput("1");
        setEndRowInput(String(dataRows.length));
        setRangeMode("all");
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to parse spreadsheet.");
        setFile(null);
        setCsvContentCache("");
        if (e.target) e.target.value = "";
      } finally {
        setLoading(false);
      }
    }
  };

  // Full client-side parsed data rows for zero-latency live preview
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

  const totalAvailableRows = allParsedDataRows.length;

  // Real-time Range Validation
  const rangeValidation = useMemo(() => {
    return validateRowRange(totalAvailableRows, {
      rangeType: rangeMode,
      startRow: startRowInput,
      endRow: endRowInput,
    });
  }, [totalAvailableRows, rangeMode, startRowInput, endRowInput]);

  // Selected range metrics & live preview contacts
  const liveRangeInfo = useMemo(() => {
    if (rangeMode === "all") {
      const first = allParsedDataRows[0] || null;
      const last = allParsedDataRows[totalAvailableRows - 1] || null;
      return {
        isValid: true,
        startRow: totalAvailableRows > 0 ? 1 : 0,
        endRow: totalAvailableRows,
        selectedCount: totalAvailableRows,
        firstContact: first,
        lastContact: last,
        previewSlice: allParsedDataRows.slice(0, 5),
        errorMessage: null,
      };
    }

    if (!rangeValidation.isValid) {
      return {
        isValid: false,
        startRow: 0,
        endRow: 0,
        selectedCount: 0,
        firstContact: null,
        lastContact: null,
        previewSlice: [],
        errorMessage: rangeValidation.error || "Invalid range",
      };
    }

    const start = rangeValidation.startRow || 1;
    const end = rangeValidation.endRow || totalAvailableRows;
    const count = Math.max(0, end - start + 1);

    const first = allParsedDataRows[start - 1] || null;
    const last = allParsedDataRows[end - 1] || null;
    const slice = allParsedDataRows.slice(start - 1, end).slice(0, 5);

    return {
      isValid: true,
      startRow: start,
      endRow: end,
      selectedCount: count,
      firstContact: first,
      lastContact: last,
      previewSlice: slice,
      errorMessage: null,
    };
  }, [rangeMode, rangeValidation, totalAvailableRows, allParsedDataRows]);

  const applyRangePreset = (start: number, end: number) => {
    setRangeMode("range");
    setStartRowInput(String(start));
    setEndRowInput(String(Math.min(end, totalAvailableRows)));
    setError(null);
  };

  // Execute Import & Campaign Enrollment
  const handleImportAndEnroll = async () => {
    if (!csvContentCache || !file) return;
    if (!rangeValidation.isValid) {
      setError(rangeValidation.error || "Please provide a valid row range.");
      return;
    }

    const requestedCount = liveRangeInfo.selectedCount;

    // Client-side quota pre-check
    if (quota) {
      if (requestedCount > quota.dailyRemaining) {
        setLimitModalData({
          limitType: "daily",
          dailySent: quota.dailySent,
          dailyRemaining: quota.dailyRemaining,
          attemptedCount: requestedCount,
        });
        setLimitModalOpen(true);
        return;
      }
      if (requestedCount > quota.monthlyRemaining) {
        setLimitModalData({
          limitType: "monthly",
          monthlySent: quota.monthlySent,
          monthlyRemaining: quota.monthlyRemaining,
          attemptedCount: requestedCount,
        });
        setLimitModalOpen(true);
        return;
      }
    }

    setSubmitting(true);
    setError(null);

    try {
      const payload = {
        csv: csvContentCache,
        filename: file.name,
        range_type: rangeMode,
        start_row: rangeMode === "range" ? rangeValidation.startRow : 1,
        end_row: rangeMode === "range" ? rangeValidation.endRow : totalAvailableRows,
        column_mapping: columnMapping,
        allow_override: true,
      };

      const res = await fetch(`/api/campaigns/${campaignId}/contacts/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        if (
          res.status === 429 ||
          data.code === "DAILY_EMAIL_LIMIT_REACHED" ||
          data.code === "MONTHLY_EMAIL_LIMIT_REACHED" ||
          String(data.error).includes("DAILY_EMAIL_LIMIT_REACHED") ||
          String(data.error).includes("MONTHLY_EMAIL_LIMIT_REACHED")
        ) {
          const isMonthly =
            data.limitType === "monthly" ||
            data.code === "MONTHLY_EMAIL_LIMIT_REACHED" ||
            String(data.error).includes("MONTHLY");
          setLimitModalData({
            limitType: isMonthly ? "monthly" : "daily",
            dailySent: data.dailySent ?? quota?.dailySent ?? 0,
            dailyRemaining: data.dailyRemaining ?? quota?.dailyRemaining ?? 0,
            monthlySent: data.monthlySent ?? quota?.monthlySent ?? 0,
            monthlyRemaining: data.monthlyRemaining ?? quota?.monthlyRemaining ?? 0,
            attemptedCount: data.attemptedCount ?? requestedCount,
          });
          setLimitModalOpen(true);
          return;
        }
        throw new Error(data.error || "Failed to import and enroll contacts.");
      }

      const summary: CampaignContactImportSummary = {
        success: true,
        campaignId,
        totalSelected: data.totalSelected ?? liveRangeInfo.selectedCount,
        totalAvailable: data.totalAvailable ?? totalAvailableRows,
        importedCount: data.importedCount ?? 0,
        newContactsCount: data.newContactsCount ?? 0,
        existingContactsCount: data.existingContactsCount ?? 0,
        enrolledCount: data.enrolledCount ?? 0,
        alreadyEnrolledCount: data.alreadyEnrolledCount ?? 0,
        skippedCount: data.skippedCount ?? 0,
        failedCount: data.failedCount ?? 0,
        errors: data.errors || [],
        range: data.range || {
          type: rangeMode,
          startRow: liveRangeInfo.startRow,
          endRow: liveRangeInfo.endRow,
        },
      };

      setSummaryResult(summary);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred during import.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleFinishAndReturn = () => {
    if (summaryResult) {
      onSuccess(summaryResult);
    }
    handleClose();
  };

  const firstContactSummary = getContactDisplay(liveRangeInfo.firstContact, parsedHeaders, columnMapping);
  const lastContactSummary = getContactDisplay(liveRangeInfo.lastContact, parsedHeaders, columnMapping);

  return (
    <div className="space-y-4 pt-1">
        {error && (
          <div className="p-3 text-xs bg-red-50 text-red-700 border border-red-200 rounded-lg dark:bg-red-950/40 dark:text-red-300 dark:border-red-800">
            {error}
          </div>
        )}

        {/* ----------------- STATE 1: SUCCESS SUMMARY VIEW ----------------- */}
        {summaryResult ? (
          <div className="space-y-4">
            <div className="p-4 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-xl">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-emerald-100 dark:bg-emerald-900/60 flex items-center justify-center text-emerald-600 dark:text-emerald-300">
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-emerald-950 dark:text-emerald-100">
                    Import & Campaign Enrollment Completed!
                  </h4>
                  <p className="text-xs text-emerald-700 dark:text-emerald-300 mt-0.5">
                    Contacts from rows {summaryResult.range.startRow}–{summaryResult.range.endRow} were processed and enrolled into this campaign.
                  </p>
                </div>
              </div>
            </div>

            {/* Metrics Breakdown */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <div className="p-3 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 shadow-xs">
                <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wider block">Imported / Found</span>
                <span className="text-lg font-bold text-slate-900 dark:text-white mt-1 block">
                  {summaryResult.importedCount}
                </span>
                <span className="text-[10px] text-slate-400 mt-0.5 block">
                  {summaryResult.newContactsCount} new · {summaryResult.existingContactsCount} existing
                </span>
              </div>

              <div className="p-3 bg-white dark:bg-slate-800 rounded-lg border border-emerald-200 dark:border-emerald-800/60 shadow-xs">
                <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400 uppercase tracking-wider block">Enrolled in Campaign</span>
                <span className="text-lg font-bold text-emerald-600 dark:text-emerald-400 mt-1 block">
                  {summaryResult.enrolledCount}
                </span>
                <span className="text-[10px] text-emerald-700/70 dark:text-emerald-300/70 mt-0.5 block">
                  Newly assigned leads
                </span>
              </div>

              <div className="p-3 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 shadow-xs">
                <span className="text-[11px] font-medium text-amber-600 dark:text-amber-400 uppercase tracking-wider block">Already Enrolled</span>
                <span className="text-lg font-bold text-slate-700 dark:text-slate-200 mt-1 block">
                  {summaryResult.alreadyEnrolledCount}
                </span>
                <span className="text-[10px] text-slate-400 mt-0.5 block">
                  Duplicate enrollments skipped
                </span>
              </div>

              <div className="p-3 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 shadow-xs">
                <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wider block">Skipped / Failed</span>
                <span className="text-lg font-bold text-slate-700 dark:text-slate-200 mt-1 block">
                  {summaryResult.skippedCount + summaryResult.failedCount}
                </span>
                <span className="text-[10px] text-slate-400 mt-0.5 block">
                  {summaryResult.skippedCount} skipped · {summaryResult.failedCount} failed
                </span>
              </div>
            </div>

            {/* Error / Skipped List */}
            {summaryResult.errors && summaryResult.errors.length > 0 && (
              <div className="p-3 bg-slate-50 dark:bg-slate-900/60 rounded-lg border border-slate-200 dark:border-slate-700 max-h-36 overflow-y-auto">
                <div className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  Reported Skipped or Failed Rows ({summaryResult.errors.length}):
                </div>
                <ul className="text-xs space-y-1">
                  {summaryResult.errors.map((err, i) => (
                    <li key={i} className="text-slate-600 dark:text-slate-400 flex items-center justify-between text-[11px]">
                      <span>Row #{err.row}: {err.email || "Empty email"}</span>
                      <span className="text-red-500 dark:text-red-400 font-medium">{err.reason}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex justify-end pt-2 border-t border-slate-100 dark:border-slate-800">
              <Button type="button" variant="primary" size="sm" onClick={handleFinishAndReturn}>
                Done & View Assigned Contacts →
              </Button>
            </div>
          </div>
        ) : (
          /* ----------------- STATE 2: UPLOAD & CONFIGURE VIEW ----------------- */
          <div className="space-y-4">
            {/* Step 1: File Selection */}
            {!file ? (
              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-slate-200 dark:border-slate-700 hover:border-blue-400 dark:hover:border-blue-500 rounded-xl p-8 text-center cursor-pointer transition-colors bg-slate-50/50 dark:bg-slate-900/30"
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  onChange={handleFileChange}
                  className="hidden"
                />
                <div className="w-12 h-12 mx-auto rounded-full bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center mb-3">
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                </div>
                <div className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                  Choose CSV or Excel File
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Supports .csv, .xlsx, and .xls spreadsheets (up to 10MB)
                </div>
                <div className="mt-4">
                  <Button type="button" variant="outline" size="sm" disabled={loading}>
                    {loading ? "Reading File..." : "Select Spreadsheet"}
                  </Button>
                </div>
              </div>
            ) : (
              /* File Details Header */
              <div className="p-3 bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-700 rounded-lg flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/60 dark:text-blue-300 flex items-center justify-center text-xs font-bold">
                    {file.name.toLowerCase().endsWith(".csv") ? "CSV" : "XLS"}
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-slate-900 dark:text-white">
                      File: {file.name}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      Total data rows: <strong className="text-slate-700 dark:text-slate-300">{totalAvailableRows} contacts</strong>
                    </div>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-xs text-slate-500 hover:text-slate-700"
                  onClick={() => {
                    setFile(null);
                    setCsvContentCache("");
                    setError(null);
                  }}
                >
                  Change File
                </Button>
              </div>
            )}

            {file && (
              <>
                {/* Step 2: Row Range Selection */}
                <div className="p-3.5 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-900 dark:text-white uppercase tracking-wider">
                      Import Range
                    </span>
                    <span className="text-xs text-slate-500">
                      Available: <strong className="text-slate-700 dark:text-slate-300">{totalAvailableRows}</strong> data rows
                    </span>
                  </div>

                  {/* Radio Selector */}
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <label
                      className={`flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                        rangeMode === "all"
                          ? "bg-blue-50/50 border-blue-300 text-blue-900 dark:bg-blue-950/40 dark:border-blue-700 dark:text-blue-200"
                          : "border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800/50 text-slate-700 dark:text-slate-300"
                      }`}
                    >
                      <input
                        type="radio"
                        name="campaign_import_range_mode"
                        checked={rangeMode === "all"}
                        onChange={() => {
                          setRangeMode("all");
                          setError(null);
                        }}
                        className="text-blue-600 focus:ring-blue-500"
                      />
                      <span className="font-medium">Entire file ({totalAvailableRows} contacts)</span>
                    </label>

                    <label
                      className={`flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                        rangeMode === "range"
                          ? "bg-blue-50/50 border-blue-300 text-blue-900 dark:bg-blue-950/40 dark:border-blue-700 dark:text-blue-200"
                          : "border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800/50 text-slate-700 dark:text-slate-300"
                      }`}
                    >
                      <input
                        type="radio"
                        name="campaign_import_range_mode"
                        checked={rangeMode === "range"}
                        onChange={() => {
                          setRangeMode("range");
                          setError(null);
                        }}
                        className="text-blue-600 focus:ring-blue-500"
                      />
                      <span className="font-medium">Custom range</span>
                    </label>
                  </div>

                  {/* Custom Range Inputs */}
                  {rangeMode === "range" && (
                    <div className="pt-1 space-y-2">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-[11px] font-medium text-slate-600 dark:text-slate-400 block mb-1">
                            Start Row
                          </label>
                          <Input
                            type="number"
                            min="1"
                            max={totalAvailableRows}
                            value={startRowInput}
                            onChange={(e) => {
                              setStartRowInput(e.target.value);
                              setError(null);
                            }}
                            placeholder="1"
                            className="text-xs h-8"
                          />
                        </div>
                        <div>
                          <label className="text-[11px] font-medium text-slate-600 dark:text-slate-400 block mb-1">
                            End Row
                          </label>
                          <Input
                            type="number"
                            min="1"
                            max={totalAvailableRows}
                            value={endRowInput}
                            onChange={(e) => {
                              setEndRowInput(e.target.value);
                              setError(null);
                            }}
                            placeholder={String(totalAvailableRows)}
                            className="text-xs h-8"
                          />
                        </div>
                      </div>

                      {/* Presets */}
                      <div className="flex items-center gap-1.5 flex-wrap pt-1">
                        <span className="text-[10px] text-slate-500 font-medium">Quick presets:</span>
                        {[
                          { label: "1–10", start: 1, end: 10 },
                          { label: "10–30", start: 10, end: 30 },
                          { label: "31–50", start: 31, end: 50 },
                          { label: "101–200", start: 101, end: 200 },
                          { label: "Last 10", start: Math.max(1, totalAvailableRows - 9), end: totalAvailableRows },
                        ].map((preset) => (
                          <button
                            key={preset.label}
                            type="button"
                            onClick={() => applyRangePreset(preset.start, preset.end)}
                            disabled={preset.start > totalAvailableRows}
                            className="px-2 py-0.5 rounded text-[10px] font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            {preset.label}
                          </button>
                        ))}
                      </div>

                      {/* Row range note */}
                      <p className="text-[10px] text-slate-500 dark:text-slate-400">
                        * Row numbers refer to contact data rows (excluding the spreadsheet header).
                      </p>
                    </div>
                  )}

                  {/* Range Validation Warning */}
                  {!rangeValidation.isValid && (
                    <div className="p-2.5 text-xs bg-red-50 text-red-700 border border-red-200 rounded-lg dark:bg-red-950/40 dark:text-red-300 dark:border-red-800">
                      ⚠️ {rangeValidation.error}
                    </div>
                  )}

                  {/* Scope Stats */}
                  <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-100 dark:border-slate-800">
                    <span className="text-slate-600 dark:text-slate-400">
                      Selected rows: <strong className="text-blue-600 dark:text-blue-400 font-bold">{liveRangeInfo.selectedCount}</strong> of {totalAvailableRows}
                    </span>
                    <Badge variant={liveRangeInfo.isValid && liveRangeInfo.selectedCount > 0 ? "default" : "neutral"} className="text-[10px]">
                      {liveRangeInfo.isValid && liveRangeInfo.selectedCount > 0
                        ? `Rows ${liveRangeInfo.startRow}–${liveRangeInfo.endRow}`
                        : "Invalid Range"}
                    </Badge>
                  </div>
                </div>

                {/* Step 3: Preview */}
                {liveRangeInfo.isValid && liveRangeInfo.selectedCount > 0 && (
                  <div className="space-y-3">
                    <div className="text-xs font-semibold text-slate-900 dark:text-white uppercase tracking-wider">
                      Selected Contacts Preview ({liveRangeInfo.selectedCount} selected)
                    </div>

                    {/* First & Last Contact Cards */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                      <div className="p-3 bg-slate-50 dark:bg-slate-850 rounded-lg border border-slate-200 dark:border-slate-700">
                        <div className="flex items-center justify-between text-[10px] uppercase font-bold text-slate-500 mb-1">
                          <span>First Selected Contact</span>
                          <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                            Row #{liveRangeInfo.startRow}
                          </span>
                        </div>
                        <div className="font-semibold text-slate-900 dark:text-white truncate">
                          {firstContactSummary.name}
                        </div>
                        <div className="text-slate-500 text-[11px] truncate">
                          {firstContactSummary.email}
                        </div>
                      </div>

                      <div className="p-3 bg-slate-50 dark:bg-slate-850 rounded-lg border border-slate-200 dark:border-slate-700">
                        <div className="flex items-center justify-between text-[10px] uppercase font-bold text-slate-500 mb-1">
                          <span>Last Selected Contact</span>
                          <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                            Row #{liveRangeInfo.endRow}
                          </span>
                        </div>
                        <div className="font-semibold text-slate-900 dark:text-white truncate">
                          {lastContactSummary.name}
                        </div>
                        <div className="text-slate-500 text-[11px] truncate">
                          {lastContactSummary.email}
                        </div>
                      </div>
                    </div>

                    {/* Small Selected Records Table */}
                    <div className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden text-xs max-h-40 overflow-y-auto">
                      <table className="w-full text-left">
                        <thead className="bg-slate-100 dark:bg-slate-800 text-[10px] font-semibold text-slate-600 dark:text-slate-300 uppercase">
                          <tr>
                            <th className="px-3 py-1.5 w-16">Row</th>
                            <th className="px-3 py-1.5">Name</th>
                            <th className="px-3 py-1.5">Email</th>
                            <th className="px-3 py-1.5">Company</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                          {liveRangeInfo.previewSlice.map((row, idx) => {
                            const disp = getContactDisplay(row, parsedHeaders, columnMapping);
                            const actualRowNumber = liveRangeInfo.startRow + idx;
                            return (
                              <tr key={idx} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                                <td className="px-3 py-1.5 font-mono text-[10px] text-slate-500">
                                  #{actualRowNumber}
                                </td>
                                <td className="px-3 py-1.5 font-medium text-slate-800 dark:text-slate-200 truncate max-w-[120px]">
                                  {disp.name}
                                </td>
                                <td className="px-3 py-1.5 text-slate-600 dark:text-slate-300 truncate max-w-[160px]">
                                  {disp.email}
                                </td>
                                <td className="px-3 py-1.5 text-slate-500 dark:text-slate-400 truncate max-w-[100px]">
                                  {disp.company}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Footer Buttons */}
                <div className="flex items-center justify-between pt-3 border-t border-slate-100 dark:border-slate-800">
                  <Button type="button" variant="outline" size="sm" onClick={handleClose} disabled={submitting}>
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    disabled={!liveRangeInfo.isValid || liveRangeInfo.selectedCount === 0 || submitting}
                    onClick={handleImportAndEnroll}
                  >
                    {submitting
                      ? "Importing & Enrolling..."
                      : `Import & Enroll ${liveRangeInfo.selectedCount} Contact(s) →`}
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
        <SendingLimitModal
          isOpen={limitModalOpen}
          onClose={() => setLimitModalOpen(false)}
          data={limitModalData}
        />
      </div>
    );
}

export function CampaignContactImportModal({
  isOpen,
  onClose,
  campaignId,
  campaignName,
  onSuccess,
}: CampaignContactImportModalProps) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Import Contacts to Campaign"
      description="Import contacts directly into this campaign with exact row-range selection. Supports CSV and Excel (.xlsx, .xls) files."
      className="max-w-2xl"
    >
      <CampaignContactImportView
        campaignId={campaignId}
        campaignName={campaignName}
        onClose={onClose}
        onSuccess={onSuccess}
      />
    </Modal>
  );
}
