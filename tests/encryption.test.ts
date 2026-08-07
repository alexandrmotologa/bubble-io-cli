import { describe, it, expect } from 'vitest';
import { encrypt, decrypt } from '../src/utils/encryption';

describe('encrypt() / decrypt()', () => {
  const passphrase = 'super-secret-passphrase-123';
  const plaintext = '{"data":[{"_id":"abc","name":"Widget"}]}';

  it('should encrypt and decrypt a JSON string round-trip', () => {
    const encoded = encrypt(plaintext, passphrase);
    const decoded = decrypt(encoded, passphrase);
    expect(decoded).toBe(plaintext);
  });

  it('should produce different ciphertext on each call (random IV)', () => {
    const first = encrypt(plaintext, passphrase);
    const second = encrypt(plaintext, passphrase);
    expect(first).not.toBe(second);
  });

  it('should produce a base64-encoded string', () => {
    const encoded = encrypt(plaintext, passphrase);
    expect(() => Buffer.from(encoded, 'base64')).not.toThrow();
  });

  it('should throw when decrypting with the wrong passphrase', () => {
    const encoded = encrypt(plaintext, passphrase);
    expect(() => decrypt(encoded, 'wrong-passphrase')).toThrow();
  });

  it('should throw when decrypting a corrupted payload', () => {
    expect(() => decrypt('notbase64!!!', passphrase)).toThrow();
  });

  it('should throw when payload is too short to contain IV + tag', () => {
    const tooShort = Buffer.alloc(10).toString('base64');
    expect(() => decrypt(tooShort, passphrase)).toThrow('Invalid encrypted payload: too short.');
  });

  it('should handle empty string payloads', () => {
    const encoded = encrypt('', passphrase);
    expect(decrypt(encoded, passphrase)).toBe('');
  });

  it('should handle large payloads correctly', () => {
    const large = JSON.stringify({ data: Array.from({ length: 1000 }, (_, i) => ({ id: i, val: 'x'.repeat(100) })) });
    const encoded = encrypt(large, passphrase);
    expect(decrypt(encoded, passphrase)).toBe(large);
  });
});
