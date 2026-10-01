// Pure constants: no imports from electron, so any module and test can use them.

/**
 * The name the system knows the app by, which a display rename must not
 * move: the package and executable name, the sidra.desktop entry, the MPRIS
 * bus name (org.mpris.MediaPlayer2.sidra), the notification desktop-entry
 * hint and the cache folder. What users see is package.json's productName,
 * read through app.getName().
 */
export const INTERNAL_NAME = "sidra";

/**
 * The folder under the platform's app data directory that holds settings,
 * the Apple Music sign-in and the logs (~/.config/Sidra on Linux). Electron
 * names it after productName, so src/userDataPath.ts pins it here instead.
 */
export const USER_DATA_DIR_NAME = "Sidra";
