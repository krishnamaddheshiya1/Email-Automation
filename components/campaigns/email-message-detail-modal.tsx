"use client";

import React, { useState, useEffect } from "react";
import { Modal } from "@/components/ui/modal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { EmailMessageDetail } from "@/types/database";

interface EmailMessageDetailModalProps {
  messageId: string | null;
  isOpen: boolean;
  onClose: () => void;
}

export function EmailMessageDetailModal({
  messageId,
  isOpen,
  onClose,
}: EmailMessageDetailModalProps) {
  const [detail, setDetail] = useState<EmailMessageDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !messageId) {
      return;
    }

    let ignore = false;
    async function fetchDetail() {
      try {
        const res = await fetch(`/api/email/messages/${messageId}`);
        const data = await res.json();
        if (!ignore) {
          if (res.ok && data.success) {
            setDetail(data.data);
            setError(null);
          } else {
            setError(data.error || "Failed to load email message details.");
          }
          setLoading(false);
        }
      } catch {
        if (!ignore) {
          setError("Network error loading email details.");
          setLoading(false);
        }
      }
    }

    fetchDetail();
    return () => {
      ignore = true;
    };
  }, [isOpen, messageId]);

  const handleClose = () => {
    setDetail(null);
    setError(null);
    onClose();
  };

  const getStatusBadge = (status: string) => {
    const s = (status || "").toUpperCase();
    switch (s) {
      case "DELIVERED":
        return <Badge variant="success">DELIVERED</Badge>;
      case "SENT":
        return <Badge variant="default">SENT</Badge>;
      case "BOUNCED":
        return <Badge variant="warning">BOUNCED</Badge>;
      case "COMPLAINED":
        return <Badge variant="warning">COMPLAINED</Badge>;
      case "FAILED":
        return <Badge variant="warning">FAILED</Badge>;
      case "QUEUED":
      default:
        return <Badge variant="neutral">{s || "QUEUED"}</Badge>;
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Email Message Details"
      description="Detailed dispatch records, provider metadata, and delivery audit events."
      className="max-w-2xl"
    >
      {loading && (
        <div className="py-12 text-center text-slate-500">
          <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-solid border-blue-600 border-r-transparent mb-2" />
          <p className="text-xs">Loading message telemetry...</p>
        </div>
      )}

      {error && (
        <div className="p-4 rounded-lg bg-red-50 border border-red-200 text-red-800 text-xs">
          {error}
        </div>
      )}

      {!loading && detail && (
        <div className="space-y-5 text-xs text-slate-700 dark:text-slate-300">
          {/* Header summary */}
          <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 dark:bg-slate-800/40 dark:border-slate-800 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-slate-900 dark:text-white text-sm">
                {detail.subject}
              </span>
              {getStatusBadge(detail.status)}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-200/60 dark:border-slate-700/50">
              <div>
                <span className="text-[11px] text-slate-500 block">Recipient</span>
                <span className="font-medium text-slate-900 dark:text-slate-100">
                  {detail.lead_name ? `${detail.lead_name} (${detail.to_email})` : detail.to_email}
                </span>
              </div>
              <div>
                <span className="text-[11px] text-slate-500 block">Sender</span>
                <span className="font-medium text-slate-900 dark:text-slate-100">
                  {detail.from_email}
                </span>
              </div>
              <div>
                <span className="text-[11px] text-slate-500 block">Campaign / Step</span>
                <span className="font-medium text-slate-900 dark:text-slate-100">
                  {detail.campaign_name || "Direct Send"}{" "}
                  {detail.step_name ? `• ${detail.step_name}` : ""}
                </span>
              </div>
              <div>
                <span className="text-[11px] text-slate-500 block">Provider Message ID</span>
                <span className="font-mono text-[11px] text-slate-600 dark:text-slate-400">
                  {detail.provider_message_id || "—"}
                </span>
              </div>
            </div>
          </div>

          {/* Timestamps & status alerts */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3 rounded-lg border border-slate-100 bg-white dark:bg-slate-900 dark:border-slate-800 text-center">
            <div>
              <span className="text-[10px] text-slate-400 block uppercase">Created</span>
              <span className="font-medium text-slate-700 dark:text-slate-300">
                {new Date(detail.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </span>
            </div>
            <div>
              <span className="text-[10px] text-slate-400 block uppercase">Sent</span>
              <span className="font-medium text-slate-700 dark:text-slate-300">
                {detail.sent_at ? new Date(detail.sent_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}
              </span>
            </div>
            <div>
              <span className="text-[10px] text-slate-400 block uppercase">Delivered</span>
              <span className="font-medium text-slate-700 dark:text-slate-300">
                {detail.delivered_at ? new Date(detail.delivered_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}
              </span>
            </div>
            <div>
              <span className="text-[10px] text-slate-400 block uppercase">Bounced</span>
              <span className="font-medium text-slate-700 dark:text-slate-300">
                {detail.bounced_at ? new Date(detail.bounced_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}
              </span>
            </div>
          </div>

          {/* Failure reason if bounced or failed */}
          {Boolean(detail.metadata?.reason || detail.metadata?.error) && (
            <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 dark:bg-amber-950/40 dark:border-amber-800 dark:text-amber-200">
              <span className="font-semibold block mb-0.5">Delivery Status Notice:</span>
              <p className="font-mono text-[11px]">{String(detail.metadata?.reason || detail.metadata?.error || "")}</p>
            </div>
          )}

          {/* Event audit trail */}
          <div>
            <h4 className="font-semibold text-slate-900 dark:text-white mb-2">
              Delivery Audit Trail ({detail.events?.length || 0})
            </h4>
            {detail.events && detail.events.length > 0 ? (
              <div className="border border-slate-200 rounded-lg overflow-hidden dark:border-slate-800">
                <table className="w-full text-left">
                  <thead className="bg-slate-50 dark:bg-slate-800 text-[11px] text-slate-500 font-semibold border-b border-slate-200 dark:border-slate-800">
                    <tr>
                      <th className="p-2.5">Event</th>
                      <th className="p-2.5">Timestamp</th>
                      <th className="p-2.5">Provider Event ID</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono text-[11px]">
                    {detail.events.map((ev) => (
                      <tr key={ev.id}>
                        <td className="p-2.5 font-bold">
                          {getStatusBadge(ev.event_type)}
                        </td>
                        <td className="p-2.5 text-slate-600 dark:text-slate-400 font-sans">
                          {new Date(ev.event_timestamp).toLocaleString()}
                        </td>
                        <td className="p-2.5 text-slate-500">
                          {ev.provider_event_id || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-slate-400 italic">No webhook events logged yet for this message.</p>
            )}
          </div>

          <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex justify-end">
            <Button variant="outline" size="sm" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
