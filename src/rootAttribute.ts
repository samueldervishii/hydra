import type { WebContents } from "electron";
import log from "electron-log/main";
import { errorMessage } from "./utils";

const pageLog = log.scope("page");

/**
 * Set or remove a boolean attribute on the page's `<html>` element.
 *
 * Feature stylesheets are inserted on every load and gated on such an
 * attribute, so a setting reaches the open page without inserting or removing
 * CSS. The attribute survives SPA navigation because `<html>` does; a full load
 * replaces it, so callers apply it again from `injectContent()`. Never rejects:
 * a failure is logged and the page keeps its previous state.
 */
export async function setRootAttribute(
  contents: WebContents | null,
  name: string,
  on: boolean,
): Promise<void> {
  if (!contents) return;
  try {
    await contents.executeJavaScript(
      `document.documentElement.toggleAttribute(${JSON.stringify(name)}, ${on}); undefined`,
    );
  } catch (e: unknown) {
    pageLog.warn(`failed to set ${name}:`, errorMessage(e));
  }
}
