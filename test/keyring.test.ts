import { beforeEach, describe, expect, it, vi } from "vitest";
import { safeStorage } from "electron";

import { keyringAvailable, keyringDescription } from "../src/keyring";
import { restorePlatform, setPlatform } from "./mocks/platform";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true);
  setPlatform("linux");
  return restorePlatform;
});

describe("keyring", () => {
  it.each([
    ["gnome_libsecret", true, "GNOME Keyring (gnome_libsecret)"],
    ["kwallet5", true, "KWallet 5 (kwallet5)"],
    ["kwallet6", true, "KWallet 6 (kwallet6)"],
    ["basic_text", false, "no keyring, memory only (basic_text)"],
    ["unknown", false, "no keyring, memory only (unknown)"],
  ] as const)("on Linux names %s for Settings", (backend, available, description) => {
    vi.mocked(safeStorage.getSelectedStorageBackend).mockReturnValue(backend);
    expect(keyringAvailable()).toBe(available);
    expect(keyringDescription()).toBe(description);
  });

  // As under a session with no Secret Service: Chromium reports basic_text
  // and no encryption, and Settings shows both.
  it("names the backend even when no encryption is available", () => {
    vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(false);
    vi.mocked(safeStorage.getSelectedStorageBackend).mockReturnValue("basic_text");
    expect(keyringAvailable()).toBe(false);
    expect(keyringDescription()).toBe("no keyring, memory only (basic_text)");
    setPlatform("darwin");
    expect(keyringDescription()).toBe("no keyring, memory only");
  });

  // Measured: with GNOME Keyring locked at launch, Chromium keeps
  // gnome_libsecret as the backend and reports no encryption.
  it("says a real keyring is locked or unavailable rather than absent", () => {
    vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(false);
    vi.mocked(safeStorage.getSelectedStorageBackend).mockReturnValue("gnome_libsecret");
    expect(keyringAvailable()).toBe(false);
    expect(keyringDescription()).toBe("GNOME Keyring, locked or unavailable (gnome_libsecret)");
  });

  it("names the macOS and Windows stores without asking for a Linux backend", () => {
    setPlatform("darwin");
    expect(keyringDescription()).toBe("macOS Keychain");
    setPlatform("win32");
    expect(keyringDescription()).toBe("Windows DPAPI");
    expect(safeStorage.getSelectedStorageBackend).not.toHaveBeenCalled();
  });
});
