import { TemplateRepository, TemplateListParams, TemplateListResult } from "../repositories/template.repository";
import { EmailTemplate } from "@/types/database";
import {
  createTemplateSchema,
  updateTemplateSchema,
  CreateTemplateInput,
  UpdateTemplateInput,
} from "@/lib/validations/template";
import {
  extractVariables,
  renderTemplate,
  SAMPLE_PREVIEW_CONTACT,
  SAMPLE_PREVIEW_SENDER,
  TemplateContactContext,
  TemplateSenderContext,
  RenderedTemplateResult,
  sanitizeHtml,
} from "@/lib/utils/template";

export interface PreviewTemplateInput {
  subject: string;
  body: string;
  contact?: TemplateContactContext;
  sender?: TemplateSenderContext;
}

export class TemplateService {
  private repository: TemplateRepository;

  constructor(repository?: TemplateRepository) {
    this.repository = repository || new TemplateRepository();
  }

  /**
   * Retrieves a paginated list of templates scoped to a business.
   */
  async listTemplates(
    businessId: string,
    params: Omit<TemplateListParams, "businessId">
  ): Promise<TemplateListResult> {
    if (!businessId) {
      throw new Error("Business ID is required for multi-tenant isolation.");
    }
    return this.repository.list({ ...params, businessId });
  }

  /**
   * Retrieves a single template scoped strictly to the authenticated business.
   */
  async getTemplate(id: string, businessId: string): Promise<EmailTemplate> {
    if (!id || !businessId) {
      throw new Error("Template ID and Business ID are required.");
    }

    const template = await this.repository.findByIdAndBusinessId(id, businessId);
    if (!template) {
      throw new Error("Template not found or access denied.");
    }
    return template;
  }

  /**
   * Creates a new template scoped to the business.
   * Auto-extracts supported variables and sanitizes HTML body.
   */
  async createTemplate(
    businessId: string,
    rawInput: CreateTemplateInput
  ): Promise<EmailTemplate> {
    if (!businessId) {
      throw new Error("Business ID is required.");
    }

    const validation = createTemplateSchema.safeParse(rawInput);
    if (!validation.success) {
      const firstError = validation.error.issues[0]?.message || "Validation failed";
      throw new Error(firstError);
    }

    const { name, subject, body, status } = validation.data;

    // Sanitize HTML body to prevent XSS / script injection
    const cleanBody = sanitizeHtml(body);

    // Auto-detect and record supported variables from subject + body
    const detectedVariables = extractVariables(`${subject} ${cleanBody}`);

    return this.repository.create({
      business_id: businessId,
      name,
      subject,
      body: cleanBody,
      variables: detectedVariables,
      status: status || "active",
    });
  }

  /**
   * Updates an existing template belonging to the business.
   */
  async updateTemplate(
    id: string,
    businessId: string,
    rawInput: UpdateTemplateInput
  ): Promise<EmailTemplate> {
    if (!id || !businessId) {
      throw new Error("Template ID and Business ID are required.");
    }

    const validation = updateTemplateSchema.safeParse(rawInput);
    if (!validation.success) {
      const firstError = validation.error.issues[0]?.message || "Validation failed";
      throw new Error(firstError);
    }

    // Ensure template exists and belongs to this business
    const existing = await this.getTemplate(id, businessId);

    const updateData: Partial<EmailTemplate> = {};

    if (validation.data.name !== undefined) {
      updateData.name = validation.data.name;
    }

    if (validation.data.status !== undefined) {
      updateData.status = validation.data.status;
    }

    let nextSubject = existing.subject;
    if (validation.data.subject !== undefined) {
      updateData.subject = validation.data.subject;
      nextSubject = validation.data.subject;
    }

    let nextBody = existing.body;
    if (validation.data.body !== undefined) {
      const cleanBody = sanitizeHtml(validation.data.body);
      updateData.body = cleanBody;
      nextBody = cleanBody;
    }

    // Re-extract variables if either subject or body changed
    if (validation.data.subject !== undefined || validation.data.body !== undefined) {
      updateData.variables = extractVariables(`${nextSubject} ${nextBody}`);
    }

    return this.repository.update(id, businessId, updateData);
  }

  /**
   * Duplicates an existing template within the same business.
   */
  async duplicateTemplate(
    id: string,
    businessId: string,
    newName?: string
  ): Promise<EmailTemplate> {
    if (!id || !businessId) {
      throw new Error("Template ID and Business ID are required.");
    }

    // Validate ownership first
    const orig = await this.getTemplate(id, businessId);

    const copyName = newName?.trim() || `${orig.name} Copy`;
    return this.repository.duplicate(id, businessId, copyName);
  }

  /**
   * Soft-archives a template by marking its status as 'archived'.
   * Never physically deletes historical templates that may be referenced by campaigns.
   */
  async archiveTemplate(id: string, businessId: string): Promise<EmailTemplate> {
    if (!id || !businessId) {
      throw new Error("Template ID and Business ID are required.");
    }

    // Validate ownership first
    await this.getTemplate(id, businessId);

    return this.repository.archive(id, businessId);
  }

  /**
   * Renders a preview of a template with variable substitution and sanitization.
   * Uses sample contact/sender context when none are provided.
   */
  renderPreview(input: PreviewTemplateInput): RenderedTemplateResult {
    const contact = input.contact || SAMPLE_PREVIEW_CONTACT;
    const sender = input.sender || SAMPLE_PREVIEW_SENDER;

    return renderTemplate(
      {
        subject: input.subject || "",
        body: input.body || "",
      },
      contact,
      sender,
      { sanitize: true }
    );
  }
}

export const templateService = new TemplateService();
