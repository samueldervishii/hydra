import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { restorePlatform, setPlatform } from "./mocks/platform";

type Listener = (...args: unknown[]) => unknown;

const bootstrap = vi.hoisted(() => {
  const mainWebListeners = new Map<string, Listener>();
  const mainWebOnceListeners = new Map<string, Listener>();
  const appListeners = new Map<string, Listener>();
  const mainWindowOnceListeners = new Map<string, Listener>();
  const mainWindowListeners = new Map<string, Listener>();
  const splashOnceListeners = new Map<string, Listener>();

  const webContents = {
    mainFrame: { url: "https://music.apple.com/gb/new" },
    isDestroyed: vi.fn(() => false),
    on: vi.fn((event: string, listener: Listener) => {
      mainWebListeners.set(event, listener);
    }),
    once: vi.fn((event: string, listener: Listener) => {
      mainWebOnceListeners.set(event, listener);
    }),
    executeJavaScript: vi.fn(() => Promise.resolve(true)),
    insertCSS: vi.fn(() => Promise.resolve("css-key")),
    setZoomFactor: vi.fn(),
    setWindowOpenHandler: vi.fn(),
    getURL: vi.fn(() => "https://music.apple.com/gb/new"),
    openDevTools: vi.fn(),
    send: vi.fn(),
    reload: vi.fn(),
    navigationHistory: {
      goBack: vi.fn(),
      goForward: vi.fn(),
    },
  };

  const mainWindow = {
    isDestroyed: vi.fn(() => false),
    // Electron's native webContents getter throws after window destruction.
    // The mock must reject unguarded teardown reads because destruction precedes will-quit.
    get webContents() {
      if (mainWindow.isDestroyed())
        throw new TypeError("Object has been destroyed");
      return webContents;
    },
    loadURL: vi.fn(() => Promise.reject(new Error("offline"))),
    on: vi.fn((event: string, listener: Listener) => {
      mainWindowListeners.set(event, listener);
    }),
    once: vi.fn((event: string, listener: Listener) => {
      mainWindowOnceListeners.set(event, listener);
    }),
    show: vi.fn(),
    hide: vi.fn(),
    close: vi.fn(),
    focus: vi.fn(),
    restore: vi.fn(),
    // Native window methods throw once the window has been destroyed.
    isVisible: vi.fn(() => {
      if (mainWindow.isDestroyed())
        throw new TypeError("Object has been destroyed");
      return true;
    }),
    isMinimized: vi.fn(() => false),
    setMinimumSize: vi.fn(),
    getSize: vi.fn(() => [1280, 800]),
    setSize: vi.fn(),
  };

  const splashWindow = {
    webContents: {
      on: vi.fn(),
      setZoomFactor: vi.fn(),
    },
    loadFile: vi.fn(() => Promise.resolve()),
    once: vi.fn((event: string, listener: Listener) => {
      splashOnceListeners.set(event, listener);
    }),
    isDestroyed: vi.fn(() => false),
    show: vi.fn(),
    close: vi.fn(),
  };

  const integrations = {
    dock: vi.fn(),
    windowsTaskbar: vi.fn(),
    wedgeDetector: vi.fn(),
    trayState: vi.fn(() => vi.fn()),
  };
  const resetForDocumentReplacement = vi.fn();

  return {
    mainWebListeners,
    mainWebOnceListeners,
    appListeners,
    mainWindowOnceListeners,
    mainWindowListeners,
    splashOnceListeners,
    webContents,
    mainWindow,
    splashWindow,
    integrations,
    resetForDocumentReplacement,
    handleHookReady: vi.fn(),
    applyPerformanceMode: vi.fn(() => Promise.resolve()),
    applySidebar: vi.fn(() => Promise.resolve()),
    teardownShortcuts: vi.fn(),
    toggleSidebarCollapsed: vi.fn(),
    handlePlaybackCapabilitiesDidChange: vi.fn(),
    browserWindow: vi.fn(),
    ipcOn: vi.fn(),
    appQuit: vi.fn(),
    appOn: vi.fn((event: string, listener: Listener) => {
      appListeners.set(event, listener);
    }),
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      silly: vi.fn(),
    },
    tray: {},
  };
});

vi.mock("electron", () => ({
  app: {
    name: "Hydra",
    isPackaged: false,
    getName: vi.fn(() => "Test Player"),
    getVersion: vi.fn(() => "0.3.0"),
    getPath: vi.fn((name: string) => `/tmp/hydra-test/${name}`),
    whenReady: vi.fn(() => Promise.resolve()),
    on: bootstrap.appOn,
    quit: bootstrap.appQuit,
    requestSingleInstanceLock: vi.fn(() => true),
    setAppUserModelId: vi.fn(),
    setAsDefaultProtocolClient: vi.fn(() => true),
    commandLine: { appendSwitch: vi.fn(), hasSwitch: vi.fn(() => false) },
    setPath: vi.fn(),
    setDesktopName: vi.fn(),
    userAgentFallback: "",
  },
  BrowserWindow: bootstrap.browserWindow,
  components: {
    whenReady: vi.fn(() => Promise.resolve()),
    status: vi.fn(() => ({})),
  },
  ipcMain: { on: bootstrap.ipcOn },
  Menu: {
    buildFromTemplate: vi.fn(),
    setApplicationMenu: vi.fn(),
  },
  session: {
    defaultSession: { setUserAgent: vi.fn() },
    fromPartition: vi.fn(() => ({
      clearData: vi.fn(() => Promise.resolve()),
      setUserAgent: vi.fn(),
      webRequest: { onBeforeSendHeaders: vi.fn() },
    })),
  },
  Tray: class {},
  webFrameMain: { fromId: vi.fn() },
}));

vi.mock("electron-log/main", () => ({
  default: {
    initialize: vi.fn(),
    transports: {
      file: { level: "info", format: "" },
      console: { level: "debug", format: "" },
    },
    scope: vi.fn(() => bootstrap.log),
  },
}));

vi.mock("fs", () => ({
  default: { readFileSync: vi.fn(() => "asset") },
}));

vi.mock("../src/config", () => ({
  getZoomFactor: vi.fn(() => 1),
  getCloseToTrayEnabled: vi.fn(() => false),
  getMusicService: vi.fn(() => "music"),
}));

vi.mock("../src/i18n", () => ({
  getLoadingText: vi.fn(() => ({ text: "Loading...", lang: "en" })),
  getNavigationStrings: vi.fn(() => ({})),
  getSearchStrings: vi.fn(() => ({})),
  getTrayStrings: vi.fn(() => ({ about: "À propos de Hydra" })),
  NAV_LABELS_TOKEN: "__NAV_LABELS__",
  SEARCH_LABELS_TOKEN: "__SEARCH_LABELS__",
}));

vi.mock("../src/paths", () => ({
  getAssetPath: vi.fn((...parts: string[]) => parts.join("/")),
}));

vi.mock("../src/player", () => ({
  Player: class {
    handleHookReady = bootstrap.handleHookReady;
    handlePlaybackCapabilitiesDidChange =
      bootstrap.handlePlaybackCapabilitiesDidChange;
    resetForDocumentReplacement = bootstrap.resetForDocumentReplacement;
  },
}));

// Covered by test/settingsMigration.test.ts; here it would run against the fs stub.
vi.mock("../src/settingsMigration", () => ({ reportSettingsMigration: vi.fn() }));
vi.mock("../src/storefront", () => ({
  buildAppleMusicURL: vi.fn(() => "https://music.apple.com/gb/new"),
  buildItmsRouteURL: vi.fn(),
  handleStorefrontNavigation: vi.fn(),
  handleLastPageNavigation: vi.fn(),
}));

vi.mock("../src/itms", () => ({ extractItmsUrlFromArgv: vi.fn(() => null) }));

vi.mock("../src/serviceSwitch", () => ({
  initServiceSwitch: vi.fn(),
  routeToMusicService: vi.fn(),
  switchService: vi.fn(),
}));

vi.mock("../src/theme", () => ({
  initThemeCSS: vi.fn(),
  injectThemeCss: vi.fn(() => Promise.resolve()),
  setThemeChangedCallback: vi.fn(),
}));

vi.mock("../src/tray", () => ({
  createTray: vi.fn(() => bootstrap.tray),
  getMenuIcon: vi.fn(),
  initTrayStateManager: bootstrap.integrations.trayState,
  rebuildTrayMenu: vi.fn(),
  setGetMainWindowCallback: vi.fn(),
}));

vi.mock("../src/settings", () => ({
  initSettingsActions: vi.fn(() => vi.fn()),
  notifySettingsChanged: vi.fn(),
  toggleSidebarCollapsed: bootstrap.toggleSidebarCollapsed,
}));
vi.mock("../src/sidebar", () => ({
  applySidebar: bootstrap.applySidebar,
}));
vi.mock("../src/shortcuts", () => ({
  initShortcuts: vi.fn(() => bootstrap.teardownShortcuts),
}));
vi.mock("../src/settingsWindow", () => ({
  initSettingsWindow: vi.fn(),
  handleSettingsNavigation: vi.fn(),
}));

vi.mock("../src/commandBridge", () => ({ initCommandBridge: vi.fn() }));
vi.mock("../src/controllerIPC", () => ({
  initControllerIPC: vi.fn(),
  goBackIfPossible: vi.fn(),
}));
vi.mock("../src/aboutWindow", () => ({
  closeAboutWindow: vi.fn(),
  showAboutWindow: vi.fn(),
}));
vi.mock("../src/performanceMode", () => ({
  applyPerformanceMode: bootstrap.applyPerformanceMode,
}));

vi.mock("../src/musicService", () => ({
  getService: vi.fn(() => ({ contentReadySelector: "#content" })),
  allServices: vi.fn(() => [
    {
      host: "music.apple.com",
      origin: "https://music.apple.com",
      authFrameHosts: ["idmsa.apple.com"],
    },
  ]),
  isAllowedNavigationUrl: vi.fn(() => true),
}));

vi.mock("../src/integrations/macos-dock", () => ({
  init: bootstrap.integrations.dock,
}));
vi.mock("../src/integrations/windows-taskbar", () => ({
  init: bootstrap.integrations.windowsTaskbar,
}));
vi.mock("../src/artwork", () => ({ cleanArtworkCache: vi.fn() }));
vi.mock("../src/wedgeDetector", () => ({
  init: bootstrap.integrations.wedgeDetector,
  reset: vi.fn(),
}));
vi.mock("../src/contentReady", () => ({
  contentReadyProbeScript: vi.fn(() => "true"),
}));
vi.mock("../src/utils/openExternal", () => ({ openExternalUrl: vi.fn() }));

// Use the real module because it imports electron only as a type.
// A partial stand-in can omit liveWebContents() and leave guarded paths untested.
vi.mock("../src/utils", async (importOriginal) => importOriginal());

describe("main bootstrap", () => {
  let chromeDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();
    setPlatform("win32");
    chromeDescriptor = Object.getOwnPropertyDescriptor(
      process.versions,
      "chrome",
    );
    Object.defineProperty(process.versions, "chrome", {
      value: "148.2.3.4",
      configurable: true,
    });
    bootstrap.mainWebListeners.clear();
    bootstrap.mainWebOnceListeners.clear();
    bootstrap.appListeners.clear();
    bootstrap.mainWindowOnceListeners.clear();
    bootstrap.mainWindowListeners.clear();
    bootstrap.splashOnceListeners.clear();
    bootstrap.mainWindow.isDestroyed.mockReturnValue(false);
    bootstrap.browserWindow
      .mockImplementationOnce(function () {
        return bootstrap.splashWindow;
      })
      .mockImplementationOnce(function () {
        return bootstrap.mainWindow;
      });
    bootstrap.mainWindow.loadURL.mockRejectedValue(new Error("offline"));
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    restorePlatform();
    if (chromeDescriptor) {
      Object.defineProperty(process.versions, "chrome", chromeDescriptor);
    } else {
      Reflect.deleteProperty(process.versions, "chrome");
    }
  });

  async function startMain(): Promise<void> {
    await import("../src/main");
    for (
      let i = 0;
      i < 10 && bootstrap.mainWindow.loadURL.mock.calls.length === 0;
      i++
    ) {
      await Promise.resolve();
    }
    await Promise.resolve();
  }

  it("forwards the About label from getTrayStrings to the macOS menu", async () => {
    setPlatform("darwin");
    await startMain();
    const { Menu } = await import("electron");
    expect(Menu.buildFromTemplate).toHaveBeenCalledWith([
      expect.objectContaining({
        submenu: expect.arrayContaining([
          expect.objectContaining({ label: "À propos de Hydra" }),
        ]),
      }),
    ]);
  });

  // On X11 a window shown before Chromium's first frame shows another app's
  // pixels, which the splash did with the NVIDIA driver.
  it("shows the splash and the main window only once each has painted", async () => {
    await startMain();
    expect(bootstrap.splashWindow.show).not.toHaveBeenCalled();
    // setZoomFactor() before the first frame stops a hidden window painting,
    // so the splash sets its zoom only once ready-to-show has fired.
    expect(bootstrap.splashWindow.webContents.setZoomFactor).not.toHaveBeenCalled();
    expect(bootstrap.splashWindow.webContents.on).not.toHaveBeenCalledWith(
      "did-finish-load",
      expect.any(Function),
    );
    bootstrap.splashOnceListeners.get("ready-to-show")?.();
    expect(bootstrap.splashWindow.webContents.setZoomFactor).toHaveBeenCalledWith(1);
    expect(bootstrap.splashWindow.show).toHaveBeenCalledOnce();

    await bootstrap.mainWebListeners.get("did-finish-load")?.();
    await vi.advanceTimersByTimeAsync(3500);
    expect(bootstrap.mainWindow.show).not.toHaveBeenCalled();
    expect(bootstrap.splashWindow.close).not.toHaveBeenCalled();

    bootstrap.mainWindowOnceListeners.get("ready-to-show")?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(bootstrap.mainWindow.show).toHaveBeenCalledOnce();
    expect(bootstrap.splashWindow.close).toHaveBeenCalledOnce();
  });

  it("shows the main window without a first frame once the paint wait times out", async () => {
    await startMain();
    await bootstrap.mainWebListeners.get("did-finish-load")?.();
    await vi.advanceTimersByTimeAsync(9999);
    expect(bootstrap.mainWindow.show).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(bootstrap.mainWindow.show).toHaveBeenCalledOnce();
  });

  // About is a separate top-level window, so while it stays open the main
  // window closing does not reach window-all-closed and Hydra keeps running.
  it("closes About and forgets the main window once it closes", async () => {
    await startMain();
    const { closeAboutWindow } = await import("../src/aboutWindow");
    bootstrap.mainWindow.isDestroyed.mockReturnValue(true);
    bootstrap.mainWindowListeners.get("closed")?.();
    expect(closeAboutWindow).toHaveBeenCalledOnce();

    // A relaunch reaches this instance through second-instance.
    expect(() =>
      bootstrap.appListeners.get("second-instance")?.({}, []),
    ).not.toThrow();
    expect(bootstrap.mainWindow.isVisible).not.toHaveBeenCalled();
  });

  it("does not show a splash that closed before it painted", async () => {
    await startMain();
    bootstrap.splashWindow.isDestroyed.mockReturnValueOnce(true);
    bootstrap.splashOnceListeners.get("ready-to-show")?.();
    expect(bootstrap.splashWindow.show).not.toHaveBeenCalled();
  });

  it("creates a locked-down window, wires integrations, and contains first navigation failure", async () => {
    await startMain();

    expect(bootstrap.browserWindow).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
        },
      }),
    );
    expect(bootstrap.browserWindow).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        title: "Test Player",
        show: false,
        webPreferences: expect.objectContaining({
          partition: "persist:hydra",
          nodeIntegration: false,
          contextIsolation: true,
          spellcheck: false,
          plugins: true,
          sandbox: true,
        }),
      }),
    );
    expect(bootstrap.mainWindow.loadURL).toHaveBeenCalledWith(
      "https://music.apple.com/gb/new",
      { userAgent: expect.stringContaining("Chrome/148.0.0.0") },
    );
    const titleListener = bootstrap.mainWindow.on.mock.calls.find(
      ([event]) => event === "page-title-updated",
    )?.[1];
    const preventDefault = vi.fn();
    expect(titleListener).toBeDefined();
    titleListener?.({ preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(bootstrap.log.warn).toHaveBeenCalledWith(
      "initial navigation loadURL failed:",
      "offline",
    );

    const didFinishLoad = bootstrap.mainWebListeners.get("did-finish-load");
    expect(didFinishLoad).toBeDefined();
    await didFinishLoad?.();

    expect(bootstrap.integrations.dock).toHaveBeenCalledOnce();
    expect(bootstrap.integrations.windowsTaskbar).toHaveBeenCalledOnce();
    expect(bootstrap.integrations.wedgeDetector).toHaveBeenCalledOnce();
    expect(bootstrap.integrations.trayState).toHaveBeenCalledOnce();
    for (const initialise of Object.values(bootstrap.integrations)) {
      expect(initialise.mock.invocationCallOrder[0]).toBeLessThan(
        bootstrap.webContents.executeJavaScript.mock.invocationCallOrder[0],
      );
    }
    expect(bootstrap.appOn).toHaveBeenCalledWith(
      "will-quit",
      expect.any(Function),
    );
  });

  it("inserts both feature stylesheets and applies both settings on every load", async () => {
    await startMain();
    const finish = bootstrap.mainWebListeners.get("did-finish-load");
    await finish?.();
    await finish?.();
    // Each load inserts styleFix.css, performanceMode.css and sidebar.css; the
    // theme is mocked. fs is mocked to return "asset" for every file.
    expect(bootstrap.webContents.insertCSS).toHaveBeenCalledTimes(6);
    expect(bootstrap.applyPerformanceMode).toHaveBeenCalledTimes(2);
    expect(bootstrap.applyPerformanceMode).toHaveBeenCalledWith(
      bootstrap.webContents,
    );
    expect(
      bootstrap.webContents.insertCSS.mock.invocationCallOrder[1],
    ).toBeLessThan(bootstrap.applyPerformanceMode.mock.invocationCallOrder[0]);
    expect(bootstrap.applySidebar).toHaveBeenCalledTimes(2);
    expect(bootstrap.applySidebar).toHaveBeenCalledWith(bootstrap.webContents);
    expect(
      bootstrap.webContents.insertCSS.mock.invocationCallOrder[2],
    ).toBeLessThan(bootstrap.applySidebar.mock.invocationCallOrder[0]);
  });

  it("toggles the sidebar only from the main window's main frame", async () => {
    await startMain();
    const toggle = bootstrap.ipcOn.mock.calls.find(
      ([channel]) => channel === "nav:sidebar",
    )?.[1];
    const event = {
      sender: bootstrap.webContents,
      senderFrame: bootstrap.webContents.mainFrame,
    };
    toggle?.({ ...event, sender: {} });
    toggle?.({ ...event, senderFrame: { url: event.senderFrame.url } });
    expect(bootstrap.toggleSidebarCollapsed).not.toHaveBeenCalled();
    toggle?.(event);
    expect(bootstrap.toggleSidebarCollapsed).toHaveBeenCalledOnce();
  });

  // The collapsed sidebar hides Back, Forward and Reload, so the keys must do
  // exactly what those buttons do.
  it("gives the shortcuts the same actions as the buttons and tears them down on quit", async () => {
    const { initShortcuts } = await import("../src/shortcuts");
    const { goBackIfPossible } = await import("../src/controllerIPC");
    const { reset: resetWedgeDetector } = await import("../src/wedgeDetector");
    await startMain();

    expect(initShortcuts).toHaveBeenCalledOnce();
    const [window, actions] = vi.mocked(initShortcuts).mock.calls[0];
    expect(window).toBe(bootstrap.mainWindow);
    expect(actions.sidebar).toBe(bootstrap.toggleSidebarCollapsed);
    const button = (channel: string) =>
      bootstrap.ipcOn.mock.calls.find(([name]) => name === channel)?.[1];
    expect(actions.back).toBe(button("nav:back"));
    expect(actions.forward).toBe(button("nav:forward"));
    expect(actions.reload).toBe(button("nav:reload"));

    actions.back();
    expect(goBackIfPossible).toHaveBeenCalledWith(bootstrap.mainWindow);
    actions.forward();
    expect(bootstrap.webContents.navigationHistory.goForward).toHaveBeenCalledOnce();
    actions.reload();
    expect(resetWedgeDetector).toHaveBeenCalledOnce();
    expect(bootstrap.webContents.reload).toHaveBeenCalledOnce();
    expect(
      vi.mocked(resetWedgeDetector).mock.invocationCallOrder[0],
    ).toBeLessThan(bootstrap.webContents.reload.mock.invocationCallOrder[0]);

    expect(bootstrap.appOn).toHaveBeenCalledWith(
      "will-quit",
      bootstrap.teardownShortcuts,
    );
  });

  // Ctrl+K reaches the page from the main process, so a focused iframe cannot
  // keep it away; the panel itself decides whether it exists on this service.
  it("opens the song search from its shortcut and contains a failure", async () => {
    const { initShortcuts } = await import("../src/shortcuts");
    await startMain();
    const [, actions] = vi.mocked(initShortcuts).mock.calls[0];

    actions.search();
    expect(bootstrap.webContents.executeJavaScript).toHaveBeenCalledExactlyOnceWith(
      "window.__hydraSongSearch?.open()",
    );

    bootstrap.webContents.executeJavaScript.mockRejectedValueOnce(new Error("gone"));
    actions.search();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(bootstrap.log.warn).toHaveBeenCalledWith("failed to open the song search");
  });

  it("initialises controller IPC once and reuses guarded back navigation", async () => {
    const { goBackIfPossible, initControllerIPC } = await import(
      "../src/controllerIPC"
    );
    await startMain();

    expect(initControllerIPC).toHaveBeenCalledOnce();
    expect(initControllerIPC).toHaveBeenCalledWith(bootstrap.mainWindow);

    const backCall = bootstrap.ipcOn.mock.calls.find(
      ([channel]) => channel === "nav:back",
    );
    expect(backCall).toBeDefined();
    backCall?.[1]();
    expect(goBackIfPossible).toHaveBeenCalledWith(bootstrap.mainWindow);
  });

  it("accepts hook readiness only from the current main frame and document generation", async () => {
    await startMain();
    const ready = bootstrap.ipcOn.mock.calls.find(
      ([channel]) => channel === "hookReady",
    )?.[1];
    const event = {
      sender: bootstrap.webContents,
      senderFrame: bootstrap.webContents.mainFrame,
    };
    ready?.({ ...event, sender: {} }, 0, 0);
    ready?.({ ...event, senderFrame: { url: event.senderFrame.url } }, 0, 0);
    ready?.(event, "0", 0);
    expect(bootstrap.handleHookReady).not.toHaveBeenCalled();
    ready?.(event, 0, 0);
    expect(bootstrap.handleHookReady).toHaveBeenCalledExactlyOnceWith(
      event.senderFrame.url,
    );
    bootstrap.handleHookReady.mockClear();
    bootstrap.mainWebListeners.get("did-navigate")?.({}, event.senderFrame.url);
    ready?.(event, 0, 0);
    expect(bootstrap.handleHookReady).not.toHaveBeenCalled();
    ready?.(event, 1, 1);
    expect(bootstrap.handleHookReady).toHaveBeenCalledExactlyOnceWith(
      event.senderFrame.url,
    );
  });

  it("rejects stale capabilities after document replacement, including a same-frame reload", async () => {
    await startMain();
    const capabilities = bootstrap.ipcOn.mock.calls.find(
      ([channel]) => channel === "playbackCapabilitiesDidChange",
    )?.[1];
    const event = {
      sender: bootstrap.webContents,
      senderFrame: bootstrap.webContents.mainFrame,
    };
    const payload = {
      canPlay: true,
      canPause: true,
      canSeek: true,
      durationUs: 60_000_000,
    };
    capabilities?.(event, payload, 0);
    expect(
      bootstrap.handlePlaybackCapabilitiesDidChange,
    ).toHaveBeenCalledExactlyOnceWith(payload);
    bootstrap.handlePlaybackCapabilitiesDidChange.mockClear();
    bootstrap.mainWebListeners.get("did-navigate")?.({}, event.senderFrame.url);
    capabilities?.(event, payload, 0);
    capabilities?.(event, payload);
    capabilities?.(event, payload, "1");
    capabilities?.({ ...event, sender: {} }, payload, 1);
    capabilities?.(
      { ...event, senderFrame: { url: event.senderFrame.url } },
      payload,
      1,
    );
    capabilities?.({ ...event, senderFrame: null }, payload, 1);
    expect(
      bootstrap.handlePlaybackCapabilitiesDidChange,
    ).not.toHaveBeenCalled();
    capabilities?.(event, payload, 1);
    expect(
      bootstrap.handlePlaybackCapabilitiesDidChange,
    ).toHaveBeenCalledExactlyOnceWith(payload);
  });

  it("defers early SPA injection until integrations register and preserves later injection", async () => {
    const { handleStorefrontNavigation, handleLastPageNavigation } =
      await import("../src/storefront");
    await startMain();
    const navigate = bootstrap.mainWebListeners.get("did-navigate-in-page");
    const finish = bootstrap.mainWebListeners.get("did-finish-load");

    await navigate?.({}, "https://music.apple.com/gb/home", true);
    expect(handleStorefrontNavigation).toHaveBeenCalledWith(
      "https://music.apple.com/gb/home",
    );
    expect(handleLastPageNavigation).toHaveBeenCalledWith(
      "https://music.apple.com/gb/home",
    );
    expect(bootstrap.webContents.executeJavaScript).not.toHaveBeenCalled();

    await finish?.();
    expect(bootstrap.webContents.executeJavaScript).toHaveBeenCalledTimes(3);
    for (const initialise of Object.values(bootstrap.integrations)) {
      expect(initialise.mock.invocationCallOrder[0]).toBeLessThan(
        bootstrap.webContents.executeJavaScript.mock.invocationCallOrder[0],
      );
    }

    await navigate?.({}, "https://music.apple.com/gb/new", true);
    expect(bootstrap.webContents.executeJavaScript).toHaveBeenCalledTimes(6);
    for (const initialise of Object.values(bootstrap.integrations))
      expect(initialise).toHaveBeenCalledOnce();
  });

  // The song search plays through the hook, so it is injected on the same
  // allowed hosts only, after the navigation bar, and a failure is contained.
  it("injects the song search only where the hook is injected", async () => {
    await startMain();
    await bootstrap.mainWebListeners.get("did-finish-load")?.();
    expect(bootstrap.webContents.executeJavaScript).toHaveBeenCalledTimes(3);
    expect(bootstrap.log.debug).toHaveBeenCalledWith("Song search injected");

    const { isAllowedNavigationUrl } = await import("../src/musicService");
    bootstrap.webContents.executeJavaScript.mockClear();
    vi.mocked(isAllowedNavigationUrl).mockReturnValueOnce(false);
    await bootstrap.mainWebListeners.get("did-navigate-in-page")?.(
      {},
      "https://music.apple.com/gb/new",
      true,
    );
    // Only the navigation bar.
    expect(bootstrap.webContents.executeJavaScript).toHaveBeenCalledOnce();
  });

  it("logs a failed song search injection without failing the load", async () => {
    await startMain();
    bootstrap.webContents.executeJavaScript
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(new Error("search unavailable"));
    await expect(
      Promise.resolve(bootstrap.mainWebListeners.get("did-finish-load")?.()),
    ).resolves.toBeUndefined();
    expect(bootstrap.log.warn).toHaveBeenCalledWith(
      "failed to inject songSearchScript on load:",
      expect.any(Error),
    );
  });

  // Apple's subscribe flow runs in a same-host iframe whose in-page
  // navigations also reach this handler; recording them stored iframe
  // addresses, one with a developer token, as the last page.
  it("ignores in-page navigations from subframes", async () => {
    const { handleStorefrontNavigation, handleLastPageNavigation } =
      await import("../src/storefront");
    await startMain();
    await bootstrap.mainWebListeners.get("did-finish-load")?.();
    bootstrap.webContents.executeJavaScript.mockClear();
    const navigate = bootstrap.mainWebListeners.get("did-navigate-in-page");

    await navigate?.(
      {},
      "https://music.apple.com/includes/commerce/navigator?devToken=abc",
      false,
    );
    expect(handleStorefrontNavigation).not.toHaveBeenCalled();
    expect(handleLastPageNavigation).not.toHaveBeenCalled();
    expect(bootstrap.webContents.executeJavaScript).not.toHaveBeenCalled();

    await navigate?.({}, "https://music.apple.com/gb/album/example", true);
    expect(handleLastPageNavigation).toHaveBeenCalledExactlyOnceWith(
      "https://music.apple.com/gb/album/example",
    );
  });

  it("permits later SPA injection after initial integration and hook failures", async () => {
    bootstrap.integrations.dock.mockImplementationOnce(() => {
      throw new Error("integration unavailable");
    });
    bootstrap.webContents.executeJavaScript.mockRejectedValueOnce(
      new Error("hook unavailable"),
    );
    await startMain();
    const navigate = bootstrap.mainWebListeners.get("did-navigate-in-page");
    await navigate?.({}, "https://music.apple.com/gb/home", true);
    await expect(
      Promise.resolve(bootstrap.mainWebListeners.get("did-finish-load")?.()),
    ).resolves.toBeUndefined();

    expect(bootstrap.log.error).toHaveBeenCalledWith(
      "integration initialisation failed: dock:",
      expect.any(Error),
    );
    expect(bootstrap.log.warn).toHaveBeenCalledWith(
      "failed to inject hookScript on load:",
      expect.any(Error),
    );
    expect(bootstrap.integrations.trayState).toHaveBeenCalledOnce();
    expect(bootstrap.webContents.executeJavaScript).toHaveBeenCalledTimes(3);
    await navigate?.({}, "https://music.apple.com/gb/new", true);
    expect(bootstrap.webContents.executeJavaScript).toHaveBeenCalledTimes(6);
    expect(bootstrap.integrations.dock).toHaveBeenCalledOnce();
  });

  // The bare timeout can fire after startup destruction, when reading win.webContents throws before a promise exists.
  // The poll must use liveWebContents() before executeJavaScript() so promise error handling is not bypassed.
  it("stops the content-ready poll once the window is destroyed", async () => {
    bootstrap.webContents.executeJavaScript.mockResolvedValue(false);
    await startMain();
    const startPoll = bootstrap.mainWebOnceListeners.get(
      "did-navigate-in-page",
    );
    expect(startPoll).toBeDefined();

    startPoll?.();
    await Promise.resolve();
    expect(bootstrap.webContents.executeJavaScript).toHaveBeenCalledOnce();

    bootstrap.mainWindow.isDestroyed.mockReturnValue(true);
    expect(() => vi.advanceTimersByTime(100)).not.toThrow();
    expect(bootstrap.webContents.executeJavaScript).toHaveBeenCalledOnce();
  });

  it("waits for Settings and its dependencies before creating the tray", async () => {
    const { components } = await import("electron");
    const { initSettingsActions } = await import("../src/settings");
    const { initSettingsWindow } = await import("../src/settingsWindow");
    const { createTray, rebuildTrayMenu, setGetMainWindowCallback } =
      await import("../src/tray");
    const { initServiceSwitch } = await import("../src/serviceSwitch");
    let resolveComponents!: () => void;
    vi.mocked(components.whenReady).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveComponents = () => resolve([]);
      }),
    );

    await startMain();
    try {
      expect(components.whenReady).toHaveBeenCalledOnce();
      expect(createTray).not.toHaveBeenCalled();
      expect(initSettingsActions).not.toHaveBeenCalled();
      expect(bootstrap.mainWindow.loadURL).not.toHaveBeenCalled();
    } finally {
      resolveComponents();
      await startMain();
    }

    expect(createTray).toHaveBeenCalledOnce();
    const trayCreated = vi.mocked(createTray).mock.invocationCallOrder[0];
    for (const initialise of [
      initSettingsActions,
      initSettingsWindow,
      initServiceSwitch,
      setGetMainWindowCallback,
    ]) {
      expect(initialise).toHaveBeenCalledOnce();
      expect(vi.mocked(initialise).mock.invocationCallOrder[0]).toBeLessThan(
        trayCreated,
      );
    }
    expect(trayCreated).toBeLessThan(
      bootstrap.mainWindow.loadURL.mock.invocationCallOrder[0],
    );
    expect(vi.mocked(initServiceSwitch).mock.calls[0][0].getTray()).toBe(
      bootstrap.tray,
    );
    vi.mocked(initSettingsActions).mock.calls[0][0].refreshTray();
    expect(rebuildTrayMenu).toHaveBeenCalledWith(bootstrap.tray);
  });

  it("wires Settings entry points and refreshes state without a tray", async () => {
    const { initSettingsActions, notifySettingsChanged } = await import(
      "../src/settings"
    );
    const { initSettingsWindow, handleSettingsNavigation } = await import(
      "../src/settingsWindow"
    );
    const { createTray } = await import("../src/tray");
    const { initServiceSwitch } = await import("../src/serviceSwitch");
    const { setThemeChangedCallback } = await import("../src/theme");
    vi.mocked(createTray).mockReturnValueOnce(
      null as unknown as ReturnType<typeof createTray>,
    );
    await startMain();
    expect(initSettingsActions).toHaveBeenCalledOnce();
    expect(initSettingsWindow).toHaveBeenCalledWith(bootstrap.mainWindow);
    const nav = bootstrap.ipcOn.mock.calls.find(
      ([channel]) => channel === "nav:settings",
    );
    const event = {};
    nav?.[1](event);
    expect(handleSettingsNavigation).toHaveBeenCalledWith(
      event,
      bootstrap.mainWindow,
    );
    vi.mocked(setThemeChangedCallback).mock.calls[0][0]();
    expect(notifySettingsChanged).toHaveBeenCalledOnce();
    vi.mocked(initServiceSwitch).mock.calls[0][0].loadURL(
      "https://music.apple.com/gb/new",
    );
    expect(notifySettingsChanged).toHaveBeenCalledTimes(2);
  });

  // Below 484 CSS pixels Apple swaps the sidebar for a top bar, where the
  // button row covered its Sign In button; zoom moves that point outwards.
  it("keeps the window wide enough for Apple's desktop layout at every zoom", async () => {
    const { initSettingsActions } = await import("../src/settings");
    await startMain();
    expect(bootstrap.mainWindow.setMinimumSize).toHaveBeenCalledWith(484, 0);
    expect(bootstrap.mainWindow.setSize).not.toHaveBeenCalled();
    const { applyZoom } = vi.mocked(initSettingsActions).mock.calls[0][0];
    // A raised minimum leaves a narrower window as it is, so it is widened.
    bootstrap.mainWindow.getSize.mockReturnValueOnce([500, 700]);
    applyZoom(1.25);
    expect(bootstrap.webContents.setZoomFactor).toHaveBeenLastCalledWith(1.25);
    expect(bootstrap.mainWindow.setMinimumSize).toHaveBeenLastCalledWith(605, 0);
    expect(bootstrap.mainWindow.setSize).toHaveBeenCalledWith(605, 700);
    bootstrap.mainWindow.isDestroyed.mockReturnValue(true);
    applyZoom(2);
    expect(bootstrap.mainWindow.setMinimumSize).toHaveBeenCalledTimes(2);
  });

  it("resets controller state only for main-frame navigation", async () => {
    await startMain();
    const didStartNavigation = bootstrap.mainWebListeners.get(
      "did-start-navigation",
    );
    expect(didStartNavigation).toBeDefined();

    didStartNavigation?.({
      url: "https://music.apple.com/gb/new#dialog",
      isSameDocument: true,
      isMainFrame: true,
    });
    expect(bootstrap.webContents.send).toHaveBeenCalledWith("controller:reset");

    didStartNavigation?.({
      url: "https://music.apple.com/gb/album/example",
      isSameDocument: false,
      isMainFrame: true,
    });
    expect(bootstrap.webContents.send).toHaveBeenCalledTimes(2);

    didStartNavigation?.({
      url: "https://music.apple.com/gb/iframe",
      isSameDocument: false,
      isMainFrame: false,
    });
    expect(bootstrap.webContents.send).toHaveBeenCalledTimes(2);
  });

  it("resets playback only after a committed document navigation", async () => {
    const { handleStorefrontNavigation } = await import("../src/storefront");
    await startMain();
    const didStartNavigation = bootstrap.mainWebListeners.get(
      "did-start-navigation",
    );
    const didNavigate = bootstrap.mainWebListeners.get("did-navigate");
    const didNavigateInPage = bootstrap.mainWebListeners.get(
      "did-navigate-in-page",
    );

    expect(didStartNavigation).toBeDefined();
    expect(didNavigate).toBeDefined();
    expect(didNavigateInPage).toBeDefined();

    didStartNavigation?.({
      url: "https://music.apple.com/gb/album/example",
      isSameDocument: false,
      isMainFrame: true,
    });
    await didNavigateInPage?.({}, "https://music.apple.com/gb/new#dialog", true);
    expect(bootstrap.resetForDocumentReplacement).not.toHaveBeenCalled();

    didNavigate?.({}, "https://music.apple.com/gb/album/example");

    expect(bootstrap.resetForDocumentReplacement).toHaveBeenCalledOnce();
    expect(
      bootstrap.resetForDocumentReplacement.mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(handleStorefrontNavigation).mock.invocationCallOrder.at(-1)!,
    );
  });

  it("logs process lifecycle events without private event data", async () => {
    const privatePath =
      "/home/alice/.config/hydra/access-token-secret/preload.js";
    const privateUrl =
      "https://music.apple.com/gb/album/private?token=secret-token";
    const privateStack = `Error: secret-token\n    at ${privatePath}:1:1`;
    const privateMetadata = { title: "Private Track", url: privateUrl };

    await startMain();

    const childProcessGoneCall = bootstrap.appOn.mock.calls.findIndex(
      ([event]) => event === "child-process-gone",
    );
    expect(
      bootstrap.appOn.mock.invocationCallOrder[childProcessGoneCall],
    ).toBeLessThan(bootstrap.browserWindow.mock.invocationCallOrder[0]);

    bootstrap.log.info.mockClear();
    bootstrap.log.warn.mockClear();
    bootstrap.log.error.mockClear();

    const unresponsive = bootstrap.mainWebListeners.get("unresponsive");
    const responsive = bootstrap.mainWebListeners.get("responsive");
    const renderProcessGone = bootstrap.mainWebListeners.get(
      "render-process-gone",
    );
    const preloadError = bootstrap.mainWebListeners.get("preload-error");
    const childProcessGone = bootstrap.appListeners.get("child-process-gone");

    expect(unresponsive).toBeDefined();
    expect(responsive).toBeDefined();
    expect(renderProcessGone).toBeDefined();
    expect(preloadError).toBeDefined();
    expect(childProcessGone).toBeDefined();

    unresponsive?.({ url: privateUrl, token: "secret-token" });
    responsive?.({ url: privateUrl, metadata: privateMetadata });
    renderProcessGone?.(
      {},
      {
        reason: "crashed",
        exitCode: 133,
        url: privateUrl,
        token: "secret-token",
        metadata: privateMetadata,
        arguments: ["--secret-token"],
      },
    );

    const error = new Error(`failed for ${privateUrl}`);
    error.name = "TypeError";
    error.stack = privateStack;
    preloadError?.({}, privatePath, error);

    childProcessGone?.(
      {},
      {
        type: "Utility",
        reason: "crashed",
        exitCode: 9,
        serviceName: "Audio Service",
        name: privateUrl,
        token: "secret-token",
        metadata: privateMetadata,
        arguments: ["--secret-token"],
      },
    );
    childProcessGone?.(
      {},
      {
        type: "GPU",
        reason: "oom",
        exitCode: 137,
        name: privateUrl,
      },
    );

    expect(bootstrap.log.warn).toHaveBeenNthCalledWith(
      1,
      "event=unresponsive processType=renderer",
    );
    expect(bootstrap.log.info).toHaveBeenCalledOnce();
    expect(bootstrap.log.info).toHaveBeenCalledWith(
      "event=responsive processType=renderer",
    );
    expect(bootstrap.log.error).toHaveBeenCalledOnce();
    expect(bootstrap.log.error).toHaveBeenCalledWith(
      "event=render-process-gone processType=renderer reason=crashed exitCode=133",
    );
    expect(bootstrap.log.warn).toHaveBeenNthCalledWith(
      2,
      "event=preload-error processType=renderer preloadPath=preload.js errorName=TypeError",
    );
    expect(bootstrap.log.warn).toHaveBeenNthCalledWith(
      3,
      'event=child-process-gone processType=Utility reason=crashed exitCode=9 serviceName="Audio Service"',
    );
    expect(bootstrap.log.warn).toHaveBeenNthCalledWith(
      4,
      "event=child-process-gone processType=GPU reason=oom exitCode=137",
    );

    const logCalls = JSON.stringify([
      ...bootstrap.log.info.mock.calls,
      ...bootstrap.log.warn.mock.calls,
      ...bootstrap.log.error.mock.calls,
    ]);
    expect(logCalls).not.toContain(privatePath);
    expect(logCalls).not.toContain(privateUrl);
    expect(logCalls).not.toContain("secret-token");
    expect(logCalls).not.toContain(privateStack);
    expect(logCalls).not.toContain("Private Track");
    expect(logCalls).not.toContain("--secret-token");
    expect(bootstrap.webContents.reload).not.toHaveBeenCalled();
    expect(bootstrap.mainWindow.close).not.toHaveBeenCalled();
    expect(bootstrap.appQuit).not.toHaveBeenCalled();
    expect(bootstrap.mainWindow.loadURL).toHaveBeenCalledOnce();
  });

  it("replaces an unsafe preload error name with a fixed fallback", async () => {
    const privateUrl = "https://music.apple.com/private?token=preload-secret";
    const privateName = `CustomError\r\n${privateUrl}\0token=preload-secret`;
    const privateMessage = `failed to load ${privateUrl}\tpreload-secret`;
    const privateStack = `${privateName}: ${privateMessage}\n    at /private/preload.js:1:1`;

    await startMain();

    bootstrap.log.info.mockClear();
    bootstrap.log.warn.mockClear();
    bootstrap.log.error.mockClear();

    const preloadError = bootstrap.mainWebListeners.get("preload-error");
    expect(preloadError).toBeDefined();

    const error = new Error(privateMessage);
    error.name = privateName;
    error.stack = privateStack;
    preloadError?.({}, "/private/preload.js", error);

    expect(bootstrap.log.warn).toHaveBeenCalledOnce();
    expect(bootstrap.log.warn).toHaveBeenCalledWith(
      "event=preload-error processType=renderer preloadPath=preload.js errorName=UnknownError",
    );
    expect(bootstrap.log.info).not.toHaveBeenCalled();
    expect(bootstrap.log.error).not.toHaveBeenCalled();

    const loggedValues = [
      ...bootstrap.log.info.mock.calls,
      ...bootstrap.log.warn.mock.calls,
      ...bootstrap.log.error.mock.calls,
    ]
      .flat()
      .map(String);
    for (const privateValue of [
      privateName,
      privateMessage,
      privateStack,
      privateUrl,
      "preload-secret",
    ]) {
      expect(loggedValues.every((value) => !value.includes(privateValue))).toBe(
        true,
      );
    }
  });
});
