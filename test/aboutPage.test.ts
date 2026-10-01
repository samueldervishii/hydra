import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { extractInlineScript } from './mocks/inlineScript';

const html = fs.readFileSync(path.join(__dirname, '../assets/about.html'), 'utf8');
const script = extractInlineScript(html);

describe('About page display name', () => {
  it.each([
    ['?name=Test+Player', 'Test Player'],
    ['?name=%3Cb%3ETest%3C%2Fb%3E', '<b>Test</b>'],
    ['', 'Hydra'],
  ])('uses the resolved name for text and image alt with query %s', (search, name) => {
    const elements = new Map([...html.matchAll(/id="([^"]+)"/g)].map(match => [
      match[1], { textContent: '', alt: '', addEventListener: vi.fn() },
    ]));
    const document = {
      title: '',
      documentElement: { lang: '', dir: '' },
      getElementById: (id: string) => elements.get(id),
      querySelector: () => elements.get('close-btn'),
    };
    vm.runInNewContext(script, { document, window: { location: { search } }, URLSearchParams });

    expect(document.title).toBe(`About ${name}`);
    expect(elements.get('name')?.textContent).toBe(name);
    expect(elements.get('icon')?.alt).toBe(name);
    expect(html).not.toMatch(/innerHTML|insertAdjacentHTML/);
  });

  it('shows the fork notice and the Sidra credit on separate lines', () => {
    const elements = new Map([...html.matchAll(/id="([^"]+)"/g)].map(match => [
      match[1], { textContent: '', alt: '', addEventListener: vi.fn() },
    ]));
    const document = {
      title: '',
      documentElement: { lang: '', dir: '' },
      getElementById: (id: string) => elements.get(id),
      querySelector: () => elements.get('close-btn'),
    };
    const search = '?' + new URLSearchParams({
      copyright: 'Hydra \u00A9 2026 Samuel Dervishi',
      credit: 'Based on Sidra \u00A9 Martin Wimpress \u00B7 BlueOak-1.0.0',
    });
    vm.runInNewContext(script, { document, window: { location: { search } }, URLSearchParams });

    expect(elements.get('copyright')?.textContent).toBe('Hydra \u00A9 2026 Samuel Dervishi');
    expect(elements.get('credit')?.textContent).toBe('Based on Sidra \u00A9 Martin Wimpress \u00B7 BlueOak-1.0.0');
  });
});
