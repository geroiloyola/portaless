// Envio real de email transaccional del core (TASK 5). Proveedor-neutral, sin
// dependencias externas: webhook (POST JSON) o SMTP (cliente minimo sobre
// node:net / node:tls). El `from` SIEMPRE lo inyecta el core; el plugin nunca
// lo elige.
//
// Fail-closed: cualquier fallo (HTTP no-2xx, SMTP no-250, timeout) lanza; nunca
// un "exito" que no envio nada.

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
// SMTP: cliente minimo (EHLO + STARTTLS opcional + AUTH LOGIN + DATA). Sin
// dependencias. Cubre el caso comun (puerto 587 STARTTLS / 465 TLS implicito).
// ---------------------------------------------------------------------------
function smtpLine(s: string): string {
  return s.replace(/\r?\n/g, "\r\n");
}

async function smtpConversation(provider: EmailProviderSettings, message: OutgoingEmail): Promise<void> {
  const net = await import("node:net");
  const tls = await import("node:tls");
  const host = provider.host as string;
  const port = provider.port as number;
  const implicitTls = port === 465;

  const socket: any = implicitTls
    ? tls.connect({ host, port, servername: host })
    : net.connect({ host, port });
  socket.setTimeout(15000, () => socket.destroy(new EmailSendError("SMTP: timeout")));

  let buffer = "";
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
    }
  });

  const readLine = () => new Promise<string>((resolve, reject) => {
    const onErr = (e: Error) => reject(e);
    socket.once("error", onErr);
    waiters.push((line) => {
      socket.off("error", onErr);
      resolve(line);
    });
  });

  const command = async (line: string, expect: number): Promise<string> => {
    socket.write(`${line}\r\n`);
    const reply = await readLine();
    const code = Number(reply.slice(0, 3));
    if (code !== expect) throw new EmailSendError(`SMTP: "${line.split(" ")[0]}" -> ${reply}`);
    return reply;
  };

  try {
    await readLine(); // banner 220
    await command("EHLO portaless", 250);
    if (!implicitTls) {
      await command("STARTTLS", 220);
      const secured = tls.connect({ socket, servername: host });
      // A partir de aca se escribe sobre el socket TLS.
      socket.write = secured.write.bind(secured);
      secured.setEncoding("utf8");
      secured.on("data", (chunk: string) => {
        buffer += chunk;
        let idx: number;
        while ((idx = buffer.indexOf("\r\n")) !== -1) {
          const line = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const w = waiters.shift();
          if (w) w(line);
        }
      });
      await command("EHLO portaless", 250);
    }
    if (provider.username && provider.token) {
      await command("AUTH LOGIN", 334);
      await command(Buffer.from(provider.username).toString("base64"), 334);
      await command(Buffer.from(provider.token).toString("base64"), 235);
    }
    await command(`MAIL FROM:<${message.from}>`, 250);
    await command(`RCPT TO:<${message.to}>`, 250);
    await command("DATA", 354);
    const body = [
      `From: ${message.from}`,
      `To: ${message.to}`,
      `Subject: ${message.subject}`,
      "MIME-Version: 1.0",
      'Content-Type: text/plain; charset="utf-8"',
      "",
      message.text,
    ].join("\r\n");
    socket.write(`${smtpLine(body)}\r\n.\r\n`);
    const done = await readLine();
    if (Number(done.slice(0, 3)) !== 250) throw new EmailSendError(`SMTP: DATA -> ${done}`);
    await command("QUIT", 221).catch(() => undefined);
  } finally {
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
