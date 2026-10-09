import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { describe, expect, it } from 'vitest';

import {
  NAV_LABELS_TOKEN,
  PLAYLIST_SORT_LABELS_TOKEN,
  PLAYLIST_SORTS_TOKEN,
  SEARCH_LABELS_TOKEN,
  TOP_BAR_LABELS_TOKEN,
  VIBE_LABELS_TOKEN,
  VIBE_SPEND_TOKEN,
} from '../src/i18n';
import {
  parseRefreshOutcome,
  RENDERER_SCRIPTS,
  rendererRefreshScript,
  type RendererScript,
} from '../src/rendererRefresh';

const DATA = {
  spend: { status: 'spend', spent: '$0.10', budget: '$2.00' },
  sorts: { 'p.One': { by: 'title', dir: 'asc' } },
};

const ASSET_FILES: Record<RendererScript, string> = {
  hook: 'musicKitHook.js',
  navBar: 'navigationBar.js',
  songSearch: 'songSearch.js',
  vibe: 'vibe.js',
  playlistSort: 'playlistSort.js',
  topBar: 'topBar.js',
};

const LABELS = JSON.stringify({ back: 'Back', forward: 'Forward', reload: 'Reload', settings: 'Settings' });

// Each asset as src/main.ts sends it, its tokens filled in.
function asset(name: RendererScript): string {
  return fs
    .readFileSync(path.join(__dirname, '..', 'assets', ASSET_FILES[name]), 'utf-8')
    .replace(NAV_LABELS_TOKEN, () => LABELS)
    .replace(SEARCH_LABELS_TOKEN, () => '{}')
    .replace(TOP_BAR_LABELS_TOKEN, () => '{}')
    .replace(VIBE_LABELS_TOKEN, () => '{}')
    .replace(PLAYLIST_SORT_LABELS_TOKEN, () => '{}')
    .replace(VIBE_SPEND_TOKEN, () => JSON.stringify(DATA.spend))
    .replace(PLAYLIST_SORTS_TOKEN, () => JSON.stringify(DATA.sorts))
    .replace('__HYDRA_DOCUMENT_GENERATION__', '1')
    .replace('__HYDRA_SERVICE_HOSTS__', '[]');
}

interface Page {
  calls: string[];
  context: vm.Context;
}

// A page where every script has already run once, each recording the calls
// made on it.
function injectedPage(hostname: string, options: { throwing?: string } = {}): Page {
  const calls: string[] = [];
  const record =
    (name: string) =>
    (...args: unknown[]): void => {
      if (name === options.throwing) throw new Error('refresh failed');
      calls.push(`${name}(${JSON.stringify(args)})`);
    };
  const window = {
    location: { hostname },
    __hydraHookInjected: true,
    __hydraSongSearch: { close: record('songSearch.close') },
    __hydraVibe: { update: record('vibe.update'), refresh: record('vibe.refresh') },
    __hydraPlaylistSort: { refresh: record('playlistSort.refresh') },
    __hydraTopBar: { update: record('topBar.update') },
  };
  const document = {
    getElementById: (id: string): object | null => (id === 'hydra-nav-buttons' ? {} : null),
  };
  const context = vm.createContext({
    window,
    document,
    console: { log: record('console.log'), warn: record('console.warn') },
  });
  return { calls, context };
}

describe('renderer refresh', () => {
  // The refresh stands in for a repeat run of each asset, so on the same page
  // the two must make exactly the same calls.
  it.each(['music.apple.com', 'classical.music.apple.com'])(
    'makes the calls a repeat run of every asset makes on %s',
    (hostname) => {
      const repeat = injectedPage(hostname);
      for (const name of RENDERER_SCRIPTS) vm.runInContext(asset(name), repeat.context);

      const refresh = injectedPage(hostname);
      const outcome: unknown = vm.runInContext(
        rendererRefreshScript(RENDERER_SCRIPTS, DATA),
        refresh.context,
      );

      expect(refresh.calls).toEqual(repeat.calls);
      expect(parseRefreshOutcome(outcome, RENDERER_SCRIPTS)).toEqual({ missing: [], failed: [] });
      if (hostname === 'music.apple.com') expect(refresh.calls).toHaveLength(5);
      else expect(refresh.calls).toEqual([]);
    },
  );

  it('reports the scripts not in the page yet', () => {
    const context = vm.createContext({
      window: { location: { hostname: 'music.apple.com' } },
      document: { getElementById: (): null => null },
    });
    const outcome: unknown = vm.runInContext(
      rendererRefreshScript(RENDERER_SCRIPTS, DATA),
      context,
    );
    expect(parseRefreshOutcome(outcome, RENDERER_SCRIPTS)).toEqual({
      missing: [...RENDERER_SCRIPTS],
      failed: [],
    });
  });

  // Classical has no panels or top bar, so it never needs them sent.
  it('leaves the music-only scripts out on Classical', () => {
    const context = vm.createContext({
      window: { location: { hostname: 'classical.music.apple.com' } },
      document: { getElementById: (): null => null },
    });
    const outcome: unknown = vm.runInContext(
      rendererRefreshScript(RENDERER_SCRIPTS, DATA),
      context,
    );
    expect(parseRefreshOutcome(outcome, RENDERER_SCRIPTS)).toEqual({
      missing: ['hook', 'navBar'],
      failed: [],
    });
  });

  it('runs every step when one throws and reports that one as failed', () => {
    const page = injectedPage('music.apple.com', { throwing: 'vibe.update' });
    const outcome: unknown = vm.runInContext(
      rendererRefreshScript(RENDERER_SCRIPTS, DATA),
      page.context,
    );
    expect(parseRefreshOutcome(outcome, RENDERER_SCRIPTS)).toEqual({
      missing: [],
      failed: ['vibe'],
    });
    expect(page.calls).toEqual([
      'songSearch.close([])',
      `playlistSort.refresh([${JSON.stringify(DATA.sorts)}])`,
      'topBar.update([])',
    ]);
  });

  it('runs only the steps asked for', () => {
    const page = injectedPage('music.apple.com');
    const script = rendererRefreshScript(['navBar'], DATA);
    expect(script).not.toContain('__hydraVibe');
    expect(vm.runInContext(script, page.context)).toEqual({ missing: [], failed: [] });
    expect(page.calls).toEqual([]);
  });

  // The data is written as JSON, so a value cannot end the expression early.
  it('writes the data as a literal, whatever it holds', () => {
    const page = injectedPage('music.apple.com');
    const sorts = { 'p.x': { by: '"});window.__pwned=1;({"', dir: 'asc' } };
    vm.runInContext(rendererRefreshScript(['playlistSort'], { spend: null, sorts }), page.context);
    expect(page.calls).toEqual([`playlistSort.refresh([${JSON.stringify(sorts)}])`]);
    expect(vm.runInContext('window.__pwned', page.context)).toBeUndefined();
  });
});

describe('parseRefreshOutcome', () => {
  const all = RENDERER_SCRIPTS;

  it('accepts the shape the script returns and drops repeats', () => {
    expect(parseRefreshOutcome({ missing: ['vibe', 'vibe'], failed: ['hook'] }, all)).toEqual({
      missing: ['vibe'],
      failed: ['hook'],
    });
  });

  it.each([
    ['true', true],
    ['null', null],
    ['an array', []],
    ['a missing list', { missing: [] }],
    ['an extra key', { missing: [], failed: [], more: [] }],
    ['a list that is not an array', { missing: 'vibe', failed: [] }],
    ['an unknown script', { missing: ['nope'], failed: [] }],
    ['a non-string entry', { missing: [1], failed: [] }],
  ])('refuses %s', (_label, value) => {
    expect(parseRefreshOutcome(value, all)).toBeNull();
  });

  it('refuses a script it was not asked about', () => {
    expect(parseRefreshOutcome({ missing: ['vibe'], failed: [] }, ['navBar'])).toBeNull();
  });
});
