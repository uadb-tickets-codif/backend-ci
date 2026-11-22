export type DetectedFileType = {
  mimeType: 'application/pdf' | 'image/jpeg' | 'image/png';
  extension: '.pdf' | '.jpg' | '.png';
};

/**
 * Détermine le vrai type d'un fichier d'après ses premiers octets.
 * Le type déclaré par le navigateur (Content-Type) et le nom du fichier sont
 * modifiables par l'utilisateur : on ne s'y fie donc pas.
 */
export function detectFileType(buffer: Buffer): DetectedFileType | null {
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString('latin1') === '%PDF-') {
    return { mimeType: 'application/pdf', extension: '.pdf' };
  }
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return { mimeType: 'image/png', extension: '.png' };
  }
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return { mimeType: 'image/jpeg', extension: '.jpg' };
  }
  return null;
}
