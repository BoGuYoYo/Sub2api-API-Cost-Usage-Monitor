/**
 * Local credential protection.
 *
 * The app stores relay passwords on this machine only, so an account can sign
 * itself back in when the relay expires its session. Passwords are never sent
 * anywhere except to the relay the account belongs to.
 *
 * Before a password touches `localStorage` it is XOR-obfuscated with a random
 * per-installation key plus a checksum, so a casual look at the WebView storage
 * does not reveal it. This is deliberately *obfuscation, not strong
 * encryption*: the key lives in the same store, so anyone with full access to
 * the app data directory can still recover the secret. Use a password that is
 * unique to the relay if that matters to you.
 */

const DEVICE_KEY_STORAGE_KEY = "sub2api_device_key";
const OBFUSCATION_PREFIX = "enc:v1:";
const CHECKSUM_LENGTH = 4;

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function createDeviceKey(): string {
  const bytes = new Uint8Array(32);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
    return toBase64(bytes);
  }
  let fallback = "";
  for (let index = 0; index < 32; index += 1) {
    fallback += Math.floor(Math.random() * 256).toString(16).padStart(2, "0");
  }
  return fallback;
}

/** Per-installation key. Created on first use and kept locally. */
export function getDeviceKey(): string {
  try {
    const existing = localStorage.getItem(DEVICE_KEY_STORAGE_KEY);
    if (existing) return existing;
    const created = createDeviceKey();
    localStorage.setItem(DEVICE_KEY_STORAGE_KEY, created);
    return created;
  } catch {
    // Storage may be unavailable (private mode / cleared quota).
    return "sub2api-fallback-device-key";
  }
}

/** True when this installation already has a device key of its own. */
export function hasDeviceKey(): boolean {
  try {
    return !!localStorage.getItem(DEVICE_KEY_STORAGE_KEY);
  } catch {
    return false;
  }
}

/** Adopt the device key from a backup (only used while restoring). */
export function setDeviceKey(key: string): void {
  if (!key) return;
  try {
    localStorage.setItem(DEVICE_KEY_STORAGE_KEY, key);
  } catch {
    // Nothing to do: the secrets then simply stay unrecoverable.
  }
}

function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function keystream(key: string, length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  let offset = 0;
  let counter = 0;
  while (offset < length) {
    let hash = fnv1a(`${key}:${counter}`);
    for (let index = 0; index < 4 && offset < length; index += 1) {
      bytes[offset] = hash & 0xff;
      hash >>>= 8;
      offset += 1;
    }
    counter += 1;
  }
  return bytes;
}

function checksumBytes(bytes: Uint8Array): Uint8Array {
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  const out = new Uint8Array(CHECKSUM_LENGTH);
  for (let index = 0; index < CHECKSUM_LENGTH; index += 1) {
    out[index] = (hash >>> (index * 8)) & 0xff;
  }
  return out;
}

function matchesChecksum(plain: Uint8Array): boolean {
  if (plain.length <= CHECKSUM_LENGTH) return false;
  const body = plain.subarray(0, plain.length - CHECKSUM_LENGTH);
  const expected = checksumBytes(body);
  for (let index = 0; index < CHECKSUM_LENGTH; index += 1) {
    if (plain[body.length + index] !== expected[index]) return false;
  }
  return true;
}

export function isObfuscatedSecret(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(OBFUSCATION_PREFIX);
}

/** Obfuscate a plaintext secret for local storage. Empty input stays empty. */
export function obfuscateSecret(secret: string): string {
  if (!secret) return "";
  try {
    const body = new TextEncoder().encode(secret);
    const plain = new Uint8Array(body.length + CHECKSUM_LENGTH);
    plain.set(body, 0);
    plain.set(checksumBytes(body), body.length);

    const key = keystream(getDeviceKey(), plain.length);
    const encrypted = new Uint8Array(plain.length);
    for (let index = 0; index < plain.length; index += 1) {
      encrypted[index] = plain[index] ^ key[index];
    }
    return `${OBFUSCATION_PREFIX}${toBase64(encrypted)}`;
  } catch {
    return "";
  }
}

/**
 * Recover a stored secret. Returns an empty string when the value is missing,
 * uses a different device key, or fails its integrity check.
 */
export function revealSecret(stored: string | null | undefined): string {
  if (!stored) return "";
  if (!isObfuscatedSecret(stored)) return stored;
  try {
    const encrypted = fromBase64(stored.slice(OBFUSCATION_PREFIX.length));
    const key = keystream(getDeviceKey(), encrypted.length);
    const plain = new Uint8Array(encrypted.length);
    for (let index = 0; index < encrypted.length; index += 1) {
      plain[index] = encrypted[index] ^ key[index];
    }
    if (!matchesChecksum(plain)) return "";
    return new TextDecoder().decode(plain.subarray(0, plain.length - CHECKSUM_LENGTH));
  } catch {
    return "";
  }
}

/** True when a stored value holds a recoverable secret. */
export function hasRecoverableSecret(stored: string | null | undefined): boolean {
  return revealSecret(stored).length > 0;
}
