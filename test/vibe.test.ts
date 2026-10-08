import vm from "node:vm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Conf } from "electron-conf/main";
import { safeStorage } from "electron";
import type { BrowserWindow } from "electron";
import type Anthropic from "@anthropic-ai/sdk";

import { FakePlayer } from "./mocks/player";
import { quit } from "./mocks/appLifecycle";
import type { TurnOptions } from "../src/integrations/vibe/agent";

vi.mock("../src/integrations/vibe/agent", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/integrations/vibe/agent")>()),
  runTurn: vi.fn(),
}));

const store = (Conf as unknown as { _data: Map<string, unknown> })._data;
const KEY = "sk-ant-api03-" + "b".repeat(40);
const SONG = {
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
async function load(
  page: {
    recent?: () => unknown;
    search?: (artist: string, title: string) => unknown;
    create?: (name: unknown, ids: unknown) => unknown;
  } = {},
): Promise<Harness> {
  vi.resetModules();
  const vibe = await import("../src/integrations/vibe");
  const agent = await import("../src/integrations/vibe/agent");
  const keys = await import("../src/integrations/vibe/apiKey");
  const executeJavaScript = vi.fn(async (script: string) => {
    if (script.includes("__hydraVibe.recent()")) return page.recent ? page.recent() : [];
    const search = /__hydraVibe\.search\((.*), (.*)\)$/.exec(script);
    if (search && page.search) return page.search(JSON.parse(search[1]), JSON.parse(search[2]));
    const create = /__hydraVibe\.createPlaylist\((.*), (\[.*\])\)$/.exec(script);
    if (create && page.create) return page.create(JSON.parse(create[1]), JSON.parse(create[2]));
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

/** Let the turn's promise chain settle, streamed text included. */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 80));
}

/** The updates other than spend, which arrive after every response. */
function turnUpdates(h: Harness): unknown[] {
  return h.updates().filter((u) => (u as { status: string }).status !== "spend");
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
    "line separator paragraph",
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

  it("passes Claude's text and songs to the panel as data, whatever they say", async () => {
    const { vibe } = await load();
    for (const state of [
      { status: "text", text: NASTY.join("\n") },
      { status: "songs", songs: NASTY.map((reason, i) => ({ ...SONG, id: String(i), title: reason, reason })) },
    ]) {
      const { calls, pwned } = evaluate(vibe.pageCall("update", state));
      expect(calls).toEqual([[state]]);
      expect(pwned).not.toHaveBeenCalled();
    }
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
  // or print request bodies (the chat and history) to the console.
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

  it("streams through the SDK, and charges the input of a call that fails part way", async () => {
    const { vibe } = await load();
    const final = { usage: { input_tokens: 5, output_tokens: 2 } } as Anthropic.Message;
    let onText: ((delta: string) => void) | undefined;
    let fail = false;
    const fake = {
      on: (event: string, listener: (delta: string) => void) => {
        if (event === "text") onText = listener;
        return fake;
      },
      finalMessage: async () => {
        onText?.("Hel");
        onText?.("lo");
        if (fail) throw new Error("dropped");
        return final;
      },
      currentMessage: { usage: { input_tokens: 900, output_tokens: 0 } },
    };
    const streamCall = vi.fn(() => fake);
    const client = { messages: { stream: streamCall } } as unknown as Pick<Anthropic, "messages">;
    const charge = vi.fn();
    const deltas: string[] = [];
    const signal = new AbortController().signal;
    const stream = vibe.streamWith(client, charge);
    const params = { model: "claude-haiku-5-5", max_tokens: 1, messages: [] };
    await expect(stream(params, { signal, onText: (d) => deltas.push(d) })).resolves.toBe(final);
    expect(streamCall).toHaveBeenCalledWith(params, { signal });
    expect(deltas).toEqual(["Hel", "lo"]);
    // A finished call is charged by the turn from its final usage, not here.
    expect(charge).not.toHaveBeenCalled();
    fail = true;
    await expect(stream(params, { signal, onText: () => {} })).rejects.toThrow("dropped");
    expect(charge).toHaveBeenCalledExactlyOnceWith({ input_tokens: 900, output_tokens: 0 });
  });
});

describe("Vibe messages", () => {
  it("rejects malformed messages", async () => {
    const { vibe } = await load();
    expect(vibe.parseRequest(null)).toBeNull();
    expect(vibe.parseRequest([])).toBeNull();
    expect(vibe.parseRequest({ prompt: "   " })).toBeNull();
    expect(vibe.parseRequest({ prompt: 5 })).toBeNull();
    expect(vibe.parseRequest({ prompt: "x", mode: "next" })).toBeNull();
    expect(vibe.parseRequest({ prompt: "x", model: "claude-opus-5-5" })).toBeNull();
    expect(vibe.parseRequest({})).toBeNull();
    expect(vibe.parseRequest({ prompt: " chill\nmix " })).toEqual({ prompt: "chill mix" });
  });

  // The panel limits the field, but a script in the page can send anything.
  it("refuses a message over 500 characters in main, before any work on it", async () => {
    const { vibe } = await load();
    expect(vibe.parseRequest({ prompt: "y".repeat(500) })?.prompt).toHaveLength(500);
    expect(vibe.parseRequest({ prompt: "y".repeat(501) })).toBeNull();
    const huge = " ".repeat(50_000_000) + "x";
    const started = performance.now();
    expect(vibe.parseRequest({ prompt: huge })).toBeNull();
    expect(performance.now() - started).toBeLessThan(50);
  });

  it("asks for a key before anything else", async () => {
    const h = await load();
    h.vibe.handleRequest({ prompt: "chill" });
    await settle();
    expect(h.agent.runTurn).not.toHaveBeenCalled();
    expect(h.updates()).toEqual([{ status: "error", code: "no-key" }]);
  });

  it("runs a turn with the chat and the tools, streaming its events to the panel in order", async () => {
    const h = await load({
      recent: () => [{ artist: "Artist R", title: "Recent" }],
      search: () => [{ id: "111", title: "Song A", artist: "Artist A", album: "Album A" }, { id: "bad", title: "x" }],
    });
    h.keys.saveApiKey(KEY);
    store.set("vibe.model", "claude-sonnet-5-5");
    h.player.emit("nowPlayingItemDidChange", { name: "Current", artistName: "Artist C" });
    let seen: TurnOptions | undefined;
    vi.mocked(h.agent.runTurn).mockImplementation(async (options) => {
      seen = options;
      const found = await options.tools.search("Artist A", "Song \"A\"");
      expect(found).toEqual([
        { id: "111", title: "Song A", artist: "Artist A", album: "Album A", explicit: false, artwork: "" },
      ]);
      expect(options.tools.nowPlaying()).toEqual({ artist: "Artist C", title: "Current" });
      expect(await options.tools.recent()).toEqual([{ artist: "Artist R", title: "Recent" }]);
      options.onEvent({ type: "text", text: "Here " });
      options.onEvent({ type: "text", text: "you go." });
      options.onEvent({ type: "searching", searches: 1 });
      options.onEvent({ type: "songs", songs: [SONG] });
      options.onEvent({ type: "text", text: "Enjoy." });
      // A million Sonnet input tokens: $2.
      options.onUsage?.({ input_tokens: 1_000_000, output_tokens: 0 } as Anthropic.Usage);
    });

    h.vibe.handleRequest({ prompt: "late night drive" });
    await settle();

    expect(seen?.model).toBe("claude-sonnet-5-5");
    expect(seen?.prompt).toBe("late night drive");
    expect(seen?.chat.messages).toEqual([]);
    // Search arguments reach the page JSON-encoded, never spliced in raw.
    expect(h.executeJavaScript).toHaveBeenCalledWith('window.__hydraVibe.search("Artist A", "Song \\"A\\"")');
    // Text is gathered into one update, sent before whatever follows it.
    expect(turnUpdates(h)).toEqual([
      { status: "working", searches: 0, maxSearches: 15 },
      { status: "text", text: "Here you go." },
      { status: "working", searches: 1, maxSearches: 15 },
      { status: "songs", songs: [SONG] },
      { status: "text", text: "Enjoy." },
      { status: "done" },
    ]);
    expect(store.get("vibe.spend")).toEqual({ day: h.vibe.localDay(), usd: 2 });
    expect(h.updates()).toContainEqual({ status: "spend", spent: "$2.00", budget: "$2.00" });
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
    let recent: unknown;
    vi.mocked(h.agent.runTurn).mockImplementation(async (options) => {
      recent = await options.tools.recent();
    });
    h.vibe.handleRequest({ prompt: "more" });
    await settle();
    expect(recent).toEqual([
      { artist: "Band", title: "Two" },
      { artist: "Band", title: "One" },
    ]);
  });

  it("keeps one chat across turns, and New chat starts another", async () => {
    const h = await load();
    h.keys.saveApiKey(KEY);
    const chats: unknown[] = [];
    vi.mocked(h.agent.runTurn).mockImplementation(async (options) => {
      chats.push(options.chat);
    });
    const later = () => vi.spyOn(Date, "now").mockReturnValue(Date.now() + h.vibe.COOLDOWN_MS + 1);
    h.vibe.handleRequest({ prompt: "one" });
    await settle();
    later();
    h.vibe.handleRequest({ prompt: "two" });
    await settle();
    vi.mocked(Date.now).mockRestore();
    expect(chats[0]).toBe(chats[1]);
    h.vibe.resetChat();
    later();
    h.vibe.handleRequest({ prompt: "three" });
    await settle();
    vi.mocked(Date.now).mockRestore();
    expect(chats[2]).not.toBe(chats[0]);
  });

  it("stops a turn on New chat, and the stopped turn tells the panel nothing more", async () => {
    const h = await load();
    h.keys.saveApiKey(KEY);
    let options: TurnOptions | undefined;
    vi.mocked(h.agent.runTurn).mockImplementation(
      (turn) =>
        new Promise((_, reject) => {
          options = turn;
          turn.signal.addEventListener("abort", () => reject(new h.agent.VibeError("cancelled")));
        }),
    );
    h.vibe.handleRequest({ prompt: "a" });
    await settle();
    const before = turnUpdates(h).length;
    h.vibe.resetChat();
    options!.onEvent({ type: "text", text: "late text" });
    await settle();
    expect(options!.signal.aborted).toBe(true);
    expect(turnUpdates(h)).toHaveLength(before);
  });

  it("forgets the chat on a page load, and sends the Vibe setting", async () => {
    const h = await load();
    h.keys.saveApiKey(KEY);
    const chats: unknown[] = [];
    vi.mocked(h.agent.runTurn).mockImplementation(async (options) => {
      chats.push(options.chat);
    });
    h.vibe.handleRequest({ prompt: "one" });
    await settle();
    const contents = { executeJavaScript: vi.fn(async () => undefined) };
    await h.vibe.pageLoaded(contents as unknown as Electron.WebContents);
    expect(contents.executeJavaScript).toHaveBeenCalledWith(
      'document.documentElement.toggleAttribute("data-hydra-vibe-off", false); undefined',
    );
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + h.vibe.COOLDOWN_MS + 1);
    h.vibe.handleRequest({ prompt: "two" });
    await settle();
    vi.mocked(Date.now).mockRestore();
    expect(chats[1]).not.toBe(chats[0]);
  });

  it("runs one turn at a time, then waits out a one-second cooldown", async () => {
    const h = await load();
    h.keys.saveApiKey(KEY);
    let finish!: () => void;
    vi.mocked(h.agent.runTurn).mockImplementation(() => new Promise<void>((resolve) => (finish = resolve)));
    h.vibe.handleRequest({ prompt: "first" });
    await settle();
    h.vibe.handleRequest({ prompt: "second" });
    expect(h.updates().at(-1)).toEqual({ status: "error", code: "busy" });
    finish();
    await settle();

    expect(h.vibe.COOLDOWN_MS).toBe(1000);
    expect(h.vibe.blockedReason()).toBe("cooldown");
    expect(h.vibe.blockedReason(Date.now() + h.vibe.COOLDOWN_MS + 1)).toBeNull();
    expect(h.agent.runTurn).toHaveBeenCalledOnce();
  });

  // A script in Apple's page can call vibe:send as often as it likes; the
  // limits live here, in main, so it gets one turn and the rest refused.
  it("runs one turn for a burst of messages from the page", async () => {
    const h = await load();
    h.keys.saveApiKey(KEY);
    let finish!: () => void;
    vi.mocked(h.agent.runTurn).mockImplementation(() => new Promise<void>((resolve) => (finish = resolve)));
    for (let i = 0; i < 100; i += 1) h.vibe.handleRequest({ prompt: `p${i}` });
    await settle();
    expect(h.agent.runTurn).toHaveBeenCalledOnce();
    expect(h.updates().filter((u) => (u as { code?: string }).code === "busy")).toHaveLength(99);
    finish();
    await settle();
    for (let i = 0; i < 100; i += 1) h.vibe.handleRequest({ prompt: `q${i}` });
    expect(h.agent.runTurn).toHaveBeenCalledOnce();
    expect(h.updates().at(-1)).toEqual({ status: "error", code: "cooldown" });
  });

  it("logs no message, history, song or key, on success or failure", async () => {
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
      vi.mocked(h.agent.runTurn).mockImplementationOnce(async (options) => {
        await options.tools.search("SENTINEL-ARTIST", "SENTINEL-SONG");
        await options.tools.recent();
        options.onEvent({ type: "text", text: "SENTINEL-TEXT" });
        options.onEvent({ type: "songs", songs: [{ ...SONG, title: "SENTINEL-SONG", reason: "SENTINEL-REASON" }] });
      });
      h.vibe.handleRequest({ prompt: "SENTINEL-PROMPT" });
      await settle();
      vi.mocked(h.agent.runTurn).mockRejectedValueOnce(new Error("SENTINEL-ERROR " + KEY));
      vi.spyOn(Date, "now").mockReturnValue(Date.now() + h.vibe.COOLDOWN_MS + 1);
      h.vibe.handleRequest({ prompt: "SENTINEL-PROMPT" });
      await settle();
      vi.mocked(Date.now).mockRestore();
      h.vibe.handleRequest({ prompt: "x".repeat(600) });

      const logged = JSON.stringify([
        vi.mocked(log.info).mock.calls,
        vi.mocked(log.warn).mock.calls,
        ...consoleSpies.map((spy) => spy.mock.calls),
      ]);
      expect(vi.mocked(log.info).mock.calls.length).toBeGreaterThan(0);
      expect(logged).toContain("songs=1");
      expect(logged).toMatch(/cost=\$\d+\.\d{4} /);
      expect(logged).not.toMatch(/SENTINEL/);
      expect(logged).not.toContain(KEY);
      expect(logged).not.toContain("sk-ant-");
    } finally {
      for (const spy of consoleSpies) spy.mockRestore();
    }
  });

  // Switched off, the panel cannot open; a message can still come from some
  // other script in the page, and it goes nowhere, not even to the keyring.
  it("refuses every message while Vibe is switched off", async () => {
    const h = await load();
    h.keys.saveApiKey(KEY);
    store.set("vibe.enabled", false);
    vi.mocked(safeStorage.decryptString).mockClear();
    h.vibe.handleRequest({ prompt: "chill" });
    await settle();
    expect(h.updates()).toEqual([{ status: "error", code: "disabled" }]);
    expect(h.agent.runTurn).not.toHaveBeenCalled();
    expect(store.has("vibe.spend")).toBe(false);
    expect(safeStorage.decryptString).not.toHaveBeenCalled();
  });

  it("mirrors the setting onto the page, closing the panel when switched off", async () => {
    const h = await load();
    const contents = { executeJavaScript: vi.fn(async () => undefined) };
    store.set("vibe.enabled", false);
    await h.vibe.applyVibeEnabled(contents as unknown as Electron.WebContents);
    expect(contents.executeJavaScript.mock.calls.map((call) => String((call as unknown[])[0]))).toEqual([
      'document.documentElement.toggleAttribute("data-hydra-vibe-off", true); undefined',
      "window.__hydraVibe?.close(); window.__hydraVibe?.refresh(); window.__hydraTopBar?.refresh(); undefined",
    ]);
    contents.executeJavaScript.mockClear();
    store.set("vibe.enabled", true);
    await h.vibe.applyVibeEnabled(contents as unknown as Electron.WebContents);
    expect(contents.executeJavaScript.mock.calls.map((call) => String((call as unknown[])[0]))).toEqual([
      'document.documentElement.toggleAttribute("data-hydra-vibe-off", false); undefined',
      "window.__hydraVibe?.refresh(); window.__hydraTopBar?.refresh(); undefined",
    ]);
    await expect(h.vibe.applyVibeEnabled(null)).resolves.toBeUndefined();
  });

  it("keeps a locked key, says so, and retries it on the next message", async () => {
    const h = await load();
    const changed = vi.fn();
    h.vibe.setStateChangedCallback(changed);
    store.set("vibe.apiKey", Buffer.from(`sealed:${KEY}`).toString("base64"));
    vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(false);
    try {
      expect(h.vibe.getStatus()).toMatchObject({ hasKey: false, keyProblem: "locked" });
      h.vibe.handleRequest({ prompt: "chill" });
      await settle();
      expect(h.updates()).toEqual([{ status: "error", code: "key-locked" }]);
      expect(h.agent.runTurn).not.toHaveBeenCalled();
      expect(store.has("vibe.spend")).toBe(false);
      expect(store.has("vibe.apiKey")).toBe(true);
      expect(changed).not.toHaveBeenCalled();

      // Unlocked (in practice, after a restart): the next message reads it.
      vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true);
      vi.mocked(h.agent.runTurn).mockResolvedValueOnce(undefined);
      h.vibe.handleRequest({ prompt: "chill" });
      await settle();
      expect(h.agent.runTurn).toHaveBeenCalledOnce();
      expect(h.updates().at(-1)).toEqual({ status: "done" });
      expect(h.vibe.getStatus()).toMatchObject({ hasKey: true, keyProblem: null });
      // Once, for the key becoming readable; the turn reported no usage.
      expect(changed).toHaveBeenCalledOnce();
    } finally {
      vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true);
    }
  });

  it("reports a key the keyring cannot decrypt, keeping it", async () => {
    const h = await load();
    store.set("vibe.apiKey", Buffer.from("garbage").toString("base64"));
    h.vibe.handleRequest({ prompt: "chill" });
    await settle();
    expect(h.updates()).toEqual([{ status: "error", code: "key-unreadable" }]);
    expect(store.has("vibe.apiKey")).toBe(true);
    expect(h.vibe.getStatus().keyProblem).toBe("unreadable");
  });

  // Reading the key can ask the keyring, so a message the limits refuse anyway
  // never gets that far.
  it("checks the limits before touching the keyring", async () => {
    const h = await load();
    store.set("vibe.apiKey", Buffer.from(`sealed:${KEY}`).toString("base64"));
    store.set("vibe.spend", { day: h.vibe.localDay(), usd: 2 });
    h.vibe.handleRequest({ prompt: "chill" });
    expect(h.updates()).toEqual([{ status: "error", code: "budget" }]);
    expect(safeStorage.decryptString).not.toHaveBeenCalled();
  });

  it("stops once today's spend reaches the budget, which Settings can raise", async () => {
    const h = await load();
    h.keys.saveApiKey(KEY);
    store.set("vibe.spend", { day: h.vibe.localDay(), usd: 1.99 });
    expect(h.vibe.blockedReason()).toBeNull();
    store.set("vibe.spend", { day: h.vibe.localDay(), usd: 2 });
    expect(h.vibe.blockedReason()).toBe("budget");
    store.set("vibe.dailyBudget", 5);
    expect(h.vibe.blockedReason()).toBeNull();
    // Yesterday's spend does not carry over.
    store.set("vibe.dailyBudget", 0.5);
    store.set("vibe.spend", { day: "2000-01-01", usd: 99 });
    expect(h.vibe.blockedReason()).toBeNull();
    expect(h.vibe.getStatus()).toEqual({
      hasKey: true,
      keyPersisted: true,
      keyProblem: null,
      keyStorage: "GNOME Keyring (gnome_libsecret)",
      spentToday: 0,
      dailyBudget: 0.5,
    });
    expect(h.vibe.spendUpdate()).toEqual({ status: "spend", spent: "$0.00", budget: "$0.50" });
    // A malformed stored spend reads as none.
    store.set("vibe.spend", { day: h.vibe.localDay(), usd: "lots" });
    expect(h.vibe.getStatus().spentToday).toBe(0);
  });

  it("adds every response's cost to today's spend and lets the turn stop when it runs out", async () => {
    const h = await load();
    h.keys.saveApiKey(KEY);
    const changed = vi.fn();
    h.vibe.setStateChangedCallback(changed);
    store.set("vibe.model", "claude-sonnet-5-5");
    store.set("vibe.dailyBudget", 0.2);
    const budgetChecks: boolean[] = [];
    vi.mocked(h.agent.runTurn).mockImplementation(async (options) => {
      budgetChecks.push(options.withinBudget!());
      options.onUsage?.({ input_tokens: 50_000, output_tokens: 0 } as Anthropic.Usage);
      budgetChecks.push(options.withinBudget!());
      options.onUsage?.({ input_tokens: 0, output_tokens: 10_000 } as Anthropic.Usage);
      budgetChecks.push(options.withinBudget!());
      throw new h.agent.VibeError("budget");
    });
    h.vibe.handleRequest({ prompt: "a" });
    await settle();
    // $0.10, then another $0.10 of output: the budget of $0.20 is spent.
    expect(budgetChecks).toEqual([true, true, false]);
    expect((store.get("vibe.spend") as { usd: number }).usd).toBeCloseTo(0.2);
    expect(changed).toHaveBeenCalledTimes(2);
    expect(h.updates().filter((u) => (u as { status: string }).status === "spend")).toEqual([
      { status: "spend", spent: "$0.10", budget: "$0.20" },
      { status: "spend", spent: "$0.20", budget: "$0.20" },
    ]);
    expect(h.updates().at(-1)).toEqual({ status: "error", code: "budget" });
  });

  it("deletes the request count 2.6 kept", async () => {
    store.set("vibe.dailyLimit", 50);
    store.set("vibe.usage", { day: "2026-10-08", count: 3 });
    await load();
    expect(store.has("vibe.dailyLimit")).toBe(false);
    expect(store.has("vibe.usage")).toBe(false);
  });

  it("reports the turn's error code and nothing else", async () => {
    const h = await load();
    h.keys.saveApiKey(KEY);
    const { VibeError } = h.agent;
    vi.mocked(h.agent.runTurn).mockRejectedValueOnce(new VibeError("rate-limit"));
    h.vibe.handleRequest({ prompt: "a" });
    await settle();
    expect(h.updates().at(-1)).toEqual({ status: "error", code: "rate-limit" });

    // An unexpected error reaches the panel and the log as a fixed code only.
    vi.mocked(h.agent.runTurn).mockRejectedValueOnce(new Error("secret detail"));
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + h.vibe.COOLDOWN_MS + 1);
    h.vibe.handleRequest({ prompt: "b" });
    await settle();
    vi.mocked(Date.now).mockRestore();
    expect(h.updates().at(-1)).toEqual({ status: "error", code: "failed" });
    expect(JSON.stringify(h.executeJavaScript.mock.calls)).not.toContain("secret detail");
  });

  it("cancels the running turn, and on quit stops listening", async () => {
    const h = await load();
    h.keys.saveApiKey(KEY);
    let signal: AbortSignal | undefined;
    vi.mocked(h.agent.runTurn).mockImplementation(
      (options) =>
        new Promise((_, reject) => {
          signal = options.signal;
          options.signal.addEventListener("abort", () => reject(new h.agent.VibeError("cancelled")));
        }),
    );
    h.vibe.handleRequest({ prompt: "a" });
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

describe("Vibe playlist proposals", () => {
  const SONG_B = { ...SONG, id: "222", title: "Song B", reason: "" };
  // Each turn here starts a minute after the last, clear of the cooldown,
  // since a turn's finish time is read from the mocked clock.
  let clock = 0;

  /** Run a turn in which Claude proposes a playlist, and return its token. */
  async function propose(h: Harness, name = "Late night", songs = [SONG, SONG_B]): Promise<string> {
    h.keys.saveApiKey(KEY);
    vi.mocked(h.agent.runTurn).mockImplementationOnce(async (options) => {
      options.onEvent({ type: "playlist", proposal: { name, songs } });
    });
    clock += 60_000;
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + clock);
    h.vibe.handleRequest({ prompt: "make it a playlist" });
    await settle();
    vi.mocked(Date.now).mockRestore();
    const shown = h.updates().filter((u) => (u as { status: string }).status === "playlist").at(-1) as {
      proposal: string;
      name: string;
      songs: unknown[];
    };
    return shown.proposal;
  }

  const creates = (h: Harness) =>
    h.executeJavaScript.mock.calls.filter(([script]) => String(script).includes("createPlaylist"));

  it("shows a proposal with a token and creates nothing until the panel asks", async () => {
    const create = vi.fn(() => ({ id: "p.NewOne" }));
    const h = await load({ create });
    const token = await propose(h);
    expect(token).toMatch(/^[0-9a-f-]{36}$/);
    expect(h.updates()).toContainEqual({ status: "playlist", proposal: token, name: "Late night", songs: [SONG, SONG_B] });
    expect(creates(h)).toHaveLength(0);
    expect(create).not.toHaveBeenCalled();
  });

  it("creates exactly the proposed playlist on the token, once, and tells Claude next turn", async () => {
    const create = vi.fn(() => ({ id: "p.NewOne" }));
    const h = await load({ create });
    const token = await propose(h);
    await h.vibe.handleCreatePlaylist({ proposal: token });
    expect(create).toHaveBeenCalledExactlyOnceWith("Late night", ["111", "222"]);
    expect(h.updates().at(-1)).toEqual({ status: "playlist-created", proposal: token, playlist: "p.NewOne" });
    // A token works once.
    await h.vibe.handleCreatePlaylist({ proposal: token });
    expect(create).toHaveBeenCalledOnce();

    let notes: string[] = [];
    vi.mocked(h.agent.runTurn).mockImplementationOnce(async (options) => {
      notes = [...options.chat.notes];
    });
    clock += 60_000;
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + clock);
    h.vibe.handleRequest({ prompt: "thanks" });
    await settle();
    vi.mocked(Date.now).mockRestore();
    expect(notes).toEqual(['(The user created the playlist you proposed, "Late night", with 2 songs.)']);
  });

  it("refuses malformed and unknown tokens without touching the page", async () => {
    const create = vi.fn(() => ({ id: "p.NewOne" }));
    const h = await load({ create });
    const token = await propose(h);
    for (const data of [
      null,
      token,
      { proposal: "not-a-token" },
      { proposal: token, name: "Other" },
      { proposal: token, ids: ["999"] },
      { proposal: "00000000-0000-4000-8000-000000000000" },
      { proposal: token.toUpperCase() },
    ]) {
      await h.vibe.handleCreatePlaylist(data);
    }
    expect(create).not.toHaveBeenCalled();
    expect(h.vibe.parseCreateRequest({ proposal: token })).toBe(token);
    // Only a well-formed token is answered, and an unknown one as a failure.
    expect(h.updates().filter((u) => (u as { status: string }).status === "playlist-failed")).toEqual([
      { status: "playlist-failed", proposal: "00000000-0000-4000-8000-000000000000", code: "failed" },
    ]);
  });

  it("voids every proposal on New chat and on a page load", async () => {
    const create = vi.fn(() => ({ id: "p.NewOne" }));
    const h = await load({ create });
    const first = await propose(h);
    h.vibe.resetChat();
    await h.vibe.handleCreatePlaylist({ proposal: first });
    const second = await propose(h);
    await h.vibe.pageLoaded({ executeJavaScript: vi.fn(async () => undefined) } as unknown as Electron.WebContents);
    await h.vibe.handleCreatePlaylist({ proposal: second });
    expect(create).not.toHaveBeenCalled();
  });

  it("passes a hostile name to the page as one exact string", async () => {
    const hostile = '"); window.pwned(); ("';
    const create = vi.fn(() => ({ id: "p.NewOne" }));
    const h = await load({ create });
    const token = await propose(h, hostile);
    await h.vibe.handleCreatePlaylist({ proposal: token });
    expect(create).toHaveBeenCalledExactlyOnceWith(hostile, ["111", "222"]);
    const script = String(creates(h)[0][0]);
    const calls: unknown[][] = [];
    const pwned = vi.fn();
    vm.runInNewContext(script, { window: { pwned, __hydraVibe: { createPlaylist: (...args: unknown[]) => calls.push(args) } } });
    expect(calls).toEqual([[hostile, ["111", "222"]]]);
    expect(pwned).not.toHaveBeenCalled();
  });

  it("reports a signed-out page or a failed create, and lets the user try again", async () => {
    const create = vi
      .fn()
      .mockReturnValueOnce({ error: "signed-out" })
      .mockReturnValueOnce({ id: "pl.catalogue-id" })
      .mockReturnValueOnce({ id: "p.Good" });
    const h = await load({ create });
    const token = await propose(h);
    await h.vibe.handleCreatePlaylist({ proposal: token });
    expect(h.updates().at(-1)).toEqual({ status: "playlist-failed", proposal: token, code: "signed-out" });
    // Only a library playlist id counts as created.
    await h.vibe.handleCreatePlaylist({ proposal: token });
    expect(h.updates().at(-1)).toEqual({ status: "playlist-failed", proposal: token, code: "failed" });
    await h.vibe.handleCreatePlaylist({ proposal: token });
    expect(h.updates().at(-1)).toEqual({ status: "playlist-created", proposal: token, playlist: "p.Good" });
    expect(create).toHaveBeenCalledTimes(3);
  });

  it("runs one create at a time for a token, however often the page asks", async () => {
    let finish!: (value: unknown) => void;
    const create = vi.fn(() => new Promise((resolve) => (finish = resolve)));
    const h = await load({ create });
    const token = await propose(h);
    const first = h.vibe.handleCreatePlaylist({ proposal: token });
    for (let i = 0; i < 20; i += 1) void h.vibe.handleCreatePlaylist({ proposal: token });
    await settle();
    expect(create).toHaveBeenCalledOnce();
    finish({ id: "p.NewOne" });
    await first;
  });

  it("refuses to create while Vibe is switched off", async () => {
    const create = vi.fn(() => ({ id: "p.NewOne" }));
    const h = await load({ create });
    const token = await propose(h);
    store.set("vibe.enabled", false);
    await h.vibe.handleCreatePlaylist({ proposal: token });
    expect(create).not.toHaveBeenCalled();
    expect(h.updates().at(-1)).toEqual({ status: "playlist-failed", proposal: token, code: "disabled" });
  });

  it("logs no playlist name or id", async () => {
    const create = vi.fn(() => ({ id: "p.SENTINELID" }));
    const h = await load({ create });
    const log = (await import("electron-log/main")).default.scope("vibe");
    const token = await propose(h, "SENTINEL-NAME");
    await h.vibe.handleCreatePlaylist({ proposal: token });
    const logged = JSON.stringify([vi.mocked(log.info).mock.calls, vi.mocked(log.warn).mock.calls]);
    expect(logged).toContain("playlist created songs=2");
    expect(logged).not.toMatch(/SENTINEL/);
  });
});
