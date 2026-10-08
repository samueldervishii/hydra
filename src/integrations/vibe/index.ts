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
 * `vibe.dailyBudget` ($2 by default) caps what they may spend each local day,
 * priced from the usage every response reports (./pricing.ts). The
 * description, the listening history and the picks are never logged.
 */
import Anthropic from "@anthropic-ai/sdk";
import { app, type WebContents } from "electron";
import log from "electron-log/main";
import * as config from "../../config";
import type { IntegrationContext, NowPlayingPayload } from "../../player";
import { liveWebContents, errorMessage } from "../../utils";
import { setRootAttribute } from "../../rootAttribute";
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
import { getApiKey, getApiKeyStatus, knownApiKeyState } from "./apiKey";
// Settings reaches the key store through this module only.
export { clearApiKey, isApiKeyFormat, saveApiKey } from "./apiKey";
import { keyringDescription } from "../../keyring";
import { costOf, formatUsd } from "./pricing";

const vibeLog = log.scope("vibe");

/**
 * Attribute on `<html>` while Vibe is switched off in Settings: the top bar
 * (assets/topBar.js) hides its Vibe item and the panel (assets/vibe.js) will
 * not open.
 */
export const VIBE_OFF_ATTRIBUTE = "data-hydra-vibe-off";

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
  /** A stored key that could not be read: the keyring is locked, or decryption failed. */
  keyProblem: "locked" | "unreadable" | null;
  /** Where safeStorage keeps its key, such as "GNOME Keyring (gnome_libsecret)". */
  keyStorage: string;
  /** US dollars spent today, at list prices. */
  spentToday: number;
  dailyBudget: number;
}

let context: IntegrationContext | null = null;
let nowPlaying: ListenedTrack | null = null;
/** Songs that started this session, newest first: the fallback history. */
const sessionHistory: ListenedTrack[] = [];
let active: AbortController | null = null;
let lastFinishedAt = 0;
let stateChanged: (() => void) | null = null;

/** Tell Settings when the key state or today's usage changes; null to stop. */
export function setStateChangedCallback(callback: (() => void) | null): void {
  stateChanged = callback;
}

/** The local day as YYYY-MM-DD, which `vibe.spend` is keyed by. */
export function localDay(now = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** US dollars spent today, reading a stored day other than today as none. */
function spentToday(): number {
  const spend = config.getVibeSpend();
  return spend && spend.day === localDay() ? spend.usd : 0;
}

/** Add one response's cost to today's spend, and tell Settings. */
function addSpend(usd: number): void {
  if (!(usd > 0)) return;
  config.setVibeSpend({ day: localDay(), usd: spentToday() + usd });
  stateChanged?.();
}

/** Whether today's spend is still under the budget. */
function withinBudget(): boolean {
  return spentToday() < config.getVibeDailyBudget();
}

/** Key presence and today's usage, for Settings. */
export function getStatus(): VibeStatus {
  const key = getApiKeyStatus();
  return {
    hasKey: key.hasKey,
    keyPersisted: key.persisted,
    keyProblem: key.state === "locked" || key.state === "unreadable" ? key.state : null,
    keyStorage: keyringDescription(),
    spentToday: spentToday(),
    dailyBudget: config.getVibeDailyBudget(),
  };
}

/**
 * The request in a vibe:request payload, or null when it is malformed. Any
 * script in Apple's page can send one, so the shape is checked here and not
 * only in the panel: exactly a prompt and a mode, and a prompt of at most
 * MAX_PROMPT_LENGTH characters is refused rather than cut, before any work is
 * done on it.
 */
export function parseRequest(data: unknown): VibeRequest | null {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  const entry = data as Record<string, unknown>;
  const keys = Object.keys(entry);
  if (keys.length !== 2 || !keys.includes("prompt") || !keys.includes("mode")) return null;
  if (entry.mode !== "next" && entry.mode !== "replace") return null;
  if (typeof entry.prompt !== "string" || entry.prompt.length > MAX_PROMPT_LENGTH) return null;
  const prompt = cleanText(entry.prompt, MAX_PROMPT_LENGTH);
  return prompt ? { prompt, mode: entry.mode } : null;
}

/** Where Hydra sends the key; never taken from the environment. */
export const ANTHROPIC_API_URL = "https://api.anthropic.com";

/**
 * The SDK client for one request. Without these options the SDK would take
 * its endpoint from ANTHROPIC_BASE_URL, add ANTHROPIC_AUTH_TOKEN as a second
 * credential, and with ANTHROPIC_LOG at info or debug print every request
 * body, the description and the listening history, to the console. Each is
 * pinned so the key goes to Anthropic alone and nothing is printed.
 */
export function createClient(apiKey: string): Anthropic {
  return new Anthropic({
    apiKey,
    authToken: null,
    baseURL: ANTHROPIC_API_URL,
    logLevel: "off",
    maxRetries: 1,
    timeout: API_TIMEOUT_MS,
  });
}

/**
 * A call to one of the panel's functions in the page. Every argument is
 * written with JSON.stringify, which yields a JavaScript literal, so no value
 * (quotes, backticks, ${}, </script>, line separators) can end the call or
 * start code of its own.
 */
export function pageCall(name: "search" | "update", ...args: unknown[]): string {
  return `window.__hydraVibe.${name}(${args.map((arg) => JSON.stringify(arg)).join(", ")})`;
}

/**
 * Why a request cannot start now, or null when it can. The key is not checked
 * here: reading it may ask the keyring, so handleRequest() does that last,
 * once the limits allow a request.
 */
export function blockedReason(now = Date.now()): VibeErrorCode | null {
  // Switched off, the panel cannot open; a request still arriving came from
  // some other script in the page.
  if (!config.getVibeEnabled()) return "disabled";
  if (active) return "busy";
  if (now - lastFinishedAt < COOLDOWN_MS) return "cooldown";
  if (!withinBudget()) return "budget";
  return null;
}

/**
 * The key for a request, retrying a stored key that could not be read, or the
 * reason there is none. Settings hears when the outcome changes.
 */
function keyForRequest(): { key: string } | { code: VibeErrorCode } {
  const before = knownApiKeyState();
  const key = getApiKey();
  const after = knownApiKeyState();
  if (after !== before) stateChanged?.();
  if (key) return { key };
  return {
    code: after === "locked" ? "key-locked" : after === "unreadable" ? "key-unreadable" : "no-key",
  };
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
  contents
    ?.executeJavaScript(`window.__hydraVibe && ${pageCall("update", state)}`)
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
  const answer = await inPage(pageCall("search", artist, title), SEARCH_TIMEOUT_MS);
  if (!Array.isArray(answer)) throw new Error("search failed");
  return parseCatalogSongs(answer);
}

async function run(request: VibeRequest, apiKey: string): Promise<void> {
  const controller = new AbortController();
  active = controller;
  let timedOut = false;
  const deadline = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);
  const model = config.getVibeModel();
  const started = Date.now();
  let cost = 0;
  update({ status: "working", searches: 0, maxSearches: MAX_SEARCHES });
  try {
    const client = createClient(apiKey);
    const picks = await runVibe({
      createMessage: (params, options) => client.messages.create(params, options),
      model,
      prompt: request.prompt,
      context: { nowPlaying, recent: await recentTracks() },
      search,
      signal: controller.signal,
      onProgress: (searches) =>
        update({ status: "working", searches, maxSearches: MAX_SEARCHES }),
      onUsage: (usage) => {
        const usd = costOf(model, usage);
        cost += usd;
        addSpend(usd);
      },
      withinBudget,
    });
    if (controller.signal.aborted) throw new VibeError("cancelled");
    vibeLog.info(
      `done model=${model} picks=${picks.length} mode=${request.mode} cost=${formatUsd(cost)} ms=${Date.now() - started}`,
    );
    update({ status: "done", mode: request.mode, picks });
  } catch (err: unknown) {
    const code: VibeErrorCode = timedOut
      ? "unavailable"
      : err instanceof VibeError
        ? err.code
        : "failed";
    // The code is a fixed word; the error itself could carry request data.
    vibeLog.warn(
      `failed model=${model} code=${code} cost=${formatUsd(cost)} ms=${Date.now() - started}`,
    );
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
  const access = blocked ? { code: blocked } : keyForRequest();
  if ("code" in access) {
    vibeLog.info(`request refused code=${access.code}`);
    update({ status: "error", code: access.code });
    return;
  }
  void run(request, access.key);
}

/**
 * Mirror the Vibe setting onto the page, then close the panel and let the top
 * bar show or hide its item, so a change from Settings applies without a
 * reload. On a fresh load both scripts read the attribute themselves. Never
 * rejects.
 */
export async function applyVibeEnabled(contents: WebContents | null): Promise<void> {
  const enabled = config.getVibeEnabled();
  await setRootAttribute(contents, VIBE_OFF_ATTRIBUTE, !enabled);
  if (!contents) return;
  try {
    await contents.executeJavaScript(
      `${enabled ? "" : "window.__hydraVibe?.close(); "}window.__hydraTopBar?.refresh(); undefined`,
    );
  } catch (e: unknown) {
    vibeLog.warn("failed to update the page for the Vibe setting:", errorMessage(e));
  }
}

/** Stop the running request, if any; the panel hears "cancelled". */
export function cancel(): void {
  active?.abort();
}

/** Track the current song for the request context and stop a request on quit. */
export function init(ctx: IntegrationContext): void {
  if (context) return;
  context = ctx;
  config.removeLegacyVibeUsage();
  ctx.player.on("nowPlayingItemDidChange", onNowPlaying);
  app.on("will-quit", () => {
    ctx.player.removeListener("nowPlayingItemDidChange", onNowPlaying);
    cancel();
    context = null;
  });
}
