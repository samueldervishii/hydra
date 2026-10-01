// The collapsed sidebar is a stylesheet gated on an <html> attribute, the
// script that sets it, and the Ctrl+B shortcut. No renderer runs here, so the
// stylesheet is read as shipped and the script runs against a stand-in document.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { Conf } from "electron-conf/main";
import type { BrowserWindow, Input, WebContents } from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setSidebarCollapsed } from "../src/config";
import {
  applySidebar,
  initSidebarShortcut,
  isSidebarShortcut,
  SIDEBAR_ATTRIBUTE,
} from "../src/sidebar";

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

function key(overrides: Partial<Input>): Input {
  return {
    type: "keyDown",
    key: "b",
    code: "KeyB",
    isAutoRepeat: false,
    isComposing: false,
    shift: false,
    control: true,
    alt: false,
    meta: false,
    location: 0,
    modifiers: [],
    ...overrides,
  } as Input;
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

  it("keeps Sidra's buttons visible and stacks them", () => {
    expect(stripped).toMatch(/\.logo > :not\(#sidra-nav-buttons\)/);
    expect(stripped).toMatch(
      /#sidra-nav-buttons \{\s*flex-direction:\s*column !important/,
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

describe("isSidebarShortcut", () => {
  it.each([
    ["linux", key({})],
    ["win32", key({ key: "B" })],
    ["darwin", key({ control: false, meta: true })],
  ] as const)("accepts the shortcut on %s", (platform, input) => {
    expect(isSidebarShortcut(input, platform)).toBe(true);
  });

  it.each([
    ["key up", key({ type: "keyUp" })],
    ["another key", key({ key: "n" })],
    ["no modifier", key({ control: false })],
    ["Shift", key({ shift: true })],
    ["Alt", key({ alt: true })],
    ["Meta on Linux", key({ control: false, meta: true })],
  ])("rejects %s", (_name, input) => {
    expect(isSidebarShortcut(input, "linux")).toBe(false);
  });

  it("rejects Ctrl+B on macOS", () => {
    expect(isSidebarShortcut(key({}), "darwin")).toBe(false);
  });
});

describe("initSidebarShortcut", () => {
  function setup() {
    const listeners = new Map<string, (event: unknown, input: Input) => void>();
    const contents = {
      on: vi.fn((event: string, listener: (event: unknown, input: Input) => void) => {
        listeners.set(event, listener);
      }),
      removeListener: vi.fn((event: string) => listeners.delete(event)),
    };
    const toggle = vi.fn();
    const teardown = initSidebarShortcut(
      { webContents: contents } as unknown as BrowserWindow,
      toggle,
    );
    const press = (input: Input) => {
      const event = { preventDefault: vi.fn() };
      listeners.get("before-input-event")?.(event, input);
      return event;
    };
    return { contents, toggle, teardown, press };
  }

  it("consumes the shortcut and toggles once per press", () => {
    const { toggle, press } = setup();
    const first = press(key({}));
    const held = press(key({ isAutoRepeat: true }));
    expect(first.preventDefault).toHaveBeenCalledOnce();
    expect(held.preventDefault).toHaveBeenCalledOnce();
    expect(toggle).toHaveBeenCalledOnce();
  });

  it("leaves other keys to the page", () => {
    const { toggle, press } = setup();
    const event = press(key({ key: "n" }));
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(toggle).not.toHaveBeenCalled();
  });

  it("detaches the same listener on teardown", () => {
    const { contents, toggle, teardown, press } = setup();
    const listener = contents.on.mock.calls[0][1];
    teardown();
    expect(contents.removeListener).toHaveBeenCalledWith(
      "before-input-event",
      listener,
    );
    press(key({}));
    expect(toggle).not.toHaveBeenCalled();
  });
});
