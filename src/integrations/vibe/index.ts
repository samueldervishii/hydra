/**
 * Vibe: describe a mood and Claude queues songs for it. The panel
 * (assets/vibe.js) sends the description on vibe:request; everything that
 * touches the Anthropic API runs here, in the main process, so the API key
 * never reaches a renderer. Catalogue searches and the recently played list
 * need MusicKit, which lives in the page, so this module calls the panel's
 * functions with executeJavaScript() and re-checks every answer
 * (./catalog.ts). Results go back the same way, and the panel queues them.
 *
 * One request runs at a time, a new one waits COOLDOWN_MS after the last, and
 * `vibe.dailyLimit` (50 by default) caps how many start each local day. The
 * description, the listening history and the picks are never logged.
 */
import Anthropic from "@anthropic-ai/sdk";
import { app, type WebContents } from "electron";
import log from "electron-log/main";
import * as config from "../../config";
import type { IntegrationContext, NowPlayingPayload } from "../../player";
import { liveWebContents } from "../../utils";
import {
  MAX_PROMPT_LENGTH,
  MAX_SEARCHES,
  runVibe,
  VibeError,
  type VibeErrorCode,
  type VibePick,
} from "./agent";
import {
  cleanText,
  MAX_RECENT_TRACKS,
  parseCatalogSongs,
  parseListenedTracks,
  type ListenedTrack,
} from "./catalog";
import { getApiKey, getApiKeyStatus } from "./apiKey";

const vibeLog = log.scope("vibe");

/** The wait after one request ends before the next may start. */
export const COOLDOWN_MS = 5000;
/** How long one catalogue search in the page may take. */
const SEARCH_TIMEOUT_MS = 8000;
/** How long the recently played list may take before the session's is used. */
const RECENT_TIMEOUT_MS = 5000;
/** How long one Messages API call may take, the SDK's own timeout. */
const API_TIMEOUT_MS = 60_000;
/** How long a whole request may take, every round and search included. */
const REQUEST_TIMEOUT_MS = 180_000;

/** Where the panel puts the songs: after the current one, or instead of the queue. */
export type VibeQueueMode = "next" | "replace";

/** A request the panel sent, once checked. */
export interface VibeRequest {
  prompt: string;
  mode: VibeQueueMode;
}

/** What the panel is told, as one JSON value. */
export type VibeUpdate =
  | { status: "working"; searches: number; maxSearches: number }
  | { status: "done"; mode: VibeQueueMode; picks: VibePick[] }
  | { status: "error"; code: VibeErrorCode };

/** Vibe's state for Settings: never the key itself. */
export interface VibeStatus {
  hasKey: boolean;
  keyPersisted: boolean;
  usedToday: number;
  dailyLimit: number;
}

let context: IntegrationContext | null = null;
let nowPlaying: ListenedTrack | null = null;
/** Songs that started this session, newest first: the fallback history. */
const sessionHistory: ListenedTrack[] = [];
let active: AbortController | null = null;
let lastFinishedAt = 0;

/** The local day as YYYY-MM-DD, which `vibe.usage` is keyed by. */
export function localDay(now = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Requests started today, reading a stored day other than today as none. */
function usedToday(): number {
  const usage = config.getVibeUsage();
  return usage && usage.day === localDay() ? usage.count : 0;
}

/** Key presence and today's usage, for Settings. */
export function getStatus(): VibeStatus {
  const key = getApiKeyStatus();
  return {
    hasKey: key.hasKey,
    keyPersisted: key.persisted,
    usedToday: usedToday(),
    dailyLimit: config.getVibeDailyLimit(),
  };
}

/** The request in a vibe:request payload, or null when it is malformed. */
export function parseRequest(data: unknown): VibeRequest | null {
  if (typeof data !== "object" || data === null) return null;
  const entry = data as Record<string, unknown>;
  if (entry.mode !== "next" && entry.mode !== "replace") return null;
  if (typeof entry.prompt !== "string") return null;
  const prompt = cleanText(entry.prompt, MAX_PROMPT_LENGTH);
  return prompt ? { prompt, mode: entry.mode } : null;
}

/**
 * Why a request cannot start now, or null when it can. The order is the one
 * the user can act on: wait for the running one, add a key, then the limits.
 */
export function blockedReason(now = Date.now()): VibeErrorCode | null {
  if (active) return "busy";
  if (getApiKey() === null) return "no-key";
  if (now - lastFinishedAt < COOLDOWN_MS) return "cooldown";
  if (usedToday() >= config.getVibeDailyLimit()) return "daily-limit";
  return null;
}

function onNowPlaying(payload: NowPlayingPayload | null): void {
  const title = cleanText(payload?.name);
  if (!title) {
    nowPlaying = null;
    return;
  }
  const track = { artist: cleanText(payload?.artistName), title };
  nowPlaying = track;
  const last = sessionHistory[0];
  if (last && last.artist === track.artist && last.title === track.title) return;
  sessionHistory.unshift(track);
  sessionHistory.length = Math.min(sessionHistory.length, MAX_RECENT_TRACKS + 1);
}

/**
 * Run a script in the page and resolve with its value, rejecting after
 * timeoutMs. The window is read through liveWebContents() at the moment of the
 * call, since a request outlives any handle captured when it started.
 */
async function inPage(script: string, timeoutMs: number): Promise<unknown> {
  const contents = liveWebContents(context?.getMainWindow() ?? null);
  if (!contents) throw new Error("window gone");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      contents.executeJavaScript(script),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timed out")), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Tell the panel how the request is going; a page that cannot hear is ignored. */
function update(state: VibeUpdate): void {
  const contents: WebContents | null = liveWebContents(
    context?.getMainWindow() ?? null,
  );
  // JSON is valid JavaScript, so the value cannot escape the call.
  contents
    ?.executeJavaScript(
      `window.__hydraVibe && window.__hydraVibe.update(${JSON.stringify(state)})`,
    )
    .catch(() => vibeLog.warn("panel update failed"));
}

/**
 * The recently played songs: Apple's list for the signed-in account, else the
 * songs this session has played, either way without the current one.
 */
async function recentTracks(): Promise<ListenedTrack[]> {
  let recent: ListenedTrack[] = [];
  try {
    recent = parseListenedTracks(
      await inPage(
        "window.__hydraVibe ? window.__hydraVibe.recent() : null",
        RECENT_TIMEOUT_MS,
      ),
    );
  } catch {
    vibeLog.info("recently played unavailable, using this session's");
  }
  if (!recent.length) recent = sessionHistory.slice(nowPlaying ? 1 : 0);
  return recent.slice(0, MAX_RECENT_TRACKS);
}

async function search(artist: string, title: string) {
  const answer = await inPage(
    `window.__hydraVibe.search(${JSON.stringify(artist)}, ${JSON.stringify(title)})`,
    SEARCH_TIMEOUT_MS,
  );
  if (!Array.isArray(answer)) throw new Error("search failed");
  return parseCatalogSongs(answer);
}

async function run(request: VibeRequest): Promise<void> {
  const apiKey = getApiKey();
  if (!apiKey) {
    update({ status: "error", code: "no-key" });
    return;
  }
  const controller = new AbortController();
  active = controller;
  let timedOut = false;
  const deadline = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);
  const model = config.getVibeModel();
  const started = Date.now();
  config.setVibeUsage({ day: localDay(), count: usedToday() + 1 });
  update({ status: "working", searches: 0, maxSearches: MAX_SEARCHES });
  try {
    const client = new Anthropic({
      apiKey,
      maxRetries: 1,
      timeout: API_TIMEOUT_MS,
    });
    const picks = await runVibe({
      createMessage: (params, options) => client.messages.create(params, options),
      model,
      prompt: request.prompt,
      context: { nowPlaying, recent: await recentTracks() },
      search,
      signal: controller.signal,
      onProgress: (searches) =>
        update({ status: "working", searches, maxSearches: MAX_SEARCHES }),
    });
    if (controller.signal.aborted) throw new VibeError("cancelled");
    vibeLog.info(
      `done model=${model} picks=${picks.length} mode=${request.mode} ms=${Date.now() - started}`,
    );
    update({ status: "done", mode: request.mode, picks });
  } catch (err: unknown) {
    const code: VibeErrorCode = timedOut
      ? "unavailable"
      : err instanceof VibeError
        ? err.code
        : "failed";
    // The code is a fixed word; the error itself could carry request data.
    vibeLog.warn(`failed model=${model} code=${code} ms=${Date.now() - started}`);
    update({ status: "error", code });
  } finally {
    clearTimeout(deadline);
    if (active === controller) active = null;
    lastFinishedAt = Date.now();
  }
}

/**
 * Start a request from the panel, or tell it why one cannot start. The caller
 * in src/main.ts has checked that the main window's main frame sent it.
 */
export function handleRequest(data: unknown): void {
  const request = parseRequest(data);
  if (!request) {
    vibeLog.warn("malformed request ignored");
    return;
  }
  const blocked = blockedReason();
  if (blocked) {
    vibeLog.info(`request refused code=${blocked}`);
    update({ status: "error", code: blocked });
    return;
  }
  void run(request);
}

/** Stop the running request, if any; the panel hears "cancelled". */
export function cancel(): void {
  active?.abort();
}

/** Track the current song for the request context and stop a request on quit. */
export function init(ctx: IntegrationContext): void {
  if (context) return;
  context = ctx;
  ctx.player.on("nowPlayingItemDidChange", onNowPlaying);
  app.on("will-quit", () => {
    ctx.player.removeListener("nowPlayingItemDidChange", onNowPlaying);
    cancel();
    context = null;
  });
}
