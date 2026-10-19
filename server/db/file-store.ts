import fs from "fs";
import path from "path";
import crypto from "crypto";
import { Lead, LeadStatus } from "@/types/database";
import { ContactListParams, ContactListResult } from "../repositories/lead.repository";

const DATA_DIR = path.resolve(process.cwd(), ".data");
const STORE_PATH = path.join(DATA_DIR, "contacts.json");

function ensureStoreExists(): Lead[] {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(STORE_PATH)) {
    fs.writeFileSync(STORE_PATH, JSON.stringify([], null, 2), "utf-8");
    return [];
  }
  try {
    const raw = fs.readFileSync(STORE_PATH, "utf-8");
    return JSON.parse(raw) as Lead[];
  } catch (err) {
    console.warn("Could not read contacts.json store, resetting:", err);
    fs.writeFileSync(STORE_PATH, JSON.stringify([], null, 2), "utf-8");
    return [];
  }
}

function writeStore(leads: Lead[]): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  fs.writeFileSync(STORE_PATH, JSON.stringify(leads, null, 2), "utf-8");
}

export class FileContactStore {
  static getAll(): Lead[] {
    return ensureStoreExists();
  }

  static findById(id: string): Lead | null {
    const leads = ensureStoreExists();
    return leads.find((l) => l.id === id) || null;
  }

  static findByIdAndBusinessId(id: string, businessId: string): Lead | null {
    const leads = ensureStoreExists();
    return leads.find((l) => l.id === id && l.business_id === businessId) || null;
  }

  static findByBusinessId(businessId: string): Lead[] {
    const leads = ensureStoreExists();
    return leads
      .filter((l) => l.business_id === businessId)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }

  static findByEmail(businessId: string, email: string): Lead | null {
    const normalized = email.trim().toLowerCase();
    const leads = ensureStoreExists();
    return (
      leads.find(
        (l) => l.business_id === businessId && l.email.trim().toLowerCase() === normalized
      ) || null
    );
  }

  static create(data: Omit<Lead, "id" | "created_at" | "updated_at"> & { id?: string }): Lead {
    const leads = ensureStoreExists();
    const normalizedEmail = data.email.trim().toLowerCase();

    const now = new Date().toISOString();
    const newLead: Lead = {
      id: data.id || crypto.randomUUID(),
      business_id: data.business_id,
      first_name: data.first_name || null,
      last_name: data.last_name || null,
      email: normalizedEmail,
      phone: data.phone || null,
      company_name: data.company_name || null,
      job_title: data.job_title || null,
      industry: data.industry || null,
      website: data.website || null,
      source: data.source || "manual",
      status: (data.status ? data.status.toUpperCase() : "NEW") as LeadStatus,
      lead_score: data.lead_score ?? 0,
      owner_user_id: data.owner_user_id || null,
      metadata: data.metadata || {},
      created_at: now,
      updated_at: now,
    };

    leads.unshift(newLead);
    writeStore(leads);
    return newLead;
  }

  static update(id: string, patch: Partial<Lead>): Lead {
    const leads = ensureStoreExists();
    const idx = leads.findIndex((l) => l.id === id);
    if (idx === -1) {
      throw new Error(`Contact ${id} not found`);
    }

    const current = leads[idx];
    const updated: Lead = {
      ...current,
      ...patch,
      email: patch.email ? patch.email.trim().toLowerCase() : current.email,
      status: patch.status ? (patch.status.toUpperCase() as LeadStatus) : current.status,
      updated_at: new Date().toISOString(),
    };

    leads[idx] = updated;
    writeStore(leads);
    return updated;
  }

  static updateScoped(id: string, businessId: string, patch: Partial<Lead>): Lead | null {
    const leads = ensureStoreExists();
    const idx = leads.findIndex((l) => l.id === id && l.business_id === businessId);
    if (idx === -1) {
      return null;
    }

    const current = leads[idx];
    const updated: Lead = {
      ...current,
      ...patch,
      email: patch.email ? patch.email.trim().toLowerCase() : current.email,
      status: patch.status ? (patch.status.toUpperCase() as LeadStatus) : current.status,
      updated_at: new Date().toISOString(),
    };

    leads[idx] = updated;
    writeStore(leads);
    return updated;
  }

  static archive(id: string, businessId: string): boolean {
    const leads = ensureStoreExists();
    const idx = leads.findIndex((l) => l.id === id && l.business_id === businessId);
    if (idx === -1) return false;

    leads[idx].status = "ARCHIVED";
    leads[idx].updated_at = new Date().toISOString();
    writeStore(leads);
    return true;
  }

  static bulkUpdateStatus(businessId: string, ids: string[], status: string): number {
    const leads = ensureStoreExists();
    let count = 0;
    const now = new Date().toISOString();
    const targetStatus = status.toUpperCase() as LeadStatus;

    for (const lead of leads) {
      if (lead.business_id === businessId && ids.includes(lead.id)) {
        lead.status = targetStatus;
        lead.updated_at = now;
        count++;
      }
    }

    if (count > 0) writeStore(leads);
    return count;
  }

  static bulkArchive(businessId: string, ids: string[]): number {
    const leads = ensureStoreExists();
    let count = 0;
    const now = new Date().toISOString();

    for (const lead of leads) {
      if (lead.business_id === businessId && ids.includes(lead.id)) {
        lead.status = "ARCHIVED";
        lead.updated_at = now;
        count++;
      }
    }

    if (count > 0) writeStore(leads);
    return count;
  }

  static list(params: ContactListParams): ContactListResult {
    const {
      businessId,
      search = "",
      status = "",
      source = "",
      sortBy = "created_at",
      sortOrder = "desc",
      page = 1,
      limit = 10,
    } = params;

    let filtered = ensureStoreExists().filter((l) => l.business_id === businessId);

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      filtered = filtered.filter(
        (l) =>
          (l.first_name && l.first_name.toLowerCase().includes(q)) ||
          (l.last_name && l.last_name.toLowerCase().includes(q)) ||
          (l.email && l.email.toLowerCase().includes(q)) ||
          (l.company_name && l.company_name.toLowerCase().includes(q))
      );
    }

    if (status.trim()) {
      const target = status.trim().toUpperCase();
      filtered = filtered.filter((l) => l.status.toUpperCase() === target);
    }

    if (source.trim()) {
      const target = source.trim().toLowerCase();
      filtered = filtered.filter((l) => (l.source || "").toLowerCase() === target);
    }

    const total = filtered.length;

    // Sorting
    filtered.sort((a, b) => {
      const dir = sortOrder.toLowerCase() === "asc" ? 1 : -1;
      if (sortBy === "name") {
        const nameA = `${a.first_name || ""} ${a.last_name || ""}`.trim().toLowerCase();
        const nameB = `${b.first_name || ""} ${b.last_name || ""}`.trim().toLowerCase();
        return dir * nameA.localeCompare(nameB);
      } else if (sortBy === "lead_score") {
        return dir * ((a.lead_score ?? 0) - (b.lead_score ?? 0));
      } else {
        return dir * (new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      }
    });

    const offset = (page - 1) * limit;
    const data = filtered.slice(offset, offset + limit);

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  static exportAll(params: Omit<ContactListParams, "page" | "limit">): Lead[] {
    const {
      businessId,
      search = "",
      status = "",
      source = "",
      sortBy = "created_at",
      sortOrder = "desc",
    } = params;

    let filtered = ensureStoreExists().filter((l) => l.business_id === businessId);

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      filtered = filtered.filter(
        (l) =>
          (l.first_name && l.first_name.toLowerCase().includes(q)) ||
          (l.last_name && l.last_name.toLowerCase().includes(q)) ||
          (l.email && l.email.toLowerCase().includes(q)) ||
          (l.company_name && l.company_name.toLowerCase().includes(q))
      );
    }

    if (status.trim()) {
      const target = status.trim().toUpperCase();
      filtered = filtered.filter((l) => l.status.toUpperCase() === target);
    }

    if (source.trim()) {
      const target = source.trim().toLowerCase();
      filtered = filtered.filter((l) => (l.source || "").toLowerCase() === target);
    }

    filtered.sort((a, b) => {
      const dir = sortOrder.toLowerCase() === "asc" ? 1 : -1;
      if (sortBy === "name") {
        const nameA = `${a.first_name || ""} ${a.last_name || ""}`.trim().toLowerCase();
        const nameB = `${b.first_name || ""} ${b.last_name || ""}`.trim().toLowerCase();
        return dir * nameA.localeCompare(nameB);
      } else if (sortBy === "lead_score") {
        return dir * ((a.lead_score ?? 0) - (b.lead_score ?? 0));
      } else {
        return dir * (new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      }
    });

    return filtered;
  }

  static delete(id: string): boolean {
    const leads = ensureStoreExists();
    const idx = leads.findIndex((l) => l.id === id);
    if (idx === -1) return false;
    leads.splice(idx, 1);
    writeStore(leads);
    return true;
  }
}
