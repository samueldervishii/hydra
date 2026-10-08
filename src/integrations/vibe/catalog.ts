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

/** Catalogue song ids are digits only, as __hydraPlaySongs requires. */
const SONG_ID = /^\d{1,20}$/;
// C0 and C1 controls and the bidirectional overrides, which could reorder or
// hide text in the panel.
const UNSAFE_TEXT =
  /[\u0000-\u001f\u007f-\u009f؜‎‏‪-‮⁦-⁩]/gu;

/** A single-line string with unsafe characters removed and cut to size, or "". */
export function cleanText(value: unknown, max = MAX_TEXT_LENGTH): string {
  if (typeof value !== "string") return "";
  return value.replace(UNSAFE_TEXT, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

/** The URL when it is https on Apple's image host, else "". */
function artworkUrl(value: unknown): string {
  if (typeof value !== "string") return "";
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
  for (const item of value) {
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
  for (const item of value) {
    if (tracks.length >= MAX_RECENT_TRACKS) break;
    if (typeof item !== "object" || item === null) continue;
    const entry = item as Record<string, unknown>;
    const title = cleanText(entry.title);
    if (title) tracks.push({ artist: cleanText(entry.artist), title });
  }
  return tracks;
}
