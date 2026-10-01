import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Conf } from 'electron-conf/main';
import type { BrowserWindow } from 'electron';
import * as config from '../src/config';
import { applySettingsAction, getSettingsState, initSettingsActions, notifySettingsChanged, subscribeSettingsChanges, toggleSidebarCollapsed } from '../src/settings';
import { applyTheme, hasCustomTheme } from '../src/theme';

vi.mock('../src/theme', () => ({
  applyTheme: vi.fn(), hasCustomTheme: vi.fn(() => false),
  resolveTheme: () => config.getTheme(),
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
  dispose = initSettingsActions({ getMainWindow: () => window as unknown as BrowserWindow, applyZoom, switchService, refreshTray });
});
afterEach(() => dispose());

describe('settings actions', () => {
  it('reads defaults', () => {
    const state = getSettingsState();
    expect(state).toMatchObject({ musicService: 'music', startPage: 'new', theme: 'apple-music', zoomFactor: 1, performanceMode: true, sidebarCollapsed: false });
  });

  // Notifications, Discord and Last.fm were removed; an existing config.json
  // can still hold their keys, which must load without error and never reach
  // the state.
  it('ignores notification, Discord and Last.fm keys left in an existing config', () => {
    const store = (Conf as unknown as { _data: Map<string, unknown> })._data;
    store.set('notifications.enabled', false);
    store.set('discord.enabled', true);
    store.set('lastfm.enabled', true);
    store.set('lastfm.sessionKey', 'private-session');
    store.set('lastfm.username', 'listener');
    store.set('lastfm.pendingScrobbles', [{ artist: 'a', track: 't', timestamp: 1 }]);
    const state = getSettingsState();
    expect(state).toMatchObject({ musicService: 'music', theme: 'apple-music' });
    expect(Object.keys(state)).not.toContain('notifications');
    expect(Object.keys(state)).not.toContain('discord');
    expect(Object.keys(state)).not.toContain('lastfm');
    expect(JSON.stringify(state)).not.toContain('private-session');
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
      expect.stringContaining('toggleAttribute("data-sidra-performance", false)'));
    applySettingsAction({ type: 'performanceMode', value: true });
    expect(contents.executeJavaScript).toHaveBeenLastCalledWith(
      expect.stringContaining('toggleAttribute("data-sidra-performance", true)'));
    expect(refreshTray).toHaveBeenCalledTimes(2);
  });

  it('persists the sidebar state before applying it to the open page', () => {
    contents.executeJavaScript.mockImplementationOnce(() => {
      expect(config.getSidebarCollapsed()).toBe(true);
      return Promise.resolve();
    });
    expect(applySettingsAction({ type: 'sidebarCollapsed', value: true }).sidebarCollapsed).toBe(true);
    expect(contents.executeJavaScript).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining('toggleAttribute("data-sidra-sidebar-collapsed", true)'));
  });

  it('toggles the sidebar through the Settings action, so Settings follows the button and shortcut', () => {
    const listener = vi.fn();
    subscribeSettingsChanges(listener);
    toggleSidebarCollapsed();
    expect(config.getSidebarCollapsed()).toBe(true);
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ sidebarCollapsed: true }));
    toggleSidebarCollapsed();
    expect(config.getSidebarCollapsed()).toBe(false);
    expect(contents.executeJavaScript).toHaveBeenLastCalledWith(
      expect.stringContaining('toggleAttribute("data-sidra-sidebar-collapsed", false)'));
    expect(refreshTray).toHaveBeenCalledTimes(2);
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
    { type: 'performanceMode', value: 'false' }, { type: 'sidebarCollapsed', value: 1 },
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
