import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Conf } from 'electron-conf/main';
import type { BrowserWindow } from 'electron';
import * as config from '../src/config';
import { applySettingsAction, getSettingsState, initSettingsActions, notifySettingsChanged, subscribeSettingsChanges, showAppleSidebar, toggleNavigation } from '../src/settings';
import { applyTheme, hasCustomTheme } from '../src/theme';
import * as lastfm from '../src/integrations/lastfm';
import * as vibe from '../src/integrations/vibe';

vi.mock('../src/theme', () => ({
  applyTheme: vi.fn(), hasCustomTheme: vi.fn(() => false),
  resolveTheme: () => config.getTheme(),
}));

// What the Last.fm integration reports. Unavailable by default, as it is
// without API credentials, so its actions are rejected unless a test opts in.
const lastfmStatus = vi.hoisted(() => ({
  available: false, connected: false, connecting: false, failed: false, username: '',
}));
// The real Vibe module, with cancel() observable.
vi.mock('../src/integrations/vibe', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/integrations/vibe')>()),
  cancel: vi.fn(),
}));

vi.mock('../src/integrations/lastfm', () => ({
  getStatus: vi.fn(() => ({ ...lastfmStatus })), enable: vi.fn(), disable: vi.fn(),
  startAuth: vi.fn(), disconnect: vi.fn(), setStateChangedCallback: vi.fn(),
}));

const applyZoom = vi.fn();
const refreshTray = vi.fn();
const switchService = vi.fn((id: 'music' | 'classical') => config.setMusicService(id));
const contents = { isDestroyed: () => false, executeJavaScript: vi.fn(() => Promise.resolve()) };
const window = { isVisible: () => false, show: vi.fn(), focus: vi.fn(), isDestroyed: () => false, webContents: contents };
let dispose: () => void;

beforeEach(() => {
  (Conf as unknown as { _data: Map<string, unknown> })._data.clear();
  vi.clearAllMocks();
  vi.mocked(hasCustomTheme).mockReturnValue(false);
  Object.assign(lastfmStatus, { available: false, connected: false, connecting: false, failed: false, username: '' });
  dispose = initSettingsActions({ getMainWindow: () => window as unknown as BrowserWindow, applyZoom, switchService, refreshTray });
});
afterEach(() => dispose());

describe('settings actions', () => {
  it('reads defaults', () => {
    const state = getSettingsState();
    expect(state).toMatchObject({ musicService: 'music', startPage: 'new', theme: 'apple-music', zoomFactor: 1, performanceMode: true, navigation: 'top-bar' });
  });

  // Notifications and Discord were removed; an existing config.json can still
  // hold their keys, which must load without error and never reach the state.
  // Sidra's plain-text Last.fm session key must not reach it either.
  it('ignores notification and Discord keys left in an existing config', () => {
    const store = (Conf as unknown as { _data: Map<string, unknown> })._data;
    store.set('notifications.enabled', false);
    store.set('discord.enabled', true);
    store.set('lastfm.sessionKey', 'private-session');
    const state = getSettingsState();
    expect(state).toMatchObject({ musicService: 'music', theme: 'apple-music' });
    expect(Object.keys(state)).not.toContain('notifications');
    expect(Object.keys(state)).not.toContain('discord');
    expect(JSON.stringify(state)).not.toContain('private-session');
  });

  it('reports the Last.fm status with the stored enabled flag', () => {
    Object.assign(lastfmStatus, { available: true, connected: true, username: 'listener' });
    config.setLastfmEnabled(true);
    expect(getSettingsState().lastfm).toEqual({
      available: true, connected: true, connecting: false, failed: false, username: 'listener', enabled: true,
    });
  });

  it('gates Last.fm and keeps its setter before authentication', () => {
    expect(() => applySettingsAction({ type: 'lastfmConnect' })).toThrow('Invalid settings action');
    lastfmStatus.available = true;
    vi.mocked(lastfm.startAuth).mockImplementationOnce(() => expect(config.getLastfmEnabled()).toBe(true));
    applySettingsAction({ type: 'lastfmConnect' });
    expect(lastfm.startAuth).toHaveBeenCalledOnce();
    expect(() => applySettingsAction({ type: 'lastfmEnabled', value: false })).toThrow('Invalid settings action');
    expect(() => applySettingsAction({ type: 'lastfmDisconnect' })).toThrow('Invalid settings action');
    Object.assign(lastfmStatus, { connected: true, username: 'listener' });
    expect(() => applySettingsAction({ type: 'lastfmConnect' })).toThrow('Invalid settings action');
    applySettingsAction({ type: 'lastfmEnabled', value: false });
    expect(config.getLastfmEnabled()).toBe(false);
    expect(lastfm.disable).toHaveBeenCalledOnce();
    applySettingsAction({ type: 'lastfmEnabled', value: true });
    expect(lastfm.enable).toHaveBeenCalledOnce();
    applySettingsAction({ type: 'lastfmDisconnect' });
    expect(lastfm.disconnect).toHaveBeenCalledOnce();
  });

  // A second Connect while the browser approval is pending would start a second flow.
  it('saves a Vibe key without ever putting it in the state, and removes it', () => {
    const key = 'sk-ant-api03-' + 'c'.repeat(40);
    expect(getSettingsState().vibe).toEqual({
      hasKey: false, keyPersisted: false, keyProblem: null, keyStorage: 'GNOME Keyring (gnome_libsecret)', spentToday: 0, dailyBudget: 2,
    });
    expect(() => applySettingsAction({ type: 'vibeClearKey' })).toThrow('Invalid settings action');
    for (const value of ['', 'not-a-key', 42, `${key} extra`]) {
      expect(() => applySettingsAction({ type: 'vibeApiKey', value })).toThrow('Invalid settings action');
    }
    const state = applySettingsAction({ type: 'vibeApiKey', value: key });
    expect(state.vibe).toMatchObject({ hasKey: true, keyPersisted: true });
    expect(JSON.stringify(state)).not.toContain(key);
    expect(refreshTray).toHaveBeenCalled();
    expect(applySettingsAction({ type: 'vibeClearKey' }).vibe.hasKey).toBe(false);
  });

  // Removing the key must also stop a request still running with it.
  it('forgets the Vibe key on disk and in memory, then cancels a running request', () => {
    const store = (Conf as unknown as { _data: Map<string, unknown> })._data;
    applySettingsAction({ type: 'vibeApiKey', value: 'sk-ant-api03-' + 'd'.repeat(40) });
    expect(store.has('vibe.apiKey')).toBe(true);
    vi.mocked(vibe.cancel).mockImplementationOnce(() => {
      expect(store.has('vibe.apiKey')).toBe(false);
      expect(getSettingsState().vibe.hasKey).toBe(false);
    });
    applySettingsAction({ type: 'vibeClearKey' });
    expect(vibe.cancel).toHaveBeenCalledOnce();
    expect(store.has('vibe.apiKey')).toBe(false);
  });

  it('switches Vibe off, stopping a running request, and back on', () => {
    expect(getSettingsState().vibeEnabled).toBe(true);
    applySettingsAction({ type: 'vibeEnabled', value: false });
    expect(config.getVibeEnabled()).toBe(false);
    expect(vibe.cancel).toHaveBeenCalledOnce();
    expect(getSettingsState().vibeEnabled).toBe(false);
    applySettingsAction({ type: 'vibeEnabled', value: true });
    expect(config.getVibeEnabled()).toBe(true);
    expect(vibe.cancel).toHaveBeenCalledOnce();
    expect(() => applySettingsAction({ type: 'vibeEnabled', value: 'no' })).toThrow('Invalid settings action');
  });

  it('switches the Vibe model between the two offered', () => {
    expect(getSettingsState().vibeModel).toBe('claude-haiku-5-5');
    expect(getSettingsState().options.vibeModel.map((option) => option.value)).toEqual(['claude-haiku-5-5', 'claude-sonnet-5-5']);
    applySettingsAction({ type: 'vibeModel', value: 'claude-sonnet-5-5' });
    expect(config.getVibeModel()).toBe('claude-sonnet-5-5');
    expect(() => applySettingsAction({ type: 'vibeModel', value: 'claude-opus-5-5' })).toThrow('Invalid settings action');
    // A hand-edited model id reads as the default.
    (Conf as unknown as { _data: Map<string, unknown> })._data.set('vibe.model', 'gpt');
    expect(getSettingsState().vibeModel).toBe('claude-haiku-5-5');
  });

  it('sets the Vibe daily budget within $0.10 to $100 in whole cents', () => {
    const store = (Conf as unknown as { _data: Map<string, unknown> })._data;
    expect(getSettingsState().vibe.dailyBudget).toBe(2);
    applySettingsAction({ type: 'vibeDailyBudget', value: 0.5 });
    expect(config.getVibeDailyBudget()).toBe(0.5);
    expect(getSettingsState().vibe.dailyBudget).toBe(0.5);
    applySettingsAction({ type: 'vibeDailyBudget', value: 100 });
    expect(config.getVibeDailyBudget()).toBe(100);
    for (const value of [0, 0.09, 100.01, 0.105, -1, Number.NaN, Infinity, '2', null]) {
      expect(() => applySettingsAction({ type: 'vibeDailyBudget', value })).toThrow('Invalid settings action');
    }
    expect(config.getVibeDailyBudget()).toBe(100);
    // A hand-edited budget Settings would refuse reads as the default.
    store.set('vibe.dailyBudget', 5000);
    expect(config.getVibeDailyBudget()).toBe(2);
  });

  it('refuses Connect while a connection is in progress', () => {
    Object.assign(lastfmStatus, { available: true, connecting: true });
    expect(() => applySettingsAction({ type: 'lastfmConnect' })).toThrow('Invalid settings action');
    expect(lastfm.startAuth).not.toHaveBeenCalled();
  });

  it('publishes asynchronous Last.fm changes and stops on teardown', () => {
    const listener = vi.fn();
    subscribeSettingsChanges(listener);
    const callback = vi.mocked(lastfm.setStateChangedCallback).mock.calls.at(-1)?.[0];
    Object.assign(lastfmStatus, { available: true, connected: true, username: 'listener' });
    callback?.();
    expect(refreshTray).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ lastfm: expect.objectContaining({ connected: true }) }));
    dispose();
    expect(lastfm.setStateChangedCallback).toHaveBeenLastCalledWith(null);
    notifySettingsChanged();
    expect(listener).toHaveBeenCalledOnce();
  });

  it('persists before runtime effects and publishes the new state', () => {
    applyZoom.mockImplementationOnce(() => expect(config.getZoomFactor()).toBe(1.5));
    vi.mocked(applyTheme).mockImplementationOnce(() => expect(config.getTheme()).toBe('nord'));
    const listener = vi.fn();
    const unsubscribe = subscribeSettingsChanges(listener);
    applySettingsAction({ type: 'closeToTray', value: true });
    applySettingsAction({ type: 'zoomFactor', value: 1.5 });
    applySettingsAction({ type: 'theme', value: 'nord' });
    applySettingsAction({ type: 'performanceMode', value: false });
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ closeToTray: true, zoomFactor: 1.5, theme: 'nord', performanceMode: false }));
    unsubscribe();
    notifySettingsChanged();
    expect(listener).toHaveBeenCalledTimes(4);
  });

  it('persists Performance mode before applying it to the open page', () => {
    contents.executeJavaScript.mockImplementationOnce(() => {
      expect(config.getPerformanceModeEnabled()).toBe(false);
      return Promise.resolve();
    });
    const state = applySettingsAction({ type: 'performanceMode', value: false });
    expect(state.performanceMode).toBe(false);
    expect(contents.executeJavaScript).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining('toggleAttribute("data-hydra-performance", false)'));
    applySettingsAction({ type: 'performanceMode', value: true });
    expect(contents.executeJavaScript).toHaveBeenLastCalledWith(
      expect.stringContaining('toggleAttribute("data-hydra-performance", true)'));
    expect(refreshTray).toHaveBeenCalledTimes(2);
  });

  it('defaults to the top bar and persists a navigation change before asking the open page for it', () => {
    expect(getSettingsState().navigation).toBe('top-bar');
    expect(getSettingsState().options.navigation.map((option) => option.value)).toEqual(['top-bar', 'apple-sidebar']);
    contents.executeJavaScript.mockImplementationOnce(() => {
      expect(config.getNavigation()).toBe('apple-sidebar');
      return Promise.resolve();
    });
    expect(applySettingsAction({ type: 'navigation', value: 'apple-sidebar' }).navigation).toBe('apple-sidebar');
    expect(contents.executeJavaScript).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining('toggleAttribute("data-hydra-top-bar-requested", false)'));
    applySettingsAction({ type: 'navigation', value: 'top-bar' });
    expect(contents.executeJavaScript).toHaveBeenLastCalledWith(
      expect.stringContaining('toggleAttribute("data-hydra-top-bar-requested", true)'));
  });

  it('switches the navigation mode through the Settings action, so Settings follows Ctrl+B', () => {
    const listener = vi.fn();
    subscribeSettingsChanges(listener);
    toggleNavigation();
    expect(config.getNavigation()).toBe('apple-sidebar');
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ navigation: 'apple-sidebar' }));
    toggleNavigation();
    expect(config.getNavigation()).toBe('top-bar');
    expect(contents.executeJavaScript).toHaveBeenLastCalledWith(
      expect.stringContaining('toggleAttribute("data-hydra-top-bar-requested", true)'));
    expect(refreshTray).toHaveBeenCalledTimes(2);
  });

  it("switches to Apple's sidebar for the account menu", () => {
    showAppleSidebar();
    expect(config.getNavigation()).toBe('apple-sidebar');
    showAppleSidebar();
    expect(config.getNavigation()).toBe('apple-sidebar');
  });

  it('shows a hidden player when close to tray is disabled', () => {
    config.setCloseToTrayEnabled(true);
    applySettingsAction({ type: 'closeToTray', value: false });
    expect(config.getCloseToTrayEnabled()).toBe(false);
    expect(window.show).toHaveBeenCalledOnce();
    expect(window.focus).toHaveBeenCalledOnce();
  });

  it('switches once and preserves independent start pages', () => {
    applySettingsAction({ type: 'startPage', serviceId: 'music', value: 'radio' });
    applySettingsAction({ type: 'musicService', value: 'classical' });
    applySettingsAction({ type: 'musicService', value: 'classical' });
    expect(switchService).toHaveBeenCalledOnce();
    expect(getSettingsState().startPage).toBe('home');
    applySettingsAction({ type: 'startPage', serviceId: 'classical', value: 'search' });
    expect(config.getStartPage()).toBe('radio');
    expect(config.getClassicalStartPage()).toBe('search');
    expect(() => applySettingsAction({ type: 'startPage', serviceId: 'music', value: 'home' })).toThrow();
  });

  it.each([
    null, [], {}, { type: 'arbitrary' }, { type: 'closeToTray', value: 1 },
    { type: 'zoomFactor', value: 1.1 }, { type: 'zoomFactor', value: NaN },
    { type: 'musicService', value: 'other' }, { type: 'theme', value: 'custom' },
    { type: 'theme', value: 'other' }, { type: 'startPage', serviceId: 'music', value: 'search' },
    { type: 'closeToTray', value: true, extra: true }, { type: 'notifications', value: false }, { type: 'lastfmDisconnect' },
    { type: 'lastfmEnabled', value: true }, { type: 'lastfmConnect' }, { type: 'discord', value: true },
    { type: 'performanceMode', value: 'false' }, { type: 'sidebarCollapsed', value: true },
    { type: 'navigation', value: 'sidebar' }, { type: 'navigation', value: true },
  ])('rejects unavailable or malformed actions: %j', action => {
    expect(() => applySettingsAction(action)).toThrow('Invalid settings action');
    expect(refreshTray).not.toHaveBeenCalled();
    expect(config.getTheme()).toBe('apple-music');
  });

  it('translates the Custom Theme label and keeps its option value', async () => {
    vi.resetModules();
    const { app } = await import('electron');
    const language = vi.spyOn(app, 'getPreferredSystemLanguages').mockReturnValue(['fr']);
    const theme = await import('../src/theme');
    vi.mocked(theme.hasCustomTheme).mockReturnValue(true);
    try {
      const { getSettingsState: freshState } = await import('../src/settings');
      expect(freshState().options.theme).toContainEqual({ value: 'custom', label: 'Thème personnalisé' });
    } finally {
      language.mockRestore();
      vi.resetModules();
    }
  });

  it('accepts Custom Theme only while it is available', () => {
    vi.mocked(hasCustomTheme).mockReturnValue(true);
    applySettingsAction({ type: 'theme', value: 'custom' });
    expect(config.getTheme()).toBe('custom');
    vi.mocked(hasCustomTheme).mockReturnValue(false);
    expect(() => applySettingsAction({ type: 'theme', value: 'custom' })).toThrow();
  });

});
