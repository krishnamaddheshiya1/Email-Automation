"use client";

import React from "react";
import { VARIABLE_DEFINITIONS, VariableDefinition } from "@/lib/utils/template";

interface VariablePickerProps {
  onInsert: (token: string) => void;
  targetFieldLabel?: string;
}

export function VariablePicker({ onInsert, targetFieldLabel = "Body" }: VariablePickerProps) {
  const contactVars = VARIABLE_DEFINITIONS.filter((v) => v.category === "contact");
  const senderVars = VARIABLE_DEFINITIONS.filter((v) => v.category === "sender");

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 dark:border-slate-800 dark:bg-slate-900/60">
      <div className="mb-2.5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-4 w-4 text-blue-600 dark:text-blue-400"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 7V4h16v3" />
            <path d="M9 20h6" />
            <path d="M12 4v16" />
          </svg>
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300">
            Insert Dynamic Variables
          </span>
        </div>
        <span className="text-[11px] text-slate-500">
          Clicking a variable inserts it into {targetFieldLabel}
        </span>
      </div>

      <div className="space-y-2">
        {/* Contact Variables */}
        <div>
          <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
            Contact Variables
          </span>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {contactVars.map((v: VariableDefinition) => (
              <button
                key={v.key}
                type="button"
                onClick={() => onInsert(v.token)}
                className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-white px-2 py-1 text-xs font-mono font-medium text-blue-700 shadow-2xs hover:bg-blue-50 hover:border-blue-300 active:scale-95 transition-all dark:border-blue-900/50 dark:bg-slate-850 dark:text-blue-300 dark:hover:bg-blue-950/40"
                title={`Example: "${v.example}"`}
              >
                <span>{v.token}</span>
                <span className="text-[10px] text-slate-400">({v.label})</span>
              </button>
            ))}
          </div>
        </div>

        {/* Sender Variables */}
        <div>
          <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
            Sender & Business Variables
          </span>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {senderVars.map((v: VariableDefinition) => (
              <button
                key={v.key}
                type="button"
                onClick={() => onInsert(v.token)}
                className="inline-flex items-center gap-1 rounded-md border border-purple-200 bg-white px-2 py-1 text-xs font-mono font-medium text-purple-700 shadow-2xs hover:bg-purple-50 hover:border-purple-300 active:scale-95 transition-all dark:border-purple-900/50 dark:bg-slate-850 dark:text-purple-300 dark:hover:bg-purple-950/40"
                title={`Example: "${v.example}"`}
              >
                <span>{v.token}</span>
                <span className="text-[10px] text-slate-400">({v.label})</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
