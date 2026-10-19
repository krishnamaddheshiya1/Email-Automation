"use client";

import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface SuppressionItem {
  id: string;
  email: string;
  reason: string;
  source?: string | null;
  created_at: string;
}

interface SuppressionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuppressionChanged?: () => void;
}

export function SuppressionModal({
  isOpen,
  onClose,
  onSuppressionChanged,
}: SuppressionModalProps) {
  const [suppressions, setSuppressions] = useState<SuppressionItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Form State
  const [emailInput, setEmailInput] = useState("");
  const [reasonInput, setReasonInput] = useState("MANUAL");

  const loadSuppressions = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/suppressions");
      const data = await res.json();
      if (res.ok && data.success) {
        setSuppressions(data.data || []);
      } else {
        setError(data.error || "Failed to load suppression list.");
      }
    } catch {
      setError("Network error loading suppressions.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    let ignore = false;
    fetch("/api/suppressions")
      .then((res) => res.json())
      .then((data) => {
        if (!ignore && data.success) {
          setSuppressions(data.data || []);
        } else if (!ignore && data.error) {
          setError(data.error);
        }
      })
      .catch(() => {
        if (!ignore) setError("Network error loading suppressions.");
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });

    return () => {
      ignore = true;
    };
  }, [isOpen]);

  const handleAddSuppression = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailInput.trim()) return;

    setSubmitting(true);
    setError(null);
    setSuccessMsg(null);

    try {
      const res = await fetch("/api/suppressions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: emailInput.trim(),
          reason: reasonInput,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setSuccessMsg(`"${emailInput.trim()}" is now suppressed.`);
        setEmailInput("");
        await loadSuppressions();
        onSuppressionChanged?.();
      } else {
        setError(data.error || "Failed to suppress email.");
      }
    } catch {
      setError("Network error adding suppression.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleRemove = async (email: string) => {
    if (
      !window.confirm(
        `Remove suppression for "${email}"?\n\nNote: This will NOT automatically resume previous campaign enrollments. You must explicitly re-enroll the contact.`
      )
    ) {
      return;
    }

    try {
      const res = await fetch(`/api/suppressions?email=${encodeURIComponent(email)}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setSuccessMsg(`Suppression removed for "${email}".`);
        await loadSuppressions();
        onSuppressionChanged?.();
      } else {
        setError(data.error || "Failed to remove suppression.");
      }
    } catch {
      setError("Network error removing suppression.");
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-100 dark:border-slate-800">
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">
              Global Suppression & Safety Controls
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Suppressed recipients are blocked from all campaign email dispatches.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-lg p-1"
          >
            ✕
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 overflow-y-auto space-y-6">
          {error && (
            <div className="p-3 text-xs bg-rose-50 text-rose-700 border border-rose-200 rounded-lg dark:bg-rose-950/40 dark:border-rose-900 dark:text-rose-300">
              {error}
            </div>
          )}

          {successMsg && (
            <div className="p-3 text-xs bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-lg dark:bg-emerald-950/40 dark:border-emerald-900 dark:text-emerald-300">
              {successMsg}
            </div>
          )}

          {/* Form: Add to Suppression */}
          <form
            onSubmit={handleAddSuppression}
            className="p-4 bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-800 rounded-lg space-y-3"
          >
            <h3 className="text-xs font-semibold text-slate-800 dark:text-slate-200 uppercase tracking-wider">
              Suppress Email Address
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <label className="block text-xs text-slate-600 dark:text-slate-400 mb-1">
                  Email Address
                </label>
                <input
                  type="email"
                  required
                  placeholder="recipient@example.com"
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                  className="w-full text-xs py-2 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-600 dark:text-slate-400 mb-1">
                  Reason
                </label>
                <select
                  value={reasonInput}
                  onChange={(e) => setReasonInput(e.target.value)}
                  className="w-full text-xs py-2 px-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="MANUAL">MANUAL</option>
                  <option value="UNSUBSCRIBED">UNSUBSCRIBED</option>
                  <option value="HARD_BOUNCE">HARD_BOUNCE</option>
                  <option value="COMPLAINT">COMPLAINT</option>
                  <option value="INVALID">INVALID</option>
                </select>
              </div>
            </div>

            <div className="flex justify-end pt-1">
              <Button
                type="submit"
                size="sm"
                variant="primary"
                disabled={submitting || !emailInput.trim()}
              >
                {submitting ? "Adding..." : "Add to Suppression"}
              </Button>
            </div>
          </form>

          {/* Table: Current Suppressions */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold text-slate-800 dark:text-slate-200 uppercase tracking-wider">
                Suppressed Recipients ({suppressions.length})
              </h3>
              <button
                type="button"
                onClick={loadSuppressions}
                className="text-xs text-blue-600 hover:underline dark:text-blue-400"
              >
                Refresh
              </button>
            </div>

            {loading ? (
              <div className="text-xs text-slate-400 py-6 text-center animate-pulse">
                Loading suppressions...
              </div>
            ) : suppressions.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-400 border border-dashed border-slate-200 dark:border-slate-800 rounded-lg">
                No email addresses currently suppressed for this business.
              </div>
            ) : (
              <div className="border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 font-semibold border-b border-slate-200 dark:border-slate-800">
                    <tr>
                      <th className="py-2.5 px-3">Email</th>
                      <th className="py-2.5 px-3">Reason</th>
                      <th className="py-2.5 px-3">Source</th>
                      <th className="py-2.5 px-3">Date</th>
                      <th className="py-2.5 px-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {suppressions.map((s) => (
                      <tr key={s.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-850">
                        <td className="py-2.5 px-3 font-mono text-slate-800 dark:text-slate-200">
                          {s.email}
                        </td>
                        <td className="py-2.5 px-3">
                          <Badge
                            variant={
                              s.reason === "COMPLAINT"
                                ? "outline"
                                : s.reason === "HARD_BOUNCE"
                                ? "warning"
                                : "neutral"
                            }
                            className="text-[10px]"
                          >
                            {s.reason}
                          </Badge>
                        </td>
                        <td className="py-2.5 px-3 text-slate-500 dark:text-slate-400">
                          {s.source || "system"}
                        </td>
                        <td className="py-2.5 px-3 text-slate-400">
                          {new Date(s.created_at).toLocaleDateString()}
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <button
                            type="button"
                            onClick={() => handleRemove(s.email)}
                            className="text-[11px] font-medium text-rose-600 hover:text-rose-800 hover:underline dark:text-rose-400"
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 bg-slate-50 dark:bg-slate-850 border-t border-slate-200 dark:border-slate-800 flex justify-end">
          <Button variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
