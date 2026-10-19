"use client";

import React, { useState, useRef, useEffect } from "react";
import { Attachment } from "@/types/attachment";
import { Button } from "@/components/ui/button";

interface AttachmentUploaderProps {
  campaignId?: string;
  stepId?: string;
  templateId?: string;
  initialAttachments?: Attachment[];
  pendingFiles?: File[];
  onAttachmentsChange?: (attachments: Attachment[]) => void;
  onPendingFilesChange?: (files: File[]) => void;
  readonly?: boolean;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileIcon(category?: string, mimeType?: string) {
  if (category === "image" || mimeType?.startsWith("image/")) {
    return (
      <svg className="w-5 h-5 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    );
  }
  if (category === "video" || mimeType?.startsWith("video/")) {
    return (
      <svg className="w-5 h-5 text-rose-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
      </svg>
    );
  }
  if (category === "spreadsheet" || mimeType?.includes("sheet") || mimeType?.includes("csv")) {
    return (
      <svg className="w-5 h-5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    );
  }
  if (category === "archive" || mimeType?.includes("zip")) {
    return (
      <svg className="w-5 h-5 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
      </svg>
    );
  }
  // Document default
  return (
    <svg className="w-5 h-5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
    </svg>
  );
}

export function AttachmentUploader({
  campaignId,
  stepId,
  templateId,
  initialAttachments = [],
  pendingFiles: controlledPendingFiles,
  onAttachmentsChange,
  onPendingFilesChange,
  readonly = false,
}: AttachmentUploaderProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [attachments, setAttachments] = useState<Attachment[]>(initialAttachments);
  const [internalPendingFiles, setInternalPendingFiles] = useState<File[]>([]);
  const pendingFiles = controlledPendingFiles !== undefined ? controlledPendingFiles : internalPendingFiles;
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const updatePendingFiles = (files: File[]) => {
    if (controlledPendingFiles === undefined) {
      setInternalPendingFiles(files);
    }
    onPendingFilesChange?.(files);
  };

  // Load existing attachments for step or template
  useEffect(() => {
    let ignore = false;
    async function load() {
      if (initialAttachments.length > 0) return;

      try {
        let url: string | null = null;
        if (templateId) {
          url = `/api/templates/${templateId}/attachments`;
        } else if (campaignId && stepId) {
          url = `/api/campaigns/${campaignId}/steps/${stepId}/attachments`;
        } else if (stepId) {
          url = `/api/attachments?step_id=${stepId}`;
        }

        if (!url) return;

        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          if (!ignore && data.attachments) {
            setAttachments(data.attachments);
            onAttachmentsChange?.(data.attachments);
          }
        }
      } catch {
        // ignore load errors
      }
    }

    load();
    return () => {
      ignore = true;
    };
  }, [campaignId, stepId, templateId, initialAttachments.length, onAttachmentsChange]);

  const uploadedSize = attachments.reduce((sum, att) => sum + (att.file_size || 0), 0);
  const pendingSize = pendingFiles.reduce((sum, f) => sum + f.size, 0);
  const totalSize = uploadedSize + pendingSize;
  const totalCount = attachments.length + pendingFiles.length;

  const MAX_TOTAL_SIZE = 25 * 1024 * 1024; // 25 MB
  const isNearLimit = totalSize > 20 * 1024 * 1024;
  const isOverLimit = totalSize > MAX_TOTAL_SIZE;

  // Staging mode is active if there is neither a saved templateId nor a campaign stepId
  const isStagingMode = !templateId && (!campaignId || !stepId);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0 || readonly) return;

    setUploadError(null);
    const errors: string[] = [];

    // If staging mode on /templates/new: stage local files
    if (isStagingMode) {
      const validPending: File[] = [];
      let runningSize = totalSize;

      for (let i = 0; i < files.length; i++) {
        const file = files[i];

        if (file.size > 10 * 1024 * 1024) {
          errors.push(`"${file.name}" exceeds 10 MB limit (${formatFileSize(file.size)}).`);
          continue;
        }

        if (runningSize + file.size > MAX_TOTAL_SIZE) {
          errors.push(`Adding "${file.name}" would exceed 25 MB total attachment limit.`);
          continue;
        }

        // Avoid adding duplicate file names
        const duplicate =
          pendingFiles.some((p) => p.name === file.name && p.size === file.size) ||
          attachments.some((a) => a.original_filename === file.name);

        if (!duplicate) {
          validPending.push(file);
          runningSize += file.size;
        }
      }

      if (errors.length > 0) {
        setUploadError(errors.join(" "));
      }

      if (validPending.length > 0) {
        const updated = [...pendingFiles, ...validPending];
        updatePendingFiles(updated);
      }

      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      return;
    }

    // Direct Upload Mode (templateId or campaignId/stepId present)
    setIsUploading(true);
    const uploadedNew: Attachment[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      if (file.size > 10 * 1024 * 1024) {
        errors.push(`"${file.name}" exceeds 10 MB limit (${formatFileSize(file.size)}).`);
        continue;
      }

      if (totalSize + file.size > MAX_TOTAL_SIZE) {
        errors.push(`Adding "${file.name}" would exceed 25 MB total attachment limit.`);
        continue;
      }

      const formData = new FormData();
      formData.append("file", file);
      if (templateId) formData.append("template_id", templateId);
      if (campaignId) formData.append("campaign_id", campaignId);
      if (stepId) formData.append("step_id", stepId);

      try {
        const res = await fetch("/api/attachments", {
          method: "POST",
          body: formData,
        });

        const data = await res.json();
        if (!res.ok || !data.success) {
          errors.push(data.error || `Failed to upload "${file.name}".`);
        } else if (data.attachment) {
          uploadedNew.push(data.attachment);
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Network error";
        errors.push(`Failed to upload "${file.name}": ${message}`);
      }
    }

    if (errors.length > 0) {
      setUploadError(errors.join(" "));
    }

    if (uploadedNew.length > 0) {
      const updated = [...attachments, ...uploadedNew];
      setAttachments(updated);
      onAttachmentsChange?.(updated);
    }

    setIsUploading(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleRemoveUploaded = async (attachment: Attachment) => {
    if (readonly) return;
    setUploadError(null);

    try {
      if (templateId) {
        // Detach from template
        const res = await fetch(
          `/api/templates/${templateId}/attachments?attachment_id=${attachment.id}`,
          { method: "DELETE" }
        );
        if (!res.ok) {
          const data = await res.json();
          setUploadError(data.error || "Failed to remove attachment from template.");
          return;
        }
      } else if (stepId && campaignId) {
        // Detach from step
        const res = await fetch(
          `/api/campaigns/${campaignId}/steps/${stepId}/attachments?attachment_id=${attachment.id}`,
          { method: "DELETE" }
        );
        if (!res.ok) {
          const data = await res.json();
          setUploadError(data.error || "Failed to remove attachment from step.");
          return;
        }
      } else {
        // Delete attachment
        const res = await fetch(`/api/attachments/${attachment.id}`, { method: "DELETE" });
        if (!res.ok) {
          const data = await res.json();
          setUploadError(data.error || "Failed to delete attachment.");
          return;
        }
      }

      const updated = attachments.filter((a) => a.id !== attachment.id);
      setAttachments(updated);
      onAttachmentsChange?.(updated);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to remove attachment";
      setUploadError(message);
    }
  };

  const handleRemovePending = (index: number) => {
    if (readonly) return;
    const updated = pendingFiles.filter((_, i) => i !== index);
    updatePendingFiles(updated);
  };

  return (
    <div className="space-y-3">
      {/* Upload Header & Action */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 block">
            File Attachments ({totalCount})
          </span>
          <span className="text-[11px] text-slate-400">
            Images (JPG/PNG/WEBP/GIF), Documents (PDF/DOCX/TXT), Spreadsheets (XLSX/CSV), Videos (MP4), Archives (ZIP).
          </span>
        </div>

        {!readonly && (
          <div>
            <input
              type="file"
              ref={fileInputRef}
              multiple
              className="hidden"
              onChange={(e) => handleFiles(e.target.files)}
              accept=".jpg,.jpeg,.png,.webp,.gif,.pdf,.doc,.docx,.txt,.xls,.xlsx,.csv,.mp4,.mov,.webm,.zip"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isUploading || isOverLimit}
              onClick={() => fileInputRef.current?.click()}
              className="text-xs flex items-center gap-1.5"
            >
              {isUploading ? (
                <>
                  <span className="animate-spin text-blue-600">⟳</span>
                  <span>Uploading...</span>
                </>
              ) : (
                <>
                  <span>📎</span>
                  <span>Attach Files</span>
                </>
              )}
            </Button>
          </div>
        )}
      </div>

      {/* Drag & Drop Zone */}
      {!readonly && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            handleFiles(e.dataTransfer.files);
          }}
          onClick={() => fileInputRef.current?.click()}
          className={`p-3 border-2 border-dashed rounded-lg text-center cursor-pointer transition-colors ${
            isDragging
              ? "border-blue-500 bg-blue-50/50 dark:bg-blue-950/20"
              : "border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700"
          }`}
        >
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Drag & drop files here or <span className="text-blue-600 font-medium">browse</span> (max 10MB each, 25MB total)
          </p>
        </div>
      )}

      {/* Error Banner with Retry */}
      {uploadError && (
        <div className="p-2.5 rounded-md bg-rose-50 border border-rose-200 dark:bg-rose-950/30 dark:border-rose-900/50 text-xs text-rose-700 dark:text-rose-300 flex items-start justify-between gap-2">
          <span>⚠ {uploadError}</span>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="text-[11px] underline font-semibold hover:text-rose-900 shrink-0"
          >
            Retry
          </button>
        </div>
      )}

      {/* Attachment Cards List (Pending + Uploaded) */}
      {(attachments.length > 0 || pendingFiles.length > 0) && (
        <div className="space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {/* 1. Staged / Pending Local Files */}
            {pendingFiles.map((file, idx) => {
              const isImage = file.type.startsWith("image/");
              const objectUrl = isImage ? URL.createObjectURL(file) : null;

              return (
                <div
                  key={`pending-${idx}-${file.name}`}
                  className="p-2.5 rounded-lg border border-dashed border-blue-300 dark:border-blue-800 bg-blue-50/30 dark:bg-blue-950/20 flex items-center justify-between gap-2.5 shadow-2xs"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="h-9 w-9 rounded-md bg-white dark:bg-slate-800 flex items-center justify-center shrink-0 overflow-hidden border border-blue-200 dark:border-blue-900">
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
                        getFileIcon(undefined, file.type)
                      )}
                    </div>

                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate" title={file.name}>
                        {file.name}
                      </p>
                      <p className="text-[10px] text-blue-600 dark:text-blue-400 font-mono">
                        {formatFileSize(file.size)} • Ready to upload on save
                      </p>
                    </div>
                  </div>

                  {!readonly && (
                    <button
                      type="button"
                      onClick={() => handleRemovePending(idx)}
                      className="p-1 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors"
                      title="Remove file"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
              );
            })}

            {/* 2. Uploaded Attachments */}
            {attachments.map((att) => {
              const isImage = att.mime_type?.startsWith("image/");
              const category = (att.metadata as { category?: string })?.category;

              return (
                <div
                  key={att.id}
                  className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center justify-between gap-2.5 shadow-2xs"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="h-9 w-9 rounded-md bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0 overflow-hidden border border-slate-200/60 dark:border-slate-700/60">
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
                        getFileIcon(category, att.mime_type)
                      )}
                    </div>

                    <div className="min-w-0">
                      <p
                        className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate"
                        title={att.original_filename || att.filename}
                      >
                        {att.original_filename || att.filename}
                      </p>
                      <p className="text-[10px] text-slate-400 font-mono">
                        {formatFileSize(att.file_size)} • {att.mime_type?.split("/")[1]?.toUpperCase() || "FILE"}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <a
                      href={`/api/attachments/${att.id}/download`}
                      download={att.original_filename}
                      className="p-1 rounded text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                      title="Download file"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                    </a>

                    {!readonly && (
                      <button
                        type="button"
                        onClick={() => handleRemoveUploaded(att)}
                        className="p-1 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors"
                        title="Remove attachment"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Total Size Indicator */}
          <div className="flex items-center justify-between text-[11px] pt-1 px-1">
            <span className="text-slate-500">
              Total attached: <strong className={isOverLimit ? "text-rose-600" : isNearLimit ? "text-amber-600" : "text-slate-700 dark:text-slate-300"}>{formatFileSize(totalSize)}</strong> / 25 MB max
            </span>
            {isNearLimit && !isOverLimit && (
              <span className="text-amber-600 font-medium">⚠ Approaching provider 25MB ceiling</span>
            )}
            {isOverLimit && (
              <span className="text-rose-600 font-bold">⛔ Exceeds 25MB limit</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
