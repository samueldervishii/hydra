// Performance mode is a stylesheet gated on an <html> attribute plus the script
// that sets it. No renderer runs here, so the stylesheet is read as shipped and
// the attribute script is run against a stand-in document.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { Conf } from "electron-conf/main";
import type { WebContents } from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setPerformanceModeEnabled } from "../src/config";
import {
  applyPerformanceMode,
  PERFORMANCE_ATTRIBUTE,
} from "../src/performanceMode";

const css = fs.readFileSync(
  path.join(__dirname, "..", "assets", "performanceMode.css"),
  "utf-8",
);

function rules(source: string): { selectors: string[]; body: string }[] {
  const stripped = source.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...stripped.matchAll(/([^{}]+)\{([^{}]+)\}/g)].map((match) => ({
    selectors: match[1].split(/,(?![^(]*\))/).map((s) => s.trim()),
    body: match[2],
  }));
}

function fakeContents() {
  return {
    executeJavaScript: vi.fn((_script: string) => Promise.resolve()),
  };
}

// Run the script the main process sends against a stand-in <html> element.
function runScript(script: string): Set<string> {
  const attributes = new Set<string>(["lang"]);
  const documentElement = {
    toggleAttribute: (name: string, force: boolean) => {
      if (force) attributes.add(name);
      else attributes.delete(name);
      return force;
    },
  };
  vm.runInNewContext(script, { document: { documentElement } });
  return attributes;
}

beforeEach(() => {
  (Conf as unknown as { _data: Map<string, unknown> })._data.clear();
});

describe("performanceMode.css", () => {
  it("gates every rule on the Performance mode attribute", () => {
    const all = rules(css);
    expect(all.length).toBeGreaterThan(0);
    for (const { selectors } of all) {
      for (const selector of selectors) {
        expect(selector).toMatch(/^html\[data-sidra-performance\] /);
      }
    }
    expect(PERFORMANCE_ATTRIBUTE).toBe("data-sidra-performance");
  });

  it("removes every backdrop blur, the player bar's included", () => {
    const blur = rules(css).find((rule) =>
      /backdrop-filter:\s*none !important/.test(rule.body),
    );
    expect(blur?.selectors).toEqual([
      "html[data-sidra-performance] *",
      "html[data-sidra-performance] *::before",
      "html[data-sidra-performance] *::after",
    ]);
  });

  // Without the blur, content scrolling under these surfaces showed through
  // their 60% glass. Each gets an opaque base in the page's own colour, which
  // artist pages override with --joe-color.
  it("puts an opaque page-coloured base under every surface that floats over content", () => {
    const all = rules(css);
    const base = (selector: string) =>
      all.find((rule) => rule.selectors.includes(selector))?.body ?? "";
    const surfaces =
      ':is([data-testid="header"], .chrome-player, .cloud-buttons--with-platter)';
    expect(base(`html[data-sidra-performance] ${surfaces}`)).toMatch(
      /background-color:\s*var\(--pageBG\) !important/,
    );
    expect(
      base(`html[data-sidra-performance] .app-container.has-theme-override ${surfaces}`),
    ).toMatch(/background-color:\s*var\(--joe-color, var\(--pageBG\)\) !important/);
    expect(base("html[data-sidra-performance] .chrome-volume__slider")).toMatch(
      /var\(--systemStandardMediumMaterialSover\)\),\s*var\(--pageBG\) !important/,
    );
    // An opaque base, never a blur: nothing in the file sets one.
    expect(css).not.toMatch(/backdrop-filter:(?!\s*none)/);
  });

  // Up Next, Lyrics and the "…" menu showed the page through their glass once
  // the blur went. Each floating surface layers its own material over the
  // page colour; the menu and the bubble tip's arrow paint on ::before.
  it("puts an opaque page-coloured base under every floating panel, menu and modal", () => {
    const all = rules(css);
    const floating =
      ":is(.side-panel, .mini-player, .search-suggestions, .popover-toggle__popover, .error-modal__container, .action-modal, .bubble-tip, .content-scope-bar)";
    const layered = (base: string) =>
      new RegExp(
        `linear-gradient\\(var\\(--sidra-material\\), var\\(--sidra-material\\)\\),\\s*${base} !important`,
      );
    const page = all.find((rule) =>
      rule.selectors.includes(`html[data-sidra-performance] ${floating}`),
    );
    expect(page?.body).toMatch(layered("var\\(--pageBG\\)"));
    expect(page?.selectors).toEqual(
      expect.arrayContaining([
        "html[data-sidra-performance] .contextual-menu::before",
        "html[data-sidra-performance] .bubble-tip--has-arrow::before",
      ]),
    );
    const artist = all.find((rule) =>
      rule.selectors.includes(
        `html[data-sidra-performance] .app-container.has-theme-override ${floating}`,
      ),
    );
    expect(artist?.body).toMatch(layered("var\\(--joe-color, var\\(--pageBG\\)\\)"));

    // Every surface in the list names its material, and the side panel
    // prefers the colour Sidra's themes hand it.
    const material = (selector: string) =>
      all.find((rule) =>
        rule.selectors.some((s) => s === `html[data-sidra-performance] ${selector}` ||
          (s.startsWith("html[data-sidra-performance] :is(") && s.includes(selector))) &&
        /--sidra-material:/.test(rule.body),
      )?.body ?? "";
    for (const surface of [".side-panel", ".mini-player", ".contextual-menu", ".search-suggestions", ".popover-toggle__popover", ".error-modal__container", ".action-modal", ".bubble-tip", ".content-scope-bar"]) {
      expect(material(surface), surface).toMatch(/--sidra-material:\s*var\(--/);
    }
    expect(material(".side-panel")).toMatch(
      /--sidra-material:\s*var\(--sidra-side-panel-material, var\(--glassMaterialBackground\)\)/,
    );
  });

  it("gives the platters a solid background and drops their will-change", () => {
    const platters = rules(css).find((rule) =>
      rule.selectors.some((s) => s.includes(".more-button")),
    );
    expect(platters?.selectors[0]).toContain(".shelf-grid-nav__arrow");
    // Track rows and the player bar use a bare "…" that has no platter; a
    // grey square behind its dark glyph made it unreadable in light mode.
    expect(platters?.selectors[0]).toContain(
      ".more-button:not(.more-button--non-platter)",
    );
    expect(platters?.body).toMatch(
      /background-color:\s*rgba\(70, 70, 70, 0\.9\) !important/,
    );
    expect(platters?.body).toMatch(/will-change:\s*auto !important/);
  });

  it("is unpacked from the asar archive, because main.ts reads it with fs", () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf-8"),
    ) as { build: { asarUnpack: string[] } };
    expect(pkg.build.asarUnpack).toContain("assets/performanceMode.css");
  });
});

describe("applyPerformanceMode", () => {
  it("sets the attribute by default and removes it once disabled", async () => {
    const contents = fakeContents();
    await applyPerformanceMode(contents as unknown as WebContents);
    expect(runScript(contents.executeJavaScript.mock.calls[0][0])).toEqual(
      new Set(["lang", PERFORMANCE_ATTRIBUTE]),
    );
    setPerformanceModeEnabled(false);
    await applyPerformanceMode(contents as unknown as WebContents);
    expect(runScript(contents.executeJavaScript.mock.calls[1][0])).toEqual(
      new Set(["lang"]),
    );
  });

  it("does nothing without a renderer and never rejects", async () => {
    await expect(applyPerformanceMode(null)).resolves.toBeUndefined();
    const contents = fakeContents();
    contents.executeJavaScript.mockRejectedValueOnce(new Error("gone"));
    await expect(
      applyPerformanceMode(contents as unknown as WebContents),
    ).resolves.toBeUndefined();
  });
});
