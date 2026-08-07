import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const SCRYPT_SALT = 'bubble-io-cli-v1'; // static salt — key material comes from passphrase
const KEY_LEN = 32;  // 256-bit key
const IV_LEN = 16;   // 128-bit IV
const TAG_LEN = 16;  // 128-bit auth tag

/**
 * Encrypts a UTF-8 string using AES-256-GCM with a key derived from `passphrase`.
 * Output format (base64): IV(16) | AuthTag(16) | CipherText(N)
 *
 * @param data       - Plain-text content to encrypt
 * @param passphrase - User-supplied passphrase (read from env var BUBBLE_BACKUP_PASSPHRASE)
 * @returns Base64-encoded encrypted payload
 */
export function encrypt(data: string, passphrase: string): string {
  const key = scryptSync(passphrase, SCRYPT_SALT, KEY_LEN);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([cipher.update(data, 'utf-8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  // Concatenate: iv | tag | ciphertext
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

/**
 * Decrypts a base64-encoded payload produced by `encrypt()`.
 *
 * @param encoded    - Base64 payload from encrypt()
 * @param passphrase - The same passphrase used during encryption
 * @returns Decrypted UTF-8 string
 * @throws If the passphrase is wrong or the data is tampered (GCM auth failure)
 */
export function decrypt(encoded: string, passphrase: string): string {
  const buf = Buffer.from(encoded, 'base64');

  if (buf.length < IV_LEN + TAG_LEN) {
    throw new Error('Invalid encrypted payload: too short.');
  }

  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ciphertext = buf.subarray(IV_LEN + TAG_LEN);

  const key = scryptSync(passphrase, SCRYPT_SALT, KEY_LEN);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf-8');
}
