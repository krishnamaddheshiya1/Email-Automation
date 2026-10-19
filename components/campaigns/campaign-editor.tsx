"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Campaign, CampaignStep, EmailTemplate, SenderIdentity } from "@/types/database";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { ConfirmationModal } from "@/components/ui/confirmation-modal";
import { ContactSelectorModal } from "./contact-selector-modal";
import { CampaignAnalyticsTab } from "./campaign-analytics-tab";
import { Attachment } from "@/types/attachment";
import { AttachmentUploader, formatFileSize } from "./attachment-uploader";

interface EnrolledContactItem {
  id: string;
  campaign_id: string;
  lead_id: string;
  status: string;
  email?: string | null;
  enrolled_at: string;
  current_step?: number | null;
  current_step_id?: string | null;
  total_steps?: number;
  next_step_id?: string | null;
  next_run_at?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  stopped_at?: string | null;
  last_error?: string | null;
  retry_count?: number;
  last_email_status?: string | null;
  last_event_type?: string | null;
  emails_sent_count?: number;
  delivered_count?: number;
  opened_count?: number;
  bounced_count?: number;
  replied?: boolean;
  metadata?: Record<string, unknown>;
  lead?: {
    id: string;
    first_name: string;
    last_name: string;
    email: string;
    company_name?: string;
    job_title?: string;
  };
}

interface ExecutionSummary {
  campaignId: string;
  campaignStatus: string;
  totalEnrolled: number;
  running: number;
  completed: number;
  paused: number;
  stopped: number;
  failed: number;
  nextScheduledRun: string | null;
  lastRunAt: string | null;
}

interface CampaignEditorProps {
  initialCampaign: Campaign & { steps: CampaignStep[]; contact_count: number };
}

export function CampaignEditor({ initialCampaign }: CampaignEditorProps) {
  const router = useRouter();
  const [campaign, setCampaign] = useState(initialCampaign);
  const [steps, setSteps] = useState<CampaignStep[]>(initialCampaign.steps || []);
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [senders, setSenders] = useState<SenderIdentity[]>([]);
  const [activeTab, setActiveTab] = useState<"steps" | "contacts" | "review" | "analytics">("steps");
  const currentSender = senders.find((s) => s.id === campaign.sender_identity_id);

  // Execution engine state
  const [executionSummary, setExecutionSummary] = useState<ExecutionSummary | null>(null);
  const [isRunningDueJobs, setIsRunningDueJobs] = useState(false);

  // Enrolled contacts state
  const [enrolledContacts, setEnrolledContacts] = useState<EnrolledContactItem[]>([]);
  const [contactsTotal, setContactsTotal] = useState(initialCampaign.contact_count || 0);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [contactSearch, setContactSearch] = useState("");
  const [isContactModalOpen, setIsContactModalOpen] = useState(false);

  // Validation state
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [isValidating, setIsValidating] = useState(false);
  const [isValid, setIsValid] = useState<boolean | null>(null);
  const [validationChecklist, setValidationChecklist] = useState<{
    activeSteps: boolean;
    contactsEnrolled: boolean;
    templatesValid: boolean;
    senderConfigured: boolean;
    unsubscribeEnabled: boolean;
    noCriticalErrors: boolean;
  } | null>(null);

  // Modals & UI states
  const [isEditCampaignOpen, setIsEditCampaignOpen] = useState(false);
  const [isAddStepOpen, setIsAddStepOpen] = useState(false);
  const [editingStep, setEditingStep] = useState<CampaignStep | null>(null);
  const [isActivateConfirmOpen, setIsActivateConfirmOpen] = useState(false);
  const [isArchiveConfirmOpen, setIsArchiveConfirmOpen] = useState(false);
  const [isDeleteCampaignConfirmOpen, setIsDeleteCampaignConfirmOpen] = useState(false);
  const [stepToDelete, setStepToDelete] = useState<{ id: string; name: string } | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [notification, setNotification] = useState<{
    type: "success" | "error" | "warning" | "info";
    text: string;
    errors?: string[];
  } | null>(null);

  // Step Attachments state
  const [stepAttachments, setStepAttachments] = useState<Record<string, Attachment[]>>({});

  // Test Email state
  const [isTestEmailModalOpen, setIsTestEmailModalOpen] = useState(false);
  const [testEmailTo, setTestEmailTo] = useState("");
  const [testEmailStepId, setTestEmailStepId] = useState("");
  const [testEmailIncludeAttachments, setTestEmailIncludeAttachments] = useState(true);
  const [testEmailLoading, setTestEmailLoading] = useState(false);
  const [testEmailStatus, setTestEmailStatus] = useState<{ success: boolean; text: string } | null>(null);

  // Edit campaign form state
  const [editName, setEditName] = useState(campaign.name);
  const [editDesc, setEditDesc] = useState(campaign.description || "");
  const [editTimezone, setEditTimezone] = useState(campaign.timezone || "UTC");
  const [editSenderIdentityId, setEditSenderIdentityId] = useState(campaign.sender_identity_id || "");

  // Step form state
  const [stepName, setStepName] = useState("");
  const [stepTemplateId, setStepTemplateId] = useState("");
  const [stepDelayValue, setStepDelayValue] = useState<number>(0);
  const [stepDelayUnit, setStepDelayUnit] = useState<"days" | "hours" | "minutes">("days");
  const [stepStatus, setStepStatus] = useState<"ACTIVE" | "DISABLED">("ACTIVE");

  // Load templates & senders for dropdowns
  useEffect(() => {
    async function loadData() {
      try {
        const [tplRes, sendersRes] = await Promise.all([
          fetch("/api/templates?status=active&limit=100"),
          fetch("/api/senders"),
        ]);
        const tplData = await tplRes.json();
        if (tplData.success) {
          setTemplates(tplData.data || []);
        }
        const sendersData = await sendersRes.json();
        if (sendersData.success) {
          setSenders(sendersData.senders || []);
        }
      } catch {
        // Silently catch
      }
    }
    loadData();
  }, []);

  // Fetch enrolled contacts
  const fetchEnrolledContacts = useCallback(async () => {
    try {
      const q = contactSearch.trim() ? `&search=${encodeURIComponent(contactSearch.trim())}` : "";
      const res = await fetch(`/api/campaigns/${campaign.id}/contacts?limit=50${q}`);
      const data = await res.json();
      if (data.success) {
        setEnrolledContacts(data.data || []);
        setContactsTotal(data.total || 0);
      }
    } catch {
      // Error fetching enrolled contacts
    } finally {
      setContactsLoading(false);
    }
  }, [campaign.id, contactSearch]);

  useEffect(() => {
    let ignore = false;
    async function load() {
      try {
        const q = contactSearch.trim() ? `&search=${encodeURIComponent(contactSearch.trim())}` : "";
        const res = await fetch(`/api/campaigns/${campaign.id}/contacts?limit=50${q}`);
        const data = await res.json();
        if (!ignore && data.success) {
          setEnrolledContacts(data.data || []);
          setContactsTotal(data.total || 0);
        }
      } catch {
        // Fallback
      } finally {
        if (!ignore) setContactsLoading(false);
      }
    }
    load();
    const interval = setInterval(load, 8000);
    return () => {
      ignore = true;
      clearInterval(interval);
    };
  }, [campaign.id, contactSearch]);

  // Run validation
  const runValidation = useCallback(async () => {
    try {
      const res = await fetch(`/api/campaigns/${campaign.id}/validate`);
      const data = await res.json();
      if (data.success) {
        setIsValid(data.valid);
        setValidationErrors(data.errors || []);
        if (data.checklist) {
          setValidationChecklist(data.checklist);
        }
      }
    } catch {
      // Ignore
    } finally {
      setIsValidating(false);
    }
  }, [campaign.id]);

  useEffect(() => {
    let ignore = false;
    async function check() {
      try {
        const res = await fetch(`/api/campaigns/${campaign.id}/validate`);
        const data = await res.json();
        if (!ignore && data.success) {
          setIsValid(data.valid);
          setValidationErrors(data.errors || []);
          if (data.checklist) {
            setValidationChecklist(data.checklist);
          }
        }
      } catch {
        // Fallback
      } finally {
        if (!ignore) setIsValidating(false);
      }
    }
    check();
    return () => {
      ignore = true;
    };
  }, [campaign.id, steps, contactsTotal, campaign.name]);

  // Fetch attachments for all steps
  useEffect(() => {
    let ignore = false;
    async function load() {
      if (!steps || steps.length === 0) return;
      try {
        const map: Record<string, Attachment[]> = {};
        await Promise.all(
          steps.map(async (step) => {
            const res = await fetch(`/api/campaigns/${campaign.id}/steps/${step.id}/attachments`);
            if (res.ok) {
              const data = await res.json();
              map[step.id] = data.attachments || [];
            }
          })
        );
        if (!ignore) {
          setStepAttachments(map);
        }
      } catch {
        // Ignore
      }
    }
    load();
    return () => {
      ignore = true;
    };
  }, [campaign.id, steps]);

  // Fetch execution engine summary
  const fetchExecutionSummary = useCallback(async () => {
    try {
      const res = await fetch(`/api/campaigns/${campaign.id}/execution`);
      const data = await res.json();
      if (data.success && data.summary) {
        setExecutionSummary(data.summary);
      }
    } catch {
      // Fallback
    }
  }, [campaign.id]);

  useEffect(() => {
    let ignore = false;
    async function loadSummary() {
      try {
        const res = await fetch(`/api/campaigns/${campaign.id}/execution`);
        const data = await res.json();
        if (!ignore && data.success && data.summary) {
          setExecutionSummary(data.summary);
        }
      } catch {
        // Fallback
      }
    }
    loadSummary();
    return () => {
      ignore = true;
    };
  }, [campaign.id]);

  // Refresh full campaign
  const refreshCampaign = async () => {
    try {
      const res = await fetch(`/api/campaigns/${campaign.id}`);
      const data = await res.json();
      if (data.success && data.campaign) {
        setCampaign(data.campaign);
        setSteps(data.campaign.steps || []);
        setContactsTotal(data.campaign.contact_count || 0);
      }
    } catch {
      // Fallback
    }
    fetchEnrolledContacts();
    fetchExecutionSummary();
    runValidation();
  };

  // Run due campaign execution jobs manually
  const handleRunDueJobs = async () => {
    setIsRunningDueJobs(true);
    setNotification(null);
    try {
      const res = await fetch(`/api/campaigns/${campaign.id}/run-due`, {
        method: "POST",
      });
      const data = await res.json();
      if (res.ok && data.success) {
        const resultDetails = Array.isArray(data.results)
          ? data.results.map(
              (r: {
                success: boolean;
                recipient?: string;
                leadId: string;
                provider?: string;
                providerMessageId?: string;
                error?: string;
              }) =>
                r.success
                  ? `Recipient: ${r.recipient || r.leadId} — Accepted by provider (${r.provider || "resend"}${
                      r.providerMessageId ? ` · ID: ${r.providerMessageId}` : ""
                    })`
                  : `Recipient: ${r.recipient || r.leadId} — Failed: ${r.error || "Execution failed"}`
            )
          : [];

        if (data.processedCount > 0) {
          setNotification({
            type: data.failed > 0 ? "warning" : "success",
            text:
              data.message ||
              `Jobs processed: ${data.processedCount} enrollment(s) (${data.successful} sent, ${data.failed} failed, ${data.stopped} stopped, ${data.completed} completed).`,
            errors: resultDetails.length > 0 ? resultDetails : undefined,
          });
        } else {
          setNotification({
            type: "info",
            text: data.message || data.diagnostic || "0 jobs processed: No enrollments are currently due.",
          });
        }
        await fetchEnrolledContacts();
        await refreshCampaign();
      } else {
        setNotification({
          type: "error",
          text: data.error || "Failed to execute due campaign jobs.",
        });
      }
    } catch {
      setNotification({
        type: "error",
        text: "Network error executing due campaign jobs.",
      });
    } finally {
      setIsRunningDueJobs(false);
    }
  };

  // --- Campaign Actions ---

  const handleUpdateCampaignInfo = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionLoading(true);
    try {
      const res = await fetch(`/api/campaigns/${campaign.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName,
          description: editDesc,
          timezone: editTimezone,
          sender_identity_id: editSenderIdentityId || null,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setCampaign(data.campaign);
        setIsEditCampaignOpen(false);
        setNotification({ type: "success", text: "Campaign details updated." });
      } else {
        setNotification({ type: "error", text: data.error || "Failed to update campaign." });
      }
    } catch {
      setNotification({ type: "error", text: "Network error updating campaign." });
    } finally {
      setActionLoading(false);
    }
  };

  const handleActivate = async () => {
    setActionLoading(true);
    setNotification(null);
    try {
      const res = await fetch(`/api/campaigns/${campaign.id}/activate`, {
        method: "POST",
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setCampaign(data.campaign);
        setNotification({
          type: "success",
          text: "Campaign activated successfully! Sequence is now ACTIVE.",
        });
        setIsActivateConfirmOpen(false);
        runValidation();
      } else {
        setNotification({
          type: "error",
          text: data.error || "Campaign activation failed.",
          errors: data.details || validationErrors,
        });
        runValidation();
      }
    } catch {
      setNotification({ type: "error", text: "Network error activating campaign." });
    } finally {
      setActionLoading(false);
    }
  };

  const handlePause = async () => {
    setActionLoading(true);
    try {
      const res = await fetch(`/api/campaigns/${campaign.id}/pause`, {
        method: "POST",
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setCampaign(data.campaign);
        setNotification({ type: "success", text: "Campaign paused." });
      } else {
        setNotification({ type: "error", text: data.error || "Failed to pause campaign." });
      }
    } catch {
      setNotification({ type: "error", text: "Network error pausing campaign." });
    } finally {
      setActionLoading(false);
    }
  };

  const handleResume = async () => {
    setActionLoading(true);
    try {
      const res = await fetch(`/api/campaigns/${campaign.id}/resume`, {
        method: "POST",
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setCampaign(data.campaign);
        setNotification({ type: "success", text: "Campaign resumed to ACTIVE." });
      } else {
        setNotification({ type: "error", text: data.error || "Failed to resume campaign." });
      }
    } catch {
      setNotification({ type: "error", text: "Network error resuming campaign." });
    } finally {
      setActionLoading(false);
    }
  };

  const handleArchive = () => {
    setIsArchiveConfirmOpen(true);
  };

  const confirmArchiveCampaign = async () => {
    setActionLoading(true);
    try {
      const res = await fetch(`/api/campaigns/${campaign.id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setCampaign(data.campaign);
        setNotification({ type: "success", text: "Campaign archived." });
        setIsArchiveConfirmOpen(false);
      } else {
        setNotification({ type: "error", text: data.error || "Failed to archive campaign." });
      }
    } catch {
      setNotification({ type: "error", text: "Network error archiving campaign." });
    } finally {
      setActionLoading(false);
    }
  };

  const confirmDeleteCampaign = async () => {
    setActionLoading(true);
    try {
      const res = await fetch(`/api/campaigns/${campaign.id}?hard=true`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (res.ok && data.success) {
        router.push("/campaigns");
      } else {
        setNotification({ type: "error", text: data.error || "Failed to delete campaign." });
        setIsDeleteCampaignConfirmOpen(false);
      }
    } catch {
      setNotification({ type: "error", text: "Network error deleting campaign." });
      setIsDeleteCampaignConfirmOpen(false);
    } finally {
      setActionLoading(false);
    }
  };

  const handleDuplicate = async () => {
    setActionLoading(true);
    try {
      const res = await fetch(`/api/campaigns/${campaign.id}/duplicate`, {
        method: "POST",
      });
      const data = await res.json();
      if (res.ok && data.success && data.campaign) {
        router.push(`/campaigns/${data.campaign.id}`);
      } else {
        setNotification({ type: "error", text: data.error || "Failed to duplicate campaign." });
      }
    } catch {
      setNotification({ type: "error", text: "Network error duplicating campaign." });
    } finally {
      setActionLoading(false);
    }
  };

  // --- Step Actions ---

  const openAddStepModal = () => {
    const nextStepNum = steps.length + 1;
    let defaultName = "Initial Outreach";
    let defaultDelayValue = 0;
    let defaultDelayUnit: "days" | "hours" | "minutes" = "minutes";

    if (nextStepNum === 1) {
      defaultName = "Initial Outreach";
      defaultDelayValue = 0;
      defaultDelayUnit = "minutes";
    } else if (nextStepNum === 2) {
      defaultName = "Follow-up #1";
      defaultDelayValue = 1;
      defaultDelayUnit = "days";
    } else if (nextStepNum === 3) {
      defaultName = "Follow-up #2";
      defaultDelayValue = 3;
      defaultDelayUnit = "days";
    } else if (nextStepNum === 4) {
      defaultName = "Follow-up #3";
      defaultDelayValue = 7;
      defaultDelayUnit = "days";
    } else {
      defaultName = `Follow-up #${nextStepNum - 1}`;
      defaultDelayValue = 7;
      defaultDelayUnit = "days";
    }

    setStepName(defaultName);
    setStepTemplateId("");
    setStepDelayValue(defaultDelayValue);
    setStepDelayUnit(defaultDelayUnit);
    setStepStatus("ACTIVE");
    setEditingStep(null);
    setIsAddStepOpen(true);
  };

  const openEditStepModal = (step: CampaignStep) => {
    setEditingStep(step);
    setStepName(step.name);
    setStepTemplateId(step.template_id || "");
    setStepDelayValue(step.delay_value);
    setStepDelayUnit(step.delay_unit as "days" | "hours" | "minutes");
    setStepStatus((step.status || "ACTIVE").toUpperCase() as "ACTIVE" | "DISABLED");
    setIsAddStepOpen(true);
  };

  const handleSaveStep = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionLoading(true);
    setNotification(null);

    const payload = {
      name: stepName,
      template_id: stepTemplateId || null,
      delay_value: Number(stepDelayValue),
      delay_unit: stepDelayUnit,
      status: stepStatus,
    };

    try {
      let res: Response;
      if (editingStep) {
        res = await fetch(`/api/campaigns/${campaign.id}/steps/${editingStep.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else {
        res = await fetch(`/api/campaigns/${campaign.id}/steps`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }

      const data = await res.json();
      if (res.ok && data.success) {
        setIsAddStepOpen(false);
        setEditingStep(null);
        await refreshCampaign();
        setNotification({
          type: "success",
          text: editingStep ? "Step updated successfully." : "Step added to sequence.",
        });
      } else {
        setNotification({
          type: "error",
          text: data.error || "Failed to save step.",
        });
      }
    } catch {
      setNotification({ type: "error", text: "Network error saving step." });
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteStep = (stepId: string, stepNameText: string) => {
    setStepToDelete({ id: stepId, name: stepNameText });
  };

  const confirmDeleteStep = async () => {
    if (!stepToDelete) return;
    setActionLoading(true);
    try {
      const res = await fetch(`/api/campaigns/${campaign.id}/steps/${stepToDelete.id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (res.ok && data.success) {
        await refreshCampaign();
        setNotification({ type: "success", text: "Step removed and sequence updated." });
        setStepToDelete(null);
      } else {
        setNotification({ type: "error", text: data.error || "Failed to delete step." });
      }
    } catch {
      setNotification({ type: "error", text: "Network error deleting step." });
    } finally {
      setActionLoading(false);
    }
  };

  const handleMoveStep = async (index: number, direction: "up" | "down") => {
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= steps.length) return;

    const newSteps = [...steps];
    const [moved] = newSteps.splice(index, 1);
    newSteps.splice(targetIndex, 0, moved);

    const reorderedIds = newSteps.map((s) => s.id);
    setActionLoading(true);

    try {
      const res = await fetch(`/api/campaigns/${campaign.id}/steps`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step_ids: reorderedIds }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        await refreshCampaign();
      } else {
        setNotification({ type: "error", text: data.error || "Failed to reorder steps." });
      }
    } catch {
      setNotification({ type: "error", text: "Network error reordering steps." });
    } finally {
      setActionLoading(false);
    }
  };

  // --- Contact Removal ---

  const handleRemoveContact = async (leadId: string, name: string) => {
    if (!window.confirm(`Remove ${name} from this campaign sequence?`)) return;
    try {
      const res = await fetch(`/api/campaigns/${campaign.id}/contacts/${leadId}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (res.ok && data.success) {
        await fetchEnrolledContacts();
        await runValidation();
        setNotification({ type: "success", text: `${name} removed from campaign.` });
      } else {
        setNotification({ type: "error", text: data.error || "Failed to remove contact." });
      }
    } catch {
      setNotification({ type: "error", text: "Network error removing contact." });
    }
  };

  const handleSendTestEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!testEmailTo.trim()) return;

    setTestEmailLoading(true);
    setTestEmailStatus(null);

    const step = steps.find((s) => s.id === testEmailStepId) || steps[0];
    const stepAtts = step ? stepAttachments[step.id] || [] : [];
    const attachmentIds = testEmailIncludeAttachments ? stepAtts.map((a) => a.id) : [];

    try {
      const res = await fetch("/api/email/test-send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: testEmailTo.trim(),
          template_id: step?.template_id || undefined,
          sender_identity_id: campaign.sender_identity_id || undefined,
          attachment_ids: attachmentIds.length > 0 ? attachmentIds : undefined,
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setTestEmailStatus({
          success: true,
          text: `Test email sent successfully to ${testEmailTo}!`,
        });
      } else {
        setTestEmailStatus({
          success: false,
          text: data.error || "Failed to send test email.",
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Network error";
      setTestEmailStatus({ success: false, text: msg });
    } finally {
      setTestEmailLoading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const s = (status || "DRAFT").toUpperCase();
    switch (s) {
      case "ACTIVE":
        return <Badge variant="success">ACTIVE</Badge>;
      case "PAUSED":
        return <Badge variant="warning">PAUSED</Badge>;
      case "ARCHIVED":
        return <Badge variant="neutral">ARCHIVED</Badge>;
      case "COMPLETED":
        return <Badge variant="default">COMPLETED</Badge>;
      case "DRAFT":
      default:
        return <Badge variant="neutral">DRAFT</Badge>;
    }
  };

  const getEnrollmentBadge = (status: string) => {
    const s = (status || "ENROLLED").toUpperCase();
    switch (s) {
      case "WAITING":
        return <Badge variant="neutral" className="text-[10px] bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300">⏳ WAITING</Badge>;
      case "RUNNING":
        return <Badge variant="default" className="text-[10px]">▶ RUNNING</Badge>;
      case "COMPLETED":
        return <Badge variant="success" className="text-[10px]">✓ COMPLETED</Badge>;
      case "PAUSED":
        return <Badge variant="warning" className="text-[10px]">⏸ PAUSED</Badge>;
      case "STOPPED":
        return <Badge variant="outline" className="text-[10px] text-slate-500">⏹ STOPPED</Badge>;
      case "REPLIED":
        return <Badge variant="success" className="text-[10px] bg-blue-50 text-blue-800 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300">💬 REPLIED</Badge>;
      case "BOUNCED":
        return <Badge variant="outline" className="text-[10px] border-red-300 text-red-700 bg-red-50 dark:bg-red-950/40 dark:text-red-300">⤬ BOUNCED</Badge>;
      case "FAILED":
        return <Badge variant="outline" className="text-[10px] border-red-300 text-red-700 bg-red-50 dark:bg-red-950/40 dark:text-red-300">✕ FAILED</Badge>;
      case "ENROLLED":
      default:
        return <Badge variant="neutral" className="text-[10px]">ENROLLED</Badge>;
    }
  };

  const getEmailStatusBadge = (status: string | null | undefined) => {
    if (!status) return <span className="text-slate-400">—</span>;
    const s = status.toUpperCase();
    switch (s) {
      case "DELIVERED":
        return <Badge variant="success" className="text-[10px]">✓ Delivered</Badge>;
      case "OPENED":
        return <Badge variant="default" className="text-[10px] border-indigo-300 text-indigo-700 bg-indigo-50 dark:bg-indigo-950/40 dark:text-indigo-300">👁 Opened</Badge>;
      case "SENT":
        return <Badge variant="default" className="text-[10px]">Sent</Badge>;
      case "BOUNCED":
        return <Badge variant="outline" className="text-[10px] border-red-300 text-red-700 bg-red-50 dark:bg-red-950/40 dark:text-red-300">⤬ Bounced</Badge>;
      case "REPLIED":
        return <Badge variant="success" className="text-[10px] bg-blue-50 text-blue-800 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300">💬 Replied</Badge>;
      case "COMPLAINT":
      case "COMPLAINED":
        return <Badge variant="warning" className="text-[10px]">⚠ Complaint</Badge>;
      default:
        return <Badge variant="neutral" className="text-[10px]">{s}</Badge>;
    }
  };

  const statusUpper = (campaign.status || "DRAFT").toUpperCase();
  const enrolledIdsSet = new Set(enrolledContacts.map((c) => c.lead_id));

  return (
    <div className="space-y-6">
      {/* Notifications */}
      {notification && (
        <div
          className={`p-4 rounded-lg flex flex-col gap-1 border text-sm transition-all ${
            notification.type === "success"
              ? "bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800"
              : notification.type === "warning"
              ? "bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800"
              : notification.type === "info"
              ? "bg-blue-50 text-blue-800 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800"
              : "bg-red-50 text-red-800 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="font-semibold">{notification.text}</span>
            <button
              onClick={() => setNotification(null)}
              className="text-xs opacity-70 hover:opacity-100 underline ml-4"
            >
              Dismiss
            </button>
          </div>
          {notification.errors && notification.errors.length > 0 && (
            <ul className="list-disc list-inside mt-2 text-xs space-y-1">
              {notification.errors.map((err, i) => (
                <li key={i}>{err}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Campaign Header Details Card */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 pb-5 dark:border-slate-800">
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
                {campaign.name}
              </h1>
              {getStatusBadge(campaign.status)}
              <Badge variant="outline" className="text-xs">
                {campaign.timezone || "UTC"}
              </Badge>
              {(() => {
                const boundSender = senders.find((s) => s.id === campaign.sender_identity_id);
                return (
                  <Badge variant={boundSender ? "neutral" : "outline"} className="text-xs">
                    Sender: {boundSender ? `${boundSender.from_name} <${boundSender.from_email}>` : "Default Sender"}
                  </Badge>
                );
              })()}
            </div>
            {campaign.description && (
              <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">
                {campaign.description}
              </p>
            )}
            <div className="mt-2 flex items-center gap-4 text-xs text-slate-400">
              <span>{steps.length} Step(s)</span>
              <span>•</span>
              <span>{contactsTotal} Contact(s) Enrolled</span>
              <span>•</span>
              <span>Created {new Date(campaign.created_at).toLocaleDateString()}</span>
            </div>
          </div>

          {/* Quick Campaign Actions */}
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setEditName(campaign.name);
                setEditDesc(campaign.description || "");
                setEditTimezone(campaign.timezone || "UTC");
                setEditSenderIdentityId(campaign.sender_identity_id || "");
                setIsEditCampaignOpen(true);
              }}
            >
              Edit Settings
            </Button>

            <Button
              variant="secondary"
              size="sm"
              disabled={actionLoading}
              onClick={handleDuplicate}
              title="Duplicate campaign and sequence steps"
            >
              Duplicate
            </Button>

            {statusUpper === "DRAFT" && (
              <Button
                variant="primary"
                size="sm"
                disabled={actionLoading || !isValid}
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={() => setIsActivateConfirmOpen(true)}
              >
                Activate Campaign
              </Button>
            )}

            {statusUpper === "ACTIVE" && (
              <>
                <Button
                  variant="primary"
                  size="sm"
                  disabled={actionLoading || isRunningDueJobs}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white font-medium"
                  onClick={handleRunDueJobs}
                  title="Immediately run all steps that are currently due for execution"
                >
                  {isRunningDueJobs ? "Running..." : "▶ Run Due Jobs"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={actionLoading}
                  className="text-amber-600 border-amber-200 hover:bg-amber-50"
                  onClick={handlePause}
                >
                  Pause
                </Button>
              </>
            )}

            {statusUpper === "PAUSED" && (
              <Button
                variant="primary"
                size="sm"
                disabled={actionLoading}
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
                onClick={handleResume}
              >
                Resume Campaign
              </Button>
            )}

            {statusUpper !== "ARCHIVED" && (
              <Button
                variant="outline"
                size="sm"
                disabled={actionLoading}
                className="text-slate-500 hover:text-amber-600"
                onClick={handleArchive}
              >
                Archive
              </Button>
            )}

            <Button
              variant="outline"
              size="sm"
              disabled={actionLoading}
              className="text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700 dark:border-red-900/40 dark:hover:bg-red-950/40"
              onClick={() => setIsDeleteCampaignConfirmOpen(true)}
              title="Permanently delete campaign and its steps"
            >
              Delete Campaign
            </Button>
          </div>
        </div>

        {/* Validation Readiness Status Banner with 6-Point Checklist */}
        <div className="mt-5">
          {isValidating ? (
            <div className="text-xs text-slate-400 animate-pulse">Checking campaign safety & deliverability readiness...</div>
          ) : (
            <div
              className={`p-4 rounded-xl border text-xs ${
                isValid
                  ? "bg-emerald-50/70 border-emerald-200 text-emerald-900 dark:bg-emerald-950/30 dark:border-emerald-800 dark:text-emerald-200"
                  : "bg-amber-50/70 border-amber-200 text-amber-900 dark:bg-amber-950/30 dark:border-amber-800 dark:text-amber-200"
              }`}
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-sm">
                    {isValid ? "✓ Campaign Activation Ready" : "⚠ Activation Safety Checklist"}
                  </span>
                  <span className="text-[11px] opacity-80">
                    {isValid
                      ? "All 6 deliverability & safety checks verified"
                      : "All 6 checks must pass before campaign can be activated"}
                  </span>
                </div>
                <Badge variant={isValid ? "success" : "warning"} className="text-[10px] self-start sm:self-auto">
                  {isValid ? "Ready to Launch" : `${validationErrors.length} Issue(s) Pending`}
                </Badge>
              </div>

              {/* 6-point Activation Readiness Checklist Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 py-2.5 border-t border-b border-black/5 dark:border-white/10 my-2">
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-bold ${validationChecklist?.activeSteps ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>
                    {validationChecklist?.activeSteps ? "✓" : "✗"}
                  </span>
                  <span className={validationChecklist?.activeSteps ? "text-slate-700 dark:text-slate-300" : "text-amber-800 dark:text-amber-300 font-semibold"}>
                    Active steps configured
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-bold ${validationChecklist?.contactsEnrolled ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>
                    {validationChecklist?.contactsEnrolled ? "✓" : "✗"}
                  </span>
                  <span className={validationChecklist?.contactsEnrolled ? "text-slate-700 dark:text-slate-300" : "text-amber-800 dark:text-amber-300 font-semibold"}>
                    Contacts enrolled
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-bold ${validationChecklist?.templatesValid ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>
                    {validationChecklist?.templatesValid ? "✓" : "✗"}
                  </span>
                  <span className={validationChecklist?.templatesValid ? "text-slate-700 dark:text-slate-300" : "text-amber-800 dark:text-amber-300 font-semibold"}>
                    Templates valid & active
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-bold ${validationChecklist?.senderConfigured ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>
                    {validationChecklist?.senderConfigured ? "✓" : "✗"}
                  </span>
                  <span className={validationChecklist?.senderConfigured ? "text-slate-700 dark:text-slate-300" : "text-amber-800 dark:text-amber-300 font-semibold"}>
                    Sender identity verified
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-bold ${validationChecklist?.unsubscribeEnabled ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>
                    {validationChecklist?.unsubscribeEnabled ? "✓" : "✗"}
                  </span>
                  <span className={validationChecklist?.unsubscribeEnabled ? "text-slate-700 dark:text-slate-300" : "text-amber-800 dark:text-amber-300 font-semibold"}>
                    Unsubscribe mechanism enabled
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-bold ${validationChecklist?.noCriticalErrors ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>
                    {validationChecklist?.noCriticalErrors ? "✓" : "✗"}
                  </span>
                  <span className={validationChecklist?.noCriticalErrors ? "text-slate-700 dark:text-slate-300" : "text-amber-800 dark:text-amber-300 font-semibold"}>
                    Zero critical configuration errors
                  </span>
                </div>
              </div>

              {validationErrors.length > 0 && (
                <div className="mt-2 pt-1">
                  <span className="font-semibold text-[11px] block text-amber-900 dark:text-amber-200">
                    Blocking Issue(s):
                  </span>
                  <ul className="list-disc list-inside space-y-0.5 text-xs text-amber-800 dark:text-amber-300 mt-1">
                    {validationErrors.map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Campaign Navigation Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-3">
        <button
          type="button"
          onClick={() => setActiveTab("steps")}
          className={`px-4 py-2 text-xs font-semibold rounded-lg transition-colors flex items-center gap-2 ${
            activeTab === "steps"
              ? "bg-blue-600 text-white shadow-sm"
              : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          }`}
        >
          <span>Sequence Steps</span>
          <span
            className={`px-1.5 py-0.5 text-[10px] rounded-full ${
              activeTab === "steps"
                ? "bg-blue-700 text-blue-100"
                : "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300"
            }`}
          >
            {steps.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("contacts")}
          className={`px-4 py-2 text-xs font-semibold rounded-lg transition-colors flex items-center gap-2 ${
            activeTab === "contacts"
              ? "bg-blue-600 text-white shadow-sm"
              : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          }`}
        >
          <span>Enrolled Contacts</span>
          <span
            className={`px-1.5 py-0.5 text-[10px] rounded-full ${
              activeTab === "contacts"
                ? "bg-blue-700 text-blue-100"
                : "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300"
            }`}
          >
            {contactsTotal}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("review")}
          className={`px-4 py-2 text-xs font-semibold rounded-lg transition-colors flex items-center gap-2 ${
            activeTab === "review"
              ? "bg-blue-600 text-white shadow-sm"
              : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          }`}
        >
          <span>Review & Activate</span>
          <span
            className={`px-1.5 py-0.5 text-[10px] rounded-full font-mono ${
              activeTab === "review"
                ? "bg-blue-700 text-blue-100"
                : isValid
                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                : "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
            }`}
          >
            {isValid ? "Ready" : "Checklist"}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("analytics")}
          className={`px-4 py-2 text-xs font-semibold rounded-lg transition-colors flex items-center gap-2 ${
            activeTab === "analytics"
              ? "bg-blue-600 text-white shadow-sm"
              : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          }`}
        >
          <span>Analytics & Tracking</span>
          <span
            className={`px-1.5 py-0.5 text-[10px] rounded-full font-mono ${
              activeTab === "analytics"
                ? "bg-emerald-700 text-emerald-100"
                : "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
            }`}
          >
            Live
          </span>
        </button>
      </div>

      {activeTab === "steps" && (
        <>
          {/* PHASE 8: CAMPAIGN EXECUTION ENGINE SUMMARY CARD */}
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-4 dark:border-slate-800">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                Execution Engine Metrics
              </h2>
              <Badge
                variant={statusUpper === "ACTIVE" ? "success" : statusUpper === "PAUSED" ? "warning" : "neutral"}
                className="text-xs"
              >
                {statusUpper}
              </Badge>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Automated contact progression, step execution status, and next scheduled runs.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={isRunningDueJobs}
              onClick={handleRunDueJobs}
              className="text-xs font-medium"
            >
              {isRunningDueJobs ? "Running..." : "▶ Run Due Campaign Jobs"}
            </Button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3">
          <div className="p-3 bg-slate-50 rounded-lg border border-slate-100 dark:bg-slate-800/50 dark:border-slate-800">
            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">Total Enrolled</span>
            <span className="text-xl font-bold text-slate-900 dark:text-white mt-0.5 block">{executionSummary?.totalEnrolled ?? contactsTotal}</span>
          </div>
          <div className="p-3 bg-blue-50/60 rounded-lg border border-blue-100 dark:bg-blue-950/20 dark:border-blue-900/40">
            <span className="text-[11px] font-semibold text-blue-600 uppercase tracking-wider block">Running</span>
            <span className="text-xl font-bold text-blue-700 dark:text-blue-400 mt-0.5 block">{executionSummary?.running ?? 0}</span>
          </div>
          <div className="p-3 bg-emerald-50/60 rounded-lg border border-emerald-100 dark:bg-emerald-950/20 dark:border-emerald-900/40">
            <span className="text-[11px] font-semibold text-emerald-600 uppercase tracking-wider block">Completed</span>
            <span className="text-xl font-bold text-emerald-700 dark:text-emerald-400 mt-0.5 block">{executionSummary?.completed ?? 0}</span>
          </div>
          <div className="p-3 bg-amber-50/60 rounded-lg border border-amber-100 dark:bg-amber-950/20 dark:border-amber-900/40">
            <span className="text-[11px] font-semibold text-amber-600 uppercase tracking-wider block">Paused</span>
            <span className="text-xl font-bold text-amber-700 dark:text-amber-400 mt-0.5 block">{executionSummary?.paused ?? 0}</span>
          </div>
          <div className="p-3 bg-slate-100/70 rounded-lg border border-slate-200 dark:bg-slate-800/70 dark:border-slate-700">
            <span className="text-[11px] font-semibold text-slate-600 uppercase tracking-wider block">Stopped</span>
            <span className="text-xl font-bold text-slate-700 dark:text-slate-300 mt-0.5 block">{executionSummary?.stopped ?? 0}</span>
          </div>
          <div className="p-3 bg-red-50/60 rounded-lg border border-red-100 dark:bg-red-950/20 dark:border-red-900/40">
            <span className="text-[11px] font-semibold text-red-600 uppercase tracking-wider block">Failed</span>
            <span className="text-xl font-bold text-red-700 dark:text-red-400 mt-0.5 block">{executionSummary?.failed ?? 0}</span>
          </div>
          <div className="p-3 bg-purple-50/60 rounded-lg border border-purple-100 dark:bg-purple-950/20 dark:border-purple-900/40 col-span-2 sm:col-span-1">
            <span className="text-[11px] font-semibold text-purple-600 uppercase tracking-wider block">Next Run</span>
            <span className="text-xs font-semibold text-purple-900 dark:text-purple-300 mt-1 block truncate" title={executionSummary?.nextScheduledRun || "None scheduled"}>
              {executionSummary?.nextScheduledRun ? new Date(executionSummary.nextScheduledRun).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "None"}
            </span>
          </div>
        </div>
      </div>

      {/* SECTION 1: SEQUENCE STEP BUILDER */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-100 pb-4 dark:border-slate-800">
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">
              Sequence Step Builder
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Configure deterministic step sequence, templates, and delay timers between emails.
            </p>
          </div>
          <Button variant="primary" size="sm" onClick={openAddStepModal}>
            + Add Step
          </Button>
        </div>

        <div className="mt-6 space-y-4">
          {steps.length === 0 ? (
            <div className="p-8 text-center border-2 border-dashed border-slate-200 rounded-xl dark:border-slate-800">
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                No steps added to this campaign yet.
              </p>
              <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
                Add Step 1 to define the initial outreach email, followed by automated follow-up steps.
              </p>
              <Button variant="primary" size="sm" className="mt-4" onClick={openAddStepModal}>
                + Add Step 1
              </Button>
            </div>
          ) : (
            steps
              .sort((a, b) => a.step_number - b.step_number)
              .map((step, idx) => {
                const assignedTemplate = templates.find((t) => t.id === step.template_id);
                const isStepActive = (step.status || "ACTIVE").toUpperCase() === "ACTIVE";

                return (
                  <div
                    key={step.id}
                    className={`relative rounded-xl border transition-all p-4 ${
                      isStepActive
                        ? "border-slate-200 bg-white hover:border-blue-300 dark:border-slate-800 dark:bg-slate-850"
                        : "border-slate-200 bg-slate-50/70 opacity-70 dark:border-slate-800 dark:bg-slate-900"
                    }`}
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      {/* Step Number & Title */}
                      <div className="flex items-start sm:items-center gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white font-bold text-sm shadow-sm">
                          {step.step_number}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="font-semibold text-slate-900 dark:text-white text-base">
                              Step {step.step_number} — {step.name}
                            </h3>
                            <Badge variant={isStepActive ? "success" : "neutral"} className="text-[10px]">
                              {isStepActive ? "✓ Active" : "Disabled"}
                            </Badge>
                          </div>
                          <div className="mt-1 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                            <span className="font-medium text-slate-700 dark:text-slate-300">
                              Delay:
                            </span>
                            <span>
                              {step.step_number === 1 && step.delay_value === 0
                                ? "Send immediately upon enrollment"
                                : step.step_number === 1
                                ? `Send ${step.delay_value} ${step.delay_unit} after enrollment`
                                : `Wait ${step.delay_value} ${step.delay_unit} after Step ${step.step_number - 1}`}
                            </span>
                          </div>
                          {assignedTemplate && (
                            <div className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                              <span className="font-medium text-slate-500">Subject: </span>
                              <span className="font-semibold text-slate-800 dark:text-slate-200">
                                &ldquo;{assignedTemplate.subject}&rdquo;
                              </span>
                            </div>
                          )}
                          {stepAttachments[step.id] && stepAttachments[step.id].length > 0 && (
                            <div className="mt-1 flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                              <span className="text-slate-400">📎</span>
                              <span className="font-medium text-slate-700 dark:text-slate-300">
                                {stepAttachments[step.id].length} attachment(s)
                              </span>
                              <span className="text-[11px] text-slate-400">
                                ({formatFileSize(
                                  stepAttachments[step.id].reduce((sum, a) => sum + (a.file_size || 0), 0)
                                )})
                              </span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Template Info & Step Controls */}
                      <div className="flex items-center gap-3 flex-wrap">
                        {assignedTemplate ? (
                          <div className="text-right">
                            <span className="text-[10px] uppercase font-semibold text-slate-400">
                              Template
                            </span>
                            <p className="text-xs font-medium text-slate-800 dark:text-slate-200 line-clamp-1 max-w-[200px]" title={assignedTemplate.name}>
                              {assignedTemplate.name}
                            </p>
                          </div>
                        ) : (
                          <Badge variant="warning" className="text-[10px]">
                            No Template Assigned
                          </Badge>
                        )}

                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            title="Move Up"
                            disabled={idx === 0 || actionLoading}
                            onClick={() => handleMoveStep(idx, "up")}
                            className="p-1.5 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-30 dark:hover:bg-slate-800"
                          >
                            ▲
                          </button>
                          <button
                            type="button"
                            title="Move Down"
                            disabled={idx === steps.length - 1 || actionLoading}
                            onClick={() => handleMoveStep(idx, "down")}
                            className="p-1.5 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-30 dark:hover:bg-slate-800"
                          >
                            ▼
                          </button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 text-xs font-medium"
                            onClick={() => openEditStepModal(step)}
                          >
                            Edit
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 text-xs text-rose-600 hover:bg-rose-50 border-rose-200 dark:border-rose-900"
                            disabled={actionLoading}
                            onClick={() => handleDeleteStep(step.id, step.name)}
                          >
                            Delete
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
          )}
        </div>
      </div>
        </>
      )}

      {activeTab === "contacts" && (
        <>
          {/* SECTION 2: CONTACT ASSIGNMENT */}
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-4 dark:border-slate-800">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                Assigned Contacts
              </h2>
              <Badge variant="neutral" className="text-xs">
                {contactsTotal} Enrolled
              </Badge>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Contacts enrolled to receive this campaign sequence.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Input
              type="text"
              placeholder="Filter enrolled contacts..."
              value={contactSearch}
              onChange={(e) => setContactSearch(e.target.value)}
              className="w-48 text-xs"
            />
            <Button
              variant="primary"
              size="sm"
              onClick={() => setIsContactModalOpen(true)}
            >
              + Enroll Contacts
            </Button>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-600 dark:text-slate-300">
            <thead className="border-b border-slate-200 bg-slate-50 uppercase text-[11px] font-semibold text-slate-500 dark:border-slate-800 dark:bg-slate-850 dark:text-slate-400">
              <tr>
                <th className="px-3 py-2.5">Contact</th>
                <th className="px-3 py-2.5">Current Step</th>
                <th className="px-3 py-2.5">Status</th>
                <th className="px-3 py-2.5">Last Email</th>
                <th className="px-3 py-2.5">Last Event</th>
                <th className="px-3 py-2.5">Next Run</th>
                <th className="px-3 py-2.5 text-center">Sent</th>
                <th className="px-3 py-2.5 text-center">Delivered</th>
                <th className="px-3 py-2.5 text-center">Opened</th>
                <th className="px-3 py-2.5 text-center">Bounced</th>
                <th className="px-3 py-2.5 text-center">Replied</th>
                <th className="px-3 py-2.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {contactsLoading ? (
                <tr>
                  <td colSpan={12} className="px-4 py-6 text-center text-slate-400">
                    Loading enrolled contacts...
                  </td>
                </tr>
              ) : enrolledContacts.length === 0 ? (
                <tr>
                  <td colSpan={12} className="px-4 py-8 text-center text-slate-400">
                    <p className="font-medium text-slate-600 dark:text-slate-300">
                      No contacts enrolled in this campaign.
                    </p>
                    <p className="mt-1">
                      Click &ldquo;+ Enroll Contacts&rdquo; to assign contacts from your workspace.
                    </p>
                  </td>
                </tr>
              ) : (
                enrolledContacts.map((item) => {
                  const meta = (item.metadata || {}) as Record<string, string>;
                  const leadEmail = item.lead?.email || item.email || meta.email || "—";
                  const leadName = item.lead
                    ? `${item.lead.first_name || ""} ${item.lead.last_name || ""}`.trim() || item.lead.email
                    : meta.first_name || meta.last_name
                    ? `${meta.first_name || ""} ${meta.last_name || ""}`.trim()
                    : leadEmail !== "—"
                    ? leadEmail
                    : "Unknown";

                  const totalSteps = item.total_steps || steps.length || 1;
                  const isCompleted = item.status.toUpperCase() === "COMPLETED";
                  const isDue = item.next_run_at && new Date(item.next_run_at) <= new Date() && ["ENROLLED", "RUNNING", "WAITING"].includes(item.status.toUpperCase());

                  return (
                    <tr
                      key={item.id}
                      className="hover:bg-slate-50/70 transition-colors dark:hover:bg-slate-850/50"
                    >
                      {/* 1. Contact */}
                      <td className="px-3 py-2.5">
                        <div className="font-medium text-slate-900 dark:text-white">
                          {leadName}
                        </div>
                        <div className="text-[11px] text-slate-400 font-mono">
                          {leadEmail}
                        </div>
                      </td>

                      {/* 2. Current Step */}
                      <td className="px-3 py-2.5 font-medium">
                        {isCompleted ? (
                          <span className="text-emerald-600 dark:text-emerald-400 font-bold">
                            {totalSteps} / {totalSteps}
                          </span>
                        ) : item.current_step && item.current_step > 0 ? (
                          <span className="text-indigo-600 dark:text-indigo-400 font-bold">
                            Step {item.current_step} / {totalSteps}
                          </span>
                        ) : item.next_step_id ? (
                          <span className="text-blue-600 dark:text-blue-400 font-medium">
                            Step 1 / {totalSteps} (Ready)
                          </span>
                        ) : (
                          <span className="text-slate-400">
                            Step 1 / {totalSteps} (Pending)
                          </span>
                        )}
                      </td>

                      {/* 3. Status */}
                      <td className="px-3 py-2.5">
                        {getEnrollmentBadge(item.status)}
                        {isCompleted && (
                          <span className="block text-[9px] font-bold text-emerald-600 dark:text-emerald-400 mt-0.5">
                            ALL FOLLOW-UP EMAILS SENT
                          </span>
                        )}
                      </td>

                      {/* 4. Last Email */}
                      <td className="px-3 py-2.5">
                        {getEmailStatusBadge(item.last_email_status)}
                      </td>

                      {/* 5. Last Event */}
                      <td className="px-3 py-2.5">
                        {getEmailStatusBadge(item.last_event_type)}
                      </td>

                      {/* 6. Next Run */}
                      <td className="px-3 py-2.5 text-slate-500 dark:text-slate-400 font-mono text-[11px]">
                        {isCompleted ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800">
                            ✓ ALL FOLLOW-UP EMAILS SENT
                          </span>
                        ) : item.next_run_at ? (
                          <span>
                            {new Date(item.next_run_at).toLocaleString()}
                            {isDue && (
                              <span className="ml-1.5 px-1.5 py-0.5 rounded text-[10px] bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 font-sans font-semibold">
                                Due now
                              </span>
                            )}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>

                      {/* 7. Sent */}
                      <td className="px-3 py-2.5 text-center font-semibold text-slate-700 dark:text-slate-300">
                        {item.emails_sent_count ?? 0}
                      </td>

                      {/* 8. Delivered */}
                      <td className="px-3 py-2.5 text-center font-semibold text-emerald-600 dark:text-emerald-400">
                        {item.delivered_count ?? 0}
                      </td>

                      {/* 9. Opened */}
                      <td className="px-3 py-2.5 text-center font-semibold text-indigo-600 dark:text-indigo-400">
                        {item.opened_count ?? 0}
                      </td>

                      {/* 10. Bounced */}
                      <td className="px-3 py-2.5 text-center font-semibold text-slate-700 dark:text-slate-300">
                        {item.bounced_count ? (
                          <span className="text-red-600 font-bold">{item.bounced_count}</span>
                        ) : (
                          "0"
                        )}
                      </td>

                      {/* 11. Replied */}
                      <td className="px-3 py-2.5 text-center">
                        {item.replied ? (
                          <Badge variant="success" className="text-[10px] bg-blue-50 text-blue-800">
                            Yes
                          </Badge>
                        ) : (
                          <span className="text-slate-400 text-[11px]">No</span>
                        )}
                      </td>

                      {/* 12. Action */}
                      <td className="px-3 py-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => handleRemoveContact(item.lead_id, leadName)}
                          className="text-red-600 hover:text-red-800 font-medium hover:underline text-xs"
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
        </>
      )}

      {activeTab === "review" && (
        <div className="space-y-6">
          {/* Header Banner */}
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <span>Pre-Activation Review & Readiness</span>
                  <Badge variant={statusUpper === "ACTIVE" ? "success" : statusUpper === "PAUSED" ? "warning" : "neutral"} className="text-xs">
                    {statusUpper}
                  </Badge>
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Inspect sequence configuration, audience counts, sender credentials, and deliverability safety before launching.
                </p>
              </div>

              {statusUpper === "DRAFT" ? (
                <Button
                  size="sm"
                  disabled={actionLoading || !isValid}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold disabled:opacity-50"
                  onClick={() => setIsActivateConfirmOpen(true)}
                >
                  ✓ Activate Campaign
                </Button>
              ) : (
                <div className="text-xs font-medium text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5 bg-emerald-50 dark:bg-emerald-950/40 px-3 py-1.5 rounded-lg border border-emerald-200 dark:border-emerald-800">
                  <span>✓</span>
                  <span>Campaign is {statusUpper}</span>
                </div>
              )}
            </div>

            {/* 6 Key Configuration Summary Cards */}
            <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {/* 1. Campaign Name & Timezone */}
              <div className="p-4 bg-slate-50 dark:bg-slate-850 rounded-lg border border-slate-200 dark:border-slate-800">
                <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
                  Campaign Name
                </span>
                <p className="text-sm font-bold text-slate-900 dark:text-white mt-1 truncate" title={campaign.name}>
                  {campaign.name}
                </p>
                <span className="text-xs text-slate-500 mt-0.5 block">
                  Timezone: {campaign.timezone || "UTC"}
                </span>
              </div>

              {/* 2. Audience Count */}
              <div className="p-4 bg-slate-50 dark:bg-slate-850 rounded-lg border border-slate-200 dark:border-slate-800">
                <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
                  Audience Size
                </span>
                <p className="text-sm font-bold text-slate-900 dark:text-white mt-1">
                  {contactsTotal.toLocaleString()} contacts enrolled
                </p>
                <button
                  type="button"
                  onClick={() => setActiveTab("contacts")}
                  className="text-xs text-blue-600 hover:underline mt-0.5 block"
                >
                  View enrolled contacts →
                </button>
              </div>

              {/* 3. Steps Sequence Count */}
              <div className="p-4 bg-slate-50 dark:bg-slate-850 rounded-lg border border-slate-200 dark:border-slate-800">
                <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
                  Sequence Steps
                </span>
                <p className="text-sm font-bold text-slate-900 dark:text-white mt-1">
                  {steps.length} sequential email step(s)
                </p>
                <span className="text-xs text-slate-500 mt-0.5 block">
                  {steps.filter((s) => (s.status || "ACTIVE").toUpperCase() === "ACTIVE").length} active
                </span>
              </div>

              {/* 4. Sender Identity */}
              <div className="p-4 bg-slate-50 dark:bg-slate-850 rounded-lg border border-slate-200 dark:border-slate-800">
                <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
                  Sender Identity
                </span>
                {currentSender ? (
                  <>
                    <p className="text-sm font-bold text-slate-900 dark:text-white mt-1 truncate">
                      {currentSender.from_name}
                    </p>
                    <span className="text-xs text-slate-500 font-mono mt-0.5 block truncate">
                      &lt;{currentSender.from_email}&gt;
                    </span>
                  </>
                ) : (
                  <p className="text-xs text-amber-600 font-medium mt-1">
                    ⚠ No sender assigned (Required)
                  </p>
                )}
              </div>

              {/* 5. Provider Status */}
              <div className="p-4 bg-slate-50 dark:bg-slate-850 rounded-lg border border-slate-200 dark:border-slate-800">
                <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
                  Email Provider
                </span>
                <div className="flex items-center gap-1.5 mt-1">
                  <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
                  <span className="text-sm font-bold text-slate-900 dark:text-white">
                    Resend
                  </span>
                  <Badge variant="success" className="text-[10px] ml-1">
                    ✓ ACTIVE
                  </Badge>
                </div>
                <span className="text-xs text-slate-500 mt-0.5 block">
                  Encrypted API Key verified
                </span>
              </div>

              {/* 6. Suppression Status */}
              <div className="p-4 bg-slate-50 dark:bg-slate-850 rounded-lg border border-slate-200 dark:border-slate-800">
                <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
                  Suppression & Safety
                </span>
                <p className="text-sm font-bold text-emerald-700 dark:text-emerald-400 mt-1 flex items-center gap-1">
                  <span>✓</span> Enforced
                </p>
                <span className="text-[11px] text-slate-500 mt-0.5 block">
                  Pre-send check prevents dispatches to unsubscribed, bounced, or complained emails.
                </span>
              </div>
            </div>
          </div>

          {/* Steps Sequence Chronology */}
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4 dark:border-slate-800">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Sequence Schedule & Content
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Execution order and timing delays for enrolled recipients.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActiveTab("steps")}
                className="text-xs text-blue-600 hover:underline"
              >
                Edit Steps →
              </button>
            </div>

            <div className="mt-4 space-y-3">
              {steps.length === 0 ? (
                <p className="text-xs text-slate-400 text-center py-6">
                  No sequence steps configured yet.
                </p>
              ) : (
                steps
                  .sort((a, b) => a.step_number - b.step_number)
                  .map((step) => {
                    const assignedTemplate = templates.find((t) => t.id === step.template_id);
                    return (
                      <div
                        key={step.id}
                        className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-850 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                      >
                        <div className="flex items-center gap-3">
                          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-blue-600 text-white font-bold text-xs shrink-0">
                            {step.step_number}
                          </span>
                          <div>
                            <span className="font-semibold text-slate-800 dark:text-slate-200 block">
                              {step.name}
                            </span>
                            {assignedTemplate ? (
                              <span className="text-slate-500 text-[11px]">
                                Subject: &ldquo;{assignedTemplate.subject}&rdquo; (Template: {assignedTemplate.name})
                              </span>
                            ) : (
                              <span className="text-rose-500 text-[11px]">
                                ⚠ No template assigned
                              </span>
                            )}
                            {stepAttachments[step.id] && stepAttachments[step.id].length > 0 && (
                              <div className="mt-1 flex flex-wrap items-center gap-1.5 pt-0.5">
                                <span className="text-[10px] uppercase font-semibold text-slate-400">
                                  Attachments ({stepAttachments[step.id].length}):
                                </span>
                                {stepAttachments[step.id].map((att) => (
                                  <span
                                    key={att.id}
                                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[10px] text-slate-700 dark:text-slate-300"
                                  >
                                    <span>📎</span>
                                    <span className="truncate max-w-[130px] font-medium">{att.original_filename}</span>
                                    <span className="text-slate-400 font-mono">({formatFileSize(att.file_size)})</span>
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-3">
                          <span className="text-slate-600 dark:text-slate-400 font-mono text-[11px] bg-white dark:bg-slate-800 px-2 py-1 rounded border border-slate-200 dark:border-slate-700">
                            {step.step_number === 1 && step.delay_value === 0
                              ? "Immediate"
                              : `Wait ${step.delay_value} ${step.delay_unit}`}
                          </span>
                          <Badge variant={(step.status || "ACTIVE").toUpperCase() === "ACTIVE" ? "success" : "neutral"} className="text-[10px]">
                            {(step.status || "ACTIVE").toUpperCase() === "ACTIVE" ? "✓ Active" : "Disabled"}
                          </Badge>
                        </div>
                      </div>
                    );
                  })
              )}
            </div>
          </div>

          {/* Validation Readiness Checklist Card */}
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <h3 className="text-base font-bold text-slate-900 dark:text-white mb-2">
              Deliverability & Safety Checklist
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
              All 6 safety checks must pass before campaign execution can begin.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className={`p-3 rounded-lg border text-xs flex items-start gap-2.5 ${validationChecklist?.activeSteps ? "border-emerald-200 bg-emerald-50/50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/20 dark:text-emerald-300" : "border-amber-200 bg-amber-50/50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-300"}`}>
                <span className="font-bold text-sm">{validationChecklist?.activeSteps ? "✓" : "✗"}</span>
                <div>
                  <span className="font-semibold block">At least 1 Active Step</span>
                  <span className="text-[11px] opacity-80">Campaign has {steps.filter((s) => (s.status || "ACTIVE").toUpperCase() === "ACTIVE").length} active sequence step(s).</span>
                </div>
              </div>

              <div className={`p-3 rounded-lg border text-xs flex items-start gap-2.5 ${validationChecklist?.contactsEnrolled ? "border-emerald-200 bg-emerald-50/50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/20 dark:text-emerald-300" : "border-amber-200 bg-amber-50/50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-300"}`}>
                <span className="font-bold text-sm">{validationChecklist?.contactsEnrolled ? "✓" : "✗"}</span>
                <div>
                  <span className="font-semibold block">Contacts Enrolled</span>
                  <span className="text-[11px] opacity-80">{contactsTotal} recipient contact(s) enrolled.</span>
                </div>
              </div>

              <div className={`p-3 rounded-lg border text-xs flex items-start gap-2.5 ${validationChecklist?.templatesValid ? "border-emerald-200 bg-emerald-50/50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/20 dark:text-emerald-300" : "border-amber-200 bg-amber-50/50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-300"}`}>
                <span className="font-bold text-sm">{validationChecklist?.templatesValid ? "✓" : "✗"}</span>
                <div>
                  <span className="font-semibold block">Templates & Subjects Assigned</span>
                  <span className="text-[11px] opacity-80">Every step is linked to a valid template with email subject.</span>
                </div>
              </div>

              <div className={`p-3 rounded-lg border text-xs flex items-start gap-2.5 ${validationChecklist?.senderConfigured ? "border-emerald-200 bg-emerald-50/50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/20 dark:text-emerald-300" : "border-amber-200 bg-amber-50/50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-300"}`}>
                <span className="font-bold text-sm">{validationChecklist?.senderConfigured ? "✓" : "✗"}</span>
                <div>
                  <span className="font-semibold block">Verified Sender Identity</span>
                  <span className="text-[11px] opacity-80">{currentSender ? currentSender.from_email : "No verified sender configured"}</span>
                </div>
              </div>

              <div className={`p-3 rounded-lg border text-xs flex items-start gap-2.5 ${validationChecklist?.unsubscribeEnabled ? "border-emerald-200 bg-emerald-50/50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/20 dark:text-emerald-300" : "border-amber-200 bg-amber-50/50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-300"}`}>
                <span className="font-bold text-sm">{validationChecklist?.unsubscribeEnabled ? "✓" : "✗"}</span>
                <div>
                  <span className="font-semibold block">Mandatory Unsubscribe Compliance</span>
                  <span className="text-[11px] opacity-80">Cryptographic 1-click unsubscribe links generated for every recipient.</span>
                </div>
              </div>

              <div className={`p-3 rounded-lg border text-xs flex items-start gap-2.5 ${validationChecklist?.noCriticalErrors ? "border-emerald-200 bg-emerald-50/50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/20 dark:text-emerald-300" : "border-amber-200 bg-amber-50/50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-300"}`}>
                <span className="font-bold text-sm">{validationChecklist?.noCriticalErrors ? "✓" : "✗"}</span>
                <div>
                  <span className="font-semibold block">Deliverability Sanity</span>
                  <span className="text-[11px] opacity-80">{validationErrors.length === 0 ? "Zero errors detected." : `${validationErrors.length} issue(s) remaining.`}</span>
                </div>
              </div>
            </div>

            <div className="mt-6 pt-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setTestEmailStepId(steps[0]?.id || "");
                  setTestEmailStatus(null);
                  setIsTestEmailModalOpen(true);
                }}
                disabled={steps.length === 0}
                className="text-xs flex items-center gap-1.5"
              >
                <span>✉</span>
                <span>Send Test Email</span>
              </Button>

              {statusUpper === "DRAFT" && (
                <Button
                  size="sm"
                  disabled={actionLoading || !isValid}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold disabled:opacity-50"
                  onClick={() => setIsActivateConfirmOpen(true)}
                >
                  ✓ Activate Campaign
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === "analytics" && (
        <CampaignAnalyticsTab campaignId={campaign.id} />
      )}

      {/* MODAL 1: EDIT CAMPAIGN DETAILS */}
      <Modal
        isOpen={isEditCampaignOpen}
        onClose={() => setIsEditCampaignOpen(false)}
        title="Edit Campaign Settings"
        description="Update campaign name, description, and execution timezone."
      >
        <form onSubmit={handleUpdateCampaignInfo} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1">
              Campaign Name *
            </label>
            <Input
              type="text"
              required
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              placeholder="e.g. Q4 Inbound Follow-up"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1">
              Description
            </label>
            <textarea
              value={editDesc}
              onChange={(e) => setEditDesc(e.target.value)}
              rows={3}
              className="w-full rounded-md border border-slate-300 p-2 text-sm focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-white"
              placeholder="Campaign objective or sequence strategy..."
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1">
              Timezone *
            </label>
            <select
              value={editTimezone}
              onChange={(e) => setEditTimezone(e.target.value)}
              className="w-full h-9 px-3 rounded-md border border-slate-300 bg-white text-sm text-slate-800 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            >
              <option value="UTC">UTC (Coordinated Universal Time)</option>
              <option value="America/New_York">America/New_York (Eastern Time)</option>
              <option value="America/Chicago">America/Chicago (Central Time)</option>
              <option value="America/Denver">America/Denver (Mountain Time)</option>
              <option value="America/Los_Angeles">America/Los_Angeles (Pacific Time)</option>
              <option value="Europe/London">Europe/London (GMT/BST)</option>
              <option value="Europe/Paris">Europe/Paris (CET)</option>
              <option value="Asia/Kolkata">Asia/Kolkata (IST)</option>
              <option value="Asia/Tokyo">Asia/Tokyo (JST)</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1">
              Sender Identity
            </label>
            <select
              value={editSenderIdentityId}
              onChange={(e) => setEditSenderIdentityId(e.target.value)}
              className="w-full h-9 px-3 rounded-md border border-slate-300 bg-white text-sm text-slate-800 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            >
              <option value="">Default Business Sender (System)</option>
              {senders
                .filter((s) => s.status === "ACTIVE")
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.from_name} &lt;{s.from_email}&gt; ({s.verification_status})
                  </option>
                ))}
            </select>
            <span className="text-[10px] text-slate-400 mt-0.5 block">
              Outgoing campaign sequence dispatches will use this sender address and verified provider credentials.
            </span>
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setIsEditCampaignOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="sm" disabled={actionLoading}>
              Save Changes
            </Button>
          </div>
        </form>
      </Modal>

      {/* MODAL 2: ADD / CONFIGURE STEP */}
      <Modal
        isOpen={isAddStepOpen}
        onClose={() => setIsAddStepOpen(false)}
        title={editingStep ? `Configure Step ${editingStep.step_number}` : "Add Sequence Step"}
        description="Configure step name, email template, and delay relative to previous step."
      >
        <form onSubmit={handleSaveStep} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1">
              Step Name *
            </label>
            <Input
              type="text"
              required
              value={stepName}
              onChange={(e) => setStepName(e.target.value)}
              placeholder="e.g. Initial Introduction"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1">
              Email Template *
            </label>
            <select
              value={stepTemplateId}
              onChange={(e) => setStepTemplateId(e.target.value)}
              className="w-full h-9 px-3 rounded-md border border-slate-300 bg-white text-sm text-slate-800 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            >
              <option value="">-- Select an Email Template --</option>
              {templates.map((tpl) => (
                <option key={tpl.id} value={tpl.id}>
                  {tpl.name} ({tpl.subject})
                </option>
              ))}
            </select>
            {templates.length === 0 && (
              <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                No active templates found.{" "}
                <Link href="/templates/new" className="underline font-semibold" target="_blank">
                  Create a template
                </Link>{" "}
                first.
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1">
                Delay Value *
              </label>
              <Input
                type="number"
                min={0}
                required
                value={stepDelayValue}
                onChange={(e) => setStepDelayValue(parseInt(e.target.value, 10) || 0)}
              />
              <span className="text-[10px] text-slate-400 mt-0.5 block">
                0 = runs immediately
              </span>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1">
                Delay Unit *
              </label>
              <select
                value={stepDelayUnit}
                onChange={(e) => setStepDelayUnit(e.target.value as "days" | "hours" | "minutes")}
                className="w-full h-9 px-3 rounded-md border border-slate-300 bg-white text-sm text-slate-800 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-white"
              >
                <option value="days">Days</option>
                <option value="hours">Hours</option>
                <option value="minutes">Minutes</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1">
              Step Status
            </label>
            <select
              value={stepStatus}
              onChange={(e) => setStepStatus(e.target.value as "ACTIVE" | "DISABLED")}
              className="w-full h-9 px-3 rounded-md border border-slate-300 bg-white text-sm text-slate-800 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            >
              <option value="ACTIVE">ACTIVE (Will execute in sequence)</option>
              <option value="DISABLED">DISABLED (Skipped during execution)</option>
            </select>
          </div>

          {/* File Attachments */}
          <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
            {editingStep ? (
              <AttachmentUploader
                campaignId={campaign.id}
                stepId={editingStep.id}
                initialAttachments={stepAttachments[editingStep.id] || []}
                onAttachmentsChange={(newAtts) => {
                  setStepAttachments((prev) => ({
                    ...prev,
                    [editingStep.id]: newAtts,
                  }));
                }}
              />
            ) : (
              <div className="p-3 bg-slate-50 dark:bg-slate-850 rounded-lg border border-dashed border-slate-200 dark:border-slate-700 text-xs text-slate-500">
                <span>📎 <strong>File Attachments:</strong> Save this step to attach documents, images, spreadsheets, videos, or zip archives.</span>
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setIsAddStepOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="sm" disabled={actionLoading}>
              {editingStep ? "Update Step" : "Add Step"}
            </Button>
          </div>
        </form>
      </Modal>

      {/* MODAL 3: CONTACT SELECTOR MODAL */}
      <ContactSelectorModal
        isOpen={isContactModalOpen}
        onClose={() => setIsContactModalOpen(false)}
        campaignId={campaign.id}
        enrolledLeadIds={enrolledIdsSet}
        onEnrolledSuccess={() => {
          fetchEnrolledContacts();
          runValidation();
          setNotification({ type: "success", text: "Selected contacts enrolled in campaign!" });
        }}
      />

      {/* CONFIRMATION: ACTIVATE CAMPAIGN */}
      <ConfirmationModal
        isOpen={isActivateConfirmOpen}
        onClose={() => setIsActivateConfirmOpen(false)}
        onConfirm={handleActivate}
        title="Activate Campaign"
        message={`Are you sure you want to activate "${campaign.name}"? Outreach Step 1 will be immediately queued for all ${contactsTotal} enrolled contacts.`}
        confirmText="Activate Campaign"
        cancelText="Cancel"
        variant="primary"
        loading={actionLoading}
      />

      {/* CONFIRMATION: ARCHIVE CAMPAIGN */}
      <ConfirmationModal
        isOpen={isArchiveConfirmOpen}
        onClose={() => setIsArchiveConfirmOpen(false)}
        onConfirm={confirmArchiveCampaign}
        title="Archive Campaign"
        message={`Are you sure you want to archive "${campaign.name}"? Active sequences will be halted and the campaign will be marked as archived.`}
        confirmText="Archive Campaign"
        cancelText="Cancel"
        variant="warning"
        loading={actionLoading}
      />

      {/* CONFIRMATION: DELETE CAMPAIGN */}
      <ConfirmationModal
        isOpen={isDeleteCampaignConfirmOpen}
        onClose={() => setIsDeleteCampaignConfirmOpen(false)}
        onConfirm={confirmDeleteCampaign}
        title="Permanently Delete Campaign"
        message={`Are you sure you want to permanently delete campaign "${campaign.name}"? This action will permanently remove all sequence steps, enrollments, and message records. This action cannot be undone.`}
        confirmText="Delete Campaign"
        cancelText="Cancel"
        variant="danger"
        loading={actionLoading}
      />

      {/* CONFIRMATION: DELETE STEP */}
      <ConfirmationModal
        isOpen={Boolean(stepToDelete)}
        onClose={() => setStepToDelete(null)}
        onConfirm={confirmDeleteStep}
        title="Delete Sequence Step"
        message={`Are you sure you want to delete step "${stepToDelete?.name}"? Any contacts scheduled for this step will advance to subsequent steps.`}
        confirmText="Delete Step"
        cancelText="Cancel"
        variant="danger"
        loading={actionLoading}
      />

      {/* MODAL 4: TEST EMAIL SEND MODAL */}
      <Modal
        isOpen={isTestEmailModalOpen}
        onClose={() => {
          setIsTestEmailModalOpen(false);
          setTestEmailStatus(null);
        }}
        title="Send Test Email"
        description="Verify template rendering, sender identity, and email attachments in your inbox."
      >
        <form onSubmit={handleSendTestEmail} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1">
              Recipient Email Address *
            </label>
            <Input
              type="email"
              required
              value={testEmailTo}
              onChange={(e) => setTestEmailTo(e.target.value)}
              placeholder="you@company.com"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1">
              Sequence Step to Test *
            </label>
            <select
              value={testEmailStepId || (steps[0]?.id || "")}
              onChange={(e) => setTestEmailStepId(e.target.value)}
              className="w-full h-9 px-3 rounded-md border border-slate-300 bg-white text-sm text-slate-800 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            >
              {steps.map((st) => (
                <option key={st.id} value={st.id}>
                  Step {st.step_number}: {st.name} ({stepAttachments[st.id]?.length || 0} attachment(s))
                </option>
              ))}
            </select>
          </div>

          {/* Attachment Toggle */}
          {(() => {
            const activeStepId = testEmailStepId || steps[0]?.id;
            const currentStepAtts = activeStepId ? stepAttachments[activeStepId] || [] : [];
            const attSize = currentStepAtts.reduce((sum, a) => sum + (a.file_size || 0), 0);

            if (currentStepAtts.length === 0) {
              return (
                <p className="text-xs text-slate-400">
                  ℹ No files are attached to this step.
                </p>
              );
            }

            return (
              <div className="p-3 bg-slate-50 dark:bg-slate-850 rounded-lg border border-slate-200 dark:border-slate-700 space-y-2">
                <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-slate-800 dark:text-slate-200">
                  <input
                    type="checkbox"
                    checked={testEmailIncludeAttachments}
                    onChange={(e) => setTestEmailIncludeAttachments(e.target.checked)}
                    className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 h-4 w-4"
                  />
                  <span>
                    Include attachments ({currentStepAtts.length} file(s), {formatFileSize(attSize)})
                  </span>
                </label>
                {testEmailIncludeAttachments && (
                  <div className="pl-6 space-y-1">
                    {currentStepAtts.map((att) => (
                      <div key={att.id} className="text-[11px] text-slate-500 flex items-center gap-1.5">
                        <span>📎</span>
                        <span className="truncate">{att.original_filename}</span>
                        <span>({formatFileSize(att.file_size)})</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}

          {testEmailStatus && (
            <div
              className={`p-3 rounded-lg text-xs ${
                testEmailStatus.success
                  ? "bg-emerald-50 text-emerald-800 border border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-800 dark:text-emerald-200"
                  : "bg-rose-50 text-rose-800 border border-rose-200 dark:bg-rose-950/30 dark:border-rose-800 dark:text-rose-200"
              }`}
            >
              {testEmailStatus.text}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setIsTestEmailModalOpen(false);
                setTestEmailStatus(null);
              }}
            >
              Close
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              disabled={testEmailLoading || steps.length === 0}
            >
              {testEmailLoading ? "Sending..." : "Send Test Email"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
