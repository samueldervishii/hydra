import { beforeEach, describe, expect, it, vi } from "vitest";
import { safeStorage } from "electron";
import { Conf } from "electron-conf/main";
import { restorePlatform, setPlatform } from "./mocks/platform";

const store = (Conf as unknown as { _data: Map<string, unknown> })._data;
const KEY = "sk-ant-api03-" + "a".repeat(40);

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
    expect(keys.getApiKeyStatus()).toEqual({ hasKey: true, persisted: true });
    expect(JSON.stringify([...store.entries()])).not.toContain(KEY);
    expect(Buffer.from(store.get("vibe.apiKey") as string, "base64").toString()).toBe(`sealed:${KEY}`);

    const nextRun = await loadKeyStore();
    expect(nextRun.getApiKey()).toBe(KEY);
  });

  it("keeps the key in memory only without a real keyring", async () => {
    vi.mocked(safeStorage.getSelectedStorageBackend).mockReturnValue("basic_text");
    const keys = await loadKeyStore();
    keys.saveApiKey(KEY);
    expect(keys.getApiKey()).toBe(KEY);
    expect(keys.getApiKeyStatus()).toEqual({ hasKey: true, persisted: false });
    expect(store.get("vibe.apiKey")).toBeNull();
    expect(safeStorage.encryptString).not.toHaveBeenCalled();

    const nextRun = await loadKeyStore();
    expect(nextRun.getApiKey()).toBeNull();
  });

  it("forgets a stored key that will not decrypt", async () => {
    store.set("vibe.apiKey", Buffer.from("garbage").toString("base64"));
    const keys = await loadKeyStore();
    expect(keys.getApiKey()).toBeNull();
    expect(store.get("vibe.apiKey")).toBeNull();
  });

  it("clears the key from memory and config", async () => {
    const keys = await loadKeyStore();
    keys.saveApiKey(KEY);
    keys.clearApiKey();
    expect(keys.getApiKeyStatus()).toEqual({ hasKey: false, persisted: false });
    expect(store.get("vibe.apiKey")).toBeNull();
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
