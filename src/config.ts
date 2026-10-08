/**
 * Typed access to persistent state through electron-conf. Defaults belong to
 * getters so an absent storefront still triggers the system-region fallback.
 */
import { Conf } from 'electron-conf/main';
import log from 'electron-log/main';
import type { ThemeName } from './theme';
import type { WindowState } from './windowState';
import {
  DEFAULT_SERVICE_ID,
  isMusicServiceId,
  type AnyStartPageId,
  type ClassicalStartPageId,
  type MusicServiceId,
  type MusicStartPageId,
} from './musicService';

const configLog = log.scope('config');

/**
 * A play Last.fm has not accepted yet, held until a retry reaches it. The
 * fields are the track.scrobble parameters of the same names.
 */
export interface PendingScrobble {
  artist: string;
  track: string;
  timestamp: number;
  album?: string;
  durationSec?: number;
  chosenByUser?: 0;
}

/** How Hydra navigates Apple Music: its own top bar, or Apple's sidebar. */
export type NavigationMode = 'top-bar' | 'apple-sidebar';

/** The Claude models Vibe can ask, the first being the default. */
export const VIBE_MODELS = ['claude-haiku-5-5', 'claude-sonnet-5-5'] as const;
/** A model Vibe can ask. */
export type VibeModel = (typeof VIBE_MODELS)[number];

/** What Vibe spent on one local day, in US dollars, keyed by that day as YYYY-MM-DD. */
export interface VibeSpend {
  day: string;
  usd: number;
}

/** What a playlist page can be sorted by; 'playlist' is the playlist's own order. */
export const PLAYLIST_SORT_KEYS = ['playlist', 'title', 'artist', 'album', 'duration'] as const;
/** A playlist sort field. */
export type PlaylistSortKey = (typeof PLAYLIST_SORT_KEYS)[number];
/** A playlist's chosen sort. Playlist order ascending is the default and is never stored. */
export interface PlaylistSort {
  by: PlaylistSortKey;
  dir: 'asc' | 'desc';
}
/** Playlists whose sort is remembered; the least recently changed is forgotten first. */
export const MAX_PLAYLIST_SORTS = 500;
/** A library (p.) or catalogue (pl.) playlist id, as the page's route carries it. */
export const PLAYLIST_ID_FORMAT = /^(?:p|pl)\.[A-Za-z0-9._-]{1,100}$/;

/** Vibe's daily budget in US dollars when `vibe.dailyBudget` is absent or invalid. */
export const DEFAULT_VIBE_DAILY_BUDGET = 2;
/** The lowest and highest daily budget accepted, so a typo cannot lift the cap far. */
export const MIN_VIBE_DAILY_BUDGET = 0.1;
export const MAX_VIBE_DAILY_BUDGET = 100;

interface StoreSchema {
  storefront: string;
  language: string | null;
  'closeToTray.enabled': boolean;
  theme: ThemeName;
  'performanceMode.enabled': boolean;
  navigation: NavigationMode;
  startPage: MusicStartPageId | 'last';
  lastPageUrl: string;
  'classical.startPage': ClassicalStartPageId | 'last';
  'classical.lastPageUrl': string;
  zoomFactor: number;
  musicService: MusicServiceId;
  windowState: WindowState;
  'lastfm.enabled': boolean;
  'lastfm.username': string | null;
  'lastfm.session': string | null;
  'lastfm.pendingScrobbles': PendingScrobble[];
  'vibe.enabled': boolean;
  'vibe.apiKey': string | null;
  'vibe.model': VibeModel;
  'vibe.dailyBudget': number;
  'vibe.spend': VibeSpend;
  playlistSorts: Record<string, PlaylistSort>;
}

const store = new Conf<StoreSchema>();

/** Reads a key, or the caller's default when the user has never set it. */
function getConfigValue<K extends keyof StoreSchema>(key: K, defaultValue: StoreSchema[K]): StoreSchema[K] {
  if (!store.has(key)) return defaultValue;
  return store.get(key);
}

/**
 * Reads a key and returns undefined when it has never been set, for the keys
 * where absence means something: an unset storefront defers to the system
 * locale, while a stored null is the user's own choice.
 */
function getConfigValueOptional<K extends keyof StoreSchema>(key: K): StoreSchema[K] | undefined {
  if (!store.has(key)) return undefined;
  return store.get(key);
}

/**
 * Writes a key and logs it. The message is derived from the typed key, so a
 * rename cannot leave a stale key name in the log text.
 */
function setConfigValue<K extends keyof StoreSchema>(key: K, value: StoreSchema[K]): void {
  store.set(key, value);
  configLog.info(`${key} set:`, value);
}

/** Read `storefront`, returning undefined when the key is absent. */
export function getStorefront(): string | undefined {
  return getConfigValueOptional('storefront');
}

/** Persist `storefront` without applying the setting to running components. */
export function setStorefront(code: string): void {
  setConfigValue('storefront', code);
}

/** Read `language`, returning undefined when the key is absent. */
export function getLanguage(): string | null | undefined {
  return getConfigValueOptional('language');
}

/** Persist `language` without applying the setting to running components. */
export function setLanguage(lang: string | null): void {
  setConfigValue('language', lang);
}

/** Read `closeToTray.enabled`, defaulting to `false` when absent. */
export function getCloseToTrayEnabled(): boolean {
  return getConfigValue('closeToTray.enabled', false);
}

/** Persist `closeToTray.enabled` without applying the setting to running components. */
export function setCloseToTrayEnabled(enabled: boolean): void {
  setConfigValue('closeToTray.enabled', enabled);
}

/**
 * Read `windowState`, returning undefined when the key is absent. The file can
 * be edited by hand, so `restoreWindowBounds()` checks the value before use.
 */
export function getWindowState(): WindowState | undefined {
  return getConfigValueOptional('windowState');
}

/** Persist `windowState` without applying the setting to running components. */
export function setWindowState(state: WindowState): void {
  setConfigValue('windowState', state);
}

/** Read `lastfm.enabled`, defaulting to `false` when absent. */
export function getLastfmEnabled(): boolean {
  return getConfigValue('lastfm.enabled', false);
}

/** Persist `lastfm.enabled` without applying the setting to running components. */
export function setLastfmEnabled(enabled: boolean): void {
  setConfigValue('lastfm.enabled', enabled);
}

/** Read `lastfm.username`, the connected account's name, or null when none is connected. */
export function getLastfmUsername(): string | null {
  return getConfigValue('lastfm.username', null);
}

/**
 * Read `lastfm.session`: the session key encrypted by the system keyring, as
 * base64. src/integrations/lastfm/session.ts is the only reader and the only
 * place it is decrypted.
 */
export function getLastfmEncryptedSession(): string | null {
  return getConfigValue('lastfm.session', null);
}

/**
 * Store the connected account. `encryptedSession` is null when no keyring
 * could encrypt the key, which then lives in memory only; the username is not
 * a secret. Neither value is logged.
 */
export function setLastfmAccount(username: string, encryptedSession: string | null): void {
  store.set('lastfm.username', username);
  store.set('lastfm.session', encryptedSession);
  configLog.info(`lastfm account set, session ${encryptedSession ? 'encrypted' : 'in memory only'}`);
}

/** Forget the connected account without changing the enabled preference or pending queue. */
export function clearLastfmAccount(): void {
  store.set('lastfm.username', null);
  store.set('lastfm.session', null);
  configLog.info('lastfm account cleared');
}

/**
 * Delete `lastfm.sessionKey`, the plain-text session key Sidra kept and a
 * config migrated from it can still hold. It belonged to Sidra's API key, so
 * Last.fm would refuse it under Hydra's, and it should not stay on disk.
 */
export function removeLegacyLastfmSessionKey(): void {
  if (!store.has('lastfm.sessionKey')) return;
  store.delete('lastfm.sessionKey');
  configLog.info('lastfm.sessionKey removed: plain-text session from an earlier build');
}

function isPendingScrobble(value: unknown): value is PendingScrobble {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Partial<PendingScrobble>;
  return typeof entry.artist === 'string' && entry.artist.length > 0
    && typeof entry.track === 'string' && entry.track.length > 0
    && typeof entry.timestamp === 'number'
    && Number.isInteger(entry.timestamp) && entry.timestamp > 0
    && entry.timestamp <= Math.floor(Date.now() / 1000)
    && (entry.album === undefined || typeof entry.album === 'string')
    && (entry.durationSec === undefined
      || (typeof entry.durationSec === 'number'
        && Number.isInteger(entry.durationSec) && entry.durationSec > 0))
    && (entry.chosenByUser === undefined || entry.chosenByUser === 0);
}

/**
 * Read `lastfm.pendingScrobbles`. The file can be edited by hand, so entries
 * that are not plays Last.fm could accept are dropped.
 */
export function getPendingScrobbles(): PendingScrobble[] {
  const stored: unknown = getConfigValue('lastfm.pendingScrobbles', []);
  if (!Array.isArray(stored)) {
    configLog.warn('lastfm.pendingScrobbles is not an array - discarding');
    return [];
  }
  const entries = stored.filter(isPendingScrobble);
  if (entries.length !== stored.length) {
    // Never log the dropped entries: track titles are the user's listening history.
    configLog.warn('lastfm.pendingScrobbles dropped malformed entries:', stored.length - entries.length);
  }
  return entries;
}

/** Replace the pending queue and log its length, not its contents. */
export function setPendingScrobbles(entries: PendingScrobble[]): void {
  store.set('lastfm.pendingScrobbles', entries);
  configLog.info('lastfm.pendingScrobbles set, queued:', entries.length);
}

/** Read `vibe.enabled`, defaulting to `true`: Vibe shows unless switched off in Settings. */
export function getVibeEnabled(): boolean {
  return getConfigValue('vibe.enabled', true);
}

/** Persist `vibe.enabled` without applying the setting to running components. */
export function setVibeEnabled(enabled: boolean): void {
  setConfigValue('vibe.enabled', enabled);
}

/**
 * Read `vibe.apiKey`: the Anthropic API key encrypted by the system keyring,
 * as base64. src/integrations/vibe/apiKey.ts is the only reader and the only
 * place that decrypts it.
 */
export function getVibeEncryptedApiKey(): string | null {
  return getConfigValue('vibe.apiKey', null);
}

/**
 * Store the encrypted key, or with null delete the key from config.json
 * altogether. electron-conf rewrites the whole file through a temporary file
 * and a rename, so no earlier ciphertext is left behind. Never logs a value.
 */
export function setVibeEncryptedApiKey(encrypted: string | null): void {
  if (encrypted) store.set('vibe.apiKey', encrypted);
  else store.delete('vibe.apiKey');
  configLog.info(`vibe.apiKey ${encrypted ? 'stored encrypted' : 'absent from config'}`);
}

/** Read `vibe.model`, falling back to the default for an unknown id. */
export function getVibeModel(): VibeModel {
  const stored: unknown = getConfigValue('vibe.model', VIBE_MODELS[0]);
  return VIBE_MODELS.find((model) => model === stored) ?? VIBE_MODELS[0];
}

/** Persist `vibe.model`. */
export function setVibeModel(model: VibeModel): void {
  setConfigValue('vibe.model', model);
}

/** True when the value is a daily budget Settings accepts: whole cents from $0.10 to $100. */
export function isVibeDailyBudget(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
    && value >= MIN_VIBE_DAILY_BUDGET && value <= MAX_VIBE_DAILY_BUDGET
    && Math.abs(value * 100 - Math.round(value * 100)) < 1e-6;
}

/**
 * Read `vibe.dailyBudget`, what Vibe may spend per local day in US dollars.
 * The file can be edited by hand, so anything Settings would not accept reads
 * as the default of $2.
 */
export function getVibeDailyBudget(): number {
  const stored: unknown = getConfigValue('vibe.dailyBudget', DEFAULT_VIBE_DAILY_BUDGET);
  return isVibeDailyBudget(stored) ? stored : DEFAULT_VIBE_DAILY_BUDGET;
}

/** Persist `vibe.dailyBudget`. */
export function setVibeDailyBudget(usd: number): void {
  setConfigValue('vibe.dailyBudget', usd);
}

/** Read `vibe.spend`, or null when absent or malformed. */
export function getVibeSpend(): VibeSpend | null {
  const stored: unknown = getConfigValueOptional('vibe.spend');
  if (typeof stored !== 'object' || stored === null) return null;
  const spend = stored as Partial<VibeSpend>;
  return typeof spend.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(spend.day)
    && typeof spend.usd === 'number' && Number.isFinite(spend.usd) && spend.usd >= 0
    ? { day: spend.day, usd: spend.usd }
    : null;
}

/**
 * Persist `vibe.spend`. Not logged: it changes after every response, and
 * Vibe's own log line carries each turn's cost.
 */
export function setVibeSpend(spend: VibeSpend): void {
  store.set('vibe.spend', spend);
}

/**
 * Delete `vibe.dailyLimit` and `vibe.usage`, the request count 2.6 capped
 * Vibe by before the spend budget replaced it.
 */
export function removeLegacyVibeUsage(): void {
  for (const key of ['vibe.dailyLimit', 'vibe.usage']) {
    if (!store.has(key)) continue;
    store.delete(key);
    configLog.info(`${key} removed: replaced by vibe.dailyBudget`);
  }
}

/** True when the value is a stored playlist sort other than the default. */
export function isPlaylistSort(value: unknown): value is PlaylistSort {
  if (typeof value !== 'object' || value === null) return false;
  const sort = value as Partial<PlaylistSort>;
  return PLAYLIST_SORT_KEYS.some((key) => key === sort.by)
    && (sort.dir === 'asc' || sort.dir === 'desc')
    && !(sort.by === 'playlist' && sort.dir === 'asc');
}

/**
 * Read `playlistSorts`, the sort chosen per playlist id. The file can be
 * edited by hand, so malformed entries and ids are dropped, and no more than
 * MAX_PLAYLIST_SORTS are kept.
 */
export function getPlaylistSorts(): Record<string, PlaylistSort> {
  const stored: unknown = getConfigValue('playlistSorts', {});
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return {};
  const sorts: Record<string, PlaylistSort> = {};
  for (const [id, sort] of Object.entries(stored).slice(-MAX_PLAYLIST_SORTS)) {
    if (PLAYLIST_ID_FORMAT.test(id) && isPlaylistSort(sort)) sorts[id] = { by: sort.by, dir: sort.dir };
  }
  return sorts;
}

/**
 * Remember a playlist's sort, or with null go back to playlist order. A
 * changed entry moves to the end, so the oldest is the one dropped at the cap.
 * Logs the count only: playlist ids are the user's library.
 */
export function setPlaylistSort(id: string, sort: PlaylistSort | null): void {
  const sorts = getPlaylistSorts();
  delete sorts[id];
  if (sort) sorts[id] = { by: sort.by, dir: sort.dir };
  const kept = Object.fromEntries(Object.entries(sorts).slice(-MAX_PLAYLIST_SORTS));
  store.set('playlistSorts', kept);
  configLog.info('playlistSorts set, playlists:', Object.keys(kept).length);
}

/** Read `theme`, defaulting to `'apple-music'` when absent. */
export function getTheme(): ThemeName {
  return getConfigValue('theme', 'apple-music');
}

/** Persist `theme` without applying the setting to running components. */
export function setTheme(name: ThemeName): void {
  setConfigValue('theme', name);
}

/** Read `performanceMode.enabled`, defaulting to `true` when absent. */
export function getPerformanceModeEnabled(): boolean {
  return getConfigValue('performanceMode.enabled', true);
}

/** Persist `performanceMode.enabled` without applying the setting to running components. */
export function setPerformanceModeEnabled(enabled: boolean): void {
  setConfigValue('performanceMode.enabled', enabled);
}

/** Read `navigation`, defaulting to `'top-bar'` when absent. */
export function getNavigation(): NavigationMode {
  return getConfigValue('navigation', 'top-bar');
}

/** Persist `navigation` without applying the setting to running components. */
export function setNavigation(mode: NavigationMode): void {
  setConfigValue('navigation', mode);
}

/** Read `lastPageUrl`, returning undefined when the key is absent. */
export function getLastPageUrl(): string | undefined {
  return getConfigValueOptional('lastPageUrl');
}

/** Persist `lastPageUrl` without applying the setting to running components. */
export function setLastPageUrl(url: string): void {
  setConfigValue('lastPageUrl', url);
}

/** Read `startPage`, defaulting to `'new'` when absent. */
export function getStartPage(): MusicStartPageId | 'last' {
  return getConfigValue('startPage', 'new');
}

/** Persist `startPage` without applying the setting to running components. */
export function setStartPage(page: MusicStartPageId | 'last'): void {
  setConfigValue('startPage', page);
}

/** Read `zoomFactor`, defaulting to `1.0` when absent. */
export function getZoomFactor(): number {
  return getConfigValue('zoomFactor', 1.0);
}

/** Persist `zoomFactor` without applying the setting to running components. */
export function setZoomFactor(factor: number): void {
  setConfigValue('zoomFactor', factor);
}

/** Read the stored service, falling back to the default for an unregistered id. */
export function getMusicService(): MusicServiceId {
  const id = getConfigValue('musicService', DEFAULT_SERVICE_ID);
  if (!isMusicServiceId(id)) {
    configLog.warn('musicService not registered:', id, '- falling back to:', DEFAULT_SERVICE_ID);
    return DEFAULT_SERVICE_ID;
  }
  return id;
}

/** Persist `musicService` without applying the setting to running components. */
export function setMusicService(id: MusicServiceId): void {
  setConfigValue('musicService', id);
}

/** Read `classical.startPage`, defaulting to `'home'` when absent. */
export function getClassicalStartPage(): ClassicalStartPageId | 'last' {
  return getConfigValue('classical.startPage', 'home');
}

/** Persist `classical.startPage` without applying the setting to running components. */
export function setClassicalStartPage(page: ClassicalStartPageId | 'last'): void {
  setConfigValue('classical.startPage', page);
}

/** Read `classical.lastPageUrl`, returning undefined when the key is absent. */
export function getClassicalLastPageUrl(): string | undefined {
  return getConfigValueOptional('classical.lastPageUrl');
}

/** Persist `classical.lastPageUrl` without applying the setting to running components. */
export function setClassicalLastPageUrl(url: string): void {
  setConfigValue('classical.lastPageUrl', url);
}

/**
 * Map each service to its stored page accessors without branching at call sites.
 * The total Record requires an entry for every registered service.
 */
const SERVICE_PAGE_ACCESSORS: Record<MusicServiceId, {
  getStartPage: () => AnyStartPageId | 'last';
  getLastPageUrl: () => string | undefined;
  setLastPageUrl: (url: string) => void;
}> = {
  music: {
    getStartPage,
    getLastPageUrl,
    setLastPageUrl,
  },
  classical: {
    getStartPage: getClassicalStartPage,
    getLastPageUrl: getClassicalLastPageUrl,
    setLastPageUrl: setClassicalLastPageUrl,
  },
};

/**
 * Read a service's stored start page with a union that covers both services.
 * Resolve the result against that service's startPages and default.
 */
export function getStartPageFor(id: MusicServiceId): AnyStartPageId | 'last' {
  return SERVICE_PAGE_ACCESSORS[id].getStartPage();
}

/** Read the last page stored for the requested service. */
export function getLastPageUrlFor(id: MusicServiceId): string | undefined {
  return SERVICE_PAGE_ACCESSORS[id].getLastPageUrl();
}

/** Persist the last page under the requested service. */
export function setLastPageUrlFor(id: MusicServiceId, url: string): void {
  SERVICE_PAGE_ACCESSORS[id].setLastPageUrl(url);
}
