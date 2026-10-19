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

import type { EmailProviderSettings } from "../../../dashboard/src/site-settings/email-config";

export interface OutgoingEmail {
  from: string;
  to: string;
  subject: string;
  text: string;
}

export class EmailSendError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailSendError";
  }
}

// ---------------------------------------------------------------------------
// Webhook: POST JSON al endpoint del operador (Resend/Mailgun/SES/... detras de
// su propio servicio). Proveedor-neutral.
// ---------------------------------------------------------------------------
export async function sendViaWebhook(provider: EmailProviderSettings, message: OutgoingEmail): Promise<void> {
  if (!provider.url) throw new EmailSendError("webhook sin URL configurada.");
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (provider.token) headers.authorization = `Bearer ${provider.token}`;
  const res = await fetch(provider.url, { method: "POST", headers, body: JSON.stringify(message) });
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
  command(line: string, expect: number): Promise<string[]>;
  readReply(): Promise<string[]>;
}

/** Envuelve un socket y devuelve lectura/escritura de respuestas SMTP. */
function attachReader(socket: any): SmtpIo {
  let buffer = "";
  // Lineas YA completas que llegaron antes de que el consumidor las pidiera.
  // Sin este buffer, una respuesta multilinea en un mismo chunk perdia lineas
  // (el while de `data` corria antes de que readReply pidiera la siguiente).
  const pending: string[] = [];
  const waiters: Array<(line: string) => void> = [];
  socket.setEncoding("utf8");
  socket.on("data", (chunk: string) => {
    buffer += chunk;
    let idx: number;
    while ((idx = buffer.indexOf("\r\n")) !== -1) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const w = waiters.shift();
      if (w) w(line);
      else pending.push(line);
    }
  });

  const readLine = () =>
    new Promise<string>((resolve, reject) => {
      const buffered = pending.shift();
      if (buffered !== undefined) {
        resolve(buffered);
        return;
      }
      const onErr = (e: Error) => reject(e);
      socket.once("error", onErr);
      waiters.push((line) => {
        socket.off("error", onErr);
        resolve(line);
      });
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

  const command = async (line: string, expect: number): Promise<string[]> => {
    socket.write(`${line}\r\n`);
    const reply = await readReply();
    const code = Number(reply[0].slice(0, 3));
    if (code !== expect) throw new EmailSendError(`SMTP: "${line.split(" ")[0]}" -> ${reply.join(" | ")}`);
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

  const base: any = implicitTls ? tls.connect({ host, port, servername: host }) : net.connect({ host, port });
  let socket: any = base;

  const timer = setTimeout(() => socket.destroy(new EmailSendError("SMTP: timeout")), 15000);

  try {
    let io = attachReader(base);
    await io.readReply(); // banner 220
    let caps = await io.command("EHLO portaless", 250);

    if (!implicitTls) {
      if (hasCapability(caps, "STARTTLS")) {
        await io.command("STARTTLS", 220);
        const secured: any = tls.connect({ socket: base, servername: host });
        await new Promise<void>((resolve, reject) => {
          secured.once("secureConnect", () => resolve());
          secured.once("error", reject);
        });
        socket = secured;
        io = attachReader(secured);
        caps = await io.command("EHLO portaless", 250);
      } else if (hasCredentials) {
        throw new EmailSendError("SMTP: el servidor no ofrece STARTTLS; se rehusa enviar credenciales en claro.");
      }
    }

    if (hasCredentials) {
      await io.command("AUTH LOGIN", 334);
      await io.command(Buffer.from(provider.username as string).toString("base64"), 334);
      await io.command(Buffer.from(provider.token as string).toString("base64"), 235);
    }

    await io.command(`MAIL FROM:<${normalizeHeader(message.from)}>`, 250);
    await io.command(`RCPT TO:<${normalizeHeader(message.to)}>`, 250);
    await io.command("DATA", 354);
    const body = [
      `From: ${normalizeHeader(message.from)}`,
      `To: ${normalizeHeader(message.to)}`,
      `Subject: ${normalizeHeader(message.subject)}`,
      "MIME-Version: 1.0",
      'Content-Type: text/plain; charset="utf-8"',
      "",
      dotStuff(message.text),
    ].join("\r\n");
    socket.write(`${body}\r\n.\r\n`);
    const done = await io.readReply();
    if (Number(done[0].slice(0, 3)) !== 250) throw new EmailSendError(`SMTP: DATA -> ${done[0]}`);
    await io.command("QUIT", 221).catch(() => undefined);
  } finally {
    clearTimeout(timer);
    socket.end?.();
    socket.destroy?.();
  }
}

/** Envia segun el proveedor configurado. Lanza si el proveedor es "none". */
export async function sendEmail(provider: EmailProviderSettings, message: OutgoingEmail): Promise<void> {
  if (provider.kind === "webhook") return sendViaWebhook(provider, message);
  if (provider.kind === "smtp") return smtpConversation(provider, message);
  throw new EmailSendError("email:sin proveedor configurado (webhook o smtp).");
}
