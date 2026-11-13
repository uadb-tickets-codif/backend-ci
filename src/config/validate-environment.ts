export function validateEnvironment(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const jwtSecret = config.JWT_SECRET;

  if (
    typeof jwtSecret !== 'string' ||
    jwtSecret.length < 32 ||
    jwtSecret === 'replace-with-a-random-secret-at-least-32-characters'
  ) {
    throw new Error(
      'JWT_SECRET must be replaced with a random value of at least 32 characters',
    );
  }

  return config;
}
