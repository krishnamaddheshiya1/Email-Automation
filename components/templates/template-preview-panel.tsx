"use client";

import React, { useState } from "react";
import { renderTemplate, SAMPLE_PREVIEW_CONTACT, SAMPLE_PREVIEW_SENDER } from "@/lib/utils/template";
import { Badge } from "@/components/ui/badge";
import { Attachment } from "@/types/attachment";

interface TemplatePreviewPanelProps {
  subject: string;
  body: string;
  attachments?: Attachment[];
  pendingFiles?: File[];
}

export function TemplatePreviewPanel({
  subject,
  body,
  attachments = [],
  pendingFiles = [],
}: TemplatePreviewPanelProps) {
  const [viewport, setViewport] = useState<"desktop" | "mobile">("desktop");

  const rendered = renderTemplate(
    { subject, body },
    SAMPLE_PREVIEW_CONTACT,
    SAMPLE_PREVIEW_SENDER,
    { sanitize: true }
  );

  const totalAttachmentsCount = attachments.length + pendingFiles.length;

  return (
    <div className="flex flex-col h-full rounded-2xl border border-slate-200 bg-slate-50/50 p-4 dark:border-slate-800 dark:bg-slate-900/50">
      {/* Header Controls */}
      <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
        <div className="flex items-center gap-2">
          <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
            Live Email Preview
          </h3>
          <Badge variant="neutral" className="text-[10px]">
            Sample Data Mode
          </Badge>
          {totalAttachmentsCount > 0 && (
            <Badge variant="outline" className="text-[10px] text-blue-600 dark:text-blue-400 border-blue-300">
              📎 {totalAttachmentsCount} File{totalAttachmentsCount > 1 ? "s" : ""}
            </Badge>
          )}
        </div>

        {/* Viewport switch */}
        <div className="flex items-center rounded-lg border border-slate-200 bg-white p-0.5 dark:border-slate-750 dark:bg-slate-800">
          <button
            type="button"
            onClick={() => setViewport("desktop")}
            className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
              viewport === "desktop"
                ? "bg-slate-900 text-white dark:bg-blue-600"
                : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
            }`}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-3.5 w-3.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect width="20" height="14" x="2" y="3" rx="2" />
              <line x1="8" x2="16" y1="21" y2="21" />
              <line x1="12" x2="12" y1="17" y2="21" />
            </svg>
            <span>Desktop</span>
          </button>
          <button
            type="button"
            onClick={() => setViewport("mobile")}
            className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
              viewport === "mobile"
                ? "bg-slate-900 text-white dark:bg-blue-600"
                : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
            }`}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-3.5 w-3.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect width="14" height="20" x="5" y="2" rx="2" ry="2" />
              <path d="M12 18h.01" />
            </svg>
            <span>Mobile</span>
          </button>
        </div>
      </div>

      {/* Notice Banner */}
      <div className="mt-3 rounded-lg border border-amber-200/80 bg-amber-50/80 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
        <div className="flex items-start gap-2">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" x2="12" y1="8" y2="12" />
            <line x1="12" x2="12.01" y1="16" y2="16" />
          </svg>
          <div>
            <span className="font-semibold">Simulated Sample Contact:</span> Rahul Sharma
            (Founder at Demo Company) • Sender: Demo Sender (Demo Business).
          </div>
        </div>
      </div>

      {/* Missing Variables Warning */}
      {rendered.missingVariables.length > 0 && (
        <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-300">
          <span className="font-semibold">Missing variables detected:</span>{" "}
          {rendered.missingVariables.map((v) => `[Missing ${v}]`).join(", ")}
        </div>
      )}

      {/* Email Client Mock Frame */}
      <div className="mt-3 flex-1 flex justify-center overflow-y-auto">
        <div
          className={`w-full transition-all duration-300 ${
            viewport === "mobile" ? "max-w-sm" : "max-w-2xl"
          }`}
        >
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden dark:border-slate-800 dark:bg-slate-950">
            {/* Email Meta Bar */}
            <div className="border-b border-slate-100 bg-slate-50/60 p-3.5 text-xs space-y-1.5 dark:border-slate-800 dark:bg-slate-900/50">
              <div className="flex items-baseline gap-2">
                <span className="font-semibold text-slate-500 w-12 shrink-0">From:</span>
                <span className="text-slate-800 dark:text-slate-200 font-medium">
                  {SAMPLE_PREVIEW_SENDER.sender_name} &lt;sender@example.test&gt;
                </span>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="font-semibold text-slate-500 w-12 shrink-0">To:</span>
                <span className="text-slate-800 dark:text-slate-200">
                  {SAMPLE_PREVIEW_CONTACT.first_name} {SAMPLE_PREVIEW_CONTACT.last_name} &lt;{SAMPLE_PREVIEW_CONTACT.email}&gt;
                </span>
              </div>
              <div className="flex items-baseline gap-2 pt-1 border-t border-slate-200/50 dark:border-slate-800/60">
                <span className="font-semibold text-slate-500 w-12 shrink-0">Subject:</span>
                <span className="text-slate-900 dark:text-white font-semibold">
                  {rendered.subject || <span className="text-slate-400 italic">No subject</span>}
                </span>
              </div>
            </div>

            {/* Email Body */}
            <div className="p-4 sm:p-6 min-h-[200px] text-sm text-slate-800 leading-relaxed dark:text-slate-200">
              {rendered.body ? (
                <div
                  className="prose prose-sm max-w-none dark:prose-invert whitespace-pre-wrap font-sans"
                  dangerouslySetInnerHTML={{ __html: rendered.body }}
                />
              ) : (
                <div className="flex h-36 items-center justify-center text-xs text-slate-400 italic">
                  Template body is empty
                </div>
              )}

              {/* Attachments Section Inside Email Client Preview */}
              {totalAttachmentsCount > 0 && (
                <div className="mt-6 pt-4 border-t border-slate-200 dark:border-slate-800">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2.5">
                    <span>📎</span>
                    <span>
                      Attachments ({totalAttachmentsCount})
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {/* Staged / Pending Local Files */}
                    {pendingFiles.map((file, idx) => {
                      const isImage = file.type.startsWith("image/");
                      const objectUrl = isImage ? URL.createObjectURL(file) : null;

                      return (
                        <div
                          key={`prev-pend-${idx}`}
                          className="flex items-center gap-2.5 p-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60"
                        >
                          <div className="h-9 w-9 rounded overflow-hidden bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0 border border-slate-200 dark:border-slate-700">
                            {isImage && objectUrl ? (
                              /* eslint-disable-next-line @next/next/no-img-element */
                              <img
                                src={objectUrl}
                                alt={file.name}
                                className="h-full w-full object-cover"
                                onLoad={() => URL.revokeObjectURL(objectUrl)}
                                onError={(e) => {
                                  (e.target as HTMLElement).style.display = "none";
                                }}
                              />
                            ) : (
                              <span className="text-base">📄</span>
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-medium text-slate-800 dark:text-slate-200 truncate" title={file.name}>
                              {file.name}
                            </p>
                            <p className="text-[10px] text-slate-400 font-mono">
                              {(file.size / 1024).toFixed(1)} KB
                            </p>
                          </div>
                        </div>
                      );
                    })}

                    {/* Already Uploaded Attachments */}
                    {attachments.map((att) => {
                      const isImage = att.mime_type?.startsWith("image/");

                      return (
                        <div
                          key={`prev-att-${att.id}`}
                          className="flex items-center gap-2.5 p-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60"
                        >
                          <div className="h-9 w-9 rounded overflow-hidden bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0 border border-slate-200 dark:border-slate-700">
                            {isImage ? (
                              /* eslint-disable-next-line @next/next/no-img-element */
                              <img
                                src={`/api/attachments/${att.id}/download`}
                                alt={att.filename}
                                className="h-full w-full object-cover"
                                onError={(e) => {
                                  (e.target as HTMLElement).style.display = "none";
                                }}
                              />
                            ) : (
                              <span className="text-base">📄</span>
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p
                              className="text-xs font-medium text-slate-800 dark:text-slate-200 truncate"
                              title={att.original_filename || att.filename}
                            >
                              {att.original_filename || att.filename}
                            </p>
                            <p className="text-[10px] text-slate-400 font-mono">
                              {att.file_size ? `${(att.file_size / 1024).toFixed(1)} KB` : "FILE"}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Variables detected */}
          {rendered.variablesFound.length > 0 && (
            <div className="mt-3 flex items-center gap-1.5 flex-wrap text-[11px] text-slate-500">
              <span className="font-medium">Variables in this template:</span>
              {rendered.variablesFound.map((v) => (
                <span
                  key={v}
                  className="rounded bg-slate-200/70 px-1.5 py-0.5 font-mono text-[10px] text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                >
                  {`{{${v}}}`}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
