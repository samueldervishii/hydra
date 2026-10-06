import type { WebContents } from "electron";
import { getNavigation } from "./config";
import log from "electron-log/main";
import { setRootAttribute } from "./rootAttribute";
import { errorMessage } from "./utils";

const pageLog = log.scope("page");

/**
 * Attribute on `<html>` asking for Hydra's top bar on Apple Music. It is a
 * request, not the switch: assets/topBar.js shows the bar only when the user
 * is signed in and Apple's layout checks out, and otherwise leaves Apple's
 * sidebar as it is.
 */
export const TOP_BAR_REQUEST_ATTRIBUTE = "data-hydra-top-bar-requested";

/**
 * The line assets/topBar.js prints when Apple's layout is not what its
 * stylesheet expects. src/main.ts relays exactly this line to its log.
 */
export const TOP_BAR_LAYOUT_WARNING = "[hydra] top-bar: layout-unavailable";

/**
 * Mirror the stored navigation mode onto the page, then ask the top bar to
 * re-evaluate, so a change from Settings or Ctrl+B applies without a reload.
 * On a fresh load the bar is not injected yet and reads the attribute itself.
 * Never rejects.
 */
export async function applyNavigation(contents: WebContents | null): Promise<void> {
  await setRootAttribute(
    contents,
    TOP_BAR_REQUEST_ATTRIBUTE,
    getNavigation() === "top-bar",
  );
  if (!contents) return;
  try {
    await contents.executeJavaScript("window.__hydraTopBar?.update(); undefined");
  } catch (e: unknown) {
    pageLog.warn("failed to update the top bar:", errorMessage(e));
  }
}
