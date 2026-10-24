import {
  LeadRepository,
  ContactListParams,
  ContactListResult,
  CreateLeadInput,
} from "../repositories/lead.repository";
import { SuppressionRepository } from "../repositories/suppression.repository";
import { ContactImportRepository } from "../repositories/contact-import.repository";
import { CampaignRepository } from "../repositories/campaign.repository";
import { SafetyAuditRepository } from "../repositories/safety-audit.repository";
import {
  Lead,
  LeadStatus,
  ContactImport,
  ContactImportError,
  ContactImportStatus,
  ContactImportMode,
  CsvPreviewResult,
  CsvPreviewFieldOption,
  CsvImportSummary,
  BulkEnrollPreviewResult,
} from "@/types/database";
import {
  CreateContactInput,
  UpdateContactInput,
  createContactSchema,
  updateContactSchema,
  ContactQueryParams,
  contactQuerySchema,
  normalizeLeadStatus,
  validateRowRange,
  ImportRangeType,
} from "@/lib/validations/contact";
import { toCsv, parseCsv, DEFAULT_COLUMN_ALIASES } from "@/lib/utils/csv";
import { campaignService } from "./campaign.service";

export interface CsvImportOptions {
  csvContent: string;
  filename?: string;
  columnMapping?: Record<string, string>;
  mode?: ContactImportMode;
  ownerUserId?: string;
  rangeType?: ImportRangeType;
  startRow?: number | string | null;
  endRow?: number | string | null;
}



export class ContactService {
  private leadRepo: LeadRepository;
  private suppressionRepo: SuppressionRepository;
  private contactImportRepo: ContactImportRepository;
  private campaignRepo: CampaignRepository;
  private safetyAuditRepo: SafetyAuditRepository;

  constructor(
    leadRepo?: LeadRepository,
    suppressionRepo?: SuppressionRepository,
    contactImportRepo?: ContactImportRepository,
    campaignRepo?: CampaignRepository,
    safetyAuditRepo?: SafetyAuditRepository
  ) {
    this.leadRepo = leadRepo || new LeadRepository();
    this.suppressionRepo = suppressionRepo || new SuppressionRepository();
    this.contactImportRepo = contactImportRepo || new ContactImportRepository();
    this.campaignRepo = campaignRepo || new CampaignRepository();
    this.safetyAuditRepo = safetyAuditRepo || new SafetyAuditRepository();
  }

  /**
   * Lists contacts with search, filtering, sorting, and pagination scoped to business
   */
  async listContacts(
    businessId: string,
    params: Partial<ContactQueryParams> = {}
  ): Promise<ContactListResult> {
    const validated = contactQuerySchema.parse(params);
    const listParams: ContactListParams = {
      businessId,
      search: validated.search,
      status: validated.status,
      source: validated.source,
      sortBy: validated.sortBy,
      sortOrder: validated.sortOrder,
      page: validated.page,
      limit: validated.limit,
    };
    return this.leadRepo.list(listParams);
  }

  /**
   * Retrieves single contact scoped to business
   */
  async getContact(businessId: string, id: string): Promise<Lead> {
    const contact = await this.leadRepo.findByIdAndBusinessId(id, businessId);
    if (!contact) {
      throw new Error("Contact not found");
    }
    return contact;
  }

  /**
   * Retrieves campaign enrollments for a contact scoped to business
   */
  async getContactCampaigns(
    businessId: string,
    leadId: string
  ): Promise<
    Array<{
      id: string;
      campaign_id: string;
      campaign_name: string;
      status: string;
      current_step: number | null;
      enrolled_at: string;
      completed_at: string | null;
    }>
  > {
    await this.getContact(businessId, leadId);

    try {
      const { query, isDbConfigured } = await import("../db/client");
      if (isDbConfigured()) {
        const sql = `
          SELECT 
            cl.id,
            cl.campaign_id,
            c.name AS campaign_name,
            cl.status,
            cl.current_step,
            cl.enrolled_at,
            cl.completed_at
          FROM campaign_leads cl
          JOIN campaigns c ON c.id = cl.campaign_id
          WHERE cl.business_id = $1 AND cl.lead_id = $2
          ORDER BY cl.enrolled_at DESC;
        `;
        const res = await query(sql, [businessId, leadId]);
        return (res.rows as Array<Record<string, unknown>>).map((r) => ({
          id: String(r.id),
          campaign_id: String(r.campaign_id),
          campaign_name: String(r.campaign_name || "Campaign"),
          status: String(r.status || "ENROLLED").toUpperCase(),
          current_step: r.current_step ? Number(r.current_step) : null,
          enrolled_at: new Date(String(r.enrolled_at)).toISOString(),
          completed_at: r.completed_at ? new Date(String(r.completed_at)).toISOString() : null,
        }));
      }
    } catch {
      // Fallback
    }

    try {
      const fs = await import("fs");
      const path = await import("path");
      const pCamp = path.resolve(process.cwd(), ".data/campaigns.json");
      const pEnroll = path.resolve(process.cwd(), ".data/campaign_leads.json");

      let rawCamp: Record<string, unknown> | null = null;
      if (fs.existsSync(pCamp)) {
        try {
          rawCamp = JSON.parse(fs.readFileSync(pCamp, "utf-8"));
        } catch {}
      }

      const camps: Array<{ id: string; name: string }> = Array.isArray(rawCamp)
        ? (rawCamp as unknown as Array<{ id: string; name: string }>)
        : rawCamp && Array.isArray(rawCamp.campaigns)
        ? (rawCamp.campaigns as Array<{ id: string; name: string }>)
        : [];

      let rawEnroll: unknown[] = [];
      if (rawCamp && Array.isArray(rawCamp.enrollments)) {
        rawEnroll = rawCamp.enrollments;
      } else if (fs.existsSync(pEnroll)) {
        try {
          const parsed = JSON.parse(fs.readFileSync(pEnroll, "utf-8"));
          if (Array.isArray(parsed)) rawEnroll = parsed;
        } catch {}
      }

      const enrollments: Array<{
        id: string;
        campaign_id: string;
        business_id?: string;
        lead_id: string;
        status?: string;
        current_step?: number;
        enrolled_at?: string;
        created_at?: string;
        completed_at?: string;
      }> = rawEnroll as unknown as Array<{
        id: string;
        campaign_id: string;
        business_id?: string;
        lead_id: string;
        status?: string;
        current_step?: number;
        enrolled_at?: string;
        created_at?: string;
        completed_at?: string;
      }>;

      return enrollments
        .filter((e) => (!e.business_id || e.business_id === businessId) && e.lead_id === leadId)
        .map((e) => {
          const c = camps.find((camp) => camp.id === e.campaign_id);
          return {
            id: String(e.id),
            campaign_id: String(e.campaign_id),
            campaign_name: c?.name || "Campaign",
            status: String(e.status || "ENROLLED").toUpperCase(),
            current_step: e.current_step ?? null,
            enrolled_at: e.enrolled_at || e.created_at || new Date().toISOString(),
            completed_at: e.completed_at || null,
          };
        });
    } catch {
      // Fallback
    }

    return [];
  }

  /**
   * Creates a new contact with duplicate email prevention per business
   */
  async createContact(
    businessId: string,
    input: CreateContactInput,
    ownerUserId?: string
  ): Promise<Lead> {
    const validated = createContactSchema.parse(input);
    const normalizedEmail = validated.email.trim().toLowerCase();

    // Check duplicate within business
    const existing = await this.leadRepo.findByEmail(businessId, normalizedEmail);
    if (existing) {
      throw new Error(`A contact with email "${normalizedEmail}" already exists.`);
    }

    return this.leadRepo.create({
      business_id: businessId,
      first_name: validated.first_name || null,
      last_name: validated.last_name || null,
      email: normalizedEmail,
      phone: validated.phone || null,
      company_name: validated.company_name || null,
      job_title: validated.job_title || null,
      industry: validated.industry || null,
      website: validated.website || null,
      source: validated.source || "manual",
      status: (validated.status || "NEW") as LeadStatus,
      lead_score: validated.lead_score ?? 0,
      owner_user_id: ownerUserId || null,
      metadata: validated.metadata || {},
    });
  }

  /**
   * Updates an existing contact scoped to business
   */
  async updateContact(
    businessId: string,
    id: string,
    input: UpdateContactInput
  ): Promise<Lead> {
    const validated = updateContactSchema.parse(input);

    const existing = await this.leadRepo.findByIdAndBusinessId(id, businessId);
    if (!existing) {
      throw new Error("Contact not found");
    }

    if (validated.email && validated.email.toLowerCase() !== existing.email.toLowerCase()) {
      const conflict = await this.leadRepo.findByEmail(businessId, validated.email);
      if (conflict && conflict.id !== id) {
        throw new Error(`A contact with email "${validated.email}" already exists.`);
      }
    }

    const updated = await this.leadRepo.updateScoped(id, businessId, validated as Partial<Lead>);
    if (!updated) {
      throw new Error("Failed to update contact");
    }
    return updated;
  }

  /**
   * Soft-deletes a contact by marking status as 'archived'
   */
  async archiveContact(businessId: string, id: string): Promise<boolean> {
    const existing = await this.leadRepo.findByIdAndBusinessId(id, businessId);
    if (!existing) {
      throw new Error("Contact not found");
    }
    return this.leadRepo.archive(id, businessId);
  }

  /**
   * Permanently deletes a contact and cascades dependent records (enrollments, conversations, etc.)
   */
  async deleteContact(businessId: string, id: string): Promise<boolean> {
    const existing = await this.leadRepo.findByIdAndBusinessId(id, businessId);
    if (!existing) {
      throw new Error("Contact not found");
    }
    return this.leadRepo.deletePermanent(id, businessId);
  }

  /**
   * Bulk updates contact status scoped to business
   */
  async bulkUpdateStatus(
    businessId: string,
    ids: string[],
    status: string
  ): Promise<{ updatedCount: number }> {
    if (!ids || ids.length === 0) {
      return { updatedCount: 0 };
    }
    const count = await this.leadRepo.bulkUpdateStatus(businessId, ids, status.toUpperCase());
    return { updatedCount: count };
  }

  /**
   * Bulk archives contacts scoped to business
   */
  async bulkArchive(businessId: string, ids: string[]): Promise<{ archivedCount: number }> {
    if (!ids || ids.length === 0) {
      return { archivedCount: 0 };
    }
    const count = await this.leadRepo.bulkArchive(businessId, ids);
    return { archivedCount: count };
  }

  /**
   * Bulk permanently deletes contacts scoped to business, cascading dependent records
   */
  async bulkDeletePermanent(businessId: string, ids: string[]): Promise<{ deletedCount: number }> {
    if (!ids || ids.length === 0) {
      return { deletedCount: 0 };
    }
    const count = await this.leadRepo.deletePermanentBulk(ids, businessId);
    return { deletedCount: count };
  }

  /**
   * Exports filtered contacts as RFC-4180 CSV string
   */
  async exportCsv(
    businessId: string,
    params: Partial<Omit<ContactQueryParams, "page" | "limit">> = {}
  ): Promise<string> {
    const contacts = await this.leadRepo.exportAll({
      businessId,
      search: params.search,
      status: params.status,
      source: params.source,
      sortBy: params.sortBy,
      sortOrder: params.sortOrder,
    });

    const headers = [
      "ID",
      "First Name",
      "Last Name",
      "Email",
      "Phone",
      "Company",
      "Job Title",
      "Industry",
      "Website",
      "Source",
      "Status",
      "Lead Score",
      "Created At",
    ];

    const rows = contacts.map((c) => [
      c.id,
      c.first_name || "",
      c.last_name || "",
      c.email,
      c.phone || "",
      c.company_name || "",
      c.job_title || "",
      c.industry || "",
      c.website || "",
      c.source || "",
      c.status,
      c.lead_score,
      c.created_at,
    ]);

    return toCsv(headers, rows);
  }

  /**
   * Generates a preview of the uploaded CSV with automatic column mapping detection.
   */
  async previewCsv(
    businessId: string,
    csvContent: string,
    filename = "contacts.csv",
    rangeOptions?: {
      rangeType?: "all" | "range";
      startRow?: number | string | null;
      endRow?: number | string | null;
    }
  ): Promise<CsvPreviewResult> {
    const maxMb = parseInt(process.env.CONTACT_IMPORT_MAX_FILE_MB || "10", 10);
    const maxBytes = maxMb * 1024 * 1024;
    if (Buffer.byteLength(csvContent, "utf-8") > maxBytes) {
      throw new Error(`File size exceeds maximum allowed limit of ${maxMb}MB.`);
    }

    if (!csvContent || !csvContent.trim()) {
      throw new Error("CSV file is empty.");
    }

    let parsed: string[][];
    try {
      parsed = parseCsv(csvContent);
    } catch (err: unknown) {
      throw new Error(err instanceof Error ? err.message : "Malformed CSV file.");
    }

    if (parsed.length === 0) {
      throw new Error("CSV file contains no rows.");
    }

    const rawHeaders = parsed[0].map((h) => h.trim());
    if (rawHeaders.length === 0 || rawHeaders.every((h) => !h)) {
      throw new Error("CSV file has missing or empty header row.");
    }

    const dataRows = parsed.slice(1).filter((r) => r.some((c) => c && c.trim().length > 0));

    const detectedMapping: Record<string, string> = {};
    for (const h of rawHeaders) {
      const norm = h.toLowerCase().trim();
      if (DEFAULT_COLUMN_ALIASES[norm]) {
        detectedMapping[h] = DEFAULT_COLUMN_ALIASES[norm];
      }
    }

    const previewCount = Math.min(20, dataRows.length);
    const previewRows: Record<string, string>[] = [];
    for (let i = 0; i < previewCount; i++) {
      const row = dataRows[i];
      const obj: Record<string, string> = {};
      for (let c = 0; c < rawHeaders.length; c++) {
        const headerName = rawHeaders[c];
        obj[headerName] = (row[c] || "").trim();
      }
      previewRows.push(obj);
    }

    const availableFields: CsvPreviewFieldOption[] = [
      { key: "email", label: "Email (Required)", required: true },
      { key: "first_name", label: "First Name" },
      { key: "last_name", label: "Last Name" },
      { key: "company_name", label: "Company" },
      { key: "phone", label: "Phone" },
      { key: "job_title", label: "Job Title" },
      { key: "industry", label: "Industry" },
      { key: "website", label: "Website" },
      { key: "lead_score", label: "Lead Score" },
      { key: "status", label: "Status" },
    ];

    let rangePreview: import("@/types/database").ContactRangePreview | undefined;
    if (dataRows.length > 0) {
      const v = validateRowRange(dataRows.length, rangeOptions);
      const effectiveStart = v.isValid && v.startRow ? v.startRow : 1;
      const effectiveEnd = v.isValid && v.endRow ? v.endRow : dataRows.length;
      const firstRowIdx = Math.max(0, effectiveStart - 1);
      const lastRowIdx = Math.min(dataRows.length - 1, effectiveEnd - 1);

      const firstRowObj: Record<string, string> = {};
      const lastRowObj: Record<string, string> = {};
      if (dataRows[firstRowIdx]) {
        for (let c = 0; c < rawHeaders.length; c++) {
          firstRowObj[rawHeaders[c]] = (dataRows[firstRowIdx][c] || "").trim();
        }
      }
      if (dataRows[lastRowIdx]) {
        for (let c = 0; c < rawHeaders.length; c++) {
          lastRowObj[rawHeaders[c]] = (dataRows[lastRowIdx][c] || "").trim();
        }
      }

      rangePreview = {
        startRow: effectiveStart,
        endRow: effectiveEnd,
        totalSelected: Math.max(0, effectiveEnd - effectiveStart + 1),
        totalAvailable: dataRows.length,
        firstContact: firstRowObj,
        lastContact: lastRowObj,
      };
    }

    return {
      filename,
      totalRows: dataRows.length,
      headers: rawHeaders,
      previewRows,
      detectedMapping,
      availableFields,
      range: rangePreview,
    };
  }

  /**
   * Imports contacts from CSV with column mapping, duplicate detection, suppression check,
   * batching, and import history persistence.
   */
  async importCsv(
    businessId: string,
    optionsOrCsv: string | CsvImportOptions,
    ownerUserIdArg?: string
  ): Promise<CsvImportSummary> {
    const options: CsvImportOptions =
      typeof optionsOrCsv === "string"
        ? { csvContent: optionsOrCsv, ownerUserId: ownerUserIdArg }
        : optionsOrCsv;

    const {
      csvContent,
      filename = "contacts.csv",
      columnMapping,
      mode = "CREATE_ONLY",
      ownerUserId,
      rangeType = "all",
      startRow: rawStartRow,
      endRow: rawEndRow,
    } = options;

    const maxMb = parseInt(process.env.CONTACT_IMPORT_MAX_FILE_MB || "10", 10);
    const maxBytes = maxMb * 1024 * 1024;
    if (Buffer.byteLength(csvContent, "utf-8") > maxBytes) {
      throw new Error(`File size exceeds maximum allowed limit of ${maxMb}MB.`);
    }

    if (!csvContent || !csvContent.trim()) {
      throw new Error("CSV file is empty.");
    }

    let parsed: string[][];
    try {
      parsed = parseCsv(csvContent);
    } catch (err: unknown) {
      throw new Error(err instanceof Error ? err.message : "Malformed CSV file.");
    }

    if (parsed.length === 0) {
      throw new Error("CSV file contains no rows.");
    }

    const rawHeaders = parsed[0].map((h) => h.trim());
    if (rawHeaders.length === 0 || rawHeaders.every((h) => !h)) {
      throw new Error("CSV file has missing or empty header row.");
    }

    const dataRows = parsed.slice(1).filter((r) => r.some((c) => c && c.trim().length > 0));

    if (dataRows.length === 0) {
      throw new Error("CSV file contains no data rows.");
    }

    // SERVER-SIDE RANGE VALIDATION & ENFORCEMENT
    // Do not trust only the frontend range
    const rangeValidation = validateRowRange(dataRows.length, {
      rangeType,
      startRow: rawStartRow,
      endRow: rawEndRow,
    });

    if (!rangeValidation.isValid) {
      throw new Error(rangeValidation.error || "Invalid row range selection.");
    }

    const effectiveStartRow = rangeValidation.startRow || 1;
    const effectiveEndRow = rangeValidation.endRow || dataRows.length;
    const startIndex = effectiveStartRow - 1; // 0-based index
    const endIndex = effectiveEndRow; // 0-based slice limit
    const selectedDataRows = dataRows.slice(startIndex, endIndex);

    if (selectedDataRows.length === 0) {
      throw new Error("Selected row range contains no data rows.");
    }

    // Determine effective mapping
    const effectiveMapping: Record<string, string> = {};
    if (columnMapping && Object.keys(columnMapping).length > 0) {
      for (const [col, field] of Object.entries(columnMapping)) {
        if (field && field !== "ignore" && field !== "none") {
          effectiveMapping[col.trim()] = field.trim().toLowerCase();
        }
      }
    } else {
      for (const h of rawHeaders) {
        const norm = h.toLowerCase().trim();
        if (DEFAULT_COLUMN_ALIASES[norm]) {
          effectiveMapping[h] = DEFAULT_COLUMN_ALIASES[norm];
        }
      }
    }

    // Verify EMAIL mapping is present
    const emailMapped = Object.values(effectiveMapping).some((field) => field === "email");
    if (!emailMapped) {
      throw new Error("Email column mapping is required.");
    }

    // Create import history record in PROCESSING state
    const importRecord = await this.contactImportRepo.create({
      business_id: businessId,
      filename,
      total_rows: selectedDataRows.length,
      status: "PROCESSING",
    });

    // Audit log: import_started
    try {
      await this.safetyAuditRepo.createLog({
        business_id: businessId,
        event_type: "import_started",
        reason: `Started import of ${filename} (${selectedDataRows.length} rows, range: ${effectiveStartRow}-${effectiveEndRow})`,
        metadata: {
          importId: importRecord.id,
          filename,
          totalRows: selectedDataRows.length,
          totalAvailable: dataRows.length,
          startRow: effectiveStartRow,
          endRow: effectiveEndRow,
          rangeType,
          mode,
        },
      });
    } catch {
      // Non-blocking
    }

    const batchSize = parseInt(process.env.CONTACT_IMPORT_BATCH_SIZE || "500", 10);
    const seenEmailsInCurrentImport = new Set<string>();
    const rejectedRows: ContactImportError[] = [];
    let importedCount = 0;
    let duplicateCount = 0;
    let invalidCount = 0;
    let suppressedCount = 0;
    let failedCount = 0;

    for (let batchStart = 0; batchStart < selectedDataRows.length; batchStart += batchSize) {
      const batch = selectedDataRows.slice(batchStart, batchStart + batchSize);

      interface CandidateRow {
        rowNumber: number;
        rowObj: Record<string, string>;
        mapped: Record<string, string>;
        rawEmail: string;
        normalizedEmail: string;
      }

      const candidateRows: CandidateRow[] = [];

      // 1. Initial row parsing and syntax validation (purely in-memory)
      for (let i = 0; i < batch.length; i++) {
        const row = batch[i];
        const origDataRowIndex = startIndex + batchStart + i;
        const rowNumber = origDataRowIndex + 2; // +1 for 0-index, +1 for header line
        const rowObj: Record<string, string> = {};
        const mapped: Record<string, string> = {};

        for (let c = 0; c < rawHeaders.length; c++) {
          const headerName = rawHeaders[c];
          const val = (row[c] || "").trim();
          rowObj[headerName] = val;
          const targetField = effectiveMapping[headerName];
          if (targetField) {
            mapped[targetField] = val;
          }
        }

        // Handle full_name splitting if first/last not explicitly provided
        if (!mapped.first_name && mapped.full_name) {
          const parts = mapped.full_name.trim().split(/\s+/);
          mapped.first_name = parts[0] || "";
          mapped.last_name = parts.slice(1).join(" ");
        }

        const rawEmail = mapped.email ? mapped.email.trim() : "";

        // Presence check
        if (!rawEmail) {
          invalidCount++;
          rejectedRows.push({
            row: rowNumber,
            email: "",
            reason: "Email is missing or empty",
            data: rowObj,
          });
          continue;
        }

        const normalizedEmail = rawEmail.toLowerCase();

        // Format validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(normalizedEmail)) {
          invalidCount++;
          rejectedRows.push({
            row: rowNumber,
            email: rawEmail,
            reason: `Invalid email format: "${rawEmail}"`,
            data: rowObj,
          });
          continue;
        }

        // Duplicate within the CSV file
        if (seenEmailsInCurrentImport.has(normalizedEmail)) {
          duplicateCount++;
          rejectedRows.push({
            row: rowNumber,
            email: normalizedEmail,
            reason: `Duplicate email inside CSV batch: "${rawEmail}"`,
            data: rowObj,
          });
          continue;
        }
        seenEmailsInCurrentImport.add(normalizedEmail);

        candidateRows.push({
          rowNumber,
          rowObj,
          mapped,
          rawEmail,
          normalizedEmail,
        });
      }

      if (candidateRows.length === 0) {
        continue;
      }

      // 2. Batch suppression check
      const candidateEmails = candidateRows.map((c) => c.normalizedEmail);
      const suppressedSet = await this.suppressionRepo.findSuppressedEmails(
        businessId,
        candidateEmails
      );

      const nonSuppressedCandidates: CandidateRow[] = [];
      for (const candidate of candidateRows) {
        if (suppressedSet.has(candidate.normalizedEmail)) {
          suppressedCount++;
          rejectedRows.push({
            row: candidate.rowNumber,
            email: candidate.normalizedEmail,
            reason: `Recipient email "${candidate.rawEmail}" is suppressed`,
            data: candidate.rowObj,
          });
        } else {
          nonSuppressedCandidates.push(candidate);
        }
      }

      if (nonSuppressedCandidates.length === 0) {
        continue;
      }

      // 3. Batch find existing leads in business
      const nonSuppressedEmails = nonSuppressedCandidates.map((c) => c.normalizedEmail);
      const existingLeads = await this.leadRepo.findByEmails(businessId, nonSuppressedEmails);
      const existingMap = new Map(existingLeads.map((l) => [l.email.toLowerCase(), l]));

      interface ToInsertItem {
        candidate: CandidateRow;
        leadInput: CreateLeadInput;
      }

      const toInsertList: ToInsertItem[] = [];

      for (const candidate of nonSuppressedCandidates) {
        const existing = existingMap.get(candidate.normalizedEmail);

        if (existing) {
          if (mode === "CREATE_OR_UPDATE") {
            try {
              const patch: Partial<Lead> = {};
              if (candidate.mapped.first_name) patch.first_name = candidate.mapped.first_name;
              if (candidate.mapped.last_name) patch.last_name = candidate.mapped.last_name;
              if (candidate.mapped.phone) patch.phone = candidate.mapped.phone;
              if (candidate.mapped.company_name) patch.company_name = candidate.mapped.company_name;
              if (candidate.mapped.job_title) patch.job_title = candidate.mapped.job_title;
              if (candidate.mapped.industry) patch.industry = candidate.mapped.industry;
              if (candidate.mapped.website) patch.website = candidate.mapped.website;
              await this.leadRepo.updateScoped(existing.id, businessId, patch);
              importedCount++;
            } catch (err: unknown) {
              failedCount++;
              rejectedRows.push({
                row: candidate.rowNumber,
                email: candidate.normalizedEmail,
                reason: err instanceof Error ? err.message : "Failed to update existing contact",
                data: candidate.rowObj,
              });
            }
          } else {
            duplicateCount++;
            rejectedRows.push({
              row: candidate.rowNumber,
              email: candidate.normalizedEmail,
              reason: `Contact with email "${candidate.rawEmail}" already exists in your business`,
              data: candidate.rowObj,
            });
          }
        } else {
          let score = 0;
          if (candidate.mapped.lead_score) {
            const parsedScore = parseInt(candidate.mapped.lead_score, 10);
            if (!isNaN(parsedScore)) {
              score = Math.max(0, Math.min(100, parsedScore));
            }
          }

          toInsertList.push({
            candidate,
            leadInput: {
              business_id: businessId,
              first_name: candidate.mapped.first_name || null,
              last_name: candidate.mapped.last_name || null,
              email: candidate.normalizedEmail,
              phone: candidate.mapped.phone || null,
              company_name: candidate.mapped.company_name || null,
              job_title: candidate.mapped.job_title || null,
              industry: candidate.mapped.industry || null,
              website: candidate.mapped.website || null,
              source: candidate.mapped.source || "csv_import",
              status: normalizeLeadStatus(candidate.mapped.status),
              lead_score: score,
              owner_user_id: ownerUserId || null,
              metadata: {
                imported_from_csv: true,
                import_id: importRecord.id,
                ...(candidate.mapped.status ? { original_csv_status: candidate.mapped.status } : {}),
              },
            },
          });
        }
      }

      // 4. Batch insert new leads
      if (toInsertList.length > 0) {
        try {
          const inserted = await this.leadRepo.bulkCreate(
            businessId,
            toInsertList.map((item) => item.leadInput)
          );
          importedCount += inserted.length;
        } catch {
          // Fallback to row-by-row on unexpected batch failure
          for (const item of toInsertList) {
            try {
              await this.leadRepo.create(item.leadInput);
              importedCount++;
            } catch (err: unknown) {
              failedCount++;
              rejectedRows.push({
                row: item.candidate.rowNumber,
                email: item.candidate.normalizedEmail,
                reason: err instanceof Error ? err.message : "Database insertion failed",
                data: item.candidate.rowObj,
              });
            }
          }
        }
      }
    }

    // Determine final status
    let finalStatus: ContactImportStatus = "COMPLETED";
    if (failedCount > 0 && importedCount > 0) {
      finalStatus = "PARTIAL";
    } else if (failedCount > 0 && importedCount === 0 && selectedDataRows.length > 0) {
      finalStatus = "FAILED";
    }

    // Update contact_imports record
    await this.contactImportRepo.update(importRecord.id, businessId, {
      total_rows: selectedDataRows.length,
      imported_count: importedCount,
      duplicate_count: duplicateCount,
      invalid_count: invalidCount,
      suppressed_count: suppressedCount,
      failed_count: failedCount,
      status: finalStatus,
      errors: rejectedRows,
      completed_at: new Date().toISOString(),
    });

    // Safety audit log: import_completed / import_failed
    try {
      await this.safetyAuditRepo.createLog({
        business_id: businessId,
        event_type: finalStatus === "FAILED" ? "import_failed" : "import_completed",
        reason: `Import ${finalStatus.toLowerCase()}: ${importedCount} imported, ${duplicateCount} duplicates, ${invalidCount} invalid, ${suppressedCount} suppressed, ${failedCount} failed`,
        metadata: {
          importId: importRecord.id,
          filename,
          totalRows: selectedDataRows.length,
          totalAvailable: dataRows.length,
          startRow: effectiveStartRow,
          endRow: effectiveEndRow,
          rangeType,
          importedCount,
          duplicateCount,
          invalidCount,
          suppressedCount,
          failedCount,
          status: finalStatus,
        },
      });
    } catch {
      // Non-blocking
    }

    // Generate rejected CSV string with sanitized values
    let rejectedCsv: string | undefined;
    if (rejectedRows.length > 0) {
      const rejHeaders = ["Row", "Email", "Reason"];
      const rejRows = rejectedRows.map((r) => [r.row, r.email || "", r.reason]);
      rejectedCsv = toCsv(rejHeaders, rejRows);
    }

    return {
      totalRows: selectedDataRows.length,
      validRows: importedCount,
      importedCount,
      skippedCount: duplicateCount + invalidCount + suppressedCount + failedCount,
      duplicateCount,
      invalidCount,
      suppressedCount,
      failedCount,
      status: finalStatus,
      rejectedRows,
      rejectedCsv,
      range: {
        type: rangeType === "range" ? "range" : "all",
        startRow: effectiveStartRow,
        endRow: effectiveEndRow,
        totalAvailable: dataRows.length,
      },
    };
  }

  /**
   * Retrieves import history for the specified business.
   */
  async getImportHistory(
    businessId: string,
    limit = 50,
    offset = 0
  ): Promise<{ data: ContactImport[]; total: number }> {
    return this.contactImportRepo.listByBusinessId(businessId, limit, offset);
  }

  /**
   * Retrieves a specific import record by ID scoped to business.
   */
  async getImportById(id: string, businessId: string): Promise<ContactImport> {
    const item = await this.contactImportRepo.findByIdAndBusinessId(id, businessId);
    if (!item) {
      throw new Error("Contact import not found or access denied.");
    }
    return item;
  }

  /**
   * Retrieves the failed/rejected rows for a specific import.
   */
  async getImportErrors(id: string, businessId: string): Promise<ContactImportError[]> {
    const item = await this.getImportById(id, businessId);
    return item.errors || [];
  }

  /**
   * Generates a downloadable CSV containing the failed rows for an import.
   */
  async exportImportErrorsCsv(
    id: string,
    businessId: string
  ): Promise<{ filename: string; csv: string }> {
    const item = await this.getImportById(id, businessId);
    const errors = item.errors || [];
    const headers = ["Row", "Email", "Reason"];
    const rows = errors.map((e) => [e.row, e.email || "", e.reason]);
    const csv = toCsv(headers, rows);
    return {
      filename: `import_${id}_errors.csv`,
      csv,
    };
  }

  /**
   * Previews bulk enrollment for selected contacts into a campaign without enrolling them.
   */
  async bulkEnrollPreview(
    businessId: string,
    campaignId: string,
    contactIds: string[]
  ): Promise<BulkEnrollPreviewResult> {
    const campaign = await this.campaignRepo.findByIdAndBusinessId(campaignId, businessId);
    if (!campaign) {
      throw new Error("Campaign not found or access denied.");
    }

    const existingEnrollments = await this.campaignRepo.findEnrollments(campaignId, businessId, {
      limit: 10000,
    });
    const enrolledLeadIds = new Set<string>();
    const enrolledEmails = new Set<string>();
    for (const item of existingEnrollments.data) {
      enrolledLeadIds.add(item.lead_id);
      if (item.lead?.email) {
        enrolledEmails.add(item.lead.email.trim().toLowerCase());
      }
    }

    let suppressedCount = 0;
    let alreadyEnrolledCount = 0;
    let eligibleCount = 0;

    for (const cid of contactIds) {
      const contact = await this.leadRepo.findByIdAndBusinessId(cid, businessId);
      if (!contact || !contact.email) {
        continue;
      }

      const normEmail = contact.email.trim().toLowerCase();

      // Check suppression
      const isSuppressed = await this.suppressionRepo.isSuppressed(businessId, normEmail);
      if (isSuppressed) {
        suppressedCount++;
        continue;
      }

      // Check already enrolled
      if (enrolledLeadIds.has(cid) || enrolledEmails.has(normEmail)) {
        alreadyEnrolledCount++;
        continue;
      }

      eligibleCount++;
    }

    return {
      totalSelected: contactIds.length,
      eligibleCount,
      suppressedCount,
      alreadyEnrolledCount,
    };
  }

  /**
   * Executes bulk enrollment of selected contacts into a campaign.
   */
  async bulkEnroll(
    businessId: string,
    campaignId: string,
    contactIds: string[]
  ): Promise<{ enrolledCount: number; skippedCount: number; message: string }> {
    const campaign = await this.campaignRepo.findByIdAndBusinessId(campaignId, businessId);
    if (!campaign) {
      throw new Error("Campaign not found or access denied.");
    }

    // Audit log: bulk_enrollment_started
    try {
      await this.safetyAuditRepo.createLog({
        business_id: businessId,
        campaign_id: campaignId,
        event_type: "bulk_enrollment_started",
        reason: `Bulk enrollment started for ${contactIds.length} contact(s)`,
        metadata: { campaignId, totalSelected: contactIds.length },
      });
    } catch {
      // Non-blocking
    }

    const result = await campaignService.enrollContacts(campaignId, businessId, contactIds, {
      allowOverride: true,
    });

    // Audit log: bulk_enrollment_completed
    try {
      await this.safetyAuditRepo.createLog({
        business_id: businessId,
        campaign_id: campaignId,
        event_type: "bulk_enrollment_completed",
        reason: `Bulk enrollment completed: ${result.enrolledCount} enrolled, ${result.skippedCount} skipped`,
        metadata: {
          campaignId,
          enrolledCount: result.enrolledCount,
          skippedCount: result.skippedCount,
        },
      });
    } catch {
      // Non-blocking
    }

    return {
      ...result,
      message: `Successfully enrolled ${result.enrolledCount} contact(s). ${result.skippedCount > 0 ? `(${result.skippedCount} skipped)` : ""}`,
    };
  }
}

export const contactService = new ContactService();
