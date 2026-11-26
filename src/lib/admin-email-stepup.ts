// Shared browser helper for POST /admin/api/stepup/email/request used by
// sensitive /admin/* screens (change-password, rotate-identity, settlement).
// Bundled by Astro as an external ES module (CSP strict, zero inline scripts).

export interface EmailStepUpRequestResult {
  ok: boolean;
  token?: string;
  expiresAt?: string;
  message: string;
}

export const EMAIL_STEPUP_ERRORS: Record<string, string> = {
  email_backend_unavailable:
    "El servidor no tiene un backend de correo configurado (webhook o SMTP) para step-up por email.",
  user_has_no_email: "Tu cuenta no tiene un correo electronico configurado.",
  rate_limited: "Demasiadas solicitudes de codigo por correo. Espera un momento e intentalo de nuevo.",
  invalid_email_code: "El codigo de verificacion por correo no es correcto o ya fue usado.",
  email_code_expired: "El codigo por correo expiro. Solicita uno nuevo.",
  email_code_required: "Ingresa el codigo de verificacion enviado a tu correo.",
  email_stepup_required: "Se requiere verificacion por correo para continuar.",
};

export async function requestEmailStepUpCode(): Promise<EmailStepUpRequestResult> {
  try {
    const res = await fetch("/admin/api/stepup/email/request", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    const data = await res.json().catch(() => ({} as Record<string, unknown>));

    if (res.status === 401) {
      window.location.href = "/admin/login?error=1";
      return { ok: false, message: "Tu sesion expiro. Vuelve a iniciar sesion." };
    }
    if (res.status === 503 || data.error === "email_backend_unavailable") {
      return { ok: false, message: EMAIL_STEPUP_ERRORS.email_backend_unavailable };
    }
    if (res.status === 429 || data.error === "rate_limited") {
      const retry = res.headers.get("retry-after");
      const suffix = retry ? ` Intenta de nuevo en ${retry} s.` : "";
      return { ok: false, message: `${EMAIL_STEPUP_ERRORS.rate_limited}${suffix}` };
    }
    if (!res.ok || !data.ok || typeof data.token !== "string") {
      const code = typeof data.error === "string" ? data.error : "";
      const fallback = typeof data.message === "string" ? data.message : `Error HTTP ${res.status}`;
      return { ok: false, message: EMAIL_STEPUP_ERRORS[code] ?? fallback };
    }
    return {
      ok: true,
      token: data.token,
      expiresAt: typeof data.expiresAt === "string" ? data.expiresAt : undefined,
      message: "Codigo enviado a tu correo registrado. Ingresalo abajo para confirmar la accion.",
    };
  } catch (err) {
    return {
      ok: false,
      message: `No se pudo solicitar el codigo por correo: ${(err as Error).message}`,
    };
  }
}
