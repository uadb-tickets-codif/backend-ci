import { describe, expect, it } from 'vitest';
import { detectFileType } from './file-type';

describe('detectFileType', () => {
  it('recognises PDF, PNG and JPEG from their content', () => {
    expect(detectFileType(Buffer.from('%PDF-1.7 ...'))?.mimeType).toBe('application/pdf');
    expect(
      detectFileType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]))
        ?.extension,
    ).toBe('.png');
    expect(detectFileType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]))?.mimeType).toBe(
      'image/jpeg',
    );
  });

  it('rejects anything else, whatever its name or declared type', () => {
    expect(detectFileType(Buffer.from('<html><script>alert(1)</script></html>'))).toBeNull();
    expect(detectFileType(Buffer.from('MZ\x90\x00'))).toBeNull();
    expect(detectFileType(Buffer.alloc(0))).toBeNull();
  });
});
