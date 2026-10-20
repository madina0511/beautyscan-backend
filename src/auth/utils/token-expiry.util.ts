export function parseTokenExpiryToMilliseconds(expiresIn: string): number {
  const match = expiresIn.match(/^(\d+)([dh])$/);

  if (!match) {
    throw new Error('Token expiry must use format like 7d or 24h');
  }

  const value = Number(match[1]);
  const unit = match[2];

  if (value <= 0) {
    throw new Error('Token expiry must be greater than 0');
  }

  if (unit === 'd') {
    return value * 24 * 60 * 60 * 1000;
  }

  return value * 60 * 60 * 1000;
}
