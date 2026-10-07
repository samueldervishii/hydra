/**
 * Where the Last.fm session key lives. With a system keyring it is encrypted
 * by safeStorage and stored in config as base64; without one it is kept in
 * memory for this run only, and the user connects again after a restart. It
 * is never written readable: on Linux, Chromium's "basic_text" backend is an
 * obfuscation anyone can reverse, so it counts as no keyring.
 */
import { safeStorage } from "electron";
import log from "electron-log/main";
import {
  clearLastfmAccount,
  getLastfmEncryptedSession,
  getLastfmUsername,
  setLastfmAccount,
} from "../../config";
import { errorMessage } from "../../utils";

const sessionLog = log.scope("lastfm");

// undefined until the stored session is first read; null for no session.
let cached: string | null | undefined;

/** True when safeStorage encrypts with an OS-protected key. */
function keyringAvailable(): boolean {
  if (!safeStorage.isEncryptionAvailable()) return false;
  if (process.platform !== "linux") return true;
  const backend = safeStorage.getSelectedStorageBackend();
  return backend !== "basic_text" && backend !== "unknown";
}

/**
 * The session key, or null when no account is connected. The first call
 * decrypts the stored key; a key that will not decrypt, such as one written
 * under a keyring since reset, is forgotten and the account disconnected.
 */
export function getSessionKey(): string | null {
  if (cached !== undefined) return cached;
  cached = null;
  const encrypted = getLastfmEncryptedSession();
  if (encrypted) {
    try {
      cached = safeStorage.decryptString(Buffer.from(encrypted, "base64")) || null;
    } catch (err: unknown) {
      sessionLog.warn("stored session could not be decrypted, connect again:", errorMessage(err));
    }
  }
  // A name without a key is an account from a run that kept the key in memory.
  if (cached === null && (encrypted || getLastfmUsername())) clearLastfmAccount();
  return cached;
}

/** The connected account's name, or null when none is connected. */
export function getUsername(): string | null {
  return getSessionKey() === null ? null : getLastfmUsername();
}

/** Keep a new session: encrypted into config with a keyring, in memory without one. */
export function saveSession(key: string, username: string): void {
  cached = key;
  let encrypted: string | null = null;
  if (keyringAvailable()) {
    try {
      encrypted = safeStorage.encryptString(key).toString("base64");
    } catch (err: unknown) {
      sessionLog.warn("session could not be encrypted:", errorMessage(err));
    }
  }
  if (!encrypted) {
    sessionLog.warn("no system keyring: the Last.fm session lasts until Hydra quits");
  }
  setLastfmAccount(username, encrypted);
}

/** Forget the session in memory and in config. */
export function clearSession(): void {
  cached = null;
  clearLastfmAccount();
}
