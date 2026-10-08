// assets/vibe.js is injected into music.apple.com. No renderer runs here, so
// the script runs in a VM against the stand-in page in test/mocks/stubDom.ts.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

import { getVibeStrings, VIBE_LABELS_TOKEN } from '../src/i18n';
import { resetStubDom, StubElement, stubDom } from './mocks/stubDom';

const source = fs.readFileSync(path.join(__dirname, '..', 'assets', 'vibe.js'), 'utf-8');
const LABELS = getVibeStrings();
const script = source.replace(VIBE_LABELS_TOKEN, () => JSON.stringify(LABELS));

/** A catalogue search answer with the shape mk.api.music() returns. */
function answer(...items: unknown[]) {
  return { data: { results: { songs: { data: items } } } };
}

function song(id: string, name: string, artistName: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    attributes: {
      name,
      artistName,
      albumName: `${name} Album`,
      artwork: { url: 'https://is1-ssl.mzstatic.com/image/thumb/a.jpg/{w}x{h}bb.jpg' },
      playParams: { id, kind: 'song' },
      ...extra,
    },
  };
}

function createHarness({ hostname = 'music.apple.com', authorized = true } = {}) {
  const body = resetStubDom();
  const music = vi.fn((_path: string, _query: Record<string, unknown>) => Promise.resolve(answer() as unknown));
  const send = vi.fn();
  const window = {
    location: { hostname },
    AMWrapper: { ipcRenderer: { send } } as unknown,
    __hydraHookedMk: { api: { music }, isAuthorized: authorized } as unknown,
    __hydraPlayNext: vi.fn(async (_ids: string[]) => true),
    __hydraPlaySongs: vi.fn(async (_ids: string[], _start: number) => undefined),
    __hydraTopBar: { refresh: vi.fn() },
    __hydraVibe: undefined as
      | {
          open(): void;
          close(): void;
          isOpen(): boolean;
          search(artist: unknown, title: unknown): Promise<unknown[]>;
          recent(): Promise<unknown[]>;
          update(state: unknown): void;
        }
      | undefined,
  };
  const context = vm.createContext({ window, document: stubDom.document, URL, console });
  const run = () => vm.runInContext(script, context);
  run();

  const host = () => body.children.find((c) => c instanceof StubElement && c.id === 'hydra-vibe') as StubElement | undefined;
  const inShadow = () => host()!.shadowRoot!.children.flatMap((c) => (c instanceof StubElement ? [c, ...c.descendants()] : []));
  const find = (cls: string) => inShadow().find((e) => (e.getAttribute('class') ?? '').split(' ').includes(cls))!;
  const findAll = (cls: string) => inShadow().filter((e) => e.getAttribute('class') === cls);
  return {
    window,
    music,
    send,
    run,
    host,
    vibe: () => window.__hydraVibe!,
    input: () => find('input'),
    go: () => find('go'),
    modes: () => findAll('mode'),
    status: () => find('status'),
    heading: () => find('heading'),
    rows: () => findAll('song'),
    settingsButton: () => find('settings'),
    isOpen: () => host()!.styles.get('display') === 'block !important',
  };
}

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

const PICKS = [
  { id: '111', title: 'Song A', artist: 'Artist A', album: 'A', explicit: true, artwork: 'https://is1-ssl.mzstatic.com/a.jpg', reason: 'Late-night glow' },
  { id: '222', title: '<b>Song B</b>', artist: 'Artist B', album: 'B', explicit: false, artwork: 'https://evil.example/b.jpg', reason: '' },
];

describe('vibe.js', () => {
  it('does nothing on Apple Music Classical', () => {
    const h = createHarness({ hostname: 'classical.music.apple.com' });
    expect(h.host()).toBeUndefined();
    expect(h.window.__hydraVibe).toBeUndefined();
  });

  it('opens and closes, telling the top bar, and closes on a repeat run', () => {
    const h = createHarness();
    expect(h.isOpen()).toBe(false);
    h.vibe().open();
    expect(h.isOpen()).toBe(true);
    expect(h.vibe().isOpen()).toBe(true);
    expect(h.window.__hydraTopBar.refresh).toHaveBeenCalledOnce();
    h.run();
    expect(h.isOpen()).toBe(false);
    expect(stubDom.body.children).toHaveLength(1);
  });

  it('sends the description with the chosen mode on Enter, but not on Shift+Enter', () => {
    const h = createHarness();
    h.vibe().open();
    h.input().value = '  rainy sunday  ';
    h.input().dispatch('keydown', { key: 'Enter', shiftKey: true });
    expect(h.send).not.toHaveBeenCalled();
    h.modes()[1].dispatch('click');
    expect(h.modes()[1].getAttribute('aria-checked')).toBe('true');
    h.input().dispatch('keydown', { key: 'Enter' });
    expect(h.send).toHaveBeenCalledExactlyOnceWith('vibe:request', { prompt: 'rainy sunday', mode: 'replace' });
    // While it runs the button cancels and the form is locked.
    expect(h.go().textContent).toBe(LABELS.cancel);
    expect(h.input().disabled).toBe(true);
    h.go().dispatch('click');
    expect(h.send).toHaveBeenLastCalledWith('vibe:cancel', undefined);
  });

  it('sends nothing for an empty description', () => {
    const h = createHarness();
    h.input().value = '   ';
    h.go().dispatch('click');
    expect(h.send).not.toHaveBeenCalled();
  });

  it('shows progress, then queues the picks next and lists them as text with their reasons', async () => {
    const h = createHarness();
    h.vibe().open();
    h.vibe().update({ status: 'working', searches: 4, maxSearches: 15 });
    expect(h.status().text).toContain('4 of 15');
    h.vibe().update({ status: 'done', mode: 'next', picks: PICKS });
    await settle();
    expect(h.window.__hydraPlayNext).toHaveBeenCalledExactlyOnceWith(['111', '222']);
    expect(h.heading().textContent).toBe(LABELS.queuedNext);
    const rows = h.rows();
    expect(rows).toHaveLength(2);
    expect(rows[0].text).toContain('Late-night glow');
    expect(rows[1].text).toContain('<b>Song B</b>');
    const art = rows.map((row) => row.descendants().find((e) => e.tagName === 'img')!);
    expect(art[0].getAttribute('src')).toBe('https://is1-ssl.mzstatic.com/a.jpg');
    expect(art[1].getAttribute('src')).toBeNull();
    expect(h.go().textContent).toBe(LABELS.submit);
  });

  // No renderer parses HTML here, so the static check below is what holds the
  // panel to text; this one shows a hostile reason ends up as text alone.
  it('renders a hostile reason, title and artwork as inert text', async () => {
    const h = createHarness();
    const hostile = '<img src=x onerror=alert(1)>';
    h.vibe().update({
      status: 'done',
      mode: 'next',
      picks: [
        { id: '1', title: hostile, artist: hostile, explicit: false, artwork: 'https://evil.example?.mzstatic.com/a.jpg', reason: hostile },
        { id: '2', title: 'B', artist: 'B', explicit: false, artwork: 'javascript:alert(1)//.mzstatic.com/', reason: '' },
      ],
    });
    await settle();
    const [row, second] = h.rows();
    const texts = row.descendants().map((e) => e.textContent);
    expect(texts.filter((t) => t === hostile)).toHaveLength(3);
    // Only the artwork <img>, and with no src from a host that is not Apple's.
    const images = [...row.descendants(), ...second.descendants()].filter((e) => e.tagName === 'img');
    expect(images).toHaveLength(2);
    for (const img of images) expect(img.getAttribute('src')).toBeNull();
    expect(row.descendants().some((e) => e.attributes.has('onerror'))).toBe(false);
  });

  it('never writes markup: no HTML sinks or code evaluation in the panel', () => {
    for (const sink of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write', 'eval(', 'new Function', 'srcdoc', 'setHTML']) {
      expect(source, sink).not.toContain(sink);
    }
  });

  it('replaces the queue when asked, and says so when queueing fails', async () => {
    const h = createHarness();
    h.vibe().update({ status: 'done', mode: 'replace', picks: PICKS });
    await settle();
    expect(h.window.__hydraPlaySongs).toHaveBeenCalledExactlyOnceWith(['111', '222'], 0);
    expect(h.heading().textContent).toBe(LABELS.queuedReplace);

    h.window.__hydraPlayNext.mockResolvedValueOnce(false);
    h.vibe().update({ status: 'done', mode: 'next', picks: PICKS });
    await settle();
    expect(h.status().text).toContain(LABELS.queueFailed);
  });

  it('explains errors, offering Settings for a missing key', () => {
    const h = createHarness();
    h.vibe().open();
    h.vibe().update({ status: 'error', code: 'no-key' });
    expect(h.status().text).toContain(LABELS.errors['no-key']);
    expect(h.settingsButton().hidden).toBe(false);
    h.settingsButton().dispatch('click');
    expect(h.send).toHaveBeenLastCalledWith('nav:settings', undefined);
    expect(h.isOpen()).toBe(false);

    h.vibe().update({ status: 'error', code: 'rate-limit' });
    expect(h.status().text).toContain(LABELS.errors['rate-limit']);
    expect(h.settingsButton().hidden).toBe(true);
    h.vibe().update({ status: 'error', code: 'made-up' });
    expect(h.status().text).toContain(LABELS.errors.failed);
  });

  it('searches the catalogue and ranks the song asked for above more popular ones', async () => {
    const h = createHarness();
    h.music.mockResolvedValueOnce(
      answer(
        song('1', 'Famous Song', 'Someone Else'),
        song('2', 'Wanted', 'Artist', { contentRating: 'clean' }),
        song('3', 'Wanted', 'Artist', { contentRating: 'explicit' }),
        song('x', 'Bad id', 'Artist'),
        song('4', 'No play params', 'Artist', { playParams: undefined }),
        song('5', 'Wanted (Live)', 'Artist'),
      ),
    );
    const found = await h.vibe().search('Artist', 'Wanted');
    expect(h.music).toHaveBeenCalledWith('/v1/catalog/{{storefrontId}}/search', {
      term: 'Artist Wanted',
      types: 'songs',
      limit: 10,
    });
    expect(found.map((s) => (s as { id: string }).id)).toEqual(['3', '2', '5']);
    expect(found[0]).toEqual({
      id: '3',
      title: 'Wanted',
      artist: 'Artist',
      album: 'Wanted Album',
      explicit: true,
      artwork: 'https://is1-ssl.mzstatic.com/image/thumb/a.jpg/80x80bb.jpg',
    });
  });

  it('answers no match rather than a different song', async () => {
    const h = createHarness();
    h.music.mockResolvedValueOnce(
      answer(song('1', 'Carefree', 'Nick Lacey'), song('2', "Don’t Stop!", 'Band'), song('3', 'Dont Stop (Remix)', 'Other')),
    );
    expect(await h.vibe().search('Band', "Don't Stop")).toEqual([
      expect.objectContaining({ id: '2' }),
      expect.objectContaining({ id: '3' }),
    ]);
    h.music.mockResolvedValueOnce(answer(song('1', 'Carefree', 'Nick Lacey')));
    expect(await h.vibe().search('Nobody', 'Zzzz Not A Song')).toEqual([]);
  });

  it('rejects a search before MusicKit exists', async () => {
    const h = createHarness();
    h.window.__hydraHookedMk = null;
    await expect(h.vibe().search('a', 'b')).rejects.toThrow();
  });

  it('reads the recently played songs only when signed in', async () => {
    const h = createHarness();
    h.music.mockResolvedValueOnce({ data: { data: [song('1', 'Recent', 'Artist R'), { attributes: {} }] } });
    expect(await h.vibe().recent()).toEqual([{ artist: 'Artist R', title: 'Recent' }]);
    expect(h.music).toHaveBeenCalledWith('/v1/me/recent/played/tracks', { limit: 20 });

    h.music.mockRejectedValueOnce(new Error('forbidden'));
    expect(await h.vibe().recent()).toEqual([]);

    const signedOut = createHarness({ authorized: false });
    expect(await signedOut.vibe().recent()).toEqual([]);
    expect(signedOut.music).not.toHaveBeenCalled();
  });

  it("keeps keys from Apple's shortcuts", () => {
    const h = createHarness();
    h.vibe().open();
    h.input().dispatch('keydown', { key: ' ' });
    expect(stubDom.bubbledToBody).toHaveLength(0);
  });

  it('closes on Escape', () => {
    const h = createHarness();
    h.vibe().open();
    h.input().dispatch('keydown', { key: 'Escape' });
    expect(h.isOpen()).toBe(false);
  });
});
