// Electron names userData after productName, so the display rename to Hydra
// would move settings and the Apple Music sign-in out of ~/.config/Sidra.
// src/userDataPath.ts pins it, once, at import.
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const electron = vi.hoisted(() => ({
  hasSwitch: vi.fn((_name: string) => false),
  setPath: vi.fn(),
}));

vi.mock("electron", () => ({
  app: {
    commandLine: { hasSwitch: electron.hasSwitch },
    getPath: (name: string) => `/home/user/.config-root/${name}`,
    setPath: electron.setPath,
  },
}));

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe("userDataPath", () => {
  it("pins userData to the Sidra folder whatever the product name", async () => {
    await import("../src/userDataPath");
    expect(electron.setPath).toHaveBeenCalledExactlyOnceWith(
      "userData",
      path.join("/home/user/.config-root/appData", "Sidra"),
    );
  });

  it("leaves an explicit --user-data-dir alone", async () => {
    electron.hasSwitch.mockReturnValueOnce(true);
    await import("../src/userDataPath");
    expect(electron.hasSwitch).toHaveBeenCalledWith("user-data-dir");
    expect(electron.setPath).not.toHaveBeenCalled();
  });

  it("is the first module src/main.ts loads", async () => {
    const fs = await import("node:fs");
    const source = fs.readFileSync(path.join(__dirname, "..", "src", "main.ts"), "utf8");
    const firstImport = source.match(/^import [^;]+;/m)?.[0];
    expect(firstImport).toBe('import "./userDataPath";');
  });
});
