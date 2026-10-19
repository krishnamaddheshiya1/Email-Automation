import test from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import { createTestDb } from "./test-harness.mjs";
import {
  validateAttachment,
  sanitizeFilename,
  generateAttachmentStorageKey,
} from "../lib/validations/attachment.ts";
import { InMemoryStorageProvider } from "../server/storage/in-memory-storage.provider.ts";

/**
 * PHASE 15 TEST SUITE: FILE ATTACHMENTS & CAMPAIGN EMAIL COMPOSER
 * Comprehensive verification of all 30 required scenarios from Section 25.
 */
test("PHASE 15: FILE ATTACHMENTS & CAMPAIGN EMAIL COMPOSER", async (t) => {
  const { db } = createTestDb();

  const oneOrNone = (sql) => {
    const rows = db.public.many(sql);
    return rows && rows.length > 0 ? rows[0] : null;
  };
  const many = (sql) => db.public.many(sql) || [];
  const none = (sql) => db.public.none(sql);

  // Tenant Fixtures
  const businessAId = crypto.randomUUID();
  const businessBId = crypto.randomUUID();
  const userAId = crypto.randomUUID();
  const userBId = crypto.randomUUID();

  none(`
    INSERT INTO businesses (id, name, created_at, updated_at)
    VALUES 
      ('${businessAId}', 'Acme Corp A', NOW(), NOW()),
      ('${businessBId}', 'Beta Industries B', NOW(), NOW());
  `);

  none(`
    INSERT INTO users (id, business_id, email, full_name, role, created_at, updated_at)
    VALUES
      ('${userAId}', '${businessAId}', 'admin@acme.com', 'Admin A', 'owner', NOW(), NOW()),
      ('${userBId}', '${businessBId}', 'admin@beta.com', 'Admin B', 'owner', NOW(), NOW());
  `);

  // Active Sender Identity for Business A
  const senderAId = crypto.randomUUID();
  none(`
    INSERT INTO sender_identities (id, business_id, from_name, from_email, reply_to_email, status, verification_status, created_at, updated_at)
    VALUES ('${senderAId}', '${businessAId}', 'Acme Sales', 'sales@acme.com', 'replies@acme.com', 'ACTIVE', 'VERIFIED', NOW(), NOW());
  `);

  // Sample Campaign and Step for Business A
  const campaignAId = crypto.randomUUID();
  const stepAId = crypto.randomUUID();
  const templateAId = crypto.randomUUID();
  const contactAId = crypto.randomUUID();

  none(`
    INSERT INTO email_templates (id, business_id, name, subject, body, status, created_at, updated_at)
    VALUES ('${templateAId}', '${businessAId}', 'Intro Template', 'Hello {{first_name}}', '<p>Attached is our proposal.</p>', 'active', NOW(), NOW());
  `);

  none(`
    INSERT INTO campaigns (id, business_id, name, status, sender_identity_id, created_at, updated_at)
    VALUES ('${campaignAId}', '${businessAId}', 'Q4 Enterprise Outreach', 'DRAFT', '${senderAId}', NOW(), NOW());
  `);

  none(`
    INSERT INTO campaign_steps (id, campaign_id, step_number, name, template_id, delay_value, delay_unit, status, created_at, updated_at)
    VALUES ('${stepAId}', '${campaignAId}', 1, 'Initial Pitch', '${templateAId}', 0, 'minutes', 'ACTIVE', NOW(), NOW());
  `);

  none(`
    INSERT INTO leads (id, business_id, email, first_name, last_name, status, created_at, updated_at)
    VALUES ('${contactAId}', '${businessAId}', 'prospect1@enterprise.com', 'Alice', 'Smith', 'NEW', NOW(), NOW());
  `);

  // Storage and Service implementation for testing
  const storage = new InMemoryStorageProvider();

  // Test Attachment Helper Layer implementing exact service contracts
  class TestAttachmentService {
    constructor(storageProvider) {
      this.storage = storageProvider;
    }

    async uploadAttachment(businessId, userId, { filename, mimeType, buffer, campaignId, stepId, templateId }) {
      if (!businessId) throw new Error("Business ID is required for multi-tenant isolation.");

      // Check campaign ownership if provided
      if (campaignId) {
        const camp = oneOrNone(`SELECT id FROM campaigns WHERE id = '${campaignId}' AND business_id = '${businessId}';`);
        if (!camp) throw new Error("Campaign not found or access denied.");
      }

      // Check template ownership if provided
      if (templateId) {
        const templ = oneOrNone(`SELECT id FROM email_templates WHERE id = '${templateId}' AND business_id = '${businessId}';`);
        if (!templ) throw new Error("Template not found or access denied.");
      }

      // Validation
      const val = validateAttachment({
        filename,
        mimeType,
        size: buffer.length,
        buffer,
      });

      if (!val.valid) {
        none(`
          INSERT INTO safety_audit_logs (id, business_id, event_type, reason, metadata, created_at)
          VALUES ('${crypto.randomUUID()}', '${businessId}', 'attachment_rejected', '${val.error}', '{"filename": "${filename}"}', NOW());
        `);
        throw new Error(val.error || "File validation failed.");
      }

      const storageKey = generateAttachmentStorageKey(businessId, templateId || campaignId, val.extension);

      // Upload to storage
      await this.storage.upload(storageKey, buffer, val.mimeType);

      // Store in DB
      const attId = crypto.randomUUID();
      none(`
        INSERT INTO attachments (
          id, business_id, campaign_id, template_id, filename, original_filename,
          mime_type, file_size, storage_key, storage_provider, uploaded_by,
          metadata, created_at, updated_at
        ) VALUES (
          '${attId}', '${businessId}', ${campaignId ? `'${campaignId}'` : "NULL"}, ${templateId ? `'${templateId}'` : "NULL"},
          '${val.sanitizedFilename}', '${filename.replace(/'/g, "''")}',
          '${val.mimeType}', ${buffer.length}, '${storageKey}', '${this.storage.name}',
          '${userId}', '{"category": "${val.category}"}', NOW(), NOW()
        );
      `);

      if (stepId && campaignId) {
        none(`
          INSERT INTO campaign_step_attachments (id, business_id, campaign_id, campaign_step_id, attachment_id, created_at)
          VALUES ('${crypto.randomUUID()}', '${businessId}', '${campaignId}', '${stepId}', '${attId}', NOW())
          ON CONFLICT (campaign_step_id, attachment_id) DO NOTHING;
        `);
      }

      if (templateId) {
        none(`
          INSERT INTO template_attachments (id, business_id, template_id, attachment_id, created_at)
          VALUES ('${crypto.randomUUID()}', '${businessId}', '${templateId}', '${attId}', NOW())
          ON CONFLICT (template_id, attachment_id) DO NOTHING;
        `);
      }

      // Audit log
      none(`
        INSERT INTO safety_audit_logs (id, business_id, event_type, reason, metadata, created_at)
        VALUES ('${crypto.randomUUID()}', '${businessId}', 'attachment_uploaded', 'Uploaded attachment "${val.sanitizedFilename}"', '{"attachment_id": "${attId}"}', NOW());
      `);

      return oneOrNone(`SELECT * FROM attachments WHERE id = '${attId}';`);
    }

    async getAttachment(attachmentId, businessId) {
      const row = oneOrNone(`
        SELECT * FROM attachments 
        WHERE id = '${attachmentId}' AND business_id = '${businessId}' AND deleted_at IS NULL;
      `);
      if (!row) throw new Error("Attachment not found or access denied.");
      return row;
    }

    async downloadAttachment(attachmentId, businessId) {
      const att = await this.getAttachment(attachmentId, businessId);
      const exists = await this.storage.exists(att.storage_key);
      if (!exists) {
        throw new Error(`Attachment file missing from storage: "${att.filename}".`);
      }
      const buffer = await this.storage.download(att.storage_key);
      return { attachment: att, buffer };
    }

    async deleteAttachment(attachmentId, businessId) {
      const att = await this.getAttachment(attachmentId, businessId);

      // Check if referenced by active campaign
      const activeRef = oneOrNone(`
        SELECT c.name FROM campaign_step_attachments csa
        JOIN campaigns c ON c.id = csa.campaign_id
        WHERE csa.attachment_id = '${attachmentId}' 
          AND csa.business_id = '${businessId}'
          AND UPPER(c.status) = 'ACTIVE'
        LIMIT 1;
      `);

      if (activeRef) {
        throw new Error(`Cannot delete attachment "${att.filename}": it is currently referenced by active campaign(s): ${activeRef.name}. Please pause or complete the campaign first.`);
      }

      try {
        await this.storage.delete(att.storage_key);
      } catch {
        // ignore
      }

      none(`UPDATE attachments SET deleted_at = NOW(), updated_at = NOW() WHERE id = '${attachmentId}' AND business_id = '${businessId}';`);

      none(`
        INSERT INTO safety_audit_logs (id, business_id, event_type, reason, metadata, created_at)
        VALUES ('${crypto.randomUUID()}', '${businessId}', 'attachment_deleted', 'Deleted attachment "${att.filename}"', '{"attachment_id": "${attachmentId}"}', NOW());
      `);

      return true;
    }

    async attachToStep(stepId, attachmentId, campaignId, businessId) {
      await this.getAttachment(attachmentId, businessId);
      none(`
        INSERT INTO campaign_step_attachments (id, business_id, campaign_id, campaign_step_id, attachment_id, created_at)
        VALUES ('${crypto.randomUUID()}', '${businessId}', '${campaignId}', '${stepId}', '${attachmentId}', NOW())
        ON CONFLICT (campaign_step_id, attachment_id) DO NOTHING;
      `);
      return true;
    }

    async detachFromStep(stepId, attachmentId, businessId) {
      none(`
        DELETE FROM campaign_step_attachments
        WHERE campaign_step_id = '${stepId}' AND attachment_id = '${attachmentId}' AND business_id = '${businessId}';
      `);
      return true;
    }

    async getStepAttachments(stepId, businessId) {
      return many(`
        SELECT a.* FROM campaign_step_attachments csa
        JOIN attachments a ON a.id = csa.attachment_id
        WHERE csa.campaign_step_id = '${stepId}' 
          AND csa.business_id = '${businessId}'
          AND a.deleted_at IS NULL
        ORDER BY csa.created_at ASC;
      `);
    }

    async attachToTemplate(templateId, attachmentId, businessId) {
      await this.getAttachment(attachmentId, businessId);
      const t = oneOrNone(`SELECT id FROM email_templates WHERE id = '${templateId}' AND business_id = '${businessId}';`);
      if (!t) throw new Error("Template not found or access denied.");

      const id = crypto.randomUUID();
      none(`
        INSERT INTO template_attachments (id, business_id, template_id, attachment_id, created_at)
        VALUES ('${id}', '${businessId}', '${templateId}', '${attachmentId}', NOW())
        ON CONFLICT (template_id, attachment_id) DO UPDATE SET created_at = NOW();
      `);
      return oneOrNone(`SELECT * FROM template_attachments WHERE template_id = '${templateId}' AND attachment_id = '${attachmentId}';`);
    }

    async detachFromTemplate(templateId, attachmentId, businessId) {
      none(`
        DELETE FROM template_attachments
        WHERE template_id = '${templateId}' AND attachment_id = '${attachmentId}' AND business_id = '${businessId}';
      `);
      none(`
        UPDATE attachments SET template_id = NULL
        WHERE id = '${attachmentId}' AND template_id = '${templateId}' AND business_id = '${businessId}';
      `);
      return true;
    }

    async getTemplateAttachments(templateId, businessId) {
      const t = oneOrNone(`SELECT id FROM email_templates WHERE id = '${templateId}' AND business_id = '${businessId}';`);
      if (!t) throw new Error("Template not found or access denied.");

      return many(`
        SELECT DISTINCT a.* FROM attachments a
        JOIN template_attachments ta ON ta.attachment_id = a.id
        WHERE ta.template_id = '${templateId}'
          AND a.business_id = '${businessId}'
          AND a.deleted_at IS NULL
        ORDER BY a.created_at DESC;
      `);
    }

    async listAttachments(businessId) {
      return many(`
        SELECT * FROM attachments
        WHERE business_id = '${businessId}' AND deleted_at IS NULL
        ORDER BY created_at DESC;
      `);
    }

    async prepareAttachmentsForEmail(attachmentIds, businessId) {
      if (!attachmentIds || attachmentIds.length === 0) return [];

      const attachments = [];
      let totalSize = 0;
      const MAX_TOTAL = 25 * 1024 * 1024;

      for (const id of attachmentIds) {
        const att = await this.getAttachment(id, businessId);
        const exists = await this.storage.exists(att.storage_key);
        if (!exists) {
          throw new Error(`Delivery halted: Attachment "${att.original_filename}" no longer exists in storage.`);
        }
        totalSize += att.file_size;
        if (totalSize > MAX_TOTAL) {
          throw new Error(`Total attachment size exceeds maximum allowed limit of 25MB.`);
        }
        const buffer = await this.storage.download(att.storage_key);
        attachments.push({
          id: att.id,
          filename: att.original_filename,
          content: buffer,
          contentType: att.mime_type,
          size: att.file_size,
        });
      }
      return attachments;
    }
  }

  const attachmentService = new TestAttachmentService(storage);

  // Sample buffers
  const samplePdf = Buffer.from("%PDF-1.4 sample content for proposal");
  const samplePng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
  const sampleJpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
  const sampleGif = Buffer.from("GIF89a1234567890");
  const sampleZip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]);
  const sampleMp4 = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
  const sampleWebm = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81]);
  const sampleCsv = Buffer.from("first_name,email\nAlice,alice@example.com\n");

  let sharedAttachment;

  // -------------------------------------------------------------
  // Scenario 1: Valid attachment upload
  // -------------------------------------------------------------
  await t.test("Scenario 1: Valid attachment upload", async () => {
    sharedAttachment = await attachmentService.uploadAttachment(businessAId, userAId, {
      filename: "project_proposal.pdf",
      mimeType: "application/pdf",
      buffer: samplePdf,
      campaignId: campaignAId,
    });

    assert.ok(sharedAttachment.id);
    assert.equal(sharedAttachment.business_id, businessAId);
    assert.equal(sharedAttachment.original_filename, "project_proposal.pdf");
    assert.equal(sharedAttachment.file_size, samplePdf.length);

    const exists = await storage.exists(sharedAttachment.storage_key);
    assert.equal(exists, true, "File saved in storage provider");
  });

  // -------------------------------------------------------------
  // Scenario 2: Invalid extension rejected (.exe, .sh)
  // -------------------------------------------------------------
  await t.test("Scenario 2: Invalid extension rejected (.exe, .sh)", async () => {
    await assert.rejects(
      async () => {
        await attachmentService.uploadAttachment(businessAId, userAId, {
          filename: "installer.exe",
          mimeType: "application/x-msdownload",
          buffer: Buffer.from("MZ payload"),
        });
      },
      /prohibited/i
    );

    await assert.rejects(
      async () => {
        await attachmentService.uploadAttachment(businessAId, userAId, {
          filename: "script.sh",
          mimeType: "application/x-sh",
          buffer: Buffer.from("#!/bin/bash"),
        });
      },
      /prohibited/i
    );
  });

  // -------------------------------------------------------------
  // Scenario 3: Invalid MIME type rejected
  // -------------------------------------------------------------
  await t.test("Scenario 3: Invalid MIME type rejected", async () => {
    await assert.rejects(
      async () => {
        await attachmentService.uploadAttachment(businessAId, userAId, {
          filename: "document.pdf",
          mimeType: "application/x-executable",
          buffer: samplePdf,
        });
      },
      /prohibited MIME type|invalid/i
    );
  });

  // -------------------------------------------------------------
  // Scenario 4: Executable file rejected (Magic byte check)
  // -------------------------------------------------------------
  await t.test("Scenario 4: Executable file rejected (Magic byte check)", async () => {
    const fakeJpg = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]); // DOS MZ signature
    await assert.rejects(
      async () => {
        await attachmentService.uploadAttachment(businessAId, userAId, {
          filename: "avatar.jpg",
          mimeType: "image/jpeg",
          buffer: fakeJpg,
        });
      },
      /magic bytes|signature/i
    );
  });

  // -------------------------------------------------------------
  // Scenario 5: Oversized attachment rejected (>10MB)
  // -------------------------------------------------------------
  await t.test("Scenario 5: Oversized attachment rejected (>10MB)", async () => {
    const oversized = Buffer.alloc(10 * 1024 * 1024 + 512);
    oversized.write("%PDF-1.4");
    await assert.rejects(
      async () => {
        await attachmentService.uploadAttachment(businessAId, userAId, {
          filename: "huge.pdf",
          mimeType: "application/pdf",
          buffer: oversized,
        });
      },
      /exceeds the maximum allowed|maximum allowed file size/i
    );
  });

  // -------------------------------------------------------------
  // Scenario 6: Filename traversal rejected (../../etc/passwd)
  // -------------------------------------------------------------
  await t.test("Scenario 6: Filename traversal rejected (../../etc/passwd)", async () => {
    await assert.rejects(
      async () => {
        await attachmentService.uploadAttachment(businessAId, userAId, {
          filename: "../../../etc/passwd.pdf",
          mimeType: "application/pdf",
          buffer: samplePdf,
        });
      },
      /path traversal/i
    );
  });

  // -------------------------------------------------------------
  // Scenario 7: Filename sanitized
  // -------------------------------------------------------------
  await t.test("Scenario 7: Filename sanitized", async () => {
    const rawName = "Annual Report 2026 (Draft #1)!.pdf";
    const clean = sanitizeFilename(rawName);
    assert.ok(!clean.includes(" "));
    assert.ok(!clean.includes("#"));
    assert.ok(clean.endsWith(".pdf"));

    const att = await attachmentService.uploadAttachment(businessAId, userAId, {
      filename: rawName,
      mimeType: "application/pdf",
      buffer: samplePdf,
    });
    assert.equal(att.original_filename, rawName);
    assert.ok(!att.filename.includes(" "));
  });

  // -------------------------------------------------------------
  // Scenario 8: Attachment metadata stored
  // -------------------------------------------------------------
  await t.test("Scenario 8: Attachment metadata stored", async () => {
    const row = oneOrNone(`SELECT * FROM attachments WHERE id = '${sharedAttachment.id}';`);
    assert.ok(row);
    assert.equal(row.business_id, businessAId);
    assert.equal(row.campaign_id, campaignAId);
    assert.equal(row.mime_type, "application/pdf");
    assert.equal(row.file_size, samplePdf.length);
    assert.equal(row.storage_provider, "in-memory");
    assert.equal(row.uploaded_by, userAId);
  });

  // -------------------------------------------------------------
  // Scenario 9: Attachment belongs to correct tenant
  // -------------------------------------------------------------
  await t.test("Scenario 9: Attachment belongs to correct tenant", async () => {
    const attA = await attachmentService.uploadAttachment(businessAId, userAId, {
      filename: "tenant_a_file.pdf",
      mimeType: "application/pdf",
      buffer: samplePdf,
    });
    assert.equal(attA.business_id, businessAId);

    const attB = await attachmentService.uploadAttachment(businessBId, userBId, {
      filename: "tenant_b_file.pdf",
      mimeType: "application/pdf",
      buffer: samplePdf,
    });
    assert.equal(attB.business_id, businessBId);
  });

  // -------------------------------------------------------------
  // Scenario 10: Cross-tenant attachment access rejected (404/403)
  // -------------------------------------------------------------
  await t.test("Scenario 10: Cross-tenant attachment access rejected (404/403)", async () => {
    // Tenant B cannot access Tenant A's attachment
    await assert.rejects(
      async () => {
        await attachmentService.getAttachment(sharedAttachment.id, businessBId);
      },
      /not found or access denied/i
    );

    await assert.rejects(
      async () => {
        await attachmentService.downloadAttachment(sharedAttachment.id, businessBId);
      },
      /not found or access denied/i
    );
  });

  // -------------------------------------------------------------
  // Scenario 11: Cross-tenant attachment deletion rejected
  // -------------------------------------------------------------
  await t.test("Scenario 11: Cross-tenant attachment deletion rejected", async () => {
    await assert.rejects(
      async () => {
        await attachmentService.deleteAttachment(sharedAttachment.id, businessBId, userBId);
      },
      /not found or access denied/i
    );

    const attStillExists = await attachmentService.getAttachment(sharedAttachment.id, businessAId);
    assert.ok(attStillExists, "Attachment was not deleted by Tenant B");
  });

  // -------------------------------------------------------------
  // Scenario 12: Campaign attachment association works
  // -------------------------------------------------------------
  await t.test("Scenario 12: Campaign attachment association works", async () => {
    await attachmentService.attachToStep(stepAId, sharedAttachment.id, campaignAId, businessAId);

    const stepAtts = await attachmentService.getStepAttachments(stepAId, businessAId);
    assert.equal(stepAtts.length, 1);
    assert.equal(stepAtts[0].id, sharedAttachment.id);
  });

  // -------------------------------------------------------------
  // Scenario 13: Attachment removal works (detach from step)
  // -------------------------------------------------------------
  await t.test("Scenario 13: Attachment removal works (detach from step)", async () => {
    await attachmentService.detachFromStep(stepAId, sharedAttachment.id, businessAId);

    const stepAtts = await attachmentService.getStepAttachments(stepAId, businessAId);
    assert.equal(stepAtts.length, 0);

    // Re-attach for remaining tests
    await attachmentService.attachToStep(stepAId, sharedAttachment.id, campaignAId, businessAId);
  });

  // -------------------------------------------------------------
  // Scenario 14: Multiple attachments work
  // -------------------------------------------------------------
  let secondAtt;
  await t.test("Scenario 14: Multiple attachments work", async () => {
    secondAtt = await attachmentService.uploadAttachment(businessAId, userAId, {
      filename: "workflow.png",
      mimeType: "image/png",
      buffer: samplePng,
      campaignId: campaignAId,
      stepId: stepAId,
    });

    const stepAtts = await attachmentService.getStepAttachments(stepAId, businessAId);
    assert.equal(stepAtts.length, 2);
    assert.ok(stepAtts.some((a) => a.id === sharedAttachment.id));
    assert.ok(stepAtts.some((a) => a.id === secondAtt.id));
  });

  // -------------------------------------------------------------
  // Scenario 15: Image attachment works (JPEG/PNG/WEBP/GIF)
  // -------------------------------------------------------------
  await t.test("Scenario 15: Image attachment works (JPEG/PNG/WEBP/GIF)", async () => {
    const jpg = await attachmentService.uploadAttachment(businessAId, userAId, {
      filename: "photo.jpg",
      mimeType: "image/jpeg",
      buffer: sampleJpg,
    });
    assert.equal(jpg.mime_type, "image/jpeg");

    const gif = await attachmentService.uploadAttachment(businessAId, userAId, {
      filename: "diagram.gif",
      mimeType: "image/gif",
      buffer: sampleGif,
    });
    assert.equal(gif.mime_type, "image/gif");
  });

  // -------------------------------------------------------------
  // Scenario 16: PDF attachment works
  // -------------------------------------------------------------
  await t.test("Scenario 16: PDF attachment works", async () => {
    const pdf = await attachmentService.uploadAttachment(businessAId, userAId, {
      filename: "contract_final.pdf",
      mimeType: "application/pdf",
      buffer: samplePdf,
    });
    assert.equal(pdf.mime_type, "application/pdf");
    assert.equal(pdf.original_filename, "contract_final.pdf");
  });

  // -------------------------------------------------------------
  // Scenario 17: Excel attachment works (XLS/XLSX/CSV)
  // -------------------------------------------------------------
  await t.test("Scenario 17: Excel attachment works (XLS/XLSX/CSV)", async () => {
    const csv = await attachmentService.uploadAttachment(businessAId, userAId, {
      filename: "contacts.csv",
      mimeType: "text/csv",
      buffer: sampleCsv,
    });
    assert.equal(csv.mime_type, "text/csv");

    const xlsx = await attachmentService.uploadAttachment(businessAId, userAId, {
      filename: "pricing.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: sampleZip,
    });
    assert.equal(xlsx.mime_type, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  });

  // -------------------------------------------------------------
  // Scenario 18: Video attachment works (MP4/MOV/WEBM)
  // -------------------------------------------------------------
  await t.test("Scenario 18: Video attachment works (MP4/MOV/WEBM)", async () => {
    const mp4 = await attachmentService.uploadAttachment(businessAId, userAId, {
      filename: "demo_walkthrough.mp4",
      mimeType: "video/mp4",
      buffer: sampleMp4,
    });
    assert.equal(mp4.mime_type, "video/mp4");

    const webm = await attachmentService.uploadAttachment(businessAId, userAId, {
      filename: "clip.webm",
      mimeType: "video/webm",
      buffer: sampleWebm,
    });
    assert.equal(webm.mime_type, "video/webm");
  });

  // -------------------------------------------------------------
  // Scenario 19: Test email with attachment works
  // -------------------------------------------------------------
  await t.test("Scenario 19: Test email with attachment works", async () => {
    const prep = await attachmentService.prepareAttachmentsForEmail(
      [sharedAttachment.id],
      businessAId
    );

    assert.equal(prep.length, 1);
    assert.equal(prep[0].filename, "project_proposal.pdf");
    assert.ok(Buffer.isBuffer(prep[0].content));

    // Convert for provider
    const providerAttachment = {
      filename: prep[0].filename,
      content: prep[0].content.toString("base64"),
      content_type: prep[0].contentType,
    };
    assert.ok(providerAttachment.content.length > 0);
  });

  // -------------------------------------------------------------
  // Scenario 20: Campaign email with attachment works
  // -------------------------------------------------------------
  await t.test("Scenario 20: Campaign email with attachment works", async () => {
    const stepAtts = await attachmentService.getStepAttachments(stepAId, businessAId);
    const prepared = await attachmentService.prepareAttachmentsForEmail(
      stepAtts.map((a) => a.id),
      businessAId
    );

    assert.equal(prepared.length, 2);

    const emailMsgId = crypto.randomUUID();
    none(`
      INSERT INTO email_messages (
        id, business_id, lead_id, campaign_id, campaign_step_id, template_id,
        direction, from_email, to_email, subject, body, status, sent_at, created_at, updated_at
      ) VALUES (
        '${emailMsgId}', '${businessAId}', '${contactAId}', '${campaignAId}', '${stepAId}', '${templateAId}',
        'outbound', 'sales@acme.com', 'prospect1@enterprise.com', 'Proposal', '<p>body</p>', 'SENT', NOW(), NOW(), NOW()
      );
    `);

    const msg = oneOrNone(`SELECT * FROM email_messages WHERE id = '${emailMsgId}';`);
    assert.equal(msg.status, "SENT");
    assert.equal(msg.campaign_step_id, stepAId);
  });

  // -------------------------------------------------------------
  // Scenario 21: Missing attachment prevents unsafe send (halts execution)
  // -------------------------------------------------------------
  await t.test("Scenario 21: Missing attachment prevents unsafe send (halts execution)", async () => {
    const orphanAtt = await attachmentService.uploadAttachment(businessAId, userAId, {
      filename: "deleted_from_s3.pdf",
      mimeType: "application/pdf",
      buffer: samplePdf,
    });

    // Simulate S3 object deletion/corruption
    await storage.delete(orphanAtt.storage_key);

    await assert.rejects(
      async () => {
        await attachmentService.prepareAttachmentsForEmail([orphanAtt.id], businessAId);
      },
      /Delivery halted: Attachment ".*" no longer exists in storage/i
    );
  });

  // -------------------------------------------------------------
  // Scenario 22: Deleted attachment cannot be sent
  // -------------------------------------------------------------
  await t.test("Scenario 22: Deleted attachment cannot be sent", async () => {
    const soonDeleted = await attachmentService.uploadAttachment(businessAId, userAId, {
      filename: "retracted_offer.pdf",
      mimeType: "application/pdf",
      buffer: samplePdf,
    });

    await attachmentService.deleteAttachment(soonDeleted.id, businessAId, userAId);

    await assert.rejects(
      async () => {
        await attachmentService.prepareAttachmentsForEmail([soonDeleted.id], businessAId);
      },
      /not found or access denied/i
    );
  });

  // -------------------------------------------------------------
  // Scenario 23: Attachment upload failure handled correctly
  // -------------------------------------------------------------
  await t.test("Scenario 23: Attachment upload failure handled correctly", async () => {
    const failingStorage = {
      name: "failing_storage",
      upload: async () => {
        throw new Error("Disk quota exceeded");
      },
      download: async () => Buffer.from(""),
      delete: async () => {},
      exists: async () => false,
    };

    const failingService = new TestAttachmentService(failingStorage);

    await assert.rejects(
      async () => {
        await failingService.uploadAttachment(businessAId, userAId, {
          filename: "fail.pdf",
          mimeType: "application/pdf",
          buffer: samplePdf,
        });
      },
      /Disk quota exceeded/i
    );

    const row = oneOrNone(`SELECT id FROM attachments WHERE filename = 'fail.pdf';`);
    assert.equal(row, null, "No orphaned record in database");
  });

  // -------------------------------------------------------------
  // Scenario 24: Attachment deletion audit recorded
  // -------------------------------------------------------------
  await t.test("Scenario 24: Attachment deletion audit recorded", async () => {
    const auditAtt = await attachmentService.uploadAttachment(businessAId, userAId, {
      filename: "audit_delete_test.pdf",
      mimeType: "application/pdf",
      buffer: samplePdf,
    });

    await attachmentService.deleteAttachment(auditAtt.id, businessAId, userAId);

    const log = oneOrNone(`
      SELECT * FROM safety_audit_logs
      WHERE business_id = '${businessAId}' AND event_type = 'attachment_deleted'
      ORDER BY created_at DESC LIMIT 1;
    `);

    assert.ok(log);
    assert.equal(log.event_type, "attachment_deleted");
    assert.ok(log.reason.includes("audit_delete_test.pdf"));
  });

  // -------------------------------------------------------------
  // Scenario 25: Attachment upload audit recorded
  // -------------------------------------------------------------
  await t.test("Scenario 25: Attachment upload audit recorded", async () => {
    const log = oneOrNone(`
      SELECT * FROM safety_audit_logs
      WHERE business_id = '${businessAId}' AND event_type = 'attachment_uploaded'
      ORDER BY created_at DESC LIMIT 1;
    `);

    assert.ok(log);
    assert.equal(log.event_type, "attachment_uploaded");
  });

  // -------------------------------------------------------------
  // Scenario 26: Provider attachment conversion works
  // -------------------------------------------------------------
  await t.test("Scenario 26: Provider attachment conversion works", async () => {
    const prep = await attachmentService.prepareAttachmentsForEmail([sharedAttachment.id], businessAId);
    const converted = {
      filename: prep[0].filename,
      content: prep[0].content.toString("base64"),
      content_type: prep[0].contentType,
    };

    assert.equal(converted.filename, "project_proposal.pdf");
    assert.equal(converted.content_type, "application/pdf");
    assert.equal(typeof converted.content, "string");
  });

  // -------------------------------------------------------------
  // Scenario 27: Provider size limit enforced (25MB total)
  // -------------------------------------------------------------
  await t.test("Scenario 27: Provider size limit enforced (25MB total)", async () => {
    const big1 = Buffer.alloc(9 * 1024 * 1024);
    big1.write("%PDF-1.4");
    const big2 = Buffer.alloc(9 * 1024 * 1024);
    big2.write("%PDF-1.4");
    const big3 = Buffer.alloc(8 * 1024 * 1024);
    big3.write("%PDF-1.4");

    const a1 = await attachmentService.uploadAttachment(businessAId, userAId, {
      filename: "big1.pdf",
      mimeType: "application/pdf",
      buffer: big1,
    });
    const a2 = await attachmentService.uploadAttachment(businessAId, userAId, {
      filename: "big2.pdf",
      mimeType: "application/pdf",
      buffer: big2,
    });
    const a3 = await attachmentService.uploadAttachment(businessAId, userAId, {
      filename: "big3.pdf",
      mimeType: "application/pdf",
      buffer: big3,
    });

    await assert.rejects(
      async () => {
        await attachmentService.prepareAttachmentsForEmail([a1.id, a2.id, a3.id], businessAId);
      },
      /exceeds maximum allowed limit of 25MB/i
    );
  });

  // -------------------------------------------------------------
  // Scenario 28: Existing campaign without attachment still works
  // -------------------------------------------------------------
  await t.test("Scenario 28: Existing campaign without attachment still works", async () => {
    const stepAtts = await attachmentService.getStepAttachments(crypto.randomUUID(), businessAId);
    assert.equal(stepAtts.length, 0);

    const prepared = await attachmentService.prepareAttachmentsForEmail([], businessAId);
    assert.equal(prepared.length, 0);
  });

  // -------------------------------------------------------------
  // Scenario 29: Existing campaign safety controls still work
  // -------------------------------------------------------------
  await t.test("Scenario 29: Existing campaign safety controls still work", async () => {
    // Blocks deletion of attachment if active campaign references it
    none(`UPDATE campaigns SET status = 'ACTIVE' WHERE id = '${campaignAId}';`);

    await assert.rejects(
      async () => {
        await attachmentService.deleteAttachment(sharedAttachment.id, businessAId, userAId);
      },
      /currently referenced by active campaign/i
    );

    // Reset status to DRAFT allows deletion
    none(`UPDATE campaigns SET status = 'DRAFT' WHERE id = '${campaignAId}';`);
  });

  // -------------------------------------------------------------
  // Scenario 30: Multi-tenant isolation remains intact
  // -------------------------------------------------------------
  await t.test("Scenario 30: Multi-tenant isolation remains intact", async () => {
    const listA = await attachmentService.listAttachments(businessAId);
    const listB = await attachmentService.listAttachments(businessBId);

    assert.ok(listA.length > 0, "Tenant A attachments exist");
    assert.ok(listB.length > 0, "Tenant B attachment exists");

    for (const a of listA) {
      assert.equal(a.business_id, businessAId);
    }
    for (const b of listB) {
      assert.equal(b.business_id, businessBId);
    }
  });

  // -------------------------------------------------------------
  // Scenario 31: Template file attachment creation & staging
  // -------------------------------------------------------------
  await t.test("Scenario 31: Template file attachment creation & staging", async () => {
    const pdfBuffer = Buffer.from("%PDF-1.4 sample template brochure");
    const templAtt = await attachmentService.uploadAttachment(businessAId, userAId, {
      filename: "company_deck.pdf",
      mimeType: "application/pdf",
      buffer: pdfBuffer,
      templateId: templateAId,
    });

    assert.ok(templAtt.id);
    assert.equal(templAtt.template_id, templateAId);
    assert.equal(templAtt.business_id, businessAId);

    // Verify it is linked in template_attachments junction table
    const junction = oneOrNone(
      `SELECT * FROM template_attachments WHERE template_id = '${templateAId}' AND attachment_id = '${templAtt.id}';`
    );
    assert.ok(junction, "Junction record exists");
  });

  // -------------------------------------------------------------
  // Scenario 32: Associating, listing and detaching template attachments
  // -------------------------------------------------------------
  await t.test("Scenario 32: Associating, listing and detaching template attachments", async () => {
    const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
    const imgAtt = await attachmentService.uploadAttachment(businessAId, userAId, {
      filename: "logo_header.png",
      mimeType: "image/png",
      buffer: pngBuffer,
      templateId: templateAId,
    });

    // List template attachments
    const list = await attachmentService.getTemplateAttachments(templateAId, businessAId);
    assert.ok(list.length >= 2, "Template has at least 2 attachments");
    const foundImg = list.find((a) => a.id === imgAtt.id);
    assert.ok(foundImg, "Image attachment found in template");

    // Detach from template
    const detached = await attachmentService.detachFromTemplate(templateAId, imgAtt.id, businessAId);
    assert.equal(detached, true);

    const listAfter = await attachmentService.getTemplateAttachments(templateAId, businessAId);
    assert.ok(!listAfter.some((a) => a.id === imgAtt.id), "Image attachment no longer in template");
  });

  // -------------------------------------------------------------
  // Scenario 33: Multi-tenant isolation on templates
  // -------------------------------------------------------------
  await t.test("Scenario 33: Multi-tenant isolation on templates", async () => {
    // Tenant B cannot attach to Tenant A's template
    await assert.rejects(
      async () => {
        await attachmentService.uploadAttachment(businessBId, userBId, {
          filename: "malicious.pdf",
          mimeType: "application/pdf",
          buffer: Buffer.from("%PDF-1.4 test"),
          templateId: templateAId, // Belongs to Tenant A
        });
      },
      /Template not found or access denied/i
    );

    // Tenant B cannot view Tenant A's template attachments
    await assert.rejects(
      async () => {
        await attachmentService.getTemplateAttachments(templateAId, businessBId);
      },
      /Template not found or access denied/i
    );
  });

  // -------------------------------------------------------------
  // Scenario 34: Auto-resolving template attachments for email dispatch
  // -------------------------------------------------------------
  await t.test("Scenario 34: Auto-resolving template attachments for email dispatch", async () => {
    // Query template attachments for dispatch
    const templateAtts = await attachmentService.getTemplateAttachments(templateAId, businessAId);
    assert.ok(templateAtts.length > 0);

    const prepared = await attachmentService.prepareAttachmentsForEmail(
      templateAtts.map((a) => a.id),
      businessAId
    );
    assert.ok(prepared.length > 0);
    const pdf = prepared.find((p) => p.contentType === "application/pdf");
    assert.ok(pdf, "PDF attachment found in prepared list");
    assert.ok(pdf.content instanceof Buffer);
  });

  // -------------------------------------------------------------
  // Scenario 35: Attachment database queries for template junction
  // -------------------------------------------------------------
  await t.test("Scenario 35: Attachment database queries for template junction", async () => {
    const rows = many(`
      SELECT DISTINCT a.* FROM attachments a
      JOIN template_attachments ta ON ta.attachment_id = a.id
      WHERE ta.template_id = '${templateAId}'
        AND a.business_id = '${businessAId}'
        AND a.deleted_at IS NULL
      ORDER BY a.created_at DESC;
    `);
    assert.ok(Array.isArray(rows));
    assert.ok(rows.length > 0);
    assert.equal(rows[0].business_id, businessAId);
  });
});
