"use client";

import React, { useState, useEffect, useRef } from "react";
import { useMailWorkspace } from "@/components/layout/mail-workspace-context";

interface UploadedAttachment {
  id: string;
  filename: string;
  file_size: number;
}

export function ComposeModal() {
  const { composeOpen, composeInitial, closeCompose, refreshCounts } = useMailWorkspace();

  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [attachments, setAttachments] = useState<UploadedAttachment[]>([]);
  const [isMinimized, setIsMinimized] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (composeInitial) {
      const timer = setTimeout(() => {
        if (composeInitial.to) setTo(composeInitial.to);
        if (composeInitial.subject) setSubject(composeInitial.subject);
        if (composeInitial.body) setBody(composeInitial.body);
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [composeInitial]);

  if (!composeOpen) return null;

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploading(true);
    setErrorMessage(null);

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const formData = new FormData();
      formData.append("file", file);

      try {
        const res = await fetch("/api/attachments", {
          method: "POST",
          body: formData,
        });
        const data = await res.json();
        if (data.success && data.attachment) {
          setAttachments((prev) => [
            ...prev,
            {
              id: data.attachment.id,
              filename: data.attachment.original_filename || data.attachment.filename,
              file_size: data.attachment.file_size,
            },
          ]);
        } else {
          setErrorMessage(data.error || `Failed to upload ${file.name}`);
        }
      } catch {
        setErrorMessage(`Failed to upload ${file.name}`);
      }
    }

    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removeAttachment(id: string) {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }

  async function handleSend() {
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!to.trim()) {
      setErrorMessage("Please enter a recipient email address.");
      return;
    }
    if (!subject.trim()) {
      setErrorMessage("Please enter a subject.");
      return;
    }
    if (!body.trim()) {
      setErrorMessage("Please write a message.");
      return;
    }

    setSending(true);
    try {
      const res = await fetch("/api/email/compose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: to.trim(),
          subject: subject.trim(),
          body: body.trim(),
          attachmentIds: attachments.map((a) => a.id),
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to send email");
      }

      setSuccessMessage("Message sent successfully!");
      await refreshCounts();
      setTimeout(() => {
        setTo("");
        setSubject("");
        setBody("");
        setAttachments([]);
        setSuccessMessage(null);
        closeCompose();
      }, 1200);
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to send email");
    } finally {
      setSending(false);
    }
  }

  function handleSaveDraft() {
    try {
      const draft = { to, subject, body, savedAt: new Date().toISOString() };
      localStorage.setItem("email_compose_draft", JSON.stringify(draft));
      setSuccessMessage("Draft saved locally");
      setTimeout(() => setSuccessMessage(null), 2000);
    } catch {
      setErrorMessage("Failed to save draft");
    }
  }

  return (
    <div
      className={`fixed z-50 transition-all duration-200 shadow-2xl rounded-t-xl bg-white border border-slate-300 dark:bg-slate-900 dark:border-slate-700 flex flex-col ${
        isMaximized
          ? "inset-4 sm:inset-10"
          : isMinimized
          ? "bottom-0 right-4 sm:right-10 w-72 sm:w-80 h-11"
          : "bottom-0 right-4 sm:right-10 w-[95vw] sm:w-[580px] h-[520px]"
      }`}
    >
      {/* Compose Header Bar */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-slate-100 rounded-t-xl border-b border-slate-200 dark:bg-slate-800 dark:border-slate-700 select-none">
        <span className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">
          {subject ? subject : "New Message"}
        </span>
        <div className="flex items-center gap-1.5 text-slate-500">
          {/* Minimize Button */}
          <button
            type="button"
            onClick={() => setIsMinimized((prev) => !prev)}
            className="p-1 hover:text-slate-800 hover:bg-slate-200 rounded dark:hover:text-white dark:hover:bg-slate-700 transition-colors"
            title={isMinimized ? "Expand" : "Minimize"}
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M5 12h14" />
            </svg>
          </button>
          {/* Maximize Button */}
          {!isMinimized && (
            <button
              type="button"
              onClick={() => setIsMaximized((prev) => !prev)}
              className="p-1 hover:text-slate-800 hover:bg-slate-200 rounded dark:hover:text-white dark:hover:bg-slate-700 transition-colors"
              title={isMaximized ? "Restore" : "Full screen"}
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                {isMaximized ? (
                  <path d="M4 14h6m0 0v6m0-6L3 21m17-7h-6m0 0v6m0-6l7 7M4 10h6m0 0V4m0 6L3 3m17 7h-6m0 0V4m0 6l7-7" />
                ) : (
                  <path d="M15 3h6v6m0-6L10 14M9 21H3v-6m0 6l11-11" />
                )}
              </svg>
            </button>
          )}
          {/* Close Button */}
          <button
            type="button"
            onClick={closeCompose}
            className="p-1 hover:text-rose-600 hover:bg-slate-200 rounded dark:hover:bg-slate-700 transition-colors"
            title="Save & Close"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Compose Body (hidden if minimized) */}
      {!isMinimized && (
        <div className="flex-1 flex flex-col p-4 gap-2 overflow-y-auto">
          {errorMessage && (
            <div className="p-2 text-xs rounded bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800">
              {errorMessage}
            </div>
          )}
          {successMessage && (
            <div className="p-2 text-xs rounded bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800">
              {successMessage}
            </div>
          )}

          {/* To Field */}
          <div className="flex items-center border-b border-slate-200 dark:border-slate-800 pb-1.5">
            <span className="text-xs font-medium text-slate-500 w-12 shrink-0">To:</span>
            <input
              type="email"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="recipient@example.com"
              className="flex-1 text-sm bg-transparent outline-none text-slate-800 dark:text-slate-100 placeholder:text-slate-400"
              disabled={sending}
            />
          </div>

          {/* Subject Field */}
          <div className="flex items-center border-b border-slate-200 dark:border-slate-800 pb-1.5">
            <span className="text-xs font-medium text-slate-500 w-12 shrink-0">Subject:</span>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Email subject"
              className="flex-1 text-sm bg-transparent outline-none text-slate-800 dark:text-slate-100 placeholder:text-slate-400"
              disabled={sending}
            />
          </div>

          {/* Attached Files Pill List */}
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5 py-1">
              {attachments.map((att) => (
                <span
                  key={att.id}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs bg-slate-100 border border-slate-200 text-slate-700 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-300"
                >
                  <svg className="w-3 h-3 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                  </svg>
                  <span className="truncate max-w-[150px]">{att.filename}</span>
                  <span className="text-[10px] text-slate-400">({Math.round(att.file_size / 1024)} KB)</span>
                  <button
                    type="button"
                    onClick={() => removeAttachment(att.id)}
                    className="hover:text-rose-600 transition-colors"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* Body Textarea */}
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write your email here..."
            className="flex-1 w-full resize-none p-2 text-sm bg-transparent outline-none text-slate-800 dark:text-slate-100 placeholder:text-slate-400 min-h-[140px]"
            disabled={sending}
          />

          {/* Hidden File Input */}
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileUpload}
            multiple
            className="hidden"
            accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.png,.jpg,.jpeg,.gif,.webp"
          />

          {/* Bottom Toolbar */}
          <div className="flex items-center justify-between border-t border-slate-200 dark:border-slate-800 pt-2.5 mt-auto">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleSend}
                disabled={sending || uploading}
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-sm transition-colors disabled:opacity-60"
              >
                {sending ? (
                  <>
                    <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                    </svg>
                    <span>Sending...</span>
                  </>
                ) : (
                  <>
                    <span>Send</span>
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="m22 2-7 20-4-9-9-4Z" />
                      <path d="M22 2 11 13" />
                    </svg>
                  </>
                )}
              </button>

              {/* Attach File Button */}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading || sending}
                className="p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg dark:hover:text-slate-200 dark:hover:bg-slate-800 transition-colors"
                title="Attach file (PDF, XLSX, DOCX, Images, etc.)"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                </svg>
              </button>

              {/* Save Draft Button */}
              <button
                type="button"
                onClick={handleSaveDraft}
                className="px-2.5 py-1 text-xs text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded dark:hover:text-slate-300 dark:hover:bg-slate-800 transition-colors"
                title="Save draft"
              >
                Save Draft
              </button>
            </div>

            {/* Discard / Trash Button */}
            <button
              type="button"
              onClick={closeCompose}
              className="p-2 text-slate-400 hover:text-rose-600 rounded transition-colors"
              title="Discard draft"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 6h18" />
                <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
