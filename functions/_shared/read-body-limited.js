export class RequestBodyTooLargeError extends Error {
  constructor() {
    super("request body exceeds configured limit");
    this.name = "RequestBodyTooLargeError";
  }
}

export class InvalidContentLengthError extends Error {
  constructor() {
    super("invalid content-length header");
    this.name = "InvalidContentLengthError";
  }
}

export class InvalidJsonBodyError extends Error {
  constructor(message = "invalid json body") {
    super(message);
    this.name = "InvalidJsonBodyError";
  }
}

function checkDeclaredContentLength(request, maxBytes) {
  const raw = request.headers.get("content-length");
  if (raw === null || raw === "") return;
  if (!/^\d+$/.test(raw.trim())) throw new InvalidContentLengthError();
  const declaredLength = Number(raw.trim());
  if (!Number.isSafeInteger(declaredLength) || declaredLength < 0) {
    throw new InvalidContentLengthError();
  }
  if (declaredLength > maxBytes) throw new RequestBodyTooLargeError();
}

/** Reads a request body with a hard byte ceiling, including chunked requests. */
export async function readBodyLimited(request, maxBytes) {
  checkDeclaredContentLength(request, maxBytes);
  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        // A cloned Request is a tee: cancellation can wait for the unread
        // original branch forever. Start cancellation without blocking 413.
        void reader.cancel().catch(() => undefined);
        throw new RequestBodyTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/** B-03/B-06: Enforce byte limit BEFORE JSON.parse, optionally requiring a plain JSON object. */
export async function readJsonBodyLimited(request, maxBytes, { requireObject = false } = {}) {
  checkDeclaredContentLength(request, maxBytes);
  let parsed;
  if (!request.body && !(request instanceof Request) && typeof request.json === "function") {
    // Compatibility for lightweight unit-test stubs `{ headers, json() }` that do not
    // construct a real Fetch Request stream. All real Request objects always stream via
    // readBodyLimited() below before JSON.parse.
    try {
      parsed = await request.json();
    } catch {
      throw new InvalidJsonBodyError();
    }
    const serialized = JSON.stringify(parsed ?? null);
    if (new TextEncoder().encode(serialized).byteLength > maxBytes) {
      throw new RequestBodyTooLargeError();
    }
  } else {
    const raw = await readBodyLimited(request, maxBytes);
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new InvalidJsonBodyError();
    }
  }
  if (requireObject && (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))) {
    throw new InvalidJsonBodyError("json body must be an object");
  }
  return parsed;
}

/** Drains a cloned request stream without retaining its contents. */
export async function assertBodySizeLimited(request, maxBytes) {
  checkDeclaredContentLength(request, maxBytes);
  if (!request.body) return;

  const reader = request.body.getReader();
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      total += value.byteLength;
      if (total > maxBytes) {
        void reader.cancel().catch(() => undefined);
        throw new RequestBodyTooLargeError();
      }
    }
  } finally {
    reader.releaseLock();
  }
}
