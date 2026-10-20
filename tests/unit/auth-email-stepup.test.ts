// Base del step-up por email (ROADMAP: "Email-based step-up verification
// for sensitive actions (blocked on an email:send backend)"). Esta prueba
// cubre la PRIMITIVA: el backend email:send (webhook / dev-capture /
// unavailable explicito) y los codecs OTP de AuthService
// (requestEmailStepUpCode / verifyEmailStepUpCode). Cablearla en los
// endpoints de acciones sensibles queda pendiente de revision.
//
// AuthService se instancia con los stores en memoria reales del paquete
// (no mocks): se prueba el flujo completo, incluida la ida y vuelta
// codigo-en-el-email -> verify.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AuthService } from "../../packages/auth/src/auth-service";
import { InMemoryUsersStore } from "../../packages/auth/src/users-store";
import { InMemorySessionStore } from "../../packages/auth/src/session-store";
import { InMemoryEmailStepUpStore, EMAIL_STEPUP_TTL_MS, EMAIL_STEPUP_MAX_ATTEMPTS } from "../../packages/auth/src/email-stepup-store";
import {
  createEmailSender,
  EmailBackendUnavailableError,
  SmtpEmailSender,
  clearCapturedEmails,
  getCapturedEmails,
  type EmailMessage,
  type EmailSender,
} from "../../packages/auth/src/email-sender";
import { createEmailStepUpStore } from "../../packages/auth/src/store-factory";

function fakeSender() {
  const sent: EmailMessage[] = [];
  const sender: EmailSender = {
    async send(message) {
      sent.push({ ...message });
    },
  };
  return { sender, sent };
}

async function serviceWithUser(email?: string) {
  const users = new InMemoryUsersStore();
  await users.createUser("alice", "hunter2hunter2", "admin", email);
  return new AuthService(users, new InMemorySessionStore(), null as never);
}

function codeFromMessage(message: EmailMessage): string {
  const match = message.text.match(/codigo de verificacion es: (\d{8})/);
  if (!match) throw new Error(`codigo no encontrado en el email: ${message.text}`);
  return match[1];
}

describe("createEmailSender", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    clearCapturedEmails();
  });

  it("con PORTALESS_EMAIL_WEBHOOK_URL hace POST JSON con Bearer token opcional", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchSpy);

    const sender = createEmailSender({ PORTALESS_EMAIL_WEBHOOK_URL: "https://mail.example/send", PORTALESS_EMAIL_WEBHOOK_TOKEN: "tok-1" });
    await sender.send({ to: "a@example.com", subject: "hola", text: "cuerpo" });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://mail.example/send");
    expect(init.method).toBe("POST");
    expect(init.headers.authorization).toBe("Bearer tok-1");
    expect(JSON.parse(init.body)).toEqual({ to: "a@example.com", subject: "hola", text: "cuerpo" });
  });

  it("un HTTP no-2xx del webhook es error explicito (nunca exito silencioso)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 502 }));
    const sender = createEmailSender({ PORTALESS_EMAIL_WEBHOOK_URL: "https://mail.example/send" });
    await expect(sender.send({ to: "a@x.com", subject: "s", text: "t" })).rejects.toThrow("HTTP 502");
  });

  it("con PORTALESS_DEV_MODE=1 sin webhook usa el capturador en memoria (no envia nada)", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const sender = createEmailSender({ PORTALESS_DEV_MODE: "1" });
    await sender.send({ to: "dev@example.com", subject: "s", text: "t" });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(getCapturedEmails()).toEqual([{ to: "dev@example.com", subject: "s", text: "t" }]);
  });

  it("configura SMTP 587 con STARTTLS opcional anunciado y exige sender y par usuario/clave", () => {
    expect(createEmailSender({
      PORTALESS_EMAIL_SMTP_HOST: "smtp.example.test",
      PORTALESS_EMAIL_FROM: "auth@example.test",
      __PORTALESS_RUNTIME: "node",
    })).toBeInstanceOf(SmtpEmailSender);
    expect(() => createEmailSender({
      PORTALESS_EMAIL_SMTP_HOST: "smtp.example.test",
      PORTALESS_EMAIL_SMTP_USERNAME: "mailer",
      PORTALESS_EMAIL_FROM: "auth@example.test",
      __PORTALESS_RUNTIME: "node",
    })).toThrow(/juntos/);
    expect(() => createEmailSender({
      PORTALESS_EMAIL_SMTP_HOST: "smtp.example.test",
      PORTALESS_EMAIL_SMTP_PORT: "not-a-port",
      PORTALESS_EMAIL_FROM: "auth@example.test",
      __PORTALESS_RUNTIME: "node",
    })).toThrow(/puerto valido/);
  });

  it("rechaza SMTP directo fuera del runtime self-hosted", () => {
    expect(() => createEmailSender({
      PORTALESS_EMAIL_SMTP_HOST: "smtp.example.test",
      PORTALESS_EMAIL_FROM: "auth@example.test",
    })).toThrow(/webhook en Cloudflare/);
  });

  it("sin webhook ni dev mode LANZA EmailBackendUnavailableError", () => {
    expect(() => createEmailSender({})).toThrow(EmailBackendUnavailableError);
    expect(() => createEmailSender(null)).toThrow(EmailBackendUnavailableError);
  });
});

describe("AuthService.requestEmailStepUpCode", () => {
  it("emite un codigo de 8 digitos al email del usuario y el verify lo acepta (ida y vuelta completa)", async () => {
    const auth = await serviceWithUser("alice@example.com");
    const store = new InMemoryEmailStepUpStore();
    const { sender, sent } = fakeSender();

    const issued = await auth.requestEmailStepUpCode("alice", store, sender);
    expect(issued.sent).toBe(true);
    if (!issued.sent) return;

    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("alice@example.com");
    const code = codeFromMessage(sent[0]);
    expect(code).toMatch(/^\d{8}$/);

    const result = await auth.verifyEmailStepUpCode(issued.token, code, store);
    expect(result).toEqual({ ok: true });
    // Un solo uso: el challenge quedo consumido.
    expect(await auth.verifyEmailStepUpCode(issued.token, code, store)).toEqual({ ok: false, reason: "invalid_or_expired" });
  });

  it("usuario sin email -> user_has_no_email, sin enviar y sin challenge", async () => {
    const auth = await serviceWithUser(undefined);
    const store = new InMemoryEmailStepUpStore();
    const { sender, sent } = fakeSender();

    const issued = await auth.requestEmailStepUpCode("alice", store, sender);
    expect(issued).toEqual({ sent: false, reason: "user_has_no_email" });
    expect(sent).toHaveLength(0);
    expect(store.size()).toBe(0);
  });

  it("usuario inexistente -> user_not_found", async () => {
    const auth = await serviceWithUser("a@x.com");
    const { sender } = fakeSender();
    expect(await auth.requestEmailStepUpCode("nobody", new InMemoryEmailStepUpStore(), sender)).toEqual({
      sent: false,
      reason: "user_not_found",
    });
  });

  it("sin backend de email -> no_email_backend y el challenge no queda huerfano", async () => {
    const auth = await serviceWithUser("alice@example.com");
    const store = new InMemoryEmailStepUpStore();
    const failing: EmailSender = {
      async send() {
        throw new EmailBackendUnavailableError();
      },
    };

    expect(await auth.requestEmailStepUpCode("alice", store, failing)).toEqual({ sent: false, reason: "no_email_backend" });
    expect(store.size()).toBe(0);
  });

  it("un fallo de red del webhook -> email_send_failed y tampoco deja challenge", async () => {
    const auth = await serviceWithUser("alice@example.com");
    const store = new InMemoryEmailStepUpStore();
    const failing: EmailSender = {
      async send() {
        throw new Error("ECONNREFUSED");
      },
    };

    expect(await auth.requestEmailStepUpCode("alice", store, failing)).toEqual({ sent: false, reason: "email_send_failed" });
    expect(store.size()).toBe(0);
  });
});

describe("AuthService.verifyEmailStepUpCode", () => {
  let auth: AuthService;
  let store: InMemoryEmailStepUpStore;
  let sent: EmailMessage[];
  let token: string;
  let code: string;

  beforeEach(async () => {
    auth = await serviceWithUser("alice@example.com");
    store = new InMemoryEmailStepUpStore();
    const fake = fakeSender();
    sent = fake.sent;
    const issued = await auth.requestEmailStepUpCode("alice", store, fake.sender);
    if (!issued.sent) throw new Error("fixture: no se emitio el codigo");
    token = issued.token;
    code = codeFromMessage(sent[0]);
  });

  it("codigo incorrecto -> invalid_code y consume un intento", async () => {
    const wrong = code === "00000000" ? "00000001" : "00000000";
    expect(await auth.verifyEmailStepUpCode(token, wrong, store)).toEqual({ ok: false, reason: "invalid_code" });
    const challenge = await store.get(token, Date.now());
    expect(challenge?.failedAttempts).toBe(1);
  });

  it(`tras ${EMAIL_STEPUP_MAX_ATTEMPTS} fallos el challenge se quema (max_attempts_exhausted)`, async () => {
    for (let i = 1; i <= EMAIL_STEPUP_MAX_ATTEMPTS; i++) {
      const wrong = `${10000000 + i}`;
      const result = await auth.verifyEmailStepUpCode(token, wrong, store);
      const isLast = i === EMAIL_STEPUP_MAX_ATTEMPTS;
      expect(result).toEqual(isLast ? { ok: false, reason: "max_attempts_exhausted" } : { ok: false, reason: "invalid_code" });
    }
    // Quemado: ni siquiera el codigo correcto pasa despues.
    expect(await auth.verifyEmailStepUpCode(token, code, store)).toEqual({ ok: false, reason: "invalid_or_expired" });
  });

  it("codigo correcto despues de fallos parciales sigue pasando (no se quema antes de tiempo)", async () => {
    const wrong = code === "00000000" ? "00000001" : "00000000";
    await auth.verifyEmailStepUpCode(token, wrong, store);
    await auth.verifyEmailStepUpCode(token, wrong, store);
    expect(await auth.verifyEmailStepUpCode(token, code, store)).toEqual({ ok: true });
  });

  it("token vencido -> invalid_or_expired", async () => {
    const later = Date.now() + EMAIL_STEPUP_TTL_MS + 1;
    expect(await auth.verifyEmailStepUpCode(token, code, store, later)).toEqual({ ok: false, reason: "invalid_or_expired" });
  });

  it("token desconocido -> invalid_or_expired", async () => {
    expect(await auth.verifyEmailStepUpCode("deadbeef", code, store)).toEqual({ ok: false, reason: "invalid_or_expired" });
  });
});

describe("createEmailStepUpStore -- SQLite real", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "portaless-email-stepup-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("con PORTALESS_SQLITE_PATH persiste el ciclo completo (crear, fallar, consumir, expirar, borrar)", async () => {
    const dbPath = join(dir, "portaless-test.db");
    const store = await createEmailStepUpStore({ PORTALESS_SQLITE_PATH: dbPath });
    const now = Date.now();

    await store.create("tok-1", { username: "alice", codeHash: "aa".repeat(32), expiresAt: now + EMAIL_STEPUP_TTL_MS });
    expect((await store.get("tok-1", now))?.username).toBe("alice");

    // Un fallo no bloquea el consume: solo agotar maxAttempts lo hace.
    expect(await store.recordFailure("tok-1", now)).toBe(1);
    const consumed = await store.consume("tok-1", now, EMAIL_STEPUP_MAX_ATTEMPTS);
    expect(consumed?.username).toBe("alice");
    expect(await store.get("tok-1", now)).toBeNull(); // un solo uso

    await store.create("tok-2", { username: "bob", codeHash: "bb".repeat(32), expiresAt: now + 1000 });
    expect(await store.consume("tok-2", now + 1001, EMAIL_STEPUP_MAX_ATTEMPTS)).toBeNull(); // vencido

    await store.create("tok-3", { username: "carol", codeHash: "cc".repeat(32), expiresAt: now + EMAIL_STEPUP_TTL_MS });
    await store.delete("tok-3");
    expect(await store.get("tok-3", now)).toBeNull(); // limpieza tras envio fallido
  });
});
