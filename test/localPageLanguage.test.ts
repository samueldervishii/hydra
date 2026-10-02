import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { extractInlineScript } from './mocks/inlineScript';

describe.each(['about', 'splash'])('%s page language', page => {
  // The About page loads its script from about.js; the splash keeps it inline.
  const script =
    page === 'about'
      ? fs.readFileSync(path.join(__dirname, '../assets/about.js'), 'utf8')
      : extractInlineScript(fs.readFileSync(path.join(__dirname, `../assets/${page}.html`), 'utf8'));

  it.each([
    ['fr', 'ltr'],
    ['ar', 'rtl'],
    ['he-IL', 'rtl'],
    ['', 'ltr'],
  ])('sets the document language and direction for %s', (lang, dir) => {
    // The About page builds its credit lines from nodes, so the stub accepts them.
    const element = { textContent: '', alt: '', addEventListener: vi.fn(), appendChild: vi.fn() };
    const document = {
      title: '',
      documentElement: { lang: '', dir: '' },
      getElementById: () => element,
      querySelector: () => element,
      createTextNode: (text: string) => ({ text }),
      createElement: () => ({}),
    };
    const search = new URLSearchParams({ lang, text: 'Chargement...' }).toString();
    vm.runInNewContext(script, { document, window: { location: { search } }, URLSearchParams, URL });
    expect(document.documentElement).toEqual({ lang: lang || 'en', dir });
    if (page === 'splash') {
      expect(document.title).toBe('Chargement...');
      expect(element.textContent).toBe('Chargement...');
    }
  });
});
