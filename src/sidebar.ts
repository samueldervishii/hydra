import type { BrowserWindow, Event, Input, WebContents } from "electron";
import { getSidebarCollapsed } from "./config";
import { setRootAttribute } from "./rootAttribute";

/** Attribute on `<html>` that gates every rule in assets/sidebar.css. */
export const SIDEBAR_ATTRIBUTE = "data-sidra-sidebar-collapsed";

/** Mirror the stored sidebar state onto the page. */
export function applySidebar(contents: WebContents | null): Promise<void> {
  return setRootAttribute(contents, SIDEBAR_ATTRIBUTE, getSidebarCollapsed());
}

/** Ctrl+B, or Cmd+B on macOS, with no other modifier. */
export function isSidebarShortcut(
  input: Input,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const modifier =
    platform === "darwin"
      ? input.meta && !input.control
      : input.control && !input.meta;
  return (
    input.type === "keyDown" &&
    input.key.toLowerCase() === "b" &&
    modifier &&
    !input.alt &&
    !input.shift
  );
}

/**
 * Toggle the sidebar on the shortcut while the main window has focus. The key
 * is consumed so the page never sees it, and a held key toggles once. Returns
 * the teardown, which detaches from the handle captured here because the
 * window's own getter throws once it is destroyed.
 */
export function initSidebarShortcut(
  win: BrowserWindow,
  toggle: () => void,
): () => void {
  const contents = win.webContents;
  const onInput = (event: Event, input: Input): void => {
    if (!isSidebarShortcut(input)) return;
    event.preventDefault();
    if (!input.isAutoRepeat) toggle();
  };
  contents.on("before-input-event", onInput);
  return () => {
    contents.removeListener("before-input-event", onInput);
  };
}
