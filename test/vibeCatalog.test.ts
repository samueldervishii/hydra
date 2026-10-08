import { describe, expect, it } from "vitest";

import {
  cleanText,
  parseCatalogSongs,
  parseListenedTracks,
} from "../src/integrations/vibe/catalog";

describe("parseCatalogSongs", () => {
  it("keeps only well-formed songs, at most three, with every field re-checked", () => {
    const songs = parseCatalogSongs([
      { id: "111", title: " Song\u0000 A ", artist: "Artist", album: "Album", explicit: true, artwork: "https://is1-ssl.mzstatic.com/a/80x80bb.jpg" },
      { id: "12a", title: "Not a catalogue id" },
      { id: "222", title: "" },
      null,
      { id: "333", title: "Song C", artwork: "https://evil.example/a.jpg", explicit: "yes" },
      { id: "444", title: "Song D", artwork: "http://is1.mzstatic.com/a.jpg" },
      { id: "555", title: "One too many" },
    ]);
    expect(songs).toEqual([
      { id: "111", title: "Song A", artist: "Artist", album: "Album", explicit: true, artwork: "https://is1-ssl.mzstatic.com/a/80x80bb.jpg" },
      { id: "333", title: "Song C", artist: "", album: "", explicit: false, artwork: "" },
      { id: "444", title: "Song D", artist: "", album: "", explicit: false, artwork: "" },
    ]);
  });

  it("answers nothing for a value that is not a list", () => {
    expect(parseCatalogSongs(undefined)).toEqual([]);
    expect(parseCatalogSongs({ id: "111", title: "x" })).toEqual([]);
  });
});

describe("bounds on what the page sends back", () => {
  it("reads no further than the first 50 entries of an answer", () => {
    const junk = Array.from({ length: 1_000_000 }, () => null);
    const started = performance.now();
    expect(parseCatalogSongs([...junk.slice(0, 60), { id: "1", title: "Late" }])).toEqual([]);
    expect(parseListenedTracks(junk)).toEqual([]);
    expect(performance.now() - started).toBeLessThan(200);
  });

  it("cuts a huge string before cleaning it, and drops an oversized artwork URL", () => {
    const huge = "\u0000".repeat(30_000_000) + "tail";
    const started = performance.now();
    expect(cleanText(huge)).toBe("");
    expect(performance.now() - started).toBeLessThan(50);
    const longUrl = "https://is1.mzstatic.com/" + "a".repeat(3000);
    expect(parseCatalogSongs([{ id: "1", title: "T", artwork: longUrl }])[0].artwork).toBe("");
  });

  it("checks ids and artwork hosts by parsing, not by pattern", () => {
    const songs = parseCatalogSongs([
      { id: "1", title: "A", artwork: "https://evil.example?.mzstatic.com/a.jpg" },
      { id: "2", title: "B", artwork: "https://evil.example#.mzstatic.com/a.jpg" },
      { id: "3", title: "C", artwork: "https://mzstatic.com.evil.example/a.jpg" },
      { id: "1 OR 1=1", title: "D" },
      { id: "1".repeat(21), title: "E" },
    ]);
    expect(songs.map((song) => [song.id, song.artwork])).toEqual([["1", ""], ["2", ""], ["3", ""]]);
  });
});

describe("parseListenedTracks", () => {
  it("keeps titled tracks, at most twenty", () => {
    const many = Array.from({ length: 25 }, (_, i) => ({ artist: "A", title: `T${i}` }));
    expect(parseListenedTracks([{ artist: "A" }, ...many])).toHaveLength(20);
    expect(parseListenedTracks([{ artist: 5, title: "T" }])).toEqual([{ artist: "", title: "T" }]);
    expect(parseListenedTracks("nope")).toEqual([]);
  });
});

describe("cleanText", () => {
  it("removes controls and bidirectional overrides, folds spacing and cuts to size", () => {
    expect(cleanText("a\u202eb\n\tc")).toBe("a b c");
    expect(cleanText("x".repeat(300))).toHaveLength(200);
    expect(cleanText("abcdef", 3)).toBe("abc");
    expect(cleanText(42)).toBe("");
  });
});
