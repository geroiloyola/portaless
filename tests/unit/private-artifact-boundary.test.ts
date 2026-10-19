import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

describe("private distribution boundary", () => {
  it("excludes private archive/runtime paths from Docker contexts", () => {
    const dockerignore = fs.readFileSync(path.join(__dirname, "../../.dockerignore"), "utf8");
    for (const pattern of [".airchive", "**/.airchive", "backups", "**/backups", "**/*.db", "**/.env.*", "**/*.pem", "**/.ssh", "**/.npmrc"]) {
      expect(dockerignore.split(/\r?\n/), pattern).toContain(pattern);
    }
  });

  it("artifact verifier rejects private paths and synthetic secret content", () => {
    const artifact = fs.mkdtempSync(path.join(os.tmpdir(), "portaless-artifact-boundary-"));
    const verifier = path.join(__dirname, "../../scripts/verify-private-artifacts.mjs");
    try {
      fs.mkdirSync(path.join(artifact, "dist"), { recursive: true });
      fs.writeFileSync(path.join(artifact, "dist/index.html"), "public");
      expect(() => execFileSync("node", [verifier, artifact])).not.toThrow();

      fs.mkdirSync(path.join(artifact, ".airchive"), { recursive: true });
      fs.writeFileSync(path.join(artifact, ".airchive/private.md"), "secret");
      expect(() => execFileSync("node", [verifier, artifact])).toThrow();
      fs.rmSync(path.join(artifact, ".airchive"), { recursive: true, force: true });

      fs.writeFileSync(path.join(artifact, "dist/index.html"), "PUBLIC_MARKER secret");
      expect(() => execFileSync("node", [verifier, artifact, "--marker", "PUBLIC_MARKER"])).toThrow();
    } finally {
      fs.rmSync(artifact, { recursive: true, force: true });
    }
  });
});
