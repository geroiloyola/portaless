import net from "node:net";

const PORT = Number(process.env.PORTALESS_STAGING_SMTP_PORT ?? 2525);
const server = net.createServer((socket) => {
  socket.setEncoding("utf8");
  socket.write("220 portaless synthetic SMTP\r\n");
  let buffer = "";
  let inData = false;
  let data = "";
  socket.on("data", (chunk) => {
    if (inData) {
      data += chunk;
      const end = data.indexOf("\r\n.\r\n");
      if (end >= 0) {
        inData = false;
        data = "";
        socket.write("250 synthetic message accepted\r\n");
      }
      return;
    }
    buffer += chunk;
    let boundary;
    while ((boundary = buffer.indexOf("\r\n")) >= 0) {
      const line = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const command = line.split(" ", 1)[0].toUpperCase();
      if (command === "EHLO" || command === "HELO") {
        // Deliberately no STARTTLS: credentialed senders must refuse plaintext.
        socket.write("250-synthetic.local\r\n250 SIZE 1048576\r\n");
      } else if (command === "MAIL" || command === "RCPT") {
        socket.write("250 2.1.0 OK\r\n");
      } else if (command === "DATA") {
        inData = true;
        socket.write("354 End data with <CR><LF>.<CR><LF>\r\n");
      } else if (command === "QUIT") {
        socket.write("221 2.0.0 Bye\r\n");
        socket.end();
      } else if (command === "AUTH") {
        socket.write("535 synthetic SMTP never accepts credentials\r\n");
      } else {
        socket.write("502 5.5.1 unsupported\r\n");
      }
    }
  });
});

server.listen(PORT, "0.0.0.0", () => console.log(`synthetic SMTP ready on ${PORT}`));
