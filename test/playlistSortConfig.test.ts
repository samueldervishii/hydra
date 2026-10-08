// The main-process side of the playlist sort: the message check and the
// remembered map. Ids here are made up; none comes from a real library.
import { beforeEach, describe, expect, it } from "vitest";
import { Conf } from "electron-conf/main";

import {
  getPlaylistSorts,
  MAX_PLAYLIST_SORTS,
  setPlaylistSort,
} from "../src/config";
import { parsePlaylistSortMessage } from "../src/playlistSort";

const store = (Conf as unknown as { _data: Map<string, unknown> })._data;

beforeEach(() => store.clear());

describe("parsePlaylistSortMessage", () => {
  it("accepts a library or catalogue id with a valid sort", () => {
    expect(parsePlaylistSortMessage({ id: "p.Abc123", by: "title", dir: "desc" })).toEqual({
      id: "p.Abc123",
      sort: { by: "title", dir: "desc" },
    });
    expect(parsePlaylistSortMessage({ id: "pl.u-Xy_9.z", by: "duration", dir: "asc" })?.sort).toEqual({
      by: "duration",
      dir: "asc",
    });
  });

  it("reads playlist order ascending as going back to the default", () => {
    expect(parsePlaylistSortMessage({ id: "p.Abc123", by: "playlist", dir: "asc" })).toEqual({
      id: "p.Abc123",
      sort: null,
    });
    expect(parsePlaylistSortMessage({ id: "p.Abc123", by: "playlist", dir: "desc" })?.sort).toEqual({
      by: "playlist",
      dir: "desc",
    });
  });

  it.each([
    ["no payload", null],
    ["an array", []],
    ["an unknown field", { id: "p.Abc123", by: "dateAdded", dir: "asc" }],
    ["an unknown direction", { id: "p.Abc123", by: "title", dir: "up" }],
    ["an extra key", { id: "p.Abc123", by: "title", dir: "asc", extra: 1 }],
    ["a missing key", { id: "p.Abc123", by: "title" }],
    ["an album id", { id: "1440857781", by: "title", dir: "asc" }],
    ["a path in the id", { id: "p.abc/../x", by: "title", dir: "asc" }],
    ["an overlong id", { id: "p." + "a".repeat(101), by: "title", dir: "asc" }],
    ["a non-string id", { id: 5, by: "title", dir: "asc" }],
  ])("refuses %s", (_label, data) => {
    expect(parsePlaylistSortMessage(data)).toBeNull();
  });
});

describe("remembered playlist sorts", () => {
  it("stores a sort, and removes it on going back to playlist order", () => {
    setPlaylistSort("p.One", { by: "artist", dir: "asc" });
    setPlaylistSort("pl.Two", { by: "duration", dir: "desc" });
    expect(getPlaylistSorts()).toEqual({
      "p.One": { by: "artist", dir: "asc" },
      "pl.Two": { by: "duration", dir: "desc" },
    });
    setPlaylistSort("p.One", null);
    expect(getPlaylistSorts()).toEqual({ "pl.Two": { by: "duration", dir: "desc" } });
  });

  it("drops what a hand-edited file holds that is not a sort", () => {
    store.set("playlistSorts", {
      "p.Good": { by: "title", dir: "asc" },
      "p.Default": { by: "playlist", dir: "asc" },
      "p.BadField": { by: "dateAdded", dir: "asc" },
      "not an id": { by: "title", dir: "asc" },
      "p.NotAnObject": "title",
    });
    expect(getPlaylistSorts()).toEqual({ "p.Good": { by: "title", dir: "asc" } });
    store.set("playlistSorts", ["p.Good"]);
    expect(getPlaylistSorts()).toEqual({});
  });

  it(`keeps the ${MAX_PLAYLIST_SORTS} most recently changed`, () => {
    for (let i = 0; i < MAX_PLAYLIST_SORTS + 5; i += 1) {
      setPlaylistSort(`p.List${i}`, { by: "title", dir: "asc" });
    }
    // Changing an old one moves it to the newest end.
    setPlaylistSort("p.List5", { by: "album", dir: "desc" });
    setPlaylistSort("p.New", { by: "title", dir: "asc" });
    const ids = Object.keys(getPlaylistSorts());
    expect(ids).toHaveLength(MAX_PLAYLIST_SORTS);
    expect(ids).not.toContain("p.List6");
    expect(ids.slice(-2)).toEqual(["p.List5", "p.New"]);
  });
});
