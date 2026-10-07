/**
 * Remembers the main window's size, position and maximised state between
 * launches. The saved rectangle is checked against the displays present at
 * launch, so a window last seen on a monitor that has since gone opens on one
 * that is there.
 */
import type { BrowserWindow, Rectangle } from "electron";
import { getWindowState, setWindowState } from "./config";

/** What `windowState` holds: the normal (unmaximised) bounds and the maximised flag. */
export interface WindowState extends Rectangle {
  maximized: boolean;
}

/** Bounds to create the window with. No x and y means Electron centres it. */
export interface RestoredWindowBounds {
  bounds: Pick<Rectangle, "width" | "height"> & Partial<Pick<Rectangle, "x" | "y">>;
  maximized: boolean;
}

/** Resizing and dragging report every step; save once they settle. */
const SAVE_DELAY_MS = 500;

function isDimension(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function overlapArea(a: Rectangle, b: Rectangle): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return width > 0 && height > 0 ? width * height : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Fit a saved state to the current displays, primary work area first. The
 * window goes on the display it overlaps most, shrunk to fit and moved fully
 * inside it. Overlapping none, it keeps its size and is centred on the
 * primary. A value that is not a usable state returns null.
 */
export function restoreWindowBounds(
  saved: unknown,
  workAreas: readonly Rectangle[],
): RestoredWindowBounds | null {
  if (typeof saved !== "object" || saved === null || workAreas.length === 0) {
    return null;
  }
  const { x, y, width, height, maximized } = saved as Record<string, unknown>;
  if (!isDimension(x) || !isDimension(y) || !isDimension(width) || !isDimension(height)) {
    return null;
  }
  if (width < 1 || height < 1) return null;
  const rect = {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
  };

  let area = workAreas[0];
  let best = 0;
  for (const candidate of workAreas) {
    const overlap = overlapArea(rect, candidate);
    if (overlap > best) {
      best = overlap;
      area = candidate;
    }
  }
  const fitted = {
    width: Math.min(rect.width, area.width),
    height: Math.min(rect.height, area.height),
  };
  const bounds =
    best === 0
      ? fitted
      : {
          ...fitted,
          x: clamp(rect.x, area.x, area.x + area.width - fitted.width),
          y: clamp(rect.y, area.y, area.y + area.height - fitted.height),
        };
  return { bounds, maximized: maximized === true };
}

/** Read the saved state and fit it to the given work areas, primary first. */
export function savedWindowBounds(
  workAreas: readonly Rectangle[],
): RestoredWindowBounds | null {
  return restoreWindowBounds(getWindowState(), workAreas);
}

/**
 * Save the window's bounds once a resize or move settles, and again as it
 * closes. A minimised or full-screen window is not saved: neither is a state
 * to reopen in. Nor is a hidden one: on X11 a window hidden to the tray loses
 * its frame, so its bounds move up by the title bar's height, and saving them
 * would open it higher on every launch. Unchanged state is not written again.
 *
 * Call it before the window is first maximised. The normal bounds are kept
 * here rather than read from getNormalBounds() while maximised: on Linux a
 * window created maximised reports its maximised size there, and saving that
 * would make un-maximising after the next launch fill the screen.
 *
 * It also puts a window hidden to the tray back where it was. On X11 the
 * hidden window loses its frame, a move then reports it a title bar higher,
 * and show() maps it there, so every hide and show crept it up the screen.
 */
export function trackWindowState(win: BrowserWindow): void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let last = JSON.stringify(getWindowState() ?? null);
  let normal = win.getNormalBounds();

  function save(): void {
    if (timer) clearTimeout(timer);
    timer = null;
    if (win.isDestroyed() || !win.isVisible() || win.isMinimized() || win.isFullScreen()) {
      return;
    }
    const maximized = win.isMaximized();
    if (!maximized) normal = win.getNormalBounds();
    const { x, y, width, height } = normal;
    const state: WindowState = { x, y, width, height, maximized };
    const serialised = JSON.stringify(state);
    if (serialised === last) return;
    last = serialised;
    setWindowState(state);
  }

  function schedule(): void {
    if (timer) clearTimeout(timer);
    timer = setTimeout(save, SAVE_DELAY_MS);
  }

  win.on("resize", schedule);
  win.on("move", schedule);
  win.on("maximize", schedule);
  win.on("unmaximize", schedule);
  win.on("close", save);

  // The hide event still reports the bounds the window had on screen. A
  // maximised window is left to the window manager: shown again, X11 reports
  // it un-maximised for a moment, and setting bounds then started a loop of
  // hundreds of unmaximize events.
  let hiddenAt: Rectangle | null = null;
  win.on("hide", () => {
    const placed = win.isMaximized() || win.isMinimized() || win.isFullScreen();
    hiddenAt = placed ? null : win.getBounds();
  });
  win.on("show", () => {
    if (hiddenAt) win.setBounds(hiddenAt);
    hiddenAt = null;
  });

  win.once("closed", () => {
    if (timer) clearTimeout(timer);
    timer = null;
  });
}
