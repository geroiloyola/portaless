#!/usr/bin/env node
// C37/C38: verify the minimal runtime tree and private profile invariants.
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { MINIMAL_RUNTIME_PROFILE, validatePrivateNetworkProfile } from "../packages/deploy-engine/src/runtime-profile.ts";

const root = resolve(process.argv[2] || process.cwd());
const errors = [];
for (const relative of MINIMAL_RUNTIME_PROFILE.requiredRuntimePathsAbsent) {
  if (existsSync(join(root, relative))) errors.push(`build-only path present in runtime: ${relative}`);
}
try {
  const compose = readFileSync(join(root, "docker-compose.private.yml"), "utf8");
  const errorsFromProfile = validatePrivateNetworkProfile({
    publishedPorts: /^\s+ports:/m.test(compose.split("tailscale:")[0]) ? 1 : 0,
    internalNetwork: /internal:\s*true/.test(compose),
    tailscaleOptional: /profiles:\s*\["tailscale"\]/.test(compose),
  });
  errors.push(...errorsFromProfile);
} catch {
  errors.push("docker-compose.private.yml missing");
}
if (errors.length) {
  console.error("runtime profile FAILED:\n" + errors.map((error) => `- ${error}`).join("\n"));
  process.exit(1);
}
console.log(`runtime profile OK: ${MINIMAL_RUNTIME_PROFILE.name}; no build-only paths; private compose has no app ports and optional tailscale.`);
