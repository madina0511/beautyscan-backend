// Multer emits LIMIT_FILE_SIZE when the threshold is reached, not exceeded.
// One extra sentinel byte permits exactly MAX_UPLOAD_BYTES; larger files fail.
export const MAX_UPLOAD_BYTES = 10_000_000;
export const IMAGE_UPLOAD_LIMITS = {
  fileSize: MAX_UPLOAD_BYTES + 1,
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
