import { afterEach, describe, expect, it, vi } from 'vitest';
import { app } from 'electron';

describe('getProductInfo', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('uses the runtime display name and keeps the other package details', async () => {
    vi.resetModules();
    vi.spyOn(app, 'getName').mockReturnValue('Test Player');
    const { getProductInfo } = await import('../src/paths');
    const pkg = await import('../package.json');

    expect(getProductInfo()).toEqual({
      productName: 'Test Player',
      description: pkg.description,
      license: pkg.license,
    });
    expect(getProductInfo()).toBe(getProductInfo());
  });

  // The packaged package.json has no build key, so the About window's notices
  // come from constants that must stay equal to build.copyright.
  it('keeps build.copyright equal to the About window constants', async () => {
    const pkg = await import('../package.json');
    const ids = await import('../src/identity');
    expect(pkg.build.copyright).toBe(
      `\u00A9 ${ids.COPYRIGHT_YEAR} ${ids.COPYRIGHT_HOLDER}. Based on ${ids.ORIGINAL_NAME} \u00A9 ${ids.ORIGINAL_AUTHOR}.`,
    );
    expect(ids.ORIGINAL_AUTHOR).toBe('Martin Wimpress');
  });
});
