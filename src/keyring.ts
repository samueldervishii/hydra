import { safeStorage } from "electron";

/**
 * True when safeStorage encrypts with an OS-protected key. On Linux,
 * Chromium's "basic_text" backend is an obfuscation anyone can reverse, so it
 * counts as no keyring, as does a backend Chromium could not identify. A
 * secret Hydra cannot protect is kept in memory for the run instead of being
 * written readable.
 */
export function keyringAvailable(): boolean {
  if (!safeStorage.isEncryptionAvailable()) return false;
  if (process.platform !== "linux") return true;
  const backend = safeStorage.getSelectedStorageBackend();
  return backend !== "basic_text" && backend !== "unknown";
}
