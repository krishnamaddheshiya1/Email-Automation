"use client";

import React, { useState, useEffect } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ContactImport } from "@/types/database";

interface ImportHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ImportHistoryModal({
  isOpen,
  onClose,
}: ImportHistoryModalProps) {
  const [imports, setImports] = useState<ContactImport[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;
    async function loadImports() {
      if (!isOpen) return;
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/contacts/imports?limit=50");
        const data = await res.json();
        if (!ignore && res.ok && data.success && Array.isArray(data.data)) {
          setImports(data.data);
        } else if (!ignore) {
          setError(data.error || "Failed to load import history.");
        }
      } catch {
        if (!ignore) setError("Network error loading import history.");
      } finally {
        if (!ignore) setLoading(false);
      }
    }
    loadImports();
    return () => {
      ignore = true;
    };
  }, [isOpen]);

  const handleDownloadErrors = (importId: string) => {
    const link = document.createElement("a");
    link.href = `/api/contacts/imports/${importId}/errors?export=csv`;
    link.setAttribute("download", `import_${importId}_errors.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const getStatusBadge = (status: string) => {
    switch (status.toUpperCase()) {
      case "COMPLETED":
        return <Badge variant="success">COMPLETED</Badge>;
      case "PARTIAL":
        return <Badge variant="warning">PARTIAL</Badge>;
      case "FAILED":
        return <Badge variant="warning" className="bg-rose-100 text-rose-800 border-rose-200">FAILED</Badge>;
      default:
        return <Badge variant="neutral">{status}</Badge>;
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Contact Import History"
      description="Audit trail of previous bulk CSV imports and error records."
      className="max-w-4xl"
    >
      <div className="space-y-4">
        {error && (
          <div className="p-3 text-xs bg-rose-50 border border-rose-200 text-rose-700 rounded-lg dark:bg-rose-950/40 dark:border-rose-900 dark:text-rose-400">
            {error}
          </div>
        )}

        {loading ? (
          <div className="p-8 text-center text-xs text-slate-500">
            Loading import history...
          </div>
        ) : imports.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500">
            No CSV imports recorded yet.
          </div>
        ) : (
          <div className="max-h-96 overflow-y-auto border border-slate-200 dark:border-slate-800 rounded-lg">
            <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-800 text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/80 sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold text-slate-600 dark:text-slate-300">File</th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-600 dark:text-slate-300">Status</th>
                  <th className="px-3 py-2 text-right font-semibold text-slate-600 dark:text-slate-300">Total</th>
                  <th className="px-3 py-2 text-right font-semibold text-emerald-600 dark:text-emerald-400">Imported</th>
                  <th className="px-3 py-2 text-right font-semibold text-amber-600 dark:text-amber-400">Duplicates</th>
                  <th className="px-3 py-2 text-right font-semibold text-rose-600 dark:text-rose-400">Invalid</th>
                  <th className="px-3 py-2 text-right font-semibold text-purple-600 dark:text-purple-400">Suppressed</th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-600 dark:text-slate-300">Date</th>
                  <th className="px-3 py-2 text-right font-semibold text-slate-600 dark:text-slate-300">Errors</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-900">
                {imports.map((item) => {
                  const hasErrors =
                    item.duplicate_count +
                      item.invalid_count +
                      item.suppressed_count +
                      item.failed_count >
                      0 || (item.errors && item.errors.length > 0);

                  return (
                    <tr key={item.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="px-3 py-2 font-medium text-slate-900 dark:text-white truncate max-w-[140px]">
                        {item.filename}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">{getStatusBadge(item.status)}</td>
                      <td className="px-3 py-2 text-right text-slate-700 dark:text-slate-300">
                        {item.total_rows}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold text-emerald-600 dark:text-emerald-400">
                        {item.imported_count}
                      </td>
                      <td className="px-3 py-2 text-right text-amber-600 dark:text-amber-400">
                        {item.duplicate_count}
                      </td>
                      <td className="px-3 py-2 text-right text-rose-600 dark:text-rose-400">
                        {item.invalid_count}
                      </td>
                      <td className="px-3 py-2 text-right text-purple-600 dark:text-purple-400">
                        {item.suppressed_count}
                      </td>
                      <td className="px-3 py-2 text-slate-500 whitespace-nowrap">
                        {new Date(item.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        {hasErrors ? (
                          <button
                            type="button"
                            onClick={() => handleDownloadErrors(item.id)}
                            className="text-xs text-blue-600 hover:underline dark:text-blue-400 font-medium"
                          >
                            CSV Report
                          </button>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex justify-end pt-3 border-t border-slate-100 dark:border-slate-800">
          <Button variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}
