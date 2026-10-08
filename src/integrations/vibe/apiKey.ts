/**
 * Where Vibe's Anthropic API key lives. With a system keyring it is encrypted
 * by safeStorage and stored in config as base64; without one it is kept in
 * memory for this run only. It is never written readable, never logged and
 * never sent to a renderer: Settings learns only whether a key is saved.
 */
import { safeStorage } from "electron";
import log from "electron-log/main";
import {
  getVibeEncryptedApiKey,
  setVibeEncryptedApiKey,
} from "../../config";
import { keyringAvailable } from "../../keyring";
import { errorMessage } from "../../utils";

const keyLog = log.scope("vibe");

/**
 * The shape of an Anthropic API key: the sk-ant- prefix, then URL-safe
 * characters. Checked before a key is stored, so a stray paste of something
 * else is refused in Settings rather than at the first request.
 */
const API_KEY_FORMAT = /^sk-ant-[A-Za-z0-9_-]{20,300}$/;

// undefined until the stored key is first read; null for no key.
let cached: string | null | undefined;
// Whether the key in memory is also saved, encrypted, in config.
let persisted = false;

/** True when the value has the shape of an Anthropic API key. */
export function isApiKeyFormat(value: unknown): value is string {
  return typeof value === "string" && API_KEY_FORMAT.test(value.trim());
}

/**
 * The API key, or null when none is set. The first call decrypts the stored
 * key; one that will not decrypt, such as a key written under a keyring since
 * reset, is forgotten.
 */
export function getApiKey(): string | null {
  if (cached !== undefined) return cached;
  cached = null;
  const encrypted = getVibeEncryptedApiKey();
  if (!encrypted) return cached;
  try {
    const key = safeStorage.decryptString(Buffer.from(encrypted, "base64"));
    if (isApiKeyFormat(key)) {
      cached = key;
      persisted = true;
      return cached;
    }
    keyLog.warn("stored API key is malformed, enter it again");
  } catch (err: unknown) {
    keyLog.warn("stored API key could not be decrypted, enter it again:", errorMessage(err));
  }
  setVibeEncryptedApiKey(null);
  return cached;
}

/** Whether a key is set, and whether it outlives this run. */
export function getApiKeyStatus(): { hasKey: boolean; persisted: boolean } {
  const hasKey = getApiKey() !== null;
  return { hasKey, persisted: hasKey && persisted };
}

/**
 * Keep a new key: encrypted into config with a keyring, in memory without one.
 * The caller has checked it with isApiKeyFormat().
 */
export function saveApiKey(key: string): void {
  const trimmed = key.trim();
  cached = trimmed;
  let encrypted: string | null = null;
  if (keyringAvailable()) {
    try {
      encrypted = safeStorage.encryptString(trimmed).toString("base64");
    } catch (err: unknown) {
      keyLog.warn("API key could not be encrypted:", errorMessage(err));
    }
  }
  if (!encrypted) {
    keyLog.warn("no system keyring: the Vibe API key lasts until Hydra quits");
  }
  persisted = encrypted !== null;
  setVibeEncryptedApiKey(encrypted);
}

/** Forget the key in memory and in config. */
export function clearApiKey(): void {
  cached = null;
  persisted = false;
  setVibeEncryptedApiKey(null);
}
