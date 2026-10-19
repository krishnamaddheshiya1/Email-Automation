"use client";

import React, { useState, useEffect } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Campaign, BulkEnrollPreviewResult } from "@/types/database";

interface BulkEnrollModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedIds: string[];
  onSuccess: () => void;
}

export function BulkEnrollModal({
  isOpen,
  onClose,
  selectedIds,
  onSuccess,
}: BulkEnrollModalProps) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState("");
  const [preview, setPreview] = useState<BulkEnrollPreviewResult | null>(null);
  const [loadingCampaigns, setLoadingCampaigns] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [loadingEnroll, setLoadingEnroll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Fetch campaigns
  useEffect(() => {
    let ignore = false;
    async function loadCampaigns() {
      if (!isOpen) return;
      setLoadingCampaigns(true);
      setError(null);
      setPreview(null);
      setSuccessMessage(null);
      try {
        const res = await fetch("/api/campaigns?limit=100");
        const data = await res.json();
        if (!ignore && res.ok && data.success && Array.isArray(data.data)) {
          setCampaigns(data.data);
          if (data.data.length > 0) {
            setSelectedCampaignId(data.data[0].id);
          }
        }
      } catch {
        if (!ignore) setError("Failed to load campaigns.");
      } finally {
        if (!ignore) setLoadingCampaigns(false);
      }
    }
    loadCampaigns();
    return () => {
      ignore = true;
    };
  }, [isOpen]);

  // Load enrollment preview whenever selected campaign changes
  useEffect(() => {
    let ignore = false;
    async function loadPreview() {
      if (!isOpen || !selectedCampaignId || selectedIds.length === 0) return;
      setLoadingPreview(true);
      setError(null);
      try {
        const res = await fetch("/api/contacts/bulk-enroll/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            campaign_id: selectedCampaignId,
            contact_ids: selectedIds,
          }),
        });
        const data = await res.json();
        if (!ignore && res.ok && data.success) {
          setPreview(data);
        } else if (!ignore) {
          setError(data.error || "Failed to load enrollment preview.");
        }
      } catch {
        if (!ignore) setError("Error calculating enrollment preview.");
      } finally {
        if (!ignore) setLoadingPreview(false);
      }
    }
    loadPreview();
    return () => {
      ignore = true;
    };
  }, [isOpen, selectedCampaignId, selectedIds]);

  const handleEnroll = async () => {
    if (!selectedCampaignId || !preview || preview.eligibleCount === 0) return;
    setLoadingEnroll(true);
    setError(null);
    try {
      const res = await fetch("/api/contacts/bulk-enroll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaign_id: selectedCampaignId,
          contact_ids: selectedIds,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to enroll contacts.");
      }
      setSuccessMessage(data.message || `Successfully enrolled ${data.enrolledCount} contacts.`);
      setTimeout(() => {
        onSuccess();
        onClose();
      }, 1500);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to enroll contacts.");
    } finally {
      setLoadingEnroll(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Enroll Contacts in Campaign"
      description="Add selected audience members into an automated sequence."
    >
      <div className="space-y-4">
        {error && (
          <div className="p-3 text-xs bg-rose-50 border border-rose-200 text-rose-700 rounded-lg dark:bg-rose-950/40 dark:border-rose-900 dark:text-rose-400">
            {error}
          </div>
        )}

        {successMessage && (
          <div className="p-3 text-xs bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg dark:bg-emerald-950/40 dark:border-emerald-900 dark:text-emerald-300">
            ✓ {successMessage}
          </div>
        )}

        <div>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
            Target Campaign
          </label>
          {loadingCampaigns ? (
            <p className="text-xs text-slate-500">Loading campaigns...</p>
          ) : campaigns.length === 0 ? (
            <p className="text-xs text-amber-600">No campaigns found. Please create a campaign first.</p>
          ) : (
            <select
              value={selectedCampaignId}
              onChange={(e) => setSelectedCampaignId(e.target.value)}
              className="w-full text-xs rounded-lg border border-slate-300 dark:border-slate-700 p-2 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.status})
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Enrollment Preview Breakdown */}
        {loadingPreview ? (
          <div className="p-4 text-center text-xs text-slate-500">
            Checking safety suppression and previous enrollments...
          </div>
        ) : preview ? (
          <div className="space-y-2">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs">
              <div className="p-2.5 bg-slate-50 dark:bg-slate-800/60 rounded-lg border border-slate-200 dark:border-slate-700">
                <span className="block text-base font-bold text-slate-900 dark:text-white">
                  {preview.totalSelected}
                </span>
                <span className="text-[10px] text-slate-500">Selected</span>
              </div>
              <div className="p-2.5 bg-emerald-50 dark:bg-emerald-950/40 rounded-lg border border-emerald-200 dark:border-emerald-800">
                <span className="block text-base font-bold text-emerald-600 dark:text-emerald-400">
                  {preview.eligibleCount}
                </span>
                <span className="text-[10px] text-emerald-700 dark:text-emerald-300">Eligible</span>
              </div>
              <div className="p-2.5 bg-rose-50 dark:bg-rose-950/40 rounded-lg border border-rose-200 dark:border-rose-800">
                <span className="block text-base font-bold text-rose-600 dark:text-rose-400">
                  {preview.suppressedCount}
                </span>
                <span className="text-[10px] text-rose-700 dark:text-rose-300">Suppressed</span>
              </div>
              <div className="p-2.5 bg-amber-50 dark:bg-amber-950/40 rounded-lg border border-amber-200 dark:border-amber-800">
                <span className="block text-base font-bold text-amber-600 dark:text-amber-400">
                  {preview.alreadyEnrolledCount}
                </span>
                <span className="text-[10px] text-amber-700 dark:text-amber-300">Enrolled</span>
              </div>
            </div>

            {preview.suppressedCount > 0 && (
              <p className="text-[11px] text-rose-600 dark:text-rose-400">
                ⚠ {preview.suppressedCount} contact(s) are suppressed (unsubscribed/bounced) and will NOT receive emails.
              </p>
            )}

            {preview.alreadyEnrolledCount > 0 && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400">
                ℹ {preview.alreadyEnrolledCount} contact(s) are already enrolled in this sequence and will be skipped.
              </p>
            )}
          </div>
        ) : null}

        <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
          <Button variant="outline" size="sm" onClick={onClose} disabled={loadingEnroll}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleEnroll}
            disabled={
              loadingEnroll ||
              loadingPreview ||
              !preview ||
              preview.eligibleCount === 0 ||
              Boolean(successMessage)
            }
          >
            {loadingEnroll
              ? "Enrolling..."
              : `Enroll ${preview ? preview.eligibleCount : 0} Contacts`}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
