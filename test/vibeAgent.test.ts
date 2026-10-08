import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";

import {
  classifyError,
  cleanReplyText,
  MAX_FOUND,
  MAX_PLAYLIST_SONGS,
  MAX_ROUNDS,
  MAX_SEARCHES,
  MAX_SHOWN,
  newChat,
  picksFrom,
  proposalFrom,
  runTurn,
  SYSTEM_PROMPT,
  TOOLS,
  TRIM_AT_TOKENS,
  trimHistory,
  VibeError,
  type Chat,
  type StreamMessage,
  type StreamParams,
  type TurnEvent,
  type TurnOptions,
} from "../src/integrations/vibe/agent";
import type { CatalogSong } from "../src/integrations/vibe/catalog";

const SONGS: Record<string, CatalogSong> = {
  "111": { id: "111", title: "Song A", artist: "Artist A", album: "Album A", explicit: false, artwork: "" },
  "222": { id: "222", title: "Song B", artist: "Artist B", album: "Album B", explicit: true, artwork: "" },
};

let nextId = 0;

function toolUse(name: string, input: unknown): Anthropic.ToolUseBlock {
  nextId += 1;
  return { type: "tool_use", id: `toolu_${nextId}`, name, input, caller: { type: "direct" } } as Anthropic.ToolUseBlock;
}

function text(value: string): Anthropic.TextBlock {
  return { type: "text", text: value, citations: null } as Anthropic.TextBlock;
}

function message(
  content: Anthropic.ContentBlock[],
  stopReason: Anthropic.StopReason = content.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn",
  usage: Partial<Anthropic.Usage> = { input_tokens: 10, output_tokens: 5 },
): Anthropic.Message {
  return {
    id: "msg",
    type: "message",
    role: "assistant",
    model: "claude-haiku-5-5",
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    stop_details: null,
    usage,
  } as unknown as Anthropic.Message;
}

/** A stream that answers with each response in turn, streaming its text blocks. */
function scripted(...responses: Array<Anthropic.Message | Error>) {
  const calls: StreamParams[] = [];
  const stream = vi.fn<StreamMessage>(async (params, { onText }) => {
    // Copy the history as it was sent, since later turns keep appending to it.
    calls.push({ ...params, messages: [...params.messages] });
    const next = responses.shift();
    if (!next) throw new Error("no scripted response left");
    if (next instanceof Error) throw next;
    for (const block of next.content) if (block.type === "text") onText(block.text);
    return next;
  });
  return { stream, calls };
}

function options(stream: StreamMessage, overrides: Partial<TurnOptions> = {}) {
  const events: TurnEvent[] = [];
  const turn: TurnOptions = {
    stream,
    model: "claude-haiku-5-5",
    chat: newChat(),
    prompt: "late night drive",
    tools: {
      search: vi.fn(async (_artist: string, title: string) =>
        Object.values(SONGS).filter((song) => song.title === title),
      ),
      nowPlaying: vi.fn(() => null),
      recent: vi.fn(async () => [{ artist: "Artist R", title: "Recent" }]),
    },
    signal: new AbortController().signal,
    onEvent: (event) => events.push(event),
    ...overrides,
  };
  return { turn, events };
}

/** The tool results sent back on a given call. */
function toolResults(params: StreamParams): Anthropic.ToolResultBlockParam[] {
  const last = params.messages.at(-1);
  if (!last || typeof last.content === "string") return [];
  return last.content.filter((block): block is Anthropic.ToolResultBlockParam => block.type === "tool_result");
}

describe("runTurn", () => {
  it("shows only songs a search returned, with Hydra's metadata and Claude's reasons, then the closing text", async () => {
    const { stream, calls } = scripted(
      message([
        text("Let me look."),
        toolUse("search_catalog", { artist: "Artist A", title: "Song A" }),
        toolUse("search_catalog", { artist: "Artist B", title: "Song B" }),
      ]),
      message([
        toolUse("show_songs", {
          songs: [
            { id: "222", reason: "Night‮ energy" },
            { id: "999", reason: "An id no search returned" },
            { id: "111", reason: "Smooth" },
            { id: "222", reason: "A repeat" },
          ],
        }),
      ]),
      message([text("Enjoy the drive.")]),
    );
    const { turn, events } = options(stream);
    await runTurn(turn);

    expect(events).toEqual([
      { type: "text", text: "Let me look." },
      { type: "searching", searches: 1 },
      { type: "searching", searches: 2 },
      {
        type: "songs",
        songs: [
          { ...SONGS["222"], reason: "Night energy" },
          { ...SONGS["111"], reason: "Smooth" },
        ],
      },
      { type: "text", text: "Enjoy the drive." },
    ]);
    // Both searches went back together, in one user turn, as JSON matches.
    const searched = toolResults(calls[1]);
    expect(searched).toHaveLength(2);
    expect(JSON.parse(searched[0].content as string)).toEqual([
      { id: "111", title: "Song A", artist: "Artist A", album: "Album A", explicit: false },
    ]);
    // Claude hears what was shown and what was left out.
    expect(toolResults(calls[2])[0].content).toBe(
      "Shown to the user as 2 playable rows. 1 id was not from search_catalog and left out.",
    );
    // The chat keeps the whole turn: prompt, three replies and two rounds of results.
    expect(turn.chat.messages.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant", "user", "assistant"]);
    expect(turn.chat.messages[0]).toEqual({ role: "user", content: "late night drive" });
  });

  it("sends the request Hydra settled on: cached prompt and tools, auto tool choice, low effort, strict tools", async () => {
    const { stream, calls } = scripted(message([text("Hi.")]));
    await runTurn(options(stream).turn);
    const params = calls[0];
    expect(params).toMatchObject({
      model: "claude-haiku-5-5",
      max_tokens: 8000,
      tool_choice: { type: "auto" },
      output_config: { effort: "low" },
      cache_control: { type: "ephemeral" },
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    });
    expect(params).not.toHaveProperty("thinking");
    expect(params).not.toHaveProperty("fallbacks");
    expect(params.tools).toBe(TOOLS);
    expect(TOOLS.map((tool) => (tool as Anthropic.Tool).name)).toEqual([
      "search_catalog",
      "get_now_playing",
      "get_recent_tracks",
      "propose_playlist",
      "show_songs",
    ]);
    for (const tool of TOOLS as Anthropic.Tool[]) {
      expect(tool.strict).toBe(true);
      expect(tool.input_schema.additionalProperties).toBe(false);
    }
  });

  it("states the rules the user set in the system prompt", () => {
    expect(SYSTEM_PROMPT).toMatch(/Music only/);
    expect(SYSTEM_PROMPT).toMatch(/politely/);
    expect(SYSTEM_PROMPT).toMatch(/Reply in the language the user writes in/);
    expect(SYSTEM_PROMPT).toMatch(/English or Albanian/);
    expect(SYSTEM_PROMPT).toMatch(/Never name a song as a recommendation in your text unless a search_catalog call in this chat returned it/);
    expect(SYSTEM_PROMPT).toMatch(/Keep replies short/);
    expect(SYSTEM_PROMPT).toMatch(/cannot play, queue or save anything yourself/);
    expect(SYSTEM_PROMPT).toMatch(/only the user can create it/);
    expect(SYSTEM_PROMPT).toMatch(/cannot add to, change or delete existing ones/);
  });

  it("sends the listening history only when Claude asks for it", async () => {
    const quiet = scripted(message([text("Sure.")]));
    const first = options(quiet.stream);
    await runTurn(first.turn);
    expect(first.turn.tools.recent).not.toHaveBeenCalled();
    expect(first.turn.tools.nowPlaying).not.toHaveBeenCalled();
    expect(JSON.stringify(quiet.calls[0].messages)).not.toContain("Recent");

    const asks = scripted(
      message([toolUse("get_recent_tracks", {}), toolUse("get_now_playing", {})]),
      message([text("Got it.")]),
    );
    const second = options(asks.stream, {});
    vi.mocked(second.turn.tools.nowPlaying).mockReturnValue({ artist: "Artist C", title: "Current" });
    await runTurn(second.turn);
    const [recent, now] = toolResults(asks.calls[1]);
    expect(JSON.parse(recent.content as string)).toEqual({
      recentlyPlayedNewestFirst: [{ artist: "Artist R", title: "Recent" }],
    });
    expect(JSON.parse(now.content as string)).toEqual({ nowPlaying: { artist: "Artist C", title: "Current" } });
  });

  it("says when nothing is playing or the history is unavailable", async () => {
    const { stream, calls } = scripted(
      message([toolUse("get_now_playing", {}), toolUse("get_recent_tracks", {})]),
      message([text("Ok.")]),
    );
    const { turn } = options(stream);
    vi.mocked(turn.tools.recent).mockRejectedValue(new Error("page gone"));
    await runTurn(turn);
    const [now, recent] = toolResults(calls[1]);
    expect(now.content).toBe("Nothing is playing.");
    expect(recent).toMatchObject({ is_error: true });
  });

  it("carries the chat across turns, letting a later turn show songs an earlier one found", async () => {
    const chat: Chat = newChat();
    const first = scripted(
      message([toolUse("search_catalog", { artist: "Artist A", title: "Song A" })]),
      message([text("Found it.")]),
    );
    await runTurn(options(first.stream, { chat }).turn);
    const second = scripted(
      message([toolUse("show_songs", { songs: [{ id: "111", reason: "Again" }] })]),
      message([text("There.")]),
    );
    const { turn, events } = options(second.stream, { chat, prompt: "show it again" });
    await runTurn(turn);
    // The second turn's first request carries the first turn, then the new prompt.
    expect(second.calls[0].messages).toHaveLength(5);
    expect(second.calls[0].messages.at(-1)).toEqual({ role: "user", content: "show it again" });
    expect(events).toContainEqual({ type: "songs", songs: [{ ...SONGS["111"], reason: "Again" }] });
  });

  it("tells Claude when show_songs named no searched song, showing nothing", async () => {
    const { stream, calls } = scripted(
      message([toolUse("show_songs", { songs: [{ id: "999", reason: "Made up" }] })]),
      message([text("Sorry.")]),
    );
    const { turn, events } = options(stream);
    await runTurn(turn);
    expect(events.some((event) => event.type === "songs")).toBe(false);
    expect(toolResults(calls[1])[0]).toMatchObject({ is_error: true });
  });

  it("stops searching at the cap and says so", async () => {
    const uses = Array.from({ length: MAX_SEARCHES + 2 }, () =>
      toolUse("search_catalog", { artist: "Artist A", title: "Song A" }),
    );
    const { stream, calls } = scripted(message(uses), message([text("Done.")]));
    const { turn } = options(stream);
    await runTurn(turn);
    expect(turn.tools.search).toHaveBeenCalledTimes(MAX_SEARCHES);
    const results = toolResults(calls[1]);
    expect(results.filter((r) => r.is_error)).toHaveLength(2);
    expect(results.at(-1)!.content).toMatch(/Search limit/);
  });

  it("answers a failed search and an unknown tool as errors, and carries on", async () => {
    const { stream, calls } = scripted(
      message([toolUse("search_catalog", { artist: "A", title: "Song A" }), toolUse("play_song", { id: "111" })]),
      message([text("Ok.")]),
    );
    const { turn } = options(stream);
    vi.mocked(turn.tools.search).mockRejectedValue(new Error("timed out"));
    await runTurn(turn);
    const [search, unknown] = toolResults(calls[1]);
    expect(search).toMatchObject({ is_error: true });
    expect(unknown).toMatchObject({ is_error: true, content: "Unknown tool: play_song" });
  });

  it("gives up after the round cap, warning Claude on its last step, and keeps the chat as it was", async () => {
    const replies = Array.from({ length: MAX_ROUNDS }, () =>
      message([toolUse("search_catalog", { artist: "Artist A", title: "Song A" })]),
    );
    const { stream, calls } = scripted(...replies);
    const { turn } = options(stream);
    await expect(runTurn(turn)).rejects.toMatchObject({ code: "incomplete" });
    expect(stream).toHaveBeenCalledTimes(MAX_ROUNDS);
    const last = calls[MAX_ROUNDS - 1].messages.at(-1)!.content as Anthropic.ContentBlockParam[];
    expect(last.at(-1)).toMatchObject({ type: "text", text: expect.stringMatching(/last step/) });
    expect(turn.chat.messages).toEqual([]);
  });

  // A turn that does not finish would leave a tool call with no result, which
  // the API refuses on the next turn; the whole turn goes instead.
  it("takes a failed turn back out whole, so the next one starts clean", async () => {
    const chat = newChat();
    await runTurn(options(scripted(message([text("Hello.")])).stream, { chat }).turn);
    const before = structuredClone(chat.messages);
    const { stream } = scripted(
      message([toolUse("search_catalog", { artist: "Artist A", title: "Song A" })]),
      new Anthropic.InternalServerError(529, {}, "overloaded", new Headers()),
    );
    await expect(runTurn(options(stream, { chat }).turn)).rejects.toMatchObject({ code: "unavailable" });
    expect(chat.messages).toEqual(before);
  });

  it("stops before the next request once the budget is spent", async () => {
    const { stream } = scripted(
      message([toolUse("search_catalog", { artist: "Artist A", title: "Song A" })]),
      message([text("never sent")]),
    );
    const onUsage = vi.fn();
    const withinBudget = vi.fn(() => false);
    const { turn } = options(stream, { onUsage, withinBudget });
    await expect(runTurn(turn)).rejects.toMatchObject({ code: "budget" });
    expect(stream).toHaveBeenCalledOnce();
    expect(onUsage).toHaveBeenCalledExactlyOnceWith({ input_tokens: 10, output_tokens: 5 });
    // The first request of a turn is not asked about: blockedReason() in index.ts checked it.
    expect(withinBudget).toHaveBeenCalledOnce();
  });

  it("reports a refusal as its own error", async () => {
    const { stream } = scripted(message([], "refusal"));
    await expect(runTurn(options(stream).turn)).rejects.toMatchObject({ code: "refusal" });
  });

  it("stops before asking again once cancelled", async () => {
    const controller = new AbortController();
    const { stream } = scripted(
      message([toolUse("search_catalog", { artist: "Artist A", title: "Song A" })]),
      message([text("never sent")]),
    );
    const { turn } = options(stream, { signal: controller.signal });
    vi.mocked(turn.tools.search).mockImplementation(async () => {
      controller.abort();
      return [];
    });
    await expect(runTurn(turn)).rejects.toMatchObject({ code: "cancelled" });
    expect(stream).toHaveBeenCalledOnce();
  });

  it("maps API failures to the errors the panel explains", async () => {
    const headers = new Headers();
    const cases: Array<[Error, string]> = [
      [new Anthropic.AuthenticationError(401, {}, "bad key", headers), "key-refused"],
      [new Anthropic.PermissionDeniedError(403, {}, "denied", headers), "key-refused"],
      [new Anthropic.RateLimitError(429, {}, "slow down", headers), "rate-limit"],
      [new Anthropic.InternalServerError(529, {}, "overloaded", headers), "unavailable"],
      [new Anthropic.APIConnectionError({ message: "offline" }), "network"],
      [new Anthropic.APIConnectionTimeoutError(), "network"],
      [new Anthropic.APIUserAbortError(), "cancelled"],
      [new Anthropic.BadRequestError(400, {}, "bad", headers), "failed"],
    ];
    for (const [err, code] of cases) {
      const { stream } = scripted(err);
      await expect(runTurn(options(stream).turn)).rejects.toMatchObject({ code });
      expect(classifyError(err)).toBe(code);
    }
    expect(classifyError(new VibeError("busy"))).toBe("busy");
  });

  it("records the prompt size the API reported, for trimming", async () => {
    const { stream } = scripted(
      message([text("Hi.")], "end_turn", {
        input_tokens: 100,
        cache_creation_input_tokens: 2_000,
        cache_read_input_tokens: 30_000,
        output_tokens: 7,
      }),
    );
    const { turn } = options(stream);
    await runTurn(turn);
    expect(turn.chat.lastPromptTokens).toBe(32_100);
  });

  it("removes characters that could reorder or hide reply text, keeping line breaks", async () => {
    expect(cleanReplyText("a‮b\u0000c\n\nd\te")).toBe("abc\n\nd\te");
    const { stream } = scripted(message([text("x⁦y")]));
    const { turn, events } = options(stream);
    await runTurn(turn);
    expect(events).toEqual([{ type: "text", text: "xy" }]);
  });
});

describe("propose_playlist", () => {
  it("proposes only searched songs under a cleaned name, creating nothing, and says so", async () => {
    const { stream, calls } = scripted(
      message([
        toolUse("search_catalog", { artist: "Artist A", title: "Song A" }),
        toolUse("search_catalog", { artist: "Artist B", title: "Song B" }),
      ]),
      message([
        toolUse("propose_playlist", { name: "  Late\nnight\u202e drive ", ids: ["222", "999", "111", "222"] }),
      ]),
      message([text("Press Create playlist if you like it.")]),
    );
    const { turn, events } = options(stream);
    await runTurn(turn);
    expect(events).toContainEqual({
      type: "playlist",
      proposal: { name: "Late night drive", songs: [SONGS["222"], SONGS["111"]] },
    });
    expect(toolResults(calls[2])[0].content).toBe(
      "The user sees a preview of the playlist with 2 songs and a Create playlist button. It is not created unless they press it. 1 id was not from search_catalog and left out.",
    );
  });

  it("proposes nothing without a name or a searched song", async () => {
    const found = new Map(Object.entries(SONGS));
    expect(proposalFrom({ name: "  ", ids: ["111"] }, found).proposal).toBeNull();
    expect(proposalFrom({ name: "Mix", ids: ["999"] }, found)).toEqual({ proposal: null, rejected: 1 });
    expect(proposalFrom({ name: "Mix", ids: "111" }, found).proposal).toBeNull();
    expect(proposalFrom(null, found).proposal).toBeNull();
    const { stream, calls } = scripted(
      message([toolUse("propose_playlist", { name: "Mix", ids: ["999"] })]),
      message([text("Sorry.")]),
    );
    const { turn, events } = options(stream);
    await runTurn(turn);
    expect(events.some((event) => event.type === "playlist")).toBe(false);
    expect(toolResults(calls[1])[0]).toMatchObject({ is_error: true });
  });

  it(`keeps at most ${MAX_PLAYLIST_SONGS} songs and a 100-character name`, () => {
    const many = new Map<string, CatalogSong>();
    for (let i = 0; i < 150; i += 1) many.set(String(i), { ...SONGS["111"], id: String(i) });
    const { proposal } = proposalFrom({ name: "n".repeat(300), ids: [...many.keys()] }, many);
    expect(proposal!.songs).toHaveLength(MAX_PLAYLIST_SONGS);
    expect(proposal!.name).toHaveLength(100);
  });

  // index.ts adds a note when the user creates a proposed playlist; the next
  // turn carries it before the user's words, then it is spent.
  it("puts the chat's notes before the next prompt, once", async () => {
    const chat = newChat();
    chat.notes.push('(The user created the playlist you proposed, "Mix", with 2 songs.)');
    const first = scripted(message([text("Nice.")]));
    await runTurn(options(first.stream, { chat, prompt: "thanks" }).turn);
    expect(first.calls[0].messages.at(-1)!.content).toBe(
      '(The user created the playlist you proposed, "Mix", with 2 songs.)\n\nthanks',
    );
    expect(chat.notes).toEqual([]);
    const second = scripted(message([text("Ok.")]));
    await runTurn(options(second.stream, { chat, prompt: "more" }).turn);
    expect(second.calls[0].messages.at(-1)!.content).toBe("more");
  });

  it("keeps a note added while the turn runs for the next turn", async () => {
    const chat = newChat();
    chat.notes.push("(first)");
    const { stream, calls } = scripted(
      message([toolUse("get_now_playing", {})]),
      message([text("ok")]),
    );
    const { turn } = options(stream, { chat, prompt: "go" });
    vi.mocked(turn.tools.nowPlaying).mockImplementation(() => {
      chat.notes.push("(created mid-turn)");
      return null;
    });
    await runTurn(turn);
    expect(calls[0].messages.at(-1)!.content).toBe("(first)\n\ngo");
    expect(chat.notes).toEqual(["(created mid-turn)"]);
  });

  it("keeps the notes for the next turn when a turn fails", async () => {
    const chat = newChat();
    chat.notes.push("(note)");
    const { stream } = scripted(new Anthropic.InternalServerError(529, {}, "overloaded", new Headers()));
    await expect(runTurn(options(stream, { chat }).turn)).rejects.toMatchObject({ code: "unavailable" });
    expect(chat.notes).toEqual(["(note)"]);
  });
});

describe("picksFrom", () => {
  const found = new Map(Object.entries(SONGS));

  it("ignores input of the wrong shape", () => {
    expect(picksFrom(null, found)).toEqual({ picks: [], rejected: 0 });
    expect(picksFrom({ songs: "111" }, found)).toEqual({ picks: [], rejected: 0 });
    expect(picksFrom({ songs: [null, { id: 111 }] }, found)).toEqual({ picks: [], rejected: 2 });
  });

  it(`keeps at most ${MAX_SHOWN} songs`, () => {
    const many = new Map<string, CatalogSong>();
    for (let i = 0; i < 30; i += 1) many.set(String(i), { ...SONGS["111"], id: String(i) });
    const { picks } = picksFrom({ songs: [...many.keys()].map((id) => ({ id, reason: "r" })) }, many);
    expect(picks).toHaveLength(MAX_SHOWN);
  });

  it("cuts a long reason and keeps it on one line", () => {
    const { picks } = picksFrom({ songs: [{ id: "111", reason: `line\nbreak ${"x".repeat(400)}` }] }, found);
    expect(picks[0].reason).toMatch(/^line break x+$/);
    expect(picks[0].reason.length).toBeLessThanOrEqual(160);
  });
});

describe("found songs", () => {
  it(`remembers at most ${MAX_FOUND} search results, forgetting the oldest`, async () => {
    const chat = newChat();
    for (let i = 0; i < MAX_FOUND + 5; i += 1) {
      chat.found.set(String(i), { ...SONGS["111"], id: String(i) });
    }
    const { stream } = scripted(
      message([toolUse("search_catalog", { artist: "Artist B", title: "Song B" })]),
      message([text("ok")]),
    );
    await runTurn(options(stream, { chat }).turn);
    expect(chat.found.size).toBe(MAX_FOUND);
    expect(chat.found.has("222")).toBe(true);
    expect(chat.found.has("0")).toBe(false);
  });
});

describe("trimHistory", () => {
  /** A turn: the prompt, a tool round, and a closing reply, each about `size` characters. */
  function turn(n: number, size = 1000): Anthropic.MessageParam[] {
    const id = `toolu_t${n}`;
    return [
      { role: "user", content: `prompt ${n} ${"p".repeat(size)}` },
      { role: "assistant", content: [{ type: "tool_use", id, name: "search_catalog", input: { artist: "a", title: "t" } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: "r".repeat(size) }] },
      { role: "assistant", content: [{ type: "text", text: `reply ${n}` }] },
    ];
  }

  it("leaves a history under the threshold alone", () => {
    const history = [...turn(1), ...turn(2), ...turn(3)];
    expect(trimHistory(history, TRIM_AT_TOKENS)).toBe(history);
  });

  it("drops the oldest whole turns once the prompt is too large, keeping the last two and saying so", () => {
    const history = Array.from({ length: 10 }, (_, i) => turn(i + 1)).flat();
    const trimmed = trimHistory(history, 60_000);
    expect(trimmed.length).toBeLessThan(history.length);
    expect(trimmed.length % 4).toBe(0);
    const first = trimmed[0];
    expect(first.role).toBe("user");
    expect(typeof first.content).toBe("string");
    expect(first.content as string).toMatch(/^\(Earlier messages in this chat were removed to save space\.\)\n\nprompt \d+/);
    // Every tool call kept still has its result after it.
    const uses = trimmed.flatMap((m) => (Array.isArray(m.content) ? m.content.filter((b) => b.type === "tool_use") : []));
    const results = trimmed.flatMap((m) => (Array.isArray(m.content) ? m.content.filter((b) => b.type === "tool_result") : []));
    expect(uses).toHaveLength(results.length);
    // Roughly the target remains: 60,000 tokens over 10 equal turns is 6,000 a turn.
    expect(trimmed.length / 4).toBe(4);
    expect(history[0].content).not.toMatch(/Earlier/);
  });

  it("always keeps the last two turns, however large", () => {
    const history = [...turn(1), ...turn(2), ...turn(3, 100_000)];
    const trimmed = trimHistory(history, 500_000);
    expect(trimmed).toHaveLength(8);
    expect(trimmed[0].content as string).toMatch(/prompt 2/);
    expect(trimHistory([...turn(1), ...turn(2)], 500_000)).toHaveLength(8);
  });

  it("trims before the turn's request, which then carries the note", async () => {
    const chat = newChat();
    chat.messages = Array.from({ length: 10 }, (_, i) => turn(i + 1)).flat();
    chat.lastPromptTokens = 60_000;
    const { stream, calls } = scripted(message([text("ok")]));
    await runTurn(options(stream, { chat }).turn);
    expect(calls[0].messages[0].content as string).toMatch(/^\(Earlier messages/);
    expect(chat.messages.length).toBeLessThan(42);
  });
});
