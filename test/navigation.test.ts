// The Navigation setting reaches the page as a request attribute, and the
// top bar is asked to re-evaluate so a change applies without a reload.
import type { WebContents } from "electron";
import { Conf } from "electron-conf/main";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setNavigation } from "../src/config";
import { applyNavigation, TOP_BAR_REQUEST_ATTRIBUTE } from "../src/navigation";

beforeEach(() => {
  (Conf as unknown as { _data: Map<string, unknown> })._data.clear();
});

function contents(impl?: (script: string) => Promise<unknown>) {
  return {
    executeJavaScript: vi.fn(impl ?? ((_script: string) => Promise.resolve())),
  };
}

describe("applyNavigation", () => {
  it("requests the top bar by default, then asks the bar to re-evaluate", async () => {
    const page = contents();
    await applyNavigation(page as unknown as WebContents);
    expect(page.executeJavaScript.mock.calls.map(([script]) => script)).toEqual([
      expect.stringContaining(`toggleAttribute(${JSON.stringify(TOP_BAR_REQUEST_ATTRIBUTE)}, true)`),
      "window.__hydraTopBar?.update(); undefined",
    ]);
  });

  it("withdraws the request for Apple's sidebar", async () => {
    setNavigation("apple-sidebar");
    const page = contents();
    await applyNavigation(page as unknown as WebContents);
    expect(page.executeJavaScript.mock.calls[0][0]).toContain(
      `toggleAttribute(${JSON.stringify(TOP_BAR_REQUEST_ATTRIBUTE)}, false)`,
    );
  });

  it("does nothing without a page and never rejects", async () => {
    await expect(applyNavigation(null)).resolves.toBeUndefined();
    const page = contents(() => Promise.reject(new Error("gone")));
    await expect(applyNavigation(page as unknown as WebContents)).resolves.toBeUndefined();
  });
});
