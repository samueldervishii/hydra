/**
 * The scripts injectRendererScripts() in src/main.ts puts in the page, in the
 * order it runs them.
 */
export const RENDERER_SCRIPTS = [
  'hook',
  'navBar',
  'songSearch',
  'vibe',
  'playlistSort',
  'topBar',
] as const;

export type RendererScript = (typeof RENDERER_SCRIPTS)[number];

/** What one in-page navigation's refresh left to do. */
export interface RefreshOutcome {
  /** Not in the page yet: these get their whole script. */
  missing: RendererScript[];
  /** In the page, but their refresh threw. */
  failed: RendererScript[];
}

/** Values the refresh hands on, filled in at each call as the full scripts' tokens are. */
export interface RefreshData {
  spend: unknown;
  sorts: unknown;
}

// Each step does exactly what a repeat run of its asset does, and returns
// false when the asset has not run in this document, so it gets its whole
// script. The panels and the top bar return on any host but music.apple.com
// before their repeat check, so there they have nothing to do. Keep these in
// step with the repeat blocks at the top of each asset; test/rendererRefresh
// runs both against the same page and compares what they call.
const STEPS: Record<RendererScript, string> = {
  hook: 'function () { return !!window.__hydraHookInjected; }',
  navBar: 'function () { return !!document.getElementById("hydra-nav-buttons"); }',
  songSearch: `function () {
    if (window.location.hostname !== "music.apple.com") return true;
    if (!window.__hydraSongSearch) return false;
    window.__hydraSongSearch.close();
    return true;
  }`,
  vibe: `function (data) {
    if (window.location.hostname !== "music.apple.com") return true;
    if (!window.__hydraVibe) return false;
    window.__hydraVibe.update(data.spend);
    window.__hydraVibe.refresh();
    return true;
  }`,
  playlistSort: `function (data) {
    if (window.location.hostname !== "music.apple.com") return true;
    if (!window.__hydraPlaylistSort) return false;
    window.__hydraPlaylistSort.refresh(data.sorts);
    return true;
  }`,
  topBar: `function () {
    if (window.location.hostname !== "music.apple.com") return true;
    if (!window.__hydraTopBar) return false;
    window.__hydraTopBar.update();
    return true;
  }`,
};

/**
 * Build the one script an in-page navigation runs in place of every asset.
 *
 * Each asset is injected once per document and keeps itself current through
 * the method its repeat run calls, so sending the whole asset again on every
 * in-page navigation only made the page parse it again. Steps run in the
 * order given, each in its own try, so one that throws leaves the rest to run,
 * as separate injections did. The data is written with JSON.stringify, never
 * concatenated.
 */
export function rendererRefreshScript(
  scripts: readonly RendererScript[],
  data: RefreshData,
): string {
  const steps = scripts
    .map((name) => `[${JSON.stringify(name)}, ${STEPS[name]}]`)
    .join(',\n');
  return `(function (data) {
  var steps = [${steps}];
  var missing = [];
  var failed = [];
  for (var i = 0; i < steps.length; i++) {
    try {
      if (!steps[i][1](data)) missing.push(steps[i][0]);
    } catch (_) {
      failed.push(steps[i][0]);
    }
  }
  return { missing: missing, failed: failed };
})(${JSON.stringify({ spend: data.spend, sorts: data.sorts })})`;
}

function scriptList(
  value: unknown,
  asked: readonly RendererScript[],
): RendererScript[] | null {
  if (!Array.isArray(value)) return null;
  const isAsked = (entry: unknown): entry is RendererScript =>
    asked.some((name) => name === entry);
  const list: RendererScript[] = [];
  for (const entry of value) {
    if (!isAsked(entry)) return null;
    if (!list.includes(entry)) list.push(entry);
  }
  return list;
}

/**
 * Check what the page answered. Anything but the shape the script returns, or
 * a script it was not asked about, is null, and the caller injects every
 * script whole, as it did before there was a refresh.
 */
export function parseRefreshOutcome(
  value: unknown,
  scripts: readonly RendererScript[],
): RefreshOutcome | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== 2 || !('missing' in record) || !('failed' in record)) return null;
  const missing = scriptList(record.missing, scripts);
  const failed = scriptList(record.failed, scripts);
  if (!missing || !failed) return null;
  return { missing, failed };
}
