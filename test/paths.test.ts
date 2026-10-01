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
      copyrightHolder: 'Martin Wimpress',
      license: pkg.license,
    });
    expect(getProductInfo()).toBe(getProductInfo());
  });

  // author names this fork's maintainer for the .deb, and the packaged
  // package.json has no build key, so the About window's holder is a constant
  // that must stay equal to build.copyright.
  it('keeps the copyright holder equal to build.copyright, not author', async () => {
    const pkg = await import('../package.json');
    const { COPYRIGHT_HOLDER } = await import('../src/identity');
    expect(pkg.build.copyright).toBe(`Copyright (c) ${COPYRIGHT_HOLDER}`);
    expect(pkg.author.name).not.toBe(COPYRIGHT_HOLDER);
  });
});
