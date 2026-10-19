"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function CampaignForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [timezone, setTimezone] = useState("UTC");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("Campaign name is required.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          timezone,
          status: "DRAFT",
          settings: {},
        }),
      });

      const data = await res.json();
      if (res.ok && data.success && data.campaign) {
        // Redirect to sequence builder / campaign editor
        router.push(`/campaigns/${data.campaign.id}`);
      } else {
        setError(data.error || "Failed to create campaign.");
      }
    } catch {
      setError("Network error creating campaign.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="border-b border-slate-100 pb-4 dark:border-slate-800">
        <h1 className="text-xl font-bold text-slate-900 dark:text-white">
          Create New Campaign
        </h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
          Set up a new automated email campaign. You can configure steps, delays, and assign contacts in the next step.
        </p>
      </div>

      {error && (
        <div className="mt-4 p-3 rounded-lg bg-red-50 text-red-700 text-xs border border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="mt-5 space-y-5">
        <div>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1">
            Campaign Name *
          </label>
          <Input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Q4 Inbound Lead Sequence"
            className="text-sm"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1">
            Description
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="Describe the campaign goal, target audience, or strategy..."
            className="w-full rounded-md border border-slate-300 p-2.5 text-sm focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-850 dark:text-white"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1">
            Sending Timezone *
          </label>
          <select
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            className="w-full h-10 px-3 rounded-md border border-slate-300 bg-white text-sm text-slate-800 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-850 dark:text-white"
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
          <p className="mt-1 text-[11px] text-slate-400">
            Step delays and delivery windows will align with this timezone.
          </p>
        </div>

        <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100 dark:border-slate-800">
          <Link href="/campaigns">
            <Button type="button" variant="outline" size="sm">
              Cancel
            </Button>
          </Link>
          <Button type="submit" variant="primary" size="sm" disabled={submitting}>
            {submitting ? "Creating Campaign..." : "Continue to Sequence Builder →"}
          </Button>
        </div>
      </form>
    </div>
  );
}
