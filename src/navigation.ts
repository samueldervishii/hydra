import type { WebContents } from "electron";
import { getNavigation } from "./config";
import { setRootAttribute } from "./rootAttribute";

/**
 * Attribute on `<html>` asking for Hydra's top bar on Apple Music. It is a
 * request, not the switch: assets/topBar.js shows the bar only when the user
 * is signed in and Apple's layout checks out, and otherwise leaves Apple's
 * sidebar as it is.
 */
export const TOP_BAR_REQUEST_ATTRIBUTE = "data-hydra-top-bar-requested";

/** Mirror the stored navigation mode onto the page. */
export function applyNavigation(contents: WebContents | null): Promise<void> {
  return setRootAttribute(
    contents,
    TOP_BAR_REQUEST_ATTRIBUTE,
    getNavigation() === "top-bar",
  );
}
