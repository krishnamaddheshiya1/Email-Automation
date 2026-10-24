import crypto from "crypto";
import fs from "fs";
import path from "path";

// Load .env.local
const envPath = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx !== -1) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^['"]|['"]$/g, "");
      if (!process.env[key]) process.env[key] = val;
    }
  }
}

const targetBase = process.argv[2] || process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
const webhookUrl = `${targetBase.replace(/\/+$/, "")}/api/webhooks/resend`;
const secret = process.env.RESEND_WEBHOOK_SECRET || "whsec_6HCmeQH8z6N8bMjdV854I7aDSEJAeN9C";
const toEmail = process.env.EMAIL_FROM_ADDRESS || "contact@opsiys.in";

const testSenderEmail = `prospect_${Date.now().toString().slice(-4)}@example.com`;
const testSubject = `Test Reply: Looking forward to the demo (${new Date().toLocaleTimeString()})`;
const testBody = `Hi team, I received your email and would love to move forward with the demo!`;

console.log("==========================================================");
console.log("🚀 TESTING INCOMING REPLY WEBHOOK PIPELINE");
console.log("==========================================================");
console.log(`Target URL:     ${webhookUrl}`);
console.log(`Sender:         ${testSenderEmail}`);
console.log(`Recipient (To): ${toEmail}`);
console.log(`Subject:        ${testSubject}`);
console.log("----------------------------------------------------------");

const emailId = `sim_rec_${Date.now()}`;
const payload = JSON.stringify({
  type: "email.received",
  created_at: new Date().toISOString(),
  data: {
    email_id: emailId,
    from: `Alex Prospect <${testSenderEmail}>`,
    to: [toEmail],
    subject: testSubject,
    text: testBody,
    html: `<p>${testBody}</p>`,
    message_id: `<${emailId}@mail.example.com>`,
  },
});

// Compute Svix cryptographic HMAC signature
const svixId = `msg_${Date.now()}`;
const svixTimestamp = Math.floor(Date.now() / 1000).toString();
const secretKey = secret.startsWith("whsec_") ? secret.slice(6) : secret;
const secretBytes = Buffer.from(secretKey, "base64");
const signedPayload = `${svixId}.${svixTimestamp}.${payload}`;
const signature = crypto.createHmac("sha256", secretBytes).update(signedPayload).digest("base64");

try {
  console.log("📡 Sending cryptographically signed inbound reply webhook...");
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": `v1,${signature}`,
      // Fallback auth header for direct relay:
      authorization: `Bearer ${secret}`,
    },
    body: payload,
  });

  const statusText = `${res.status} ${res.statusText}`;
  const responseText = await res.text();
  console.log(`HTTP Status:    ${statusText}`);
  console.log(`Response Body:  ${responseText}`);

  if (res.ok) {
    console.log("\n✅ SUCCESS! Inbound reply was received and processed!");
    console.log("----------------------------------------------------------");
    console.log("👉 CHECK YOUR APPLICATION NOW:");
    console.log(`1. Reply Handling: ${targetBase}/dashboard/replies`);
    console.log(`2. Full Inbox Feed:   ${targetBase}/inbox`);
    console.log(`\nNew Thread Created:`);
    console.log(`   From:    ${testSenderEmail}`);
    console.log(`   To:      ${toEmail}`);
    console.log(`   Subject: ${testSubject}`);
    console.log("----------------------------------------------------------\n");
  } else {
    console.error("\n❌ FAILED: Webhook rejected the payload.");
  }
} catch (err) {
  console.error("\n❌ Network Error:", err.message);
  if (err.cause?.code === "ECONNREFUSED" || err.message?.includes("fetch failed")) {
    console.error(`\n💡 DIAGNOSIS: Connection refused at ${targetBase}`);
    console.error("   The Next.js application server is currently NOT running on this port.");
    console.error("   To test this webhook against your local application:");
    console.error("     1. Start your local server in another terminal: npm run dev");
    console.error(`     2. Re-run: node scripts/test-reply-webhook.mjs ${targetBase}`);
    console.error("\n   Or if your server is running on a different port/URL:");
    console.error("     node scripts/test-reply-webhook.mjs http://localhost:3001");
    console.error("     node scripts/test-reply-webhook.mjs https://your-production-app.com");
    console.error("\n   Note: Automated end-to-end tests for the reply webhook run in-memory via:");
    console.error("     npm test\n");
  }
}
