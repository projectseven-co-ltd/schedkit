import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import bcrypt from 'bcryptjs';

const scryptAsync = promisify(scrypt);

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = await scryptAsync(String(password), salt, 64);
  return `scrypt:${salt.toString('hex')}:${Buffer.from(derived).toString('hex')}`;
}

export async function verifyPassword(password, stored) {
  if (!stored) return false;
  const hash = String(stored);

  if (hash.startsWith('scrypt:')) {
    const parts = hash.split(':');
    if (parts.length !== 3) return false;
    const salt = Buffer.from(parts[1], 'hex');
    const expected = Buffer.from(parts[2], 'hex');
    const derived = await scryptAsync(String(password), salt, 64);
    const actual = Buffer.from(derived);
    if (expected.length !== actual.length) return false;
    return timingSafeEqual(expected, actual);
  }

  // Blesta bcrypt hashes ($2y$ / $2a$ / $2b$)
  if (hash.startsWith('$2')) {
    return bcrypt.compare(String(password), hash);
  }

  return false;
}

/** Store a Blesta bcrypt hash as-is (migration). */
export function isBcryptHash(hash) {
  return hash && String(hash).startsWith('$2');
}
