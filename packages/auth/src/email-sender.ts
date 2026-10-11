// Backend de email transaccional del SERVIDOR (no el puente email:send de
// plugins, que es otra cosa). Existe para desbloquear step-up por email
// (ROADMAP: "Email-based step-up verification ... blocked on an email:send
// backend"): hasta ahora no habia forma de que Portaless enviara un email,
// y la verificacion reforzada era solo contrasena + TOTP.
//
// Tres estados, todos explicitos (patron NOT_CONFIGURED del repo):
//   - PORTALESS_EMAIL_WEBHOOK_URL: POST JSON { to, subject, text } a la URL
//     del operador. Proveedor-neutral: el operador conecta Resend, Mailgun,
//     SendGrid, Postmark o su propio servicio con un endpoint interno.
//     PORTALESS_EMAIL_WEBHOOK_TOKEN (opcional) se manda como Authorization:
//     Bearer. Portaless no conoce ni depende de ningun proveedor.
//   - PORTALESS_DEV_MODE=1 sin webhook: DevCaptureEmailSender -- NO envia
//     nada, captura los mensajes en memoria y avisa por consola (mismo
//     espiritu que el devToken del reset de contrasena: probar el flujo
//     completo sin infraestructura de correo).
//   - Ninguno de los dos: createEmailSender() LANZA
//     EmailBackendUnavailableError. Nunca un "exito" que no envio nada:
//     el usuario esperaria un codigo que jamas llegaria.
//
// El envio real del codigo lo hace AuthService.requestEmailStepUpCode();
// aqui vive solo la transporte.

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

export class EmailBackendUnavailableError extends Error {
  constructor(message = "Sin backend de email:send configurado (PORTALESS_EMAIL_WEBHOOK_URL ni PORTALESS_DEV_MODE).") {
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
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    const res = await fetch(this.url, {
      method: "POST",
      headers,
      body: JSON.stringify({ to: message.to, subject: message.subject, text: message.text }),
    });
    if (!res.ok) throw new Error(`email webhook respondio HTTP ${res.status}`);
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
    return new HttpWebhookEmailSender(url.trim(), token);
  }
  if (env?.PORTALESS_DEV_MODE === "1") return devCaptureEmailSender;
  throw new EmailBackendUnavailableError();
}
