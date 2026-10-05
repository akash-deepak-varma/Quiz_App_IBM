import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Authenticated encryption for user-supplied AI provider API keys (AES-256-GCM).
 *
 * Deliberately dependency-free of config/env.js -- that module calls
 * `assertEncryptionKeyConfigured()` from its boot guards, so importing it back here would be a
 * cycle. Same reasoning as lib/dbDialect.js. `process.env` is read lazily inside the functions
 * rather than at module load, because `import 'dotenv/config'` runs in env.js and import hoisting
 * would otherwise evaluate this module's body first and memoize an undefined key.
 */

const KEY_BYTES = 32; // AES-256
const IV_BYTES = 12; // GCM standard nonce length
const VERSION = 'v1';

// '.' is unambiguous as a separator: base64's alphabet (A-Za-z0-9+/=) never contains one.
const SEPARATOR = '.';

export class ApiKeyDecryptionError extends Error {
  constructor(message = 'Stored API key could not be decrypted') {
    super(message);
    this.name = 'ApiKeyDecryptionError';
  }
}

let cachedKey = null;

/**
 * Parses ENCRYPTION_KEY without touching module state, so the boot guard can validate it and
 * report a precise reason before anything tries to use it.
 *
 * @returns {{ key: Buffer|null, error: string|null }}
 */
export function parseEncryptionKey(raw) {
  if (!raw) {
    return { key: null, error: 'ENCRYPTION_KEY is not set' };
  }

  let decoded;
  try {
    decoded = Buffer.from(raw, 'base64');
  } catch {
    return { key: null, error: 'ENCRYPTION_KEY is not valid base64' };
  }

  // Buffer.from is lenient -- it silently drops invalid characters rather than throwing, so a
  // typo'd key shows up here as a length mismatch rather than a parse failure.
  if (decoded.length !== KEY_BYTES) {
    return {
      key: null,
      error: `ENCRYPTION_KEY must decode to exactly ${KEY_BYTES} bytes (got ${decoded.length})`,
    };
  }

  return { key: decoded, error: null };
}

/**
 * Boot guard, called from config/env.js. Throws with an actionable message rather than letting a
 * missing or malformed key surface when the first user saves an API key.
 */
export function assertEncryptionKeyConfigured() {
  const { key, error } = parseEncryptionKey(process.env.ENCRYPTION_KEY);
  if (error) {
    throw new Error(
      `${error} -- generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
    );
  }
  cachedKey = key;
}

function getKey() {
  if (!cachedKey) {
    const { key, error } = parseEncryptionKey(process.env.ENCRYPTION_KEY);
    if (error) throw new Error(error);
    cachedKey = key;
  }
  return cachedKey;
}

/** Test-only: forget the memoized key so a suite can swap ENCRYPTION_KEY between cases. */
export function resetEncryptionKeyCache() {
  cachedKey = null;
}

/**
 * Encrypts an API key for storage.
 *
 * `userId` is passed as GCM additional authenticated data, which binds the ciphertext to its owner:
 * a row copied from one user to another fails authentication instead of decrypting. It costs one
 * argument and rules out a whole class of row-swap mistake.
 *
 * @returns {string} "v1.<ivBase64>.<authTagBase64>.<ciphertextBase64>"
 */
export function encryptApiKey(plaintext, userId) {
  if (typeof plaintext !== 'string' || plaintext.length === 0) {
    throw new Error('encryptApiKey requires a non-empty string');
  }
  if (typeof userId !== 'string' || userId.length === 0) {
    throw new Error('encryptApiKey requires a userId to bind the ciphertext to');
  }

  // A fresh IV on every call, including a re-save of the same key -- GCM nonce reuse under one key
  // is the failure mode that actually breaks this construction.
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', getKey(), iv);
  cipher.setAAD(Buffer.from(userId, 'utf8'));

  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [VERSION, iv.toString('base64'), authTag.toString('base64'), ciphertext.toString('base64')].join(
    SEPARATOR
  );
}

/**
 * Decrypts a stored API key.
 *
 * Throws `ApiKeyDecryptionError` for every failure mode -- wrong key, tampered row, rotated
 * ENCRYPTION_KEY, mismatched userId -- without echoing the ciphertext, the key, or the underlying
 * OpenSSL message. Callers turn this into "please re-enter your key in AI Settings".
 */
export function decryptApiKey(packed, userId) {
  if (typeof packed !== 'string' || packed.length === 0) {
    throw new ApiKeyDecryptionError('No stored API key to decrypt');
  }
  if (typeof userId !== 'string' || userId.length === 0) {
    throw new ApiKeyDecryptionError('No userId supplied for decryption');
  }

  const parts = packed.split(SEPARATOR);
  if (parts.length !== 4) {
    throw new ApiKeyDecryptionError('Stored API key is malformed');
  }

  const [version, ivB64, tagB64, ctB64] = parts;
  if (version !== VERSION) {
    throw new ApiKeyDecryptionError(`Unsupported stored API key version "${version}"`);
  }

  try {
    const iv = Buffer.from(ivB64, 'base64');
    const authTag = Buffer.from(tagB64, 'base64');
    const ciphertext = Buffer.from(ctB64, 'base64');

    const decipher = createDecipheriv('aes-256-gcm', getKey(), iv);
    decipher.setAAD(Buffer.from(userId, 'utf8'));
    decipher.setAuthTag(authTag);

    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    // Intentionally swallows the cause: `final()` throwing "Unsupported state or unable to
    // authenticate data" is all GCM tells us, and relaying it adds nothing a user can act on.
    throw new ApiKeyDecryptionError();
  }
}

/** Describes a stored key to the frontend without revealing it. */
export function hasStoredApiKey(ciphertext) {
  return typeof ciphertext === 'string' && ciphertext.length > 0;
}
