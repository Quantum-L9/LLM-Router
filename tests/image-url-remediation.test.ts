import { describe, expect, it } from 'vitest';
import { UnsafeImageUrlError, validateImageUrl } from '../src/providers/openrouter.js';

describe('image URL guard', () => {
  it.each([
    'http://example.com/a.png',
    'https://127.0.0.1/a.png',
    'https://10.0.0.1/a.png',
    'https://169.254.169.254/latest/meta-data',
    'https://[::1]/a.png',
    'https://[::ffff:127.0.0.1]/a.png',
    'https://host.internal/a.png',
  ])('rejects unsafe target %s', url => expect(() => validateImageUrl(url)).toThrow(UnsafeImageUrlError));

  it('allows a public HTTPS image', () => expect(() => validateImageUrl('https://cdn.example.com/a.png')).not.toThrow());
  it('allows bounded supported image data URIs', () => expect(() => validateImageUrl('data:image/png;base64,aGVsbG8=')).not.toThrow());
  it('rejects non-image data URIs', () => expect(() => validateImageUrl('data:text/plain;base64,aGVsbG8=')).toThrow(UnsafeImageUrlError));
});
