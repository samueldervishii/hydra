// assets/vibe.js is injected into music.apple.com. No renderer runs here, so
// the script runs in a VM against the stand-in page in test/mocks/stubDom.ts.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

import { getVibeStrings, VIBE_LABELS_TOKEN, VIBE_SPEND_TOKEN } from '../src/i18n';
import { resetStubDom, StubElement, stubDom } from './mocks/stubDom';

const source = fs.readFileSync(path.join(__dirname, '..', 'assets', 'vibe.js'), 'utf-8');
const LABELS = getVibeStrings();
const SPEND = { status: 'spend', spent: '$0.04', budget: '$2.00' };

function script(spend: unknown = SPEND): string {
  return source
    .replace(VIBE_LABELS_TOKEN, () => JSON.stringify(LABELS))
    .replace(VIBE_SPEND_TOKEN, () => JSON.stringify(spend));
}

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

interface VibeApi {
  open(): void;
  close(): void;
  toggle(): void;
  isOpen(): boolean;
  refresh(): void;
  search(artist: unknown, title: unknown): Promise<unknown[]>;
  recent(): Promise<unknown[]>;
  update(state: unknown): void;
}

/** Apple's player bar and app container, as far as the panel reads them. */
function applePage(body: StubElement) {
  const container = new StubElement('div');
  container.setAttribute('data-testid', 'app-container');
  container.setAttribute('class', 'app-container');
  const actions = new StubElement('div');
  actions.setAttribute('class', 'action-buttons');
  const upNext = new StubElement('button');
  upNext.setAttribute('data-testid', 'up-next-button');
  upNext.setAttribute('aria-controls', 'uid-1');
  upNext.setAttribute('aria-expanded', 'false');
  const volume = new StubElement('div');
  actions.appendChild(upNext);
  actions.appendChild(volume);
  container.appendChild(actions);
  body.appendChild(container);
  return { container, actions, upNext };
}

function createHarness({ hostname = 'music.apple.com', authorized = true } = {}) {
  const body = resetStubDom();
  const apple = applePage(body);
  const music = vi.fn((_path: string, _query: Record<string, unknown>) => Promise.resolve(answer() as unknown));
  const send = vi.fn();
  const observers: Array<{ callback: () => void; target: StubElement | null; disconnected: boolean }> = [];
  class FakeMutationObserver {
    entry: { callback: () => void; target: StubElement | null; disconnected: boolean };
    constructor(callback: () => void) {
      this.entry = { callback, target: null, disconnected: false };
      observers.push(this.entry);
    }
    observe(target: StubElement) {
      this.entry.target = target;
    }
    disconnect() {
      this.entry.disconnected = true;
    }
  }
  const window = {
    location: { hostname },
    innerWidth: 1280,
    AMWrapper: { ipcRenderer: { send } } as unknown,
    __hydraHookedMk: { api: { music }, isAuthorized: authorized } as unknown,
    __hydraPlayNext: vi.fn(async (_ids: string[]) => true),
    __hydraPlayLater: vi.fn(async (_ids: string[]) => true),
    __hydraPlaySongs: vi.fn(async (_ids: string[], _start: number) => undefined),
    __hydraTopBar: { refresh: vi.fn() },
    __hydraVibe: undefined as VibeApi | undefined,
  };
  const document = Object.assign(stubDom.document, {
    querySelector: (selector: string) => body.querySelector(selector),
    createElementNS: (_ns: string, tag: string) => new StubElement(tag),
  });
  const intervals: Array<() => void> = [];
  const context = vm.createContext({
    window,
    document,
    URL,
    console,
    MutationObserver: FakeMutationObserver,
    setInterval: (callback: () => void) => intervals.push(callback),
    setTimeout: (callback: () => void) => setTimeout(callback, 0),
    clearTimeout,
  });
  const run = (spend?: unknown) => vm.runInContext(script(spend), context);
  run();

  const host = () => body.querySelector('#hydra-vibe');
  const buttonHost = () => body.querySelector('#hydra-vibe-button');
  const inShadow = () => host()!.shadowRoot!.children.flatMap((c) => (c instanceof StubElement ? [c, ...c.descendants()] : []));
  const hasClass = (e: StubElement, cls: string) => (e.getAttribute('class') ?? '').split(' ').includes(cls);
  const find = (cls: string) => inShadow().find((e) => hasClass(e, cls))!;
  const findAll = (cls: string) => inShadow().filter((e) => hasClass(e, cls));
  const toggleButton = () => buttonHost()!.shadowRoot!.children.find((c) => c instanceof StubElement && c.tagName === 'button') as StubElement;
  return {
    window,
    music,
    send,
    run,
    apple,
    observers,
    intervals,
    host,
    buttonHost,
    toggleButton,
    vibe: () => window.__hydraVibe!,
    input: () => find('input'),
    sendButton: () => find('send'),
    find,
    findAll,
    rows: () => findAll('song'),
    statusLine: () => findAll('status').at(-1),
    isOpen: () => host()!.styles.get('display') === 'block !important',
    attributeOpen: () => body.hasAttribute('data-hydra-vibe-open'),
  };
}

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

const SONGS = [
  { id: '111', title: 'Song A', artist: 'Artist A', album: 'A', explicit: true, artwork: 'https://is1-ssl.mzstatic.com/a.jpg', reason: 'Late-night glow' },
  { id: '222', title: '<b>Song B</b>', artist: 'Artist B', album: 'B', explicit: false, artwork: 'https://evil.example/b.jpg', reason: '' },
  { id: '333', title: 'Song C', artist: 'Artist C', album: 'C', explicit: false, artwork: '', reason: 'Closer' },
];

describe('vibe.js panel', () => {
  it('does nothing on Apple Music Classical', () => {
    const h = createHarness({ hostname: 'classical.music.apple.com' });
    expect(h.host()).toBeNull();
    expect(h.buttonHost()).toBeNull();
    expect(h.window.__hydraVibe).toBeUndefined();
  });

  it("puts its button in Apple's player bar, before Up Next", () => {
    const h = createHarness();
    expect(h.buttonHost()!.parentNode).toBe(h.apple.actions);
    expect(h.apple.actions.children.indexOf(h.buttonHost()!)).toBe(h.apple.actions.children.indexOf(h.apple.upNext) - 1);
    expect(h.toggleButton().getAttribute('aria-label')).toBe(LABELS.vibe);
    // Apple draws its bar again: the check puts the button back.
    h.apple.actions.removeChild(h.buttonHost()!);
    expect(h.buttonHost()).toBeNull();
    h.intervals.forEach((check) => check());
    expect(h.buttonHost()!.parentNode).toBe(h.apple.actions);
  });

  it('opens and closes from its button and the top bar, telling the top bar, and stays open on navigation', () => {
    const h = createHarness();
    expect(h.isOpen()).toBe(false);
    h.toggleButton().dispatch('click');
    expect(h.isOpen()).toBe(true);
    expect(h.vibe().isOpen()).toBe(true);
    expect(h.attributeOpen()).toBe(true);
    expect(h.toggleButton().getAttribute('aria-expanded')).toBe('true');
    expect(h.window.__hydraTopBar.refresh).toHaveBeenCalledOnce();
    // An in-page navigation runs the script again: nothing new, nothing closed.
    h.run({ status: 'spend', spent: '$0.10', budget: '$2.00' });
    expect(h.isOpen()).toBe(true);
    expect(stubDom.body.children.filter((c) => c instanceof StubElement && c.id === 'hydra-vibe')).toHaveLength(1);
    expect(h.find('spend').textContent).toBe('$0.10 of $2.00 today');
    h.vibe().toggle();
    expect(h.isOpen()).toBe(false);
    expect(h.attributeOpen()).toBe(false);
    expect(h.toggleButton().getAttribute('aria-expanded')).toBe('false');
  });

  it("closes Apple's open drawer through Apple's button, and closes when Apple opens one", () => {
    const h = createHarness();
    const drawer = new StubElement('div');
    drawer.setAttribute('data-testid', 'side-panel');
    drawer.setAttribute('id', 'uid-1');
    h.apple.container.appendChild(drawer);
    h.apple.upNext.setAttribute('aria-expanded', 'true');
    const appleClick = vi.fn();
    h.apple.upNext.addEventListener('click', appleClick);
    h.vibe().open();
    expect(appleClick).toHaveBeenCalledOnce();
    // Apple's drawer opening again marks the container, and this panel steps aside.
    const watch = h.observers.at(-1)!;
    expect(watch.target).toBe(h.apple.container);
    watch.callback();
    expect(h.isOpen()).toBe(true);
    h.apple.container.setAttribute('class', 'app-container is-drawer-open');
    watch.callback();
    expect(h.isOpen()).toBe(false);
    expect(watch.disconnected).toBe(true);
  });

  it('leaves a closed Apple drawer alone', () => {
    const h = createHarness();
    const appleClick = vi.fn();
    h.apple.upNext.addEventListener('click', appleClick);
    h.vibe().open();
    expect(appleClick).not.toHaveBeenCalled();
  });

  // src/integrations/vibe/index.ts sets this while Vibe is switched off.
  it('takes its button away and will not open while Vibe is switched off', () => {
    const h = createHarness();
    h.vibe().open();
    stubDom.document.documentElement!.setAttribute('data-hydra-vibe-off', '');
    h.vibe().refresh();
    expect(h.isOpen()).toBe(false);
    expect(h.buttonHost()).toBeNull();
    h.vibe().open();
    expect(h.isOpen()).toBe(false);
    stubDom.document.documentElement!.removeAttribute('data-hydra-vibe-off');
    h.vibe().refresh();
    expect(h.buttonHost()).not.toBeNull();
    h.vibe().open();
    expect(h.isOpen()).toBe(true);
  });

  it('sends a message on Enter, but not on Shift+Enter, and shows it with a thinking line', () => {
    const h = createHarness();
    h.vibe().open();
    h.input().value = '  rainy sunday  ';
    h.input().dispatch('keydown', { key: 'Enter', shiftKey: true });
    expect(h.send).not.toHaveBeenCalled();
    h.input().dispatch('keydown', { key: 'Enter' });
    expect(h.send).toHaveBeenCalledExactlyOnceWith('vibe:send', { prompt: 'rainy sunday' });
    expect(h.input().value).toBe('');
    expect(h.find('bubble').textContent).toBe('rainy sunday');
    expect(h.statusLine()!.textContent).toBe(LABELS.thinking);
    // While it runs, Enter sends nothing and the button stops the turn.
    h.input().value = 'another';
    h.input().dispatch('keydown', { key: 'Enter' });
    expect(h.send).toHaveBeenCalledOnce();
    expect(h.sendButton().getAttribute('aria-label')).toBe(LABELS.stop);
    h.sendButton().dispatch('click');
    expect(h.send).toHaveBeenLastCalledWith('vibe:cancel', undefined);
  });

  it('sends nothing for an empty message', () => {
    const h = createHarness();
    h.input().value = '   ';
    h.sendButton().dispatch('click');
    expect(h.send).not.toHaveBeenCalled();
  });

  it('streams reply text into paragraphs and lists, as text', () => {
    const h = createHarness();
    h.vibe().update({ status: 'working', searches: 0, maxSearches: 15 });
    expect(h.statusLine()!.textContent).toBe(LABELS.thinking);
    h.vibe().update({ status: 'text', text: 'Here is **a** set' });
    h.vibe().update({ status: 'text', text: ' for you.\n\n- first\n- <img src=x onerror=alert(1)>\nlast line' });
    h.vibe().update({ status: 'working', searches: 3, maxSearches: 15 });
    expect(h.statusLine()!.textContent).toBe('Searching Apple Music… 3 of 15');
    const segment = h.findAll('text');
    expect(segment).toHaveLength(1);
    const parts = segment[0].descendants();
    expect(parts.map((e) => e.tagName)).toEqual(['p', 'ul', 'li', 'li', 'p']);
    expect(parts[0].textContent).toBe('Here is a set for you.');
    expect(parts[3].textContent).toBe('<img src=x onerror=alert(1)>');
    expect(parts.some((e) => e.tagName === 'img')).toBe(false);
    h.vibe().update({ status: 'done' });
    expect(h.findAll('status')).toHaveLength(0);
    expect(h.sendButton().getAttribute('aria-label')).toBe(LABELS.send);
  });

  it('shows songs as rows in the reply, text after them starting a new paragraph below', () => {
    const h = createHarness();
    h.vibe().update({ status: 'text', text: 'Try these.' });
    h.vibe().update({ status: 'songs', songs: SONGS });
    h.vibe().update({ status: 'text', text: 'Enjoy.' });
    const reply = h.find('assistant');
    expect(reply.children.map((c) => (c as StubElement).getAttribute('class'))).toEqual(['text', 'songs', 'text']);
    const rows = h.rows();
    expect(rows).toHaveLength(3);
    expect(rows[0].text).toContain('Late-night glow');
    expect(rows[0].text).toContain('E');
    expect(rows[1].text).toContain('<b>Song B</b>');
    const art = rows.map((row) => row.descendants().find((e) => e.tagName === 'img')!);
    expect(art[0].getAttribute('src')).toBe('https://is1-ssl.mzstatic.com/a.jpg');
    expect(art[1].getAttribute('src')).toBeNull();
    expect(art[2].getAttribute('src')).toBeNull();
  });

  it('plays the set from the clicked row, and the whole set from Play all', () => {
    const h = createHarness();
    h.vibe().update({ status: 'songs', songs: SONGS });
    h.findAll('play-row')[1].dispatch('click');
    expect(h.window.__hydraPlaySongs).toHaveBeenLastCalledWith(['111', '222', '333'], 1);
    h.find('play-all').dispatch('click');
    expect(h.window.__hydraPlaySongs).toHaveBeenLastCalledWith(['111', '222', '333'], 0);
    expect(h.window.__hydraPlayNext).not.toHaveBeenCalled();
  });

  it("queues one song from a row's menu, next or at the end, and says so", async () => {
    const h = createHarness();
    h.vibe().update({ status: 'songs', songs: SONGS });
    const menu = h.find('menu');
    expect(menu.hidden).toBe(true);
    const more = h.findAll('more');
    more[2].dispatch('click');
    expect(menu.hidden).toBe(false);
    expect(more[2].getAttribute('aria-expanded')).toBe('true');
    const [next, later] = menu.children as StubElement[];
    next.dispatch('click');
    await settle();
    expect(h.window.__hydraPlayNext).toHaveBeenCalledExactlyOnceWith(['333']);
    expect(h.find('notice').textContent).toBe(LABELS.queuedNext);
    expect(menu.hidden).toBe(true);

    more[0].dispatch('click');
    later.dispatch('click');
    await settle();
    expect(h.window.__hydraPlayLater).toHaveBeenCalledExactlyOnceWith(['111']);
    expect(h.find('notice').textContent).toBe(LABELS.queuedLater);

    h.window.__hydraPlayLater.mockResolvedValueOnce(false);
    more[0].dispatch('click');
    later.dispatch('click');
    await settle();
    expect(h.find('notice').textContent).toBe(LABELS.queueFailed);
    // Nothing here plays or queues on its own.
    expect(h.window.__hydraPlaySongs).not.toHaveBeenCalled();
  });

  it('closes a row menu on Escape before closing the panel', () => {
    const h = createHarness();
    h.vibe().open();
    h.vibe().update({ status: 'songs', songs: SONGS });
    h.findAll('more')[0].dispatch('click');
    const menu = h.find('menu');
    (menu.children[0] as StubElement).dispatch('keydown', { key: 'Escape' });
    expect(menu.hidden).toBe(true);
    expect(h.isOpen()).toBe(true);
    h.input().dispatch('keydown', { key: 'Escape' });
    expect(h.isOpen()).toBe(false);
  });

  it('drops songs whose ids are not catalogue ids', () => {
    const h = createHarness();
    h.vibe().update({ status: 'songs', songs: [{ ...SONGS[0], id: '1); alert(1' }, { ...SONGS[1], id: 'i.abc' }] });
    expect(h.rows()).toHaveLength(0);
    h.vibe().update({ status: 'songs', songs: [{ ...SONGS[0], id: 'x' }, SONGS[2]] });
    h.findAll('play-row')[0].dispatch('click');
    expect(h.window.__hydraPlaySongs).toHaveBeenLastCalledWith(['333'], 0);
  });

  // No renderer parses HTML here, so the static check below is what holds the
  // panel to text; this one shows hostile values end up as text alone.
  it('renders a hostile reason, title and artwork as inert text', () => {
    const h = createHarness();
    const hostile = '<img src=x onerror=alert(1)>';
    h.vibe().update({
      status: 'songs',
      songs: [
        { id: '1', title: hostile, artist: hostile, explicit: false, artwork: 'https://evil.example?.mzstatic.com/a.jpg', reason: hostile },
        { id: '2', title: 'B', artist: 'B', explicit: false, artwork: 'javascript:alert(1)//.mzstatic.com/', reason: '' },
      ],
    });
    const [row, second] = h.rows();
    const texts = row.descendants().map((e) => e.textContent);
    expect(texts.filter((t) => t === hostile)).toHaveLength(3);
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

  it('explains errors, offering Settings for the ones fixed there', () => {
    const h = createHarness();
    h.vibe().update({ status: 'error', code: 'no-key' });
    const errors = () => h.findAll('error');
    expect(errors().at(-1)!.text).toContain(LABELS.errors['no-key']);
    const settings = errors().at(-1)!.descendants().find((e) => e.getAttribute('class') === 'settings')!;
    settings.dispatch('click');
    expect(h.send).toHaveBeenLastCalledWith('nav:settings', undefined);

    h.vibe().update({ status: 'error', code: 'budget' });
    expect(errors().at(-1)!.text).toContain(LABELS.errors.budget);
    expect(errors().at(-1)!.descendants().some((e) => e.getAttribute('class') === 'settings')).toBe(true);
    h.vibe().update({ status: 'error', code: 'key-locked' });
    expect(errors().at(-1)!.text).toContain('Keyring locked: unlock it and restart Hydra, then retry.');
    expect(errors().at(-1)!.descendants().some((e) => e.getAttribute('class') === 'settings')).toBe(false);
    h.vibe().update({ status: 'error', code: 'made-up' });
    expect(errors().at(-1)!.text).toContain(LABELS.errors.failed);
  });

  it("shows today's spend from the injection and from updates", () => {
    const h = createHarness();
    expect(h.find('spend').textContent).toBe('$0.04 of $2.00 today');
    h.vibe().update({ status: 'spend', spent: '<$0.01', budget: '$5.00' });
    expect(h.find('spend').textContent).toBe('<$0.01 of $5.00 today');
  });

  it('starts a new chat: tells main, and clears the panel', () => {
    const h = createHarness();
    h.input().value = 'first';
    h.sendButton().dispatch('click');
    h.vibe().update({ status: 'songs', songs: SONGS });
    h.find('icon').dispatch('click');
    expect(h.send).toHaveBeenLastCalledWith('vibe:new-chat', undefined);
    expect(h.rows()).toHaveLength(0);
    expect(h.findAll('bubble')).toHaveLength(0);
    expect(h.find('empty').text).toBe(LABELS.empty);
    expect(h.sendButton().getAttribute('aria-label')).toBe(LABELS.send);
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

  it("keeps keys from Apple's shortcuts, in the panel and on its button", () => {
    const h = createHarness();
    h.vibe().open();
    h.input().dispatch('keydown', { key: ' ' });
    h.toggleButton().dispatch('keydown', { key: ' ' });
    expect(stubDom.bubbledToBody).toHaveLength(0);
  });

  it('closes on Escape and from its close button', () => {
    const h = createHarness();
    h.vibe().open();
    h.input().dispatch('keydown', { key: 'Escape' });
    expect(h.isOpen()).toBe(false);
    h.vibe().open();
    h.findAll('icon')[1].dispatch('click');
    expect(h.isOpen()).toBe(false);
  });
});
