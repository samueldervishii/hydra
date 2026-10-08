/**
 * Vibe: a music chat with Claude in a side panel. The panel (assets/vibe.js)
 * sends each message on vibe:send; everything that touches the Anthropic API
 * runs here, in the main process, so the API key never reaches a renderer.
 * Catalogue searches and the recently played list need MusicKit, which lives
 * in the page, so this module calls the panel's functions with
 * executeJavaScript() and re-checks every answer (./catalog.ts). The reply
 * goes back the same way, streamed, and the user plays its songs from the
 * panel.
 *
 * Claude can propose a new playlist, which the panel shows as a preview. Only
 * the user's click creates it: the panel sends vibe:create-playlist with the
 * one-use token this module gave the proposal, and this module asks the page
 * to create exactly the playlist it holds under that token. Nothing here can
 * change or delete an existing playlist.
 *
 * The chat lives in memory only: New chat, a full page load and quitting
 * forget it. One turn runs at a time, a new one waits COOLDOWN_MS after the
 * last, and `vibe.dailyBudget` ($2 by default) caps what they may spend each
 * local day, priced from the usage every response reports (./pricing.ts).
 * Messages, the listening history and the songs are never logged.
 */
import { randomUUID } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { app, type WebContents } from "electron";
import log from "electron-log/main";
import * as config from "../../config";
import type { IntegrationContext, NowPlayingPayload } from "../../player";
import { liveWebContents, errorMessage } from "../../utils";
import { setRootAttribute } from "../../rootAttribute";
import {
  MAX_PLAYLIST_NAME,
  MAX_PLAYLIST_SONGS,
  MAX_PROMPT_LENGTH,
  MAX_SEARCHES,
  newChat,
  runTurn,
  VibeError,
  type Chat,
  type StreamMessage,
  type TurnEvent,
  type VibeErrorCode,
  type VibePick,
} from "./agent";
import {
  cleanText,
  MAX_RECENT_TRACKS,
  parseCatalogSongs,
  parseListenedTracks,
  type CatalogSong,
  type ListenedTrack,
} from "./catalog";
import { getApiKey, getApiKeyStatus, knownApiKeyState } from "./apiKey";
// Settings reaches the key store through this module only.
export { clearApiKey, isApiKeyFormat, saveApiKey } from "./apiKey";
import { keyringDescription } from "../../keyring";
import { costOf, formatUsd, type TokenUsage } from "./pricing";

const vibeLog = log.scope("vibe");

/**
 * Attribute on `<html>` while Vibe is switched off in Settings: the top bar
 * (assets/topBar.js) hides its Vibe item, and the panel (assets/vibe.js) takes
 * its player bar button away and will not open.
 */
export const VIBE_OFF_ATTRIBUTE = "data-hydra-vibe-off";

/** The wait after one turn ends before the next may start. */
export const COOLDOWN_MS = 1000;
/** How long one catalogue search in the page may take. */
const SEARCH_TIMEOUT_MS = 8000;
/** How long the recently played list may take before the session's is used. */
const RECENT_TIMEOUT_MS = 5000;
/** How long one Messages API call may take, the SDK's own timeout. */
const API_TIMEOUT_MS = 60_000;
/** How long a whole turn may take, every round and search included. */
const TURN_TIMEOUT_MS = 180_000;
/**
 * Streamed text is gathered for this long before it goes to the page, so a
 * reply costs a few dozen executeJavaScript() calls rather than one a token.
 */
const TEXT_FLUSH_MS = 60;
/** How long creating a playlist in the page may take. */
const CREATE_TIMEOUT_MS = 15_000;
/** Proposals a chat keeps open; the oldest is forgotten first. */
const MAX_PROPOSALS = 20;
/** The token a proposal is created by: a random UUID from this module. */
const PROPOSAL_TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** A library playlist id, as Apple answers a created playlist with. */
const LIBRARY_PLAYLIST_ID = /^p\.[A-Za-z0-9._-]{1,100}$/;
/** Catalogue song ids are digits only. */
const SONG_ID = /^\d{1,20}$/;

/** A message the panel sent, once checked. */
export interface VibeRequest {
  prompt: string;
}

/** Why a playlist was not created, for the panel to explain. */
export type PlaylistErrorCode = "signed-out" | "disabled" | "failed";

/** What the panel is told, as one JSON value each time. */
export type VibeUpdate =
  | { status: "working"; searches: number; maxSearches: number }
  | { status: "text"; text: string }
  | { status: "songs"; songs: VibePick[] }
  | { status: "playlist"; proposal: string; name: string; songs: CatalogSong[] }
  | { status: "playlist-created"; proposal: string; playlist: string }
  | { status: "playlist-failed"; proposal: string; code: PlaylistErrorCode }
  | { status: "done" }
  | { status: "error"; code: VibeErrorCode }
  | { status: "spend"; spent: string; budget: string };

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
let chat: Chat = newChat();
/** Advanced by New chat and a page load, so a turn from the chat before stays quiet. */
let chatGeneration = 0;
let active: AbortController | null = null;
let lastFinishedAt = 0;
let stateChanged: (() => void) | null = null;
/** Playlists Claude proposed in this chat, by their one-use token. */
let proposals = new Map<string, { name: string; ids: string[]; creating: boolean }>();
let pendingText = "";
let textTimer: ReturnType<typeof setTimeout> | null = null;

/** Tell Settings when the key state or today's spend changes; null to stop. */
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

/** Whether today's spend is still under the budget. */
function withinBudget(): boolean {
  return spentToday() < config.getVibeDailyBudget();
}

/** Key presence and today's spend, for Settings. */
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
 * The request in a vibe:send payload, or null when it is malformed. Any
 * script in Apple's page can send one, so the shape is checked here and not
 * only in the panel: exactly a prompt, and a prompt of more than
 * MAX_PROMPT_LENGTH characters is refused rather than cut, before any work is
 * done on it.
 */
export function parseRequest(data: unknown): VibeRequest | null {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  const entry = data as Record<string, unknown>;
  const keys = Object.keys(entry);
  if (keys.length !== 1 || keys[0] !== "prompt") return null;
  if (typeof entry.prompt !== "string" || entry.prompt.length > MAX_PROMPT_LENGTH) return null;
  const prompt = cleanText(entry.prompt, MAX_PROMPT_LENGTH);
  return prompt ? { prompt } : null;
}

/** Where Hydra sends the key; never taken from the environment. */
export const ANTHROPIC_API_URL = "https://api.anthropic.com";

/**
 * The SDK client for one turn. Without these options the SDK would take its
 * endpoint from ANTHROPIC_BASE_URL, add ANTHROPIC_AUTH_TOKEN as a second
 * credential, and with ANTHROPIC_LOG at info or debug print every request
 * body, the chat and the listening history, to the console. Each is pinned so
 * the key goes to Anthropic alone and nothing is printed.
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
export function pageCall(
  name: "search" | "update" | "createPlaylist",
  ...args: unknown[]
): string {
  return `window.__hydraVibe.${name}(${args.map((arg) => JSON.stringify(arg)).join(", ")})`;
}

/**
 * Why a turn cannot start now, or null when it can. The key is not checked
 * here: reading it may ask the keyring, so handleRequest() does that last,
 * once the limits allow a turn.
 */
export function blockedReason(now = Date.now()): VibeErrorCode | null {
  // Switched off, the panel cannot open; a message still arriving came from
  // some other script in the page.
  if (!config.getVibeEnabled()) return "disabled";
  if (active) return "busy";
  if (now - lastFinishedAt < COOLDOWN_MS) return "cooldown";
  if (!withinBudget()) return "budget";
  return null;
}

/**
 * The key for a turn, retrying a stored key that could not be read, or the
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
 * call, since a turn outlives any handle captured when it started.
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

/** Hand one state to the panel; a page that cannot hear is ignored. */
function deliver(state: VibeUpdate): void {
  const contents: WebContents | null = liveWebContents(
    context?.getMainWindow() ?? null,
  );
  contents
    ?.executeJavaScript(`window.__hydraVibe && ${pageCall("update", state)}`)
    .catch(() => vibeLog.warn("panel update failed"));
}

/** Send the text gathered so far, if any. */
function flushText(): void {
  if (textTimer) clearTimeout(textTimer);
  textTimer = null;
  if (!pendingText) return;
  const text = pendingText;
  pendingText = "";
  deliver({ status: "text", text });
}

/**
 * Tell the panel how the turn is going. Text is gathered for TEXT_FLUSH_MS;
 * anything else first sends the text before it, so the panel sees both in
 * the order they happened.
 */
function update(state: VibeUpdate): void {
  if (state.status === "text") {
    pendingText += state.text;
    textTimer ??= setTimeout(flushText, TEXT_FLUSH_MS);
    return;
  }
  flushText();
  deliver(state);
}

/**
 * Today's spend and the budget as the panel shows them, "$X of $Y".
 * src/main.ts writes it into assets/vibe.js at every injection, since the
 * panel is not there yet when the page loads.
 */
export function spendUpdate(): VibeUpdate {
  return {
    status: "spend",
    spent: formatUsd(spentToday()),
    budget: formatUsd(config.getVibeDailyBudget()),
  };
}

/** Show the panel today's spend, after a response or a budget change. */
export function showSpend(): void {
  update(spendUpdate());
}

/** Dollars for the log, to a hundredth of a cent: a Haiku turn costs about $0.001. */
function logUsd(amount: number): string {
  return `$${amount.toFixed(4)}`;
}

/** Add one response's cost to today's spend, and tell Settings and the panel. */
function addSpend(usd: number): void {
  if (!(usd > 0)) return;
  config.setVibeSpend({ day: localDay(), usd: spentToday() + usd });
  stateChanged?.();
  showSpend();
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

/**
 * Bind streamed calls to the SDK client. A call that fails part way still
 * charges the input the API reported when it started.
 */
export function streamWith(
  client: Pick<Anthropic, "messages">,
  charge: (usage: TokenUsage) => void,
): StreamMessage {
  return async (params, { signal, onText }) => {
    const stream = client.messages.stream(params, { signal });
    stream.on("text", (delta) => onText(delta));
    try {
      return await stream.finalMessage();
    } catch (err: unknown) {
      const partial = stream.currentMessage?.usage;
      if (partial) charge(partial);
      throw err;
    }
  };
}

async function run(request: VibeRequest, apiKey: string): Promise<void> {
  const controller = new AbortController();
  active = controller;
  const generation = chatGeneration;
  const current = (): boolean => generation === chatGeneration;
  let timedOut = false;
  const deadline = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, TURN_TIMEOUT_MS);
  const model = config.getVibeModel();
  const started = Date.now();
  let cost = 0;
  let shown = 0;
  const charge = (usage: TokenUsage): void => {
    const usd = costOf(model, usage);
    cost += usd;
    addSpend(usd);
  };
  const onEvent = (event: TurnEvent): void => {
    if (!current()) return;
    if (event.type === "text") update({ status: "text", text: event.text });
    else if (event.type === "songs") {
      shown += event.songs.length;
      update({ status: "songs", songs: event.songs });
    } else if (event.type === "playlist") {
      const { name, songs } = event.proposal;
      const proposal = randomUUID();
      proposals.set(proposal, { name, ids: songs.map((song) => song.id), creating: false });
      while (proposals.size > MAX_PROPOSALS) {
        const oldest = proposals.keys().next().value;
        if (oldest === undefined) break;
        proposals.delete(oldest);
      }
      update({ status: "playlist", proposal, name, songs });
    } else update({ status: "working", searches: event.searches, maxSearches: MAX_SEARCHES });
  };
  update({ status: "working", searches: 0, maxSearches: MAX_SEARCHES });
  try {
    await runTurn({
      stream: streamWith(createClient(apiKey), charge),
      model,
      chat,
      prompt: request.prompt,
      tools: { search, nowPlaying: () => nowPlaying, recent: recentTracks },
      signal: controller.signal,
      onEvent,
      onUsage: charge,
      withinBudget,
    });
    vibeLog.info(
      `turn done model=${model} songs=${shown} cost=${logUsd(cost)} ms=${Date.now() - started}`,
    );
    if (current()) update({ status: "done" });
  } catch (err: unknown) {
    const code: VibeErrorCode = timedOut
      ? "unavailable"
      : err instanceof VibeError
        ? err.code
        : "failed";
    // The code is a fixed word; the error itself could carry request data.
    vibeLog.warn(
      `turn failed model=${model} code=${code} cost=${logUsd(cost)} ms=${Date.now() - started}`,
    );
    if (current()) update({ status: "error", code });
  } finally {
    clearTimeout(deadline);
    flushText();
    if (active === controller) active = null;
    lastFinishedAt = Date.now();
  }
}

/**
 * Start a turn from the panel, or tell it why one cannot start. The caller in
 * src/main.ts has checked that the main window's main frame sent it.
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

/** Stop the running turn, if any; the panel hears "cancelled". */
export function cancel(): void {
  active?.abort();
}

/**
 * Forget the chat and stop a turn still running in it, for New chat. The
 * panel clears itself; the stopped turn tells it nothing more.
 */
export function resetChat(): void {
  chatGeneration += 1;
  cancel();
  chat = newChat();
  proposals = new Map();
  pendingText = "";
  if (textTimer) clearTimeout(textTimer);
  textTimer = null;
}

/**
 * The proposal token in a vibe:create-playlist payload, or null when it is
 * malformed: exactly `{ proposal }`, a UUID.
 */
export function parseCreateRequest(data: unknown): string | null {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  const entry = data as Record<string, unknown>;
  const keys = Object.keys(entry);
  if (keys.length !== 1 || keys[0] !== "proposal") return null;
  return typeof entry.proposal === "string" && PROPOSAL_TOKEN.test(entry.proposal)
    ? entry.proposal
    : null;
}

/** The id of the playlist a page answer reports created, or why there is none. */
function createdPlaylist(answer: unknown): { playlist: string } | { code: PlaylistErrorCode } {
  if (typeof answer !== "object" || answer === null) return { code: "failed" };
  const entry = answer as { id?: unknown; error?: unknown };
  if (typeof entry.id === "string" && LIBRARY_PLAYLIST_ID.test(entry.id)) {
    return { playlist: entry.id };
  }
  return { code: entry.error === "signed-out" ? "signed-out" : "failed" };
}

/**
 * Create a playlist Claude proposed, for the user's click on Create playlist.
 * The caller in src/main.ts has checked that the main window's main frame
 * sent it. The payload names a proposal by its token and nothing else, so
 * what is created is exactly what this module holds: a name and song ids a
 * search in this chat returned, checked again here. A token works once; a
 * failed attempt can be tried again. The page only ever creates a new
 * playlist (assets/vibe.js createPlaylist()).
 */
export async function handleCreatePlaylist(data: unknown): Promise<void> {
  const token = parseCreateRequest(data);
  if (!token) {
    vibeLog.warn("malformed playlist request ignored");
    return;
  }
  const stored = proposals.get(token);
  if (!stored) {
    // Created already, or from a chat that has gone: nothing to create, and
    // the card says so rather than waiting.
    vibeLog.info("playlist request refused: unknown proposal");
    update({ status: "playlist-failed", proposal: token, code: "failed" });
    return;
  }
  if (stored.creating) return;
  if (!config.getVibeEnabled()) {
    update({ status: "playlist-failed", proposal: token, code: "disabled" });
    return;
  }
  const { name, ids } = stored;
  if (
    !name ||
    name.length > MAX_PLAYLIST_NAME ||
    !ids.length ||
    ids.length > MAX_PLAYLIST_SONGS ||
    !ids.every((id) => SONG_ID.test(id))
  ) {
    proposals.delete(token);
    update({ status: "playlist-failed", proposal: token, code: "failed" });
    return;
  }
  stored.creating = true;
  const generation = chatGeneration;
  let outcome: { playlist: string } | { code: PlaylistErrorCode };
  try {
    outcome = createdPlaylist(
      await inPage(pageCall("createPlaylist", name, ids), CREATE_TIMEOUT_MS),
    );
  } catch {
    outcome = { code: "failed" };
  }
  if ("playlist" in outcome) {
    // Never the name: it is the user's library.
    vibeLog.info(`playlist created songs=${ids.length}`);
    if (generation !== chatGeneration) return;
    proposals.delete(token);
    chat.notes.push(
      `(The user created the playlist you proposed, ${JSON.stringify(name)}, with ${ids.length} ${ids.length === 1 ? "song" : "songs"}.)`,
    );
    update({ status: "playlist-created", proposal: token, playlist: outcome.playlist });
    return;
  }
  vibeLog.warn(`playlist not created code=${outcome.code}`);
  if (generation !== chatGeneration) return;
  stored.creating = false;
  update({ status: "playlist-failed", proposal: token, code: outcome.code });
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
      `${enabled ? "window.__hydraVibe?.refresh(); " : "window.__hydraVibe?.close(); window.__hydraVibe?.refresh(); "}window.__hydraTopBar?.refresh(); undefined`,
    );
  } catch (e: unknown) {
    vibeLog.warn("failed to update the page for the Vibe setting:", errorMessage(e));
  }
}

/**
 * Prepare a freshly loaded page: the panel that showed the chat has gone with
 * the old document, so the chat goes too, then the page gets the setting.
 * Never rejects.
 */
export async function pageLoaded(contents: WebContents | null): Promise<void> {
  resetChat();
  await applyVibeEnabled(contents);
}

/** Track the current song for get_now_playing and stop a turn on quit. */
export function init(ctx: IntegrationContext): void {
  if (context) return;
  context = ctx;
  config.removeLegacyVibeUsage();
  ctx.player.on("nowPlayingItemDidChange", onNowPlaying);
  app.on("will-quit", () => {
    ctx.player.removeListener("nowPlayingItemDidChange", onNowPlaying);
    resetChat();
    context = null;
  });
}
