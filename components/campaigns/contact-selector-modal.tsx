"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { validateRowRange } from "@/lib/validations/contact";
import { CampaignContactImportView } from "./campaign-contact-import-modal";
import { SendingLimitModal } from "./sending-limit-modal";

interface ContactEligibility {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  company_name?: string;
  job_title?: string;
  is_eligible: boolean;
  ineligible_reason: string | null;
  already_contacted: boolean;
}

interface EligibilitySummary {
  total: number;
  eligible: number;
  ineligible: number;
  already_contacted: number;
  suppressed: number;
  enrolled: number;
  bounced: number;
  replied: number;
}

interface ContactSelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  campaignId: string;
  enrolledLeadIds: Set<string>;
  onEnrolledSuccess: () => void;
}

type FilterTab =
  | "eligible"
  | "all"
  | "never_contacted"
  | "already_contacted"
  | "bounced"
  | "suppressed"
  | "replied";

export function ContactSelectorModal({
  isOpen,
  onClose,
  campaignId,
  enrolledLeadIds,
  onEnrolledSuccess,
}: ContactSelectorModalProps) {
  // Main Tab: Enroll Existing vs Direct Import
  const [mainEnrollTab, setMainEnrollTab] = useState<"existing" | "import">("existing");

  // Contacts state
  const [contacts, setContacts] = useState<ContactEligibility[]>([]);
  const [summary, setSummary] = useState<EligibilitySummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [filterTab, setFilterTab] = useState<FilterTab>("eligible");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [overrideIds, setOverrideIds] = useState<Set<string>>(new Set());
  const [confirmContact, setConfirmContact] = useState<ContactEligibility | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectionBanner, setSelectionBanner] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // Sending Limit Quota State
  const [quota, setQuota] = useState<{
    dailySent: number;
    dailyLimit: number;
    dailyRemaining: number;
    monthlySent: number;
    monthlyLimit: number;
    monthlyRemaining: number;
    maxSendableNow: number;
  } | null>(null);
  const [limitModalOpen, setLimitModalOpen] = useState(false);
  const [limitModalData, setLimitModalData] = useState<{
    limitType: "daily" | "monthly";
    dailySent?: number;
    dailyRemaining?: number;
    monthlySent?: number;
    monthlyRemaining?: number;
    attemptedCount?: number;
  }>({ limitType: "daily" });

  // Range Selection State (FEATURE A & B)
  const [rangeMode, setRangeMode] = useState<"all" | "range">("all");
  const [startRowInput, setStartRowInput] = useState<string>("1");
  const [endRowInput, setEndRowInput] = useState<string>("");
  const [rangeError, setRangeError] = useState<string | null>(null);

  const resetState = () => {
    setMainEnrollTab("existing");
    setSelectedIds(new Set());
    setOverrideIds(new Set());
    setConfirmContact(null);
    setError(null);
    setSelectionBanner(null);
    setFilterTab("eligible");
    setRangeMode("all");
    setStartRowInput("1");
    setEndRowInput("");
    setRangeError(null);
    setLimitModalOpen(false);
  };

  const handleClose = () => {
    resetState();
    onClose();
  };

  useEffect(() => {
    if (!isOpen) return;

    let ignore = false;
    async function fetchEligibility() {
      try {
        setLoading(true);
        const res = await fetch(`/api/campaigns/${campaignId}/contacts/eligibility`);
        const data = await res.json();
        if (ignore) return;
        if (data.success) {
          setContacts(data.contacts || []);
          setSummary(data.summary || null);
          if (data.quota) {
            setQuota(data.quota);
          } else {
            fetch("/api/email/quota")
              .then((r) => r.json())
              .then((qJson) => {
                if (qJson.success && qJson.quota) setQuota(qJson.quota);
              })
              .catch(() => {});
          }
        } else {
          setError(data.error || "Failed to load contacts eligibility.");
        }
      } catch {
        if (!ignore) setError("Network error loading contacts eligibility.");
      } finally {
        if (!ignore) setLoading(false);
      }
    }

    fetchEligibility();
    return () => {
      ignore = true;
    };
  }, [isOpen, campaignId, refreshKey]);

  // FEATURE B: Filter before enrollment (Operates on the CURRENT filtered result set)
  const filteredContacts = useMemo(() => {
    return contacts.filter((c) => {
      // 1. Text Search across name, email, company, and title
      const fullName = `${c.first_name || ""} ${c.last_name || ""}`.toLowerCase();
      const q = search.toLowerCase().trim();
      if (q) {
        const match =
          fullName.includes(q) ||
          (c.email && c.email.toLowerCase().includes(q)) ||
          (c.company_name && c.company_name.toLowerCase().includes(q)) ||
          (c.job_title && c.job_title.toLowerCase().includes(q));
        if (!match) return false;
      }

      // 2. Filter Tab
      switch (filterTab) {
        case "eligible":
          return c.is_eligible;
        case "never_contacted":
          return c.is_eligible && !c.already_contacted;
        case "already_contacted":
          return c.already_contacted;
        case "bounced":
          return c.ineligible_reason === "Bounced";
        case "suppressed":
          return c.ineligible_reason === "Suppressed";
        case "replied":
          return c.ineligible_reason === "Replied";
        case "all":
        default:
          return true;
      }
    });
  }, [contacts, search, filterTab]);

  const availableContactsCount = filteredContacts.length;

  // Real-time Range Validation and Slicing (FEATURE A & E)
  const rangeInfo = useMemo(() => {
    if (rangeMode === "all") {
      const slice = filteredContacts;
      const first = slice[0] ? `${slice[0].first_name} ${slice[0].last_name} (${slice[0].email})` : "—";
      const last =
        slice.length > 0
          ? `${slice[slice.length - 1].first_name} ${slice[slice.length - 1].last_name} (${slice[slice.length - 1].email})`
          : "—";

      return {
        isValid: true,
        error: null,
        startRow: availableContactsCount > 0 ? 1 : 0,
        endRow: availableContactsCount,
        selectedSlice: slice,
        firstPreview: first,
        lastPreview: last,
        count: slice.length,
      };
    }

    // Range mode
    const val = validateRowRange(availableContactsCount, {
      rangeType: "range",
      startRow: startRowInput,
      endRow: endRowInput,
    });

    if (!val.isValid || !val.startRow || !val.endRow) {
      return {
        isValid: false,
        error: val.error || "Invalid range selection.",
        startRow: 0,
        endRow: 0,
        selectedSlice: [],
        firstPreview: "—",
        lastPreview: "—",
        count: 0,
      };
    }

    const startIndex = val.startRow - 1;
    const endIndex = val.endRow;
    const slice = filteredContacts.slice(startIndex, endIndex);

    const first = slice[0] ? `${slice[0].first_name} ${slice[0].last_name} (${slice[0].email})` : "—";
    const last =
      slice.length > 0
        ? `${slice[slice.length - 1].first_name} ${slice[slice.length - 1].last_name} (${slice[slice.length - 1].email})`
        : "—";

    return {
      isValid: true,
      error: null,
      startRow: val.startRow,
      endRow: val.endRow,
      selectedSlice: slice,
      firstPreview: first,
      lastPreview: last,
      count: slice.length,
    };
  }, [rangeMode, startRowInput, endRowInput, availableContactsCount, filteredContacts]);

  // Synchronize range slice to selectedIds
  const applyRangeSelection = useCallback(
    (slice: ContactEligibility[]) => {
      const next = new Set<string>();
      const nextOverrides = new Set<string>();

      for (const contact of slice) {
        // Exclude suppressed and already enrolled
        const isEnrolled = enrolledLeadIds.has(contact.id);
        const isSuppressed =
          contact.ineligible_reason === "Suppressed" ||
          contact.ineligible_reason === "Invalid Email";

        if (!isEnrolled && !isSuppressed) {
          next.add(contact.id);
          if (contact.already_contacted) {
            nextOverrides.add(contact.id);
          }
        }
      }

      setSelectedIds(next);
      setOverrideIds(nextOverrides);
    },
    [enrolledLeadIds]
  );

  const handleRangeInputChange = (newStart: string, newEnd: string) => {
    setStartRowInput(newStart);
    setEndRowInput(newEnd);
    const val = validateRowRange(availableContactsCount, {
      rangeType: "range",
      startRow: newStart,
      endRow: newEnd,
    });
    if (val.isValid && val.startRow && val.endRow) {
      setRangeError(null);
      const slice = filteredContacts.slice(val.startRow - 1, val.endRow);
      applyRangeSelection(slice);
    } else {
      setRangeError(val.error || "Invalid range selection.");
      setSelectedIds(new Set());
    }
  };

  const handleRangeModeChange = (mode: "all" | "range") => {
    setRangeMode(mode);
    setRangeError(null);
    if (mode === "all") {
      applyRangeSelection(filteredContacts);
    } else {
      const defaultEnd = availableContactsCount > 0 ? String(Math.min(10, availableContactsCount)) : "1";
      setStartRowInput("1");
      setEndRowInput(defaultEnd);
      const val = validateRowRange(availableContactsCount, {
        rangeType: "range",
        startRow: "1",
        endRow: defaultEnd,
      });
      if (val.isValid && val.startRow && val.endRow) {
        const slice = filteredContacts.slice(val.startRow - 1, val.endRow);
        applyRangeSelection(slice);
      }
    }
  };

  const handleQuickRange = (start: number, end: number) => {
    setRangeMode("range");
    const s = String(start);
    const e = String(Math.min(end, Math.max(start, availableContactsCount)));
    setStartRowInput(s);
    setEndRowInput(e);
    setRangeError(null);
    const val = validateRowRange(availableContactsCount, {
      rangeType: "range",
      startRow: s,
      endRow: e,
    });
    if (val.isValid && val.startRow && val.endRow) {
      const slice = filteredContacts.slice(val.startRow - 1, val.endRow);
      applyRangeSelection(slice);
    }
  };

  const selectablesInCurrentView = useMemo(() => {
    return filterTab === "already_contacted"
      ? filteredContacts.filter((c) => c.already_contacted && !enrolledLeadIds.has(c.id))
      : filteredContacts.filter((c) => c.is_eligible);
  }, [filterTab, filteredContacts, enrolledLeadIds]);

  const toggleSelect = (contact: ContactEligibility) => {
    const next = new Set(selectedIds);
    const nextOverrides = new Set(overrideIds);

    if (next.has(contact.id)) {
      next.delete(contact.id);
      nextOverrides.delete(contact.id);
      setSelectedIds(next);
      setOverrideIds(nextOverrides);
      return;
    }

    // Suppressed or invalid email contacts cannot be selected
    if (
      contact.ineligible_reason === "Suppressed" ||
      contact.ineligible_reason === "Invalid Email"
    ) {
      return;
    }

    // If contact was already contacted, require explicit "Send Again" confirmation dialog
    if (contact.already_contacted && !overrideIds.has(contact.id)) {
      setConfirmContact(contact);
      return;
    }

    next.add(contact.id);
    setSelectedIds(next);
    setOverrideIds(nextOverrides);
  };

  const handleConfirmSendAgain = () => {
    if (!confirmContact) return;
    const next = new Set(selectedIds);
    const nextOverrides = new Set(overrideIds);
    next.add(confirmContact.id);
    nextOverrides.add(confirmContact.id);
    setSelectedIds(next);
    setOverrideIds(nextOverrides);
    setConfirmContact(null);
  };

  const handleSelectAll = () => {
    const selectableIds = selectablesInCurrentView.map((c) => c.id);
    const allSelected =
      selectableIds.length > 0 && selectableIds.every((id) => selectedIds.has(id));

    const next = new Set(selectedIds);
    const nextOverrides = new Set(overrideIds);

    if (allSelected) {
      // Deselect selectable contacts in view
      selectableIds.forEach((id) => {
        next.delete(id);
        nextOverrides.delete(id);
      });
      setSelectedIds(next);
      setOverrideIds(nextOverrides);
      setSelectionBanner(null);
    } else {
      // Select all selectable contacts in view
      selectableIds.forEach((id) => {
        next.add(id);
        const c = contacts.find((item) => item.id === id);
        if (c?.already_contacted) {
          nextOverrides.add(id);
        }
      });
      setSelectedIds(next);
      setOverrideIds(nextOverrides);

      if (filterTab === "already_contacted") {
        setSelectionBanner(
          `${selectableIds.length} previously contacted contacts selected for intentional re-enrollment.`
        );
      } else {
        const excludedCount = filteredContacts.length - selectableIds.length;
        if (excludedCount > 0) {
          setSelectionBanner(
            `${selectableIds.length} eligible contacts selected. ${excludedCount} contacts excluded automatically (already contacted or ineligible).`
          );
        } else {
          setSelectionBanner(`${selectableIds.length} contacts selected.`);
        }
      }
    }
  };

  const handleSubmit = async () => {
    if (selectedIds.size === 0) return;
    setSubmitting(true);
    setError(null);

    const contactIds = Array.from(selectedIds);
    const hasOverride =
      overrideIds.size > 0 ||
      contactIds.some((id) => contacts.find((c) => c.id === id)?.already_contacted);

    // Immediate client-side check if quota is loaded
    if (quota) {
      if (contactIds.length > quota.dailyRemaining) {
        setLimitModalData({
          limitType: "daily",
          dailySent: quota.dailySent,
          dailyRemaining: quota.dailyRemaining,
          attemptedCount: contactIds.length,
        });
        setLimitModalOpen(true);
        setSubmitting(false);
        return;
      }
      if (contactIds.length > quota.monthlyRemaining) {
        setLimitModalData({
          limitType: "monthly",
          monthlySent: quota.monthlySent,
          monthlyRemaining: quota.monthlyRemaining,
          attemptedCount: contactIds.length,
        });
        setLimitModalOpen(true);
        setSubmitting(false);
        return;
      }
    }

    try {
      const payload: Record<string, unknown> = {
        contact_ids: contactIds,
        allow_override: hasOverride,
        range_type: rangeMode,
        total_available: availableContactsCount,
      };

      if (rangeMode === "range" && rangeInfo.isValid) {
        payload.start_row = rangeInfo.startRow;
        payload.end_row = rangeInfo.endRow;
      }

      const res = await fetch(`/api/campaigns/${campaignId}/contacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setSelectedIds(new Set());
        setOverrideIds(new Set());
        setError(null);
        onEnrolledSuccess();
        handleClose();
      } else {
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
            attemptedCount: data.attemptedCount ?? contactIds.length,
          });
          setLimitModalOpen(true);
        } else {
          setError(data.error || "Failed to enroll contacts.");
        }
      }
    } catch {
      setError("Network error enrolling contacts.");
    } finally {
      setSubmitting(false);
    }
  };

  const getBadgeForContact = (contact: ContactEligibility, isSelected: boolean) => {
    if (contact.already_contacted) {
      return (
        <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
          <Badge variant="warning" className="text-[10px]">
            Already Contacted
          </Badge>
          {isSelected ? (
            <>
              <Badge variant="success" className="text-[10px]">
                Send Again ✓
              </Badge>
              <button
                type="button"
                className="h-6 px-2 text-[10px] font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded transition-colors"
                onClick={() => {
                  const next = new Set(selectedIds);
                  const nextOverrides = new Set(overrideIds);
                  next.delete(contact.id);
                  nextOverrides.delete(contact.id);
                  setSelectedIds(next);
                  setOverrideIds(nextOverrides);
                }}
              >
                Do not enroll
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="h-6 px-2 text-[10px] font-medium text-white bg-amber-600 hover:bg-amber-700 rounded transition-colors shadow-sm"
                onClick={() => {
                  const next = new Set(selectedIds);
                  const nextOverrides = new Set(overrideIds);
                  next.add(contact.id);
                  nextOverrides.add(contact.id);
                  setSelectedIds(next);
                  setOverrideIds(nextOverrides);
                }}
              >
                Send Again
              </button>
              <button
                type="button"
                className="h-6 px-1.5 text-[10px] text-slate-400 hover:text-slate-600 font-medium transition-colors"
                onClick={() => {
                  const next = new Set(selectedIds);
                  const nextOverrides = new Set(overrideIds);
                  next.delete(contact.id);
                  nextOverrides.delete(contact.id);
                  setSelectedIds(next);
                  setOverrideIds(nextOverrides);
                }}
              >
                Do not enroll
              </button>
            </>
          )}
        </div>
      );
    }

    if (isSelected) {
      return (
        <Badge variant="success" className="text-[10px]">
          Selected
        </Badge>
      );
    }
    if (contact.is_eligible) {
      return (
        <Badge variant="neutral" className="text-[10px]">
          Eligible
        </Badge>
      );
    }

    switch (contact.ineligible_reason) {
      case "Already Enrolled":
        return (
          <Badge variant="neutral" className="text-[10px]">
            Already Enrolled
          </Badge>
        );
      case "Campaign Completed":
        return (
          <Badge variant="neutral" className="text-[10px]">
            Campaign Completed
          </Badge>
        );
      case "Suppressed":
        return (
          <Badge variant="danger" className="text-[10px]">
            Suppressed
          </Badge>
        );
      case "Bounced":
        return (
          <Badge variant="danger" className="text-[10px]">
            Bounced
          </Badge>
        );
      case "Replied":
        return (
          <Badge variant="neutral" className="text-[10px]">
            Replied
          </Badge>
        );
      case "Invalid Email":
        return (
          <Badge variant="danger" className="text-[10px]">
            Invalid Email
          </Badge>
        );
      default:
        return (
          <Badge variant="neutral" className="text-[10px]">
            {contact.ineligible_reason || "Ineligible"}
          </Badge>
        );
    }
  };

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={handleClose}
        title="Enroll Contacts in Campaign"
        description="Select and assign contacts to this sequence using row-range filters, or import and enroll spreadsheets directly."
        className="max-w-2xl"
      >
        <div className="space-y-4">
          {/* FEATURE C: DIRECT IMPORT SWITCHER */}
          <div className="flex border-b border-slate-200 dark:border-slate-800 -mt-2">
            <button
              type="button"
              onClick={() => setMainEnrollTab("existing")}
              className={`pb-2.5 px-4 text-xs font-semibold border-b-2 transition-colors ${
                mainEnrollTab === "existing"
                  ? "border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400"
                  : "border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
              }`}
            >
              Enroll Existing Contacts
            </button>
            <button
              type="button"
              onClick={() => setMainEnrollTab("import")}
              className={`pb-2.5 px-4 text-xs font-semibold border-b-2 transition-colors flex items-center gap-1.5 ${
                mainEnrollTab === "import"
                  ? "border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400"
                  : "border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
              }`}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              <span>Import & Enroll Contacts</span>
            </button>
          </div>

          {/* VIEW A: ENROLL EXISTING CONTACTS */}
          {mainEnrollTab === "existing" ? (
            <div className="space-y-4">
              {error && (
                <div className="p-3 text-xs bg-red-50 text-red-700 border border-red-200 rounded-lg dark:bg-red-950/40 dark:text-red-300 dark:border-red-800">
                  {error}
                </div>
              )}

              {selectionBanner && (
                <div className="p-3 text-xs bg-blue-50 text-blue-800 border border-blue-200 rounded-lg dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800">
                  {selectionBanner}
                </div>
              )}

              {/* Sending Quota Capacity Bar */}
              {quota && (
                <div className="flex flex-wrap items-center justify-between p-2.5 px-3 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-[11px]">
                  <div className="flex items-center gap-3">
                    <span>
                      Daily Remaining:{" "}
                      <strong className="text-slate-900 dark:text-white font-semibold">
                        {quota.dailyRemaining.toLocaleString()}
                      </strong>{" "}
                      <span className="text-slate-400">/ {quota.dailyLimit.toLocaleString()}</span>
                    </span>
                    <span className="text-slate-300 dark:text-slate-700">•</span>
                    <span>
                      Monthly Remaining:{" "}
                      <strong className="text-slate-900 dark:text-white font-semibold">
                        {quota.monthlyRemaining.toLocaleString()}
                      </strong>{" "}
                      <span className="text-slate-400">/ {quota.monthlyLimit.toLocaleString()}</span>
                    </span>
                  </div>
                  <span className="text-slate-500 font-medium">
                    Sendable now: <strong className="text-blue-600 dark:text-blue-400">{quota.maxSendableNow.toLocaleString()}</strong>
                  </span>
                </div>
              )}

              {/* Filter Tabs */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
                {[
                  { id: "eligible", label: "Eligible", count: summary?.eligible },
                  {
                    id: "never_contacted",
                    label: "Never Contacted",
                    count: contacts.filter((c) => c.is_eligible && !c.already_contacted).length,
                  },
                  { id: "already_contacted", label: "Already Contacted", count: summary?.already_contacted },
                  { id: "all", label: "All Contacts", count: summary?.total },
                  { id: "replied", label: "Replied", count: summary?.replied },
                  { id: "bounced", label: "Bounced", count: summary?.bounced },
                  { id: "suppressed", label: "Suppressed", count: summary?.suppressed },
                ].map((tab) => {
                  const isActive = filterTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setFilterTab(tab.id as FilterTab)}
                      className={`px-2.5 py-1 rounded-md font-medium transition-colors whitespace-nowrap flex items-center gap-1.5 ${
                        isActive
                          ? "bg-blue-600 text-white"
                          : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                      }`}
                    >
                      <span>{tab.label}</span>
                      {tab.count !== undefined && (
                        <span
                          className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                            isActive
                              ? "bg-blue-700 text-white"
                              : "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200"
                          }`}
                        >
                          {tab.count}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Search & Select All in View */}
              <div className="flex items-center gap-3">
                <Input
                  type="text"
                  placeholder="Search by name, email, or company..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="flex-1 text-sm"
                />
                {selectablesInCurrentView.length > 0 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleSelectAll}
                    className="whitespace-nowrap text-xs"
                  >
                    {selectablesInCurrentView.every((c) => selectedIds.has(c.id))
                      ? `Deselect ${filterTab === "already_contacted" ? "All" : "Eligible"}`
                      : `Select All ${filterTab === "already_contacted" ? "Contacted" : "Eligible"}`}
                  </Button>
                )}
              </div>

              {/* FEATURE A & B: ENROLLMENT RANGE CONTROL */}
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg dark:bg-slate-850 dark:border-slate-800 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                      Enrollment Range:
                    </span>
                    <div className="inline-flex rounded-md shadow-sm">
                      <button
                        type="button"
                        onClick={() => handleRangeModeChange("all")}
                        className={`px-2.5 py-1 text-xs font-medium rounded-l-md border ${
                          rangeMode === "all"
                            ? "bg-blue-600 text-white border-blue-600"
                            : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700"
                        }`}
                      >
                        Entire list
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRangeModeChange("range")}
                        className={`px-2.5 py-1 text-xs font-medium rounded-r-md border-t border-b border-r ${
                          rangeMode === "range"
                            ? "bg-blue-600 text-white border-blue-600"
                            : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700"
                        }`}
                      >
                        Custom Range
                      </button>
                    </div>
                  </div>

                  {rangeMode === "range" && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] text-slate-500">Quick:</span>
                      <button
                        type="button"
                        onClick={() => handleQuickRange(1, 10)}
                        className="px-2 py-0.5 text-[11px] font-medium bg-slate-200 hover:bg-slate-300 rounded text-slate-700 dark:bg-slate-700 dark:text-slate-200"
                      >
                        1–10
                      </button>
                      <button
                        type="button"
                        onClick={() => handleQuickRange(20, 30)}
                        className="px-2 py-0.5 text-[11px] font-medium bg-slate-200 hover:bg-slate-300 rounded text-slate-700 dark:bg-slate-700 dark:text-slate-200"
                      >
                        20–30
                      </button>
                      <button
                        type="button"
                        onClick={() => handleQuickRange(50, 100)}
                        className="px-2 py-0.5 text-[11px] font-medium bg-slate-200 hover:bg-slate-300 rounded text-slate-700 dark:bg-slate-700 dark:text-slate-200"
                      >
                        50–100
                      </button>
                    </div>
                  )}
                </div>

                {rangeMode === "range" && (
                  <div className="flex flex-wrap items-center gap-3 pt-1">
                    <div className="flex items-center gap-1.5">
                      <label className="text-xs text-slate-600 dark:text-slate-400">Start:</label>
                      <Input
                        type="number"
                        min={1}
                        value={startRowInput}
                        onChange={(e) => handleRangeInputChange(e.target.value, endRowInput)}
                        className="w-20 h-7 text-xs"
                      />
                    </div>
                    <div className="flex items-center gap-1.5">
                      <label className="text-xs text-slate-600 dark:text-slate-400">End:</label>
                      <Input
                        type="number"
                        min={1}
                        value={endRowInput}
                        onChange={(e) => handleRangeInputChange(startRowInput, e.target.value)}
                        className="w-20 h-7 text-xs"
                      />
                    </div>
                    {rangeError && (
                      <span className="text-[11px] text-red-600 font-medium">{rangeError}</span>
                    )}
                  </div>
                )}

                {/* Live counts & Preview */}
                <div className="flex flex-wrap items-center justify-between text-xs pt-1.5 border-t border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400">
                  <div className="flex items-center gap-4">
                    <span>
                      Available contacts:{" "}
                      <strong className="text-slate-900 dark:text-white font-mono">
                        {availableContactsCount}
                      </strong>
                    </span>
                    <span>
                      Selected contacts:{" "}
                      <strong className="text-blue-600 dark:text-blue-400 font-mono">
                        {selectedIds.size}
                      </strong>
                    </span>
                  </div>
                  {rangeInfo.isValid && rangeInfo.count > 0 && (
                    <div className="flex items-center gap-2 text-[11px] text-slate-500">
                      <span>
                        First: <strong className="text-slate-700 dark:text-slate-300">{rangeInfo.firstPreview}</strong>
                      </span>
                      <span>•</span>
                      <span>
                        Last: <strong className="text-slate-700 dark:text-slate-300">{rangeInfo.lastPreview}</strong>
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Contact List */}
              <div className="max-h-72 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100 dark:border-slate-800 dark:divide-slate-800">
                {loading ? (
                  <div className="p-8 text-center text-xs text-slate-400">Checking contact eligibility...</div>
                ) : filteredContacts.length === 0 ? (
                  <div className="p-8 text-center text-xs text-slate-400">
                    No contacts found in this filter tab.
                  </div>
                ) : (
                  filteredContacts.map((contact, index) => {
                    const isSelected = selectedIds.has(contact.id);
                    const isEnrolled = enrolledLeadIds.has(contact.id);
                    const isSuppressed =
                      contact.ineligible_reason === "Suppressed" ||
                      contact.ineligible_reason === "Invalid Email";
                    const isClickable = !isEnrolled && !isSuppressed;

                    return (
                      <div
                        key={contact.id}
                        onClick={() => isClickable && toggleSelect(contact)}
                        className={`flex items-center justify-between p-3 text-xs transition-colors ${
                          !isClickable
                            ? "bg-slate-50 opacity-50 cursor-not-allowed dark:bg-slate-900"
                            : contact.already_contacted && !isSelected
                            ? "cursor-pointer hover:bg-amber-50/60 dark:hover:bg-amber-950/20"
                            : isSelected
                            ? "bg-blue-50/50 hover:bg-blue-50 dark:bg-blue-950/20"
                            : "cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-850"
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <span className="text-[10px] text-slate-400 font-mono w-6 text-right">
                            #{index + 1}
                          </span>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            disabled={!isClickable}
                            onChange={() => isClickable && toggleSelect(contact)}
                            className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer disabled:cursor-not-allowed"
                          />
                          <div>
                            <p className="font-semibold text-slate-900 dark:text-white">
                              {contact.first_name} {contact.last_name}
                            </p>
                            <p className="text-slate-400">{contact.email}</p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          {contact.company_name && (
                            <span className="text-slate-500 dark:text-slate-400">
                              {contact.company_name}
                            </span>
                          )}
                          {getBadgeForContact(contact, isSelected)}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between pt-3 border-t border-slate-100 dark:border-slate-800">
                <span className="text-xs text-slate-500">
                  {selectedIds.size} contact(s) selected
                  {overrideIds.size > 0 && ` (${overrideIds.size} re-enrollment)`}
                </span>
                <div className="flex items-center gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={handleClose}>
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    disabled={selectedIds.size === 0 || submitting || (rangeMode === "range" && !rangeInfo.isValid)}
                    onClick={handleSubmit}
                  >
                    {submitting ? "Enrolling..." : `Enroll ${selectedIds.size} Contact(s)`}
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            /* VIEW B: DIRECT IMPORT & ENROLL SPREADSHEET (FEATURE C & D) */
            <div className="pt-1">
              <CampaignContactImportView
                campaignId={campaignId}
                onClose={handleClose}
                onSuccess={() => {
                  onEnrolledSuccess();
                  setRefreshKey((k) => k + 1);
                }}
              />
            </div>
          )}
        </div>
      </Modal>

      {confirmContact && (
        <Modal
          isOpen={true}
          onClose={() => setConfirmContact(null)}
          title="Send Again Confirmation"
          description="This contact was already emailed in a previous or current campaign. Are you sure you want to email them again?"
        >
          <div className="space-y-4 pt-2">
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800">
              <span className="font-semibold">
                {confirmContact.first_name} {confirmContact.last_name}
              </span>{" "}
              ({confirmContact.email}) was previously emailed. Confirming will set a manual override allowing this contact to be enrolled and emailed again.
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setConfirmContact(null)}>
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                className="bg-amber-600 hover:bg-amber-700 text-white"
                onClick={handleConfirmSendAgain}
              >
                Send Again
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* HARD EMAIL SENDING LIMIT MODAL */}
      <SendingLimitModal
        isOpen={limitModalOpen}
        onClose={() => setLimitModalOpen(false)}
        limitType={limitModalData.limitType}
        dailySent={limitModalData.dailySent}
        dailyRemaining={limitModalData.dailyRemaining}
        monthlySent={limitModalData.monthlySent}
        monthlyRemaining={limitModalData.monthlyRemaining}
        attemptedCount={limitModalData.attemptedCount}
      />
    </>
  );
}
