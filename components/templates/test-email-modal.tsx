"use client";

import React, { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Attachment } from "@/types/attachment";

interface TestEmailModalProps {
  isOpen: boolean;
  onClose: () => void;
  templateId?: string;
  subject: string;
  body: string;
  attachments?: Attachment[];
  pendingFiles?: File[];
}

export function TestEmailModal({
  isOpen,
  onClose,
  templateId,
  subject,
  body,
  attachments = [],
  pendingFiles = [],
}: TestEmailModalProps) {
  const [recipient, setRecipient] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [status, setStatus] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const totalAttachments = attachments.length + pendingFiles.length;

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!recipient.trim()) {
      setStatus({ type: "error", text: "Please enter a recipient email address." });
      return;
    }

    setIsSending(true);
    setStatus(null);

    try {
      const attachmentIds: string[] = attachments.map((a) => a.id);

      // If there are pending files staged, upload them first to obtain their attachment IDs
      if (pendingFiles.length > 0) {
        for (const file of pendingFiles) {
          const formData = new FormData();
          formData.append("file", file);
          if (templateId) formData.append("template_id", templateId);
          const uploadRes = await fetch("/api/attachments", {
            method: "POST",
            body: formData,
          });
          const uploadData = await uploadRes.json();
          if (uploadRes.ok && uploadData.attachment) {
            attachmentIds.push(uploadData.attachment.id);
          }
        }
      }

      const res = await fetch("/api/email/test-send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: recipient.trim().toLowerCase(),
          subject: subject.trim() || "Test Email from Template",
          body: body.trim(),
          template_id: templateId || undefined,
          attachment_ids: attachmentIds.length > 0 ? attachmentIds : undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to dispatch test email.");
      }

      setStatus({
        type: "success",
        text: `Test email successfully sent to ${recipient}! (${totalAttachments} file attachment${
          totalAttachments !== 1 ? "s" : ""
        } included)`,
      });
    } catch (err: unknown) {
      setStatus({
        type: "error",
        text: err instanceof Error ? err.message : "Network error dispatching test email.",
      });
    } finally {
      setIsSending(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {
        setStatus(null);
        onClose();
      }}
      title="Send Test Email with Attachments"
      description="Send a real test email with your personalized template and attached files to verify delivery."
    >
      <form onSubmit={handleSend} className="space-y-4 pt-2">
        {status && (
          <div
            className={`p-3 rounded-lg text-xs flex items-start gap-2 ${
              status.type === "success"
                ? "bg-emerald-50 text-emerald-800 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800"
                : "bg-rose-50 text-rose-800 border border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800"
            }`}
          >
            <span>{status.type === "success" ? "✓" : "⚠"}</span>
            <span>{status.text}</span>
          </div>
        )}

        <div>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
            Recipient Email Address <span className="text-rose-500">*</span>
          </label>
          <Input
            type="email"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder="e.g. yourname@example.com"
            required
            autoFocus
          />
          <p className="mt-1 text-[11px] text-slate-400">
            This will dispatch a real email through your configured provider.
          </p>
        </div>

        {/* Attachment Summary Preview */}
        <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-900/50">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
            <span>Attached Files to Send:</span>
            <span className="text-blue-600 dark:text-blue-400">
              {totalAttachments} file{totalAttachments !== 1 ? "s" : ""}
            </span>
          </div>

          {totalAttachments === 0 ? (
            <p className="text-xs text-slate-400 italic">No files currently attached to this template.</p>
          ) : (
            <div className="space-y-1.5 max-h-32 overflow-y-auto pr-1">
              {pendingFiles.map((f, i) => (
                <div key={`modal-pend-${i}`} className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                  <span>📎</span>
                  <span className="truncate font-medium">{f.name}</span>
                  <span className="text-[10px] text-slate-400 font-mono">({(f.size / 1024).toFixed(1)} KB)</span>
                </div>
              ))}
              {attachments.map((a) => (
                <div key={`modal-att-${a.id}`} className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                  <span>📎</span>
                  <span className="truncate font-medium">{a.original_filename || a.filename}</span>
                  <span className="text-[10px] text-slate-400 font-mono">
                    ({a.file_size ? `${(a.file_size / 1024).toFixed(1)} KB` : "FILE"})
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setStatus(null);
              onClose();
            }}
            disabled={isSending}
          >
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={isSending}>
            {isSending ? (
              <>
                <span className="animate-spin text-white mr-1.5">⟳</span>
                <span>Dispatching...</span>
              </>
            ) : (
              <>
                <span className="mr-1">✈</span>
                <span>Send Test Email</span>
              </>
            )}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
