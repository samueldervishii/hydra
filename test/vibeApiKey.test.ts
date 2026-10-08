import { beforeEach, describe, expect, it, vi } from "vitest";
import { safeStorage } from "electron";
import { Conf } from "electron-conf/main";
import { restorePlatform, setPlatform } from "./mocks/platform";

const store = (Conf as unknown as { _data: Map<string, unknown> })._data;
const KEY = "sk-ant-api03-" + "a".repeat(40);
const SEALED = Buffer.from(`sealed:${KEY}`).toString("base64");

// The module caches the key it read, so each test loads its own copy.
async function loadKeyStore(): Promise<typeof import("../src/integrations/vibe/apiKey")> {
  vi.resetModules();
  return import("../src/integrations/vibe/apiKey");
}

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true);
  vi.mocked(safeStorage.getSelectedStorageBackend).mockReturnValue("gnome_libsecret");
  setPlatform("linux");
  return restorePlatform;
});

describe("Vibe API key store", () => {
  it("stores the key encrypted, never readable, and reads it back next run", async () => {
    const keys = await loadKeyStore();
    keys.saveApiKey(`  ${KEY}  `);
    expect(keys.getApiKeyStatus()).toEqual({ hasKey: true, persisted: true, state: "ready" });
    expect(JSON.stringify([...store.entries()])).not.toContain(KEY);
    expect(store.get("vibe.apiKey")).toBe(SEALED);

    const nextRun = await loadKeyStore();
    expect(nextRun.getApiKey()).toBe(KEY);
  });

  // What reaches config.json, as JSON: only ciphertext from safeStorage, base64.
  it("writes nothing but safeStorage's ciphertext to config", async () => {
    const keys = await loadKeyStore();
    keys.saveApiKey(KEY);
    expect([...store.keys()]).toEqual(["vibe.apiKey"]);
    expect(safeStorage.encryptString).toHaveBeenCalledExactlyOnceWith(KEY);
  });

  it("keeps the key in memory only without a real keyring", async () => {
    vi.mocked(safeStorage.getSelectedStorageBackend).mockReturnValue("basic_text");
    const keys = await loadKeyStore();
    keys.saveApiKey(KEY);
    expect(keys.getApiKey()).toBe(KEY);
    expect(keys.getApiKeyStatus()).toEqual({ hasKey: true, persisted: false, state: "ready" });
    expect(store.has("vibe.apiKey")).toBe(false);
    expect(JSON.stringify([...store.entries()])).not.toContain(KEY);
    expect(safeStorage.encryptString).not.toHaveBeenCalled();

    const nextRun = await loadKeyStore();
    expect(nextRun.getApiKey()).toBeNull();
  });

  // As Hydra sees a keyring that was locked at launch: Chromium reports no
  // encryption, with the backend still gnome_libsecret.
  it("keeps a stored key while the keyring is locked, and retries it on each request", async () => {
    store.set("vibe.apiKey", SEALED);
    vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(false);
    const keys = await loadKeyStore();
    expect(keys.getApiKey()).toBeNull();
    expect(keys.getApiKeyStatus()).toEqual({ hasKey: false, persisted: false, state: "locked" });
    expect(store.get("vibe.apiKey")).toBe(SEALED);
    expect(safeStorage.decryptString).not.toHaveBeenCalled();

    // Settings reports the last outcome without asking the keyring again.
    const checks = vi.mocked(safeStorage.isEncryptionAvailable).mock.calls.length;
    keys.getApiKeyStatus();
    keys.getApiKeyStatus();
    expect(vi.mocked(safeStorage.isEncryptionAvailable).mock.calls.length).toBe(checks);

    // A request asks again; still locked, still kept.
    expect(keys.getApiKey()).toBeNull();
    expect(vi.mocked(safeStorage.isEncryptionAvailable).mock.calls.length).toBe(checks + 1);
    expect(store.get("vibe.apiKey")).toBe(SEALED);

    // Once encryption is back, the next request reads the key.
    vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true);
    expect(keys.getApiKey()).toBe(KEY);
    expect(keys.getApiKeyStatus()).toEqual({ hasKey: true, persisted: true, state: "ready" });
  });

  it("keeps a stored key that will not decrypt, and retries it", async () => {
    store.set("vibe.apiKey", Buffer.from("garbage").toString("base64"));
    const keys = await loadKeyStore();
    expect(keys.getApiKey()).toBeNull();
    expect(keys.getApiKeyStatus().state).toBe("unreadable");
    expect(store.get("vibe.apiKey")).toBe(Buffer.from("garbage").toString("base64"));
    expect(keys.getApiKey()).toBeNull();
    expect(safeStorage.decryptString).toHaveBeenCalledTimes(2);
    expect(store.has("vibe.apiKey")).toBe(true);
  });

  // It decrypted, so the keyring works and retrying cannot help.
  it("drops a stored value that decrypts to something other than a key", async () => {
    store.set("vibe.apiKey", Buffer.from("sealed:not-a-key").toString("base64"));
    const keys = await loadKeyStore();
    expect(keys.getApiKey()).toBeNull();
    expect(keys.getApiKeyStatus().state).toBe("none");
    expect(store.has("vibe.apiKey")).toBe(false);
  });

  it("lets a locked key be replaced or removed", async () => {
    store.set("vibe.apiKey", SEALED);
    vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(false);
    const keys = await loadKeyStore();
    expect(keys.getApiKeyStatus().state).toBe("locked");
    keys.clearApiKey();
    expect(keys.getApiKeyStatus()).toEqual({ hasKey: false, persisted: false, state: "none" });
    expect(store.has("vibe.apiKey")).toBe(false);

    store.set("vibe.apiKey", SEALED);
    const again = await loadKeyStore();
    expect(again.getApiKeyStatus().state).toBe("locked");
    const replacement = "sk-ant-api03-" + "b".repeat(40);
    again.saveApiKey(replacement);
    expect(again.getApiKey()).toBe(replacement);
    // No keyring to encrypt with, so the replacement lives in memory only.
    expect(store.has("vibe.apiKey")).toBe(false);
  });

  it("deletes the key from config and memory", async () => {
    const keys = await loadKeyStore();
    keys.saveApiKey(KEY);
    keys.clearApiKey();
    expect(keys.getApiKeyStatus()).toEqual({ hasKey: false, persisted: false, state: "none" });
    expect(store.has("vibe.apiKey")).toBe(false);
    expect((await loadKeyStore()).getApiKey()).toBeNull();
  });

  it("accepts only the shape of an Anthropic API key", async () => {
    const { isApiKeyFormat } = await loadKeyStore();
    expect(isApiKeyFormat(KEY)).toBe(true);
    expect(isApiKeyFormat(` ${KEY}\n`)).toBe(true);
    for (const bad of ["", "sk-ant-short", "sk-live-" + "a".repeat(40), `${KEY} extra`, 42, null]) {
      expect(isApiKeyFormat(bad)).toBe(false);
    }
  });
});
