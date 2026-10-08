import vm from "node:vm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Conf } from "electron-conf/main";
import { safeStorage } from "electron";
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

describe("Vibe page calls", () => {
  const NASTY = [
    'a"b',
    "a'b",
    "`${globalThis.pwned()}`",
    "${globalThis.pwned()}",
    "</script><script>globalThis.pwned()</script>",
    '"); globalThis.pwned(); ("',
    "\\\"); globalThis.pwned(); //",
    "line\u2028separator\u2029paragraph",
    "\u0000nul",
  ];

  /** Run a generated call as the page would, with a canary any injection would trip. */
  function evaluate(script: string) {
    const calls: unknown[][] = [];
    const pwned = vi.fn();
    const window = {
      __hydraVibe: {
        search: (...args: unknown[]) => calls.push(args),
        update: (...args: unknown[]) => calls.push(args),
      },
    };
    vm.runInNewContext(script, { window, globalThis: { pwned } });
    return { calls, pwned };
  }

  it("passes artist and title through as exact strings, running nothing else", async () => {
    const { vibe } = await load();
    for (const artist of NASTY) {
      for (const title of NASTY) {
        const { calls, pwned } = evaluate(vibe.pageCall("search", artist, title));
        expect(calls).toEqual([[artist, title]]);
        expect(pwned).not.toHaveBeenCalled();
      }
    }
  });

  it("passes Claude's picks to the panel as data, whatever the reasons say", async () => {
    const { vibe } = await load();
    const state = {
      status: "done",
      mode: "next",
      picks: NASTY.map((reason, i) => ({ ...PICK, id: String(i), title: reason, reason })),
    };
    const { calls, pwned } = evaluate(vibe.pageCall("update", state));
    expect(calls).toEqual([[state]]);
    expect(pwned).not.toHaveBeenCalled();
  });
});

describe("Vibe SDK client", () => {
  const ENV = ["ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_LOG", "ANTHROPIC_API_KEY"] as const;
  const saved = Object.fromEntries(ENV.map((name) => [name, process.env[name]]));
  afterEach(() => {
    for (const name of ENV) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  });

  // Each of these would otherwise redirect the key, add a second credential,
  // or print request bodies (the description and history) to the console.
  it("ignores the environment: fixed endpoint, Hydra's key only, no logging, bounded waits", async () => {
    process.env.ANTHROPIC_BASE_URL = "https://collector.example";
    process.env.ANTHROPIC_AUTH_TOKEN = "env-token";
    process.env.ANTHROPIC_LOG = "debug";
    process.env.ANTHROPIC_API_KEY = "sk-ant-env-key";
    const { vibe } = await load();
    const client = vibe.createClient(KEY);
    expect(client.baseURL).toBe("https://api.anthropic.com");
    expect(client.apiKey).toBe(KEY);
    expect(client.authToken).toBeNull();
    expect(client.logLevel).toBe("off");
    expect(client.maxRetries).toBe(1);
    expect(client.timeout).toBe(60_000);
  });
});

describe("Vibe requests", () => {
  it("rejects malformed requests", async () => {
    const { vibe } = await load();
    expect(vibe.parseRequest(null)).toBeNull();
    expect(vibe.parseRequest([])).toBeNull();
    expect(vibe.parseRequest({ prompt: "x", mode: "later" })).toBeNull();
    expect(vibe.parseRequest({ prompt: "   ", mode: "next" })).toBeNull();
    expect(vibe.parseRequest({ prompt: 5, mode: "next" })).toBeNull();
    expect(vibe.parseRequest({ prompt: "x", mode: "next", model: "claude-opus-5-5" })).toBeNull();
    expect(vibe.parseRequest({ prompt: "x" })).toBeNull();
    expect(vibe.parseRequest({ prompt: " chill\nmix ", mode: "replace" })).toEqual({
      prompt: "chill mix",
      mode: "replace",
    });
  });

  // The panel limits the field, but a script in the page can send anything.
  it("refuses a description over 500 characters in main, before any work on it", async () => {
    const { vibe } = await load();
    expect(vibe.parseRequest({ prompt: "y".repeat(500), mode: "next" })?.prompt).toHaveLength(500);
    expect(vibe.parseRequest({ prompt: "y".repeat(501), mode: "next" })).toBeNull();
    const huge = " ".repeat(50_000_000) + "x";
    const started = performance.now();
    expect(vibe.parseRequest({ prompt: huge, mode: "next" })).toBeNull();
    expect(performance.now() - started).toBeLessThan(50);
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

  // A script in Apple's page can call vibe:request as often as it likes; the
  // limits live here, in main, so it gets one request and the rest refused.
  it("runs one request for a burst of calls from the page", async () => {
    const h = await load();
    h.keys.saveApiKey(KEY);
    let finish!: (value: typeof PICK[]) => void;
    vi.mocked(h.agent.runVibe).mockImplementation(
      () => new Promise((resolve) => (finish = resolve)),
    );
    for (let i = 0; i < 100; i += 1) h.vibe.handleRequest({ prompt: `p${i}`, mode: "next" });
    await settle();
    expect(h.agent.runVibe).toHaveBeenCalledOnce();
    expect(h.updates().filter((u) => (u as { code?: string }).code === "busy")).toHaveLength(99);
    finish([PICK]);
    await settle();
    for (let i = 0; i < 100; i += 1) h.vibe.handleRequest({ prompt: `q${i}`, mode: "next" });
    expect(h.agent.runVibe).toHaveBeenCalledOnce();
    expect(h.updates().at(-1)).toEqual({ status: "error", code: "cooldown" });
    expect(store.get("vibe.usage")).toEqual({ day: h.vibe.localDay(), count: 1 });
  });

  it("logs no description, history, pick or key, on success or failure", async () => {
    const h = await load({
      recent: () => [{ artist: "SENTINEL-ARTIST", title: "SENTINEL-TRACK" }],
      search: () => [{ id: "111", title: "SENTINEL-SONG", artist: "SENTINEL-ARTIST" }],
    });
    const log = (await import("electron-log/main")).default.scope("vibe");
    const consoleSpies = (["log", "info", "warn", "error", "debug"] as const).map((name) =>
      vi.spyOn(console, name).mockImplementation(() => {}),
    );
    try {
      h.keys.saveApiKey(KEY);
      h.player.emit("nowPlayingItemDidChange", { name: "SENTINEL-NOW", artistName: "SENTINEL-ARTIST" });
      vi.mocked(h.agent.runVibe).mockImplementationOnce(async (options) => {
        await options.search("SENTINEL-ARTIST", "SENTINEL-SONG");
        return [{ ...PICK, title: "SENTINEL-SONG", reason: "SENTINEL-REASON" }];
      });
      h.vibe.handleRequest({ prompt: "SENTINEL-PROMPT", mode: "next" });
      await settle();
      vi.mocked(h.agent.runVibe).mockRejectedValueOnce(new Error("SENTINEL-ERROR " + KEY));
      vi.spyOn(Date, "now").mockReturnValue(Date.now() + h.vibe.COOLDOWN_MS + 1);
      h.vibe.handleRequest({ prompt: "SENTINEL-PROMPT", mode: "replace" });
      await settle();
      vi.mocked(Date.now).mockRestore();
      h.vibe.handleRequest({ prompt: "x".repeat(600), mode: "next" });

      const logged = JSON.stringify([
        vi.mocked(log.info).mock.calls,
        ...consoleSpies.map((spy) => spy.mock.calls),
      ]);
      expect(vi.mocked(log.info).mock.calls.length).toBeGreaterThan(0);
      expect(logged).not.toMatch(/SENTINEL/);
      expect(logged).not.toContain(KEY);
      expect(logged).not.toContain("sk-ant-");
    } finally {
      for (const spy of consoleSpies) spy.mockRestore();
    }
  });

  it("keeps a locked key, says so, and retries it on the next request", async () => {
    const h = await load();
    const changed = vi.fn();
    h.vibe.setStateChangedCallback(changed);
    store.set("vibe.apiKey", Buffer.from(`sealed:${KEY}`).toString("base64"));
    vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(false);
    try {
      expect(h.vibe.getStatus()).toMatchObject({ hasKey: false, keyProblem: "locked" });
      h.vibe.handleRequest({ prompt: "chill", mode: "next" });
      await settle();
      expect(h.updates()).toEqual([{ status: "error", code: "key-locked" }]);
      expect(h.agent.runVibe).not.toHaveBeenCalled();
      expect(store.has("vibe.usage")).toBe(false);
      expect(store.has("vibe.apiKey")).toBe(true);
      expect(changed).not.toHaveBeenCalled();

      // Unlocked (in practice, after a restart): the next request reads it.
      vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true);
      vi.mocked(h.agent.runVibe).mockResolvedValueOnce([PICK]);
      h.vibe.handleRequest({ prompt: "chill", mode: "next" });
      await settle();
      expect(h.agent.runVibe).toHaveBeenCalledOnce();
      expect(h.updates().at(-1)).toEqual({ status: "done", mode: "next", picks: [PICK] });
      expect(h.vibe.getStatus()).toMatchObject({ hasKey: true, keyProblem: null });
      // Once for the key becoming readable, once for the usage count.
      expect(changed).toHaveBeenCalledTimes(2);
    } finally {
      vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true);
    }
  });

  it("reports a key the keyring cannot decrypt, keeping it", async () => {
    const h = await load();
    store.set("vibe.apiKey", Buffer.from("garbage").toString("base64"));
    h.vibe.handleRequest({ prompt: "chill", mode: "next" });
    await settle();
    expect(h.updates()).toEqual([{ status: "error", code: "key-unreadable" }]);
    expect(store.has("vibe.apiKey")).toBe(true);
    expect(h.vibe.getStatus().keyProblem).toBe("unreadable");
  });

  // Reading the key can ask the keyring, so a request the limits refuse anyway
  // never gets that far.
  it("checks the limits before touching the keyring", async () => {
    const h = await load();
    store.set("vibe.apiKey", Buffer.from(`sealed:${KEY}`).toString("base64"));
    store.set("vibe.usage", { day: h.vibe.localDay(), count: 50 });
    h.vibe.handleRequest({ prompt: "chill", mode: "next" });
    expect(h.updates()).toEqual([{ status: "error", code: "daily-limit" }]);
    expect(safeStorage.decryptString).not.toHaveBeenCalled();
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
    expect(h.vibe.getStatus()).toEqual({
      hasKey: true,
      keyPersisted: true,
      keyProblem: null,
      keyStorage: "GNOME Keyring (gnome_libsecret)",
      usedToday: 0,
      dailyLimit: 2,
    });
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
