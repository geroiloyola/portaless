# @portaless/plugin-sdk

MIT-licensed public surface for **third-party Portaless plugin authors**. Import
it into a closed-source plugin without pulling any AGPL-3.0 code.

```sh
npm install @portaless/plugin-sdk
```

```ts
import {
  validateManifest,
  capabilityRegistry,
  PLUGIN_CAPABILITY_IDS,
  type PluginManifest,
  type PluginEntry,
} from "@portaless/plugin-sdk";

const manifest: PluginManifest = {
  name: "mi-plugin",
  version: "1.0.0",
  entry: "index.js",
  requestedCapabilities: [
    { id: "content:read", reason: "Lee las páginas para generar un resumen." },
  ],
  runtime: "javascript",
};

const { valid, errors } = validateManifest(manifest);
```

A plugin entry receives injected globals, declared here as `PluginEntry`:

```ts
const entry: PluginEntry = async (payload, { capabilities, fetchAllowed, console }) => {
  const pages = await capabilities.readContent({});
  console.log("páginas", pages);
  return { ok: true };
};
```

## What this package is

- **The capability catalog** (`capabilityRegistry`) and the ids a manifest may
  request (`PLUGIN_CAPABILITY_IDS`).
- **Manifest validation** (`validateManifest`) — same rules the core enforces.
- **The typed sandbox contract**: `PluginManifest`, `CapabilityRequest`,
  `GrantedCapabilities`, `CapabilityHostBridge`, `SandboxExecutionInput`,
  `SandboxExecutionResult`, `SandboxAdapter`, and the runtime globals
  (`PluginEntry`, `PluginCapabilities`, `PluginFetchAllowed`).

## What this package is not

- It does **not** import `@portaless/plugin-sandbox` or any other package. The
  core is AGPL-3.0; this package re-declares the contract as its own document so
  that importing it never incorporates AGPL code. Equivalence with the core is
  guaranteed by a test on the **AGPL side**
  (`tests/unit/plugin-sdk-parity.test.ts`), not by a runtime import.
- It ships no runtime engine: the sandbox lives in the core.

## Honest scope (Phase 11)

This is the initial **0.1.0** shape. The capability surface — quotas for
`storage:*`, error codes for the real backends, and the HTTP installer — is
still being wired in the core (Phase 11.2). Treat the exact set of capability
fields as **provisional until that phase closes**; the catalog and manifest
rules are stable.

## License

MIT — see [`LICENSE`](./LICENSE). The rest of Portaless is AGPL-3.0.
Boundary in [`docs/architecture/licensing-boundaries.md`](../../docs/architecture/licensing-boundaries.md).
