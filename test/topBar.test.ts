// assets/topBar.js replaces Apple's sidebar on music.apple.com, and
// assets/topBar.css is the layout it switches on. No renderer runs here, so the
// script runs in a VM against a stand-in document whose computed styles follow
// the stylesheet's gate, or ignore it to model a layout Apple has changed.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

import { TOP_BAR_LABELS_TOKEN } from '../src/i18n';
import { TOP_BAR_LAYOUT_WARNING, TOP_BAR_REQUEST_ATTRIBUTE } from '../src/navigation';

const source = fs.readFileSync(path.join(__dirname, '..', 'assets', 'topBar.js'), 'utf-8');
const css = fs.readFileSync(path.join(__dirname, '..', 'assets', 'topBar.css'), 'utf-8');
const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');

// Non-English labels show the injected translations reach the bar.
const LABELS = {
  back: 'Zurück',
  home: 'Startseite',
  search: 'Suchen',
  allPlaylists: 'Alle Playlists',
  settings: 'Einstellungen',
};
const script = source.replace(TOP_BAR_LABELS_TOKEN, () => JSON.stringify(LABELS));

type Listener = () => void;

class StubNode {
  parentNode: StubNode | null = null;
  children: StubNode[] = [];

  appendChild<T extends StubNode>(child: T): T {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  get isConnected(): boolean {
    for (let node: StubNode | null = this; node; node = node.parentNode) {
      if (node === body) return true;
    }
    return false;
  }
}

class StubElement extends StubNode {
  readonly attributes = new Map<string, string>();
  readonly listeners: Array<{ type: string; listener: Listener }> = [];
  readonly styles = new Map<string, string>();
  readonly style = {
    setProperty: (name: string, value: string, priority?: string) => {
      this.styles.set(name, priority ? `${value} !${priority}` : value);
    },
    removeProperty: (name: string) => {
      this.styles.delete(name);
    },
  };
  textContent = '';
  shadowRoot: StubNode | null = null;

  constructor(readonly tagName: string) {
    super();
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, String(value));
  }
  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }
  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }
  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }
  addEventListener(type: string, listener: Listener): void {
    this.listeners.push({ type, listener });
  }
  attachShadow(): StubNode {
    this.shadowRoot = new StubNode();
    return this.shadowRoot;
  }
  click(): void {
    for (const entry of this.listeners) if (entry.type === 'click') entry.listener();
  }
}

let body: StubElement;

function descendants(node: StubNode): StubElement[] {
  const found: StubElement[] = [];
  for (const child of node.children) {
    if (child instanceof StubElement) found.push(child, ...descendants(child));
  }
  return found;
}

function createHarness({
  hostname = 'music.apple.com',
  pathname = '/al/new',
  requested = true,
  signedIn = true,
  musicKitReady = true,
  storefrontId = 'al' as unknown,
  container = true,
  header = true,
  stylesheetTakes = true,
  bridge = true,
  canGoBack = true as boolean | undefined,
} = {}) {
  body = new StubElement('body');
  const html = new StubElement('html');
  if (requested) html.setAttribute(TOP_BAR_REQUEST_ATTRIBUTE, '');
  const appContainer = container ? new StubElement('div') : null;
  const sidebar = header ? new StubElement('div') : null;

  const mkListeners = new Map<string, Listener>();
  const mk = {
    isAuthorized: signedIn,
    storefrontId,
    addEventListener: vi.fn((event: string, listener: Listener) => mkListeners.set(event, listener)),
    removeEventListener: vi.fn(),
  };
  const intervals = new Map<number, () => void>();
  let nextInterval = 0;
  const send = vi.fn();
  const location = { hostname, pathname };
  const window = {
    location,
    history: {
      state: null as unknown,
      pushState: vi.fn((state: unknown, _title: string, url: string) => {
        window.history.state = state;
        location.pathname = url;
      }),
    },
    dispatchEvent: vi.fn(),
    AMWrapper: bridge ? { ipcRenderer: { send } } : undefined,
    __hydraHookedMk: (musicKitReady ? mk : undefined) as unknown,
    __hydraSongSearch: { open: vi.fn(), isOpen: vi.fn(() => false) },
    navigation: canGoBack === undefined ? undefined : { canGoBack },
    __hydraTopBar: undefined as { update(): void } | undefined,
    // The stylesheet's effect: with the gate set, the sidebar is hidden and
    // the strip reserved, unless Apple's layout no longer matches it.
    getComputedStyle: (element: StubElement): { display?: string; paddingTop?: string } => {
      const gated = stylesheetTakes && html.hasAttribute('data-hydra-top-bar');
      if (element === sidebar) return { display: gated ? 'none' : 'grid' };
      if (element === appContainer) return { paddingTop: gated ? '56px' : '0px' };
      return {};
    },
  };
  const document = {
    body,
    documentElement: html,
    createElement: (tag: string) => new StubElement(tag),
    createElementNS: (_ns: string, tag: string) => new StubElement(tag),
    querySelector: (selector: string) => {
      if (selector === '.app-container') return appContainer;
      if (selector === '[data-testid="header"]') return sidebar;
      return null;
    },
  };
  class PopStateEvent {
    constructor(readonly type: string, readonly init: unknown) {}
  }
  const warn = vi.fn();
  const context = vm.createContext({
    window,
    document,
    PopStateEvent,
    console: { warn, log: vi.fn() },
    setInterval: (callback: () => void) => {
      const id = ++nextInterval;
      intervals.set(id, callback);
      return id;
    },
    clearInterval: (id: number) => {
      intervals.delete(id);
    },
  });
  const run = () => vm.runInContext(script, context);
  run();

  const host = () =>
    body.children.find((c) => c instanceof StubElement && c.getAttribute('id') === 'hydra-top-bar') as
      | StubElement
      | undefined;
  const buttons = () => (host() ? descendants(host()!.shadowRoot!).filter((e) => e.tagName === 'button') : []);
  const button = (page: string) => buttons().find((b) => b.getAttribute('data-hydra-page') === page)!;

  return {
    window,
    html,
    mk,
    send,
    warn,
    run,
    host,
    buttons,
    button,
    intervals,
    shown: () => host()?.styles.get('display') === 'block !important',
    active: () => html.hasAttribute('data-hydra-top-bar'),
    signIn: (value: boolean) => {
      mk.isAuthorized = value;
      mkListeners.get('authorizationStatusDidChange')?.();
    },
    runIntervals: () => {
      for (const callback of [...intervals.values()]) callback();
    },
    makeMusicKitReady: () => {
      window.__hydraHookedMk = mk;
    },
  };
}

describe('topBar.js', () => {
  it('carries the label token that src/main.ts substitutes', () => {
    expect(source).toContain(TOP_BAR_LABELS_TOKEN);
  });

  it('prints exactly the warning src/main.ts relays', () => {
    expect(source).toContain(`"${TOP_BAR_LAYOUT_WARNING}"`);
  });

  it('does nothing on Apple Music Classical', () => {
    const { window, host, active } = createHarness({ hostname: 'classical.music.apple.com' });
    expect(window.__hydraTopBar).toBeUndefined();
    expect(host()).toBeUndefined();
    expect(active()).toBe(false);
  });

  it('replaces the sidebar when asked, signed in and the layout holds', () => {
    const { shown, active, buttons } = createHarness();
    expect(active()).toBe(true);
    expect(shown()).toBe(true);
    expect(buttons().map((b) => b.getAttribute('aria-label'))).toEqual([
      LABELS.back,
      LABELS.home,
      LABELS.search,
      LABELS.allPlaylists,
      LABELS.settings,
    ]);
    for (const b of buttons()) expect(b.getAttribute('title')).toBe(b.getAttribute('aria-label'));
  });

  it('keeps Apple\'s sidebar when the Apple sidebar is chosen', () => {
    const { host, active } = createHarness({ requested: false });
    expect(active()).toBe(false);
    expect(host()).toBeUndefined();
  });

  // Apple's Sign In button and account menu live in the sidebar.
  it('keeps Apple\'s sidebar while signed out and switches once signed in', () => {
    const h = createHarness({ signedIn: false });
    expect(h.active()).toBe(false);
    expect(h.host()).toBeUndefined();
    h.signIn(true);
    expect(h.active()).toBe(true);
    expect(h.shown()).toBe(true);
    h.signIn(false);
    expect(h.active()).toBe(false);
    expect(h.shown()).toBe(false);
  });

  it('follows the setting when src/navigation.ts asks it to re-evaluate', () => {
    const h = createHarness();
    h.html.removeAttribute(TOP_BAR_REQUEST_ATTRIBUTE);
    h.window.__hydraTopBar!.update();
    expect(h.active()).toBe(false);
    expect(h.shown()).toBe(false);
    h.html.setAttribute(TOP_BAR_REQUEST_ATTRIBUTE, '');
    h.window.__hydraTopBar!.update();
    expect(h.active()).toBe(true);
    expect(h.shown()).toBe(true);
  });

  it('waits for MusicKit, then stops waiting', () => {
    const h = createHarness({ musicKitReady: false });
    expect(h.active()).toBe(false);
    expect(h.intervals.size).toBe(1);
    h.runIntervals();
    expect(h.intervals.size).toBe(1);
    h.makeMusicKitReady();
    h.runIntervals();
    expect(h.intervals.size).toBe(0);
    expect(h.active()).toBe(true);
  });

  describe('fail safe', () => {
    it.each([
      ['.app-container is missing', { container: false }],
      ['[data-testid="header"] is missing', { header: false }],
      ['the stylesheet does not take', { stylesheetTakes: false }],
    ])('keeps Apple\'s sidebar and warns once when %s', (_label, options) => {
      const h = createHarness(options);
      expect(h.active()).toBe(false);
      expect(h.host()).toBeUndefined();
      expect(h.warn).toHaveBeenCalledExactlyOnceWith(TOP_BAR_LAYOUT_WARNING);
      h.run();
      expect(h.active()).toBe(false);
      expect(h.warn).toHaveBeenCalledOnce();
    });

    it('puts the sidebar back if the layout stops holding while shown', () => {
      const h = createHarness();
      expect(h.shown()).toBe(true);
      const style = h.window.getComputedStyle;
      h.window.getComputedStyle = () => ({ display: 'grid', paddingTop: '0px' });
      h.run();
      expect(h.active()).toBe(false);
      expect(h.shown()).toBe(false);
      expect(h.warn).toHaveBeenCalledExactlyOnceWith(TOP_BAR_LAYOUT_WARNING);
      h.window.getComputedStyle = style;
    });
  });

  it('builds one bar however often it runs', () => {
    const h = createHarness();
    h.run();
    h.run();
    expect(body.children).toHaveLength(1);
  });

  it('goes back through the same command as Alt+Left', () => {
    const h = createHarness();
    expect(h.button('back').getAttribute('aria-disabled')).toBe('false');
    h.button('back').click();
    expect(h.send).toHaveBeenCalledExactlyOnceWith('nav:back');
    expect(h.window.history.pushState).not.toHaveBeenCalled();
  });

  it('looks disabled and does nothing with no history to go back to', () => {
    const h = createHarness({ canGoBack: false });
    expect(h.button('back').getAttribute('aria-disabled')).toBe('true');
    h.button('back').click();
    expect(h.send).not.toHaveBeenCalled();
  });

  it('keeps Back available where the Navigation API is missing', () => {
    const h = createHarness({ canGoBack: undefined });
    expect(h.button('back').getAttribute('aria-disabled')).toBe('false');
  });

  it('opens Hydra Settings through the same command as before', () => {
    const h = createHarness();
    h.button('settings').click();
    expect(h.send).toHaveBeenCalledExactlyOnceWith('nav:settings');
  });

  it('shows labels only inside the page items, and names every button', () => {
    const h = createHarness();
    const labelOf = (id: string) => descendants(h.button(id)).find((e) => e.getAttribute('class') === 'label');
    for (const id of ['home', 'search', 'all-playlists']) {
      expect(labelOf(id)?.textContent).toBe(h.button(id).getAttribute('aria-label'));
      expect(labelOf(id)?.getAttribute('aria-hidden')).toBe('true');
      expect(h.button(id).getAttribute('class')).toBe('item');
    }
    for (const id of ['back', 'settings']) {
      expect(labelOf(id)).toBeUndefined();
      expect(h.button(id).getAttribute('class')).toBe('round');
    }
  });

  it('tolerates an absent preload bridge', () => {
    const h = createHarness({ bridge: false });
    expect(() => h.button('back').click()).not.toThrow();
  });

  it("opens Home in-app with MusicKit's storefront", () => {
    const h = createHarness({ pathname: '/us/new' });
    h.button('home').click();
    expect(h.window.history.pushState).toHaveBeenCalledExactlyOnceWith({}, '', '/al/home');
    expect(h.window.dispatchEvent.mock.calls[0][0]).toMatchObject({ type: 'popstate' });
  });

  it("falls back to the path's storefront, and never to a fixed one", () => {
    const fromPath = createHarness({ pathname: '/gb/new', storefrontId: null });
    fromPath.button('home').click();
    expect(fromPath.window.history.pushState).toHaveBeenCalledWith({}, '', '/gb/home');
    const none = createHarness({ pathname: '/library/songs', storefrontId: null });
    none.button('home').click();
    expect(none.window.history.pushState).not.toHaveBeenCalled();
  });

  it("opens Apple's All Playlists library page", () => {
    const h = createHarness();
    h.button('all-playlists').click();
    expect(h.window.history.pushState).toHaveBeenCalledExactlyOnceWith({}, '', '/library/all-playlists');
  });

  it('opens the song search panel from Search', () => {
    const h = createHarness();
    h.button('search').click();
    expect(h.window.__hydraSongSearch.open).toHaveBeenCalledOnce();
    expect(h.window.history.pushState).not.toHaveBeenCalled();
  });

  it('does not push the page that is already open', () => {
    const h = createHarness({ pathname: '/al/home/' });
    h.button('home').click();
    expect(h.window.history.pushState).not.toHaveBeenCalled();
  });

  it('marks the current page and moves the mark with navigation', () => {
    const h = createHarness({ pathname: '/al/home' });
    const current = () => h.buttons().filter((b) => b.getAttribute('aria-current') === 'page');
    expect(current().map((b) => b.getAttribute('data-hydra-page'))).toEqual(['home']);
    h.button('all-playlists').click();
    expect(current().map((b) => b.getAttribute('data-hydra-page'))).toEqual(['all-playlists']);
    h.window.location.pathname = '/al/album/1';
    h.run();
    expect(current()).toEqual([]);
  });

  // assets/songSearch.js calls refresh() when it opens and closes.
  it('marks Search while the search panel is open', () => {
    const h = createHarness({ pathname: '/al/home' });
    const current = () => h.buttons().filter((b) => b.getAttribute('aria-current') === 'page');
    h.window.__hydraSongSearch.isOpen.mockReturnValue(true);
    (h.window.__hydraTopBar as unknown as { refresh(): void }).refresh();
    expect(current().map((b) => b.getAttribute('data-hydra-page'))).toEqual(['search']);
    h.window.__hydraSongSearch.isOpen.mockReturnValue(false);
    (h.window.__hydraTopBar as unknown as { refresh(): void }).refresh();
    expect(current().map((b) => b.getAttribute('data-hydra-page'))).toEqual(['home']);
  });

  // The capsule and the labels animate in CSS, which reduced motion turns off.
  it('animates the capsule over 200ms, not at all with reduced motion, with focus rings', () => {
    expect(source).toContain('transition: left 0.2s ease, width 0.2s ease, opacity 0.15s ease;');
    expect(source).toContain('transition: max-width 0.2s ease, margin-left 0.2s ease, opacity 0.2s ease;');
    expect(source).toMatch(/@media \(prefers-reduced-motion: reduce\) \{ \.label, \.capsule \{ transition: none; \} \}/);
    expect(source).toMatch(/button:focus-visible \{ outline: 2px solid/);
  });

  it('shows the capsule only behind an active item', () => {
    const capsuleOf = (h: ReturnType<typeof createHarness>) =>
      descendants(h.host()!.shadowRoot!).find((e) => e.getAttribute('class') === 'capsule')!;
    const onHome = createHarness({ pathname: '/al/home' });
    expect(capsuleOf(onHome).styles.get('opacity')).toBe('1');
    // The first placement jumps, then the transition is handed back.
    expect(capsuleOf(onHome).styles.has('transition')).toBe(false);
    const elsewhere = createHarness({ pathname: '/al/album/1' });
    expect(capsuleOf(elsewhere).styles.get('opacity')).not.toBe('1');
  });

  it('writes no markup, adds no wheel listener, no observer and no blur', () => {
    expect(source).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML/);
    expect(source).not.toMatch(/["']wheel["']/);
    expect(source).not.toMatch(/MutationObserver/);
    expect(source).not.toMatch(/backdrop-filter/);
  });
});

describe('topBar.css', () => {
  function selectors(text: string): string[] {
    return [...text.matchAll(/([^{}]+)\{[^{}]+\}/g)].flatMap((match) =>
      match[1].split(/,(?![^(]*\))/).map((s) => s.trim()),
    );
  }

  it('gates every rule on the attribute the script sets, above Apple\'s narrow layout', () => {
    expect(stripped.trim()).toMatch(/^@media \(min-width: 484px\) \{[\s\S]*\}$/);
    const inner = stripped.trim().replace(/^@media[^{]*\{/, '').replace(/\}$/, '');
    const all = selectors(inner);
    expect(all.length).toBeGreaterThan(0);
    for (const selector of all) expect(selector).toMatch(/^html\[data-hydra-top-bar\]/);
  });

  it('hides the sidebar, removes its column and reserves the bar\'s strip', () => {
    expect(stripped).toMatch(/html\[data-hydra-top-bar\] \{\s*--web-navigation-width:\s*0px !important/);
    expect(stripped).toMatch(/html\[data-hydra-top-bar\] \[data-testid="header"\] \{\s*display:\s*none !important/);
    expect(stripped).toMatch(/grid-template-columns:\s*0 minmax\(0, 1fr\) !important/);
    // The script checks for exactly this strip.
    expect(stripped).toMatch(/padding-top:\s*56px !important/);
    expect(source).toMatch(/var BAR_PX = 56;/);
  });

  it('is unpacked from the asar archive with its script, because main.ts reads both with fs', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8')) as {
      build: { asarUnpack: string[] };
    };
    expect(pkg.build.asarUnpack).toEqual(expect.arrayContaining(['assets/topBar.css', 'assets/topBar.js']));
  });
});
