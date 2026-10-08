/**
 * The main-process side of the playlist sort (assets/playlistSort.js): the
 * page sends the sort chosen for a playlist on playlist:sort, and this checks
 * it before src/config.ts remembers it. Any script in Apple's page can send
 * the channel, so nothing in the message is trusted.
 */
import {
  isPlaylistSort,
  PLAYLIST_ID_FORMAT,
  type PlaylistSort,
} from "./config";

/** A checked playlist:sort message: null for the default, playlist order. */
export interface PlaylistSortChange {
  id: string;
  sort: PlaylistSort | null;
}

/** The change in a playlist:sort payload, or null when it is malformed. */
export function parsePlaylistSortMessage(data: unknown): PlaylistSortChange | null {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  const entry = data as Record<string, unknown>;
  const keys = Object.keys(entry).sort();
  if (keys.join(",") !== "by,dir,id") return null;
  if (typeof entry.id !== "string" || !PLAYLIST_ID_FORMAT.test(entry.id)) return null;
  const sort = { by: entry.by, dir: entry.dir };
  if (sort.by === "playlist" && sort.dir === "asc") return { id: entry.id, sort: null };
  return isPlaylistSort(sort) ? { id: entry.id, sort } : null;
}
