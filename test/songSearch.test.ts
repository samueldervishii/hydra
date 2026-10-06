// assets/songSearch.js is injected into music.apple.com. No renderer runs
// here, so the script runs in a VM against a stand-in document that models
// what it uses: elements, a shadow root, focus, bubbling and timers.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

import { SEARCH_LABELS_TOKEN } from '../src/i18n';

const source = fs.readFileSync(
  path.join(__dirname, '..', 'assets', 'songSearch.js'),
  'utf-8',
);

// Non-English labels show the injected translations reach the panel.
const LABELS = {
  search: 'Titel suchen',
  searching: 'Suche läuft …',
  noResults: 'Keine Titel gefunden',
  failed: 'Suche fehlgeschlagen',
  allResults: 'Alle Ergebnisse in Apple Music',
  explicit: 'Explizit',
};

const script = source.replace(SEARCH_LABELS_TOKEN, () => JSON.stringify(LABELS));

interface StubEvent {
  type: string;
  key?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  stopped: boolean;
  preventDefault: ReturnType<typeof vi.fn>;
  stopPropagation: () => void;
}

type Listener = (event: StubEvent) => void;

class StubNode {
  parentNode: StubNode | null = null;
  children: StubNode[] = [];

  appendChild<T extends StubNode>(child: T): T {
    if (child.parentNode) {
      child.parentNode.children = child.parentNode.children.filter((c) => c !== child);
    }
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  replaceChildren(...nodes: StubNode[]): void {
    for (const child of this.children) child.parentNode = null;
    this.children = [];
    for (const node of nodes) this.appendChild(node);
  }

  /** The next node up, crossing from a shadow root to its host. */
  get upward(): StubNode | null {
    return this instanceof StubShadowRoot ? this.host : this.parentNode;
  }

  get isConnected(): boolean {
    for (let node: StubNode | null = this; node; node = node.upward) {
      if (node === body) return true;
    }
    return false;
  }
}

class StubElement extends StubNode {
  readonly tagName: string;
  readonly attributes = new Map<string, string>();
  readonly listeners: Array<{ type: string; listener: Listener }> = [];
  readonly styles = new Map<string, string>();
  readonly style = {
    setProperty: (name: string, value: string, priority?: string) => {
      this.styles.set(name, priority ? `${value} !${priority}` : value);
    },
  };
  textContent = '';
  value = '';
  shadowRoot: StubShadowRoot | null = null;
  readonly select = vi.fn();
  readonly scrollIntoView = vi.fn();

  constructor(tagName: string) {
    super();
    this.tagName = tagName;
  }

  get id(): string {
    return this.attributes.get('id') ?? '';
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, String(value));
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  addEventListener(type: string, listener: Listener): void {
    this.listeners.push({ type, listener });
  }

  attachShadow(): StubShadowRoot {
    this.shadowRoot = new StubShadowRoot(this);
    return this.shadowRoot;
  }

  focus(): void {
    for (let node: StubNode | null = this.parentNode; node; node = node.upward) {
      if (node instanceof StubShadowRoot) {
        node.activeElement = this;
        document.activeElement = node.host;
        return;
      }
    }
    document.activeElement = this;
  }

  /** Dispatch an event here and bubble it, as far as stopPropagation() allows. */
  dispatch(type: string, init: Partial<StubEvent> = {}): StubEvent {
    const event: StubEvent = {
      type,
      stopped: false,
      preventDefault: vi.fn(),
      stopPropagation() {
        event.stopped = true;
      },
      ...init,
    };
    for (let node: StubNode | null = this; node && !event.stopped; node = node.upward) {
      if (node instanceof StubElement) {
        for (const entry of node.listeners) if (entry.type === type) entry.listener(event);
      }
    }
    if (!event.stopped) bubbledToBody.push(event);
    return event;
  }

  /** Every descendant, depth first, without crossing into a shadow root. */
  descendants(): StubElement[] {
    const found: StubElement[] = [];
    for (const child of this.children) {
      if (child instanceof StubElement) found.push(child, ...child.descendants());
    }
    return found;
  }

  /** The text of this element and its descendants. */
  get text(): string {
    return this.textContent + this.descendants().map((d) => d.textContent).join('');
  }
}

class StubShadowRoot extends StubNode {
  activeElement: StubElement | null = null;
  constructor(readonly host: StubElement) {
    super();
  }
}

let body: StubElement;
let bubbledToBody: StubEvent[];
const document = {
  activeElement: null as StubElement | null,
  body: null as StubElement | null,
  documentElement: null as StubElement | null,
  createElement: (tag: string) => new StubElement(tag),
};

/** A catalogue search answer with the shape mk.api.music() returns. */
function answer(...items: unknown[]) {
  return { data: { results: { songs: { data: items } } } };
}

function song(id: string, name: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    type: 'songs',
    attributes: {
      name,
      artistName: `${name} Artist`,
      albumName: `${name} Album`,
      durationInMillis: 320357,
      artwork: {
        url: 'https://is1-ssl.mzstatic.com/image/thumb/Music/v4/a/b.jpg/{w}x{h}bb.jpg',
      },
      playParams: { id, kind: 'song' },
      ...extra,
    },
  };
}

function createHarness({
  hostname = 'music.apple.com',
  pathname = '/al/new',
  playSongs = true,
}: { hostname?: string; pathname?: string; playSongs?: boolean } = {}) {
  body = new StubElement('body');
  bubbledToBody = [];
  document.body = body;
  document.documentElement = body;
  document.activeElement = body;

  const timeouts = new Map<number, () => void>();
  let nextTimeout = 0;
  const music = vi.fn((_path: string, _query: Record<string, unknown>) =>
    Promise.resolve(answer() as unknown),
  );
  const window = {
    location: { hostname, pathname },
    history: {
      state: null as unknown,
      pushState: vi.fn((state: unknown, _title: string, url: string) => {
        window.history.state = state;
        window.location.pathname = url;
      }),
    },
    dispatchEvent: vi.fn(),
    addEventListener: vi.fn(),
    __hydraHookedMk: { api: { music }, storefrontId: 'al' } as unknown,
    __hydraPlaySongs: playSongs ? vi.fn() : undefined,
    __hydraSongSearch: undefined as { open(): void; close(): void } | undefined,
  };
  class PopStateEvent {
    constructor(
      readonly type: string,
      readonly init: unknown,
    ) {}
  }
  const context = vm.createContext({
    window,
    document,
    URL,
    PopStateEvent,
    console,
    setTimeout: (callback: () => void) => {
      const id = ++nextTimeout;
      timeouts.set(id, callback);
      return id;
    },
    clearTimeout: (id: number) => {
      timeouts.delete(id);
    },
  });
  const run = () => vm.runInContext(script, context);
  run();

  const host = () => body.children.find((c) => c instanceof StubElement && c.id === 'hydra-song-search') as
    | StubElement
    | undefined;
  const shadow = () => host()!.shadowRoot!;
  const inShadow = () =>
    shadow().children.flatMap((c) => (c instanceof StubElement ? [c, ...c.descendants()] : []));
  const find = (cls: string) => inShadow().find((e) => e.getAttribute('class') === cls)!;
  const input = () => find('input');
  const rows = () => inShadow().filter((e) => e.getAttribute('role') === 'option');

  return {
    window,
    music,
    run,
    host,
    shadow,
    input,
    rows,
    status: () => find('status'),
    allResults: () => find('all'),
    backdrop: () => find('backdrop'),
    panel: () => find('panel'),
    isOpen: () => host()!.styles.get('display') === 'block !important',
    pendingTimers: () => timeouts.size,
    runTimers: () => {
      for (const [id, callback] of [...timeouts]) {
        timeouts.delete(id);
        callback();
      }
    },
    type: (value: string) => {
      input().value = value;
      input().dispatch('input');
    },
    key: (key: string) => input().dispatch('keydown', { key }),
  };
}

/** Let resolved promises from the VM run their handlers. */
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('songSearch.js', () => {
  it('does nothing on Apple Music Classical', () => {
    const { window, host } = createHarness({ hostname: 'classical.music.apple.com' });
    expect(host()).toBeUndefined();
    expect(window.__hydraSongSearch).toBeUndefined();
    expect(window.addEventListener).not.toHaveBeenCalled();
  });

  it('mounts one hidden panel and exposes open and close', () => {
    const { window, host, isOpen } = createHarness();
    expect(host()).toBeDefined();
    expect(isOpen()).toBe(false);
    expect(typeof window.__hydraSongSearch?.open).toBe('function');
    expect(typeof window.__hydraSongSearch?.close).toBe('function');
  });

  // main.ts re-runs the script on every in-page navigation.
  it('closes on a repeat run and adds no second panel or listener', () => {
    const { window, run, isOpen } = createHarness();
    window.__hydraSongSearch!.open();
    run();
    expect(isOpen()).toBe(false);
    expect(body.children).toHaveLength(1);
  });

  it('opens with the field focused and its term selected', () => {
    const { window, isOpen, input, shadow } = createHarness();
    window.__hydraSongSearch!.open();
    expect(isOpen()).toBe(true);
    expect(shadow().activeElement).toBe(input());
    expect(input().select).toHaveBeenCalled();
  });

  // Ctrl+K lives in src/shortcuts.ts: a focused iframe keeps keys from the page.
  it('registers nothing on window', () => {
    const { window } = createHarness();
    expect(window.addEventListener).not.toHaveBeenCalled();
  });

  it('searches songs once typing pauses, for the latest term only', async () => {
    const { music, type, pendingTimers, runTimers } = createHarness();
    type('daf');
    type('  daft punk  ');
    expect(music).not.toHaveBeenCalled();
    expect(pendingTimers()).toBe(1);
    runTimers();
    expect(music).toHaveBeenCalledExactlyOnceWith('/v1/catalog/{{storefrontId}}/search', {
      term: 'daft punk',
      types: 'songs',
      limit: 25,
    });
  });

  it('cuts an oversized term', () => {
    const { music, type, runTimers } = createHarness();
    type('a'.repeat(500));
    runTimers();
    expect(music.mock.calls[0][1].term).toHaveLength(200);
  });

  it('clears the results at once when the field is emptied', async () => {
    const { music, type, runTimers, rows, pendingTimers } = createHarness();
    music.mockResolvedValueOnce(answer(song('1', 'One')));
    type('one');
    runTimers();
    await settle();
    expect(rows()).toHaveLength(1);
    type('   ');
    expect(rows()).toHaveLength(0);
    expect(pendingTimers()).toBe(0);
  });

  it('shows each playable song as text, with sized artwork from Apple only', async () => {
    const { music, type, runTimers, rows, status } = createHarness();
    music.mockResolvedValueOnce(
      answer(
        song('1', '<b>One</b>', { contentRating: 'explicit' }),
        song('2', 'Two', { artwork: { url: 'https://evil.test/{w}x{h}.jpg' } }),
        song('i.abc', 'Library item'),
        { id: '3', attributes: { name: 'No play params' } },
        song('4', 'Long', { durationInMillis: 3_723_000, albumName: undefined }),
      ),
    );
    type('x');
    runTimers();
    await settle();
    const shown = rows();
    expect(shown).toHaveLength(3);
    expect(shown[0].text).toContain('<b>One</b>');
    expect(shown[0].text).toContain('E');
    expect(shown[0].text).toContain('<b>One</b> Artist — <b>One</b> Album');
    expect(shown[0].text).toContain('5:20');
    const art = (row: StubElement) => row.descendants().find((d) => d.tagName === 'img')!;
    expect(art(shown[0]).getAttribute('src')).toBe(
      'https://is1-ssl.mzstatic.com/image/thumb/Music/v4/a/b.jpg/80x80bb.jpg',
    );
    expect(art(shown[1]).getAttribute('src')).toBeNull();
    expect(shown[2].text).toContain('1:02:03');
    expect(shown[2].text).toContain('Long Artist');
    expect(shown[2].text).not.toContain('—');
    expect(status().textContent).toBe('');
  });

  it('labels the explicit badge', async () => {
    const { music, type, runTimers, rows } = createHarness();
    music.mockResolvedValueOnce(answer(song('1', 'One', { contentRating: 'explicit' })));
    type('x');
    runTimers();
    await settle();
    const badge = rows()[0].descendants().find((d) => d.getAttribute('class') === 'explicit')!;
    expect(badge.getAttribute('aria-label')).toBe(LABELS.explicit);
  });

  // Apple lists a track's explicit and clean versions as two songs.
  describe('duplicates', () => {
    const version = (id: string, name: string, extra: Record<string, unknown> = {}) =>
      song(id, name, { artistName: 'Ayo', albumName: 'Memphis', ...extra });

    async function shownFor(...items: unknown[]) {
      const h = createHarness();
      h.music.mockResolvedValueOnce(answer(...items));
      h.window.__hydraSongSearch!.open();
      h.type('x');
      h.runTimers();
      await settle();
      return h;
    }
    const names = (h: Awaited<ReturnType<typeof shownFor>>) =>
      h.rows().map((row) => row.descendants().find((d) => d.getAttribute('class') === 'name')!.textContent);

    it('keeps the explicit version in the place of the first', async () => {
      const h = await shownFor(
        version('1', 'Intro'),
        version('2', 'Memphis, Pt. 2'),
        version('3', 'Outro'),
        version('4', 'Memphis, Pt. 2', { contentRating: 'explicit' }),
      );
      expect(names(h)).toEqual(['Intro', 'Memphis, Pt. 2', 'Outro']);
      h.rows()[1].dispatch('click');
      expect(h.window.__hydraPlaySongs).toHaveBeenCalledExactlyOnceWith(['1', '4', '3'], 1);
    });

    it('keeps the first when neither or both are explicit', async () => {
      const h = await shownFor(
        version('1', 'Clean'),
        version('2', 'Clean'),
        version('3', 'Both', { contentRating: 'explicit' }),
        version('4', 'Both', { contentRating: 'explicit' }),
      );
      h.rows()[0].dispatch('click');
      expect(h.window.__hydraPlaySongs).toHaveBeenCalledExactlyOnceWith(['1', '3'], 0);
    });

    it('matches regardless of case, spacing and character width', async () => {
      const h = await shownFor(
        version('1', 'Memphis,  Pt. 2', { artistName: 'AYO', albumName: ' memphis ' }),
        version('2', 'memphis, pt. 2', { contentRating: 'explicit' }),
        version('3', 'Ｍｅｍｐｈｉｓ, Pt. 2'),
      );
      h.rows()[0].dispatch('click');
      expect(h.window.__hydraPlaySongs).toHaveBeenCalledExactlyOnceWith(['2'], 0);
    });

    it('keeps versions whose title, artist or album differ', async () => {
      const h = await shownFor(
        version('1', 'Memphis, Pt. 2'),
        version('2', 'Memphis, Pt. 2 (Remix)', { contentRating: 'explicit' }),
        version('3', 'Memphis, Pt. 2 - Live'),
        version('4', 'Memphis, Pt. 2 (Sped Up)'),
        version('5', 'Memphis, Pt. 2', { artistName: 'Someone Else' }),
        version('6', 'Memphis, Pt. 2', { albumName: 'Singles' }),
      );
      expect(h.rows()).toHaveLength(6);
    });
  });

  // Searching an artist listed their features before their own songs.
  describe('ranking', () => {
    const by = (id: string, artistName: string) => song(id, `Song ${id}`, { artistName });

    async function playFirst(term: string, ...items: unknown[]) {
      const h = createHarness();
      h.music.mockResolvedValueOnce(answer(...items));
      h.window.__hydraSongSearch!.open();
      h.type(term);
      h.runTimers();
      await settle();
      h.rows()[0].dispatch('click');
      return (h.window.__hydraPlaySongs as ReturnType<typeof vi.fn>).mock.calls[0][0];
    }

    it("lists the artist's own songs first, each group in Apple's order", async () => {
      const queue = await playFirst(
        'nle choppa',
        by('1', 'Lil Baby & NLE Choppa'),
        by('2', 'NLE Choppa'),
        by('3', 'Moneybagg Yo, NLE Choppa'),
        by('4', 'NLE Choppa & Lil Wayne'),
        by('5', 'Polo G'),
        by('6', 'NLE Choppa, Mulatto'),
      );
      expect(queue).toEqual(['2', '4', '6', '1', '3', '5']);
    });

    it('compares the artist without regard to case or spacing', async () => {
      const queue = await playFirst('  NLE   choppa ', by('1', 'Lil Baby'), by('2', 'nle Choppa'));
      expect(queue).toEqual(['2', '1']);
    });

    it("keeps Apple's order when the term names no primary artist", async () => {
      const queue = await playFirst(
        'shotta flow',
        by('1', 'Lil Baby & NLE Choppa'),
        by('2', 'NLE Choppa'),
        by('3', 'Polo G'),
      );
      expect(queue).toEqual(['1', '2', '3']);
    });

    // A feature credit is not the primary artist, even when it is the term.
    it('does not promote a song for a featured artist alone', async () => {
      const queue = await playFirst('nle choppa', by('1', 'Polo G'), by('2', 'Lil Baby & NLE Choppa'));
      expect(queue).toEqual(['1', '2']);
    });

    it('ranks after removing duplicates, and the highlight starts on the top song', async () => {
      const h = createHarness();
      h.music.mockResolvedValueOnce(
        answer(
          song('1', 'Shotta Flow', { artistName: 'Polo G & NLE Choppa', albumName: 'A' }),
          song('2', 'Camelot', { artistName: 'NLE Choppa', albumName: 'B' }),
          song('3', 'Camelot', { artistName: 'NLE Choppa', albumName: 'B', contentRating: 'explicit' }),
        ),
      );
      h.window.__hydraSongSearch!.open();
      h.type('nle choppa');
      h.runTimers();
      await settle();
      expect(h.rows()).toHaveLength(2);
      expect(h.rows()[0].getAttribute('aria-selected')).toBe('true');
      h.key('Enter');
      expect(h.window.__hydraPlaySongs).toHaveBeenCalledExactlyOnceWith(['3', '1'], 0);
    });
  });

  it('shows at most 25 songs', async () => {
    const { music, type, runTimers, rows } = createHarness();
    music.mockResolvedValueOnce(
      answer(...Array.from({ length: 30 }, (_, i) => song(String(i + 1), `Song ${i}`))),
    );
    type('x');
    runTimers();
    await settle();
    expect(rows()).toHaveLength(25);
  });

  it('drops an older answer that arrives after a newer one', async () => {
    const { music, type, runTimers, rows } = createHarness();
    let resolveOld!: (value: unknown) => void;
    music.mockReturnValueOnce(new Promise((resolve) => (resolveOld = resolve)));
    music.mockResolvedValueOnce(answer(song('2', 'New')));
    type('old');
    runTimers();
    type('new');
    runTimers();
    await settle();
    resolveOld(answer(song('1', 'Old')));
    await settle();
    expect(rows().map((r) => r.text)).toEqual([expect.stringContaining('New')]);
  });

  it('says when nothing was found', async () => {
    const { type, runTimers, status } = createHarness();
    type('zzzz');
    runTimers();
    expect(status().textContent).toBe(LABELS.searching);
    await settle();
    expect(status().textContent).toBe(LABELS.noResults);
  });

  it('reports a failed search without logging the term', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { music, type, runTimers, status } = createHarness();
      music.mockRejectedValueOnce(new Error('private term'));
      type('private term');
      runTimers();
      await settle();
      expect(status().textContent).toBe(LABELS.failed);
      expect(warn).toHaveBeenCalledExactlyOnceWith('[Hydra] song search failed');
    } finally {
      warn.mockRestore();
    }
  });

  it('reports a failed search while MusicKit is not ready', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { window, type, runTimers, status } = createHarness();
      window.__hydraHookedMk = undefined;
      type('x');
      runTimers();
      await settle();
      expect(status().textContent).toBe(LABELS.failed);
    } finally {
      warn.mockRestore();
    }
  });

  it('queues every result from the clicked one and closes', async () => {
    const { window, music, type, runTimers, rows, isOpen, input } = createHarness();
    const before = new StubElement('button');
    body.appendChild(before);
    before.focus();
    window.__hydraSongSearch!.open();
    music.mockResolvedValueOnce(answer(song('1', 'One'), song('2', 'Two'), song('3', 'Three')));
    type('x');
    runTimers();
    await settle();
    expect(document.activeElement).not.toBe(before);
    rows()[1].dispatch('click');
    expect(window.__hydraPlaySongs).toHaveBeenCalledExactlyOnceWith(['1', '2', '3'], 1);
    expect(isOpen()).toBe(false);
    expect(document.activeElement).toBe(before);
    expect(input().value).toBe('x');
  });

  it('keeps the panel open and reports it when the hook offers no player', async () => {
    const { window, music, type, runTimers, rows, isOpen, status } = createHarness({
      playSongs: false,
    });
    window.__hydraSongSearch!.open();
    music.mockResolvedValueOnce(answer(song('1', 'One')));
    type('x');
    runTimers();
    await settle();
    rows()[0].dispatch('click');
    expect(isOpen()).toBe(true);
    expect(status().textContent).toBe(LABELS.failed);
  });

  it('moves the highlight with the arrow keys and plays it on Enter', async () => {
    const { window, music, type, runTimers, rows, input, key } = createHarness();
    window.__hydraSongSearch!.open();
    music.mockResolvedValueOnce(answer(song('1', 'One'), song('2', 'Two'), song('3', 'Three')));
    type('x');
    runTimers();
    await settle();
    const selected = () => rows().map((r) => r.getAttribute('aria-selected'));
    expect(selected()).toEqual(['true', 'false', 'false']);
    key('ArrowDown');
    key('ArrowDown');
    key('ArrowDown');
    expect(selected()).toEqual(['false', 'false', 'true']);
    expect(input().getAttribute('aria-activedescendant')).toBe(rows()[2].id);
    expect(rows()[2].scrollIntoView).toHaveBeenCalled();
    key('ArrowUp');
    const enter = key('Enter');
    expect(enter.preventDefault).toHaveBeenCalled();
    expect(window.__hydraPlaySongs).toHaveBeenCalledExactlyOnceWith(['1', '2', '3'], 1);
  });

  it('plays the first result once it arrives when Enter comes first', async () => {
    const { window, music, type, key, runTimers } = createHarness();
    window.__hydraSongSearch!.open();
    music.mockResolvedValueOnce(answer(song('7', 'Seven'), song('8', 'Eight')));
    type('x');
    // The debounce is still waiting when Enter comes.
    key('Enter');
    expect(window.__hydraPlaySongs).not.toHaveBeenCalled();
    runTimers();
    await settle();
    expect(window.__hydraPlaySongs).toHaveBeenCalledExactlyOnceWith(['7', '8'], 0);
  });

  it('forgets an early Enter when the term changes', async () => {
    const { window, music, type, key, runTimers } = createHarness();
    window.__hydraSongSearch!.open();
    music.mockResolvedValueOnce(answer(song('7', 'Seven')));
    type('x');
    key('Enter');
    type('xy');
    runTimers();
    await settle();
    expect(window.__hydraPlaySongs).not.toHaveBeenCalled();
  });

  it('closes on Escape and on a click outside the panel', () => {
    const { window, isOpen, key, backdrop } = createHarness();
    window.__hydraSongSearch!.open();
    key('Escape');
    expect(isOpen()).toBe(false);
    window.__hydraSongSearch!.open();
    backdrop().dispatch('click');
    expect(isOpen()).toBe(false);
  });

  it('keeps Tab between the field and the All results button', () => {
    const { window, key, shadow, input, allResults } = createHarness();
    window.__hydraSongSearch!.open();
    const tab = key('Tab');
    expect(tab.preventDefault).toHaveBeenCalled();
    expect(shadow().activeElement).toBe(allResults());
    allResults().dispatch('keydown', { key: 'Tab' });
    expect(shadow().activeElement).toBe(input());
  });

  // Apple's page shortcuts would otherwise see a space typed in the field.
  it('keeps keys typed in the panel from reaching the page', () => {
    const { window, input } = createHarness();
    window.__hydraSongSearch!.open();
    for (const type of ['keydown', 'keyup', 'keypress']) {
      input().dispatch(type, { key: ' ' });
    }
    expect(bubbledToBody).toHaveLength(0);
  });

  it('opens Apple search for the term in-app and closes', () => {
    const { window, type, allResults, isOpen } = createHarness();
    window.__hydraSongSearch!.open();
    type('  daft punk & co  ');
    allResults().dispatch('click');
    expect(isOpen()).toBe(false);
    expect(window.history.pushState).toHaveBeenCalledExactlyOnceWith(
      {},
      '',
      '/al/search?term=daft%20punk%20%26%20co',
    );
    expect(window.dispatchEvent).toHaveBeenCalledOnce();
    expect(window.dispatchEvent.mock.calls[0][0]).toMatchObject({ type: 'popstate' });
  });

  it("falls back to MusicKit's storefront off a storefront path", () => {
    const { window, allResults } = createHarness({ pathname: '/library/songs' });
    window.__hydraSongSearch!.open();
    allResults().dispatch('click');
    expect(window.history.pushState).toHaveBeenCalledExactlyOnceWith({}, '', '/al/search');
  });

  it('uses the translated labels', () => {
    const { input, allResults, panel } = createHarness();
    expect(input().getAttribute('placeholder')).toBe(LABELS.search);
    expect(panel().getAttribute('aria-label')).toBe(LABELS.search);
    expect(allResults().textContent).toBe(LABELS.allResults);
  });

  it('carries the label token that src/main.ts substitutes', () => {
    expect(source).toContain(SEARCH_LABELS_TOKEN);
  });

  it('is unpacked from the asar archive, because main.ts reads it with fs', () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'),
    ) as { build: { asarUnpack: string[] } };
    expect(pkg.build.asarUnpack).toContain('assets/songSearch.js');
  });

  // Everything shown is text, the page's scrolling stays on the compositor,
  // and nothing watches the whole document (see AGENTS.md).
  it('writes no markup, adds no wheel listener and no observer', () => {
    expect(source).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML/);
    expect(source).not.toMatch(/["']wheel["']/);
    expect(source).not.toMatch(/MutationObserver/);
    expect(source).not.toMatch(/backdrop-filter/);
  });
});
