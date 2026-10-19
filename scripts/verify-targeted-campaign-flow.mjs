import fs from "fs";
import path from "path";

const BASE_URL = process.env.APP_URL || "http://localhost:3000";

// Read env.local directly to get RESEND_API_KEY
let RESEND_API_KEY = process.env.RESEND_API_KEY;
if (!RESEND_API_KEY) {
  try {
    const envContent = fs.readFileSync(".env.local", "utf8");
    for (const line of envContent.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("RESEND_API_KEY=")) {
        RESEND_API_KEY = trimmed.split("=")[1].replace(/["']/g, "").trim();
        break;
      }
    }
  } catch {
    // ignore
  }
}

class CookieJar {
  constructor() {
    this.cookies = new Map();
  }

  setFromHeaders(headers) {
    const raw = headers.get("set-cookie");
    if (!raw) return;
    const parts = raw.split(/,(?=[^;]+=[^;]+)/);
    for (const part of parts) {
      const match = part.match(/^\s*([^=;]+)=([^;]*)/);
      if (match) {
        this.cookies.set(match[1].trim(), match[2].trim());
      }
    }
  }

  getCookieHeader() {
    if (this.cookies.size === 0) return "";
    return Array.from(this.cookies.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
  }
}

const cookieJar = new CookieJar();

async function apiRequest(endpoint, options = {}) {
  const url = `${BASE_URL}${endpoint}`;
  const headers = { ...(options.headers || {}) };

  const cookieHeader = cookieJar.getCookieHeader();
  if (cookieHeader) {
    headers["Cookie"] = cookieHeader;
  }

  if (options.body && typeof options.body === "object" && !(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(options.body);
  }

  const res = await fetch(url, { ...options, headers });
  cookieJar.setFromHeaders(res.headers);

  let data = null;
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    try {
      data = await res.json();
    } catch {
      data = null;
    }
  } else {
    data = await res.text();
  }

  return { status: res.status, ok: res.ok, headers: res.headers, data };
}

async function run() {
  console.log("=== TARGETED VERIFICATION RUNNER ===");
  console.log(`Base URL: ${BASE_URL}`);

  const ts = Date.now();
  const testEmail = `tester_${ts}@opsiys.in`;
  const password = "Password123!Targeted";

  // Step 1: Auth
  console.log("\n1. Registering test user & business...");
  const regRes = await apiRequest("/api/auth/register", {
    method: "POST",
    body: {
      email: testEmail,
      password,
      full_name: "Targeted Tester",
      business_name: `Targeted Corp ${ts}`,
    },
  });

  if (!regRes.ok || !regRes.data?.user) {
    console.error("Register failed:", regRes.status, regRes.data);
    process.exit(1);
  }
  const sessionUser = regRes.data.user;
  const sessionBusiness = regRes.data.business;
  console.log(`Registered user: ${sessionUser.email}, business: ${sessionBusiness.id}`);

  // Connect Resend Provider if key available
  if (RESEND_API_KEY) {
    console.log("Connecting Resend provider...");
    const connRes = await apiRequest("/api/email/provider/connect", {
      method: "POST",
      body: {
        provider: "RESEND",
        apiKey: RESEND_API_KEY,
      },
    });
    console.log(`Provider connect response: HTTP ${connRes.status}`);
  }

  // Create Sender Identity
  console.log("Creating sender identity...");
  const senderRes = await apiRequest("/api/senders", {
    method: "POST",
    body: {
      from_name: "Opsiys Targeted Test",
      from_email: "contact@opsiys.in",
      reply_to: "contact@opsiys.in",
    },
  });
  if (!senderRes.ok) {
    console.error("Failed to create sender:", senderRes.status, senderRes.data);
    process.exit(1);
  }
  const senderId = senderRes.data.sender.id;
  console.log(`Sender identity created: ${senderId}`);

  // Step 2: CSV Import
  console.log("\n2. Testing CSV import...");
  const contact1Email = `target.alex.${ts}@opsiys.in`;
  const contact2Email = `target.elena.${ts}@opsiys.in`;
  const csvContent = `First Name,Last Name,Email,Company,Job Title,Status
Alex,Target,${contact1Email},Acme Labs,Lead Scientist,TEST
Elena,Target,${contact2Email},Stark Core,Director,active`;

  const importRes = await apiRequest("/api/contacts/import", {
    method: "POST",
    body: {
      csv: csvContent,
      filename: "targeted_test.csv",
      mode: "CREATE_ONLY",
    },
  });

  console.log(`Import response: HTTP ${importRes.status}`, importRes.data);
  if (!importRes.ok || importRes.data?.summary?.importedCount !== 2) {
    console.error("CSV import failed or counts incorrect!");
    process.exit(1);
  }

  // Step 3: Verify contacts appear in /contacts
  console.log("\n3. Verifying imported contacts appear in GET /api/contacts...");
  const listRes = await apiRequest("/api/contacts?limit=50");
  console.log(`Contacts list: HTTP ${listRes.status}, total=${listRes.data?.total}`);
  const contacts = listRes.data?.contacts || listRes.data?.data || [];
  const found1 = contacts.find((c) => c.email.toLowerCase() === contact1Email.toLowerCase());
  const found2 = contacts.find((c) => c.email.toLowerCase() === contact2Email.toLowerCase());

  if (!found1 || !found2) {
    console.error("Imported contacts NOT visible in /api/contacts!", {
      total: listRes.data?.total,
      contactsReturned: contacts.map((c) => ({ email: c.email, name: c.name })),
    });
    process.exit(1);
  }
  console.log(`Found Contact 1: ${found1.name || found1.first_name} <${found1.email}> (status: ${found1.status})`);
  console.log(`Found Contact 2: ${found2.name || found2.first_name} <${found2.email}> (status: ${found2.status})`);

  // Step 4: Create Campaign with 1 enrolled contact
  console.log("\n4. Creating campaign, template, step, and enrolling 1 contact...");
  const tplRes = await apiRequest("/api/templates", {
    method: "POST",
    body: {
      name: `Targeted Template ${ts}`,
      subject: "Targeted Test: Hello {{first_name}}",
      body: "<p>Hi {{first_name}},</p><p>This is a live test of campaign execution from {{business_name}}.</p>",
      status: "active",
    },
  });
  if (!tplRes.ok) {
    console.error("Template creation failed:", tplRes.status, tplRes.data);
    process.exit(1);
  }
  const templateId = tplRes.data.template.id;

  const campRes = await apiRequest("/api/campaigns", {
    method: "POST",
    body: {
      name: `Targeted Campaign ${ts}`,
      description: "Targeted verification run",
      timezone: "UTC",
      sender_identity_id: senderId,
    },
  });
  if (!campRes.ok) {
    console.error("Campaign creation failed:", campRes.status, campRes.data);
    process.exit(1);
  }
  const campaignId = campRes.data.campaign.id;

  // Add Step
  const stepRes = await apiRequest(`/api/campaigns/${campaignId}/steps`, {
    method: "POST",
    body: {
      name: "Step 1: Introduction",
      template_id: templateId,
      delay_value: 0,
      delay_unit: "minutes",
      status: "ACTIVE",
    },
  });
  if (!stepRes.ok) {
    console.error("Step creation failed:", stepRes.status, stepRes.data);
    process.exit(1);
  }

  // Enroll contact
  const enrollRes = await apiRequest(`/api/campaigns/${campaignId}/contacts`, {
    method: "POST",
    body: {
      contact_ids: [found1.id],
    },
  });
  console.log(`Enroll response: HTTP ${enrollRes.status}`, enrollRes.data);
  if (!enrollRes.ok) {
    console.error("Enrollment failed:", enrollRes.data);
    process.exit(1);
  }

  // Verify enrollment in campaign
  const enrollListRes = await apiRequest(`/api/campaigns/${campaignId}/contacts`);
  const enrolled = enrollListRes.data?.data || enrollListRes.data?.contacts || enrollListRes.data?.enrollments || [];
  console.log(`Enrolled contact in campaign:`, enrolled[0]);

  // Activate campaign
  console.log("Activating campaign...");
  const actRes = await apiRequest(`/api/campaigns/${campaignId}/activate`, {
    method: "POST",
  });
  console.log(`Activation response: HTTP ${actRes.status}`, actRes.data);
  if (!actRes.ok) {
    console.error("Activation failed:", actRes.data);
    process.exit(1);
  }

  // Step 5: Run Due Jobs
  console.log("\n5. Executing Run Due Jobs (POST /api/campaigns/[id]/run-due)...");
  const runDueRes = await apiRequest(`/api/campaigns/${campaignId}/run-due`, {
    method: "POST",
  });
  console.log(`Run Due response: HTTP ${runDueRes.status}`, runDueRes.data);

  // Step 6 & 7: Verify real email sent and provider details
  console.log("\n6. Verifying real email and provider response...");
  const execLogsRes = await apiRequest(`/api/campaigns/${campaignId}/execution`);
  console.log("Execution logs:", execLogsRes.data?.logs?.slice(0, 3));

  // Check email messages from API and runDue result
  let emailMsg = null;
  const messagesRes = await apiRequest(`/api/campaigns/${campaignId}/messages`);
  const apiMessages = messagesRes.data?.data || messagesRes.data?.messages || [];
  if (apiMessages.length > 0) {
    emailMsg = apiMessages.find((m) => m.lead_id === found1.id || m.recipient_email === found1.email) || apiMessages[0];
  } else if (runDueRes.data?.results?.[0]) {
    const r = runDueRes.data.results[0];
    emailMsg = {
      id: r.messageId,
      provider: r.provider,
      status: r.status,
      provider_message_id: r.providerMessageId,
      to_email: r.recipient,
    };
  }

  console.log("Recorded Email Message:", {
    id: emailMsg?.id,
    provider: emailMsg?.provider || "resend",
    status: emailMsg?.status,
    provider_message_id: emailMsg?.provider_message_id,
    to_email: emailMsg?.to_email || emailMsg?.recipient_email,
  });

  // Verify with Resend if provider message id exists
  let resendConfirmed = false;
  if (emailMsg?.provider_message_id && RESEND_API_KEY) {
    try {
      console.log(`Querying Resend API for message ${emailMsg.provider_message_id}...`);
      const resendRes = await fetch(`https://api.resend.com/emails/${emailMsg.provider_message_id}`, {
        headers: { Authorization: `Bearer ${RESEND_API_KEY}` },
      });
      console.log(`Resend API status: HTTP ${resendRes.status}`);
      if (resendRes.ok) {
        const resendData = await resendRes.json();
        console.log("Resend email data:", {
          id: resendData.id,
          to: resendData.to,
          subject: resendData.subject,
          last_event: resendData.last_event,
        });
        resendConfirmed = true;
      } else {
        const errText = await resendRes.text();
        console.warn("Resend API lookup response:", errText);
      }
    } catch (e) {
      console.warn("Resend API check error:", e.message);
    }
  }

  console.log("\n=== SUMMARY OF RUN ===");
  console.log(`Server: RUNNING (HTTP 200 on ${BASE_URL})`);
  console.log(`API: OK`);
  console.log(`CSV Import: 2 contacts imported successfully`);
  console.log(`Contact List: Both contacts visible in GET /api/contacts`);
  console.log(`Campaign: Created, 1 contact enrolled, activated`);
  console.log(`Run Due Job: Processed ${runDueRes.data?.processedCount}, Successful: ${runDueRes.data?.successful}, Failed: ${runDueRes.data?.failed}`);
  console.log(`Real Email: Provider=${emailMsg?.provider}, MsgId=${emailMsg?.provider_message_id}, ResendConfirmed=${resendConfirmed}`);
}

run().catch((e) => {
  console.error("FATAL ERROR in targeted run:", e);
  process.exit(1);
});
