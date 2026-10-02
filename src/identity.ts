// Pure constants: no imports from electron, so any module and test can use them.

/**
 * The name the system knows the app by: the package and executable name, the
 * hydra.desktop entry, the MPRIS bus name (org.mpris.MediaPlayer2.hydra), the
 * track paths and the cache folder. What users see is package.json's
 * productName, read through app.getName().
 */
export const INTERNAL_NAME = "hydra";

// Both copyright notices the About window shows. Constants, not read from
// package.json: electron-builder drops the build key, and build.copyright with
// it, from the packaged copy. test/paths.test.ts keeps build.copyright equal
// to these.

/** The year of this fork's copyright notice. */
export const COPYRIGHT_YEAR = "2026";

/** This fork's author. */
export const COPYRIGHT_HOLDER = "Samuel Dervishi";

/** This fork's author on GitHub, linked from the About window. */
export const COPYRIGHT_HOLDER_URL = "https://github.com/samueldervishii";

/** The project this fork is based on. */
export const ORIGINAL_NAME = "Sidra";

/** Sidra's author, who keeps the copyright in the code this fork started from. */
export const ORIGINAL_AUTHOR = "Martin Wimpress";

/**
 * Sidra's author on GitHub. github.com/wimpysworld is the organisation Sidra
 * lives under; this is his personal profile, the account upstream's
 * FUNDING.yml names.
 */
export const ORIGINAL_AUTHOR_URL = "https://github.com/flexiondotorg";

/**
 * Sidra's folder under the platform's app data directory (~/.config/Sidra on
 * Linux), which Hydra 1.x shared. Hydra keeps its own, named after
 * productName, and src/settingsMigration.ts copies the settings from this one
 * on the first start.
 */
export const LEGACY_USER_DATA_DIR_NAME = "Sidra";
