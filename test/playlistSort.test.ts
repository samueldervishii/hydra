// assets/playlistSort.js runs in Apple's page. No renderer runs here, so the
// script runs in a VM against the stand-in page in test/mocks/stubDom.ts, laid
// out like Apple's playlist page. Every track is made up: no title, artist or
// id here comes from a real library.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

import {
  getPlaylistSortStrings,
  PLAYLIST_SORT_LABELS_TOKEN,
  PLAYLIST_SORTS_TOKEN,
} from '../src/i18n';
import { resetStubDom, StubElement, stubDom } from './mocks/stubDom';

const source = fs.readFileSync(path.join(__dirname, '..', 'assets', 'playlistSort.js'), 'utf-8');
const LABELS = getPlaylistSortStrings();
const ROW_PX = 54;

/** The script as src/main.ts injects it, with the stored sorts given. */
function script(sorts: Record<string, unknown> = {}): string {
  return source
    .replace(PLAYLIST_SORT_LABELS_TOKEN, () => JSON.stringify(LABELS))
    .replace(PLAYLIST_SORTS_TOKEN, () => JSON.stringify(sorts));
}

interface FakeTrack {
  id: string;
  type: string;
  attributes: Record<string, unknown>;
}

/** A made-up library track. */
function track(n: number, over: Partial<{ name: string; artist: string; album: string; ms: number; id: string }> = {}): FakeTrack {
  const id = over.id ?? `i.Track${n}`;
  return {
    id,
    type: 'library-songs',
    attributes: {
      name: over.name ?? `Song ${n}`,
      artistName: over.artist ?? `Artist ${n % 7}`,
      albumName: over.album ?? `Album ${n % 5}`,
      durationInMillis: over.ms ?? 120000 + ((n * 7919) % 180000),
      playParams: { id, kind: 'song', isLibrary: true },
      artwork: { url: 'https://is1-ssl.mzstatic.com/image/thumb/a/{w}x{h}bb.jpg' },
    },
  };
}

function el(tag: string, attrs: Record<string, string> = {}, text = ''): StubElement {
  const node = new StubElement(tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  node.textContent = text;
  return node;
}

interface Options {
  pathname?: string;
  hostname?: string;
  tracks?: FakeTrack[];
  sorts?: Record<string, unknown>;
  failFetch?: boolean;
}

function createHarness(options: Options = {}) {
  const body = resetStubDom();
  const tracks = options.tracks ?? [];
  // Apple's page: a scrolling column holding the header and the track list.
  const scroller = body.appendChild(el('div', { id: 'scrollable-page' }));
  scroller.rect = { top: 0, bottom: 800, left: 0, right: 1200, width: 1200, height: 800 };
  scroller.clientHeight = 800;
  const header = scroller.appendChild(el('div', { 'data-testid': 'container-detail-header' }));
  const actions = header.appendChild(el('div', { class: 'actions' }));
  const playWrap = actions.appendChild(el('div'));
  const play = playWrap.appendChild(el('button'));
  play.appendChild(el('span', { 'data-testid': 'play-icon' }));
  const shuffleWrap = actions.appendChild(el('div'));
  const shuffle = shuffleWrap.appendChild(el('button', { 'aria-label': 'Shuffle' }));
  shuffle.appendChild(el('span', { 'data-testid': 'shuffle-icon' }));
  const moreWrap = actions.appendChild(el('div'));
  moreWrap.appendChild(el('button', { 'aria-label': 'more' }));
  const section = scroller.appendChild(el('div'));
  const tracklist = section.appendChild(el('div', { 'data-testid': 'tracklist' }));
  for (const [name, label] of [['song', 'Titel'], ['secondary', 'Künstler'], ['tertiary', 'Album'], ['time', 'Dauer']]) {
    tracklist.appendChild(el('div', { 'data-testid': `tracklist-column-header-${name}` }, label));
  }

  const requests: Array<{ path: string; query: Record<string, unknown> }> = [];
  const music = vi.fn(async (requestPath: string, query: Record<string, unknown>) => {
    requests.push({ path: requestPath, query });
    if (options.failFetch) throw new Error('network');
    const offset = Number(/offset=(\d+)/.exec(requestPath)?.[1] ?? 0);
    const base = requestPath.replace(/\?.*$/, '');
    const data = tracks.slice(offset, offset + 100);
    const next = offset + 100 < tracks.length ? `${base}?offset=${offset + 100}` : undefined;
    return { data: { data, next } };
  });
  const send = vi.fn();
  const playTracks = vi.fn(async (_items: unknown[], _start: number) => true);
  const intervals: Array<() => void> = [];
  const windowListeners: Array<{ type: string; listener: (event: unknown) => void; capture: unknown }> = [];
  const window = {
    location: { hostname: options.hostname ?? 'music.apple.com', pathname: options.pathname ?? '/us/library/playlist/p.Mine1' },
    innerHeight: 800,
    AMWrapper: { ipcRenderer: { send } },
    __hydraHookedMk: { api: { music } },
    __hydraPlayTracks: playTracks,
    __hydraPlaylistSort: undefined as
      | { refresh(stored?: unknown): void; state(): { kind: string; sort: { by: string; dir: string }; tracks: number | null; drawn: number[] } | null }
      | undefined,
    addEventListener: (type: string, listener: (event: unknown) => void, capture: unknown) => {
      windowListeners.push({ type, listener, capture });
    },
  };
  const document = Object.assign(stubDom.document, {
    querySelector: (selector: string) => body.querySelector(selector),
    getElementById: (id: string) => body.querySelector(`#${id}`),
    createElementNS: (_ns: string, tag: string) => new StubElement(tag),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  const warn = vi.fn();
  const context = vm.createContext({
    window,
    document,
    URL,
    console: { warn },
    setInterval: (callback: () => void) => {
      intervals.push(callback);
      return intervals.length;
    },
    clearInterval: () => {},
  });
  const run = (sorts: Record<string, unknown> = options.sorts ?? {}) => vm.runInContext(script(sorts), context);
  run();

  const menuHost = () => body.querySelector('#hydra-playlist-sort-menu');
  const listHost = () => body.querySelector('#hydra-playlist-sort-list');
  const inShadow = (host: StubElement | null) =>
    host ? host.shadowRoot!.children.flatMap((c) => (c instanceof StubElement ? [c, ...c.descendants()] : [])) : [];
  const byClass = (host: StubElement | null, cls: string) =>
    inShadow(host).filter((e) => (e.getAttribute('class') ?? '').split(' ').includes(cls));
  const viewport = () => byClass(listHost(), 'viewport')[0];
  const rows = () => viewport().children.filter((c): c is StubElement => c instanceof StubElement);
  const rowNames = () => rows().map((row) => row.querySelector('span')?.textContent ?? row.descendants().find((d) => (d.getAttribute('class') ?? '') === 'name')?.textContent);
  const menuItems = () => byClass(menuHost(), 'item');
  const choose = (label: string) => menuItems().find((item) => item.textContent === label)!.dispatch('click');
  const captureClick = (target: StubElement) => {
    const event = { target, preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() };
    for (const entry of windowListeners) if (entry.type === 'click' && entry.capture === true) entry.listener(event);
    return event;
  };

  return {
    window,
    body,
    scroller,
    header,
    actions,
    play,
    shuffle,
    shuffleWrap,
    tracklist,
    music,
    requests,
    send,
    playTracks,
    warn,
    intervals,
    run,
    menuHost,
    listHost,
    viewport,
    rows,
    rowNames,
    menuItems,
    choose,
    captureClick,
    sortButton: () => byClass(listHost(), 'sort')[0],
    indicator: () => byClass(listHost(), 'indicator')[0],
    reset: () => byClass(listHost(), 'reset')[0],
    sorted: () => stubDom.document.documentElement!.attributes.has('data-hydra-playlist-sorted'),
    state: () => window.__hydraPlaylistSort!.state(),
  };
}

/** Let the fetch's promise chain run. */
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
async function settleAll(): Promise<void> {
  for (let i = 0; i < 30; i += 1) await settle();
}

describe('playlistSort.js', () => {
  it('does nothing on Apple Music Classical', () => {
    const h = createHarness({ hostname: 'classical.music.apple.com' });
    expect(h.window.__hydraPlaylistSort).toBeUndefined();
    expect(h.listHost()).toBeNull();
  });

  it('stays out of pages that are not playlists', () => {
    const h = createHarness({ pathname: '/us/album/some-album/1440857781' });
    expect(h.listHost()).toBeNull();
    expect(h.state()).toBeNull();
  });

  // Not in Apple's header: its Play and Shuffle sit in a grid of fixed
  // columns, and its stacking would keep the menu under the track list.
  it("puts the Sort toolbar just above Apple's list, and its menu on <body>", () => {
    const h = createHarness({ tracks: [track(1)] });
    expect(h.listHost()!.nextElementSibling).toBe(h.tracklist);
    expect(h.listHost()!.styles.get('display')).toBe('block !important');
    expect(h.sortButton()).toBeDefined();
    expect(h.menuHost()!.parentElement).toBe(h.body);
    expect(h.actions.children).toHaveLength(3);
    // Playlist order: no "Sorted by" line, no Hydra rows.
    expect(h.indicator().attributes.has('hidden')).toBe(true);
    expect(h.viewport().styles.get('display')).toBe('none');
    expect(h.sorted()).toBe(false);
    expect(h.music).not.toHaveBeenCalled();
    expect(h.state()).toEqual({ kind: 'library', sort: { by: 'playlist', dir: 'asc' }, tracks: null, drawn: [0, 0] });
  });

  it('sorts by title once every page has arrived, then hides Apple\'s list and says so', async () => {
    const tracks = Array.from({ length: 250 }, (_, i) => track(i));
    const h = createHarness({ tracks });
    h.choose(LABELS.title);
    // Apple's list stays until Hydra's has every track.
    expect(h.sorted()).toBe(false);
    expect(h.indicator().text).toContain(LABELS.loading.replace('{count}', '0'));
    await settleAll();
    expect(h.requests.map((r) => r.path)).toEqual([
      '/v1/me/library/playlists/p.Mine1/tracks',
      '/v1/me/library/playlists/p.Mine1/tracks?offset=100',
      '/v1/me/library/playlists/p.Mine1/tracks?offset=200',
    ]);
    expect(h.requests[0].query).toEqual({ limit: 100 });
    expect(h.sorted()).toBe(true);
    expect(h.indicator().text).toContain(LABELS.sortedBy.replace('{field}', LABELS.title));
    expect(h.indicator().text).toContain('↑');
    // Numbers in titles compare as numbers.
    expect(h.rowNames().slice(0, 4)).toEqual(['Song 0', 'Song 1', 'Song 2', 'Song 3']);
    expect(h.send).toHaveBeenCalledExactlyOnceWith('playlist:sort', { id: 'p.Mine1', by: 'title', dir: 'asc' });
    expect(h.state()!.tracks).toBe(250);
  });

  it('fetches a catalogue playlist through the catalogue', async () => {
    const h = createHarness({ pathname: '/gb/playlist/some-list/pl.u-Shared9', tracks: [track(1)] });
    h.choose(LABELS.artist);
    await settleAll();
    expect(h.requests[0].path).toBe('/v1/catalog/{{storefrontId}}/playlists/pl.u-Shared9/tracks');
    expect(h.state()!.kind).toBe('catalog');
  });

  it('keeps playlist order for ties, ignores case, and puts missing values last either way', async () => {
    const tracks = [
      track(0, { name: 'beta', album: '' }),
      track(1, { name: 'Alpha', album: 'Same' }),
      track(2, { name: 'alpha', album: 'Same' }),
      track(3, { name: 'Gamma', album: 'Other' }),
    ];
    const h = createHarness({ tracks });
    h.choose(LABELS.title);
    await settleAll();
    expect(h.rowNames()).toEqual(['Alpha', 'alpha', 'beta', 'Gamma']);
    h.choose(LABELS.album);
    expect(h.rowNames()).toEqual(['Gamma', 'Alpha', 'alpha', 'beta']);
    h.choose(LABELS.descending);
    expect(h.rowNames()).toEqual(['Alpha', 'alpha', 'Gamma', 'beta']);
  });

  it('sorts by duration, and reverses playlist order', async () => {
    const tracks = [track(0, { ms: 200000 }), track(1, { ms: 100000 }), track(2, { ms: 300000 })];
    const h = createHarness({ tracks });
    h.choose(LABELS.duration);
    await settleAll();
    expect(h.rowNames()).toEqual(['Song 1', 'Song 0', 'Song 2']);
    h.choose(LABELS.playlistOrder);
    h.choose(LABELS.descending);
    expect(h.rowNames()).toEqual(['Song 2', 'Song 1', 'Song 0']);
    expect(h.sorted()).toBe(true);
  });

  it('goes back to Apple\'s list on Reset, and remembers that', async () => {
    const h = createHarness({ tracks: [track(1)] });
    h.choose(LABELS.title);
    await settleAll();
    h.reset().dispatch('click');
    expect(h.sorted()).toBe(false);
    expect(h.indicator().attributes.has('hidden')).toBe(true);
    expect(h.rows()).toHaveLength(0);
    expect(h.send).toHaveBeenLastCalledWith('playlist:sort', { id: 'p.Mine1', by: 'playlist', dir: 'asc' });
  });

  it('applies a remembered sort on arrival', async () => {
    const h = createHarness({ tracks: [track(2), track(1)], sorts: { 'p.Mine1': { by: 'title', dir: 'desc' } } });
    await settleAll();
    expect(h.sorted()).toBe(true);
    expect(h.rowNames()).toEqual(['Song 2', 'Song 1']);
    expect(h.send).not.toHaveBeenCalled();
  });

  it('ignores a malformed remembered sort', () => {
    const h = createHarness({ tracks: [track(1)], sorts: { 'p.Mine1': { by: 'dateAdded', dir: 'asc' }, 'bad id': { by: 'title', dir: 'asc' } } });
    expect(h.state()!.sort).toEqual({ by: 'playlist', dir: 'asc' });
  });

  it('follows an in-page navigation to another playlist, and keeps the tracks of the same one', async () => {
    const h = createHarness({ tracks: [track(1)] });
    h.choose(LABELS.title);
    await settleAll();
    h.run({ 'p.Mine1': { by: 'title', dir: 'asc' } });
    expect(h.music).toHaveBeenCalledOnce();
    expect(h.state()!.tracks).toBe(1);

    h.window.location.pathname = '/us/library/playlist/p.Other2';
    h.run({ 'p.Mine1': { by: 'title', dir: 'asc' } });
    expect(h.state()!.sort).toEqual({ by: 'playlist', dir: 'asc' });
    expect(h.sorted()).toBe(false);

    h.window.location.pathname = '/us/home';
    h.run();
    expect(h.state()).toBeNull();
    expect(h.menuHost()).toBeNull();
    expect(h.listHost()).toBeNull();
  });

  it('drops a fetch that finishes after the page has moved on', async () => {
    const h = createHarness({ tracks: Array.from({ length: 150 }, (_, i) => track(i)) });
    h.choose(LABELS.title);
    h.window.location.pathname = '/us/library/playlist/p.Other2';
    h.run();
    await settleAll();
    expect(h.state()!.tracks).toBeNull();
    expect(h.sorted()).toBe(false);
  });

  it('stops at 10,000 tracks', async () => {
    const tracks = Array.from({ length: 10050 }, (_, i) => track(i, { id: `i.T${i}`, name: `Song ${i}` }));
    const h = createHarness({ tracks });
    h.choose(LABELS.title);
    await settleAll();
    await settleAll();
    await settleAll();
    await settleAll();
    expect(h.state()!.tracks).toBe(10000);
    expect(h.requests.length).toBeLessThanOrEqual(101);
  });

  it("leaves Apple's list in place when the tracks cannot be loaded", async () => {
    const h = createHarness({ tracks: [track(1)], failFetch: true });
    h.choose(LABELS.title);
    await settleAll();
    expect(h.sorted()).toBe(false);
    expect(h.indicator().text).toContain(LABELS.failed);
    expect(h.warn).toHaveBeenCalledExactlyOnceWith('[Hydra] playlist tracks could not be loaded');
    const click = h.captureClick(h.play.querySelector('span')!);
    expect(click.preventDefault).not.toHaveBeenCalled();
  });

  describe("Apple's Play", () => {
    it('plays the sorted order while a sort shows, and only then', async () => {
      const tracks = [track(0, { name: 'b' }), track(1, { name: 'a' }), track(2, { name: 'c' })];
      const h = createHarness({ tracks });
      const icon = h.play.querySelector('span')!;
      // Playlist order: Apple's Play is Apple's.
      expect(h.captureClick(icon).preventDefault).not.toHaveBeenCalled();
      h.choose(LABELS.title);
      // Still loading: Apple's.
      expect(h.captureClick(icon).preventDefault).not.toHaveBeenCalled();
      await settleAll();
      const click = h.captureClick(icon);
      expect(click.preventDefault).toHaveBeenCalled();
      expect(click.stopImmediatePropagation).toHaveBeenCalled();
      expect(h.playTracks).toHaveBeenCalledOnce();
      const [items, start] = h.playTracks.mock.calls[0];
      expect((items as FakeTrack[]).map((t) => t.attributes.name)).toEqual(['a', 'b', 'c']);
      expect(start).toBe(0);
      // Shuffle stays Apple's.
      expect(h.captureClick(h.shuffle.querySelector('span')!).preventDefault).not.toHaveBeenCalled();
    });

    // MusicKit keeps only the last copy of a repeated song.
    it('drops repeats before queueing, keeping the copy shown first', async () => {
      const tracks = [
        track(0, { name: 'c', id: 'i.Same' }),
        track(1, { name: 'a' }),
        track(2, { name: 'b', id: 'i.Same' }),
      ];
      const h = createHarness({ tracks });
      h.choose(LABELS.title);
      await settleAll();
      expect(h.rowNames()).toEqual(['a', 'b', 'c']);
      // Double-click the third row, the repeat shown last.
      h.rows()[2].dispatch('dblclick');
      const [items, start] = h.playTracks.mock.calls[0];
      expect((items as FakeTrack[]).map((t) => t.id)).toEqual(['i.Track1', 'i.Same']);
      expect(start).toBe(1);
    });
  });

  // Only the rows in view are drawn, so a long playlist costs no more on
  // screen than a short one.
  describe('a long playlist', () => {
    const LONG = 1500;

    async function longList() {
      const tracks = Array.from({ length: LONG }, (_, i) => track(i));
      const h = createHarness({ tracks });
      h.choose(LABELS.title);
      for (let i = 0; i < 4; i += 1) await settleAll();
      return h;
    }

    it(`draws only the visible rows of ${LONG}, sized for all of them`, async () => {
      const h = await longList();
      expect(h.state()!.tracks).toBe(LONG);
      expect(h.viewport().style.height).toBe(`${LONG * ROW_PX}px`);
      // 800px of view is 15 rows, plus 8 either side, less those above the top.
      expect(h.rows()).toHaveLength(Math.ceil(800 / ROW_PX) + 8);
      expect(h.rows()[0].getAttribute('aria-setsize')).toBe(String(LONG));
      expect(h.rows()[0].style.top).toBe('0px');
    });

    it('draws the rows that scroll into view, and only those', async () => {
      const h = await longList();
      // Scroll 1,000 rows down: the list's top is now 54,000px above the view.
      h.viewport().rect = { ...h.viewport().rect, top: -1000 * ROW_PX };
      h.scroller.dispatch('scroll');
      const drawn = h.state()!.drawn;
      expect(drawn).toEqual([1000 - 8, 1000 + 15 + 8]);
      expect(h.rows()).toHaveLength(drawn[1] - drawn[0]);
      expect(h.rows()[0].style.top).toBe(`${(1000 - 8) * ROW_PX}px`);
      expect(h.rows()[0].getAttribute('aria-posinset')).toBe(String(1000 - 8 + 1));
    });

    it('moves through rows with the keyboard, scrolling to keep the active one in view, and plays it', async () => {
      const h = await longList();
      h.viewport().dispatch('keydown', { key: 'End' });
      expect(h.viewport().getAttribute('aria-activedescendant')).toBe(`hydra-playlist-sort-row-${LONG - 1}`);
      expect(h.scroller.scrollTop).toBeGreaterThan(0);
      h.viewport().dispatch('keydown', { key: 'Home' });
      h.viewport().dispatch('keydown', { key: 'ArrowDown' });
      h.viewport().dispatch('keydown', { key: 'Enter' });
      const [items, start] = h.playTracks.mock.calls[0];
      expect((items as FakeTrack[])).toHaveLength(LONG);
      expect(start).toBe(1);
    });
  });

  it("names its columns with Apple's own column headers", async () => {
    const h = createHarness({ tracks: [track(1)] });
    h.choose(LABELS.title);
    await settleAll();
    const columns = h.listHost()!.shadowRoot!.children
      .flatMap((c) => (c instanceof StubElement ? [c, ...c.descendants()] : []))
      .find((e) => e.getAttribute('class') === 'columns')!;
    expect(columns.children.map((c) => (c as StubElement).textContent)).toEqual(['Titel', 'Künstler', 'Album', 'Dauer']);
  });

  it('opens the menu with the chosen field focused and closes on Escape, back to the button', () => {
    const h = createHarness({ tracks: [track(1)] });
    h.sortButton().dispatch('click');
    expect(h.sortButton().getAttribute('aria-expanded')).toBe('true');
    const items = h.menuItems();
    expect(items.map((item) => item.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false', 'false', 'false', 'true', 'false']);
    expect(h.menuHost()!.shadowRoot!.activeElement).toBe(items[0]);
    items[0].dispatch('keydown', { key: 'ArrowDown' });
    expect(h.menuHost()!.shadowRoot!.activeElement).toBe(items[1]);
    items[1].dispatch('keydown', { key: 'Escape' });
    expect(h.sortButton().getAttribute('aria-expanded')).toBe('false');
    expect(h.listHost()!.shadowRoot!.activeElement).toBe(h.sortButton());
  });

  it("keeps its key presses from Apple's shortcuts", () => {
    const h = createHarness({ tracks: [track(1)] });
    h.sortButton().dispatch('keydown', { key: ' ' });
    h.sortButton().dispatch('click');
    h.menuItems()[0].dispatch('keydown', { key: ' ' });
    h.viewport().dispatch('keydown', { key: ' ' });
    expect(stubDom.bubbledToBody.filter((event) => event.type.startsWith('key'))).toHaveLength(0);
  });

  it('puts its toolbar back when Apple re-renders it away', () => {
    const h = createHarness({ tracks: [track(1)] });
    h.tracklist.parentElement!.removeChild(h.listHost()!);
    expect(h.listHost()).toBeNull();
    for (const tick of h.intervals) tick();
    expect(h.listHost()!.nextElementSibling).toBe(h.tracklist);
  });

  it('never writes markup', () => {
    for (const sink of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write', 'eval(', 'new Function']) {
      expect(source, sink).not.toContain(sink);
    }
  });
});
