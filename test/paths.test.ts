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

  // author names this fork's maintainer for the .deb; the About window's
  // copyright line must keep naming the original author.
  it('takes the copyright holder from build.copyright, not from author', async () => {
    const pkg = await import('../package.json');
    expect(pkg.build.copyright).toBe('Copyright (c) Martin Wimpress');
    expect(pkg.author.name).toBe('samueldervishii');
  });
});
