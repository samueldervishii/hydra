import { beforeEach, describe, expect, it, vi } from "vitest";
import { Conf } from "electron-conf/main";
import type { BrowserWindow } from "electron";

import { FakePlayer } from "./mocks/player";
import { quit } from "./mocks/appLifecycle";
import type { VibeRunOptions } from "../src/integrations/vibe/agent";

vi.mock("../src/integrations/vibe/agent", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/integrations/vibe/agent")>()),
  runVibe: vi.fn(),
}));

const store = (Conf as unknown as { _data: Map<string, unknown> })._data;
const KEY = "sk-ant-api03-" + "b".repeat(40);
const PICK = {
  id: "111",
  title: "Song A",
  artist: "Artist A",
  album: "Album A",
  explicit: false,
  artwork: "",
  reason: "Fits",
};

interface Harness {
  vibe: typeof import("../src/integrations/vibe");
  agent: typeof import("../src/integrations/vibe/agent");
  keys: typeof import("../src/integrations/vibe/apiKey");
  player: FakePlayer;
  executeJavaScript: ReturnType<typeof vi.fn>;
  /** The states the panel was told, in order. */
  updates: () => unknown[];
}

/** Load fresh copies of the module and its state, wired to a stand-in window. */
async function load(page: { recent?: () => unknown; search?: (artist: string, title: string) => unknown } = {}): Promise<Harness> {
  vi.resetModules();
  const vibe = await import("../src/integrations/vibe");
  const agent = await import("../src/integrations/vibe/agent");
  const keys = await import("../src/integrations/vibe/apiKey");
  const executeJavaScript = vi.fn(async (script: string) => {
    if (script.includes("__hydraVibe.recent()")) return page.recent ? page.recent() : [];
    const search = /__hydraVibe\.search\((.*), (.*)\)$/.exec(script);
    if (search && page.search) return page.search(JSON.parse(search[1]), JSON.parse(search[2]));
    return undefined;
  });
  const win = {
    isDestroyed: () => false,
    webContents: { isDestroyed: () => false, executeJavaScript },
  } as unknown as BrowserWindow;
  const player = new FakePlayer();
  vibe.init({ player, getMainWindow: () => win });
  const updates = () =>
    executeJavaScript.mock.calls
      .map(([script]) => /__hydraVibe\.update\((.*)\)$/.exec(script as string))
      .filter((match): match is RegExpExecArray => match !== null)
      .map((match) => JSON.parse(match[1]));
  return { vibe, agent, keys, player, executeJavaScript, updates };
}

/** Let the request's promise chain settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
});

describe("Vibe requests", () => {
  it("rejects malformed requests", async () => {
    const { vibe } = await load();
    expect(vibe.parseRequest(null)).toBeNull();
    expect(vibe.parseRequest({ prompt: "x", mode: "later" })).toBeNull();
    expect(vibe.parseRequest({ prompt: "   ", mode: "next" })).toBeNull();
    expect(vibe.parseRequest({ prompt: 5, mode: "next" })).toBeNull();
    expect(vibe.parseRequest({ prompt: " chill\nmix ", mode: "replace" })).toEqual({
      prompt: "chill mix",
      mode: "replace",
    });
    expect(vibe.parseRequest({ prompt: "y".repeat(900), mode: "next" })?.prompt).toHaveLength(500);
  });

  it("asks for a key before anything else", async () => {
    const h = await load();
    h.vibe.handleRequest({ prompt: "chill", mode: "next" });
    await settle();
    expect(h.agent.runVibe).not.toHaveBeenCalled();
    expect(h.updates()).toEqual([{ status: "error", code: "no-key" }]);
  });

  it("runs a request with the context and tells the panel how it went", async () => {
    const h = await load({
      recent: () => [{ artist: "Artist R", title: "Recent" }],
      search: () => [{ id: "111", title: "Song A", artist: "Artist A", album: "Album A" }, { id: "bad", title: "x" }],
    });
    h.keys.saveApiKey(KEY);
    store.set("vibe.model", "claude-sonnet-5-5");
    h.player.emit("nowPlayingItemDidChange", { name: "Current", artistName: "Artist C" });
    let seen: VibeRunOptions | undefined;
    vi.mocked(h.agent.runVibe).mockImplementation(async (options) => {
      seen = options;
      const found = await options.search("Artist A", "Song \"A\"");
      expect(found).toEqual([
        { id: "111", title: "Song A", artist: "Artist A", album: "Album A", explicit: false, artwork: "" },
      ]);
      options.onProgress?.(1);
      return [PICK];
    });

    h.vibe.handleRequest({ prompt: "late night drive", mode: "replace" });
    await settle();

    expect(seen?.model).toBe("claude-sonnet-5-5");
    expect(seen?.prompt).toBe("late night drive");
    expect(seen?.context).toEqual({
      nowPlaying: { artist: "Artist C", title: "Current" },
      recent: [{ artist: "Artist R", title: "Recent" }],
    });
    // Search arguments reach the page JSON-encoded, never spliced in raw.
    expect(h.executeJavaScript).toHaveBeenCalledWith(
      'window.__hydraVibe.search("Artist A", "Song \\"A\\"")',
    );
    expect(h.updates()).toEqual([
      { status: "working", searches: 0, maxSearches: 15 },
      { status: "working", searches: 1, maxSearches: 15 },
      { status: "done", mode: "replace", picks: [PICK] },
    ]);
    expect(store.get("vibe.usage")).toEqual({ day: h.vibe.localDay(), count: 1 });
  });

  it("falls back to this session's songs when Apple's list is unavailable", async () => {
    const h = await load({
      recent: () => {
        throw new Error("signed out");
      },
    });
    h.keys.saveApiKey(KEY);
    for (const name of ["One", "Two", "Two", "Three"]) {
      h.player.emit("nowPlayingItemDidChange", { name, artistName: "Band" });
    }
    vi.mocked(h.agent.runVibe).mockResolvedValue([PICK]);
    h.vibe.handleRequest({ prompt: "more", mode: "next" });
    await settle();
    expect(vi.mocked(h.agent.runVibe).mock.calls[0][0].context).toEqual({
      nowPlaying: { artist: "Band", title: "Three" },
      recent: [
        { artist: "Band", title: "Two" },
        { artist: "Band", title: "One" },
      ],
    });
  });

  it("runs one request at a time, then waits out the cooldown", async () => {
    const h = await load();
    h.keys.saveApiKey(KEY);
    let finish!: (value: typeof PICK[]) => void;
    vi.mocked(h.agent.runVibe).mockImplementation(
      () => new Promise((resolve) => (finish = resolve)),
    );
    h.vibe.handleRequest({ prompt: "first", mode: "next" });
    await settle();
    h.vibe.handleRequest({ prompt: "second", mode: "next" });
    expect(h.updates().at(-1)).toEqual({ status: "error", code: "busy" });
    finish([PICK]);
    await settle();

    expect(h.vibe.blockedReason()).toBe("cooldown");
    expect(h.vibe.blockedReason(Date.now() + h.vibe.COOLDOWN_MS + 1)).toBeNull();
    expect(h.agent.runVibe).toHaveBeenCalledOnce();
  });

  it("stops at the daily cap, which the config can lower", async () => {
    const h = await load();
    h.keys.saveApiKey(KEY);
    store.set("vibe.usage", { day: h.vibe.localDay(), count: 50 });
    expect(h.vibe.blockedReason()).toBe("daily-limit");
    store.set("vibe.dailyLimit", 60);
    expect(h.vibe.blockedReason()).toBeNull();
    // Yesterday's count does not carry over.
    store.set("vibe.dailyLimit", 2);
    store.set("vibe.usage", { day: "2000-01-01", count: 99 });
    expect(h.vibe.blockedReason()).toBeNull();
    expect(h.vibe.getStatus()).toEqual({ hasKey: true, keyPersisted: true, usedToday: 0, dailyLimit: 2 });
    // A hand-edited limit outside 1 to 1000 reads as the default.
    store.set("vibe.dailyLimit", 0);
    expect(h.vibe.getStatus().dailyLimit).toBe(50);
  });

  it("reports the run's error code and nothing else", async () => {
    const h = await load();
    h.keys.saveApiKey(KEY);
    const { VibeError } = h.agent;
    vi.mocked(h.agent.runVibe).mockRejectedValueOnce(new VibeError("rate-limit"));
    h.vibe.handleRequest({ prompt: "a", mode: "next" });
    await settle();
    expect(h.updates().at(-1)).toEqual({ status: "error", code: "rate-limit" });

    // An unexpected error reaches the panel and the log as a fixed code only.
    vi.mocked(h.agent.runVibe).mockRejectedValueOnce(new Error("secret detail"));
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + h.vibe.COOLDOWN_MS + 1);
    h.vibe.handleRequest({ prompt: "b", mode: "next" });
    await settle();
    vi.mocked(Date.now).mockRestore();
    expect(h.updates().at(-1)).toEqual({ status: "error", code: "failed" });
    expect(JSON.stringify(h.executeJavaScript.mock.calls)).not.toContain("secret detail");
  });

  it("cancels the running request, and on quit stops listening", async () => {
    const h = await load();
    h.keys.saveApiKey(KEY);
    let signal: AbortSignal | undefined;
    vi.mocked(h.agent.runVibe).mockImplementation(
      (options) =>
        new Promise((_, reject) => {
          signal = options.signal;
          options.signal.addEventListener("abort", () => reject(new h.agent.VibeError("cancelled")));
        }),
    );
    h.vibe.handleRequest({ prompt: "a", mode: "next" });
    await settle();
    h.vibe.cancel();
    await settle();
    expect(signal?.aborted).toBe(true);
    expect(h.updates().at(-1)).toEqual({ status: "error", code: "cancelled" });

    expect(h.player.listenerCount("nowPlayingItemDidChange")).toBe(1);
    quit();
    expect(h.player.listenerCount("nowPlayingItemDidChange")).toBe(0);
  });
});
