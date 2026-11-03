// Multer 2.5 accepts the configured boundary inclusively. No sentinel byte:
// exactly MAX_UPLOAD_BYTES is allowed, larger files fail before normalization.
export const MAX_UPLOAD_BYTES = 10_000_000;
export const IMAGE_UPLOAD_LIMITS = {
  fileSize: MAX_UPLOAD_BYTES,
  files: 1,
  fields: 4,
  parts: 6,
  fieldSize: 1024,
  fieldNameSize: 100,
  headerPairs: 100,
};
export const MAX_IMAGE_PIXELS = 25_000_000;
export const MAX_IMAGE_DIMENSION = 10_000;
export const OCR_JSON_BYTES = 10_000_000;
export const OCR_ENVELOPE_BYTES = 65_536;
export const MAX_OCR_IMAGE_BYTES =
  Math.floor((OCR_JSON_BYTES - OCR_ENVELOPE_BYTES) / 4) * 3;
export const MAX_NORMALIZED_BYTES = 20_000_000;
