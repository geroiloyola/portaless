import { sendEmail } from "../../packages/email-transport/src/send.ts";

let lastError;
for (let attempt = 0; attempt < 20; attempt++) {
  try {
    await sendEmail(
      {
        kind: "smtp",
        host: "portaless-staging-smtp",
        port: Number(process.env.PORTALESS_STAGING_SMTP_PORT ?? 2525),
        username: "synthetic-user",
        token: "synthetic-password",
        requireStartTls: true,
      },
      { from: "staging@example.invalid", to: "controlled@example.invalid", subject: "synthetic", text: "synthetic" },
    );
    throw new Error("SMTP accepted a credentialed send without STARTTLS.");
  } catch (error) {
    lastError = error;
    if (/no ofrece STARTTLS/.test(error?.message ?? "")) {
      console.log("SMTP fake refused plaintext credentials as expected.");
      process.exit(0);
    }
    if (!/ECONNREFUSED|timeout/i.test(error?.message ?? "")) throw error;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}
throw lastError ?? new Error("SMTP fake did not become ready.");
