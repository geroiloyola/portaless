// R2/R10: el transporte SMTP del core. Antes no tenia NINGUN test, y por ahi
// entraron (a) la inyeccion por CR/LF en datos del plugin y (b) la falta de
// dot-stuffing (una linea "." terminaba DATA). Se prueba contra un servidor
// SMTP fake real sobre node:net (sin TLS: el cliente solo hace STARTTLS si el
// servidor lo anuncia, y sin credenciales no lo exige).
import { afterEach, describe, expect, it, vi } from "vitest";
import net from "node:net";
import { dotStuff, normalizeHeader, sendEmail, smtpCommandFailure } from "../../packages/email-transport/src/send";
import { renderEmailTemplate } from "../../packages/email-transport/src/config";

interface FakeServer {
  port: number;
  messages: string[];
  commands: string[];
  close: () => void;
}

function fakeSmtpServer(opts: {
  advertiseStartTls?: boolean;
  rejectCommand?: string;
  oversizedEhlo?: boolean;
  dropAfterData?: boolean;
  stallStartTls?: boolean;
} = {}): Promise<FakeServer> {
  const messages: string[] = [];
  const commands: string[] = [];
  const server = net.createServer((socket) => {
    socket.setEncoding("utf8");
    socket.write("220 fake ESMTP\r\n");
    let buf = "";
    let dataBuf = "";
    let inData = false;
    let upgrading = false;
    socket.on("data", (chunk: string) => {
      if (upgrading) return;
      if (inData) {
        dataBuf += chunk;
        const end = dataBuf.indexOf("\r\n.\r\n");
        if (end !== -1) {
          messages.push(dataBuf.slice(0, end));
          dataBuf = dataBuf.slice(end + 5);
          inData = false;
          if (opts.dropAfterData) {
            socket.destroy();
            return;
          }
          socket.write("250 OK queued\r\n");
        }
        return;
      }
      buf += chunk;
      let idx: number;
      while ((idx = buf.indexOf("\r\n")) !== -1) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const cmd = line.split(" ")[0].toUpperCase();
        commands.push(cmd);
        if (cmd === "EHLO") {
          if (opts.oversizedEhlo) {
            socket.write(`250-${"x".repeat(9 * 1024)}\r\n250 done\r\n`);
            continue;
          }
          const lines = ["250-fake", "250-SIZE 10240000"];
          if (opts.advertiseStartTls) lines.push("250-STARTTLS");
          lines.push("250 AUTH LOGIN");
          socket.write(lines.join("\r\n") + "\r\n");
        } else if (cmd === "STARTTLS" && opts.stallStartTls) {
          upgrading = true;
          socket.write("220 Ready for TLS\r\n");
          return;
        } else if (cmd === "MAIL" || cmd === "RCPT") {
          if (cmd === opts.rejectCommand) {
            socket.write("550 synthetic-private-reply-secret\r\n");
            continue;
          }
          socket.write("250 OK\r\n");
        } else if (cmd === "DATA") {
          socket.write("354 End data with <CR><LF>.<CR><LF>\r\n");
          inData = true;
        } else if (cmd === "QUIT") {
          socket.write("221 Bye\r\n");
          socket.end();
        } else {
          socket.write("250 OK\r\n");
        }
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({ port, messages, commands, close: () => server.close() });
    });
  });
}

const servers: FakeServer[] = [];
afterEach(() => {
  while (servers.length) servers.pop()!.close();
});

describe("helpers SMTP (puros)", () => {
  it("dotStuff escapa una linea que empieza con '.' y normaliza a CRLF", () => {
    expect(dotStuff("a\n.\nRCPT TO:<x>")).toBe("a\r\n..\r\nRCPT TO:<x>");
    expect(dotStuff(".solo")).toBe("..solo");
    expect(dotStuff("linea\nnormal")).toBe("linea\r\nnormal");
  });

  it("normalizeHeader quita CR/LF (defensa en profundidad)", () => {
    expect(normalizeHeader("Hola\r\nBcc: evil@x")).toBe("Hola Bcc: evil@x");
    expect(normalizeHeader("  asunto  ")).toBe("asunto");
  });

  it("no incluye argumentos ni respuestas del relay en errores SMTP", () => {
    const error = smtpCommandFailure("SYNTHETIC-BASE64-SECRET", 535);
    expect(error.message).not.toContain("SYNTHETIC-BASE64-SECRET");
    expect(error.message).toBe("SMTP command rejected with reply code 535.");
    expect(smtpCommandFailure("AUTH credential", 535).message).toBe("SMTP AUTH credential rejected with reply code 535.");
  });

  it("renderEmailTemplate limpia CR/LF de los valores del plugin", () => {
    const t = { id: "x", subject: "Hola {{name}}", body: "cuerpo {{x}}" };
    const out = renderEmailTemplate(t, { name: "Ana\r\nBcc: evil@x", x: "a\r\n.\r\nRCPT TO:<evil>" });
    expect(out.subject).toBe("Hola Ana Bcc: evil@x");
    expect(out.text).not.toMatch(/[\r\n]/);
  });
});

describe("sendEmail via SMTP (servidor fake real)", () => {
  it("termina si STARTTLS acepta pero el handshake nunca responde", async () => {
    const srv = await fakeSmtpServer({ advertiseStartTls: true, stallStartTls: true });
    servers.push(srv);
    const nativeTimeout = globalThis.setTimeout;
    const timer = vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: any, ms: number, ...args: any[]) =>
      nativeTimeout(fn, ms === 15_000 ? 100 : ms, ...args)) as any);
    try {
      await expect(sendEmail(
        { kind: "smtp", host: "127.0.0.1", port: srv.port, username: "u", token: "secret" },
        { from: "a@b.cl", to: "c@d.cl", subject: "x", text: "y" },
      )).rejects.toMatchObject({ deliveryOutcome: "rejected" });
      expect(srv.messages).toHaveLength(0);
    } finally {
      timer.mockRestore();
    }
  }, 3000);

  it("EHLO multilinea + envio: DATA llega con dot-stuffing y headers limpios", async () => {
    const srv = await fakeSmtpServer();
    servers.push(srv);
    await sendEmail(
      { kind: "smtp", host: "127.0.0.1", port: srv.port },
      { from: "noreply@mitiendita.cl", to: "cliente@ejemplo.cl", subject: "Pedido\r\nBcc: evil@x", text: "Hola\r\n.\r\nRCPT TO:<evil@x>" },
    );
    expect(srv.commands).toContain("EHLO");
    expect(srv.commands).toContain("DATA");
    expect(srv.commands).toContain("QUIT");
    expect(srv.messages.length).toBe(1); // una sola DATA: no hubo terminacion prematura
    const data = srv.messages[0];
    expect(data).toContain("From: noreply@mitiendita.cl");
    expect(data).toContain("Subject: Pedido Bcc: evil@x"); // CRLF del subject neutralizado
    expect(data).toContain("..\r\nRCPT TO:<evil@x>"); // la linea "." quedo escapada en el cuerpo
    expect(data).not.toMatch(/\r\n\.\r\nRCPT/); // el "." no corto el DATA
  });

  it("sin STARTTLS anunciado y CON credenciales -> rechaza (no manda la password en claro)", async () => {
    const srv = await fakeSmtpServer();
    servers.push(srv);
    await expect(
      sendEmail(
        { kind: "smtp", host: "127.0.0.1", port: srv.port, username: "u", token: "p" },
        { from: "a@b.cl", to: "c@d.cl", subject: "x", text: "y" },
      ),
    ).rejects.toThrow(/STARTTLS/);
    expect(srv.messages.length).toBe(0); // nada se envio
  });

  it("el auth sender puede exigir STARTTLS aunque el relay no use AUTH", async () => {
    const srv = await fakeSmtpServer();
    servers.push(srv);
    await expect(sendEmail(
      { kind: "smtp", host: "127.0.0.1", port: srv.port, requireStartTls: true },
      { from: "a@b.cl", to: "c@d.cl", subject: "reset", text: "token secreto" },
    )).rejects.toThrow(/no ofrece STARTTLS/);
    expect(srv.messages).toHaveLength(0);
  });

  it("limita las respuestas del relay y redacta sus textos al rechazar un comando", async () => {
    const oversized = await fakeSmtpServer({ oversizedEhlo: true });
    servers.push(oversized);
    await expect(sendEmail(
      { kind: "smtp", host: "127.0.0.1", port: oversized.port },
      { from: "a@b.cl", to: "c@d.cl", subject: "x", text: "y" },
    )).rejects.toThrow(/reply line exceeded/);

    const rejecting = await fakeSmtpServer({ rejectCommand: "MAIL" });
    servers.push(rejecting);
    const error = await sendEmail(
      { kind: "smtp", host: "127.0.0.1", port: rejecting.port },
      { from: "sender-private@example.test", to: "c@d.cl", subject: "x", text: "y" },
    ).then(() => null, (caught) => caught as Error);
    expect(error?.message).toContain("SMTP MAIL rejected with reply code 550");
    expect(error?.message).not.toContain("synthetic-private-reply-secret");
    expect(error?.message).not.toContain("sender-private@example.test");
  });

  it("rechaza cuerpos SMTP demasiado grandes antes de abrir una conexión", async () => {
    await expect(sendEmail(
      { kind: "smtp", host: "invalid-host-for-size-check.example", port: 587 },
      { from: "a@b.cl", to: "c@d.cl", subject: "x", text: "x".repeat(2 * 1024 * 1024 + 1) },
    )).rejects.toThrow(/size limit/);
  });

  it("marca desconocida la entrega cuando el relay cierra después de recibir DATA", async () => {
    const srv = await fakeSmtpServer({ dropAfterData: true });
    servers.push(srv);
    await expect(sendEmail(
      { kind: "smtp", host: "127.0.0.1", port: srv.port },
      { from: "a@b.cl", to: "c@d.cl", subject: "x", text: "y" },
    )).rejects.toMatchObject({ deliveryOutcome: "unknown" });
    expect(srv.messages).toHaveLength(1); // el cuerpo llegó; faltó el acuse final 250
  });
});
