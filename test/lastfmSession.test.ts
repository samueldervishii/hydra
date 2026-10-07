import { beforeEach, describe, expect, it, vi } from "vitest";
import { safeStorage } from "electron";
import { Conf } from "electron-conf/main";
import { restorePlatform, setPlatform } from "./mocks/platform";

const store = (Conf as unknown as { _data: Map<string, unknown> })._data;

// The module caches the session it read, so each test loads its own copy.
async function loadSession(): Promise<typeof import("../src/integrations/lastfm/session")> {
  vi.resetModules();
  return import("../src/integrations/lastfm/session");
}

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true);
  vi.mocked(safeStorage.getSelectedStorageBackend).mockReturnValue("gnome_libsecret");
  setPlatform("linux");
  return restorePlatform;
});

describe("Last.fm session store", () => {
  it("stores the key encrypted, never readable, and reads it back", async () => {
    const session = await loadSession();
    session.saveSession("secret-session-key", "listener");

    expect(store.get("lastfm.username")).toBe("listener");
    const stored = store.get("lastfm.session");
    expect(typeof stored).toBe("string");
    expect(JSON.stringify([...store.entries()])).not.toContain("secret-session-key");
    expect(Buffer.from(stored as string, "base64").toString()).toBe("sealed:secret-session-key");

    // A new run decrypts what the last one stored.
    const nextRun = await loadSession();
    expect(nextRun.getSessionKey()).toBe("secret-session-key");
    expect(nextRun.getUsername()).toBe("listener");
  });

  // Chromium's basic_text backend is an obfuscation with a fixed key, so it
  // protects nothing: the key stays in memory for this run only.
  it.each(["basic_text", "unknown"] as const)(
    "keeps the session in memory only with the %s backend",
    async (backend) => {
      vi.mocked(safeStorage.getSelectedStorageBackend).mockReturnValue(backend);
      const session = await loadSession();
      session.saveSession("secret-session-key", "listener");

      expect(session.getSessionKey()).toBe("secret-session-key");
      expect(store.get("lastfm.session")).toBeNull();
      expect(safeStorage.encryptString).not.toHaveBeenCalled();

      // The next run has no key, so the account it would name is cleared.
      const nextRun = await loadSession();
      expect(nextRun.getSessionKey()).toBeNull();
      expect(nextRun.getUsername()).toBeNull();
      expect(store.get("lastfm.username")).toBeNull();
    },
  );

  it("keeps the session in memory only when encryption is unavailable", async () => {
    vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(false);
    const session = await loadSession();
    session.saveSession("secret-session-key", "listener");
    expect(session.getSessionKey()).toBe("secret-session-key");
    expect(store.get("lastfm.session")).toBeNull();
  });

  // The backend check is Linux's: macOS and Windows encrypt with the Keychain
  // and DPAPI whenever encryption is available.
  it("trusts available encryption on other platforms", async () => {
    setPlatform("darwin");
    vi.mocked(safeStorage.getSelectedStorageBackend).mockReturnValue("unknown");
    const session = await loadSession();
    session.saveSession("secret-session-key", "listener");
    expect(store.get("lastfm.session")).toEqual(expect.any(String));
  });

  it("disconnects a stored session that no longer decrypts", async () => {
    store.set("lastfm.username", "listener");
    store.set("lastfm.session", Buffer.from("from another keyring").toString("base64"));
    const session = await loadSession();

    expect(session.getSessionKey()).toBeNull();
    expect(session.getUsername()).toBeNull();
    expect(store.get("lastfm.session")).toBeNull();
    expect(store.get("lastfm.username")).toBeNull();
  });

  it("forgets the session in memory and in config", async () => {
    const session = await loadSession();
    session.saveSession("secret-session-key", "listener");
    session.clearSession();
    expect(session.getSessionKey()).toBeNull();
    expect(store.get("lastfm.session")).toBeNull();
    expect(store.get("lastfm.username")).toBeNull();
  });

  it("logs neither the key nor the account name", async () => {
    const log = (await import("electron-log/main")).default;
    const session = await loadSession();
    session.saveSession("secret-session-key", "listener");
    const logged = JSON.stringify([
      ...vi.mocked(log.scope("config").info).mock.calls,
      ...vi.mocked(log.scope("lastfm").warn).mock.calls,
    ]);
    expect(logged).not.toContain("secret-session-key");
    expect(logged).not.toContain("listener");
  });
});
