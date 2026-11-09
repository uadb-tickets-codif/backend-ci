import { describe, expect, it } from 'vitest';
import { validateEnvironment } from './validate-environment';

describe('validateEnvironment', () => {
  it('accepts a configured JWT secret of sufficient length', () => {
    const config = { JWT_SECRET: 'a-random-secret-of-more-than-32-characters' };

    expect(validateEnvironment(config)).toBe(config);
  });

  it('rejects missing, short, or example JWT secrets', () => {
    for (const JWT_SECRET of [
      undefined,
      'too-short',
      'replace-with-a-random-secret-at-least-32-characters',
    ]) {
      expect(() => validateEnvironment({ JWT_SECRET })).toThrow(
        'JWT_SECRET must be replaced',
      );
    }
  });
});
