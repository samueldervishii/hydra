// Hydra 2.0 keeps its own user data folder. On the first start it copies the
// settings, never the sign-in, from the Sidra folder Hydra 1.x shared, which
// it leaves untouched. Exercised against real folders under the OS temp dir.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const electron = vi.hoisted(() => ({
  hasSwitch: vi.fn((_name: string) => false),
  paths: { userData: "", appData: "" },
}));

vi.mock("electron", () => ({
  app: {
    commandLine: { hasSwitch: electron.hasSwitch },
    getPath: (name: "userData" | "appData") => electron.paths[name],
  },
}));

let root: string;
let hydra: string;
let sidra: string;

function write(dir: string, file: string, body: string): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, file), body);
}

function read(dir: string, file: string): string {
  return fs.readFileSync(path.join(dir, file), "utf8");
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "hydra-migration-"));
  hydra = path.join(root, "Hydra");
  sidra = path.join(root, "Sidra");
  electron.paths.userData = hydra;
  electron.paths.appData = root;
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  vi.resetModules();
  vi.clearAllMocks();
});

describe("migrateSettings", () => {
  it("copies the settings and the custom theme, and nothing else", async () => {
    const { migrateSettings } = await import("../src/settingsMigration");
    write(sidra, "config.json", '{"performanceMode":{"enabled":false}}');
    write(sidra, "custom-theme.json", '{"dark":{}}');
    write(sidra, "Cookies", "sign-in");
    write(path.join(sidra, "Partitions", "sidra"), "Cookies", "sign-in");

    expect(migrateSettings(hydra, sidra)).toEqual({
      copied: ["config.json", "custom-theme.json"],
      failed: [],
    });
    expect(read(hydra, "config.json")).toBe('{"performanceMode":{"enabled":false}}');
    expect(read(hydra, "custom-theme.json")).toBe('{"dark":{}}');
    expect(fs.readdirSync(hydra).sort()).toEqual(["config.json", "custom-theme.json"]);
  });

  it("leaves the Sidra folder exactly as it was", async () => {
    const { migrateSettings } = await import("../src/settingsMigration");
    write(sidra, "config.json", '{"theme":"nord"}');
    const before = fs.statSync(path.join(sidra, "config.json"));
    migrateSettings(hydra, sidra);
    const after = fs.statSync(path.join(sidra, "config.json"));
    expect(read(sidra, "config.json")).toBe('{"theme":"nord"}');
    expect(after.mtimeMs).toBe(before.mtimeMs);
    expect(fs.readdirSync(sidra)).toEqual(["config.json"]);
  });

  // Chromium may create the folder before the first import runs, so an empty
  // Hydra folder still counts as a first start.
  it("migrates into a Hydra folder that exists but holds no settings", async () => {
    const { migrateSettings } = await import("../src/settingsMigration");
    fs.mkdirSync(hydra, { recursive: true });
    write(sidra, "config.json", "{}");
    expect(migrateSettings(hydra, sidra).copied).toEqual(["config.json"]);
  });

  it("never runs again once Hydra has its own settings", async () => {
    const { migrateSettings } = await import("../src/settingsMigration");
    write(hydra, "config.json", '{"theme":"dracula"}');
    write(sidra, "config.json", '{"theme":"nord"}');
    write(sidra, "custom-theme.json", '{"dark":{}}');
    expect(migrateSettings(hydra, sidra)).toEqual({ copied: [], failed: [] });
    expect(read(hydra, "config.json")).toBe('{"theme":"dracula"}');
    expect(fs.existsSync(path.join(hydra, "custom-theme.json"))).toBe(false);
  });

  it("does nothing without Sidra settings", async () => {
    const { migrateSettings } = await import("../src/settingsMigration");
    write(sidra, "custom-theme.json", '{"dark":{}}');
    expect(migrateSettings(hydra, sidra)).toEqual({ copied: [], failed: [] });
    expect(fs.existsSync(hydra)).toBe(false);
  });

  it("reports a file it cannot copy instead of throwing", async () => {
    const { migrateSettings } = await import("../src/settingsMigration");
    write(sidra, "config.json", "{}");
    // A folder where the custom theme should be makes that copy fail.
    fs.mkdirSync(path.join(sidra, "custom-theme.json"));
    const result = migrateSettings(hydra, sidra);
    expect(result.copied).toEqual(["config.json"]);
    expect(result.failed).toEqual([
      { file: "custom-theme.json", code: expect.any(String) },
    ]);
  });
});

describe("settingsMigration at import", () => {
  it("copies from the Sidra folder beside userData", async () => {
    write(sidra, "config.json", '{"sidebar":{"collapsed":true}}');
    await import("../src/settingsMigration");
    expect(read(hydra, "config.json")).toBe('{"sidebar":{"collapsed":true}}');
  });

  // Logged later, once src/main.ts has set up electron-log: a line logged
  // during the import reached the console but never the log file.
  it("logs what it copied only when asked, and only once", async () => {
    write(sidra, "config.json", "{}");
    const log = (await import("electron-log/main")).default;
    const info = vi.mocked(log.scope("migration").info);
    info.mockClear();
    const { reportSettingsMigration } = await import("../src/settingsMigration");
    expect(info).not.toHaveBeenCalled();
    reportSettingsMigration();
    expect(info).toHaveBeenCalledExactlyOnceWith("copied settings from Sidra: config.json");
    reportSettingsMigration();
    expect(info).toHaveBeenCalledOnce();
  });

  it("copies nothing into an explicit --user-data-dir", async () => {
    electron.hasSwitch.mockReturnValue(true);
    write(sidra, "config.json", "{}");
    await import("../src/settingsMigration");
    expect(electron.hasSwitch).toHaveBeenCalledWith("user-data-dir");
    expect(fs.existsSync(hydra)).toBe(false);
  });

  it("is the first module src/main.ts loads, ahead of the config store", () => {
    const source = fs.readFileSync(path.join(__dirname, "..", "src", "main.ts"), "utf8");
    const firstImport = source.match(/^import [^;]+;/m)?.[0];
    expect(firstImport).toBe('import { reportSettingsMigration } from "./settingsMigration";');
  });
});
