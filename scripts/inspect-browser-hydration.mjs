import { spawn } from "child_process";

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9222;
const USER_DATA = "C:\\Users\\hp\\AppData\\Local\\Temp\\chrome-debug-profile-" + Date.now();

async function getWsUrl() {
  for (let i = 0; i < 20; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (res.ok) {
        const json = await res.json();
        return json.webSocketDebuggerUrl;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("Could not connect to Chrome debugging port");
}

async function loginAndGetCookies() {
  const ts = Date.now();
  const email = `chrome_verifier_${ts}@opsiys.in`;
  const password = "Password123!Chrome";

  const regRes = await fetch("http://localhost:3000/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      password,
      full_name: "Chrome Verifier",
      business_name: `Chrome Corp ${ts}`,
    }),
  });

  const rawCookies = regRes.headers.get("set-cookie") || "";
  console.log("Registered test user for browser inspection. Set-Cookie received:", Boolean(rawCookies));

  // Parse cookies
  const cookies = [];
  const parts = rawCookies.split(/,(?=[^;]+=[^;]+)/);
  for (const part of parts) {
    const match = part.match(/^\s*([^=;]+)=([^;]*)/);
    if (match) {
      cookies.push({
        name: match[1].trim(),
        value: match[2].trim(),
        domain: "localhost",
        path: "/",
      });
    }
  }
  return cookies;
}

async function run() {
  console.log("Preparing authenticated session...");
  const authCookies = await loginAndGetCookies();

  console.log("Launching headless Chrome...");
  const chrome = spawn(CHROME_PATH, [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${USER_DATA}`,
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--disable-extensions",
    "about:blank",
  ], { stdio: "ignore" });

  try {
    const wsUrl = await getWsUrl();
    console.log("Connected to Chrome CDP:", wsUrl);

    const ws = new WebSocket(wsUrl);
    await new Promise((resolve) => ws.onopen = resolve);

    let id = 1;
    function send(method, params = {}) {
      return new Promise((resolve) => {
        const reqId = id++;
        const handler = (evt) => {
          const msg = JSON.parse(evt.data);
          if (msg.id === reqId) {
            ws.removeEventListener("message", handler);
            resolve(msg.result);
          }
        };
        ws.addEventListener("message", handler);
        ws.send(JSON.stringify({ id: reqId, method, params }));
      });
    }

    // Create a new target/page
    const target = await send("Target.createTarget", { url: "about:blank" });
    const targetWsUrl = `ws://127.0.0.1:${PORT}/devtools/page/${target.targetId}`;
    const pageWs = new WebSocket(targetWsUrl);
    await new Promise((resolve) => pageWs.onopen = resolve);

    let pageMsgId = 1;
    function pageSend(method, params = {}) {
      return new Promise((resolve, reject) => {
        const reqId = pageMsgId++;
        const handler = (evt) => {
          const msg = JSON.parse(evt.data);
          if (msg.id === reqId) {
            pageWs.removeEventListener("message", handler);
            if (msg.error) {
              reject(new Error(msg.error.message));
            } else {
              resolve(msg.result);
            }
          }
        };
        pageWs.addEventListener("message", handler);
        pageWs.send(JSON.stringify({ id: reqId, method, params }));
      });
    }

    const hydrationErrors = [];

    pageWs.addEventListener("message", (evt) => {
      const msg = JSON.parse(evt.data);
      if (msg.method === "Runtime.consoleAPICalled") {
        const text = msg.params.args.map((a) => a.value || a.description || JSON.stringify(a)).join(" ");
        if (
          text.toLowerCase().includes("hydrat") ||
          text.toLowerCase().includes("mismatch") ||
          text.toLowerCase().includes("did not match") ||
          text.toLowerCase().includes("didn't match") ||
          text.toLowerCase().includes("won't be patched")
        ) {
          hydrationErrors.push(text);
          console.error("\n🚨 [HYDRATION WARNING/ERROR DETECTED]:\n", text, "\n");
        } else {
          console.log(`[Browser Console ${msg.params.type.toUpperCase()}]`, text.slice(0, 200));
        }
      } else if (msg.method === "Runtime.exceptionThrown") {
        const desc = msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text;
        if (
          desc.toLowerCase().includes("hydrat") ||
          desc.toLowerCase().includes("mismatch") ||
          desc.toLowerCase().includes("did not match") ||
          desc.toLowerCase().includes("didn't match") ||
          desc.toLowerCase().includes("won't be patched")
        ) {
          hydrationErrors.push(desc);
          console.error("\n🚨 [HYDRATION EXCEPTION DETECTED]:\n", desc, "\n");
        } else {
          console.log("[Browser Exception]", desc.slice(0, 200));
        }
      }
    });

    await pageSend("Runtime.enable");
    await pageSend("Page.enable");
    await pageSend("Log.enable");
    await pageSend("Network.enable");

    // Set auth cookies in browser
    if (authCookies.length > 0) {
      await pageSend("Network.setCookies", { cookies: authCookies });
      console.log(`Injected ${authCookies.length} session cookies into Chrome.`);
    }

    const urls = [
      "http://localhost:3000/inbox",
      "http://localhost:3000/dashboard",
      "http://localhost:3000/contacts",
      "http://localhost:3000/campaigns",
      "http://localhost:3000/templates",
      "http://localhost:3000/settings",
      "http://localhost:3000/replies",
      "http://localhost:3000/sent",
      "http://localhost:3000/drafts",
      "http://localhost:3000/starred",
      "http://localhost:3000/snoozed",
    ];

    for (const url of urls) {
      console.log(`\n========================================\nNavigating to: ${url}\n========================================`);
      await pageSend("Page.navigate", { url });
      await new Promise((r) => setTimeout(r, 4000));
    }

    console.log("\n========================================");
    console.log("INSPECTION SUMMARY:");
    console.log(`Total Hydration Errors Caught: ${hydrationErrors.length}`);
    if (hydrationErrors.length > 0) {
      for (const err of hydrationErrors) {
        console.error(" - " + err);
      }
    } else {
      console.log("No hydration errors logged during page navigations.");
    }
    console.log("========================================\n");
  } finally {
    chrome.kill();
  }
}

run().catch(console.error);
