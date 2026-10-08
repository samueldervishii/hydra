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

/** What Linux's backend names mean, for Settings. */
const LINUX_BACKENDS: Record<string, string> = {
  gnome_libsecret: "GNOME Keyring",
  kwallet: "KWallet",
  kwallet5: "KWallet 5",
  kwallet6: "KWallet 6",
  basic_text: "no keyring, memory only",
  unknown: "no keyring, memory only",
};

/**
 * Where safeStorage keeps its key, named for Settings with Chromium's own
 * backend id in brackets on Linux, such as "GNOME Keyring (gnome_libsecret)".
 * The id is shown even when encryption is unavailable, since that is when it
 * explains why. getSelectedStorageBackend() exists on Linux only.
 */
export function keyringDescription(): string {
  if (process.platform === "linux") {
    const backend = safeStorage.getSelectedStorageBackend();
    const name = safeStorage.isEncryptionAvailable()
      ? (LINUX_BACKENDS[backend] ?? "unrecognised keyring")
      : "no keyring, memory only";
    return `${name} (${backend})`;
  }
  if (!safeStorage.isEncryptionAvailable()) return "no keyring, memory only";
  if (process.platform === "darwin") return "macOS Keychain";
  if (process.platform === "win32") return "Windows DPAPI";
  return "system keyring";
}
