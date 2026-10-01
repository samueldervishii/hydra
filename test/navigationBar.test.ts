import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

import { NAV_LABELS_TOKEN } from '../src/i18n';

const navBarSource = fs.readFileSync(
  path.join(__dirname, '..', 'assets', 'navigationBar.js'),
  'utf-8',
);

// Substitute the label token as main.ts loadAssets() does before executing the asset.
// Non-English labels distinguish injected translations from asset defaults.
const LABELS = {
  sidebar: 'Seitenleiste umschalten',
  back: 'Zurück',
  forward: 'Vorwärts',
  reload: 'Neu laden',
  settings: 'Einstellungen',
  home: 'Startseite',
  search: 'Suchen',
  allPlaylists: 'Alle Playlists',
};

const navBarScript = navBarSource.replace(NAV_LABELS_TOKEN, () => JSON.stringify(LABELS));

const ANCHOR_SELECTOR = '.navigation__header';
const ACTIVE_COLOR = 'var(--keyColor, #fa586a)';

type StubListener = (this: StubElement) => void;

class StubElement {
  readonly tagName: string;
  readonly namespaceURI: string | null;
  children: StubElement[] = [];
  readonly styles = new Map<string, string>();
  readonly style = {
    setProperty: (name: string, value: string) => {
      this.styles.set(name, value);
    },
  };
  id = '';
  href = '';
  readonly click = vi.fn();

  private readonly attributes = new Map<string, string>();
  private readonly listeners = new Map<string, StubListener[]>();

  constructor(tagName: string, namespaceURI: string | null = null) {
    this.tagName = tagName;
    this.namespaceURI = namespaceURI;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  appendChild<T extends StubElement>(child: T): T {
    this.children.push(child);
    return child;
  }

  replaceChild(next: StubElement, previous: StubElement): StubElement {
    this.children = this.children.map((child) => (child === previous ? next : child));
    return previous;
  }

  cloneNode(): StubElement {
    const copy = new StubElement(this.tagName, this.namespaceURI);
    for (const [name, value] of this.attributes) copy.setAttribute(name, value);
    copy.children = this.children.map((child) => child.cloneNode());
    return copy;
  }

  addEventListener(type: string, listener: StubListener): void {
    const existing = this.listeners.get(type);
    if (existing) existing.push(listener);
    else this.listeners.set(type, [listener]);
  }

  dispatch(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) listener.call(this);
  }

  // The script queries its own 'svg' child and the page buttons in its row.
  querySelector(selector: string): StubElement | null {
    return this.descendants().find((element) => element.tagName === selector) ?? null;
  }

  querySelectorAll(selector: string): StubElement[] {
    if (selector !== 'button[data-sidra-page]') throw new Error(`unexpected selector ${selector}`);
    return this.descendants().filter(
      (element) => element.tagName === 'button' && element.getAttribute('data-sidra-page'),
    );
  }

  descendants(): StubElement[] {
    return this.children.flatMap((child) => [child, ...child.descendants()]);
  }
}

class StubPopStateEvent {
  constructor(
    readonly type: string,
    readonly init: unknown,
  ) {}
}

interface HarnessOptions {
  withAnchor?: boolean;
  host?: string;
  pathname?: string;
  // Apple sidebar links by data-testid, with their href and whether they carry an icon.
  appleLinks?: Record<string, { href: string; icon?: boolean }>;
}

function createHarness({
  withAnchor = true,
  host = 'music.apple.com',
  pathname = '/gb/new',
  appleLinks = {},
}: HarnessOptions = {}) {
  const root = new StubElement('body');
  const anchor = withAnchor ? root.appendChild(new StubElement('div')) : null;
  const logo = anchor?.appendChild(new StubElement('div'));
  const send = vi.fn();
  const warn = vi.fn();
  const log = vi.fn();

  const links = new Map<string, StubElement>();
  for (const [testid, spec] of Object.entries(appleLinks)) {
    const link = new StubElement('a');
    link.href = `https://${host}${spec.href}`;
    if (spec.icon) {
      const svg = link.appendChild(new StubElement('svg'));
      svg.setAttribute('data-apple-icon', testid);
    }
    links.set(testid, link);
  }

  const location = {
    hostname: host,
    pathname,
    get href() {
      return `https://${host}${location.pathname}`;
    },
  };
  const history = {
    state: null as unknown,
    pushState: vi.fn((state: unknown, _title: string, url: string) => {
      history.state = state;
      location.pathname = url;
    }),
  };
  const dispatchEvent = vi.fn();

  const document = {
    // Resolves against the live tree so the script's double-injection guard
    // sees the container a previous run appended.
    getElementById: (id: string): StubElement | null =>
      root.descendants().find((element) => element.id === id) ?? null,
    querySelector: (selector: string): StubElement | null => {
      if (selector === ANCHOR_SELECTOR) return anchor;
      const testid = /^a\.navigation-item__link\[data-testid="([^"]+)"\]$/.exec(selector)?.[1];
      if (testid) return links.get(testid) ?? null;
      if (selector === 'a.navigation-item__link[href]') return [...links.values()][0] ?? null;
      return null;
    },
    createElement: (tagName: string): StubElement => new StubElement(tagName),
    createElementNS: (namespaceURI: string, tagName: string): StubElement =>
      new StubElement(tagName, namespaceURI),
  };
  const window = { AMWrapper: { ipcRenderer: { send } }, location, history, dispatchEvent };
  const context = vm.createContext({
    console: { log, warn },
    document,
    window,
    URL,
    PopStateEvent: StubPopStateEvent,
  });

  const buttons = (): StubElement[] =>
    root.descendants().filter((element) => element.tagName === 'button');

  return {
    anchor,
    logo,
    links,
    location,
    history,
    dispatchEvent,
    bar: (): StubElement | null =>
      root.descendants().find((element) => element.id === 'sidra-nav-buttons') ?? null,
    buttons,
    button: (label: string): StubElement =>
      buttons().find((element) => element.getAttribute('aria-label') === label)!,
    run: () => vm.runInContext(navBarScript, context),
    send,
    warn,
  };
}

function labelsOf(elements: StubElement[]): Array<string | null> {
  return elements.map((element) => element.getAttribute('aria-label'));
}

describe('navigationBar', () => {
  it('carries the label token that src/main.ts substitutes', () => {
    expect(navBarSource).toContain(NAV_LABELS_TOKEN);
  });

  it('adds its own row after the logo, so nothing shares the logo row', () => {
    const { anchor, bar, logo, run } = createHarness();

    run();

    expect(anchor?.children).toEqual([logo, bar()]);
    expect(logo?.children).toEqual([]);
  });

  it('orders the expanded set, then the collapsed set, with tooltips', () => {
    const { buttons, run } = createHarness();

    run();

    expect(labelsOf(buttons())).toEqual([
      LABELS.sidebar,
      LABELS.back,
      LABELS.forward,
      LABELS.reload,
      LABELS.settings,
      LABELS.home,
      LABELS.search,
      LABELS.allPlaylists,
    ]);
    expect(buttons().map((b) => b.getAttribute('data-sidra-show'))).toEqual([
      'both', 'expanded', 'expanded', 'expanded', 'expanded', 'collapsed', 'collapsed', 'collapsed',
    ]);
    for (const button of buttons()) {
      expect(button.getAttribute('title')).toBe(button.getAttribute('aria-label'));
    }
  });

  // sidebar.css swaps the sets with !important, which only beats an inline
  // display that is not itself !important.
  it('shows the expanded set by default, with an overridable display', () => {
    const { buttons, run } = createHarness();

    run();

    for (const button of buttons()) {
      const display = button.getAttribute('data-sidra-show') === 'collapsed' ? 'none' : 'flex';
      expect(button.getAttribute('style')).toMatch(new RegExp(`^display: ${display}; `));
    }
  });

  it('appends nothing and throws nothing when the anchor is missing', () => {
    const { bar, buttons, run } = createHarness({ withAnchor: false });

    expect(() => run()).not.toThrow();

    expect(buttons()).toHaveLength(0);
    expect(bar()).toBeNull();
  });

  it('warns when the anchor is missing', () => {
    const { run, warn } = createHarness({ withAnchor: false });

    run();

    expect(warn).toHaveBeenCalledWith(`Sidra: ${ANCHOR_SELECTOR} not found`);
  });

  it('appends no duplicate buttons when the script runs again', () => {
    const { anchor, buttons, run } = createHarness();

    run();
    expect(buttons()).toHaveLength(8);

    run();
    expect(buttons()).toHaveLength(8);
    expect(anchor?.children).toHaveLength(2);
  });

  it.each([
    [LABELS.sidebar, 'nav:sidebar'],
    [LABELS.settings, 'nav:settings'],
    [LABELS.back, 'nav:back'],
    [LABELS.forward, 'nav:forward'],
    [LABELS.reload, 'nav:reload'],
  ])('sends %s clicks on the %s channel', (label, channel) => {
    const { button, run, send } = createHarness();

    run();
    button(label).dispatch('click');

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(channel);
  });

  it("clicks Apple's own sidebar link when it exists", () => {
    const h = createHarness({ appleLinks: { home: { href: '/gb/home' } } });

    h.run();
    h.button(LABELS.home).dispatch('click');

    expect(h.links.get('home')?.click).toHaveBeenCalledOnce();
    expect(h.history.pushState).not.toHaveBeenCalled();
    expect(h.send).not.toHaveBeenCalled();
  });

  it.each([
    [LABELS.home, '/gb/home'],
    [LABELS.search, '/gb/search'],
    [LABELS.allPlaylists, '/library/all-playlists/'],
  ])('pushes %s in-app with the storefront when Apple has no link', (label, target) => {
    const h = createHarness();

    h.run();
    h.button(label).dispatch('click');

    expect(h.history.pushState).toHaveBeenCalledExactlyOnceWith({}, '', target);
    expect(h.dispatchEvent).toHaveBeenCalledOnce();
    expect(h.dispatchEvent.mock.calls[0][0]).toMatchObject({ type: 'popstate' });
    expect(h.send).not.toHaveBeenCalled();
  });

  it("takes the storefront from Apple's links on a library page", () => {
    const h = createHarness({
      pathname: '/library/all-playlists/',
      appleLinks: { new: { href: '/fr/new' } },
    });

    h.run();
    h.button(LABELS.search).dispatch('click');

    expect(h.history.pushState).toHaveBeenCalledWith({}, '', '/fr/search');
  });

  it('leaves All Playlists out on Classical and uses its root for Home', () => {
    const h = createHarness({ host: 'classical.music.apple.com', pathname: '/us/browse/catalog' });

    h.run();
    expect(labelsOf(h.buttons())).not.toContain(LABELS.allPlaylists);
    h.button(LABELS.home).dispatch('click');

    expect(h.history.pushState).toHaveBeenCalledWith({}, '', '/us');
  });

  it('highlights the current page and moves the highlight on the next run', () => {
    const h = createHarness({ pathname: '/gb/home' });

    h.run();
    expect(h.button(LABELS.home).getAttribute('aria-current')).toBe('page');
    expect(h.button(LABELS.home).styles.get('color')).toBe(ACTIVE_COLOR);
    expect(h.button(LABELS.search).getAttribute('aria-current')).toBeNull();

    // main.ts runs the script again on each in-page navigation.
    h.location.pathname = '/gb/search';
    h.run();
    expect(h.button(LABELS.home).getAttribute('aria-current')).toBeNull();
    expect(h.button(LABELS.search).getAttribute('aria-current')).toBe('page');

    // Leaving the pointer keeps the accent on the current page only.
    h.button(LABELS.search).dispatch('mouseleave');
    expect(h.button(LABELS.search).styles.get('color')).toBe(ACTIVE_COLOR);
  });

  it("adopts Apple's icon for a page button once the sidebar renders it", () => {
    const h = createHarness();

    h.run();
    expect(h.button(LABELS.home).getAttribute('data-sidra-icon')).toBeNull();

    const link = Object.assign(new StubElement('a'), { href: 'https://music.apple.com/gb/home' });
    link.appendChild(new StubElement('svg')).setAttribute('data-apple-icon', 'home');
    h.links.set('home', link);
    h.run();

    const icon = h.button(LABELS.home).querySelector('svg');
    expect(icon?.getAttribute('data-apple-icon')).toBe('home');
    expect(icon?.getAttribute('width')).toBe('24');
    expect(icon?.styles.get('margin')).toBe('-2px');
    expect(icon?.styles.get('fill')).toBe('currentColor');
    expect(h.button(LABELS.home).getAttribute('data-sidra-icon')).toBe('apple');
  });
});
