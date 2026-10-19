"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { EmailTemplate } from "@/types/database";
import { TemplateEditor } from "./template-editor";
import { TemplatePreviewPanel } from "./template-preview-panel";
import { AttachmentUploader } from "@/components/campaigns/attachment-uploader";
import { TestEmailModal } from "./test-email-modal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Attachment } from "@/types/attachment";

interface TemplateDetailClientProps {
  initialTemplate: EmailTemplate;
}

export function TemplateDetailClient({ initialTemplate }: TemplateDetailClientProps) {
  const router = useRouter();
  const [template, setTemplate] = useState<EmailTemplate>(initialTemplate);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [showTestModal, setShowTestModal] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [notification, setNotification] = useState<{ type: "success" | "error"; text: string } | null>(
    null
  );

  const handleDuplicate = async () => {
    setActionLoading(true);
    try {
      const res = await fetch(`/api/templates/${template.id}/duplicate`, {
        method: "POST",
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setNotification({
          type: "success",
          text: `Template duplicated as "${data.template.name}". Redirecting...`,
        });
        setTimeout(() => {
          router.push(`/templates/${data.template.id}`);
        }, 800);
      } else {
        setNotification({ type: "error", text: data.error || "Failed to duplicate template." });
      }
    } catch {
      setNotification({ type: "error", text: "Network error duplicating template." });
    } finally {
      setActionLoading(false);
    }
  };

  const handleArchive = async () => {
    if (!window.confirm(`Are you sure you want to archive "${template.name}"?`)) {
      return;
    }

    setActionLoading(true);
    try {
      const res = await fetch(`/api/templates/${template.id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setTemplate(data.template);
        setNotification({
          type: "success",
          text: `Template "${template.name}" archived.`,
        });
      } else {
        setNotification({ type: "error", text: data.error || "Failed to archive template." });
      }
    } catch {
      setNotification({ type: "error", text: "Network error archiving template." });
    } finally {
      setActionLoading(false);
    }
  };

  if (isEditing) {
    return <TemplateEditor initialData={template} isEditing={true} />;
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "active":
        return <Badge variant="success">Active</Badge>;
      case "draft":
        return <Badge variant="warning">Draft</Badge>;
      case "archived":
        return <Badge variant="neutral">Archived</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Notifications */}
      {notification && (
        <div
          className={`flex items-center justify-between rounded-xl p-4 text-sm ${
            notification.type === "success"
              ? "border border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-300"
              : "border border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-300"
          }`}
        >
          <span>{notification.text}</span>
          <button
            type="button"
            onClick={() => setNotification(null)}
            className="text-xs font-semibold underline ml-4"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Header & Actions */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-slate-200 pb-4 dark:border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <Link
              href="/templates"
              className="text-xs font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-slate-300 flex items-center gap-1"
            >
              ← Back to Templates
            </Link>
          </div>
          <div className="mt-1 flex items-center gap-3">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              {template.name}
            </h1>
            {getStatusBadge(template.status)}
          </div>
          <p className="mt-0.5 text-xs text-slate-500">
            Last updated: {new Date(template.updated_at).toLocaleString()}
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowTestModal(true)}
            disabled={actionLoading}
            className="flex items-center gap-1.5"
            title="Send real test email with attachments"
          >
            <span>✈</span>
            <span>Send Test</span>
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsEditing(true)}
            disabled={actionLoading}
          >
            Edit Template
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={handleDuplicate}
            disabled={actionLoading}
          >
            Duplicate
          </Button>

          {template.status !== "archived" && (
            <Button
              variant="ghost"
              size="sm"
              className="text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/40"
              onClick={handleArchive}
              disabled={actionLoading}
            >
              Archive
            </Button>
          )}
        </div>
      </div>

      {/* Main Grid: Details + Live Preview */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left Column: Template Information */}
        <div className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Subject Line
            </span>
            <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-white rounded-lg bg-slate-50 p-3 border border-slate-200/80 dark:bg-slate-850 dark:border-slate-800">
              {template.subject}
            </div>
          </div>

          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Personalization Variables ({template.variables.length})
            </span>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {template.variables.length > 0 ? (
                template.variables.map((v) => (
                  <span
                    key={v}
                    className="rounded-md border border-blue-200 bg-blue-50/70 px-2 py-1 font-mono text-xs text-blue-700 dark:border-blue-900/40 dark:bg-blue-950/40 dark:text-blue-300"
                  >
                    {`{{${v}}}`}
                  </span>
                ))
              ) : (
                <span className="text-xs text-slate-400 italic">No dynamic variables detected</span>
              )}
            </div>
          </div>

          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Raw Stored Body
            </span>
            <pre className="mt-1 max-h-80 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-3.5 font-mono text-xs text-slate-800 whitespace-pre-wrap dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
              {template.body}
            </pre>
          </div>

          <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
            <AttachmentUploader
              templateId={template.id}
              readonly={true}
              onAttachmentsChange={setAttachments}
            />
          </div>
        </div>

        {/* Right Column: Live Simulated Preview */}
        <div>
          <TemplatePreviewPanel
            subject={template.subject}
            body={template.body}
            attachments={attachments}
          />
        </div>
      </div>

      {/* Send Test Email Modal */}
      <TestEmailModal
        isOpen={showTestModal}
        onClose={() => setShowTestModal(false)}
        templateId={template.id}
        subject={template.subject}
        body={template.body}
        attachments={attachments}
      />
    </div>
  );
}
