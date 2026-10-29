import { randomBytes } from 'crypto';

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

function randomBase36(length: number): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i]! % ALPHABET.length];
  return out;
}

// Short, URL-safe, sortable-ish ids: `<prefix>_<time36><random>`.
export function newId(prefix: 'p' | 'd' | 'v' | 'n' | 'l'): string {
  return `${prefix}_${Date.now().toString(36)}${randomBase36(6)}`;
}

export function isSafeId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z]_[a-z0-9]{6,24}$/.test(value);
}
