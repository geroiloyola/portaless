#!/usr/bin/env node
import { isEmailAddress } from "../packages/email-transport/src/config.ts";
import { createEmailSender } from "../packages/auth/src/email-sender.ts";

const recipientArg = process.argv.slice(2).find((arg) => arg.startsWith("--to="));
const recipient = recipientArg?.slice("--to=".length).trim();
if (!isEmailAddress(recipient)) {
  console.error("Uso: npm run test:email -- --to=destinatario-controlado@example.com");
  process.exit(2);
}

if (
  process.env.PORTALESS_DEV_MODE === "1" &&
  !process.env.PORTALESS_EMAIL_WEBHOOK_URL &&
  !process.env.PORTALESS_EMAIL_SMTP_HOST
) {
  console.error("No es una prueba de entrega: PORTALESS_DEV_MODE solo captura el mensaje localmente.");
  process.exit(2);
}

try {
  const sender = createEmailSender({ ...process.env, __PORTALESS_RUNTIME: "node" });
  await sender.send({
    to: recipient,
    subject: "Portaless: prueba de entrega de correo",
    text: `Mensaje de verificación solicitado por el operador.\nFecha: ${new Date().toISOString()}\n`,
  });
  console.log(`El proveedor aceptó el mensaje para ${recipient}. Verifica la bandeja de entrada y spam.`);
} catch (error) {
  console.error("Falló la entrega de prueba:", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
