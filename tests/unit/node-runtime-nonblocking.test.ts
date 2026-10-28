import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("self-host Node runtime does not block on request I/O (M-09)", () => {
  it("streams response bodies and uses async static file access", () => {
    const source = readFileSync(join(process.cwd(), "server/node-runtime.mjs"), "utf-8");
    expect(source).not.toMatch(/readFileSync\s*\(/);
    expect(source).not.toMatch(/statSync\s*\(/);
    expect(source).not.toMatch(/await response\.arrayBuffer\(\)/);
    expect(source).toContain("pipeline(Readable.fromWeb(response.body), res)");
    expect(source).toContain("createReadStream(fallback)");
  });
});
