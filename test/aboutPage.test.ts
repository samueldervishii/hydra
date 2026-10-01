import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { extractInlineScript } from './mocks/inlineScript';

const html = fs.readFileSync(path.join(__dirname, '../assets/about.html'), 'utf8');
const script = extractInlineScript(html);

interface StubNode {
  text?: string;
  tag?: string;
  href?: string;
  target?: string;
  rel?: string;
  textContent: string;
  alt: string;
  children: StubNode[];
  addEventListener: ReturnType<typeof vi.fn>;
  appendChild(node: StubNode): StubNode;
}

function node(fields: Partial<StubNode> = {}): StubNode {
  const self: StubNode = {
    textContent: '',
    alt: '',
    children: [],
    addEventListener: vi.fn(),
    appendChild(child) {
      self.children.push(child);
      return child;
    },
    ...fields,
  };
  return self;
}

// The visible text of a line: its own text plus every child, links included.
function rendered(element: StubNode | undefined): string {
  if (!element) return '';
  return element.textContent + element.children.map((child) => child.text ?? child.textContent).join('');
}

function run(search: string) {
  const elements = new Map([...html.matchAll(/id="([^"]+)"/g)].map((match) => [match[1], node()]));
  const document = {
    title: '',
    documentElement: { lang: '', dir: '' },
    getElementById: (id: string) => elements.get(id),
    querySelector: () => elements.get('close-btn'),
    createTextNode: (text: string) => node({ text }),
    createElement: (tag: string) => node({ tag, href: '', target: '', rel: '' }),
  };
  vm.runInNewContext(script, { document, window: { location: { search } }, URLSearchParams });
  return { document, elements };
}

const ABOUT_QUERY = {
  copyright: 'Hydra © 2026',
  author: 'Samuel Dervishi',
  authorUrl: 'https://github.com/samueldervishii',
  credit: 'Based on Sidra ©',
  originalAuthor: 'Martin Wimpress',
  originalAuthorUrl: 'https://github.com/flexiondotorg',
  license: 'BlueOak-1.0.0',
};

describe('About page display name', () => {
  it.each([
    ['?name=Test+Player', 'Test Player'],
    ['?name=%3Cb%3ETest%3C%2Fb%3E', '<b>Test</b>'],
    ['', 'Hydra'],
  ])('uses the resolved name for text and image alt with query %s', (search, name) => {
    const { document, elements } = run(search);

    expect(document.title).toBe(`About ${name}`);
    expect(elements.get('name')?.textContent).toBe(name);
    expect(elements.get('icon')?.alt).toBe(name);
    expect(html).not.toMatch(/innerHTML|insertAdjacentHTML/);
  });

  it('shows the fork notice and the Sidra credit on separate lines', () => {
    const { elements } = run('?' + new URLSearchParams(ABOUT_QUERY));

    expect(rendered(elements.get('copyright'))).toBe('Hydra © 2026 Samuel Dervishi');
    expect(rendered(elements.get('credit'))).toBe('Based on Sidra © Martin Wimpress · BlueOak-1.0.0');
  });

  // The main process opens these in the system browser; the page only builds them.
  it('makes each author a link to their GitHub profile in a new window', () => {
    const { elements } = run('?' + new URLSearchParams(ABOUT_QUERY));
    const links = ['copyright', 'credit'].map((id) => elements.get(id)?.children.find((child) => child.tag === 'a'));

    expect(links.map((link) => [link?.textContent, link?.href])).toEqual([
      ['Samuel Dervishi', 'https://github.com/samueldervishii'],
      ['Martin Wimpress', 'https://github.com/flexiondotorg'],
    ]);
    for (const link of links) {
      expect(link?.target).toBe('_blank');
      expect(link?.rel).toBe('noopener noreferrer');
    }
  });

  it('shows a name off github.com as plain text, never as a link', () => {
    const { elements } = run('?' + new URLSearchParams({ ...ABOUT_QUERY, authorUrl: 'javascript:alert(1)' }));

    expect(elements.get('copyright')?.children.some((child) => child.tag === 'a')).toBe(false);
    expect(rendered(elements.get('copyright'))).toBe('Hydra © 2026 Samuel Dervishi');
  });

  it('uses the Hydra palette instead of the maroon and gold', () => {
    expect(html).toMatch(/\.version \{[^}]*color: #12C9A5;/);
    expect(html).not.toMatch(/#1a0a10|#daa520|218, 165, 32/i);
    expect(fs.readFileSync(path.join(__dirname, '../assets/windowChrome.css'), 'utf8')).toContain('background: #0A121F;');
  });
});
