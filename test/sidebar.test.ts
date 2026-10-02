// The collapsed sidebar is a stylesheet gated on an <html> attribute and the
// script that sets it. Ctrl+B is covered in test/shortcuts.test.ts. No renderer
// runs here, so the stylesheet is read as shipped and the script runs against a
// stand-in document.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { Conf } from "electron-conf/main";
import type { WebContents } from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setSidebarCollapsed } from "../src/config";
import { applySidebar, SIDEBAR_ATTRIBUTE } from "../src/sidebar";

const css = fs.readFileSync(
  path.join(__dirname, "..", "assets", "sidebar.css"),
  "utf-8",
);
const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");

function selectors(source: string): string[] {
  return [...source.matchAll(/([^{}]+)\{[^{}]+\}/g)].flatMap((match) =>
    match[1].split(/,(?![^(]*\))/).map((s) => s.trim()),
  );
}

beforeEach(() => {
  (Conf as unknown as { _data: Map<string, unknown> })._data.clear();
});

describe("sidebar.css", () => {
  it("applies only inside Apple's desktop layout", () => {
    expect(stripped.trim()).toMatch(/^@media \(min-width: 484px\) \{[\s\S]*\}$/);
  });

  it("gates every rule on the collapsed attribute", () => {
    const inner = stripped.trim().replace(/^@media[^{]*\{/, "").replace(/\}$/, "");
    const all = selectors(inner);
    expect(all.length).toBeGreaterThan(0);
    for (const selector of all) {
      expect(selector).toMatch(/^html\[data-sidra-sidebar-collapsed\]/);
    }
    expect(SIDEBAR_ATTRIBUTE).toBe("data-sidra-sidebar-collapsed");
  });

  it("narrows the variable, the grid column and the sidebar together", () => {
    expect(stripped).toMatch(/--web-navigation-width:\s*56px !important/);
    expect(stripped).toMatch(
      /grid-template-columns:\s*var\(--web-navigation-width\) minmax\(0, 1fr\) !important/,
    );
    expect(stripped).toMatch(
      /\[data-testid="header"\] \{\s*width:\s*var\(--web-navigation-width\) !important/,
    );
  });

  // A bare .header also matches every section header on the page, which
  // squeezed shelf titles to one word per line in the live app.
  it("never targets the generic .header class", () => {
    expect(selectors(stripped).filter((s) => /\.header\b/.test(s))).toEqual([]);
  });

  // Classical's search field lives in the header, not in .navigation__content,
  // and spilled out of the strip over the page until it was hidden too.
  it("hides the logo row, Classical's header search and the sidebar content, and stacks Sidra's row", () => {
    expect(stripped).toMatch(
      /html\[data-sidra-sidebar-collapsed\] \.navigation__header \.logo,\s*html\[data-sidra-sidebar-collapsed\] \.navigation__header \.search-input-wrapper,\s*html\[data-sidra-sidebar-collapsed\] \.navigation__content \{\s*display:\s*none !important/,
    );
    expect(stripped).toMatch(
      /#sidra-nav-buttons \{\s*flex-direction:\s*column !important;\s*justify-content:\s*flex-start !important/,
    );
  });

  // Apple Music's 8px header inset left the strip's icons 4px off centre.
  it("drops the header's inset so the strip's icons are centred", () => {
    expect(stripped).toMatch(
      /html\[data-sidra-sidebar-collapsed\] \.navigation__header \{[^}]*margin-inline:\s*0 !important/,
    );
  });

  // assets/navigationBar.js tags each button with the set it belongs to.
  it("swaps the browser controls for the page buttons", () => {
    expect(stripped).toMatch(
      /#sidra-nav-buttons > \[data-sidra-show="expanded"\] \{\s*display:\s*none !important/,
    );
    expect(stripped).toMatch(
      /#sidra-nav-buttons > \[data-sidra-show="collapsed"\] \{\s*display:\s*flex !important/,
    );
  });

  it("is unpacked from the asar archive, because main.ts reads it with fs", () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf-8"),
    ) as { build: { asarUnpack: string[] } };
    expect(pkg.build.asarUnpack).toContain("assets/sidebar.css");
  });
});

describe("applySidebar", () => {
  it("mirrors the stored state onto <html>", async () => {
    const contents = { executeJavaScript: vi.fn((_s: string) => Promise.resolve()) };
    const attributes = new Set<string>();
    const documentElement = {
      toggleAttribute: (name: string, force: boolean) => {
        if (force) attributes.add(name);
        else attributes.delete(name);
        return force;
      },
    };
    setSidebarCollapsed(true);
    await applySidebar(contents as unknown as WebContents);
    vm.runInNewContext(contents.executeJavaScript.mock.calls[0][0], {
      document: { documentElement },
    });
    expect(attributes).toEqual(new Set([SIDEBAR_ATTRIBUTE]));
    setSidebarCollapsed(false);
    await applySidebar(contents as unknown as WebContents);
    vm.runInNewContext(contents.executeJavaScript.mock.calls[1][0], {
      document: { documentElement },
    });
    expect(attributes).toEqual(new Set());
  });

  it("does nothing without a renderer", async () => {
    await expect(applySidebar(null)).resolves.toBeUndefined();
  });
});
