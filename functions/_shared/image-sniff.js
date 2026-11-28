// Magic-byte image format detection for cloud-images (fail-closed).
// Supports only PNG, JPEG, and WebP. Explicitly rejects SVG, HTML, text,
// spoofed MIME types, and truncated/corrupted headers.

export const ALLOWED_IMAGE_CONTENT_TYPES = Object.freeze([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

export function isAllowedImageContentType(contentType) {
  return typeof contentType === "string" && ALLOWED_IMAGE_CONTENT_TYPES.includes(contentType);
}

/**
 * Inspects binary magic bytes and returns the real MIME type or null.
 * - PNG:  89 50 4E 47 0D 0A 1A 0A
 * - JPEG: FF D8 FF
 * - WebP: 52 49 46 46 ("RIFF") at 0..3 + 57 45 42 50 ("WEBP") at 8..11
 */
export function detectImageContentType(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 3) return null;

  // PNG: 8-byte signature
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }

  // JPEG: SOI marker + frame/APP marker (FF D8 FF)
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }

  // WebP: RIFF....WEBP (12 bytes minimum)
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }

  return null;
}
