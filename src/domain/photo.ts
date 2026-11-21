/** Largest accepted vessel photo, bytes (spec §13.3: ≤ 5 MB). */
export const PHOTO_MAX_BYTES = 5 * 1024 * 1024;

/** Lifetime of a presigned photo URL, seconds (spec §13.3: 1 h). */
export const PHOTO_URL_TTL_SECONDS = 3600;

/** Image formats accepted for vessel photos. */
export const PHOTO_MEDIA_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

/** An accepted image media type. */
export type PhotoMediaType = (typeof PHOTO_MEDIA_TYPES)[number];

const EXTENSIONS: Readonly<Record<PhotoMediaType, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function startsWith(
  bytes: Uint8Array,
  signature: readonly number[],
  offset = 0,
): boolean {
  return (
    bytes.length >= offset + signature.length &&
    signature.every((byte, index) => bytes[offset + index] === byte)
  );
}

function ascii(text: string): number[] {
  return Array.from({ length: text.length }, (_, index) =>
    text.charCodeAt(index),
  );
}

/**
 * Detects the image format from the file's magic bytes, ignoring the
 * client-declared content type and file name: JPEG `FF D8 FF`, PNG
 * `89 50 4E 47 0D 0A 1A 0A`, WebP `RIFF····WEBP`.
 *
 * @returns the media type, or `undefined` for anything else
 */
export function detectPhotoMediaType(
  bytes: Uint8Array,
): PhotoMediaType | undefined {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(bytes, PNG_SIGNATURE)) return 'image/png';
  if (startsWith(bytes, ascii('RIFF')) && startsWith(bytes, ascii('WEBP'), 8))
    return 'image/webp';
  return undefined;
}

/**
 * Object key of a vessel photo: `vessels/<vesselId>/<photoId>.<ext>`. A new
 * upload gets a new key, so cached URLs of the previous photo never show the
 * new image and the old object can be deleted independently.
 */
export function photoObjectKey(
  vesselId: string,
  photoId: string,
  mediaType: PhotoMediaType,
): string {
  return `vessels/${vesselId}/${photoId}.${EXTENSIONS[mediaType]}`;
}
