import { describe, it, expect } from 'vitest';
import {
  encryptApiKey,
  decryptApiKey,
  parseEncryptionKey,
  hasStoredApiKey,
  ApiKeyDecryptionError,
} from '../src/lib/apiKeyCrypto.js';

const USER = 'user_abc123';
const OTHER_USER = 'user_xyz789';
const SECRET = 'sk-not-a-real-key-0123456789';

describe('parseEncryptionKey', () => {
  it('accepts exactly 32 decoded bytes', () => {
    const raw = Buffer.alloc(32, 7).toString('base64');
    expect(parseEncryptionKey(raw)).toEqual({ key: Buffer.alloc(32, 7), error: null });
  });

  it('rejects a missing key', () => {
    expect(parseEncryptionKey(undefined).error).toMatch(/not set/);
    expect(parseEncryptionKey('').error).toMatch(/not set/);
  });

  it('rejects a key of the wrong length and says what it got', () => {
    const tooShort = Buffer.alloc(16, 1).toString('base64');
    const { key, error } = parseEncryptionKey(tooShort);
    expect(key).toBeNull();
    expect(error).toMatch(/exactly 32 bytes \(got 16\)/);
  });
});

describe('encryptApiKey / decryptApiKey', () => {
  it('round-trips a key', () => {
    const packed = encryptApiKey(SECRET, USER);
    expect(decryptApiKey(packed, USER)).toBe(SECRET);
  });

  it('never stores the plaintext in the packed value', () => {
    const packed = encryptApiKey(SECRET, USER);
    expect(packed).not.toContain(SECRET);
    expect(packed).not.toContain('sk-');
  });

  it('is versioned and shaped v1.<iv>.<tag>.<ciphertext>', () => {
    const parts = encryptApiKey(SECRET, USER).split('.');
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe('v1');
    // 12-byte IV and 16-byte tag, base64-encoded.
    expect(Buffer.from(parts[1], 'base64')).toHaveLength(12);
    expect(Buffer.from(parts[2], 'base64')).toHaveLength(16);
  });

  it('uses a fresh IV per call, so the same key encrypts differently each time', () => {
    const a = encryptApiKey(SECRET, USER);
    const b = encryptApiKey(SECRET, USER);
    expect(a).not.toBe(b);
    // Both still decrypt -- the difference is the nonce, not the payload.
    expect(decryptApiKey(a, USER)).toBe(SECRET);
    expect(decryptApiKey(b, USER)).toBe(SECRET);
  });

  it('refuses to decrypt another user\'s ciphertext (AAD binding)', () => {
    const packed = encryptApiKey(SECRET, USER);
    expect(() => decryptApiKey(packed, OTHER_USER)).toThrow(ApiKeyDecryptionError);
  });

  it('rejects a tampered ciphertext', () => {
    const [v, iv, tag, ct] = encryptApiKey(SECRET, USER).split('.');
    const flipped = Buffer.from(ct, 'base64');
    flipped[0] ^= 0xff;
    const packed = [v, iv, tag, flipped.toString('base64')].join('.');
    expect(() => decryptApiKey(packed, USER)).toThrow(ApiKeyDecryptionError);
  });

  it('rejects a tampered auth tag', () => {
    const [v, iv, tag, ct] = encryptApiKey(SECRET, USER).split('.');
    const flipped = Buffer.from(tag, 'base64');
    flipped[0] ^= 0xff;
    expect(() => decryptApiKey([v, iv, flipped.toString('base64'), ct].join('.'), USER)).toThrow(
      ApiKeyDecryptionError
    );
  });

  it('rejects malformed and unversioned payloads', () => {
    expect(() => decryptApiKey('garbage', USER)).toThrow(/malformed/i);
    expect(() => decryptApiKey('', USER)).toThrow(ApiKeyDecryptionError);
    const [, iv, tag, ct] = encryptApiKey(SECRET, USER).split('.');
    expect(() => decryptApiKey(['v2', iv, tag, ct].join('.'), USER)).toThrow(/version "v2"/);
  });

  it('never leaks key material in the error message', () => {
    const packed = encryptApiKey(SECRET, USER);
    try {
      decryptApiKey(packed, OTHER_USER);
      throw new Error('expected a decryption failure');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiKeyDecryptionError);
      expect(err.message).not.toContain(SECRET);
      expect(err.message).not.toContain(packed);
      expect(err.message).not.toContain(process.env.ENCRYPTION_KEY);
    }
  });

  it('requires a non-empty plaintext and a userId', () => {
    expect(() => encryptApiKey('', USER)).toThrow(/non-empty/);
    expect(() => encryptApiKey(SECRET, '')).toThrow(/userId/);
  });
});

describe('hasStoredApiKey', () => {
  it('reports presence without revealing anything', () => {
    expect(hasStoredApiKey(encryptApiKey(SECRET, USER))).toBe(true);
    expect(hasStoredApiKey(null)).toBe(false);
    expect(hasStoredApiKey('')).toBe(false);
  });
});
