import type { WebContents } from "electron";
import { getPerformanceModeEnabled } from "./config";
import { setRootAttribute } from "./rootAttribute";

/** Attribute on `<html>` that gates every rule in assets/performanceMode.css. */
export const PERFORMANCE_ATTRIBUTE = "data-sidra-performance";

/** Mirror the stored Performance mode setting onto the page. */
export function applyPerformanceMode(
  contents: WebContents | null,
): Promise<void> {
  return setRootAttribute(
    contents,
    PERFORMANCE_ATTRIBUTE,
    getPerformanceModeEnabled(),
  );
}
