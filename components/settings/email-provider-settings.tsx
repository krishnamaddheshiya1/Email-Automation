"use client";

import React, { useState, useEffect, useCallback, useSyncExternalStore } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { ConfirmationModal } from "@/components/ui/confirmation-modal";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { SenderIdentity } from "@/types/database";

interface EmailSettingsState {
  provider: string;
  isConfigured: boolean;
  fromName: string;
  fromEmail: string;
  replyTo: string | null;
  customConfig: {
    from_name: string;
    from_email: string;
    reply_to: string;
  };
  sendingLimits?: {
    daily_send_limit: number;
    hourly_send_limit: number;
    send_rate_per_minute: number;
  };
}

interface ProviderStatusData {
  configured: boolean;
  id?: string;
  provider: "RESEND" | null;
  status: "ACTIVE" | "INACTIVE" | "ERROR" | null;
  masked_api_key: string | null;
  is_platform_default: boolean;
}

const emptySubscribe = () => () => {};

function useOrigin() {
  return useSyncExternalStore(
    emptySubscribe,
    () => window.location.origin,
    () => ""
  );
}

export function EmailProviderSettings() {
  const [settings, setSettings] = useState<EmailSettingsState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notification, setNotification] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  // Form edit state
  const [fromName, setFromName] = useState("");
  const [fromEmail, setFromEmail] = useState("");
  const [replyTo, setReplyTo] = useState("");
  const [dailyLimit, setDailyLimit] = useState<number>(50);
  const [hourlyLimit, setHourlyLimit] = useState<number>(25);
  const [rateLimit, setRateLimit] = useState<number>(30);

  // Phase 10: Provider Connection State
  const [providerData, setProviderData] = useState<ProviderStatusData | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [isConnectingProvider, setIsConnectingProvider] = useState(false);
  const [isHealthChecking, setIsHealthChecking] = useState(false);
  const [healthResult, setHealthResult] = useState<{
    status: "healthy" | "unhealthy";
    message: string;
  } | null>(null);

  // Phase 10: Sender Identities State
  const [senders, setSenders] = useState<SenderIdentity[]>([]);
  const [isAddSenderModalOpen, setIsAddSenderModalOpen] = useState(false);
  const [newSenderName, setNewSenderName] = useState("");
  const [newSenderEmail, setNewSenderEmail] = useState("");
  const [newSenderReplyTo, setNewSenderReplyTo] = useState("");
  const [isCreatingSender, setIsCreatingSender] = useState(false);
  const [actionSenderId, setActionSenderId] = useState<string | null>(null);
  const [senderToDelete, setSenderToDelete] = useState<SenderIdentity | null>(null);

  // Test Email Modal State
  const [isTestModalOpen, setIsTestModalOpen] = useState(false);
  const [selectedSenderForTest, setSelectedSenderForTest] = useState<string>("");
  const [testRecipient, setTestRecipient] = useState("");
  const [testSubject, setTestSubject] = useState("Platform Test Dispatch");
  const [testBody, setTestBody] = useState(
    "<p>Hello {{first_name}},</p><p>This is a live test email verifying delivery infrastructure.</p><p>Best regards,<br>{{sender_name}}</p>"
  );
  const [isSendingTest, setIsSendingTest] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    providerMessageId?: string;
    status?: string;
    renderedSubject?: string;
    renderedBody?: string;
    error?: string;
  } | null>(null);

  // Webhook Origin URL (hydrated safely via useSyncExternalStore)
  const origin = useOrigin();

  // Load provider status
  const loadProviderStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/email/provider");
      const data = await res.json();
      if (data.success && data.provider) {
        setProviderData(data.provider);
      }
    } catch {
      // Ignore read errors
    }
  }, []);

  // Load senders list
  const loadSenders = useCallback(async () => {
    try {
      const res = await fetch("/api/senders");
      const data = await res.json();
      if (data.success && data.senders) {
        setSenders(data.senders);
      }
    } catch {
      // Ignore read errors
    }
  }, []);

  // Load current configuration
  useEffect(() => {
    async function loadAllSettings() {
      try {
        const [settingsRes] = await Promise.all([
          fetch("/api/email/settings"),
          loadProviderStatus(),
          loadSenders(),
        ]);
        const data = await settingsRes.json();
        if (data.success) {
          setSettings(data);
          setFromName(data.customConfig?.from_name || data.fromName || "");
          setFromEmail(data.customConfig?.from_email || data.fromEmail || "");
          setReplyTo(data.customConfig?.reply_to || data.replyTo || "");
          if (data.sendingLimits) {
            setDailyLimit(data.sendingLimits.daily_send_limit);
            setHourlyLimit(data.sendingLimits.hourly_send_limit);
            setRateLimit(data.sendingLimits.send_rate_per_minute);
          }
        }
      } catch {
        // Silently catch
      } finally {
        setLoading(false);
      }
    }
    loadAllSettings();
  }, [loadProviderStatus, loadSenders]);

  // Connect Provider Handler
  const handleConnectProvider = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!apiKeyInput.trim()) return;

    setIsConnectingProvider(true);
    setNotification(null);
    setHealthResult(null);

    try {
      const res = await fetch("/api/email/provider/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: apiKeyInput.trim() }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setApiKeyInput("");
        setNotification({
          type: "success",
          text: "Resend credentials connected, verified, and safely encrypted at rest.",
        });
        await loadProviderStatus();
      } else {
        setNotification({
          type: "error",
          text: data.error || "Failed to connect Resend provider credentials.",
        });
      }
    } catch {
      setNotification({
        type: "error",
        text: "Network error connecting email provider.",
      });
    } finally {
      setIsConnectingProvider(false);
    }
  };

  // Health Check Handler
  const handleHealthCheck = async () => {
    setIsHealthChecking(true);
    setHealthResult(null);
    try {
      const res = await fetch("/api/email/provider/health-check", {
        method: "POST",
      });
      const data = await res.json();
      if (data.health) {
        setHealthResult(data.health);
        await loadProviderStatus();
      } else {
        setHealthResult({
          status: "unhealthy",
          message: data.error || "Health check failed.",
        });
      }
    } catch {
      setHealthResult({
        status: "unhealthy",
        message: "Network error performing health check.",
      });
    } finally {
      setIsHealthChecking(false);
    }
  };

  // Disconnect Provider Handler
  const handleDisconnectProvider = async () => {
    if (!confirm("Are you sure you want to disable your configured Resend credentials?")) {
      return;
    }
    try {
      const res = await fetch("/api/email/provider", { method: "DELETE" });
      const data = await res.json();
      if (res.ok && data.success) {
        setNotification({ type: "success", text: "Provider credentials disabled successfully." });
        await loadProviderStatus();
      } else {
        setNotification({ type: "error", text: data.error || "Failed to disable provider." });
      }
    } catch {
      setNotification({ type: "error", text: "Network error disabling provider." });
    }
  };

  // Create Sender Identity Handler
  const handleCreateSender = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSenderName.trim() || !newSenderEmail.trim()) return;

    setIsCreatingSender(true);
    try {
      const res = await fetch("/api/senders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from_name: newSenderName.trim(),
          from_email: newSenderEmail.trim(),
          reply_to_email: newSenderReplyTo.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setNotification({
          type: "success",
          text: `Sender identity "${newSenderName}" <${newSenderEmail}> created successfully.`,
        });
        setNewSenderName("");
        setNewSenderEmail("");
        setNewSenderReplyTo("");
        setIsAddSenderModalOpen(false);
        await loadSenders();
      } else {
        setNotification({ type: "error", text: data.error || "Failed to create sender identity." });
      }
    } catch {
      setNotification({ type: "error", text: "Network error creating sender identity." });
    } finally {
      setIsCreatingSender(false);
    }
  };

  // Verify Sender Handler
  const handleVerifySender = async (senderId: string) => {
    setActionSenderId(senderId);
    try {
      const res = await fetch(`/api/senders/${senderId}/verify`, { method: "POST" });
      const data = await res.json();
      if (res.ok && data.success) {
        setNotification({
          type: "success",
          text: `Verification status updated: ${data.sender.verification_status}`,
        });
        await loadSenders();
      } else {
        setNotification({ type: "error", text: data.error || "Verification check failed." });
      }
    } catch {
      setNotification({ type: "error", text: "Network error checking verification status." });
    } finally {
      setActionSenderId(null);
    }
  };

  // Toggle Sender Status Handler
  const handleToggleSenderStatus = async (sender: SenderIdentity) => {
    setActionSenderId(sender.id);
    const nextStatus = sender.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";
    try {
      const res = await fetch(`/api/senders/${sender.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setNotification({
          type: "success",
          text: `Sender status updated to ${nextStatus}.`,
        });
        await loadSenders();
      } else {
        setNotification({ type: "error", text: data.error || "Failed to update sender status." });
      }
    } catch {
      setNotification({ type: "error", text: "Network error updating sender status." });
    } finally {
      setActionSenderId(null);
    }
  };

  // Delete Sender Handler
  const handleDeleteSender = (sender: SenderIdentity) => {
    setSenderToDelete(sender);
  };

  const confirmDeleteSender = async () => {
    if (!senderToDelete) return;
    setActionSenderId(senderToDelete.id);
    try {
      const res = await fetch(`/api/senders/${senderToDelete.id}`, { method: "DELETE" });
      const data = await res.json();
      if (res.ok && data.success) {
        setNotification({ type: "success", text: "Sender identity deleted successfully." });
        setSenderToDelete(null);
        await loadSenders();
      } else {
        setNotification({ type: "error", text: data.error || "Failed to delete sender identity." });
      }
    } catch {
      setNotification({ type: "error", text: "Network error deleting sender identity." });
    } finally {
      setActionSenderId(null);
    }
  };

  // Save General Settings Handler
  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setNotification(null);
    try {
      const res = await fetch("/api/email/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from_name: fromName.trim(),
          from_email: fromEmail.trim(),
          reply_to: replyTo.trim() || undefined,
          daily_send_limit: Number(dailyLimit),
          hourly_send_limit: Number(hourlyLimit),
          send_rate_per_minute: Number(rateLimit),
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setNotification({
          type: "success",
          text: "Sender configuration and safety limits saved successfully.",
        });
      } else {
        setNotification({ type: "error", text: data.error || "Failed to save settings." });
      }
    } catch {
      setNotification({ type: "error", text: "Network error saving sender settings." });
    } finally {
      setSaving(false);
    }
  };

  // Test Email Dispatch Handler
  const handleSendTestEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!testRecipient.trim()) return;

    setIsSendingTest(true);
    setTestResult(null);

    try {
      const res = await fetch("/api/email/test-send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: testRecipient.trim(),
          subject: testSubject.trim(),
          body: testBody.trim(),
          sender_identity_id: selectedSenderForTest || undefined,
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setTestResult({
          success: true,
          providerMessageId: data.providerMessageId,
          status: data.status,
          renderedSubject: data.renderedSubject,
          renderedBody: data.renderedBody,
        });
      } else {
        setTestResult({
          success: false,
          error: data.error || "Failed to dispatch test email.",
        });
      }
    } catch {
      setTestResult({
        success: false,
        error: "Network error attempting test email dispatch.",
      });
    } finally {
      setIsSendingTest(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="animate-pulse space-y-4">
            <div className="h-4 bg-slate-200 dark:bg-slate-800 rounded w-1/4" />
            <div className="h-10 bg-slate-200 dark:bg-slate-800 rounded" />
          </div>
        </CardContent>
      </Card>
    );
  }

  const isConfigured = providerData?.configured ?? settings?.isConfigured ?? false;
  const isCustomKey = providerData?.configured && !providerData?.is_platform_default;

  return (
    <div className="space-y-6">
      {notification && (
        <div
          className={`p-4 rounded-lg flex items-center justify-between text-sm ${
            notification.type === "success"
              ? "bg-emerald-50 text-emerald-800 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800"
              : "bg-red-50 text-red-800 border border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800"
          }`}
        >
          <span>{notification.text}</span>
          <button
            onClick={() => setNotification(null)}
            className="text-xs opacity-70 hover:opacity-100 underline ml-4"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* ================================================================= */}
      {/* 1. Email Provider Credentials & Health Check Card                */}
      {/* ================================================================= */}
      <Card id="provider">
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <CardTitle className="text-base">Email Provider & Relay Credentials</CardTitle>
                <Badge
                  variant={
                    providerData?.status === "ACTIVE"
                      ? "success"
                      : providerData?.status === "ERROR"
                      ? "warning"
                      : isConfigured
                      ? "success"
                      : "warning"
                  }
                >
                  {providerData?.status === "ACTIVE"
                    ? "Active & Connected"
                    : providerData?.status === "ERROR"
                    ? "Credentials Error"
                    : isConfigured
                    ? "Configured"
                    : "No Key Configured"}
                </Badge>
                <Badge variant="outline" className="uppercase text-[10px]">
                  Provider: Resend
                </Badge>
              </div>
              <CardDescription className="mt-1">
                Securely store and validate your business&apos;s Resend API credentials. Keys are encrypted at rest with AES-256-GCM.
              </CardDescription>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleHealthCheck}
                disabled={isHealthChecking || !isConfigured}
                className="text-xs"
              >
                {isHealthChecking ? "Verifying..." : "⚡ Check Health"}
              </Button>

              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  setTestResult(null);
                  setIsTestModalOpen(true);
                }}
                className="bg-blue-600 hover:bg-blue-700 text-white shrink-0 text-xs"
              >
                ✉ Send Test Email
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-5">
          {/* Health check banner */}
          {healthResult && (
            <div
              className={`p-3 rounded-lg border text-xs flex items-center justify-between ${
                healthResult.status === "healthy"
                  ? "bg-emerald-50 border-emerald-200 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800"
                  : "bg-red-50 border-red-200 text-red-800 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800"
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="font-bold text-sm">
                  {healthResult.status === "healthy" ? "✓" : "⚠"}
                </span>
                <span>{healthResult.message}</span>
              </div>
              <Badge
                variant={healthResult.status === "healthy" ? "success" : "warning"}
                className="text-[10px] uppercase"
              >
                {healthResult.status}
              </Badge>
            </div>
          )}

          {/* Current credentials display */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-4 rounded-lg bg-slate-50 border border-slate-200 dark:bg-slate-800/50 dark:border-slate-800">
            <div>
              <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wider block">
                Provider Type
              </span>
              <span className="text-sm font-semibold text-slate-900 dark:text-white capitalize">
                Resend REST API
              </span>
            </div>

            <div>
              <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wider block">
                Credentials Mask
              </span>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="font-mono text-xs font-semibold text-slate-800 dark:text-slate-200">
                  {providerData?.masked_api_key || (isConfigured ? "re_••••••••••••••••" : "Not Configured")}
                </span>
                {providerData?.is_platform_default && (
                  <Badge variant="outline" className="text-[9px]">
                    Platform Fallback
                  </Badge>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between sm:justify-end">
              {isCustomKey && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDisconnectProvider}
                  className="text-xs text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200 dark:border-red-900"
                >
                  Disconnect Credentials
                </Button>
              )}
            </div>
          </div>

          {/* Connect / Update Credentials Form */}
          <form onSubmit={handleConnectProvider} className="space-y-3 pt-1">
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
              {isCustomKey ? "Update Resend API Key" : "Connect Resend API Key"}
            </label>
            <div className="flex flex-col sm:flex-row items-stretch gap-2">
              <Input
                type="password"
                required
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                placeholder="re_xxxxxxxxxxxxxxxxxxxxxxxx"
                className="font-mono text-xs"
              />
              <Button
                type="submit"
                variant="primary"
                size="sm"
                disabled={isConnectingProvider || !apiKeyInput.trim()}
                className="bg-blue-600 hover:bg-blue-700 text-white shrink-0"
              >
                {isConnectingProvider ? "Validating..." : "Connect & Verify"}
              </Button>
            </div>
            <p className="text-[11px] text-slate-500">
              Key is validated against Resend API before saving. Plaintext keys are never stored or returned to the browser.
            </p>
          </form>
        </CardContent>
      </Card>

      {/* ================================================================= */}
      {/* 2. Sender Identities Management Card                              */}
      {/* ================================================================= */}
      <Card id="senders">
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base">Sender Identities</CardTitle>
              <CardDescription className="mt-1">
                Configure verified sender addresses available for email campaigns and delivery.
              </CardDescription>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsAddSenderModalOpen(true)}
              className="text-xs text-blue-600 border-blue-200 hover:bg-blue-50 dark:border-blue-800 dark:text-blue-400"
            >
              + Add Sender Identity
            </Button>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {senders.length === 0 ? (
            <div className="p-6 text-center border border-dashed rounded-lg border-slate-200 dark:border-slate-800">
              <p className="text-xs text-slate-500">
                No custom sender identities added yet. Campaigns will use the default business settings below.
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsAddSenderModalOpen(true)}
                className="mt-3 text-xs"
              >
                Add First Sender
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="p-3 font-semibold">From Name & Email</th>
                    <th className="p-3 font-semibold">Reply-To</th>
                    <th className="p-3 font-semibold">Domain Status</th>
                    <th className="p-3 font-semibold">Status</th>
                    <th className="p-3 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {senders.map((sender) => (
                    <tr key={sender.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                      <td className="p-3">
                        <div className="font-semibold text-slate-900 dark:text-white">
                          {sender.from_name}
                        </div>
                        <div className="font-mono text-slate-500 text-[11px]">
                          {sender.from_email}
                        </div>
                      </td>
                      <td className="p-3 text-slate-600 dark:text-slate-400 font-mono text-[11px]">
                        {sender.reply_to_email || "—"}
                      </td>
                      <td className="p-3">
                        <Badge
                          variant={
                            sender.verification_status === "VERIFIED"
                              ? "success"
                              : sender.verification_status === "FAILED"
                              ? "warning"
                              : "neutral"
                          }
                          className="text-[10px]"
                        >
                          {sender.verification_status}
                        </Badge>
                      </td>
                      <td className="p-3">
                        <Badge
                          variant={sender.status === "ACTIVE" ? "success" : "outline"}
                          className="text-[10px]"
                        >
                          {sender.status}
                        </Badge>
                      </td>
                      <td className="p-3 text-right space-x-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleVerifySender(sender.id)}
                          disabled={actionSenderId === sender.id}
                          className="text-[11px] h-7 px-2"
                        >
                          Check Domain
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleToggleSenderStatus(sender)}
                          disabled={actionSenderId === sender.id}
                          className="text-[11px] h-7 px-2"
                        >
                          {sender.status === "ACTIVE" ? "Disable" : "Enable"}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeleteSender(sender)}
                          disabled={actionSenderId === sender.id}
                          className="text-[11px] h-7 px-2 text-red-600 hover:text-red-700"
                        >
                          Delete
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ================================================================= */}
      {/* 3. Default Sender Routing & Safety Limits Card                    */}
      {/* ================================================================= */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Default Routing & Safety Guardrails</CardTitle>
          <CardDescription>
            Global fallback sender parameters and delivery limit ceilings.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          <form onSubmit={handleSaveSettings} className="space-y-4">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
              Default Sender Identity
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Default From Name *
                </label>
                <Input
                  type="text"
                  required
                  value={fromName}
                  onChange={(e) => setFromName(e.target.value)}
                  placeholder="e.g. Acme Support"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Default From Email *
                </label>
                <Input
                  type="email"
                  required
                  value={fromEmail}
                  onChange={(e) => setFromEmail(e.target.value)}
                  placeholder="e.g. notifications@acme.com"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Default Reply-To Email
                </label>
                <Input
                  type="email"
                  value={replyTo}
                  onChange={(e) => setReplyTo(e.target.value)}
                  placeholder="e.g. reply@acme.com"
                />
              </div>
            </div>

            {/* Delivery Safety Limits */}
            <div className="border-t border-slate-200 dark:border-slate-800 pt-4 space-y-4">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  Sending Limits & Safety Ceilings
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Protects your domain reputation by pausing dispatches when safety ceilings are reached.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Daily Send Limit
                  </label>
                  <Input
                    type="number"
                    min={1}
                    max={100000}
                    value={dailyLimit}
                    onChange={(e) => setDailyLimit(parseInt(e.target.value, 10) || 0)}
                    placeholder="50"
                  />
                  <span className="text-[10px] text-slate-400 block">
                    Max emails dispatched per UTC day
                  </span>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Hourly Send Limit
                  </label>
                  <Input
                    type="number"
                    min={1}
                    max={50000}
                    value={hourlyLimit}
                    onChange={(e) => setHourlyLimit(parseInt(e.target.value, 10) || 0)}
                    placeholder="25"
                  />
                  <span className="text-[10px] text-slate-400 block">
                    Max emails dispatched per rolling hour
                  </span>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Send Rate (per Minute)
                  </label>
                  <Input
                    type="number"
                    min={1}
                    max={1000}
                    value={rateLimit}
                    onChange={(e) => setRateLimit(parseInt(e.target.value, 10) || 0)}
                    placeholder="30"
                  />
                  <span className="text-[10px] text-slate-400 block">
                    Dispatch rate burst throttling
                  </span>
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <Button type="submit" variant="primary" size="sm" disabled={saving}>
                {saving ? "Saving..." : "Save Settings & Limits"}
              </Button>
            </div>
          </form>
        </CardContent>
        <CardFooter className="bg-slate-50/50 dark:bg-slate-900/50 border-t border-slate-100 dark:border-slate-800 text-xs text-slate-500 flex justify-between items-center">
          <span>Relay: Resend REST API</span>
          <span>Security: Zero-trust multi-tenant isolation</span>
        </CardFooter>
      </Card>

      {/* ================================================================= */}
      {/* 4. Resend Webhook Configuration Card                              */}
      {/* ================================================================= */}
      <Card id="webhook">
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <CardTitle className="text-base">Inbound Webhook Infrastructure</CardTitle>
                <Badge variant="success" className="text-[10px]">✓ Configured & Active</Badge>
              </div>
              <CardDescription className="mt-1">
                Real-time delivery receipts, bounces, spam complaints, and tracking dispatched directly from Resend.
              </CardDescription>
            </div>
            <Badge variant="outline" className="text-xs">
              Resend svix Signatures
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block">
              Webhook Target URL (Register in Resend Dashboard)
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={origin ? `${origin}/api/webhooks/resend` : "/api/webhooks/resend"}
                className="flex-1 font-mono text-xs px-3 py-2 rounded-lg border border-slate-300 bg-slate-50 dark:border-slate-700 dark:bg-slate-800 text-slate-800 dark:text-slate-200"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const url = origin ? `${origin}/api/webhooks/resend` : `${window.location.origin}/api/webhooks/resend`;
                  navigator.clipboard.writeText(url);
                  setNotification({ type: "success", text: "Webhook URL copied to clipboard!" });
                }}
                className="text-xs h-9 px-3 shrink-0"
              >
                Copy URL
              </Button>
            </div>
            <p className="text-[11px] text-slate-500">
              Configure this endpoint in your Resend Dashboard &gt; Webhooks. All incoming payloads are cryptographically verified using your <code className="font-mono">RESEND_WEBHOOK_SECRET</code>.
            </p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
            <div className="p-2.5 rounded-lg border border-slate-100 bg-slate-50 dark:border-slate-800 dark:bg-slate-800/40 text-xs">
              <span className="font-semibold text-slate-700 dark:text-slate-300 block">email.sent</span>
              <span className="text-[10px] text-slate-400">Dispatch logged</span>
            </div>
            <div className="p-2.5 rounded-lg border border-slate-100 bg-slate-50 dark:border-slate-800 dark:bg-slate-800/40 text-xs">
              <span className="font-semibold text-emerald-600 dark:text-emerald-400 block">email.delivered</span>
              <span className="text-[10px] text-slate-400">Delivery verified</span>
            </div>
            <div className="p-2.5 rounded-lg border border-slate-100 bg-slate-50 dark:border-slate-800 dark:bg-slate-800/40 text-xs">
              <span className="font-semibold text-rose-600 dark:text-rose-400 block">email.bounced</span>
              <span className="text-[10px] text-slate-400">Auto-suppressed</span>
            </div>
            <div className="p-2.5 rounded-lg border border-slate-100 bg-slate-50 dark:border-slate-800 dark:bg-slate-800/40 text-xs">
              <span className="font-semibold text-amber-600 dark:text-amber-400 block">email.complained</span>
              <span className="text-[10px] text-slate-400">Auto-suppressed</span>
            </div>
          </div>
        </CardContent>
        <CardFooter className="bg-slate-50/50 dark:bg-slate-900/50 border-t border-slate-100 dark:border-slate-800 text-xs text-slate-500">
          Replay protection: 5-minute timestamp tolerance strictly enforced
        </CardFooter>
      </Card>

      {/* ================================================================= */}
      {/* MODAL: ADD SENDER IDENTITY                                       */}
      {/* ================================================================= */}
      <Modal
        isOpen={isAddSenderModalOpen}
        onClose={() => setIsAddSenderModalOpen(false)}
        title="Add Sender Identity"
        description="Configure a new sender identity for your business. The address must be verified with your provider."
      >
        <form onSubmit={handleCreateSender} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1">
              Sender Name *
            </label>
            <Input
              type="text"
              required
              value={newSenderName}
              onChange={(e) => setNewSenderName(e.target.value)}
              placeholder="e.g. Sales Team or Sarah Connor"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1">
              Sender Email Address *
            </label>
            <Input
              type="email"
              required
              value={newSenderEmail}
              onChange={(e) => setNewSenderEmail(e.target.value)}
              placeholder="e.g. sales@yourdomain.com"
            />
            <span className="text-[10px] text-slate-400 mt-0.5 block">
              For testing sandbox without custom domain, you may use <code className="font-mono">onboarding@resend.dev</code>.
            </span>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1">
              Reply-To Email Address (Optional)
            </label>
            <Input
              type="email"
              value={newSenderReplyTo}
              onChange={(e) => setNewSenderReplyTo(e.target.value)}
              placeholder="e.g. support@yourdomain.com"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setIsAddSenderModalOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              disabled={isCreatingSender}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              {isCreatingSender ? "Creating..." : "Add Sender"}
            </Button>
          </div>
        </form>
      </Modal>

      {/* ================================================================= */}
      {/* MODAL: TEST EMAIL DISPATCH                                       */}
      {/* ================================================================= */}
      <Modal
        isOpen={isTestModalOpen}
        onClose={() => setIsTestModalOpen(false)}
        title="Send Test Email"
        description="Explicit user-triggered test delivery to verify email provider connectivity and template rendering."
      >
        <form onSubmit={handleSendTestEmail} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1">
              Sender Identity
            </label>
            <select
              value={selectedSenderForTest}
              onChange={(e) => setSelectedSenderForTest(e.target.value)}
              className="w-full rounded-md border border-slate-300 p-2 text-xs focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            >
              <option value="">Default Business Sender ({fromEmail || "System"})</option>
              {senders
                .filter((s) => s.status === "ACTIVE")
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.from_name} &lt;{s.from_email}&gt; ({s.verification_status})
                  </option>
                ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1">
              Test Recipient Email *
            </label>
            <Input
              type="email"
              required
              value={testRecipient}
              onChange={(e) => setTestRecipient(e.target.value)}
              placeholder="e.g. yourname@example.com"
            />
            <span className="text-[10px] text-slate-400 mt-0.5 block">
              The test email will be dispatched strictly to this single destination.
            </span>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1">
              Subject Line *
            </label>
            <Input
              type="text"
              required
              value={testSubject}
              onChange={(e) => setTestSubject(e.target.value)}
              placeholder="Test subject..."
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1">
              Email Body (HTML / Template Syntax) *
            </label>
            <textarea
              required
              rows={4}
              value={testBody}
              onChange={(e) => setTestBody(e.target.value)}
              className="w-full rounded-md border border-slate-300 p-2 text-sm focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-white font-mono text-xs"
            />
            <span className="text-[10px] text-slate-400 mt-0.5 block">
              Supported variables: {"{{first_name}}"}, {"{{company_name}}"}, {"{{sender_name}}"}, {"{{business_name}}"}.
            </span>
          </div>

          {/* Test Dispatch Result Output */}
          {testResult && (
            <div
              className={`p-3 rounded-lg border text-xs space-y-1 ${
                testResult.success
                  ? "bg-emerald-50 border-emerald-200 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800"
                  : "bg-red-50 border-red-200 text-red-800 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800"
              }`}
            >
              {testResult.success ? (
                <>
                  <div className="font-bold flex items-center gap-1.5">
                    <span>✓</span> Test Email Dispatched Successfully!
                  </div>
                  <div>
                    Provider Message ID:{" "}
                    <code className="font-mono text-[11px] font-semibold">
                      {testResult.providerMessageId}
                    </code>
                  </div>
                  <div>
                    Status: <Badge variant="success" className="text-[10px]">{testResult.status}</Badge>
                  </div>
                </>
              ) : (
                <>
                  <div className="font-bold">Dispatch Error:</div>
                  <div>{testResult.error}</div>
                </>
              )}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setIsTestModalOpen(false)}
            >
              Close
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              disabled={isSendingTest}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              {isSendingTest ? "Dispatching..." : "Confirm & Send Test Email"}
            </Button>
          </div>
        </form>
      </Modal>

      {/* CONFIRMATION: DELETE SENDER IDENTITY */}
      <ConfirmationModal
        isOpen={Boolean(senderToDelete)}
        onClose={() => setSenderToDelete(null)}
        onConfirm={confirmDeleteSender}
        title="Delete Sender Identity"
        message={`Are you sure you want to delete sender identity "${senderToDelete?.from_email}"? It will no longer be available for automated campaign outreach.`}
        confirmText="Delete Sender"
        cancelText="Cancel"
        variant="danger"
        loading={actionSenderId !== null}
      />
    </div>
  );
}
