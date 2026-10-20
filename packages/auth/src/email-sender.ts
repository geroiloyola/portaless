// Backend de email transaccional del SERVIDOR (no el puente email:send de
// plugins, que es otra cosa). Existe para desbloquear step-up por email
// (ROADMAP: "Email-based step-up verification ... blocked on an email:send
// backend"): hasta ahora no habia forma de que Portaless enviara un email,
// y la verificacion reforzada era solo contrasena + TOTP.
//
// Tres estados, todos explicitos (patron NOT_CONFIGURED del repo):
//   - PORTALESS_EMAIL_WEBHOOK_URL: POST JSON { to, subject, text } a la URL
//     del operador; PORTALESS_EMAIL_WEBHOOK_TOKEN es Bearer opcional.
//   - PORTALESS_EMAIL_SMTP_HOST (+ PORT/PASSWORD/FROM): SMTP directo para
//     self-host; default 587 negocia STARTTLS si el relay lo anuncia, 465 usa
//     TLS implicito. Credenciales incompletas fallan cerrado.
//   - PORTALESS_DEV_MODE=1 sin transporte: DevCaptureEmailSender -- NO envia.
//   - Ninguno de los anteriores: createEmailSender() LANZA
//     EmailBackendUnavailableError. Nunca un "exito" que no envio nada:
//     el usuario esperaria un codigo que jamas llegaria.
//
// El envio real del codigo lo hace AuthService.requestEmailStepUpCode();
// aqui vive solo la transporte.

import { isEmailAddress, normalizeEmailHost, normalizeWebhookUrl, type EmailProviderSettings } from "../../email-transport/src/config";
import { EmailDeliveryUnknownError, EmailSendError, sendEmail } from "../../email-transport/src/send";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

export class EmailBackendUnavailableError extends Error {
  constructor(message = "Sin backend de email auth configurado (webhook, SMTP o PORTALESS_DEV_MODE).") {
    super(message);
    this.name = "EmailBackendUnavailableError";
  }
}

/** POST JSON a la URL del operador. Un HTTP no-2xx es error explicito. */
export class HttpWebhookEmailSender implements EmailSender {
  constructor(
    private url: string,
    private token?: string
  ) {}

  async send(message: EmailMessage): Promise<void> {
    if (!isEmailAddress(message.to)) throw new EmailSendError("destinatario de email invalido.");
    const url = normalizeWebhookUrl(this.url, Boolean(this.token));
    if (!url) throw new EmailSendError("webhook de email requiere destino público seguro; con credenciales, use HTTPS.");
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ to: message.to, subject: message.subject, text: message.text }),
        redirect: "manual",
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new EmailDeliveryUnknownError("email webhook could not confirm acceptance; delivery outcome is unknown");
    }
    if (res.status >= 300 && res.status < 400) {
      throw new EmailSendError("email webhook redirect rejected; redirects are disabled");
    }
    if (res.status >= 500) {
      throw new EmailDeliveryUnknownError(`email webhook returned HTTP ${res.status}; prior acceptance cannot be ruled out`);
    }
    if (!res.ok) throw new EmailSendError(`email webhook rejected delivery with HTTP ${res.status}`);
  }
}

/** SMTP transport for self-hosted auth mail; credentials stay in environment variables. */
export class SmtpEmailSender implements EmailSender {
  constructor(private provider: EmailProviderSettings, private from: string) {}

  async send(message: EmailMessage): Promise<void> {
    if (!isEmailAddress(message.to)) throw new EmailSendError("destinatario de email invalido.");
    await sendEmail(this.provider, { ...message, from: this.from });
  }
}

// Dev capture: no envia, guarda. Singleton compartido para que los tests
// (y un dev endpoint futuro) lean lo que "se habria enviado".
const CAPTURE_LIMIT = 20;
const captured: EmailMessage[] = [];

export const devCaptureEmailSender: EmailSender = {
  async send(message: EmailMessage): Promise<void> {
    captured.push({ ...message });
    if (captured.length > CAPTURE_LIMIT) captured.shift();
    console.warn(`[Portaless Email/DEV] a=${message.to} asunto="${message.subject}" -- ${message.text}`);
  },
};

/** Solo para tests/dev: ultimo mensaje capturado por el dev sender. */
export function getCapturedEmails(): EmailMessage[] {
  return captured.map((m) => ({ ...m }));
}

export function clearCapturedEmails(): void {
  captured.length = 0;
}

export function createEmailSender(env?: Record<string, unknown> | null): EmailSender {
  const url = env?.PORTALESS_EMAIL_WEBHOOK_URL;
  if (typeof url === "string" && url.trim()) {
    const token = typeof env.PORTALESS_EMAIL_WEBHOOK_TOKEN === "string" && env.PORTALESS_EMAIL_WEBHOOK_TOKEN
      ? env.PORTALESS_EMAIL_WEBHOOK_TOKEN
      : undefined;
    const normalizedUrl = normalizeWebhookUrl(url, Boolean(token));
    if (!normalizedUrl) throw new EmailBackendUnavailableError("PORTALESS_EMAIL_WEBHOOK_URL debe ser público; si tiene token, debe usar HTTPS.");
    return new HttpWebhookEmailSender(normalizedUrl, token);
  }
  const host = env?.PORTALESS_EMAIL_SMTP_HOST;
  if (typeof host === "string" && host.trim()) {
    if (env?.__PORTALESS_RUNTIME !== "node") {
      throw new EmailBackendUnavailableError("SMTP directo requiere el runtime self-hosted de Node; usa un webhook en Cloudflare Pages.");
    }
    const rawPort = env?.PORTALESS_EMAIL_SMTP_PORT;
    const port = rawPort === undefined || rawPort === "" ? 587 : Number(rawPort);
    const username = typeof env?.PORTALESS_EMAIL_SMTP_USERNAME === "string"
      ? env.PORTALESS_EMAIL_SMTP_USERNAME.trim()
      : "";
    const password = typeof env?.PORTALESS_EMAIL_SMTP_PASSWORD === "string"
      ? env.PORTALESS_EMAIL_SMTP_PASSWORD
      : "";
    const from = typeof env?.PORTALESS_EMAIL_FROM === "string" ? env.PORTALESS_EMAIL_FROM.trim() : "";
    const normalizedHost = normalizeEmailHost(host);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new EmailBackendUnavailableError("PORTALESS_EMAIL_SMTP_PORT debe ser un puerto valido (1-65535).");
    }
    if (Boolean(username) !== Boolean(password)) {
      throw new EmailBackendUnavailableError("Configure juntos PORTALESS_EMAIL_SMTP_USERNAME y PORTALESS_EMAIL_SMTP_PASSWORD.");
    }
    if (!isEmailAddress(from)) {
      throw new EmailBackendUnavailableError("PORTALESS_EMAIL_FROM debe ser un remitente valido para SMTP.");
    }
    if (!normalizedHost) throw new EmailBackendUnavailableError("PORTALESS_EMAIL_SMTP_HOST no es un hostname válido.");
    const provider: EmailProviderSettings = {
      kind: "smtp",
      host: normalizedHost,
      port,
      requireStartTls: port !== 465,
      ...(username ? { username, token: password } : {}),
    };
    return new SmtpEmailSender(provider, from);
  }
  if (env?.PORTALESS_DEV_MODE === "1") return devCaptureEmailSender;
  throw new EmailBackendUnavailableError();
}
