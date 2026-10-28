import { readBodyLimited, RequestBodyTooLargeError } from "./read-body-limited.js";

/** Reads and parses a JSON body with a hard byte ceiling. Never throws. */
export async function readJsonBodyLimited(request, maxBytes) {
  let raw;
  try {
    raw = await readBodyLimited(request, maxBytes);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return { ok: false, status: 413, error: "request_too_large" };
    }
    return { ok: false, status: 400, error: "invalid_json_body" };
  }
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false, status: 400, error: "invalid_json_body" };
  }
}
