import canonicalize from "canonicalize";
import { createHash } from "node:crypto";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

/** UTF-8 RFC 8785/JCS bytes. Throws instead of signing an unrepresentable value. */
export function canonicalBytes(value: unknown): Uint8Array {
  const text = canonicalize(value);
  if (typeof text !== "string") throw new Error("not_i_json");
  return encoder.encode(text);
}

export function utf8Bytes(value: string): Uint8Array {
  return encoder.encode(value);
}

export function utf8Text(value: Uint8Array): string {
  return decoder.decode(value);
}

export function digestBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("base64url");
}

export function digestJcs(value: unknown): string {
  return digestBytes(canonicalBytes(value));
}

export function digestText(value: string): string {
  return digestBytes(utf8Bytes(value));
}

export function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

/** An APW site artifact must arrive in JCS form; re-serialization must reproduce the signed bytes. */
export function isCanonicalPayload(payloadBytes: Uint8Array): boolean {
  try {
    const text = utf8Text(payloadBytes);
    return canonicalize(JSON.parse(text)) === text;
  } catch {
    return false;
  }
}

export function base64urlToBytes(value: string): Uint8Array {
  return Uint8Array.from(Buffer.from(value, "base64url"));
}

export function bytesToBase64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}
