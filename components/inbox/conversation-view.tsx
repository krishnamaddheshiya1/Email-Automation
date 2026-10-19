"use client";

import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConversationDetail, ConversationMessage } from "@/types/database";

interface ConversationViewProps {
  conversationId: string;
  onBack: () => void;
  onRefresh: () => void;
}

export function ConversationView({
  conversationId,
  onBack,
  onRefresh,
}: ConversationViewProps) {
  const [conversation, setConversation] = useState<ConversationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Reply Composer State
  const [isReplying, setIsReplying] = useState(false);
  const [replyBody, setReplyBody] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  // Staged Files for Reply
  const [stagedFiles, setStagedFiles] = useState<File[]>([]);
  const [uploadedAttachmentIds, setUploadedAttachmentIds] = useState<string[]>([]);
  const [uploadingFiles, setUploadingFiles] = useState(false);

  useEffect(() => {
    let ignore = false;
    async function load(isSilent = false) {
      if (!isSilent) setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/conversations/${conversationId}`);
        const json = await res.json();
        if (!ignore) {
          if (res.ok && json.success) {
            setConversation(json.data);
          } else if (!isSilent) {
            setError(json.error || "Failed to load conversation details.");
          }
        }
      } catch {
        if (!ignore && !isSilent) setError("Network error loading conversation.");
      } finally {
        if (!ignore && !isSilent) setLoading(false);
      }
    }
    load(false);

    // Live auto-polling every 6s for thread updates
    const interval = setInterval(() => {
      load(true);
    }, 6000);

    return () => {
      ignore = true;
      clearInterval(interval);
    };
  }, [conversationId]);

  const handleMarkUnread = async () => {
    try {
      await fetch(`/api/conversations/${conversationId}/unread`, { method: "POST" });
      onRefresh();
      onBack();
    } catch {}
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    setStagedFiles((prev) => [...prev, ...files]);
    setUploadingFiles(true);
    setSendError(null);

    const ids: string[] = [];
    for (const f of files) {
      try {
        const form = new FormData();
        form.append("file", f);
        const res = await fetch("/api/attachments", {
          method: "POST",
          body: form,
        });
        const json = await res.json();
        if (res.ok && json.success && json.data?.id) {
          ids.push(json.data.id);
        } else {
          setSendError(json.error || `Failed to upload ${f.name}`);
        }
      } catch {
        setSendError(`Failed to upload ${f.name}`);
      }
    }

    setUploadedAttachmentIds((prev) => [...prev, ...ids]);
    setUploadingFiles(false);
  };

  const removeStagedFile = (index: number) => {
    setStagedFiles((prev) => prev.filter((_, i) => i !== index));
    setUploadedAttachmentIds((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSendReply = async () => {
    if (!replyBody.trim()) {
      setSendError("Please type a message before sending.");
      return;
    }

    setSending(true);
    setSendError(null);

    try {
      const res = await fetch(`/api/conversations/${conversationId}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body: replyBody.trim(),
          attachmentIds: uploadedAttachmentIds.length > 0 ? uploadedAttachmentIds : undefined,
        }),
      });

      const json = await res.json();
      if (res.ok && json.success) {
        setReplyBody("");
        setStagedFiles([]);
        setUploadedAttachmentIds([]);
        setIsReplying(false);

        // Reload conversation messages
        const refreshRes = await fetch(`/api/conversations/${conversationId}`);
        const refreshJson = await refreshRes.json();
        if (refreshRes.ok && refreshJson.success) {
          setConversation(refreshJson.data);
        }
        onRefresh();
      } else {
        setSendError(json.error || "Failed to dispatch email reply.");
      }
    } catch {
      setSendError("Network error sending reply.");
    } finally {
      setSending(false);
    }
  };

  const formatTimestamp = (dateStr?: string | null) => {
    if (!dateStr) return "";
    const d = new Date(dateStr);
    return d.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  };

  if (loading) {
    return (
      <div className="p-8 space-y-4">
        <div className="h-6 w-32 bg-slate-100 rounded animate-pulse dark:bg-slate-800" />
        <div className="h-10 w-3/4 bg-slate-100 rounded animate-pulse dark:bg-slate-800" />
        <div className="h-48 bg-slate-100 rounded-xl animate-pulse dark:bg-slate-800" />
      </div>
    );
  }

  if (error || !conversation) {
    return (
      <div className="p-8 text-center space-y-4">
        <div className="text-sm font-semibold text-red-600 dark:text-red-400">
          {error || "Conversation not found."}
        </div>
        <Button variant="outline" size="sm" onClick={onBack}>
          ← Back to Inbox
        </Button>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800">
      {/* Top Action Bar */}
      <div className="flex items-center justify-between px-4 sm:px-6 py-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/20">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-200/60 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-slate-800 transition-colors"
            title="Back to inbox"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
          </button>
          <span className="text-xs font-medium text-slate-500">Thread History</span>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleMarkUnread} className="text-xs h-8">
            Mark as Unread
          </Button>
        </div>
      </div>

      {/* Conversation Header */}
      <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white">
            {conversation.subject || "No Subject"}
          </h1>
          {conversation.campaign_name && (
            <Badge variant="neutral" className="text-xs bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
              Campaign: {conversation.campaign_name}
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          <span className="font-semibold text-slate-800 dark:text-slate-200">
            {conversation.contact_name}
          </span>
          <span>&lt;{conversation.contact_email}&gt;</span>
        </div>
      </div>

      {/* Messages Thread (Chronological) */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 min-h-[300px]">
        {conversation.messages.map((msg: ConversationMessage, idx: number) => {
          const isOutbound = msg.direction === "OUTBOUND";
          return (
            <div
              key={msg.id || idx}
              className={`rounded-xl border p-4 sm:p-5 transition-shadow ${
                isOutbound
                  ? "bg-slate-50/70 border-slate-200/90 dark:bg-slate-850/60 dark:border-slate-800"
                  : "bg-white border-blue-200/80 shadow-sm dark:bg-slate-900 dark:border-blue-900/40"
              }`}
            >
              {/* Message Header */}
              <div className="flex items-start justify-between gap-4 mb-3">
                <div className="flex items-center gap-3">
                  <div
                    className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-xs uppercase text-white shadow-sm shrink-0 ${
                      isOutbound ? "bg-slate-600" : "bg-blue-600"
                    }`}
                  >
                    {isOutbound ? "You" : conversation.contact_name.charAt(0) || "U"}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-slate-900 dark:text-white">
                        {isOutbound ? "YOU" : conversation.contact_name}
                      </span>
                      <span className="text-xs text-slate-400">
                        {isOutbound ? msg.sender_email : `<${msg.sender_email}>`}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-400">
                      to {msg.recipient_email}
                    </div>
                  </div>
                </div>

                <div className="text-xs text-slate-400 shrink-0 font-medium">
                  {formatTimestamp(msg.received_at || msg.created_at)}
                </div>
              </div>

              {/* Message Body */}
              <div className="text-sm text-slate-800 dark:text-slate-200 whitespace-pre-wrap leading-relaxed pl-12">
                {msg.body_text || (msg.body_html ? msg.body_html.replace(/<[^>]+>/g, " ") : "(No message body content)")}
              </div>

              {/* Message Attachments */}
              {msg.attachments && msg.attachments.length > 0 && (
                <div className="mt-4 pl-12 pt-3 border-t border-slate-200/60 dark:border-slate-800/60">
                  <div className="text-xs font-semibold text-slate-500 mb-2 flex items-center gap-1.5">
                    <span>📎</span>
                    <span>{msg.attachments.length} Attachment{msg.attachments.length > 1 ? "s" : ""}</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {msg.attachments.map((att, aIdx) => (
                      <div
                        key={att.id || aIdx}
                        className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950 text-xs text-slate-700 dark:text-slate-300"
                      >
                        <span className="text-slate-400">📄</span>
                        <span className="font-medium truncate max-w-[200px]">{att.filename}</span>
                        {att.file_size !== undefined && (
                          <span className="text-[10px] text-slate-400">
                            ({Math.round(att.file_size / 1024)} KB)
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {/* Reply Section */}
        <div className="pt-2">
          {!isReplying ? (
            <div
              onClick={() => setIsReplying(true)}
              className="flex items-center gap-3 p-4 rounded-xl border border-slate-200 bg-slate-50 text-slate-500 hover:border-blue-400 hover:bg-white hover:text-slate-700 cursor-text transition-all dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-400 dark:hover:bg-slate-900"
            >
              <div className="w-8 h-8 rounded-full bg-slate-200 dark:bg-slate-800 flex items-center justify-center font-bold text-xs text-slate-600 dark:text-slate-300">
                You
              </div>
              <span className="text-sm font-medium">
                Write a reply to {conversation.contact_name}...
              </span>
            </div>
          ) : (
            <div className="rounded-xl border border-blue-300 bg-white shadow-md p-4 sm:p-5 dark:border-blue-800 dark:bg-slate-900 space-y-4">
              <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
                <div className="text-xs text-slate-500">
                  Replying to <span className="font-semibold text-slate-800 dark:text-slate-200">{conversation.contact_email}</span>
                </div>
                <button
                  onClick={() => setIsReplying(false)}
                  className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                >
                  ✕
                </button>
              </div>

              {sendError && (
                <div className="p-3 rounded-lg bg-red-50 text-red-700 text-xs border border-red-200 dark:bg-red-950/50 dark:border-red-900 dark:text-red-300">
                  {sendError}
                </div>
              )}

              <textarea
                rows={5}
                value={replyBody}
                onChange={(e) => setReplyBody(e.target.value)}
                placeholder="Type your reply message here..."
                className="w-full text-sm text-slate-900 dark:text-white bg-transparent outline-none resize-none placeholder:text-slate-400"
                autoFocus
              />

              {/* Staged Attachments */}
              {stagedFiles.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                  {stagedFiles.map((file, idx) => (
                    <div
                      key={idx}
                      className="flex items-center gap-2 px-2.5 py-1 rounded bg-slate-100 dark:bg-slate-800 text-xs text-slate-700 dark:text-slate-300"
                    >
                      <span>📎</span>
                      <span className="truncate max-w-[150px]">{file.name}</span>
                      <button
                        onClick={() => removeStagedFile(idx)}
                        className="text-slate-400 hover:text-red-500"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                  {uploadingFiles && (
                    <span className="text-xs text-blue-600 animate-pulse">Uploading...</span>
                  )}
                </div>
              )}

              {/* Reply Controls */}
              <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800">
                <div className="flex items-center gap-2">
                  <label className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-xs font-medium text-slate-600 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800 transition-colors">
                    <span>📎</span>
                    <span>Attach Files</span>
                    <input
                      type="file"
                      multiple
                      className="hidden"
                      onChange={handleFileSelect}
                      disabled={uploadingFiles || sending}
                    />
                  </label>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setIsReplying(false);
                      setReplyBody("");
                      setStagedFiles([]);
                    }}
                    disabled={sending}
                  >
                    Discard
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={handleSendReply}
                    disabled={sending || uploadingFiles || !replyBody.trim()}
                    className="bg-blue-600 hover:bg-blue-700 text-white gap-1.5"
                  >
                    {sending ? (
                      <span>Sending...</span>
                    ) : (
                      <>
                        <span>Send</span>
                        <span>➤</span>
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
