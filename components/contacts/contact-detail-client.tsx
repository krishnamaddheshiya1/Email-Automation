"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Lead, ContactEmailHistoryItem, ConversationListItem } from "@/types/database";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { EditContactModal } from "./edit-contact-modal";
import { EmailMessageDetailModal } from "@/components/campaigns/email-message-detail-modal";

import { ConfirmationModal } from "@/components/ui/confirmation-modal";

interface ContactDetailClientProps {
  initialContact: Lead;
}

interface ContactCampaignEnrollment {
  id: string;
  campaign_id: string;
  campaign_name: string;
  status: string;
  current_step: number | null;
  enrolled_at: string;
  completed_at: string | null;
}

export function ContactDetailClient({ initialContact }: ContactDetailClientProps) {
  const router = useRouter();
  const [contact, setContact] = useState<Lead>(initialContact);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [suppressionInfo, setSuppressionInfo] = useState<{ isSuppressed: boolean; reason?: string } | null>(null);

  // Campaign enrollments state
  const [campaigns, setCampaigns] = useState<ContactCampaignEnrollment[]>([]);
  const [campaignsLoading, setCampaignsLoading] = useState(true);

  // Conversation and reply history state
  const [conversations, setConversations] = useState<ConversationListItem[]>([]);
  const [conversationsLoading, setConversationsLoading] = useState(true);

  // Email dispatch history state
  const [emailHistory, setEmailHistory] = useState<ContactEmailHistoryItem[]>([]);
  const [emailLoading, setEmailLoading] = useState(true);
  const [emailPage, setEmailPage] = useState(1);
  const [emailTotalPages, setEmailTotalPages] = useState(1);
  const [emailTotal, setEmailTotal] = useState(0);
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);

  React.useEffect(() => {
    let ignore = false;
    async function loadCampaigns() {
      try {
        const res = await fetch(`/api/contacts/${contact.id}/campaigns`);
        const data = await res.json();
        if (!ignore && data.success) {
          setCampaigns(data.campaigns || []);
        }
      } catch {
        // Fallback
      } finally {
        if (!ignore) {
          setCampaignsLoading(false);
        }
      }
    }
    loadCampaigns();
    return () => {
      ignore = true;
    };
  }, [contact.id]);

  React.useEffect(() => {
    let ignore = false;
    async function loadEmails() {
      try {
        const res = await fetch(`/api/contacts/${contact.id}/emails?page=${emailPage}&limit=10`);
        const data = await res.json();
        if (!ignore && data.success) {
          setEmailHistory(data.emails || []);
          setEmailTotalPages(data.totalPages || 1);
          setEmailTotal(data.total || 0);
        }
      } catch {
        // Fallback
      } finally {
        if (!ignore) {
          setEmailLoading(false);
        }
      }
    }

    loadEmails();
    return () => {
      ignore = true;
    };
  }, [contact.id, emailPage]);

  React.useEffect(() => {
    let ignore = false;
    async function checkSuppression() {
      try {
        const res = await fetch(`/api/suppressions?email=${encodeURIComponent(contact.email)}`);
        const data = await res.json();
        if (!ignore && res.ok && data.success) {
          setSuppressionInfo({
            isSuppressed: Boolean(data.isSuppressed),
            reason: data.suppression?.reason,
          });
        }
      } catch {
        // Fallback
      }
    }
    checkSuppression();
    return () => {
      ignore = true;
    };
  }, [contact.email]);

  React.useEffect(() => {
    let ignore = false;
    async function loadConversations() {
      try {
        const res = await fetch(`/api/contacts/${contact.id}/conversations?limit=10`);
        const data = await res.json();
        if (!ignore && data.success) {
          setConversations(data.conversations || []);
        }
      } catch {
        // Fallback
      } finally {
        if (!ignore) {
          setConversationsLoading(false);
        }
      }
    }
    loadConversations();
    return () => {
      ignore = true;
    };
  }, [contact.id]);

  const fullName =
    [contact.first_name, contact.last_name].filter(Boolean).join(" ") ||
    "Untitled Contact";

  const executeDelete = async () => {
    setDeleteLoading(true);
    try {
      const res = await fetch(`/api/contacts/${contact.id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to delete contact");
      }
      setIsDeleteConfirmOpen(false);
      router.push("/contacts");
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to delete contact");
    } finally {
      setDeleteLoading(false);
    }
  };

  const getEnrollmentStatusBadge = (status: string) => {
    const s = (status || "").toUpperCase();
    switch (s) {
      case "ACTIVE":
      case "ENROLLED":
      case "IN_PROGRESS":
        return (
          <Badge variant="success" className="font-medium">
            ✓ Active
          </Badge>
        );
      case "COMPLETED":
        return (
          <Badge variant="neutral" className="bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300 border-blue-200">
            ✓ Completed
          </Badge>
        );
      case "PAUSED":
        return (
          <Badge variant="warning" className="bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300 border-amber-200">
            ⏸ Paused
          </Badge>
        );
      case "FAILED":
      case "BOUNCED":
        return (
          <Badge variant="warning" className="bg-rose-100 text-rose-800 dark:bg-rose-900/50 dark:text-rose-300 border-rose-200">
            ⤬ Failed
          </Badge>
        );
      case "SUPPRESSED":
        return (
          <Badge variant="outline" className="border-rose-300 text-rose-700 bg-rose-50 text-xs dark:bg-rose-950/40 dark:text-rose-300">
            ⚠ Suppressed
          </Badge>
        );
      default:
        return <Badge variant="neutral">{s}</Badge>;
    }
  };

  const getStatusBadge = (status: string) => {
    const s = status.toUpperCase();
    switch (s) {
      case "NEW":
        return <Badge variant="default">NEW</Badge>;
      case "CONTACTED":
        return <Badge variant="neutral" className="bg-purple-100 text-purple-800 dark:bg-purple-900/50 dark:text-purple-300 border-purple-200">CONTACTED</Badge>;
      case "REPLIED":
        return <Badge variant="neutral" className="bg-cyan-100 text-cyan-800 dark:bg-cyan-900/50 dark:text-cyan-300 border-cyan-200">REPLIED</Badge>;
      case "INTERESTED":
        return <Badge variant="success">INTERESTED</Badge>;
      case "NOT_INTERESTED":
        return <Badge variant="neutral">NOT INTERESTED</Badge>;
      case "SENT":
        return <Badge variant="neutral" className="bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300 border-blue-200">SENT</Badge>;
      case "DELIVERED":
        return <Badge variant="success">DELIVERED</Badge>;
      case "BOUNCED":
        return <Badge variant="warning" className="bg-rose-100 text-rose-800 dark:bg-rose-900/50 dark:text-rose-300 border-rose-200">BOUNCED</Badge>;
      case "COMPLAINED":
        return <Badge variant="warning" className="bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300 border-amber-200">COMPLAINED</Badge>;
      case "FAILED":
        return <Badge variant="warning" className="bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300 border-red-200">FAILED</Badge>;
      case "UNSUBSCRIBED":
        return <Badge variant="warning">UNSUBSCRIBED</Badge>;
      case "ARCHIVED":
        return <Badge variant="outline" className="text-slate-400 border-slate-300">ARCHIVED</Badge>;
      default:
        return <Badge variant="neutral">{s}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Breadcrumb Navigation */}
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <Link href="/contacts" className="hover:text-blue-600 transition-colors">
          ← Back to Contacts
        </Link>
        <span>/</span>
        <span className="text-slate-700 dark:text-slate-300 font-medium">
          {fullName}
        </span>
      </div>

      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="h-14 w-14 rounded-full bg-blue-100 dark:bg-blue-900/40 border border-blue-200 dark:border-blue-800 flex items-center justify-center text-blue-700 dark:text-blue-300 font-bold text-lg">
            {(contact.first_name?.[0] || "") + (contact.last_name?.[0] || "") ||
              contact.email[0].toUpperCase()}
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-bold text-slate-900 dark:text-white">
                {fullName}
              </h1>
              {getStatusBadge(contact.status)}
              {suppressionInfo?.isSuppressed && (
                <Badge
                  variant="outline"
                  className="border-rose-300 text-rose-700 bg-rose-50 text-xs dark:bg-rose-950/40 dark:text-rose-300"
                >
                  Suppressed ({suppressionInfo.reason || "Unsubscribed"})
                </Badge>
              )}
            </div>
            <p className="mt-0.5 text-xs text-slate-500 font-mono">
              {contact.email}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsEditModalOpen(true)}
          >
            <svg
              className="w-4 h-4 mr-1.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
              />
            </svg>
            Edit Contact
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsDeleteConfirmOpen(true)}
            disabled={deleteLoading}
            className="text-rose-600 hover:bg-rose-50 border-rose-200 dark:border-rose-900 dark:text-rose-400"
          >
            <svg
              className="w-4 h-4 mr-1.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
              />
            </svg>
            {deleteLoading ? "Deleting..." : "Delete Permanently"}
          </Button>
        </div>
      </div>

      {/* Main Grid: Details & History */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Contact Info (2 cols) */}
        <div className="lg:col-span-2 space-y-6">
          {/* Organization & Role */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                Contact & Professional Details
              </CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-4 text-xs">
                <div>
                  <dt className="text-slate-500">First Name</dt>
                  <dd className="mt-1 font-medium text-slate-900 dark:text-slate-100">
                    {contact.first_name || "-"}
                  </dd>
                </div>

                <div>
                  <dt className="text-slate-500">Last Name</dt>
                  <dd className="mt-1 font-medium text-slate-900 dark:text-slate-100">
                    {contact.last_name || "-"}
                  </dd>
                </div>

                <div>
                  <dt className="text-slate-500">Email Address</dt>
                  <dd className="mt-1 font-mono text-slate-900 dark:text-slate-100">
                    {contact.email}
                  </dd>
                </div>

                <div>
                  <dt className="text-slate-500">Phone</dt>
                  <dd className="mt-1 font-medium text-slate-900 dark:text-slate-100">
                    {contact.phone || "-"}
                  </dd>
                </div>

                <div>
                  <dt className="text-slate-500">Company</dt>
                  <dd className="mt-1 font-medium text-slate-900 dark:text-slate-100">
                    {contact.company_name || "-"}
                  </dd>
                </div>

                <div>
                  <dt className="text-slate-500">Job Title</dt>
                  <dd className="mt-1 font-medium text-slate-900 dark:text-slate-100">
                    {contact.job_title || "-"}
                  </dd>
                </div>

                <div>
                  <dt className="text-slate-500">Industry</dt>
                  <dd className="mt-1 font-medium text-slate-900 dark:text-slate-100">
                    {contact.industry || "-"}
                  </dd>
                </div>

                <div>
                  <dt className="text-slate-500">Website</dt>
                  <dd className="mt-1 font-medium">
                    {contact.website ? (
                      <a
                        href={contact.website.startsWith("http") ? contact.website : `https://${contact.website}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-600 hover:underline"
                      >
                        {contact.website}
                      </a>
                    ) : (
                      "-"
                    )}
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          {/* Activity Timeline Placeholder */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                Activity History & Timeline
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="relative border-l border-slate-200 dark:border-slate-800 pl-4 ml-2 space-y-6">
                {/* Event 1 */}
                <div className="relative">
                  <div className="absolute -left-[21px] top-1 h-3 w-3 rounded-full bg-blue-600 ring-4 ring-white dark:ring-slate-900" />
                  <div>
                    <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                      Contact Record Created
                    </p>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Created via {contact.source || "manual entry"} on {new Date(contact.created_at).toLocaleString()}
                    </p>
                  </div>
                </div>

                {/* Event 2 */}
                <div className="relative">
                  <div className="absolute -left-[21px] top-1 h-3 w-3 rounded-full bg-slate-300 dark:bg-slate-700 ring-4 ring-white dark:ring-slate-900" />
                  <div>
                    <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                      Lifecycle Status: {contact.status}
                    </p>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Last status update recorded at {new Date(contact.updated_at).toLocaleString()}
                    </p>
                  </div>
                </div>

                {/* Event 3 */}
                <div className="relative">
                  <div className={`absolute -left-[21px] top-1 h-3 w-3 rounded-full ${emailTotal > 0 ? "bg-emerald-500" : "bg-slate-300 dark:bg-slate-700"} ring-4 ring-white dark:ring-slate-900`} />
                  <div>
                    <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                      Email Outreach & Delivery
                    </p>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      {emailTotal > 0
                        ? `${emailTotal} campaign message(s) recorded in audit logs.`
                        : "No email campaign dispatches recorded yet."}
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Campaign Enrollments Card */}
          <Card>
            <CardHeader className="pb-3 border-b border-slate-100 dark:border-slate-800 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-sm font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                  <span>Campaign Enrollments</span>
                  <Badge variant="neutral" className="text-[11px] font-mono">
                    {campaigns.length}
                  </Badge>
                </CardTitle>
                <p className="text-xs text-slate-500 mt-0.5">
                  Automated email campaigns this contact is currently or was previously enrolled in.
                </p>
              </div>
            </CardHeader>
            <CardContent className="pt-4">
              {campaignsLoading ? (
                <div className="py-6 text-center text-xs text-slate-400 animate-pulse">
                  Loading campaign enrollments...
                </div>
              ) : campaigns.length === 0 ? (
                <div className="py-6 text-center text-xs text-slate-400">
                  <p className="font-medium text-slate-600 dark:text-slate-300">
                    No active or past campaign enrollments.
                  </p>
                  <p className="mt-1">
                    Enroll this contact into an automated sequence from the Contacts or Campaign builder.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-slate-200 bg-slate-50 text-[10px] uppercase font-semibold text-slate-500 dark:border-slate-800 dark:bg-slate-850">
                      <tr>
                        <th className="px-3 py-2">Campaign</th>
                        <th className="px-3 py-2">Status</th>
                        <th className="px-3 py-2">Current Step</th>
                        <th className="px-3 py-2">Enrolled</th>
                        <th className="px-3 py-2">Completed</th>
                        <th className="px-3 py-2 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {campaigns.map((camp) => (
                        <tr key={camp.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-850/50">
                          <td className="px-3 py-2.5 font-medium text-slate-800 dark:text-slate-200">
                            <Link
                              href={`/campaigns/${camp.campaign_id}`}
                              className="text-blue-600 hover:underline font-semibold"
                            >
                              {camp.campaign_name}
                            </Link>
                          </td>
                          <td className="px-3 py-2.5">
                            {getEnrollmentStatusBadge(camp.status)}
                          </td>
                          <td className="px-3 py-2.5 text-slate-600 dark:text-slate-400">
                            {camp.current_step !== null ? `Step ${camp.current_step}` : "—"}
                          </td>
                          <td className="px-3 py-2.5 text-slate-500 font-mono text-[10px]">
                            {camp.enrolled_at ? new Date(camp.enrolled_at).toLocaleDateString() : "—"}
                          </td>
                          <td className="px-3 py-2.5 text-slate-500 font-mono text-[10px]">
                            {camp.completed_at ? new Date(camp.completed_at).toLocaleDateString() : "—"}
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            <Link
                              href={`/campaigns/${camp.campaign_id}`}
                              className="text-blue-600 hover:text-blue-700 font-medium text-xs hover:underline"
                            >
                              View Campaign →
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Email Campaign History Card */}
          <Card>
            <CardHeader className="pb-3 border-b border-slate-100 dark:border-slate-800 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-sm font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                  <span>Email Campaign History</span>
                  <Badge variant="neutral" className="text-[11px] font-mono">
                    {emailTotal}
                  </Badge>
                </CardTitle>
                <p className="text-xs text-slate-500 mt-0.5">
                  Full delivery history and provider audit logs for this contact.
                </p>
              </div>
            </CardHeader>
            <CardContent className="pt-4">
              {emailLoading ? (
                <div className="py-8 text-center text-xs text-slate-400 animate-pulse">
                  Loading email history...
                </div>
              ) : emailHistory.length === 0 ? (
                <div className="py-8 text-center text-xs text-slate-400">
                  <p className="font-medium text-slate-600 dark:text-slate-300">No emails dispatched yet.</p>
                  <p className="mt-1">When campaigns send emails to this contact, real-time delivery logs will appear here.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="border-b border-slate-200 bg-slate-50 text-[10px] uppercase font-semibold text-slate-500 dark:border-slate-800 dark:bg-slate-850">
                        <tr>
                          <th className="px-3 py-2">Campaign / Step</th>
                          <th className="px-3 py-2">Subject</th>
                          <th className="px-3 py-2">Sender</th>
                          <th className="px-3 py-2">Status</th>
                          <th className="px-3 py-2">Sent / Delivered</th>
                          <th className="px-3 py-2">Notes</th>
                          <th className="px-3 py-2 text-right">Details</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {emailHistory.map((item) => (
                          <tr key={item.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-850/50">
                            <td className="px-3 py-2.5 font-medium text-slate-800 dark:text-slate-200">
                              <div>{item.campaign_name || "Campaign"}</div>
                              {item.step_number && (
                                <div className="text-[10px] text-slate-400">Step {item.step_number}</div>
                              )}
                            </td>
                            <td className="px-3 py-2.5 max-w-[180px] truncate" title={item.subject}>
                              {item.subject}
                            </td>
                            <td className="px-3 py-2.5 text-slate-500 font-mono text-[10px]">
                              {item.from_email}
                            </td>
                            <td className="px-3 py-2.5">
                              {getStatusBadge(item.status)}
                            </td>
                            <td className="px-3 py-2.5 text-slate-500 font-mono text-[10px]">
                              <div>{item.sent_at ? new Date(item.sent_at).toLocaleString() : "—"}</div>
                              {item.delivered_at && (
                                <div className="text-emerald-600 text-[9px]">Delivered: {new Date(item.delivered_at).toLocaleTimeString()}</div>
                              )}
                            </td>
                            <td className="px-3 py-2.5 max-w-[120px]">
                              {item.bounce_reason && (
                                <span className="text-red-500 text-[10px] truncate block" title={item.bounce_reason}>
                                  Bounce: {item.bounce_reason}
                                </span>
                              )}
                              {item.complaint_reason && (
                                <span className="text-amber-600 text-[10px] truncate block" title={item.complaint_reason}>
                                  Complaint: {item.complaint_reason}
                                </span>
                              )}
                              {!item.bounce_reason && !item.complaint_reason && (
                                <span className="text-slate-400 text-[10px]">—</span>
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-right">
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedMessageId(item.id);
                                  setIsDetailModalOpen(true);
                                }}
                                className="text-blue-600 hover:text-blue-800 dark:text-blue-400 font-medium hover:underline text-[11px]"
                              >
                                View
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Pagination */}
                  {emailTotalPages > 1 && (
                    <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800 text-xs text-slate-500">
                      <span>
                        Page {emailPage} of {emailTotalPages} ({emailTotal} total)
                      </span>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={emailPage <= 1}
                          onClick={() => setEmailPage((p) => Math.max(1, p - 1))}
                          className="h-7 px-2 text-xs"
                        >
                          Prev
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={emailPage >= emailTotalPages}
                          onClick={() => setEmailPage((p) => Math.min(emailTotalPages, p + 1))}
                          className="h-7 px-2 text-xs"
                        >
                          Next
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Conversation & Replies History Card */}
          <Card>
            <CardHeader className="pb-3 border-b border-slate-100 dark:border-slate-800 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-sm font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                  <span>Conversation & Replies History</span>
                  <Badge variant="neutral" className="text-[11px] font-mono">
                    {conversations.length}
                  </Badge>
                </CardTitle>
                <p className="text-xs text-slate-500 mt-0.5">
                  Two-way email exchanges and customer reply threads for this contact.
                </p>
              </div>
            </CardHeader>
            <CardContent className="pt-4">
              {conversationsLoading ? (
                <div className="py-8 text-center text-xs text-slate-400 animate-pulse">
                  Loading conversation history...
                </div>
              ) : conversations.length === 0 ? (
                <div className="py-8 text-center text-xs text-slate-400">
                  <p className="font-medium text-slate-600 dark:text-slate-300">No replies or conversations yet.</p>
                  <p className="mt-1">When this contact responds to emails, conversation threads and reply history will appear here.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {conversations.map((c) => (
                    <div
                      key={c.id}
                      className="p-3 rounded-lg border border-slate-100 bg-slate-50/50 hover:bg-slate-50 transition-colors dark:border-slate-800 dark:bg-slate-850/50 dark:hover:bg-slate-850 flex items-start justify-between gap-4"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-xs text-slate-900 dark:text-slate-100 truncate">
                            {c.subject || "No Subject"}
                          </span>
                          {c.campaign_name && (
                            <Badge variant="neutral" className="text-[10px]">
                              {c.campaign_name}
                            </Badge>
                          )}
                          {c.unread_count > 0 && (
                            <Badge variant="default" className="text-[10px] bg-blue-600 text-white">
                              {c.unread_count} Unread
                            </Badge>
                          )}
                          {c.has_attachments && (
                            <span className="text-slate-400 text-xs" title="Has attachments">
                              📎
                            </span>
                          )}
                        </div>
                        {c.snippet && (
                          <p className="text-xs text-slate-500 line-clamp-2 mt-1">
                            {c.snippet}
                          </p>
                        )}
                        <span className="text-[10px] text-slate-400 font-mono block mt-1">
                          Last activity: {c.last_message_at ? new Date(c.last_message_at).toLocaleString() : new Date(c.created_at).toLocaleString()}
                        </span>
                      </div>
                      <Link
                        href={`/inbox?id=${c.id}`}
                        className="text-blue-600 hover:text-blue-700 font-medium text-xs hover:underline shrink-0"
                      >
                        Open in Inbox →
                      </Link>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Sidebar / Meta Info (1 col) */}
        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                Lead Intelligence
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-xs">
              <div>
                <span className="text-slate-500 block mb-1">Lead Score</span>
                <div className="flex items-center gap-3">
                  <span className="text-2xl font-bold text-blue-600">
                    {contact.lead_score}
                  </span>
                  <div className="flex-1">
                    <div className="h-2 w-full bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-600 rounded-full"
                        style={{ width: `${Math.min(100, Math.max(0, contact.lead_score))}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-slate-400 mt-1 block">
                      Score range: 0 - 100
                    </span>
                  </div>
                </div>
              </div>

              <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2">
                <div className="flex justify-between">
                  <span className="text-slate-500">Source:</span>
                  <span className="font-medium text-slate-800 dark:text-slate-200">
                    {contact.source || "manual"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Tenant Scoped:</span>
                  <span className="font-mono text-[10px] text-slate-600 dark:text-slate-400">
                    {contact.business_id.slice(0, 8)}...
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Created:</span>
                  <span className="text-slate-700 dark:text-slate-300">
                    {new Date(contact.created_at).toLocaleDateString()}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Updated:</span>
                  <span className="text-slate-700 dark:text-slate-300">
                    {new Date(contact.updated_at).toLocaleDateString()}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <EditContactModal
        isOpen={isEditModalOpen}
        contact={contact}
        onClose={() => setIsEditModalOpen(false)}
        onSuccess={(updated) => {
          setContact(updated);
          router.refresh();
        }}
      />

      <EmailMessageDetailModal
        messageId={selectedMessageId}
        isOpen={isDetailModalOpen}
        onClose={() => {
          setIsDetailModalOpen(false);
          setSelectedMessageId(null);
        }}
      />

      <ConfirmationModal
        isOpen={isDeleteConfirmOpen}
        onClose={() => setIsDeleteConfirmOpen(false)}
        onConfirm={executeDelete}
        title="Delete this contact permanently?"
        message={`Are you sure you want to permanently delete "${fullName}" (${contact.email})? This action cannot be undone and will permanently remove this contact from all campaigns and conversations.`}
        confirmText="Delete Permanently"
        cancelText="Cancel"
        variant="danger"
        loading={deleteLoading}
      />
    </div>
  );
}
