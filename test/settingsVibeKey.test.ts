// A launch with a stored Vibe key and a locked keyring. It has a file of its
// own because the key store reads config once per run, and in a shared file
// earlier tests would already have settled that read.
import { describe, expect, it, vi } from 'vitest';
import { Conf } from 'electron-conf/main';
import { safeStorage, type BrowserWindow } from 'electron';

vi.mock('../src/theme', () => ({
  applyTheme: vi.fn(), hasCustomTheme: vi.fn(() => false), resolveTheme: () => 'apple-music',
}));
vi.mock('../src/integrations/lastfm', () => ({
  getStatus: vi.fn(() => ({ available: false, connected: false, connecting: false, failed: false, username: '' })),
  enable: vi.fn(), disable: vi.fn(), startAuth: vi.fn(), disconnect: vi.fn(), setStateChangedCallback: vi.fn(),
}));

describe('Settings with a locked keyring at launch', () => {
  it('reports the locked key, keeps it, and lets it be removed', async () => {
    const store = (Conf as unknown as { _data: Map<string, unknown> })._data;
    store.clear();
    const sealed = Buffer.from('sealed:sk-ant-api03-' + 'e'.repeat(40)).toString('base64');
    store.set('vibe.apiKey', sealed);
    vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(false);
    const settings = await import('../src/settings');
    const window = { isVisible: () => true, isDestroyed: () => false };
    const teardown = settings.initSettingsActions({
      getMainWindow: () => window as unknown as BrowserWindow,
      applyZoom: vi.fn(), switchService: vi.fn(), refreshTray: vi.fn(),
    });
    try {
      expect(settings.getSettingsState().vibe).toMatchObject({ hasKey: false, keyProblem: 'locked' });
      expect(store.get('vibe.apiKey')).toBe(sealed);
      settings.applySettingsAction({ type: 'vibeClearKey' });
      expect(store.has('vibe.apiKey')).toBe(false);
      expect(settings.getSettingsState().vibe).toMatchObject({ hasKey: false, keyProblem: null });
    } finally {
      teardown();
      vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true);
    }
  });
});
