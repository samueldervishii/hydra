// Pure constants: no imports from electron, so any module and test can use them.

/**
 * The name the system knows the app by, which a display rename must not
 * move: the package and executable name, the sidra.desktop entry, the MPRIS
 * bus name (org.mpris.MediaPlayer2.sidra) and the cache folder. What users see is package.json's productName,
 * read through app.getName().
 */
export const INTERNAL_NAME = "sidra";

// Both copyright notices the About window shows. Constants, not read from
// package.json: electron-builder drops the build key, and build.copyright with
// it, from the packaged copy. test/paths.test.ts keeps build.copyright equal
// to these.

/** The year of this fork's copyright notice. */
export const COPYRIGHT_YEAR = "2026";

/** This fork's author. */
export const COPYRIGHT_HOLDER = "Samuel Dervishi";

/** The project this fork is based on. */
export const ORIGINAL_NAME = "Sidra";

/** Sidra's author, who keeps the copyright in the code this fork started from. */
export const ORIGINAL_AUTHOR = "Martin Wimpress";

/**
 * The folder under the platform's app data directory that holds settings,
 * the Apple Music sign-in and the logs (~/.config/Sidra on Linux). Electron
 * names it after productName, so src/userDataPath.ts pins it here instead.
 */
export const USER_DATA_DIR_NAME = "Sidra";
