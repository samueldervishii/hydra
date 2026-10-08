import fs from 'fs';
import { app } from 'electron';
import log from 'electron-log/main';
import { getAssetPath, getProductInfo } from './paths';
import type { VibeErrorCode } from './integrations/vibe/agent';

const i18nLog = log.scope('i18n');

// --- Load translation records from JSON ---

type TranslationFile = Record<string, Record<string, string>>;

// A missing or malformed file is fatal on purpose. Falling back to the English
// records would hide the most common cause, a locale file left out of the
// asarUnpack list, behind a UI that looks almost right.
function loadLocaleFile(filename: string): TranslationFile {
  const filePath = getAssetPath('assets', 'locales', filename);
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as TranslationFile;
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    i18nLog.error(`failed to load locale file ${filePath}: ${reason}`);
    throw new Error(
      `${app.getName()} could not load the locale file ${filePath}: ${reason}. ` +
      'Every file in assets/locales/ must be listed individually under asarUnpack in package.json.',
    );
  }
}

// Load synchronously because the first window needs translated splash text.
const loadingData = loadLocaleFile('loading.json');
const trayData = loadLocaleFile('tray.json');
const aboutData = loadLocaleFile('about.json');

// --- Translation records, re-exported so importers name a record, not a file ---

/** Translations for loading, keyed by BCP 47 language tag. */
export const LOADING_TEXT: Record<string, string> = loadingData.LOADING_TEXT;

/** Translations for about, keyed by BCP 47 language tag. */
export const ABOUT_TEXT: Record<string, string> = trayData.ABOUT_TEXT;
/** Translations for quit, keyed by BCP 47 language tag. */
export const QUIT_TEXT: Record<string, string> = trayData.QUIT_TEXT;
/** Translations for start page, keyed by BCP 47 language tag. */
export const START_PAGE_TEXT: Record<string, string> = trayData.START_PAGE_TEXT;
/** Translations for start page home, keyed by BCP 47 language tag. */
export const START_PAGE_HOME_TEXT: Record<string, string> = trayData.START_PAGE_HOME_TEXT;
/** Translations for start page new, keyed by BCP 47 language tag. */
export const START_PAGE_NEW_TEXT: Record<string, string> = trayData.START_PAGE_NEW_TEXT;
/** Translations for start page radio, keyed by BCP 47 language tag. */
export const START_PAGE_RADIO_TEXT: Record<string, string> = trayData.START_PAGE_RADIO_TEXT;
/** Translations for start page all playlists, keyed by BCP 47 language tag. */
export const START_PAGE_ALL_PLAYLISTS_TEXT: Record<string, string> = trayData.START_PAGE_ALL_PLAYLISTS_TEXT;
/** Translations for start page last, keyed by BCP 47 language tag. */
export const START_PAGE_LAST_TEXT: Record<string, string> = trayData.START_PAGE_LAST_TEXT;
/** Translations for on, keyed by BCP 47 language tag. */
export const ON_TEXT: Record<string, string> = trayData.ON_TEXT;
/** Translations for off, keyed by BCP 47 language tag. */
export const OFF_TEXT: Record<string, string> = trayData.OFF_TEXT;
/** Translations for style, keyed by BCP 47 language tag. */
export const STYLE_TEXT: Record<string, string> = trayData.STYLE_TEXT;
/** Translations for style custom, keyed by BCP 47 language tag. */
export const STYLE_CUSTOM_TEXT: Record<string, string> = trayData.STYLE_CUSTOM_TEXT;
/** Translations for zoom, keyed by BCP 47 language tag. */
export const ZOOM_TEXT: Record<string, string> = trayData.ZOOM_TEXT;
/** Translations for previous, keyed by BCP 47 language tag. */
export const PREVIOUS_TEXT: Record<string, string> = trayData.PREVIOUS_TEXT;
/** Translations for play, keyed by BCP 47 language tag. */
export const PLAY_TEXT: Record<string, string> = trayData.PLAY_TEXT;
/** Translations for pause, keyed by BCP 47 language tag. */
export const PAUSE_TEXT: Record<string, string> = trayData.PAUSE_TEXT;
/** Translations for next, keyed by BCP 47 language tag. */
export const NEXT_TEXT: Record<string, string> = trayData.NEXT_TEXT;
/** Translations for volume, keyed by BCP 47 language tag. */
export const VOLUME_TEXT: Record<string, string> = trayData.VOLUME_TEXT;
/** Translations for mute, keyed by BCP 47 language tag. */
export const MUTE_TEXT: Record<string, string> = trayData.MUTE_TEXT;
/** Translations for share, keyed by BCP 47 language tag. */
export const SHARE_TEXT: Record<string, string> = trayData.SHARE_TEXT;
/** Translations for hide window, keyed by BCP 47 language tag. */
export const HIDE_WINDOW_TEXT: Record<string, string> = trayData.HIDE_WINDOW_TEXT;
/** Translations for show window, keyed by BCP 47 language tag. */
export const SHOW_WINDOW_TEXT: Record<string, string> = trayData.SHOW_WINDOW_TEXT;
/** Translations for close to tray, keyed by BCP 47 language tag. */
export const CLOSE_TO_TRAY_TEXT: Record<string, string> = trayData.CLOSE_TO_TRAY_TEXT;
/** Translations for player, keyed by BCP 47 language tag. */
export const PLAYER_TEXT: Record<string, string> = trayData.PLAYER_TEXT;
/** Translations for start page browse, keyed by BCP 47 language tag. */
export const START_PAGE_BROWSE_TEXT: Record<string, string> = trayData.START_PAGE_BROWSE_TEXT;
/** Translations for start page library, keyed by BCP 47 language tag. */
export const START_PAGE_LIBRARY_TEXT: Record<string, string> = trayData.START_PAGE_LIBRARY_TEXT;
/** Translations for start page playlists, keyed by BCP 47 language tag. */
export const START_PAGE_PLAYLISTS_TEXT: Record<string, string> = trayData.START_PAGE_PLAYLISTS_TEXT;
/** Translations for start page search, keyed by BCP 47 language tag. */
export const START_PAGE_SEARCH_TEXT: Record<string, string> = trayData.START_PAGE_SEARCH_TEXT;
/** Translations for not playing, keyed by BCP 47 language tag. */
export const NOT_PLAYING_TEXT: Record<string, string> = trayData.NOT_PLAYING_TEXT;
/** Translations for back, keyed by BCP 47 language tag. */
export const BACK_TEXT: Record<string, string> = trayData.BACK_TEXT;
/** Translations for forward, keyed by BCP 47 language tag. */
export const FORWARD_TEXT: Record<string, string> = trayData.FORWARD_TEXT;
/** Translations for reload, keyed by BCP 47 language tag. */
export const RELOAD_TEXT: Record<string, string> = trayData.RELOAD_TEXT;
/** Translations for settings, keyed by BCP 47 language tag. */
export const SETTINGS_TEXT: Record<string, string> = trayData.SETTINGS_TEXT;
/** Translations for app, keyed by BCP 47 language tag. */
export const APP_TEXT: Record<string, string> = trayData.APP_TEXT;
/** Translations for settings error, keyed by BCP 47 language tag. */
export const SETTINGS_ERROR_TEXT: Record<string, string> = trayData.SETTINGS_ERROR_TEXT;
/** Translations for the Navigation setting, keyed by BCP 47 language tag. */
export const NAVIGATION_TEXT: Record<string, string> = trayData.NAVIGATION_TEXT;
/** Translations for the top bar navigation choice, keyed by BCP 47 language tag. */
export const NAVIGATION_TOP_BAR_TEXT: Record<string, string> = trayData.NAVIGATION_TOP_BAR_TEXT;
/** Translations for the Apple sidebar navigation choice, keyed by BCP 47 language tag. */
export const NAVIGATION_APPLE_SIDEBAR_TEXT: Record<string, string> = trayData.NAVIGATION_APPLE_SIDEBAR_TEXT;
/** Translations for lastfm connect, keyed by BCP 47 language tag. */
export const LASTFM_CONNECT_TEXT: Record<string, string> = trayData.LASTFM_CONNECT_TEXT;
/** Translations for lastfm connected, keyed by BCP 47 language tag. */
export const LASTFM_CONNECTED_TEXT: Record<string, string> = trayData.LASTFM_CONNECTED_TEXT;
/** Translations for lastfm connect failed, keyed by BCP 47 language tag. */
export const LASTFM_CONNECT_FAILED_TEXT: Record<string, string> = trayData.LASTFM_CONNECT_FAILED_TEXT;
/** Translations for lastfm disconnect, keyed by BCP 47 language tag. */
export const LASTFM_DISCONNECT_TEXT: Record<string, string> = trayData.LASTFM_DISCONNECT_TEXT;
/** Translations for performance mode, keyed by BCP 47 language tag. */
export const PERFORMANCE_MODE_TEXT: Record<string, string> = trayData.PERFORMANCE_MODE_TEXT;

/** Translations for close, keyed by BCP 47 language tag. */
export const CLOSE_TEXT: Record<string, string> = aboutData.CLOSE_TEXT;
/** Translations for about description, keyed by BCP 47 language tag. */
export const ABOUT_DESCRIPTION_TEXT: Record<string, string> = aboutData.ABOUT_DESCRIPTION_TEXT;
/** Translations for version prefix, keyed by BCP 47 language tag. */
export const VERSION_PREFIX: Record<string, string> = aboutData.VERSION_PREFIX;

// --- Cached system language list ---
// Cache the list because every tray rebuild resolves all labels. Changes to
// system language settings take effect on the next launch.
let _cachedLangs: string[] | null = null;
function getSystemLanguages(): string[] {
  if (!_cachedLangs) _cachedLangs = app.getPreferredSystemLanguages();
  return _cachedLangs;
}

// --- Generic locale resolution ---

/**
 * Resolve preferred languages in order. Check exact and normalised tags before
 * base languages, and resolve Chinese scripts before base-language fallback.
 * Use English only when no preferred language matches, so each record needs an
 * English entry.
 */
export function getLocalizedString(
  record: Record<string, string>,
  langs: string[],
): string {
  return getLocalizedEntry(record, langs).value;
}

function getLocalizedEntry(
  record: Record<string, string>,
  langs: string[],
): { value: string; lang: string } {
  for (const lang of langs) {
    if (record[lang]) return { value: record[lang], lang };
    try {
      const locale = new Intl.Locale(lang);
      if (record[locale.baseName]) return { value: record[locale.baseName], lang: locale.baseName };
      if (locale.language === 'zh') {
        const script = locale.maximize().script;
        const region = locale.region;
        const regionalTag = region ? `zh-${region}` : '';
        const regionalScript = region ? new Intl.Locale(regionalTag).maximize().script : undefined;
        const tag = record[regionalTag] && regionalScript === script
          ? regionalTag : script === 'Hant' ? 'zh-TW' : 'zh-CN';
        if (record[tag]) return { value: record[tag], lang: tag };
      }
      const base = locale.language;
      if (record[base]) return { value: record[base], lang: base };
    } catch {
      continue;
    }
  }
  return { value: record['en'], lang: 'en' };
}

// --- Public API (uses Electron app internally) ---

/**
 * The Apple Music storefront path segment, taken from the region rather than the
 * language: a Welsh or Gaelic UI in the United Kingdom still shops in gb.
 */
export function getStorefront(): string {
  const code = app.getLocaleCountryCode().toLowerCase();
  if (code) {
    i18nLog.debug(`storefront detected from locale: ${code}`);
    return code;
  }
  i18nLog.debug('storefront fallback: us');
  return 'us';
}

/**
 * The splash screen string, with the tag it resolved to. The splash needs the
 * tag as well as the text, because Arabic and Hebrew switch it to right to left.
 */
export function getLoadingText(): { text: string; lang: string } {
  const langs = getSystemLanguages();
  const { value: text, lang } = getLocalizedEntry(LOADING_TEXT, langs);
  i18nLog.debug(`resolved locale: ${lang}`);
  return { text, lang };
}

/** Resolved labels shared by tray and settings controls. */
export interface TrayStrings {
  settings: string;
  app: string;
  settingsError: string;
  about: string;
  quit: string;
  player: string;
  startPage: string;
  startPageHome: string;
  startPageNew: string;
  startPageRadio: string;
  startPageAllPlaylists: string;
  startPageBrowse: string;
  startPageLibrary: string;
  startPagePlaylists: string;
  startPageSearch: string;
  startPageLast: string;
  on: string;
  off: string;
  style: string;
  styleAppleMusic: string;
  styleCustom: string;
  zoom: string;
  zoom100: string;
  zoom125: string;
  zoom150: string;
  zoom175: string;
  zoom200: string;
  previous: string;
  play: string;
  pause: string;
  notPlaying: string;
  next: string;
  volume: string;
  mute: string;
  share: string;
  hideWindow: string;
  showWindow: string;
  closeToTray: string;
  performanceMode: string;
  navigation: string;
  navigationTopBar: string;
  navigationAppleSidebar: string;
  lastfm: string;
  lastfmConnect: string;
  lastfmConnected: string;
  lastfmConnectFailed: string;
  lastfmDisconnect: string;
  vibe: string;
  vibeApiKey: string;
  vibeSaveKey: string;
  vibeRemoveKey: string;
  vibeKeySaved: string;
  vibeKeyMemoryOnly: string;
  vibeKeyStorage: string;
  vibeKeyLocked: string;
  vibeKeyUnreadable: string;
  vibeModel: string;
  vibeUsage: string;
  vibePrivacy: string;
}

// Map each TrayStrings field to its translation record. The keyed Record makes
// a missing field a compile error. Brand names and zoom steps read the same in
// every language, so they use English-only records, which getLocalizedString()
// falls back to.
const TRAY_TEXT: Record<keyof TrayStrings, Record<string, string>> = {
  settings: SETTINGS_TEXT,
  app: APP_TEXT,
  settingsError: SETTINGS_ERROR_TEXT,
  about: ABOUT_TEXT,
  quit: QUIT_TEXT,
  player: PLAYER_TEXT,
  startPage: START_PAGE_TEXT,
  startPageHome: START_PAGE_HOME_TEXT,
  startPageNew: START_PAGE_NEW_TEXT,
  startPageRadio: START_PAGE_RADIO_TEXT,
  startPageAllPlaylists: START_PAGE_ALL_PLAYLISTS_TEXT,
  startPageBrowse: START_PAGE_BROWSE_TEXT,
  startPageLibrary: START_PAGE_LIBRARY_TEXT,
  startPagePlaylists: START_PAGE_PLAYLISTS_TEXT,
  startPageSearch: START_PAGE_SEARCH_TEXT,
  startPageLast: START_PAGE_LAST_TEXT,
  on: ON_TEXT,
  off: OFF_TEXT,
  style: STYLE_TEXT,
  styleAppleMusic: { en: 'Apple Music' },
  styleCustom: STYLE_CUSTOM_TEXT,
  zoom: ZOOM_TEXT,
  zoom100: { en: '100%' },
  zoom125: { en: '125%' },
  zoom150: { en: '150%' },
  zoom175: { en: '175%' },
  zoom200: { en: '200%' },
  previous: PREVIOUS_TEXT,
  play: PLAY_TEXT,
  pause: PAUSE_TEXT,
  notPlaying: NOT_PLAYING_TEXT,
  next: NEXT_TEXT,
  volume: VOLUME_TEXT,
  mute: MUTE_TEXT,
  share: SHARE_TEXT,
  hideWindow: HIDE_WINDOW_TEXT,
  showWindow: SHOW_WINDOW_TEXT,
  closeToTray: CLOSE_TO_TRAY_TEXT,
  performanceMode: PERFORMANCE_MODE_TEXT,
  navigation: NAVIGATION_TEXT,
  navigationTopBar: NAVIGATION_TOP_BAR_TEXT,
  navigationAppleSidebar: NAVIGATION_APPLE_SIDEBAR_TEXT,
  lastfm: { en: 'Last.fm' },
  lastfmConnect: LASTFM_CONNECT_TEXT,
  lastfmConnected: LASTFM_CONNECTED_TEXT,
  lastfmConnectFailed: LASTFM_CONNECT_FAILED_TEXT,
  lastfmDisconnect: LASTFM_DISCONNECT_TEXT,
  // Vibe ships in English for now; getLocalizedString() falls back to it.
  vibe: { en: 'Vibe' },
  vibeApiKey: { en: 'Anthropic API key' },
  vibeSaveKey: { en: 'Save key' },
  vibeRemoveKey: { en: 'Remove key' },
  vibeKeySaved: { en: 'API key saved' },
  vibeKeyMemoryOnly: { en: 'API key kept until Hydra quits: no system keyring to store it' },
  vibeKeyStorage: { en: 'Key storage: {backend}' },
  vibeKeyLocked: { en: 'Keyring locked: unlock it and restart Hydra, then retry' },
  vibeKeyUnreadable: { en: 'The saved API key cannot be read with this keyring: save it again' },
  vibeModel: { en: 'Model' },
  vibeUsage: { en: '{used} of {limit} requests used today' },
  vibePrivacy: {
    en: 'Each request sends your description and the artists and titles of your last 20 songs to Anthropic.',
  },
};

// TRAY_TEXT is a Record literal, so excess property checking already rules out
// a key outside the interface and this list is exactly keyof TrayStrings.
const TRAY_KEYS = Object.keys(TRAY_TEXT) as (keyof TrayStrings)[];

const NAMED_TRAY_KEYS: ReadonlySet<keyof TrayStrings> = new Set([
  'about',
  'hideWindow',
  'showWindow',
]);

/**
 * Resolve all tray labels once per menu rebuild. Labels in NAMED_TRAY_KEYS use
 * a {name} placeholder so translations cannot hardcode the product name.
 */
export function getTrayStrings(): TrayStrings {
  const langs = getSystemLanguages();
  const productName: string = getProductInfo().productName;
  const strings = {} as TrayStrings;
  for (const key of TRAY_KEYS) {
    const value = getLocalizedString(TRAY_TEXT[key], langs);
    strings[key] = NAMED_TRAY_KEYS.has(key) ? value.replace('{name}', productName) : value;
  }
  return strings;
}

/**
 * Placeholder for JSON labels in assets/navigationBar.js. Injection through
 * executeJavaScript() has no query parameters, so loadAssets() substitutes it.
 */
export const NAV_LABELS_TOKEN = '__HYDRA_NAV_LABELS__';

/** Resolve the labels for the navigation row in Apple's sidebar. */
export function getNavigationStrings(): {
  settings: string;
  back: string;
  forward: string;
  reload: string;
} {
  const langs = getSystemLanguages();
  return {
    settings: getLocalizedString(SETTINGS_TEXT, langs),
    back: getLocalizedString(BACK_TEXT, langs),
    forward: getLocalizedString(FORWARD_TEXT, langs),
    reload: getLocalizedString(RELOAD_TEXT, langs),
  };
}

/** Resolve the About window text and metadata labels. */
export function getAboutStrings(): {
  description: string;
  close: string;
  versionPrefix: string;
} {
  const langs = getSystemLanguages();
  return {
    close: getLocalizedString(CLOSE_TEXT, langs),
    description: getLocalizedString(ABOUT_DESCRIPTION_TEXT, langs),
    versionPrefix: getLocalizedString(VERSION_PREFIX, langs),
  };
}

/**
 * Placeholder for JSON labels in assets/songSearch.js, substituted by
 * loadAssets() as NAV_LABELS_TOKEN is.
 */
export const SEARCH_LABELS_TOKEN = '__HYDRA_SEARCH_LABELS__';

/** Translations for the song search field, keyed by BCP 47 language tag. */
export const SEARCH_SONGS_TEXT: Record<string, string> = trayData.SEARCH_SONGS_TEXT;
/** Translations for searching, keyed by BCP 47 language tag. */
export const SEARCHING_TEXT: Record<string, string> = trayData.SEARCHING_TEXT;
/** Translations for no songs found, keyed by BCP 47 language tag. */
export const NO_SONGS_FOUND_TEXT: Record<string, string> = trayData.NO_SONGS_FOUND_TEXT;
/** Translations for search failed, keyed by BCP 47 language tag. */
export const SEARCH_FAILED_TEXT: Record<string, string> = trayData.SEARCH_FAILED_TEXT;
/** Translations for the link to Apple's full results, keyed by BCP 47 language tag. */
export const ALL_RESULTS_TEXT: Record<string, string> = trayData.ALL_RESULTS_TEXT;
/** Translations for the explicit badge, keyed by BCP 47 language tag. */
export const EXPLICIT_TEXT: Record<string, string> = trayData.EXPLICIT_TEXT;

/** Resolve the labels for the injected song search panel. */
export function getSearchStrings(): {
  search: string;
  searching: string;
  noResults: string;
  failed: string;
  allResults: string;
  explicit: string;
} {
  const langs = getSystemLanguages();
  return {
    search: getLocalizedString(SEARCH_SONGS_TEXT, langs),
    searching: getLocalizedString(SEARCHING_TEXT, langs),
    noResults: getLocalizedString(NO_SONGS_FOUND_TEXT, langs),
    failed: getLocalizedString(SEARCH_FAILED_TEXT, langs),
    allResults: getLocalizedString(ALL_RESULTS_TEXT, langs),
    explicit: getLocalizedString(EXPLICIT_TEXT, langs),
  };
}

/**
 * Placeholder for JSON labels in assets/topBar.js, substituted by loadAssets()
 * as NAV_LABELS_TOKEN is.
 */
export const TOP_BAR_LABELS_TOKEN = '__HYDRA_TOP_BAR_LABELS__';

/** Translations for the top bar's account button, keyed by BCP 47 language tag. */
export const ACCOUNT_TEXT: Record<string, string> = trayData.ACCOUNT_TEXT;
/** Translations for the account menu's sidebar item, keyed by BCP 47 language tag. */
export const SWITCH_TO_APPLE_SIDEBAR_TEXT: Record<string, string> = trayData.SWITCH_TO_APPLE_SIDEBAR_TEXT;
/** Translations for the account menu's sign-out item, keyed by BCP 47 language tag. */
export const SIGN_OUT_TEXT: Record<string, string> = trayData.SIGN_OUT_TEXT;

/** Resolve the labels for the injected top bar, which reuses translated records. */
export function getTopBarStrings(): {
  back: string;
  home: string;
  search: string;
  vibe: string;
  allPlaylists: string;
  settings: string;
  account: string;
  switchToSidebar: string;
  signOut: string;
} {
  const langs = getSystemLanguages();
  return {
    back: getLocalizedString(BACK_TEXT, langs),
    home: getLocalizedString(START_PAGE_HOME_TEXT, langs),
    search: getLocalizedString(START_PAGE_SEARCH_TEXT, langs),
    vibe: getLocalizedString(VIBE_TEXT.vibe, langs),
    allPlaylists: getLocalizedString(START_PAGE_ALL_PLAYLISTS_TEXT, langs),
    settings: getLocalizedString(SETTINGS_TEXT, langs),
    account: getLocalizedString(ACCOUNT_TEXT, langs),
    switchToSidebar: getLocalizedString(SWITCH_TO_APPLE_SIDEBAR_TEXT, langs),
    signOut: getLocalizedString(SIGN_OUT_TEXT, langs),
  };
}

/**
 * Placeholder for JSON labels in assets/vibe.js, substituted by loadAssets()
 * as NAV_LABELS_TOKEN is.
 */
export const VIBE_LABELS_TOKEN = '__HYDRA_VIBE_LABELS__';

/** Labels for the injected Vibe panel. */
export interface VibeStrings {
  vibe: string;
  placeholder: string;
  playNext: string;
  replaceQueue: string;
  submit: string;
  cancel: string;
  working: string;
  openSettings: string;
  queuedNext: string;
  queuedReplace: string;
  queueFailed: string;
  explicit: string;
  errors: Record<VibeErrorCode, string>;
}

// Vibe ships in English for now. These tables are not exported, so the
// consistency test does not ask for every language; a translation added here
// is picked up through getLocalizedString() with no other change.
const VIBE_TEXT: Record<Exclude<keyof VibeStrings, 'errors' | 'explicit'>, Record<string, string>> = {
  vibe: { en: 'Vibe' },
  placeholder: { en: 'Describe a mood, a moment or a vibe' },
  playNext: { en: 'Play next' },
  replaceQueue: { en: 'Replace queue' },
  submit: { en: 'Find songs' },
  cancel: { en: 'Cancel' },
  working: { en: 'Finding songs… {count} of {max} searches' },
  openSettings: { en: 'Open Settings' },
  queuedNext: { en: 'Added to play next' },
  queuedReplace: { en: 'Now playing' },
  queueFailed: { en: 'The songs could not be queued. Try again.' },
};

const VIBE_ERROR_TEXT: Record<VibeErrorCode, Record<string, string>> = {
  'no-key': { en: 'Add your Anthropic API key in Settings to use Vibe.' },
  // Chromium keeps a failed keyring lookup for the rest of the run, so
  // unlocking alone is not enough: see src/integrations/vibe/apiKey.ts.
  'key-locked': { en: 'Keyring locked: unlock it and restart Hydra, then retry.' },
  'key-unreadable': { en: 'The saved API key cannot be read with this keyring. Save it again in Settings.' },
  'key-refused': { en: 'Anthropic refused the API key. Check it in Settings.' },
  'rate-limit': { en: "Anthropic's rate limit was reached. Try again in a minute." },
  unavailable: { en: 'Claude is busy or did not answer in time. Try again shortly.' },
  network: { en: 'Hydra could not reach Anthropic. Check your connection.' },
  refusal: { en: 'Claude declined this request. Try describing it differently.' },
  'nothing-found': { en: 'No matching songs were found on Apple Music. Try another description.' },
  incomplete: { en: 'Claude did not finish choosing songs. Try again.' },
  catalog: { en: 'Apple Music search is not available right now. Try again shortly.' },
  busy: { en: 'A Vibe request is already running.' },
  cooldown: { en: 'Wait a few seconds before the next request.' },
  'daily-limit': { en: "Today's Vibe limit is reached. It resets at midnight." },
  cancelled: { en: 'Cancelled.' },
  failed: { en: 'Something went wrong. Try again.' },
};

/** Resolve the labels for the injected Vibe panel. */
export function getVibeStrings(): VibeStrings {
  const langs = getSystemLanguages();
  const errors = {} as Record<VibeErrorCode, string>;
  for (const code of Object.keys(VIBE_ERROR_TEXT) as VibeErrorCode[]) {
    errors[code] = getLocalizedString(VIBE_ERROR_TEXT[code], langs);
  }
  const strings = { errors, explicit: getLocalizedString(EXPLICIT_TEXT, langs) } as VibeStrings;
  for (const key of Object.keys(VIBE_TEXT) as (keyof typeof VIBE_TEXT)[]) {
    strings[key] = getLocalizedString(VIBE_TEXT[key], langs);
  }
  return strings;
}
