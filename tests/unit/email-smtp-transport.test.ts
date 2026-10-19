// R2/R10: el transporte SMTP del core. Antes no tenia NINGUN test, y por ahi
// entraron (a) la inyeccion por CR/LF en datos del plugin y (b) la falta de
// dot-stuffing (una linea "." terminaba DATA). Se prueba contra un servidor
// SMTP fake real sobre node:net (sin TLS: el cliente solo hace STARTTLS si el
// servidor lo anuncia, y sin credenciales no lo exige).
import { afterEach, describe, expect, it } from "vitest";
import net from "node:net";
import { dotStuff, normalizeHeader, sendEmail } from "../../packages/plugin-sandbox/src/capabilities/email-send";
import { renderEmailTemplate } from "../../packages/dashboard/src/site-settings/email-config";

interface FakeServer {
  port: number;
  messages: string[];
  commands: string[];
  close: () => void;
}

function fakeSmtpServer(opts: { advertiseStartTls?: boolean } = {}): Promise<FakeServer> {
  const messages: string[] = [];
  const commands: string[] = [];
  const server = net.createServer((socket) => {
    socket.setEncoding("utf8");
    socket.write("220 fake ESMTP\r\n");
    let buf = "";
    let dataBuf = "";
    let inData = false;
    socket.on("data", (chunk: string) => {
      if (inData) {
        dataBuf += chunk;
        const end = dataBuf.indexOf("\r\n.\r\n");
        if (end !== -1) {
          messages.push(dataBuf.slice(0, end));
          dataBuf = dataBuf.slice(end + 5);
          inData = false;
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
          const lines = ["250-fake", "250-SIZE 10240000"];
          if (opts.advertiseStartTls) lines.push("250-STARTTLS");
          lines.push("250 AUTH LOGIN");
          socket.write(lines.join("\r\n") + "\r\n");
        } else if (cmd === "MAIL" || cmd === "RCPT") {
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

  it("renderEmailTemplate limpia CR/LF de los valores del plugin", () => {
    const t = { id: "x", subject: "Hola {{name}}", body: "cuerpo {{x}}" };
    const out = renderEmailTemplate(t, { name: "Ana\r\nBcc: evil@x", x: "a\r\n.\r\nRCPT TO:<evil>" });
    expect(out.subject).toBe("Hola Ana Bcc: evil@x");
    expect(out.text).not.toMatch(/[\r\n]/);
  });
});

describe("sendEmail via SMTP (servidor fake real)", () => {
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
});
