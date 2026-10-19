"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { Attachment } from "@/types/database";

export function AttachmentsManager() {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchAttachments = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/attachments?limit=100");
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setAttachments(data.attachments || []);
        }
      }
    } catch {} finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let ignore = false;
    async function load() {
      try {
        const res = await fetch("/api/attachments?limit=100");
        if (res.ok) {
          const data = await res.json();
          if (!ignore && data.success) {
            setAttachments(data.attachments || []);
          }
        }
      } catch {} finally {
        if (!ignore) setLoading(false);
      }
    }
    load();
    return () => {
      ignore = true;
    };
  }, []);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploading(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    let count = 0;
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
        if (data.success) {
          count++;
        } else {
          setErrorMessage(data.error || `Failed to upload ${file.name}`);
        }
      } catch {
        setErrorMessage(`Failed to upload ${file.name}`);
      }
    }

    if (count > 0) {
      setSuccessMessage(`Successfully uploaded ${count} file${count > 1 ? "s" : ""}`);
      await fetchAttachments();
    }

    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleDelete(id: string, filename: string) {
    if (!confirm(`Are you sure you want to delete ${filename}?`)) return;

    try {
      const res = await fetch(`/api/attachments/${id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (data.success) {
        setAttachments((prev) => prev.filter((a) => a.id !== id));
        setSuccessMessage(`Deleted ${filename}`);
      } else {
        setErrorMessage(data.error || "Failed to delete attachment");
      }
    } catch {
      setErrorMessage("Failed to delete attachment");
    }
  }

  function getFileIcon(mime: string) {
    if (mime.includes("pdf")) {
      return (
        <span className="p-2 rounded-lg bg-rose-50 text-rose-600 dark:bg-rose-950 dark:text-rose-400 font-bold text-[10px]">
          PDF
        </span>
      );
    }
    if (mime.includes("image")) {
      return (
        <span className="p-2 rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400 font-bold text-[10px]">
          IMG
        </span>
      );
    }
    if (mime.includes("sheet") || mime.includes("csv") || mime.includes("excel")) {
      return (
        <span className="p-2 rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400 font-bold text-[10px]">
          XLS
        </span>
      );
    }
    if (mime.includes("word") || mime.includes("document")) {
      return (
        <span className="p-2 rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-400 font-bold text-[10px]">
          DOC
        </span>
      );
    }
    return (
      <span className="p-2 rounded-lg bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 font-bold text-[10px]">
        FILE
      </span>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-white rounded-2xl border border-slate-200 dark:bg-slate-900 dark:border-slate-800 shadow-sm overflow-hidden min-h-[600px]">
      {/* Header & Upload Button */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between p-4 border-b border-slate-200 dark:border-slate-800 gap-3">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <span>Attachment Library</span>
            <span className="text-xs font-normal text-slate-500">
              ({attachments.length} files)
            </span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Supported: PDF, DOCX, XLSX, CSV, Images (PNG, JPG, WEBP, GIF), ZIP
          </p>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleUpload}
            multiple
            className="hidden"
            accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.png,.jpg,.jpeg,.gif,.webp,.zip"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-sm transition-colors disabled:opacity-60"
          >
            {uploading ? (
              <>
                <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
                <span>Uploading...</span>
              </>
            ) : (
              <>
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" x2="12" y1="3" y2="15" />
                </svg>
                <span>Upload Files</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Alerts */}
      {errorMessage && (
        <div className="m-4 p-3 rounded-lg bg-rose-50 text-rose-700 border border-rose-200 text-xs dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800">
          {errorMessage}
        </div>
      )}
      {successMessage && (
        <div className="m-4 p-3 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800">
          {successMessage}
        </div>
      )}

      {/* Files Table */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-12 text-center text-xs text-slate-500">
            Loading attachments...
          </div>
        ) : attachments.length === 0 ? (
          <div className="p-16 text-center text-xs text-slate-400">
            No attachments uploaded yet. Files attached to campaign steps, templates, or composed emails will appear here.
          </div>
        ) : (
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500 border-b border-slate-200 dark:bg-slate-800/50 dark:border-slate-800">
              <tr>
                <th className="px-4 py-3 font-semibold">File</th>
                <th className="px-4 py-3 font-semibold">MIME Type</th>
                <th className="px-4 py-3 font-semibold">Size</th>
                <th className="px-4 py-3 font-semibold">Uploaded</th>
                <th className="px-4 py-3 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {attachments.map((att) => (
                <tr key={att.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      {getFileIcon(att.mime_type)}
                      <div>
                        <span className="font-semibold text-slate-800 dark:text-slate-100 block">
                          {att.original_filename || att.filename}
                        </span>
                        <span className="text-[10px] text-slate-400">
                          ID: {att.id.slice(0, 8)}...
                        </span>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300 font-mono text-[11px]">
                    {att.mime_type}
                  </td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                    {Math.round(att.file_size / 1024)} KB
                  </td>
                  <td className="px-4 py-3 text-slate-500">
                    {new Date(att.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex items-center gap-2">
                      <a
                        href={`/api/attachments/${att.id}/download`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-2.5 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 font-medium transition-colors"
                        title="Download file"
                      >
                        Download
                      </a>
                      <button
                        type="button"
                        onClick={() => handleDelete(att.id, att.original_filename || att.filename)}
                        className="p-1 text-slate-400 hover:text-rose-600 transition-colors"
                        title="Delete attachment"
                      >
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M3 6h18" />
                          <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                          <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                        </svg>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
