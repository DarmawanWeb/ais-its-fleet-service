import { describe, expect, it } from 'vitest';

import {
  detectPhotoMediaType,
  PHOTO_MAX_BYTES,
  photoObjectKey,
} from './photo.js';

const bytes = (...values: number[]) => Uint8Array.from(values);
const text = (value: string) => new TextEncoder().encode(value);

describe('detectPhotoMediaType', () => {
  it('recognizes JPEG, PNG and WebP by their magic bytes', () => {
    expect(detectPhotoMediaType(bytes(0xff, 0xd8, 0xff, 0xe0, 0x00))).toBe(
      'image/jpeg',
    );
    expect(
      detectPhotoMediaType(
        bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0),
      ),
    ).toBe('image/png');
    const webp = new Uint8Array([
      ...text('RIFF'),
      0x24,
      0,
      0,
      0,
      ...text('WEBPVP8 '),
    ]);
    expect(detectPhotoMediaType(webp)).toBe('image/webp');
  });

  it('refuses other content whatever its name or declared type', () => {
    expect(detectPhotoMediaType(text('GIF89a'))).toBeUndefined();
    expect(
      detectPhotoMediaType(text('<svg xmlns="http://www.w3.org/2000/svg"/>')),
    ).toBeUndefined();
    expect(
      detectPhotoMediaType(text('RIFF\u0000\u0000\u0000\u0000WAVE')),
    ).toBeUndefined();
    expect(detectPhotoMediaType(bytes(0xff, 0xd8))).toBeUndefined();
    expect(detectPhotoMediaType(new Uint8Array())).toBeUndefined();
  });

  it('limits photos to 5 MB', () => {
    expect(PHOTO_MAX_BYTES).toBe(5_242_880);
  });
});

describe('photoObjectKey', () => {
  it('stores each upload under a new key with the extension of its type', () => {
    expect(photoObjectKey('v1', 'p1', 'image/jpeg')).toBe('vessels/v1/p1.jpg');
    expect(photoObjectKey('v1', 'p2', 'image/png')).toBe('vessels/v1/p2.png');
    expect(photoObjectKey('v1', 'p3', 'image/webp')).toBe('vessels/v1/p3.webp');
  });
});
