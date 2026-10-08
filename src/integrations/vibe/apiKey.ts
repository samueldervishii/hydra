/**
 * Where Vibe's Anthropic API key lives. With a system keyring it is encrypted
 * by safeStorage and stored in config as base64; without one it is kept in
 * memory for this run only. It is never written readable, never logged and
 * never sent to a renderer: Settings learns only whether a key is saved.
 *
 * A stored key that cannot be decrypted is kept, never deleted: the keyring
 * may only be locked. A request retries the decryption; Settings only reports
 * the last outcome. On Linux, Chromium asks the keyring once per run and keeps
 * a failure for the rest of it, so after unlocking a keyring that was locked
 * at launch the retry succeeds only once Hydra has restarted.
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

/**
 * What is known about the key: none set, ready to use, or stored but not
 * readable because encryption is unavailable (the keyring is locked) or
 * because decryption failed with the keyring available.
 */
export type ApiKeyState = "none" | "ready" | "locked" | "unreadable";

// undefined until the stored key is first read.
let state: ApiKeyState | undefined;
// The key while state is "ready".
let cached: string | null = null;
// Whether the key in memory is also saved, encrypted, in config.
let persisted = false;

/** True when the value has the shape of an Anthropic API key. */
export function isApiKeyFormat(value: unknown): value is string {
  return typeof value === "string" && API_KEY_FORMAT.test(value.trim());
}

/** Record a stored key that could not be read, logging only a change. */
function cannotRead(next: "locked" | "unreadable", detail?: string): void {
  if (state !== next) {
    keyLog.warn(
      next === "locked"
        ? "stored API key kept: the keyring is locked or unavailable"
        : `stored API key kept: it could not be decrypted${detail ? `: ${detail}` : ""}`,
    );
  }
  state = next;
  cached = null;
  persisted = false;
}

/** Read and decrypt the stored key, setting state from the outcome. */
function readStored(): void {
  const encrypted = getVibeEncryptedApiKey();
  if (!encrypted) {
    state = "none";
    cached = null;
    persisted = false;
    return;
  }
  if (!safeStorage.isEncryptionAvailable()) {
    cannotRead("locked");
    return;
  }
  let key: string;
  try {
    key = safeStorage.decryptString(Buffer.from(encrypted, "base64"));
  } catch (err: unknown) {
    cannotRead("unreadable", errorMessage(err));
    return;
  }
  if (!isApiKeyFormat(key)) {
    // It decrypted, so the keyring is fine and a retry cannot help: what was
    // stored is not a key, and is dropped.
    keyLog.warn("stored API key is malformed, enter it again");
    setVibeEncryptedApiKey(null);
    state = "none";
    cached = null;
    persisted = false;
    return;
  }
  if (state !== "ready" && state !== undefined) keyLog.info("stored API key readable again");
  state = "ready";
  cached = key;
  persisted = true;
}

/**
 * The API key for a request, or null when none can be used. A stored key that
 * could not be read is tried again on every call.
 */
export function getApiKey(): string | null {
  if (state === undefined || state === "locked" || state === "unreadable") readStored();
  return state === "ready" ? cached : null;
}

/** The state as last read, without reading: undefined before the first read. */
export function knownApiKeyState(): ApiKeyState | undefined {
  return state;
}

/**
 * Whether a key is set, whether it outlives this run, and what stops a stored
 * one being read. Reads the stored key on the first call only: retrying is
 * left to requests.
 */
export function getApiKeyStatus(): {
  hasKey: boolean;
  persisted: boolean;
  state: ApiKeyState;
} {
  if (state === undefined) readStored();
  const current = state ?? "none";
  return { hasKey: current === "ready", persisted: current === "ready" && persisted, state: current };
}

/**
 * Keep a new key: encrypted into config with a keyring, in memory without one.
 * Saving replaces any stored key, readable or not. The caller has checked it
 * with isApiKeyFormat().
 */
export function saveApiKey(key: string): void {
  const trimmed = key.trim();
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
  state = "ready";
  cached = trimmed;
  persisted = encrypted !== null;
  setVibeEncryptedApiKey(encrypted);
}

/** Forget the key in memory and in config, readable or not. */
export function clearApiKey(): void {
  state = "none";
  cached = null;
  persisted = false;
  setVibeEncryptedApiKey(null);
}
