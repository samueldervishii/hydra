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
  vibe: 'Stimmung',
  allPlaylists: 'Alle Playlists',
  settings: 'Einstellungen',
  account: 'Konto',
  switchToSidebar: 'Zur Apple-Seitenleiste wechseln',
  signOut: 'Abmelden …',
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
  readonly nodeType = 1;
  /** The computed background-color the stand-in reports for this element. */
  background = 'rgba(0, 0, 0, 0)';
  get id(): string {
    return this.attributes.get('id') ?? '';
  }
  get parentElement(): StubElement | null {
    return this.parentNode instanceof StubElement ? this.parentNode : null;
  }
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
  readonly classList = {
    contains: (token: string) => (this.attributes.get('class') ?? '').split(' ').includes(token),
    add: (token: string) => {
      if (!this.classList.contains(token)) this.attributes.set('class', `${this.attributes.get('class') ?? ''} ${token}`.trim());
    },
    remove: (token: string) => {
      this.attributes.set('class', (this.attributes.get('class') ?? '').split(' ').filter((t) => t !== token).join(' '));
    },
  };
  focus(): void {
    focused = this;
  }
  replaceChildren(...nodes: StubNode[]): void {
    this.children = [];
    for (const node of nodes) this.appendChild(node);
  }
  /** Dispatch a key or pointer event at this element's own listeners. */
  dispatch(type: string, init: Record<string, unknown> = {}): { preventDefault: ReturnType<typeof vi.fn> } {
    const event = { type, target: this, preventDefault: vi.fn(), stopPropagation: vi.fn(), ...init };
    for (const entry of this.listeners) if (entry.type === type) (entry.listener as (e: unknown) => void)(event);
    return event;
  }
}

let focused: StubElement | null = null;

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
  hitAt = null as ((x: number, y: number) => StubElement | null) | null,
  me = (() => Promise.resolve({
    attributes: { avatarArtwork: { url: 'https://is1-ssl.mzstatic.com/image/thumb/avatar/{w}x{h}{c}.{f}' } },
  })) as () => unknown,
} = {}) {
  focused = null;
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
    me: vi.fn(me),
  };
  const intervals = new Map<number, () => void>();
  const frames: Array<() => void> = [];
  const observers: Array<{ callback: () => void; observed: Array<[StubElement, unknown]>; disconnect: ReturnType<typeof vi.fn> }> = [];
  class MutationObserver {
    readonly observed: Array<[StubElement, unknown]> = [];
    readonly disconnect = vi.fn(() => {
      this.observed.length = 0;
    });
    constructor(readonly callback: () => void) {
      observers.push(this);
    }
    observe(node: StubElement, options: unknown) {
      this.observed.push([node, options]);
    }
  }
  let hit = hitAt;
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
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    AMWrapper: bridge ? { ipcRenderer: { send } } : undefined,
    __hydraHookedMk: (musicKitReady ? mk : undefined) as unknown,
    __hydraSongSearch: { open: vi.fn(), isOpen: vi.fn(() => false) },
    navigation: (canGoBack === undefined ? undefined : { canGoBack, currentEntry: { key: 'entry-0' } }) as
      | { canGoBack: boolean; currentEntry: { key: string } }
      | undefined,
    __hydraTopBar: undefined as { update(): void; refresh(): void } | undefined,
    // The stylesheet's effect: with the gate set, the sidebar is hidden and
    // the strip reserved, unless Apple's layout no longer matches it.
    innerWidth: 1280,
    getComputedStyle: (element: StubElement): { display?: string; paddingTop?: string; backgroundColor?: string } => {
      const gated = stylesheetTakes && html.hasAttribute('data-hydra-top-bar');
      if (element === sidebar) return { display: gated ? 'none' : 'grid' };
      if (element === appContainer) return { paddingTop: gated ? '56px' : '0px' };
      return { backgroundColor: element.background };
    },
  };
  const document = {
    body,
    documentElement: html,
    createElement: (tag: string) => new StubElement(tag),
    createElementNS: (_ns: string, tag: string) => new StubElement(tag),
    elementFromPoint: vi.fn((x: number, y: number) => (hit ? hit(x, y) : null)),
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
    URL,
    MutationObserver,
    requestAnimationFrame: (callback: () => void) => {
      frames.push(callback);
      return frames.length;
    },
    cancelAnimationFrame: () => {
      frames.length = 0;
    },
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
    // A navigation to a new or revisited history entry, then main.ts's
    // re-injection on did-navigate-in-page.
    visit: (pathname: string, key: string) => {
      location.pathname = pathname;
      if (window.navigation) window.navigation.currentEntry = { key };
      run();
    },
    focused: () => focused,
    document,
    observers,
    frames,
    runFrames: () => {
      for (const callback of frames.splice(0)) callback();
    },
    setHit: (next: ((x: number, y: number) => StubElement | null) | null) => {
      hit = next;
    },
    strip: () => host()?.styles.get('--hydra-strip'),
    tint: () =>
      host()?.attributes.has('data-tinted')
        ? { tint: host()?.styles.get('--hydra-tint'), fg: host()?.styles.get('--hydra-tint-fg') }
        : null,
    shadowElements: () => (host() ? descendants(host()!.shadowRoot!) : []),
    activeItem: () =>
      (host() ? descendants(host()!.shadowRoot!).filter((e) => e.tagName === 'button') : [])
        .filter((b) => b.getAttribute('aria-current') === 'page')
        .map((b) => b.getAttribute('data-hydra-page')),
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
    const bar = buttons().filter((b) => b.getAttribute('data-hydra-page'));
    expect(bar.map((b) => b.getAttribute('aria-label'))).toEqual([
      LABELS.back,
      LABELS.home,
      LABELS.search,
      LABELS.vibe,
      LABELS.allPlaylists,
      LABELS.settings,
      LABELS.account,
    ]);
    for (const b of bar) expect(b.getAttribute('title')).toBe(b.getAttribute('aria-label'));
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

  it('keeps keys pressed in the bar from reaching the page', () => {
    const h = createHarness();
    for (const type of ['keydown', 'keyup', 'keypress']) {
      const event = h.host()!.dispatch(type, { key: ' ' }) as unknown as { stopPropagation: ReturnType<typeof vi.fn> };
      expect(event.stopPropagation).toHaveBeenCalled();
    }
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
    for (const id of ['home', 'search', 'vibe', 'all-playlists']) {
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
    // A page outside every section keeps the section it was opened from.
    h.visit('/al/album/1', 'entry-9');
    expect(current().map((b) => b.getAttribute('data-hydra-page'))).toEqual(['all-playlists']);
  });

  describe('account menu', () => {
    const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
    const menuOf = (h: ReturnType<typeof createHarness>) =>
      h.shadowElements().find((e) => e.getAttribute('role') === 'menu')!;
    const itemsOf = (h: ReturnType<typeof createHarness>) =>
      h.shadowElements().filter((e) => e.getAttribute('role') === 'menuitem');
    const isOpen = (h: ReturnType<typeof createHarness>) => menuOf(h).classList.contains('open');

    it('shows Apple\'s avatar from mk.me() in the button and the menu', async () => {
      const h = createHarness();
      await settle();
      expect(h.mk.me).toHaveBeenCalledOnce();
      const images = h.shadowElements().filter((e) => e.tagName === 'img');
      expect(images.map((img) => img.getAttribute('src'))).toEqual([
        'https://is1-ssl.mzstatic.com/image/thumb/avatar/80x80cc.jpg',
        'https://is1-ssl.mzstatic.com/image/thumb/avatar/80x80cc.jpg',
      ]);
      h.run();
      expect(h.mk.me).toHaveBeenCalledOnce();
    });

    it.each([
      ['no avatar', () => Promise.resolve({ attributes: {} })],
      ['an avatar off Apple\'s image host', () =>
        Promise.resolve({ attributes: { avatarArtwork: { url: 'https://evil.test/{w}x{h}.jpg' } } })],
      ['a failed request', () => Promise.reject(new Error('private'))],
    ])('keeps the person icon with %s', async (_label, me) => {
      const h = createHarness({ me });
      await settle();
      expect(h.shadowElements().filter((e) => e.tagName === 'img')).toEqual([]);
      expect(descendants(h.button('account')).some((e) => e.tagName === 'svg')).toBe(true);
    });

    it('opens on click, names itself and focuses its first item', () => {
      const h = createHarness();
      expect(h.button('account').getAttribute('aria-haspopup')).toBe('menu');
      expect(isOpen(h)).toBe(false);
      h.button('account').click();
      expect(isOpen(h)).toBe(true);
      expect(h.button('account').getAttribute('aria-expanded')).toBe('true');
      expect(h.focused()).toBe(itemsOf(h)[0]);
      expect(itemsOf(h).map((i) => i.textContent)).toEqual([LABELS.switchToSidebar, LABELS.signOut]);
      h.button('account').click();
      expect(isOpen(h)).toBe(false);
    });

    it('moves with the arrow keys and closes on Escape, back on the button', () => {
      const h = createHarness();
      h.button('account').dispatch('keydown', { key: 'ArrowUp' });
      expect(h.focused()).toBe(itemsOf(h)[1]);
      menuOf(h).dispatch('keydown', { key: 'ArrowDown', target: itemsOf(h)[1] });
      expect(h.focused()).toBe(itemsOf(h)[0]);
      menuOf(h).dispatch('keydown', { key: 'ArrowUp', target: itemsOf(h)[0] });
      expect(h.focused()).toBe(itemsOf(h)[1]);
      menuOf(h).dispatch('keydown', { key: 'Escape', target: itemsOf(h)[1] });
      expect(isOpen(h)).toBe(false);
      expect(h.focused()).toBe(h.button('account'));
    });

    // Apple's own Sign Out also ends the store session; Hydra does not sign out.
    it.each([0, 1])('sends item %i to Apple\'s sidebar and never signs out itself', (index) => {
      const h = createHarness();
      const unauthorize = vi.fn();
      Object.assign(h.mk, { unauthorize });
      h.button('account').click();
      itemsOf(h)[index].click();
      expect(h.send).toHaveBeenCalledExactlyOnceWith('nav:apple-sidebar');
      expect(unauthorize).not.toHaveBeenCalled();
      expect(isOpen(h)).toBe(false);
    });

    it('closes on a press outside the bar, and listens for one only while open', () => {
      const h = createHarness();
      h.button('account').click();
      const [, listener] = h.window.addEventListener.mock.calls.find(([type]) => type === 'pointerdown')!;
      (listener as (e: unknown) => void)({ composedPath: () => [h.host()] });
      expect(isOpen(h)).toBe(true);
      (listener as (e: unknown) => void)({ composedPath: () => [] });
      expect(isOpen(h)).toBe(false);
      expect(h.window.removeEventListener).toHaveBeenCalledWith('pointerdown', listener, true);
    });

    it('closes when the bar gives way to Apple\'s sidebar', () => {
      const h = createHarness();
      h.button('account').click();
      h.signIn(false);
      expect(isOpen(h)).toBe(false);
    });
  });

  describe('strip colour', () => {
    // A page column whose element at the sample point is unpainted, inside a
    // header Apple tinted from the artwork, inside the page.
    function page(tint: string) {
      const root = new StubElement('html');
      root.background = 'rgb(31, 31, 31)';
      const header = root.appendChild(new StubElement('div'));
      header.background = tint;
      const title = header.appendChild(new StubElement('div'));
      title.background = 'transparent';
      const text = title.appendChild(new StubElement('span'));
      return { root, header, title, text };
    }

    it('takes the first painted colour under the strip, at its centre just below it', () => {
      const { text } = page('rgb(73, 36, 0)');
      const h = createHarness({ hitAt: () => text });
      h.runFrames();
      expect(h.document.elementFromPoint).toHaveBeenCalledWith(640, 60);
      expect(h.strip()).toBe('rgb(73, 36, 0)');
    });

    it.each([['rgba(0, 0, 0, 0)'], ['transparent'], ['color(srgb 1 0 0 / 0)']])(
      'looks past %s',
      (clear) => {
        const { text, title } = page('rgb(240, 236, 228)');
        title.background = clear;
        const h = createHarness({ hitAt: () => text });
        h.runFrames();
        expect(h.strip()).toBe('rgb(240, 236, 228)');
      },
    );

    it('falls back to the page colour when nothing is painted, nothing is hit or the read throws', () => {
      const { text } = page('rgb(73, 36, 0)');
      const h = createHarness({ hitAt: () => text });
      h.runFrames();
      expect(h.strip()).toBe('rgb(73, 36, 0)');
      h.setHit(() => null);
      h.run();
      h.runFrames();
      expect(h.strip()).toBeUndefined();
      h.setHit(() => text);
      h.run();
      h.runFrames();
      h.setHit(() => {
        throw new Error('layout');
      });
      h.run();
      h.runFrames();
      expect(h.strip()).toBeUndefined();
    });

    it('keeps its colour while a Hydra panel covers the sample point', () => {
      const { text } = page('rgb(73, 36, 0)');
      const h = createHarness({ hitAt: () => text });
      h.runFrames();
      const panel = new StubElement('div');
      panel.setAttribute('id', 'hydra-song-search');
      panel.background = 'rgb(255, 0, 0)';
      h.setHit(() => panel);
      h.run();
      h.runFrames();
      expect(h.strip()).toBe('rgb(73, 36, 0)');
    });

    it('samples again after each in-page navigation', () => {
      const album = page('rgb(73, 36, 0)');
      const h = createHarness({ hitAt: () => album.text });
      h.runFrames();
      const light = page('rgb(240, 236, 228)');
      h.setHit(() => light.text);
      h.visit('/al/album/light/1', 'entry-1');
      h.runFrames();
      expect(h.strip()).toBe('rgb(240, 236, 228)');
    });

    it('watches only the elements under the point, without a subtree, and resamples once per frame', () => {
      const { root, header, title, text } = page('rgb(73, 36, 0)');
      const h = createHarness({ hitAt: () => text });
      h.runFrames();
      const [observer] = h.observers;
      expect(observer.observed.map(([node]) => node)).toEqual([text, title, header, root]);
      for (const [, options] of observer.observed) {
        expect(options).toEqual({ attributes: true, attributeFilter: ['class', 'style'], childList: true });
      }
      header.background = 'rgb(12, 34, 56)';
      observer.callback();
      observer.callback();
      expect(h.frames).toHaveLength(1);
      h.runFrames();
      expect(h.strip()).toBe('rgb(12, 34, 56)');
    });

    it("stops following the page when Apple's sidebar takes over", () => {
      const { text } = page('rgb(73, 36, 0)');
      const h = createHarness({ hitAt: () => text });
      h.runFrames();
      h.signIn(false);
      expect(h.observers[0].disconnect).toHaveBeenCalled();
      expect(h.strip()).toBeUndefined();
    });

    // The pill and round buttons follow the page's tint, 10% lighter in dark
    // mode and 10% darker in light mode, with icons in whichever of white or
    // black reads better on the result.
    describe('tinted buttons', () => {
      it('tints from a dark strip in dark mode, with white icons', () => {
        const { text } = page('rgb(73, 36, 0)');
        const h = createHarness({ hitAt: () => text });
        h.runFrames();
        expect(h.tint()).toEqual({ tint: 'rgb(91, 58, 26)', fg: 'rgb(255, 255, 255)' });
      });

      it('darkens a light strip in light mode, with black icons', () => {
        const { text } = page('rgb(240, 236, 228)');
        const h = createHarness({ hitAt: () => text });
        (h.window as unknown as { matchMedia: (q: string) => { matches: boolean } }).matchMedia = () => ({ matches: false });
        h.window.__hydraTopBar?.update();
        h.runFrames();
        expect(h.tint()).toEqual({ tint: 'rgb(216, 212, 205)', fg: 'rgb(0, 0, 0)' });
      });

      // A mid-tone where white would read worse than black.
      it('picks the icon colour by contrast, not by scheme', () => {
        const { text } = page('rgb(150, 150, 150)');
        const h = createHarness({ hitAt: () => text });
        h.runFrames();
        expect(h.tint()?.fg).toBe('rgb(0, 0, 0)');
      });

      it('keeps the glass on a page in its own colour, or one it cannot read', () => {
        const { text } = page('rgb(31, 31, 31)');
        const h = createHarness({ hitAt: () => text });
        h.host()!.background = 'rgb(32, 31, 30)';
        h.window.__hydraTopBar?.update();
        h.runFrames();
        expect(h.strip()).toBe('rgb(31, 31, 31)');
        expect(h.tint()).toBeNull();

        const other = page('color(srgb 0.1 0.2 0.3)');
        h.setHit(() => other.text);
        h.window.__hydraTopBar?.update();
        h.runFrames();
        expect(h.tint()).toBeNull();
      });

      it("goes back to the glass when Apple's sidebar takes over", () => {
        const { text } = page('rgb(73, 36, 0)');
        const h = createHarness({ hitAt: () => text });
        h.runFrames();
        expect(h.tint()).not.toBeNull();
        h.signIn(false);
        expect(h.tint()).toBeNull();
        expect(h.host()!.styles.has('--hydra-tint')).toBe(false);
      });

      it('fades the tint in 250ms, and not at all with reduced motion', () => {
        expect(source).toContain('".pill, .round { transition: background-color 0.25s ease; }"');
        expect(source).toContain(':host([data-tinted]) .pill, :host([data-tinted]) .round { background: var(" + TINT_PROPERTY + "); }');
        expect(source).toContain('@media (prefers-reduced-motion: reduce) { .bar, .pill, .round, .label, .capsule { transition: none; } }');
      });
    });

    it('fades the strip in 250ms, not at all with reduced motion, under buttons with their own fill', () => {
      expect(source).toContain('background-color: var(" + STRIP_PROPERTY + ", var(--pageBG, #1f1f1f));');
      expect(source).toContain('transition: background-color 0.25s ease;');
      expect(source).toMatch(/\.round \{[^}]*\n\s*"\s*background: linear-gradient\(var\(--glass\), var\(--glass\)\), var\(--pageBG/);
    });
  });

  describe('sections', () => {
    it.each([
      ['/library/all-playlists', 'all-playlists'],
      ['/library/playlist/p.abc123', 'all-playlists'],
      ['/library/playlist-folder/p.folder1', 'all-playlists'],
      ['/al/home', 'home'],
      ['/gb/home', 'home'],
    ])('treats %s as the %s section', (pathname, section) => {
      const h = createHarness({ pathname });
      expect(h.activeItem()).toEqual([section]);
    });

    it('keeps the section a page outside every section was opened from', () => {
      const h = createHarness({ pathname: '/al/home' });
      h.visit('/al/album/blonde/1146195596', 'entry-1');
      expect(h.activeItem()).toEqual(['home']);
      h.visit('/library/playlist/p.abc123', 'entry-2');
      expect(h.activeItem()).toEqual(['all-playlists']);
      h.visit('/al/artist/frank-ocean/442122051', 'entry-3');
      expect(h.activeItem()).toEqual(['all-playlists']);
    });

    it('restores the section of the page Back returns to', () => {
      const h = createHarness({ pathname: '/al/home' });
      h.visit('/al/album/blonde/1146195596', 'entry-1');
      h.visit('/library/all-playlists', 'entry-2');
      h.visit('/library/playlist/p.abc123', 'entry-3');
      // Back twice: the playlist list, then the album opened from Home.
      h.visit('/library/all-playlists', 'entry-2');
      expect(h.activeItem()).toEqual(['all-playlists']);
      h.visit('/al/album/blonde/1146195596', 'entry-1');
      expect(h.activeItem()).toEqual(['home']);
      // A new page from there belongs to Home too.
      h.visit('/al/album/channel-orange/1440765580', 'entry-4');
      expect(h.activeItem()).toEqual(['home']);
    });

    it('falls back to the last section without the Navigation API', () => {
      const h = createHarness({ pathname: '/library/all-playlists', canGoBack: undefined });
      h.visit('/al/album/blonde/1146195596', 'unused');
      expect(h.activeItem()).toEqual(['all-playlists']);
    });

    it('marks nothing on a first page outside every section', () => {
      const h = createHarness({ pathname: '/al/album/blonde/1146195596' });
      expect(h.activeItem()).toEqual([]);
    });

    it('returns to the section after the search panel closes', () => {
      const h = createHarness({ pathname: '/library/playlist/p.abc123' });
      h.window.__hydraSongSearch.isOpen.mockReturnValue(true);
      (h.window.__hydraTopBar as unknown as { refresh(): void }).refresh();
      expect(h.activeItem()).toEqual(['search']);
      h.window.__hydraSongSearch.isOpen.mockReturnValue(false);
      (h.window.__hydraTopBar as unknown as { refresh(): void }).refresh();
      expect(h.activeItem()).toEqual(['all-playlists']);
    });
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
    expect(source).toMatch(/@media \(prefers-reduced-motion: reduce\) \{ \.bar, \.pill, \.round, \.label, \.capsule \{ transition: none; \} \}/);
    expect(source).toMatch(/button:focus-visible \{ outline: 2px solid/);
  });

  // Vibe switched off in Settings: src/integrations/vibe/index.ts sets the
  // attribute and calls refresh(); the items after Vibe move up, so the
  // capsule is placed again.
  it('hides the Vibe item while Vibe is switched off, and places the capsule again', () => {
    const capsuleOf = (h: ReturnType<typeof createHarness>) =>
      descendants(h.host()!.shadowRoot!).find((e) => e.getAttribute('class') === 'capsule')!;
    const h = createHarness({ pathname: '/library/all-playlists' });
    expect(h.button('vibe').attributes.has('hidden')).toBe(false);
    capsuleOf(h).styles.delete('left');
    h.html.setAttribute('data-hydra-vibe-off', '');
    h.window.__hydraTopBar?.refresh();
    expect(h.button('vibe').attributes.has('hidden')).toBe(true);
    expect(capsuleOf(h).styles.has('left')).toBe(true);
    // Nothing changed: the capsule stays put.
    capsuleOf(h).styles.delete('left');
    h.window.__hydraTopBar?.refresh();
    expect(capsuleOf(h).styles.has('left')).toBe(false);
    h.html.removeAttribute('data-hydra-vibe-off');
    h.window.__hydraTopBar?.refresh();
    expect(h.button('vibe').attributes.has('hidden')).toBe(false);
    expect(source).toContain('"button[hidden] { display: none; }"');
  });

  it('shows the capsule only behind an active item', () => {
    const capsuleOf = (h: ReturnType<typeof createHarness>) =>
      descendants(h.host()!.shadowRoot!).find((e) => e.getAttribute('class') === 'capsule')!;
    const onHome = createHarness({ pathname: '/al/home' });
    expect(capsuleOf(onHome).styles.get('opacity')).toBe('1');
    // The first placement jumps, then the transition is handed back.
    expect(capsuleOf(onHome).styles.has('transition')).toBe(false);
    // A first page outside every section has nothing to mark.
    const elsewhere = createHarness({ pathname: '/al/album/1' });
    expect(capsuleOf(elsewhere).styles.get('opacity')).not.toBe('1');
  });

  // The strip's observer watches a short chain of elements, never a subtree:
  // a document-wide one in the hook once cost 180 MiB/s.
  it('writes no markup, adds no wheel listener, no subtree observer and no blur', () => {
    expect(source).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML/);
    expect(source).not.toMatch(/["']wheel["']/);
    expect(source).not.toMatch(/subtree\s*:/);
    expect(source.match(/new MutationObserver/g)).toHaveLength(1);
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
