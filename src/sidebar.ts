import type { WebContents } from "electron";
import { getSidebarCollapsed } from "./config";
import { setRootAttribute } from "./rootAttribute";

/** Attribute on `<html>` that gates every rule in assets/sidebar.css. */
export const SIDEBAR_ATTRIBUTE = "data-sidra-sidebar-collapsed";

/** Mirror the stored sidebar state onto the page. */
export function applySidebar(contents: WebContents | null): Promise<void> {
  return setRootAttribute(contents, SIDEBAR_ATTRIBUTE, getSidebarCollapsed());
}
