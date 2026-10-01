import type { BrowserWindow, Event, Input } from "electron";

/** What a main-window shortcut does. */
export type ShortcutAction = "sidebar" | "back" | "forward" | "reload";

/**
 * The action a key-down maps to, or null for keys that belong to the page.
 *
 * Sidra sets no application menu on Linux and Windows, so Chromium's own
 * browser keys never reach the page. These restore the usual ones, which the
 * collapsed sidebar relies on because it hides Back, Forward and Reload:
 * Ctrl+B toggles the sidebar, Alt+Left and Alt+Right go back and forward, and
 * Ctrl+R or F5 reloads. macOS uses Cmd+B, Cmd+[, Cmd+] and Cmd+R.
 */
export function shortcutAction(
  input: Input,
  platform: NodeJS.Platform = process.platform,
): ShortcutAction | null {
  if (input.type !== "keyDown" || input.shift) return null;
  const key = input.key.length === 1 ? input.key.toLowerCase() : input.key;
  const command =
    platform === "darwin"
      ? input.meta && !input.control && !input.alt
      : input.control && !input.meta && !input.alt;
  const plain = !input.control && !input.meta && !input.alt;
  if (command && key === "b") return "sidebar";
  if (command && key === "r") return "reload";
  if (platform === "darwin") {
    if (command && key === "[") return "back";
    if (command && key === "]") return "forward";
    return null;
  }
  const altOnly = input.alt && !input.control && !input.meta;
  if (altOnly && key === "ArrowLeft") return "back";
  if (altOnly && key === "ArrowRight") return "forward";
  if (plain && key === "F5") return "reload";
  return null;
}

/**
 * Run the shortcuts while the main window has focus. A matched key is
 * consumed so the page never sees it, and a held key acts once. Returns the
 * teardown, which detaches from the handle captured here because the window's
 * own getter throws once it is destroyed.
 */
export function initShortcuts(
  win: BrowserWindow,
  actions: Record<ShortcutAction, () => void>,
): () => void {
  const contents = win.webContents;
  const onInput = (event: Event, input: Input): void => {
    const action = shortcutAction(input);
    if (!action) return;
    event.preventDefault();
    if (!input.isAutoRepeat) actions[action]();
  };
  contents.on("before-input-event", onInput);
  return () => {
    contents.removeListener("before-input-event", onInput);
  };
}
