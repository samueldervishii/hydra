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
  back: 'Zurück',
  forward: 'Vorwärts',
  reload: 'Neu laden',
  settings: 'Einstellungen',
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

  get firstChild(): StubElement | null {
    return this.children[0] ?? null;
  }

  insertBefore<T extends StubElement>(child: T, before: StubElement | null): T {
    const index = before ? this.children.indexOf(before) : -1;
    if (index < 0) this.children.push(child);
    else this.children.splice(index, 0, child);
    return child;
  }

  // Apple's icon reports its glyph once its sidebar renders; zero until then.
  bbox = { x: 0, y: 0, width: 0, height: 0 };
  getBBox() {
    return this.bbox;
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
    if (selector !== 'button[data-hydra-page]') throw new Error(`unexpected selector ${selector}`);
    return this.descendants().filter(
      (element) => element.tagName === 'button' && element.getAttribute('data-hydra-page'),
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
  const window: {
    AMWrapper: unknown;
    location: typeof location;
    history: typeof history;
    dispatchEvent: typeof dispatchEvent;
    __hydraSongSearch?: { open: () => void };
  } = { AMWrapper: { ipcRenderer: { send } }, location, history, dispatchEvent };
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
      root.descendants().find((element) => element.id === 'hydra-nav-buttons') ?? null,
    buttons,
    button: (label: string): StubElement =>
      buttons().find((element) => element.getAttribute('aria-label') === label)!,
    run: () => vm.runInContext(navBarScript, context),
    send,
    warn,
    window,
  };
}

function labelsOf(elements: StubElement[]): Array<string | null> {
  return elements.map((element) => element.getAttribute('aria-label'));
}

describe('navigationBar', () => {
  it('carries the label token that src/main.ts substitutes', () => {
    expect(navBarSource).toContain(NAV_LABELS_TOKEN);
  });

  it('adds its own row above the logo, so nothing shares the logo row', () => {
    const { anchor, bar, logo, run } = createHarness();

    run();

    expect(anchor?.children).toEqual([bar(), logo]);
    expect(logo?.children).toEqual([]);
  });

  it('spreads the row across the sidebar and lets it shrink with it', () => {
    const { bar, run } = createHarness();

    run();

    const style = bar()?.getAttribute('style') ?? '';
    expect(style).toContain('justify-content: space-between !important');
    expect(style).toContain('padding: 4px 14px 0 !important');
    expect(style).toContain('min-width: 0 !important');
  });

  // Apple's sidebar is 164px wide at Hydra's 484px minimum window width.
  it('lets every button shrink from 32px to its 20px icon', () => {
    const { buttons, run } = createHarness();

    run();

    for (const button of buttons()) {
      const style = button.getAttribute('style') ?? '';
      expect(style).toMatch(/^display: flex !important; /);
      expect(style).toContain('flex: 0 1 32px !important');
      expect(style).toContain('width: 32px !important');
      expect(style).toContain('min-width: 20px !important');
      expect(style).toContain('padding: 6px 0 !important');
    }
  });

  // Every icon fills the same 20px slot with the longer side of its glyph at
  // 16px, so the viewBox side is 1.25 times that side.
  it('frames every icon so the glyphs read at one size', () => {
    const { buttons, run } = createHarness();

    run();

    for (const button of buttons()) {
      const svg = button.querySelector('svg');
      expect(svg?.getAttribute('width')).toBe('20');
      expect(svg?.getAttribute('height')).toBe('20');
      const [, , w, h] = (svg?.getAttribute('viewBox') ?? '').split(' ').map(Number);
      expect(w).toBe(h);
      expect(w).toBeGreaterThanOrEqual(14 * 1.25);
      expect(w).toBeLessThanOrEqual(20 * 1.25);
      for (const shape of svg?.children ?? []) {
        expect(shape.getAttribute('vector-effect')).toBe('non-scaling-stroke');
      }
    }
    // The back chevron is 6 by 16 units, so its box is 20 units square.
    expect(buttons()[0].querySelector('svg')?.getAttribute('viewBox')).toBe('2 2 20 20');
  });

  it('shows Back, Forward, Reload and Settings, with tooltips', () => {
    const { buttons, run } = createHarness();

    run();

    expect(labelsOf(buttons())).toEqual([LABELS.back, LABELS.forward, LABELS.reload, LABELS.settings]);
    for (const button of buttons()) {
      expect(button.getAttribute('title')).toBe(button.getAttribute('aria-label'));
    }
  });

  it('shows the same row on Apple Music Classical', () => {
    const { buttons, run } = createHarness({ host: 'classical.music.apple.com' });

    run();

    expect(labelsOf(buttons())).toEqual([LABELS.back, LABELS.forward, LABELS.reload, LABELS.settings]);
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

    expect(warn).toHaveBeenCalledWith(`Hydra: ${ANCHOR_SELECTOR} not found`);
  });

  it('appends no duplicate buttons when the script runs again', () => {
    const { anchor, buttons, run } = createHarness();

    run();
    run();

    expect(buttons()).toHaveLength(4);
    expect(anchor?.children).toHaveLength(2);
  });

  it.each([
    [LABELS.back, 'nav:back'],
    [LABELS.forward, 'nav:forward'],
    [LABELS.reload, 'nav:reload'],
    [LABELS.settings, 'nav:settings'],
  ])('sends %s clicks on the %s channel and navigates nothing itself', (label, channel) => {
    const { button, run, send, history } = createHarness();

    run();
    button(label).dispatch('click');

    expect(send).toHaveBeenCalledExactlyOnceWith(channel);
    expect(history.pushState).not.toHaveBeenCalled();
  });

  it('lights a button while the pointer is over it', () => {
    const { button, run } = createHarness();

    run();
    const back = button(LABELS.back);
    back.dispatch('mouseenter');
    expect(back.styles.get('color')).toBe(ACTIVE_COLOR);
    expect(back.styles.get('opacity')).toBe('1');
    back.dispatch('mouseleave');
    expect(back.styles.get('opacity')).toBe('0.7');
  });
});
