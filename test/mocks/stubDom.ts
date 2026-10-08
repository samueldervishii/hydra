// A stand-in for the few DOM features the injected panels use (elements, a
// shadow root, focus, bubbling, simple selectors, layout boxes), so
// assets/songSearch.js, assets/vibe.js and assets/playlistSort.js can run in a
// VM without a renderer. resetStubDom() starts a fresh page.
import { vi } from 'vitest';

export interface StubEvent {
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

export type Listener = (event: StubEvent) => void;

export class StubNode {
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
      if (node === stubDom.body) return true;
    }
    return false;
  }
}

export class StubElement extends StubNode {
  readonly tagName: string;
  readonly attributes = new Map<string, string>();
  readonly listeners: Array<{ type: string; listener: Listener }> = [];
  readonly styles = new Map<string, string>();
  readonly style: Record<string, unknown> & {
    setProperty: (name: string, value: string, priority?: string) => void;
    removeProperty: (name: string) => void;
  } = {
    setProperty: (name: string, value: string, priority?: string) => {
      this.styles.set(name, priority ? `${value} !${priority}` : value);
    },
    removeProperty: (name: string) => {
      this.styles.delete(name);
    },
  };
  /** What getBoundingClientRect() reports; tests set it to lay a page out. */
  rect = { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 };
  scrollTop = 0;
  clientHeight = 0;
  textContent = '';
  value = '';
  disabled = false;
  hidden = false;
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

  removeEventListener(type: string, listener: Listener): void {
    const at = this.listeners.findIndex((entry) => entry.type === type && entry.listener === listener);
    if (at !== -1) this.listeners.splice(at, 1);
  }

  getBoundingClientRect(): { top: number; bottom: number; left: number; right: number; width: number; height: number } {
    return { ...this.rect };
  }

  get parentElement(): StubElement | null {
    return this.parentNode instanceof StubElement ? this.parentNode : null;
  }

  get nextSibling(): StubNode | null {
    const siblings = this.parentNode?.children ?? [];
    return siblings[siblings.indexOf(this) + 1] ?? null;
  }

  get nextElementSibling(): StubElement | null {
    const next = this.nextSibling;
    return next instanceof StubElement ? next : null;
  }

  get previousElementSibling(): StubElement | null {
    const siblings = this.parentNode?.children ?? [];
    const previous = siblings[siblings.indexOf(this) - 1];
    return previous instanceof StubElement ? previous : null;
  }

  insertBefore<T extends StubNode>(child: T, reference: StubNode | null): T {
    if (child.parentNode) {
      child.parentNode.children = child.parentNode.children.filter((c) => c !== child);
    }
    child.parentNode = this;
    const at = reference ? this.children.indexOf(reference) : -1;
    if (at === -1) this.children.push(child);
    else this.children.splice(at, 0, child);
    return child;
  }

  removeChild<T extends StubNode>(child: T): T {
    this.children = this.children.filter((c) => c !== child);
    child.parentNode = null;
    return child;
  }

  contains(node: StubNode | null): boolean {
    for (let at: StubNode | null = node; at; at = at.parentNode) if (at === this) return true;
    return false;
  }

  /** Whether this element matches a simple selector: tag, #id, [attr="value"], or a mix. */
  matches(selector: string): boolean {
    const parts = /^([a-z][\w-]*)?(?:#([\w-]+))?(?:\[([\w-]+)="([^"]*)"\])?$/.exec(selector.trim());
    if (!parts) throw new Error(`stubDom cannot match ${selector}`);
    const [, tag, id, attr, value] = parts;
    return (!tag || this.tagName === tag)
      && (!id || this.id === id)
      && (!attr || this.getAttribute(attr) === value);
  }

  querySelectorAll(selector: string): StubElement[] {
    return this.descendants().filter((element) => element.matches(selector));
  }

  querySelector(selector: string): StubElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  closest(selector: string): StubElement | null {
    for (let at: StubElement | null = this; at; at = at.parentElement) if (at.matches(selector)) return at;
    return null;
  }

  attachShadow(): StubShadowRoot {
    this.shadowRoot = new StubShadowRoot(this);
    return this.shadowRoot;
  }

  focus(): void {
    for (let node: StubNode | null = this.parentNode; node; node = node.upward) {
      if (node instanceof StubShadowRoot) {
        node.activeElement = this;
        stubDom.document.activeElement = node.host;
        return;
      }
    }
    stubDom.document.activeElement = this;
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
    if (!event.stopped) stubDom.bubbledToBody.push(event);
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

export class StubShadowRoot extends StubNode {
  activeElement: StubElement | null = null;
  constructor(readonly host: StubElement) {
    super();
  }
}

/** The page the stand-ins belong to: its body, its document, and every event that bubbled to the top. */
export const stubDom = {
  body: null as unknown as StubElement,
  bubbledToBody: [] as StubEvent[],
  document: {
    activeElement: null as StubElement | null,
    body: null as StubElement | null,
    documentElement: null as StubElement | null,
    createElement: (tag: string) => new StubElement(tag),
  },
};

/** Start a fresh, empty page with the body focused, and return its body. */
export function resetStubDom(): StubElement {
  stubDom.body = new StubElement('body');
  stubDom.bubbledToBody = [];
  stubDom.document.body = stubDom.body;
  stubDom.document.documentElement = stubDom.body;
  stubDom.document.activeElement = stubDom.body;
  return stubDom.body;
}
