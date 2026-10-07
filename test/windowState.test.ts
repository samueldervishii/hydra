import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import type { BrowserWindow, Rectangle } from "electron";
import { Conf } from "electron-conf/main";
import { getWindowState, setWindowState } from "../src/config";
import {
  restoreWindowBounds,
  savedWindowBounds,
  trackWindowState,
  type WindowState,
} from "../src/windowState";

// The user's two monitors: a 2560x1440 primary with GNOME's top bar, and a
// 1920x1080 to its right, offset down.
const PRIMARY: Rectangle = { x: 0, y: 32, width: 2560, height: 1408 };
const SECOND: Rectangle = { x: 2560, y: 154, width: 1920, height: 1080 };
const AREAS = [PRIMARY, SECOND];

const store = (Conf as unknown as { _data: Map<string, unknown> })._data;

describe("restoreWindowBounds", () => {
  it("keeps a state that fits its display", () => {
    expect(
      restoreWindowBounds({ x: 200, y: 100, width: 1280, height: 800, maximized: false }, AREAS),
    ).toEqual({ bounds: { x: 200, y: 100, width: 1280, height: 800 }, maximized: false });
  });

  it("keeps a window on the second display there", () => {
    expect(
      restoreWindowBounds({ x: 2700, y: 200, width: 1000, height: 700, maximized: true }, AREAS),
    ).toEqual({ bounds: { x: 2700, y: 200, width: 1000, height: 700 }, maximized: true });
  });

  it("moves a window hanging off an edge fully onto the display it overlaps most", () => {
    expect(
      restoreWindowBounds({ x: 4000, y: 1000, width: 1000, height: 700, maximized: false }, AREAS),
    ).toEqual({ bounds: { x: 3480, y: 534, width: 1000, height: 700 }, maximized: false });
  });

  it("shrinks a window larger than its display", () => {
    expect(
      restoreWindowBounds({ x: 2600, y: 154, width: 2560, height: 1408, maximized: false }, AREAS),
    ).toEqual({ bounds: { x: 2560, y: 154, width: 1920, height: 1080 }, maximized: false });
  });

  // A monitor unplugged since the last run: keep the size, let Electron centre
  // the window on the primary.
  it("centres a window on the primary when it overlaps no display", () => {
    expect(
      restoreWindowBounds({ x: 5000, y: 200, width: 1000, height: 700, maximized: false }, AREAS),
    ).toEqual({ bounds: { width: 1000, height: 700 }, maximized: false });
    expect(
      restoreWindowBounds({ x: 2700, y: 200, width: 3000, height: 2000, maximized: false }, [PRIMARY]),
    ).toEqual({ bounds: { width: 2560, height: 1408 }, maximized: false });
  });

  it("rounds fractional values and treats anything but true as not maximised", () => {
    expect(
      restoreWindowBounds({ x: 200.4, y: 99.6, width: 1280.2, height: 800.7, maximized: "yes" }, AREAS),
    ).toEqual({ bounds: { x: 200, y: 100, width: 1280, height: 801 }, maximized: false });
  });

  // config.json can be edited by hand, so anything can come back from it.
  it.each([
    ["nothing", undefined],
    ["null", null],
    ["a string", "1280x800"],
    ["a missing field", { x: 0, y: 0, width: 1280 }],
    ["a string field", { x: "0", y: 0, width: 1280, height: 800 }],
    ["an infinite field", { x: 0, y: 0, width: Infinity, height: 800 }],
    ["NaN", { x: NaN, y: 0, width: 1280, height: 800 }],
    ["a zero size", { x: 0, y: 0, width: 0, height: 800 }],
    ["a negative size", { x: 0, y: 0, width: 1280, height: -1 }],
  ])("returns null for %s", (_name, saved) => {
    expect(restoreWindowBounds(saved, AREAS)).toBeNull();
  });

  it("returns null when no display is reported", () => {
    expect(restoreWindowBounds({ x: 0, y: 0, width: 1280, height: 800 }, [])).toBeNull();
  });
});

describe("window state in the config", () => {
  beforeEach(() => store.clear());

  it("is typed as a WindowState", () => {
    expectTypeOf(getWindowState).returns.toEqualTypeOf<WindowState | undefined>();
    expectTypeOf(setWindowState).parameter(0).toEqualTypeOf<WindowState>();
  });

  it("is absent until saved, and savedWindowBounds then has nothing to restore", () => {
    expect(getWindowState()).toBeUndefined();
    expect(savedWindowBounds(AREAS)).toBeNull();
  });

  it("round-trips through savedWindowBounds", () => {
    setWindowState({ x: 200, y: 100, width: 1280, height: 800, maximized: true });
    expect(store.get("windowState")).toEqual({
      x: 200, y: 100, width: 1280, height: 800, maximized: true,
    });
    expect(savedWindowBounds(AREAS)).toEqual({
      bounds: { x: 200, y: 100, width: 1280, height: 800 },
      maximized: true,
    });
  });
});

describe("trackWindowState", () => {
  type Listener = () => void;

  function fakeWindow() {
    const listeners = new Map<string, Listener>();
    const state = {
      bounds: { x: 200, y: 100, width: 1280, height: 800 },
      maximized: false,
      minimized: false,
      fullScreen: false,
      visible: true,
      destroyed: false,
    };
    const win = {
      on: vi.fn((event: string, listener: Listener) => listeners.set(event, listener)),
      once: vi.fn((event: string, listener: Listener) => listeners.set(event, listener)),
      isDestroyed: () => state.destroyed,
      isVisible: () => state.visible,
      isMinimized: () => state.minimized,
      isFullScreen: () => state.fullScreen,
      isMaximized: () => state.maximized,
      getNormalBounds: () => ({ ...state.bounds }),
      getBounds: () => ({ ...state.bounds }),
      setBounds: vi.fn((bounds: Rectangle) => {
        state.bounds = { ...bounds };
      }),
    };
    trackWindowState(win as unknown as BrowserWindow);
    const fire = (event: string) => listeners.get(event)?.();
    return { state, fire, win };
  }

  beforeEach(() => {
    store.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("saves once a run of moves and resizes settles", () => {
    const { state, fire } = fakeWindow();
    fire("move");
    vi.advanceTimersByTime(400);
    state.bounds = { x: 300, y: 150, width: 1100, height: 700 };
    fire("resize");
    vi.advanceTimersByTime(400);
    expect(getWindowState()).toBeUndefined();
    vi.advanceTimersByTime(100);
    expect(getWindowState()).toEqual({ x: 300, y: 150, width: 1100, height: 700, maximized: false });
  });

  it("saves the normal bounds with the maximised flag", () => {
    const { state, fire } = fakeWindow();
    state.maximized = true;
    fire("maximize");
    vi.advanceTimersByTime(500);
    expect(getWindowState()).toEqual({ x: 200, y: 100, width: 1280, height: 800, maximized: true });
  });

  // On Linux, a window created maximised reports the maximised size from
  // getNormalBounds(). Saving that made un-maximising after the next launch
  // fill the screen.
  it("keeps the last normal bounds while maximised, whatever getNormalBounds() says", () => {
    const { state, fire } = fakeWindow();
    state.maximized = true;
    state.bounds = { x: 2560, y: 191, width: 1920, height: 1043 };
    fire("maximize");
    fire("close");
    expect(getWindowState()).toEqual({ x: 200, y: 100, width: 1280, height: 800, maximized: true });
    state.maximized = false;
    state.bounds = { x: 2800, y: 300, width: 1100, height: 700 };
    fire("unmaximize");
    vi.advanceTimersByTime(500);
    expect(getWindowState()).toEqual({ x: 2800, y: 300, width: 1100, height: 700, maximized: false });
  });

  it("saves at once on close, without waiting for a pending save", () => {
    const { state, fire } = fakeWindow();
    state.bounds = { x: 10, y: 40, width: 900, height: 600 };
    fire("move");
    fire("close");
    expect(getWindowState()).toEqual({ x: 10, y: 40, width: 900, height: 600, maximized: false });
  });

  it("does not save a minimised or full-screen window", () => {
    const { state, fire } = fakeWindow();
    state.minimized = true;
    fire("close");
    state.minimized = false;
    state.fullScreen = true;
    fire("close");
    expect(getWindowState()).toBeUndefined();
  });

  // Close to tray hides the window, and the move that follows reported the
  // frameless bounds, 37px higher on GNOME.
  it("does not save while the window is hidden", () => {
    const { state, fire } = fakeWindow();
    fire("close");
    state.visible = false;
    state.bounds = { x: 200, y: 63, width: 1280, height: 800 };
    fire("move");
    vi.advanceTimersByTime(500);
    fire("close");
    expect(getWindowState()).toEqual({ x: 200, y: 100, width: 1280, height: 800, maximized: false });
  });

  // On X11 a hidden window loses its frame and show() mapped it a title bar
  // higher, so close to tray crept the window up the screen.
  it("puts a window hidden to the tray back where it was", () => {
    const { state, fire, win } = fakeWindow();
    for (let i = 0; i < 3; i++) {
      state.visible = false;
      fire("hide");
      state.bounds = { ...state.bounds, y: state.bounds.y - 37 };
      fire("move");
      state.visible = true;
      fire("show");
      expect(state.bounds).toEqual({ x: 200, y: 100, width: 1280, height: 800 });
    }
    expect(win.setBounds).toHaveBeenCalledTimes(3);
  });

  it("leaves a maximised window to the window manager when it is shown again", () => {
    const { state, fire, win } = fakeWindow();
    state.maximized = true;
    fire("hide");
    fire("show");
    expect(win.setBounds).not.toHaveBeenCalled();
  });

  it("does nothing on the first show", () => {
    const { fire, win } = fakeWindow();
    fire("show");
    expect(win.setBounds).not.toHaveBeenCalled();
  });

  it("does not write an unchanged state again", () => {
    setWindowState({ x: 200, y: 100, width: 1280, height: 800, maximized: false });
    const set = vi.spyOn(store, "set");
    const { fire } = fakeWindow();
    fire("move");
    vi.advanceTimersByTime(500);
    fire("close");
    expect(set).not.toHaveBeenCalled();
    set.mockRestore();
  });

  it("drops a pending save once the window is closed", () => {
    const { state, fire } = fakeWindow();
    fire("move");
    fire("closed");
    state.destroyed = true;
    vi.advanceTimersByTime(500);
    expect(getWindowState()).toBeUndefined();
  });
});
