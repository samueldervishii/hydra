// A stand-in for the few DOM features the injected panels use (elements, a
// shadow root, focus, bubbling), so assets/songSearch.js and assets/vibe.js
// can run in a VM without a renderer. resetStubDom() starts a fresh page.
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
  readonly style = {
    setProperty: (name: string, value: string, priority?: string) => {
      this.styles.set(name, priority ? `${value} !${priority}` : value);
    },
  };
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
