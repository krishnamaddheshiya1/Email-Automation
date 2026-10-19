"use client";

import React, { useState, useEffect } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

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

  const handleClose = () => {
    setSelectedIds(new Set());
    setOverrideIds(new Set());
    setConfirmContact(null);
    setError(null);
    setSelectionBanner(null);
    setFilterTab("eligible");
    onClose();
  };

  useEffect(() => {
    if (!isOpen) return;

    let ignore = false;
    async function fetchEligibility() {
      setLoading(true);
      setError(null);
      setSelectionBanner(null);
      try {
        const res = await fetch(`/api/campaigns/${campaignId}/contacts/eligibility`);
        const data = await res.json();
        if (ignore) return;
        if (data.success) {
          setContacts(data.contacts || []);
          setSummary(data.summary || null);
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
  }, [isOpen, campaignId]);

  const filteredContacts = contacts.filter((c) => {
    // 1. Text Search
    const fullName = `${c.first_name || ""} ${c.last_name || ""}`.toLowerCase();
    const q = search.toLowerCase().trim();
    if (q) {
      const match =
        fullName.includes(q) ||
        (c.email && c.email.toLowerCase().includes(q)) ||
        (c.company_name && c.company_name.toLowerCase().includes(q));
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

  const selectablesInCurrentView =
    filterTab === "already_contacted"
      ? filteredContacts.filter((c) => c.already_contacted && !enrolledLeadIds.has(c.id))
      : filteredContacts.filter((c) => c.is_eligible);

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

    try {
      const res = await fetch(`/api/campaigns/${campaignId}/contacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contact_ids: contactIds,
          allow_override: hasOverride,
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setSelectedIds(new Set());
        setOverrideIds(new Set());
        setError(null);
        onEnrolledSuccess();
        onClose();
      } else {
        setError(data.error || "Failed to enroll contacts.");
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
      description="Select contacts from your workspace to assign to this campaign sequence. Already-contacted contacts can be filtered and intentionally re-enrolled."
      className="max-w-2xl"
    >
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

        {/* Filter Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
          {[
            { id: "eligible", label: "Eligible", count: summary?.eligible },
            { id: "never_contacted", label: "Never Contacted", count: contacts.filter((c) => c.is_eligible && !c.already_contacted).length },
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

        {/* Contact List */}
        <div className="max-h-72 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100 dark:border-slate-800 dark:divide-slate-800">
          {loading ? (
            <div className="p-8 text-center text-xs text-slate-400">Checking contact eligibility...</div>
          ) : filteredContacts.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-400">
              No contacts found in this filter tab.
            </div>
          ) : (
            filteredContacts.map((contact) => {
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
                      : "cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-850"
                  }`}
                >
                  <div className="flex items-center gap-3">
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
              disabled={selectedIds.size === 0 || submitting}
              onClick={handleSubmit}
            >
              {submitting ? "Enrolling..." : `Enroll ${selectedIds.size} Contact(s)`}
            </Button>
          </div>
        </div>
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
              <span className="font-semibold">{confirmContact.first_name} {confirmContact.last_name}</span> ({confirmContact.email}) was previously emailed. Confirming will set a manual override allowing this contact to be enrolled and emailed again.
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
    </>
  );
}
