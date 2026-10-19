"use client";

import React, { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { VariablePicker } from "./variable-picker";
import { TemplatePreviewPanel } from "./template-preview-panel";
import { AttachmentUploader } from "@/components/campaigns/attachment-uploader";
import { TestEmailModal } from "./test-email-modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmailTemplate, TemplateStatus } from "@/types/database";
import { Attachment } from "@/types/attachment";

interface TemplateEditorProps {
  initialData?: EmailTemplate;
  isEditing?: boolean;
}

export function TemplateEditor({ initialData, isEditing = false }: TemplateEditorProps) {
  const router = useRouter();

  const [name, setName] = useState(initialData?.name || "");
  const [subject, setSubject] = useState(initialData?.subject || "");
  const [body, setBody] = useState(initialData?.body || "");
  const [status, setStatus] = useState<TemplateStatus>(initialData?.status || "active");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [showTestModal, setShowTestModal] = useState(false);

  const [activeTarget, setActiveTarget] = useState<"subject" | "body">("body");
  const [viewMode, setViewMode] = useState<"split" | "edit" | "preview">("split");
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  /**
   * Inserts text at the cursor position of either subject or body.
   */
  const handleInsertVariable = (token: string) => {
    if (activeTarget === "subject") {
      const el = subjectRef.current;
      if (!el) {
        setSubject((prev) => prev + token);
        return;
      }
      const start = el.selectionStart ?? el.value.length;
      const end = el.selectionEnd ?? el.value.length;
      const next = el.value.substring(0, start) + token + el.value.substring(end);
      setSubject(next);
      setTimeout(() => {
        el.focus();
        el.setSelectionRange(start + token.length, start + token.length);
      }, 0);
    } else {
      const el = bodyRef.current;
      if (!el) {
        setBody((prev) => prev + token);
        return;
      }
      const start = el.selectionStart ?? el.value.length;
      const end = el.selectionEnd ?? el.value.length;
      const next = el.value.substring(0, start) + token + el.value.substring(end);
      setBody(next);
      setTimeout(() => {
        el.focus();
        el.setSelectionRange(start + token.length, start + token.length);
      }, 0);
    }
  };

  /**
   * Formatting helper to wrap selected text with HTML tags in the body.
   */
  const applyFormatting = (prefix: string, suffix: string, defaultText: string = "text") => {
    const el = bodyRef.current;
    if (!el) return;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const selected = el.value.substring(start, end) || defaultText;
    const replacement = `${prefix}${selected}${suffix}`;
    const next = el.value.substring(0, start) + replacement + el.value.substring(end);
    setBody(next);
    setTimeout(() => {
      el.focus();
      el.setSelectionRange(start + prefix.length, start + prefix.length + selected.length);
    }, 0);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!name.trim()) {
      setErrorMessage("Please enter a template name.");
      return;
    }
    if (!subject.trim()) {
      setErrorMessage("Please enter an email subject.");
      return;
    }
    if (!body.trim()) {
      setErrorMessage("Please enter email body content.");
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        name: name.trim(),
        subject: subject.trim(),
        body: body.trim(),
        status,
      };

      const url = isEditing && initialData ? `/api/templates/${initialData.id}` : "/api/templates";
      const method = isEditing ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to save template.");
      }

      const savedTemplateId = data.template.id;

      // If there are pending files staged for this template, upload them now
      if (pendingFiles.length > 0) {
        for (const file of pendingFiles) {
          const formData = new FormData();
          formData.append("file", file);
          formData.append("template_id", savedTemplateId);
          try {
            await fetch("/api/attachments", {
              method: "POST",
              body: formData,
            });
          } catch {
            // Non-blocking upload error; template record was safely created
          }
        }
      }

      router.push(`/templates/${savedTemplateId}`);
      router.refresh();
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : "An unexpected error occurred.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSave} className="space-y-6">
      {/* Top Bar Controls */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-slate-200 pb-4 dark:border-slate-800">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            {isEditing ? `Edit Template: ${initialData?.name}` : "Create Email Template"}
          </h1>
          <p className="mt-0.5 text-xs sm:text-sm text-slate-500">
            Define reusable templates with dynamic recipient personalization tags.
          </p>
        </div>

        {/* View Mode Switcher */}
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-slate-200 bg-slate-100 p-0.5 dark:border-slate-800 dark:bg-slate-900">
            <button
              type="button"
              onClick={() => setViewMode("edit")}
              className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors ${
                viewMode === "edit"
                  ? "bg-white text-slate-900 shadow-2xs dark:bg-slate-800 dark:text-white"
                  : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
              }`}
            >
              Editor Only
            </button>
            <button
              type="button"
              onClick={() => setViewMode("split")}
              className={`hidden lg:inline-block px-3 py-1 text-xs font-semibold rounded-md transition-colors ${
                viewMode === "split"
                  ? "bg-white text-slate-900 shadow-2xs dark:bg-slate-800 dark:text-white"
                  : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
              }`}
            >
              Split View
            </button>
            <button
              type="button"
              onClick={() => setViewMode("preview")}
              className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors ${
                viewMode === "preview"
                  ? "bg-white text-slate-900 shadow-2xs dark:bg-slate-800 dark:text-white"
                  : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
              }`}
            >
              Preview Only
            </button>
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setShowTestModal(true)}
            disabled={submitting}
            className="flex items-center gap-1.5"
            title="Send real test email with attachments"
          >
            <span>✈</span>
            <span>Send Test</span>
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => router.back()}
            disabled={submitting}
          >
            Cancel
          </Button>

          <Button type="submit" size="sm" disabled={submitting}>
            {submitting ? "Saving..." : isEditing ? "Update Template" : "Save Template"}
          </Button>
        </div>
      </div>

      {/* Error Alert */}
      {errorMessage && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-300">
          <div className="flex items-center gap-2">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-5 w-5 text-rose-600 shrink-0"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z"
                clipRule="evenodd"
              />
            </svg>
            <span className="font-semibold">{errorMessage}</span>
          </div>
        </div>
      )}

      {/* Main Grid */}
      <div
        className={`grid gap-6 ${
          viewMode === "split"
            ? "lg:grid-cols-2"
            : viewMode === "preview"
            ? "grid-cols-1 max-w-3xl mx-auto"
            : "grid-cols-1"
        }`}
      >
        {/* Editor Column */}
        {viewMode !== "preview" && (
          <div className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
            {/* Template Name & Status */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Template Name <span className="text-rose-500">*</span>
                </label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Initial Outreach Sequence #1"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Status
                </label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as TemplateStatus)}
                  className="w-full h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-blue-500 focus:outline-hidden focus:ring-1 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-850 dark:text-white"
                >
                  <option value="active">Active</option>
                  <option value="draft">Draft</option>
                  <option value="archived">Archived</option>
                </select>
              </div>
            </div>

            {/* Subject Input with Target Selector */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Subject Line <span className="text-rose-500">*</span>
                </label>
                <button
                  type="button"
                  onClick={() => setActiveTarget("subject")}
                  className={`text-[11px] font-semibold transition-colors ${
                    activeTarget === "subject"
                      ? "text-blue-600 underline dark:text-blue-400"
                      : "text-slate-400 hover:text-slate-600"
                  }`}
                >
                  {activeTarget === "subject" ? "✓ Targeting Subject" : "Click to target Subject"}
                </button>
              </div>
              <Input
                ref={subjectRef}
                value={subject}
                onFocus={() => setActiveTarget("subject")}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="e.g. Quick question for {{company_name}}"
                required
              />
            </div>

            {/* Dynamic Variable Picker */}
            <VariablePicker
              onInsert={handleInsertVariable}
              targetFieldLabel={activeTarget === "subject" ? "Subject" : "Body"}
            />

            {/* Formatting Toolbar */}
            <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50/60 p-1.5 dark:border-slate-800 dark:bg-slate-850">
              <span className="text-[10px] font-semibold text-slate-400 uppercase px-2">
                Format:
              </span>
              <button
                type="button"
                onClick={() => applyFormatting("<b>", "</b>", "bold text")}
                className="rounded px-2 py-1 text-xs font-bold text-slate-700 hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-750 transition-colors"
                title="Bold"
              >
                B
              </button>
              <button
                type="button"
                onClick={() => applyFormatting("<i>", "</i>", "italic text")}
                className="rounded px-2 py-1 text-xs italic font-serif text-slate-700 hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-750 transition-colors"
                title="Italic"
              >
                I
              </button>
              <button
                type="button"
                onClick={() => applyFormatting("<u>", "</u>", "underlined text")}
                className="rounded px-2 py-1 text-xs underline text-slate-700 hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-750 transition-colors"
                title="Underline"
              >
                U
              </button>
              <button
                type="button"
                onClick={() => applyFormatting('<a href="https://example.test">', "</a>", "link text")}
                className="rounded px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/40 transition-colors"
                title="Link"
              >
                Link
              </button>
              <button
                type="button"
                onClick={() => applyFormatting("<ul>\n  <li>", "</li>\n</ul>", "List item")}
                className="rounded px-2 py-1 text-xs text-slate-700 hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-750 transition-colors"
                title="Bullet List"
              >
                • List
              </button>
              <button
                type="button"
                onClick={() => applyFormatting("<ol>\n  <li>", "</li>\n</ol>", "Step 1")}
                className="rounded px-2 py-1 text-xs text-slate-700 hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-750 transition-colors"
                title="Numbered List"
              >
                1. List
              </button>
              <button
                type="button"
                onClick={() => applyFormatting("<p>", "</p>", "paragraph")}
                className="rounded px-2 py-1 text-xs text-slate-700 hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-750 transition-colors"
                title="Paragraph"
              >
                &para; P
              </button>
            </div>

            {/* Email Body Textarea */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Email Body (supports rich HTML & variables) <span className="text-rose-500">*</span>
                </label>
                <button
                  type="button"
                  onClick={() => setActiveTarget("body")}
                  className={`text-[11px] font-semibold transition-colors ${
                    activeTarget === "body"
                      ? "text-blue-600 underline dark:text-blue-400"
                      : "text-slate-400 hover:text-slate-600"
                  }`}
                >
                  {activeTarget === "body" ? "✓ Targeting Body" : "Click to target Body"}
                </button>
              </div>
              <textarea
                ref={bodyRef}
                value={body}
                onFocus={() => setActiveTarget("body")}
                onChange={(e) => setBody(e.target.value)}
                rows={12}
                placeholder="Hi {{first_name}},&#10;&#10;I noticed you are working at {{company_name}} as {{job_title}}.&#10;&#10;Best,&#10;{{sender_name}}"
                className="w-full rounded-xl border border-slate-300 bg-white p-3.5 font-mono text-sm leading-relaxed text-slate-900 focus:border-blue-500 focus:outline-hidden focus:ring-1 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                required
              />
              <p className="mt-1.5 text-[11px] text-slate-500">
                Variables like <code className="text-blue-600">{"{{first_name}}"}</code> will be
                dynamically replaced during campaign dispatch.
              </p>
            </div>

            {/* Template File Attachments */}
            <div className="pt-4 border-t border-slate-200 dark:border-slate-800">
              <AttachmentUploader
                templateId={initialData?.id}
                pendingFiles={pendingFiles}
                onAttachmentsChange={setAttachments}
                onPendingFilesChange={setPendingFiles}
              />
            </div>
          </div>
        )}

        {/* Live Preview Column */}
        {viewMode !== "edit" && (
          <div className="h-full">
            <TemplatePreviewPanel
              subject={subject}
              body={body}
              attachments={attachments}
              pendingFiles={pendingFiles}
            />
          </div>
        )}
      </div>

      {/* Test Email Dispatch Modal */}
      <TestEmailModal
        isOpen={showTestModal}
        onClose={() => setShowTestModal(false)}
        templateId={initialData?.id}
        subject={subject}
        body={body}
        attachments={attachments}
        pendingFiles={pendingFiles}
      />
    </form>
  );
}
