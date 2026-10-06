// Main-window shortcuts. The collapsed sidebar hides Back, Forward and Reload,
// so these keys are the only way to reach them there.
import type { BrowserWindow, Input } from "electron";
import { describe, expect, it, vi } from "vitest";
import {
  initShortcuts,
  shortcutAction,
  type ShortcutAction,
} from "../src/shortcuts";

function key(overrides: Partial<Input>): Input {
  return {
    type: "keyDown",
    key: "b",
    code: "KeyB",
    isAutoRepeat: false,
    isComposing: false,
    shift: false,
    control: false,
    alt: false,
    meta: false,
    location: 0,
    modifiers: [],
    ...overrides,
  } as Input;
}

describe("shortcutAction", () => {
  it.each([
    ["Ctrl+B", key({ control: true }), "sidebar"],
    ["Ctrl+B with Caps Lock", key({ control: true, key: "B" }), "sidebar"],
    ["Alt+Left", key({ alt: true, key: "ArrowLeft" }), "back"],
    ["Alt+Right", key({ alt: true, key: "ArrowRight" }), "forward"],
    ["Ctrl+R", key({ control: true, key: "r" }), "reload"],
    ["F5", key({ key: "F5" }), "reload"],
    ["Ctrl+K", key({ control: true, key: "k" }), "search"],
  ] as const)("maps %s on Linux", (_name, input, action) => {
    expect(shortcutAction(input, "linux")).toBe(action);
  });

  it.each([
    ["Cmd+B", key({ meta: true }), "sidebar"],
    ["Cmd+[", key({ meta: true, key: "[" }), "back"],
    ["Cmd+]", key({ meta: true, key: "]" }), "forward"],
    ["Cmd+R", key({ meta: true, key: "r" }), "reload"],
    ["Cmd+K", key({ meta: true, key: "k" }), "search"],
  ] as const)("maps %s on macOS", (_name, input, action) => {
    expect(shortcutAction(input, "darwin")).toBe(action);
  });

  it.each([
    ["key up", key({ type: "keyUp", control: true })],
    ["a plain B", key({})],
    ["Ctrl+Shift+B", key({ control: true, shift: true })],
    ["Ctrl+Alt+B", key({ control: true, alt: true })],
    ["Meta+B on Linux", key({ meta: true })],
    ["a plain arrow", key({ key: "ArrowLeft" })],
    ["Ctrl+Left, the text cursor's word jump", key({ control: true, key: "ArrowLeft" })],
    ["Alt+Shift+Left", key({ alt: true, shift: true, key: "ArrowLeft" })],
    ["Ctrl+F5", key({ control: true, key: "F5" })],
    ["Ctrl+, which Settings handles", key({ control: true, key: "," })],
    ["Ctrl+Shift+K", key({ control: true, shift: true, key: "K" })],
  ])("leaves %s to the page on Linux", (_name, input) => {
    expect(shortcutAction(input, "linux")).toBeNull();
  });

  it("leaves the Linux keys alone on macOS", () => {
    expect(shortcutAction(key({ control: true }), "darwin")).toBeNull();
    expect(shortcutAction(key({ alt: true, key: "ArrowLeft" }), "darwin")).toBeNull();
    expect(shortcutAction(key({ key: "F5" }), "darwin")).toBeNull();
  });
});

describe("initShortcuts", () => {
  function setup() {
    const listeners = new Map<string, (event: unknown, input: Input) => void>();
    const contents = {
      on: vi.fn((event: string, listener: (event: unknown, input: Input) => void) => {
        listeners.set(event, listener);
      }),
      removeListener: vi.fn((event: string) => listeners.delete(event)),
    };
    const actions: Record<ShortcutAction, ReturnType<typeof vi.fn<() => void>>> = {
      sidebar: vi.fn(),
      back: vi.fn(),
      forward: vi.fn(),
      reload: vi.fn(),
      search: vi.fn(),
    };
    const teardown = initShortcuts(
      { webContents: contents } as unknown as BrowserWindow,
      actions,
    );
    const press = (input: Input) => {
      const event = { preventDefault: vi.fn() };
      listeners.get("before-input-event")?.(event, input);
      return event;
    };
    return { contents, actions, teardown, press };
  }

  // The tests run on Linux, so the Linux keys apply.
  it("runs the matching action once per press and consumes the key", () => {
    const { actions, press } = setup();
    const first = press(key({ alt: true, key: "ArrowLeft" }));
    const held = press(key({ alt: true, key: "ArrowLeft", isAutoRepeat: true }));
    press(key({ control: true, key: "r" }));
    expect(first.preventDefault).toHaveBeenCalledOnce();
    expect(held.preventDefault).toHaveBeenCalledOnce();
    expect(actions.back).toHaveBeenCalledOnce();
    expect(actions.reload).toHaveBeenCalledOnce();
    expect(actions.forward).not.toHaveBeenCalled();
    expect(actions.sidebar).not.toHaveBeenCalled();
  });

  it("leaves other keys to the page", () => {
    const { actions, press } = setup();
    const event = press(key({ key: "n" }));
    expect(event.preventDefault).not.toHaveBeenCalled();
    for (const action of Object.values(actions)) expect(action).not.toHaveBeenCalled();
  });

  it("detaches the same listener on teardown", () => {
    const { contents, actions, teardown, press } = setup();
    const listener = contents.on.mock.calls[0][1];
    teardown();
    expect(contents.removeListener).toHaveBeenCalledWith(
      "before-input-event",
      listener,
    );
    press(key({ control: true }));
    expect(actions.sidebar).not.toHaveBeenCalled();
  });
});
