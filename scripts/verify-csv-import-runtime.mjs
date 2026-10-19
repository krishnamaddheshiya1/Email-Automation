const BASE_URL = "http://localhost:3000";

async function run() {
  console.log("=== RUNTIME VERIFICATION OF CSV IMPORT BUG FIX ===");
  const timestamp = Date.now();
  const emailA = `client_a_${timestamp}@opsiys.in`;
  const password = "Password123!@#Secure";

  // 1. Register Tenant A
  console.log("\n1. Registering Tenant A...");
  const regARes = await fetch(`${BASE_URL}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      full_name: "Tenant A Admin",
      business_name: `Tenant A Workspace ${timestamp}`,
      email: emailA,
      password,
    }),
  });

  const regAData = await regARes.json();
  if (!regARes.ok || !regAData.success) {
    throw new Error(`Tenant A registration failed: ${JSON.stringify(regAData)}`);
  }
  const cookiesA = regARes.headers.get("set-cookie");
  const cookieHeaderA = cookiesA
    ? cookiesA
        .split(",")
        .map((c) => c.split(";")[0].trim())
        .join("; ")
    : "";

  console.log("Tenant A registered:", regAData.business.id);

  // 2. Add 1 contact manually for Tenant A
  console.log("\n2. Creating 1 manual contact for Tenant A...");
  const manualRes = await fetch(`${BASE_URL}/api/contacts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookieHeaderA,
    },
    body: JSON.stringify({
      first_name: "Manual",
      last_name: "Contact",
      email: `manual_${timestamp}@opsiys.in`,
      company_name: "ManualCorp",
      job_title: "Manager",
      status: "NEW",
      source: "manual",
    }),
  });

  const manualData = await manualRes.json();
  console.log("Manual contact create response:", manualData.success, manualData.data?.id);
  if (!manualData.success) throw new Error("Manual contact creation failed");

  // 3. Import 2 contacts via CSV for Tenant A (including non-standard status 'TEST')
  console.log("\n3. Importing 2 contacts via CSV for Tenant A...");
  const csvContent = `First Name,Last Name,Email,Company,Job Title,Status,Source\nAlex,Rivera,alex_${timestamp}@opsiys.in,AlexCorp,Engineer,TEST,Owner-controlled test\nElena,Rostova,elena_${timestamp}@opsiys.in,ElenaCorp,Director,active,csv_import`;

  const importRes = await fetch(`${BASE_URL}/api/contacts/import`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookieHeaderA,
    },
    body: JSON.stringify({
      csv: csvContent,
      filename: "import.csv",
      mode: "CREATE_ONLY",
    }),
  });

  const importData = await importRes.json();
  console.log("CSV Import response:", importData.success, importData.summary);
  if (!importData.success || importData.summary.importedCount !== 2) {
    throw new Error(`CSV import failed: ${JSON.stringify(importData)}`);
  }

  // 4. Fetch contacts list (GET /api/contacts)
  console.log("\n4. Fetching GET /api/contacts for Tenant A...");
  const listRes1 = await fetch(`${BASE_URL}/api/contacts?page=1&limit=10&sortBy=created_at&sortOrder=desc`, {
    headers: {
      Cookie: cookieHeaderA,
      "Cache-Control": "no-cache",
    },
  });

  const listData1 = await listRes1.json();
  console.log("Contacts list response:", {
    success: listData1.success,
    total: listData1.total,
    returnedCount: listData1.data?.length,
    contacts: listData1.data?.map((c) => ({
      name: `${c.first_name} ${c.last_name}`,
      email: c.email,
      source: c.source,
      status: c.status,
    })),
  });

  if (listData1.total !== 3 || listData1.data?.length !== 3) {
    throw new Error(`Expected 3 contacts, got total=${listData1.total}, returned=${listData1.data?.length}`);
  }

  // 5. Fetch Dashboard Overview
  console.log("\n5. Fetching GET /api/dashboard/overview for Tenant A...");
  const dashRes = await fetch(`${BASE_URL}/api/dashboard/overview`, {
    headers: {
      Cookie: cookieHeaderA,
      "Cache-Control": "no-cache",
    },
  });

  const dashData = await dashRes.json();
  const totalContacts = dashData.data?.metrics?.totalContacts;
  console.log("Dashboard overview response:", {
    success: dashData.success,
    totalContacts,
  });

  if (totalContacts !== 3) {
    throw new Error(`Expected dashboard totalContacts=3, got ${totalContacts}`);
  }

  // 6. Refresh verification (GET /api/contacts again)
  console.log("\n6. Simulating browser reload / second GET /api/contacts...");
  const listRes2 = await fetch(`${BASE_URL}/api/contacts?page=1&limit=10&sortBy=created_at&sortOrder=desc`, {
    headers: {
      Cookie: cookieHeaderA,
      "Cache-Control": "no-cache",
    },
  });
  const listData2 = await listRes2.json();
  console.log("Reload contacts total:", listData2.total);
  if (listData2.total !== 3) throw new Error("Contacts disappeared after reload!");

  // 7. Multi-Tenant Isolation Verification: Register Tenant B
  console.log("\n7. Registering Tenant B and checking cross-tenant isolation...");
  const emailB = `client_b_${timestamp}@opsiys.in`;
  const regBRes = await fetch(`${BASE_URL}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      full_name: "Tenant B Admin",
      business_name: `Tenant B Workspace ${timestamp}`,
      email: emailB,
      password,
    }),
  });
  const regBData = await regBRes.json();
  if (!regBRes.ok || !regBData.success) {
    throw new Error(`Tenant B registration failed: ${JSON.stringify(regBData)}`);
  }
  const cookiesB = regBRes.headers.get("set-cookie");
  const cookieHeaderB = cookiesB
    ? cookiesB
        .split(",")
        .map((c) => c.split(";")[0].trim())
        .join("; ")
    : "";

  const listBRes = await fetch(`${BASE_URL}/api/contacts`, {
    headers: {
      Cookie: cookieHeaderB,
      "Cache-Control": "no-cache",
    },
  });
  const listBData = await listBRes.json();
  console.log("Tenant B contacts total:", listBData.total);
  if (listBData.total !== 0) {
    throw new Error(`Tenant B should have 0 contacts, but got ${listBData.total}`);
  }

  console.log("\n=== ALL RUNTIME VERIFICATION CHECKS PASSED PERFECTLY! ===");
}

run().catch((err) => {
  console.error("Runtime verification failed:", err);
  process.exit(1);
});
