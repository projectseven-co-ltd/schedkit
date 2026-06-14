import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = await scryptAsync(String(password), salt, 64);
  return `scrypt:${salt.toString('hex')}:${Buffer.from(derived).toString('hex')}`;
}

export async function verifyPassword(password, stored) {
  if (!stored || !String(stored).startsWith('scrypt:')) return false;
  const parts = String(stored).split(':');
  if (parts.length !== 3) return false;
  const salt = Buffer.from(parts[1], 'hex');
  const expected = Buffer.from(parts[2], 'hex');
  const derived = await scryptAsync(String(password), salt, 64);
  const actual = Buffer.from(derived);
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}
