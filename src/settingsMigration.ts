import { app } from "electron";
import log from "electron-log/main";
import fs from "fs";
import path from "path";
import { LEGACY_USER_DATA_DIR_NAME } from "./identity";

const migrationLog = log.scope("migration");

/**
 * The files in Sidra's user data folder that hold settings: the electron-conf
 * store and the Custom Theme palette. The Apple Music sign-in lives in
 * Chromium's own data beside them and is deliberately left behind.
 */
export const SETTINGS_FILES = ["config.json", "custom-theme.json"] as const;

/** What a migration copied and what it could not. */
export interface MigrationResult {
  copied: string[];
  failed: { file: string; code: string }[];
}

/**
 * Copy Sidra's settings into a Hydra user data folder that has none yet.
 *
 * Runs only while Hydra has no config.json, so it happens on the first start
 * and never again, and only when Sidra has one. Keyed on the file rather than
 * the folder because Chromium may create the folder before this runs. Files
 * already in place are never overwritten and the Sidra folder is only read.
 * Never throws: a file that cannot be copied leaves that setting at its
 * default, which is what a fresh install starts with anyway.
 */
export function migrateSettings(
  userData: string,
  legacyUserData: string,
): MigrationResult {
  const result: MigrationResult = { copied: [], failed: [] };
  if (fs.existsSync(path.join(userData, "config.json"))) return result;
  if (!fs.existsSync(path.join(legacyUserData, "config.json"))) return result;
  for (const file of SETTINGS_FILES) {
    const from = path.join(legacyUserData, file);
    if (!fs.existsSync(from)) continue;
    try {
      fs.mkdirSync(userData, { recursive: true });
      fs.copyFileSync(from, path.join(userData, file), fs.constants.COPYFILE_EXCL);
      result.copied.push(file);
    } catch (e: unknown) {
      const code = e instanceof Error && "code" in e ? String(e.code) : "unknown";
      result.failed.push({ file, code });
    }
  }
  return result;
}

// Imported first by src/main.ts, before src/config.ts opens its store. An
// explicit --user-data-dir names its own profile, so nothing is copied into it.
let outcome: MigrationResult | null = null;
if (!app.commandLine.hasSwitch("user-data-dir")) {
  outcome = migrateSettings(
    app.getPath("userData"),
    path.join(app.getPath("appData"), LEGACY_USER_DATA_DIR_NAME),
  );
}

/**
 * Log what the import-time migration did. The copy has to run before
 * src/main.ts initialises electron-log, and a line logged then reaches the
 * console but never the log file, so main.ts calls this once logging is set up.
 */
export function reportSettingsMigration(): void {
  if (!outcome) return;
  const { copied, failed } = outcome;
  outcome = null;
  if (copied.length > 0) {
    migrationLog.info(`copied settings from ${LEGACY_USER_DATA_DIR_NAME}: ${copied.join(", ")}`);
  }
  for (const { file, code } of failed) {
    migrationLog.warn(`could not copy ${file} from ${LEGACY_USER_DATA_DIR_NAME}: ${code}`);
  }
}
