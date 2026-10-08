/**
 * Checks for what Vibe reads back from the page. The search results and the
 * recently played list come from assets/vibe.js in Apple's page, where any
 * script could have replaced the functions, so nothing is trusted: every field
 * is re-checked and cut to size before it reaches Claude or the panel.
 */

/** A catalogue song that a search returned. */
export interface CatalogSong {
  id: string;
  title: string;
  artist: string;
  album: string;
  explicit: boolean;
  /** An https artwork URL on Apple's image host, or "". */
  artwork: string;
}

/** A song the user listened to, as Claude sees it: artist and title only. */
export interface ListenedTrack {
  artist: string;
  title: string;
}

/** The most results Vibe reads back from one search. */
export const MAX_SEARCH_RESULTS = 3;
/** The most recently played songs sent with a request. */
export const MAX_RECENT_TRACKS = 20;
/** The longest name, title or reason kept. */
const MAX_TEXT_LENGTH = 200;
/**
 * Entries read from one answer. The page answers with at most 3 songs and 20
 * tracks, so anything longer did not come from assets/vibe.js and is not
 * walked to its end.
 */
const MAX_ENTRIES_READ = 50;
/** The longest artwork URL kept. */
const MAX_URL_LENGTH = 2048;

/** Catalogue song ids are digits only, as __hydraPlaySongs requires. */
const SONG_ID = /^\d{1,20}$/;
// C0 and C1 controls and the bidirectional overrides, which could reorder or
// hide text in the panel.
const UNSAFE_TEXT =
  /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu;

/**
 * A single-line string with unsafe characters removed and cut to size, or "".
 * The input is cut first, to a few times the size kept, so a huge string from
 * the page costs no more than a short one.
 */
export function cleanText(value: unknown, max = MAX_TEXT_LENGTH): string {
  if (typeof value !== "string") return "";
  return value
    .slice(0, max * 4)
    .replace(UNSAFE_TEXT, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/** The URL when it is https on Apple's image host, else "". */
function artworkUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > MAX_URL_LENGTH) return "";
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.endsWith(".mzstatic.com")
      ? url.href
      : "";
  } catch {
    return "";
  }
}

/** The valid songs in a search answer from the page, at most MAX_SEARCH_RESULTS. */
export function parseCatalogSongs(value: unknown): CatalogSong[] {
  if (!Array.isArray(value)) return [];
  const songs: CatalogSong[] = [];
  for (const item of value.slice(0, MAX_ENTRIES_READ)) {
    if (songs.length >= MAX_SEARCH_RESULTS) break;
    if (typeof item !== "object" || item === null) continue;
    const entry = item as Record<string, unknown>;
    const title = cleanText(entry.title);
    if (typeof entry.id !== "string" || !SONG_ID.test(entry.id) || !title) continue;
    songs.push({
      id: entry.id,
      title,
      artist: cleanText(entry.artist),
      album: cleanText(entry.album),
      explicit: entry.explicit === true,
      artwork: artworkUrl(entry.artwork),
    });
  }
  return songs;
}

/** The valid tracks in a recently played answer from the page, newest first. */
export function parseListenedTracks(value: unknown): ListenedTrack[] {
  if (!Array.isArray(value)) return [];
  const tracks: ListenedTrack[] = [];
  for (const item of value.slice(0, MAX_ENTRIES_READ)) {
    if (tracks.length >= MAX_RECENT_TRACKS) break;
    if (typeof item !== "object" || item === null) continue;
    const entry = item as Record<string, unknown>;
    const title = cleanText(entry.title);
    if (title) tracks.push({ artist: cleanText(entry.artist), title });
  }
  return tracks;
}
