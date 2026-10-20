# Portaless plugin author guide

For a developer who wants to write a **plugin** for a Portaless site — a closed
module that runs inside the sandbox and can only touch what an administrator
grants it, one capability at a time. This guide is honest about what is real
today and what is not; where it and the code disagree, the code governs.

- The public, MIT-licensed contract you import: [`@portaless/plugin-sdk`](../packages/plugin-sdk/README.md).
- The sandbox internals (how the isolate works): [`PLUGIN_SANDBOXING.md`](../packages/plugin-sandbox/docs/PLUGIN_SANDBOXING.md).
- The permission model: [`PERMISSIONS_CENTER.md`](../packages/permissions/docs/PERMISSIONS_CENTER.md).

## 1. What a plugin is

A plugin is **code that runs in a sandbox** (an `isolated-vm` isolate self-hosted,
or a Cloudflare Workers for Platforms / Deno Deploy workload) with **no filesystem,
no direct DB, no ambient network**. Everything it can do crosses one of two
channels:

1. **`fetchAllowed(url, opts)`** — network, only if the manifest requests
   `network:fetch` and only for the hosts declared in `allowedHosts`.
2. **`capabilities.*`** — the typed handlers (read/write content, storage, …),
   only for the capabilities an administrator granted in the Permissions Center.

The plugin never talks to the database, the filesystem, or another plugin. It
receives a `payload`, does its work, and returns a value. That is the whole
contract, and it is why a plugin can be closed-source without special trust.

## 2. The manifest

The manifest is the plugin's declaration. It is validated by `validateManifest`
(same rules the core enforces — import it from the SDK so you fail early):

```ts
import { validateManifest, type PluginManifest } from "@portaless/plugin-sdk";

const manifest: PluginManifest = {
  name: "resumen-diario",
  version: "1.0.0",
  entry: "index.js",              // path inside your package
  runtime: "javascript",          // "javascript" (or "wasm", not exercised yet)
  requestedCapabilities: [
    { id: "content:read", reason: "Lee las páginas para resumirlas." },
    { id: "storage:write", reason: "Guarda el estado entre corridas." },
    { id: "storage:read",  reason: "Lee el estado entre corridas." },
  ],
};

const { valid, errors } = validateManifest(manifest);
```

Rules the validator enforces, in short: non-empty `name`/`version`/`entry`;
`requestedCapabilities` present; every capability id is in the catalog; every
request carries a `reason`; `network:fetch` must declare `allowedHosts`. A
capability that is not in [`PLUGIN_CAPABILITY_IDS`](../packages/plugin-sdk/src/index.ts)
(for example `billing:pay-per-crawl` or `trust:read-governance-bypass`) is not a
plugin capability and is rejected.

## 3. Capabilities: request, grant, backend

Three different things, and confusing them is the usual source of bugs:

| | What it is | Who decides |
| --- | --- | --- |
| **Requested** | What your manifest lists | You (the author) |
| **Granted** | What the admin approved | The Permissions Center |
| **Backend** | Whether the host has a real handler for it | The core |

**The effective set is `granted ∩ requested`.** Requesting `site:admin` does
nothing unless an admin grants it, and being granted something you did not
request does nothing either. Ask for the minimum.

**Backends are wired one at a time** (ROADMAP Phase 14). Today:

| Capability | Backend today |
| --- | --- |
| `content:read` / `content:write` | ✅ real (`PageStore`; read sees public pages only; write creates/updates drafts only. It cannot read private pages, publish, or overwrite a published page; an admin approves publication) |
| `storage:read` / `storage:write` | ✅ real (per-plugin store, namespace + quotas) |
| `agent:identify` | ✅ real (read-only: the Trust Layer usage ledger, public fields only) |
| `email:send` | ✅ real (blind delegation: you send `{ template, to, data }`; the site's `from` and the per-plugin daily quota are the core's) |
| `network:fetch` | ✅ real (`fetchAllowed`, host-allowlisted) |
| everything else (`media:*`, `commerce:*`, `site:admin`) | ⛔ answers `501 NOT_CONFIGURED` when granted — a real, separate step |

A `501` is **not** a denial and **not** a fake success: the capability *is*
granted, the host just has no implementation yet. Design around the ones that
are real.

**`storage:*` limits** (per plugin): 64 KiB per value, 256 keys, 1 MiB total.
Writes beyond a limit throw an error you can catch, with one of these
codes: `STORAGE_INVALID_KEY`, `STORAGE_VALUE_TOO_LARGE`, `STORAGE_TOO_MANY_KEYS`,
`STORAGE_QUOTA_EXCEEDED`. Keys must be 1–256 chars of `[A-Za-z0-9._:-]`.
Storage is namespaced to your plugin: you cannot read or overwrite another
plugin's keys, and the plugin name the store sees is fixed by the server, not by
your code.

## 4. The entry contract

Your entry file exports nothing — the sandbox executes it with four injected
globals, declared in the SDK as `PluginEntry`:

```ts
import type { PluginEntry } from "@portaless/plugin-sdk";

// `entry` is your code evaluated by the sandbox; these are the globals in scope.
const myPlugin: PluginEntry = async (payload, { capabilities, fetchAllowed, console }) => {
  const page = await capabilities.readContent({ slug: "inicio" });
  await capabilities.storageWrite({ key: "visto", value: { at: Date.now() } });
  const estado = await capabilities.storageRead({ key: "visto" });
  console.log("estado", estado);
  return { ok: true, page };
};
```

- `payload` — the per-invocation input (whatever the caller passed).
- `capabilities` — the typed handlers; calling one you were not granted throws
  `Capacidad '<id>' no concedida`; a missing record is a normal outcome
  (`content:read` of an unknown slug answers `404 PAGE_NOT_FOUND`, not a `501`).
- `fetchAllowed(url, opts)` — network, gated by `network:fetch` + `allowedHosts`.
- `console.log` — forwarded to the host log.

The **return value** is serialized back to the caller as `output`. Keep it JSON.
The isolate has a memory limit and a wall-clock timeout; do not stream forever.

## 5. Try it locally

The production caller is `POST /admin/api/plugins/run` (admin session; **only a
registered + active plugin** runs). On a Node self-host it loads the plugin from
`PORTALESS_PLUGIN_DIR` (default `packages/plugin-sandbox/examples`) if the plugin
has no stored artifact; an installed plugin (see §7) runs from its stored
artifact.

```sh
# self-host: put your plugin under a dir, point the server at it, then
curl -X POST https://your-site/admin/api/plugins/run \
  -H 'content-type: application/json' --cookie "$SESSION" \
  -d '{"plugin":"resumen-diario","payload":{"desde":"2026-10-01"}}'
```

For pure unit testing of the logic, call your entry the way the sandbox does —
pass a fake `capabilities`/`fetchAllowed`. The core's own tests do this in
[`tests/e2e/sandbox-content-capability-bridge.test.ts`](../tests/e2e/sandbox-content-capability-bridge.test.ts)
and [`tests/e2e/sandbox-capability-bridges.test.ts`](../tests/e2e/sandbox-capability-bridges.test.ts).

## 6. Licensing

- **`@portaless/plugin-sdk` is MIT.** Import it into a closed-source plugin; it
  re-declares the contract and imports **nothing** from the core, so importing
  it never incorporates AGPL code.
- **The rest of Portaless is AGPL-3.0.** Do not import core internals into your
  plugin — talk to the host only through `capabilities.*` / `fetchAllowed`. The
  boundary is recorded in [`licensing-boundaries.md`](./architecture/licensing-boundaries.md)
  and the one-way rule (author-held code may move AGPL → MIT; never the reverse)
  is in [`CONTRIBUTING.md`](../CONTRIBUTING.md).

## 7. Sign and install

Installing is a **publisher-signed** operation (ERRATA **E-15**), behind a flag
that is **off by default**:

1. **Sign the manifest.** The publisher (the holder of a `did:apw` identity)
   signs `{ publisher, iat, manifest }` under `typ apw-plugin-manifest+jws` with
   their Ed25519 key. The reference signer is `signPluginManifest()` in
   [`@portaless/apw-resolver`](../packages/apw-resolver/src/did-apw/plugin-manifest.ts).
   **Honest gap**: there is no one-command packaging/signing CLI today — you call
   the signer (or any JCS + Ed25519 implementation) yourself.
2. **Install.** `POST /admin/api/plugins/install` with `{ manifest: <the JWS>, code }`
   plus step-up credentials, **only if `PORTALESS_PLUGIN_INSTALLER` is enabled**
   (otherwise it answers `404`, no announcement). The installer verifies the
   signature against the publisher's **resolved** `did:apw` identity and stores
   the code chunked, together with the verified manifest.
3. **Installing grants nothing.** The grant stays `granted ∩ manifest`; the admin
   approves capabilities in the Permissions Center, separately. Reinstalling the
   same `(publisher, name, version)` with different bytes or a different manifest
   is rejected (`409`); on update, removed capabilities are pruned and added ones
   return to review — never auto-granted.

## 8. What is honest (so you are not surprised)

- The **HTTPS installer is behind a flag, off by default**, and is not announced,
  until the external sandbox review closes (ROADMAP Phase 14 exit criteria).
- **5 of 12 capabilities have no backend** and answer `501` (§3). `site:admin`
  is a **recorded decision, not a gap** (it has no defined operation set for a
  plugin). `media:*` and `commerce:checkout` need an external provider or a
  per-plugin media namespace. `email:send` **shipped**: you send only
  `{ template, to, data }` for a template the site owner approved; the core
  injects the `from` and enforces a per-plugin daily quota (default 50/day), and
  rejects any `from`/`cc`/`bcc` in the payload.
- Real **edge execution** (Cloudflare/Deno) needs `PORTALESS_CLOUDFLARE_*` /
  `PORTALESS_DENO_*` credentials; without them the runtime falls back to
  `isolated-vm` (Node self-host only).
- There is **no signing CLI** and **no marketplace** in the core — the store and
  the trust vote live in the core, but browsing/installing from a catalog is a
  separate product (AppPlace / AppLibre), by design.
