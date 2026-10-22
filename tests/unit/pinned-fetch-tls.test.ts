import { describe, expect, it } from "vitest";
import { createServer, request } from "node:https";
import { createSecureContext } from "node:tls";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createPinnedFetch } from "../../server/node-runtime.mjs";

describe("R4 pinned IP retains TLS hostname authentication", () => {
  it("rejects a trusted, unexpired certificate for another hostname, with URL SNI", async () => {
    const dir = mkdtempSync(join(tmpdir(), "portaless-tls-"));
    const keyFile = join(dir, "key.pem");
    const certFile = join(dir, "cert.pem");
    let server: ReturnType<typeof createServer> | undefined;
    try {
      execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
        "-subj", "/CN=other.example", "-addext", "subjectAltName=DNS:other.example", "-keyout", keyFile, "-out", certFile], { stdio: "ignore" });
      const key = readFileSync(keyFile);
      const cert = readFileSync(certFile);
      const names: string[] = [];
      let httpRequests = 0;
      server = createServer({ key, cert, SNICallback(name, done) { names.push(name); done(null, createSecureContext({ key, cert })); } }, (_req, res) => {
        httpRequests++;
        res.end('{"keys":[]}');
      });
      await new Promise<void>((done) => server!.listen(0, "127.0.0.1", done));
      const port = (server.address() as any).port;
      // Trust this fixture CA, but do not disable certificate or hostname checks.
      const pinned = createPinnedFetch((url: URL, options: any, done: any) => request(url, { ...options, ca: cert, agent: false }, done));
      await expect(pinned(`https://expected.example:${port}/`, { signal: AbortSignal.timeout(3000) }, "127.0.0.1"))
        .rejects.toMatchObject({ code: "ERR_TLS_CERT_ALTNAME_INVALID" });
      expect(httpRequests).toBe(0);
      const valid = await pinned(`https://other.example:${port}/`, { signal: AbortSignal.timeout(3000) }, "127.0.0.1");
      expect(await valid.text()).toBe('{"keys":[]}');
      expect(names).toEqual(["expected.example", "other.example"]);
      expect(httpRequests).toBe(1);
    } finally {
      if (server) await new Promise<void>((done) => { server!.close(() => done()); server!.closeAllConnections(); });
      rmSync(dir, { recursive: true, force: true });
    }
  }, 15_000);
});
