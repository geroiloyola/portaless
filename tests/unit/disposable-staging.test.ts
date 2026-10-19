// C04: staging disposable real sobre SQLite/runtime fixtures, solo datos y
// credenciales sinteticos. Todo servicio de red se liga a 127.0.0.1; cleanup
// acepta solo el ID generado y un directorio con ownership marker valido.
import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createDisposableStaging,
  destroyDisposableStaging,
  STAGING_ARCHIVE_MARKER,
  STAGING_DRAFT_MARKER,
  STAGING_PUBLIC_MARKER,
  STAGING_SECRET_MARKER,
} from "../../scripts/staging/disposable-staging.mjs";
import { createUsersStore } from "../../packages/auth/src/store-factory";
import { createPageStore } from "../../packages/atomic-elements/src/persistence/store-factory";
import { createSiteSettingsStore } from "../../packages/dashboard/src/site-settings/site-settings-store";
import { parseEmailSettings } from "../../packages/email-transport/src/config";
import { sendEmail, sendViaWebhook } from "../../packages/email-transport/src/send";

const roots: string[] = [];
const fixtures: Array<Awaited<ReturnType<typeof createDisposableStaging>>> = [];

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "portaless-staging-test-root-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  while (fixtures.length) await fixtures.pop()!.close();
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe("C04 disposable staging fixture", () => {
  it("crea DB, admin, documentos y credenciales solo sinteticos bajo un namespace unico", async () => {
    const rootDir = tempRoot();
    const fixture = await createDisposableStaging({ rootDir });
    fixtures.push(fixture);

    expect(fixture.stageDir.startsWith(`${realpathSync(rootDir)}/`)).toBe(true);
    expect(existsSync(fixture.dbPath)).toBe(true);
    expect(fixture.env.HOST).toBe("127.0.0.1");
    expect(fixture.services.webhookUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//);
    expect(fixture.services.smtpPort).toBeGreaterThan(0);

    const users = await createUsersStore(fixture.env);
    expect(await users.findByUsername(fixture.synthetic.adminUser)).toMatchObject({ role: "admin" });
    const pages = await createPageStore(fixture.env);
    const slugs = await pages.list();
    expect(slugs).toContain("staging-public");
    expect(slugs).toContain("staging-draft");
    expect(slugs).toContain("staging-private");
    expect((await pages.load("staging-draft"))?.root[0]).toMatchObject({
      props: { text: STAGING_DRAFT_MARKER },
    });

    const settings = await parseEmailSettings(await createSiteSettingsStore(fixture.env));
    expect(settings.provider.kind).toBe("none"); // staging no desactiva SSRF protection
    expect(await (await createSiteSettingsStore(fixture.env)).get("staging.synthetic_secret")).toBe(fixture.synthetic.webhookToken);
    expect(readFileSync(join(fixture.workspaceDir, ".airchive-synthetic.md"), "utf8")).toContain(STAGING_ARCHIVE_MARKER);
    expect(readFileSync(join(fixture.workspaceDir, ".env.synthetic"), "utf8")).toContain(STAGING_SECRET_MARKER);
    expect(fixture.synthetic.publicMarker).toBe(STAGING_PUBLIC_MARKER);
    expect(fixture.synthetic.draftMarker).toBe(STAGING_DRAFT_MARKER);
  });

  it("webhook y SMTP fake aceptan trafico de prueba sin salir de loopback", async () => {
    const fixture = await createDisposableStaging({ rootDir: tempRoot() });
    fixtures.push(fixture);

    await sendViaWebhook(
      { kind: "webhook", url: fixture.services.webhookUrl, token: fixture.synthetic.webhookToken },
      { from: "staging@example.invalid", to: "recipient@example.invalid", subject: "Synthetic", text: fixture.synthetic.secretMarker },
    );
    expect(fixture.services.webhookRequests).toHaveLength(1);
    expect(fixture.services.webhookRequests[0].body).toContain(fixture.synthetic.secretMarker);
    expect(fixture.services.webhookRequests[0].authorization).toBe(`Bearer ${fixture.synthetic.webhookToken}`);

    await sendEmail(
      { kind: "smtp", host: "127.0.0.1", port: fixture.services.smtpPort },
      { from: "staging@example.invalid", to: "recipient@example.invalid", subject: "Synthetic", text: fixture.synthetic.secretMarker },
    );
    expect(fixture.services.smtpMessages).toHaveLength(1);
    expect(fixture.services.smtpMessages[0]).toContain(fixture.synthetic.secretMarker);
  });

  it("seed de contenedor prepara SQLite sintético sin abrir listeners en el host", async () => {
    const fixture = await createDisposableStaging({ rootDir: tempRoot(), startFakes: false });
    fixtures.push(fixture);
    expect(existsSync(fixture.dbPath)).toBe(true);
    expect(fixture.services.webhookUrl).toBeNull();
    expect(fixture.services.smtpPort).toBeUndefined();
    expect(await (await createUsersStore(fixture.env)).findByUsername(fixture.synthetic.adminUser)).toMatchObject({
      email: "staging-admin@example.invalid",
      role: "admin",
    });
  });

  it("cleanup por ID borra solo la fixture propia y deja intacto un recurso vecino", async () => {
    const rootDir = tempRoot();
    const fixture = await createDisposableStaging({ rootDir, seed: false });
    fixtures.push(fixture);
    const neighbor = join(rootDir, "operator-data-do-not-delete.txt");
    writeFileSync(neighbor, "unrelated", { flag: "wx" });

    await fixture.close();
    fixtures.pop(); // ya se cerro explicitamente; no repetir el close
    expect(existsSync(fixture.stageDir)).toBe(false);
    expect(readFileSync(neighbor, "utf8")).toBe("unrelated");
  });

  it("rechaza IDs arbitrarios y no elimina directorios sin ownership marker", async () => {
    const rootDir = tempRoot();
    await expect(destroyDisposableStaging({ id: "../../important", rootDir })).rejects.toThrow(/Invalid staging ID/);
    const foreign = join(rootDir, "stage-aaaaaaaaaaaaaaaaaaaaaaaa-foreign");
    mkdirSync(foreign);
    writeFileSync(join(foreign, "keep.txt"), "untouched");
    await expect(destroyDisposableStaging({ id: "aaaaaaaaaaaaaaaaaaaaaaaa", rootDir })).rejects.toThrow(/ownership marker/);
    expect(readFileSync(join(foreign, "keep.txt"), "utf8")).toBe("untouched");
  });
});
