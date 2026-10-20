import {
  STAGING_ADMIN_EMAIL,
  STAGING_ADMIN_USER,
  STAGING_ARCHIVE_MARKER,
  STAGING_DRAFT_MARKER,
  STAGING_PUBLIC_MARKER,
} from "./disposable-staging.mjs";

const baseUrl = `http://127.0.0.1:${process.env.PORT || 3000}`;
const webhookInspector = "http://portaless-webhook:4181";

async function waitFor(url, label, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (response.ok) return;
      lastError = new Error(`${label}: HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${label} no quedó listo: ${lastError?.message ?? "timeout"}`);
}

await waitFor(`${baseUrl}/healthz`, "Portaless Docker runtime");
await waitFor(`${webhookInspector}/healthz`, "synthetic webhook inspector");

const publicPage = await fetch(`${baseUrl}/pages/staging-public/`);
if (!publicPage.ok || !(await publicPage.text()).includes(STAGING_PUBLIC_MARKER)) {
  throw new Error("Docker runtime did not serve the synthetic public PageStore fixture.");
}
for (const slug of ["staging-draft", "staging-private"]) {
  const response = await fetch(`${baseUrl}/pages/${slug}/`);
  if (response.status !== 404) throw new Error(`Docker runtime exposed ${slug}: HTTP ${response.status}`);
}
const llms = await (await fetch(`${baseUrl}/llms.txt`)).text();
if (llms.includes(STAGING_DRAFT_MARKER) || llms.includes(STAGING_ARCHIVE_MARKER)) {
  throw new Error("Docker runtime leaked a private marker through llms.txt.");
}

const reset = await fetch(`${baseUrl}/admin/password-reset/request`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: STAGING_ADMIN_USER }),
});
if (!reset.ok || (await reset.json()).devToken) throw new Error("Password reset did not use the fake delivery backend.");
const inboxResponse = await fetch(`${webhookInspector}/messages`, {
  headers: { "x-staging-inspector-token": process.env.PORTALESS_STAGING_INSPECTOR_TOKEN ?? "" },
});
if (!inboxResponse.ok) throw new Error("Could not inspect synthetic webhook inbox.");
const inbox = await inboxResponse.json();
const resetMessage = inbox.messages?.find((message) => message.to === STAGING_ADMIN_EMAIL);
if (!resetMessage || !resetMessage.text.includes("https://portaless-staging.example.invalid/admin/password-reset?token=")) {
  throw new Error("Synthetic password-reset email was not delivered with a trusted URL.");
}

console.log(JSON.stringify({
  publicPage: true,
  privateRoutes: "404",
  llms: "filtered",
  resetEmail: "fake webhook accepted",
}));
