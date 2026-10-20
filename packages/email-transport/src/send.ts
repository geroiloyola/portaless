// Envio real de email transaccional del core (TASK 5). Proveedor-neutral, sin
// dependencias externas: webhook (POST JSON) o SMTP (cliente minimo sobre
// node:net / node:tls). El `from` SIEMPRE lo inyecta el core; el plugin nunca
// lo elige.
//
// Fail-closed: cualquier fallo (HTTP no-2xx, SMTP no-250, timeout) lanza; nunca
// un "exito" que no envio nada.
//
// Endurecimiento (R2/R10, review):
//   - Dot-stuffing en el cuerpo de DATA (RFC 5321 §4.5.2): una linea que empieza
//     con "." se duplica, si no termina DATA antes de tiempo (inyeccion SMTP).
//   - Los valores interpolados de `data` (que vienen del PLUGIN, no confiables)
//     se limpian de CR/LF en email-config.renderEmailTemplate; aca ademas se
//     normalizan los headers por defensa en profundidad.
//   - STARTTLS solo si el servidor lo anuncia; si hay credenciales y no hay
//     STARTTLS, se RECHAZA (nunca mandar la password en claro).
//   - EHLO multilinea se parsea correctamente (250-... / 250 fin).
//   - Timeout con clearTimeout (no dispara sobre un socket ya cerrado).

import { normalizeWebhookUrl, type EmailProviderSettings } from "./config";

export interface OutgoingEmail {
  from: string;
  to: string;
  subject: string;
  text: string;
}

export type EmailDeliveryOutcome = "rejected" | "unknown";

export class EmailSendError extends Error {
  readonly deliveryOutcome: EmailDeliveryOutcome;

  constructor(message: string, deliveryOutcome: EmailDeliveryOutcome = "rejected") {
    super(message);
    this.name = "EmailSendError";
    this.deliveryOutcome = deliveryOutcome;
  }
}

export class EmailDeliveryUnknownError extends EmailSendError {
  constructor(message: string) {
    super(message, "unknown");
    this.name = "EmailDeliveryUnknownError";
  }
}

// ---------------------------------------------------------------------------
// Webhook: POST JSON al endpoint del operador (Resend/Mailgun/SES/... detras de
// su propio servicio). Proveedor-neutral.
// ---------------------------------------------------------------------------
export async function sendViaWebhook(provider: EmailProviderSettings, message: OutgoingEmail): Promise<void> {
  const url = normalizeWebhookUrl(provider.url, Boolean(provider.token));
  if (!url) throw new EmailSendError("webhook sin URL publica segura configurada.");
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (provider.token) headers.authorization = `Bearer ${provider.token}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(message),
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new EmailDeliveryUnknownError("el webhook no confirmó la aceptación; el resultado de entrega es desconocido.");
  }
  if (res.status >= 300 && res.status < 400) {
    throw new EmailSendError("el webhook de email intentó redirigir; las redirecciones están deshabilitadas.");
  }
  if (res.status >= 500) {
    throw new EmailDeliveryUnknownError(`el webhook respondió HTTP ${res.status}; la aceptación previa no puede descartarse.`);
  }
  if (!res.ok) throw new EmailSendError(`el webhook de email respondio HTTP ${res.status}`);
}

// ---------------------------------------------------------------------------
// Helpers puros (exportados para test unitario)
// ---------------------------------------------------------------------------

/** Quita CR/LF de un valor que va a un header (defensa en profundidad). */
export function normalizeHeader(value: string): string {
  return String(value).replace(/[\r\n]+/g, " ").trim();
}

/**
 * Normaliza a CRLF y aplica dot-stuffing: toda linea que empiece con "." se
 * prefija con otro "." (RFC 5321 §4.5.2). Sin esto, una linea "." del cuerpo
 * termina DATA antes de tiempo.
 */
export function dotStuff(text: string): string {
  return String(text).replace(/\r?\n/g, "\r\n").replace(/(^|\r\n)\./g, "$1..");
}

// ---------------------------------------------------------------------------
// SMTP: cliente minimo (EHLO + STARTTLS opcional + AUTH LOGIN + DATA).
// ---------------------------------------------------------------------------
interface SmtpIo {
  command(line: string, expect: number, safeLabel?: string): Promise<string[]>;
  readReply(): Promise<string[]>;
}

const SMTP_TIMEOUT_MS = 15_000;
const SMTP_MAX_MESSAGE_BYTES = 2 * 1024 * 1024;
const SMTP_MAX_REPLY_BUFFER_BYTES = 64 * 1024;
const SMTP_MAX_REPLY_LINE_BYTES = 8 * 1024;
const SMTP_MAX_QUEUED_LINES = 128;
const SMTP_SAFE_LABELS = new Set([
  "EHLO", "HELO", "STARTTLS", "AUTH", "AUTH username", "AUTH credential",
  "MAIL", "RCPT", "DATA", "QUIT",
]);

/** Error formatting accepts only protocol labels; never echo command arguments/replies. */
export function smtpCommandFailure(label: string, code: number): EmailSendError {
  const safeLabel = SMTP_SAFE_LABELS.has(label) ? label : "command";
  const safeCode = Number.isInteger(code) && code >= 100 && code <= 599 ? code : 0;
  return new EmailSendError(`SMTP ${safeLabel} rejected with reply code ${safeCode}.`);
}

/** Envuelve un socket y devuelve lectura/escritura de respuestas SMTP. */
function attachReader(socket: any): SmtpIo {
  let buffer = "";
  // Lineas YA completas que llegaron antes de que el consumidor las pidiera.
  // Sin este buffer, una respuesta multilinea en un mismo chunk perdia lineas
  // (el while de `data` corria antes de que readReply pidiera la siguiente).
  const pending: string[] = [];
  const waiters: Array<{ resolve: (line: string) => void; reject: (error: Error) => void }> = [];
  let pendingBytes = 0;
  let terminalError: EmailSendError | null = null;
  socket.setEncoding("utf8");

  const fail = (message: string) => {
    if (terminalError) return;
    terminalError = new EmailSendError(message);
    pending.length = 0;
    pendingBytes = 0;
    while (waiters.length) waiters.shift()!.reject(terminalError!);
    if (!socket.destroyed) socket.destroy();
  };

  socket.on("error", () => fail("SMTP socket failed."));
  socket.on("end", () => fail("SMTP server closed the connection."));
  socket.on("close", () => fail("SMTP server closed the connection."));
  socket.on("data", (chunk: string) => {
    if (terminalError) return;
    if (Buffer.byteLength(buffer, "utf8") + Buffer.byteLength(chunk, "utf8") + pendingBytes > SMTP_MAX_REPLY_BUFFER_BYTES) {
      fail("SMTP reply exceeded the configured buffer limit.");
      return;
    }
    buffer += chunk;
    let idx: number;
    while ((idx = buffer.indexOf("\r\n")) !== -1) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      if (Buffer.byteLength(line, "utf8") > SMTP_MAX_REPLY_LINE_BYTES) {
        fail("SMTP reply line exceeded the configured limit.");
        return;
      }
      const waiter = waiters.shift();
      if (waiter) waiter.resolve(line);
      else {
        pending.push(line);
        pendingBytes += Buffer.byteLength(line, "utf8") + 2;
        if (pending.length > SMTP_MAX_QUEUED_LINES) {
          fail("SMTP server sent too many queued reply lines.");
          return;
        }
      }
    }
    if (Buffer.byteLength(buffer, "utf8") + pendingBytes > SMTP_MAX_REPLY_BUFFER_BYTES) {
      fail("SMTP reply exceeded the configured buffer limit.");
    }
  });

  const readLine = () =>
    new Promise<string>((resolve, reject) => {
      if (terminalError) {
        reject(terminalError);
        return;
      }
      const buffered = pending.shift();
      if (buffered !== undefined) {
        pendingBytes -= Buffer.byteLength(buffered, "utf8") + 2;
        resolve(buffered);
        return;
      }
      waiters.push({ resolve, reject });
    });

  // Una respuesta SMTP puede ser multilinea: "250-foo" ... "250 fin". La linea
  // TERMINAL es la que tiene codigo + espacio (o solo el codigo).
  const readReply = async (): Promise<string[]> => {
    const lines: string[] = [];
    for (;;) {
      const line = await readLine();
      lines.push(line);
      if (/^\d{3}([ ]|$)/.test(line)) return lines;
    }
  };

  const command = async (line: string, expect: number, safeLabel?: string): Promise<string[]> => {
    socket.write(`${line}\r\n`);
    const reply = await readReply();
    const code = Number(reply[0].slice(0, 3));
    if (code !== expect) throw smtpCommandFailure(safeLabel ?? line.split(" ")[0].toUpperCase(), code);
    return reply;
  };

  return { command, readReply };
}

function hasCapability(reply: string[], capability: string): boolean {
  return reply.some((line) => line.toUpperCase().includes(capability));
}

async function smtpConversation(provider: EmailProviderSettings, message: OutgoingEmail): Promise<void> {
  const net = await import("node:net");
  const tls = await import("node:tls");
  const host = provider.host as string;
  const port = provider.port as number;
  const implicitTls = port === 465;
  const hasCredentials = Boolean(provider.username && provider.token);
  const servername = net.isIP(host) ? undefined : host;
  const rawMessageBytes = Buffer.byteLength(message.from, "utf8") + Buffer.byteLength(message.to, "utf8") +
    Buffer.byteLength(message.subject, "utf8") + Buffer.byteLength(message.text, "utf8");
  if (rawMessageBytes > SMTP_MAX_MESSAGE_BYTES) {
    throw new EmailSendError("SMTP message exceeded the configured size limit.");
  }
  const body = [
    `From: ${normalizeHeader(message.from)}`,
    `To: ${normalizeHeader(message.to)}`,
    `Subject: ${normalizeHeader(message.subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="utf-8"',
    "",
    dotStuff(message.text),
  ].join("\r\n");
  if (Buffer.byteLength(body, "utf8") > SMTP_MAX_MESSAGE_BYTES) {
    throw new EmailSendError("SMTP message exceeded the configured size limit.");
  }

  const base: any = implicitTls ? tls.connect({ host, port, ...(servername ? { servername } : {}) }) : net.connect({ host, port });
  let socket: any = base;
  let dataTerminatorSent = false;
  let timeoutError: EmailSendError | null = null;
  const timer = setTimeout(() => {
    timeoutError = dataTerminatorSent
      ? new EmailDeliveryUnknownError("SMTP response after submission timed out; delivery is unknown.")
      : new EmailSendError("SMTP operation timed out before submission.");
    if (!socket.destroyed) socket.destroy();
  }, SMTP_TIMEOUT_MS);

  try {
    let io = attachReader(base);
    await io.readReply(); // banner 220
    let caps = await io.command("EHLO portaless", 250);

    if (!implicitTls) {
      if (hasCapability(caps, "STARTTLS")) {
        await io.command("STARTTLS", 220);
        const secured: any = tls.connect({ socket: base, ...(servername ? { servername } : {}) });
        socket = secured;
        await new Promise<void>((resolve, reject) => {
          const cleanup = () => {
            secured.off("secureConnect", ready);
            secured.off("error", failed);
            secured.off("close", closed);
          };
          const ready = () => { cleanup(); resolve(); };
          const failed = (error: Error) => { cleanup(); reject(error); };
          const closed = () => failed(new EmailSendError("SMTP TLS handshake closed before completion."));
          secured.once("secureConnect", ready);
          secured.once("error", failed);
          secured.once("close", closed);
        });
        io = attachReader(secured);
        caps = await io.command("EHLO portaless", 250);
      } else if (hasCredentials || provider.requireStartTls) {
        throw new EmailSendError("SMTP: el servidor no ofrece STARTTLS; se rehusa enviar correo o credenciales en claro.");
      }
    }

    if (hasCredentials) {
      await io.command("AUTH LOGIN", 334);
      await io.command(Buffer.from(provider.username as string).toString("base64"), 334, "AUTH username");
      await io.command(Buffer.from(provider.token as string).toString("base64"), 235, "AUTH credential");
    }

    await io.command(`MAIL FROM:<${normalizeHeader(message.from)}>`, 250);
    await io.command(`RCPT TO:<${normalizeHeader(message.to)}>`, 250);
    await io.command("DATA", 354);
    dataTerminatorSent = true;
    socket.write(`${body}\r\n.\r\n`);
    const done = await io.readReply();
    if (Number(done[0].slice(0, 3)) !== 250) throw new EmailSendError(`SMTP DATA rejected with reply code ${Number(done[0].slice(0, 3))}.`);
    await io.command("QUIT", 221).catch(() => undefined);
  } catch (error) {
    if (timeoutError) throw timeoutError;
    if (error instanceof EmailSendError) {
      // Explicit SMTP rejection codes are definitive. Connection/TLS/EOF errors
      // after the DATA terminator may have lost a successful server reply.
      if (dataTerminatorSent && !/reply code \d{3}/.test(error.message)) {
        throw new EmailSendError("SMTP connection ended after submission; delivery is unknown.", "unknown");
      }
      throw error;
    }
    const message =
      dataTerminatorSent ? "SMTP connection failed after submission; delivery is unknown." : "SMTP connection failed before submission.";
    if (dataTerminatorSent) throw new EmailDeliveryUnknownError(message);
    throw new EmailSendError(message);
  } finally {
    clearTimeout(timer);
    if (!socket.destroyed) socket.destroy();
  }
}

/** Envia segun el proveedor configurado. Lanza si el proveedor es "none". */
export async function sendEmail(provider: EmailProviderSettings, message: OutgoingEmail): Promise<void> {
  if (provider.kind === "webhook") return sendViaWebhook(provider, message);
  if (provider.kind === "smtp") return smtpConversation(provider, message);
  throw new EmailSendError("email:sin proveedor configurado (webhook o smtp).");
}
