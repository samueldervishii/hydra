// Hydra's top bar for music.apple.com: Back, Home, Search and All Playlists in
// a 40px strip across the top of the window, in place of Apple's sidebar.
//
// It is built like assets/songSearch.js: its own markup in a shadow root, and
// nothing taken from Apple's classes except the two assets/topBar.css needs to
// hide the sidebar, .app-container and [data-testid="header"]. It shows only when
// all of these hold, and otherwise leaves Apple's sidebar exactly as it is:
// - the main process asks for it (data-hydra-top-bar-requested on <html>,
//   from the Navigation setting in src/navigation.ts);
// - MusicKit says the user is signed in, because Apple's Sign In button and
//   account menu live in the sidebar; the bar follows authorizationStatusDidChange;
// - .app-container and [data-testid="header"] exist, and once
//   data-hydra-top-bar is set the stylesheet has visibly taken: the sidebar
//   is hidden and the 40px strip is reserved. Anything else removes the
//   attribute again and prints one fixed warning, which src/main.ts relays to
//   its log.
// Pages open in-app with pushState plus popstate, so playback never stops.
// Apple Music only: Classical keeps Apple's sidebar.
(function () {
  if (window.location.hostname !== "music.apple.com") return;
  // src/main.ts runs this on every load and in-page navigation, and again
  // through update() when the setting changes. A repeat run re-evaluates.
  if (window.__hydraTopBar) {
    window.__hydraTopBar.update();
    return;
  }

  // loadAssets() in src/main.ts replaces TOP_BAR_LABELS_TOKEN from src/i18n.ts with JSON.
  /** @type {{ back: string, home: string, search: string, allPlaylists: string }} */
  var LABELS = __HYDRA_TOP_BAR_LABELS__;

  var REQUEST_ATTRIBUTE = "data-hydra-top-bar-requested";
  var ACTIVE_ATTRIBUTE = "data-hydra-top-bar";
  /** The strip assets/topBar.css reserves above Apple's grid. */
  var BAR_PX = 40;
  /** src/main.ts matches this exact line and logs a fixed warning. */
  var LAYOUT_WARNING = "[hydra] top-bar: layout-unavailable";
  /** Apple's library route; library routes carry no storefront segment. */
  var ALL_PLAYLISTS_PATH = "/library/all-playlists";
  var SVG_NS = "http://www.w3.org/2000/svg";
  var ICON_PX = 20;
  var GLYPH_PX = 16;

  var STYLE = [
    ".bar { box-sizing: border-box; height: 100%; display: flex; align-items: center;",
    "  gap: 4px; padding: 0 34px; background: var(--pageBG, #1f1f1f);",
    "  border-bottom: 1px solid var(--labelDivider, rgba(128, 128, 128, 0.3)); }",
    "button { display: flex; align-items: center; justify-content: center; width: 32px;",
    "  height: 32px; padding: 0; border: 0; border-radius: 6px; cursor: pointer;",
    "  background: transparent; color: var(--systemSecondary, rgba(128, 128, 128, 0.9)); }",
    "button:hover, button:focus-visible { outline: none; color: var(--systemPrimary, #ffffff);",
    "  background: var(--systemQuaternary, rgba(128, 128, 128, 0.2)); }",
    "button[aria-current='page'] { color: var(--keyColor, #fa586a); }",
    "svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 1.8;",
    "  stroke-linecap: round; stroke-linejoin: round; }",
  ].join("\n");

  // box is the glyph's extent in the icon's own units: [x, y, width, height].
  /** @type {Array<{ id: string, label: string, box: number[], icon: Array<[string, Record<string, string>]> }>} */
  var BUTTONS = [
    {
      id: "back",
      label: LABELS.back,
      box: [9, 4, 6, 16],
      icon: [["polyline", { points: "15 20 9 12 15 4" }]],
    },
    {
      id: "home",
      label: LABELS.home,
      box: [3, 4, 18, 16],
      icon: [
        ["polyline", { points: "3 11 12 4 21 11" }],
        ["path", { d: "M5.5 9.5V20h5v-6h3v6h5V9.5" }],
      ],
    },
    {
      id: "search",
      label: LABELS.search,
      box: [4.5, 4.5, 15.5, 15.5],
      icon: [
        ["circle", { cx: "10.5", cy: "10.5", r: "6" }],
        ["line", { x1: "15", y1: "15", x2: "20", y2: "20" }],
      ],
    },
    {
      id: "all-playlists",
      label: LABELS.allPlaylists,
      box: [4, 6, 17, 14],
      icon: [
        ["line", { x1: "4", y1: "6", x2: "16", y2: "6" }],
        ["line", { x1: "4", y1: "11", x2: "16", y2: "11" }],
        ["line", { x1: "4", y1: "16", x2: "11", y2: "16" }],
        ["circle", { cx: "16.5", cy: "17.5", r: "2.5" }],
        ["polyline", { points: "19 17.5 19 9 21 9.5" }],
      ],
    },
  ];

  /** @type {HTMLElement | null} */
  var host = null;
  /** @type {Record<string, HTMLElement>} */
  var buttons = {};
  var active = false;
  var warned = false;
  /** @type {any} The MusicKit instance whose sign-in changes are followed. */
  var boundMk = null;
  /** @type {number | null} */
  var waitTimer = null;

  /**
   * The hooked MusicKit instance, or null before it exists.
   * @returns {any}
   */
  function musicKit() {
    if (window.__hydraHookedMk) return window.__hydraHookedMk;
    try {
      return window.MusicKit ? window.MusicKit.getInstance() : null;
    } catch (_) {
      return null;
    }
  }

  /**
   * Follow sign-in changes on the current MusicKit instance, moving the
   * listener when Apple replaces the instance. False until one exists.
   * @returns {boolean}
   */
  function bindMusicKit() {
    var mk = musicKit();
    if (!mk || typeof mk.addEventListener !== "function") return false;
    if (mk !== boundMk) {
      if (boundMk && typeof boundMk.removeEventListener === "function") {
        boundMk.removeEventListener("authorizationStatusDidChange", update);
      }
      mk.addEventListener("authorizationStatusDidChange", update);
      boundMk = mk;
    }
    return true;
  }

  /**
   * Re-evaluate every half second until MusicKit exists, then stop.
   * @returns {void}
   */
  function waitForMusicKit() {
    if (waitTimer !== null) return;
    waitTimer = setInterval(function () {
      if (!musicKit()) return;
      clearInterval(waitTimer);
      waitTimer = null;
      update();
    }, 500);
  }

  /**
   * The storefront for a page path: MusicKit's, else the current path's, else
   * none. Never a fixed value.
   * @returns {string | null}
   */
  function storefront() {
    var mk = musicKit();
    var id = mk && mk.storefrontId;
    if (typeof id === "string" && /^[a-z]{2}$/.test(id)) return id;
    var fromPath = window.location.pathname.split("/")[1] || "";
    return /^[a-z]{2}$/.test(fromPath) ? fromPath : null;
  }

  /**
   * The path a button leads to, or null for one that does not navigate.
   * @param {string} id - Button id
   * @returns {string | null}
   */
  function pathFor(id) {
    if (id === "all-playlists") return ALL_PLAYLISTS_PATH;
    var sf = storefront();
    if (!sf) return null;
    if (id === "home") return "/" + sf + "/home";
    if (id === "search") return "/" + sf + "/search";
    return null;
  }

  /** @returns {string} The current path without a trailing slash. */
  function currentPath() {
    return window.location.pathname.replace(/\/+$/, "") || "/";
  }

  /**
   * Mark the button for the current page.
   * @returns {void}
   */
  function refresh() {
    var here = currentPath();
    BUTTONS.forEach(function (spec) {
      var button = buttons[spec.id];
      if (pathFor(spec.id) === here) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
  }

  /**
   * Open a page in-app so playback continues: push the path and let Apple's
   * router answer the popstate, as assets/navigationBar.js does.
   * @param {string | null} path - Target path
   * @returns {void}
   */
  function go(path) {
    if (!path || path === currentPath()) return;
    window.history.pushState({}, "", path);
    window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }));
    refresh();
  }

  /**
   * Send to the main process, tolerating an absent preload bridge.
   * @param {string} channel - IPC channel name
   * @returns {void}
   */
  function sendToMain(channel) {
    var bridge = window.AMWrapper;
    if (!bridge || !bridge.ipcRenderer) return;
    bridge.ipcRenderer.send(channel);
  }

  /**
   * Run a button's action.
   * @param {string} id - Button id
   * @returns {void}
   */
  function press(id) {
    if (id === "back") sendToMain("nav:back");
    else if (id === "search") {
      if (window.__hydraSongSearch) window.__hydraSongSearch.open();
    } else go(pathFor(id));
  }

  /**
   * Create an SVG element with attributes.
   * @param {string} tag - Element name
   * @param {Record<string, string>} attrs - Attributes
   * @returns {SVGElement}
   */
  function svgElement(tag, attrs) {
    var node = document.createElementNS(SVG_NS, tag);
    for (var name in attrs) node.setAttribute(name, attrs[name]);
    return node;
  }

  /**
   * An icon framed so the longer side of its glyph is GLYPH_PX in the ICON_PX
   * slot, centred, as the navigation bar frames its icons.
   * @param {{ box: number[], icon: Array<[string, Record<string, string>]> }} spec - Button definition
   * @returns {SVGElement}
   */
  function iconFor(spec) {
    var box = spec.box;
    var side = (Math.max(box[2], box[3]) * ICON_PX) / GLYPH_PX;
    var svg = svgElement("svg", {
      viewBox: [
        box[0] + box[2] / 2 - side / 2,
        box[1] + box[3] / 2 - side / 2,
        side,
        side,
      ].join(" "),
      "aria-hidden": "true",
    });
    spec.icon.forEach(function (shape) {
      var node = svgElement(shape[0], shape[1]);
      node.setAttribute("vector-effect", "non-scaling-stroke");
      svg.appendChild(node);
    });
    return svg;
  }

  /**
   * Build the bar once, hidden.
   * @returns {HTMLElement}
   */
  function createHost() {
    var node = document.createElement("div");
    node.setAttribute("id", "hydra-top-bar");
    [
      ["display", "none"],
      ["position", "fixed"],
      ["top", "0"],
      ["left", "0"],
      ["right", "0"],
      ["height", BAR_PX + "px"],
      // Above the page, below Apple's menus, popovers and full-screen player.
      ["z-index", "2"],
    ].forEach(function (rule) {
      node.style.setProperty(rule[0], rule[1], "important");
    });
    var root = node.attachShadow({ mode: "open" });
    var style = document.createElement("style");
    style.textContent = STYLE;
    var bar = document.createElement("nav");
    bar.setAttribute("class", "bar");
    BUTTONS.forEach(function (spec) {
      var button = document.createElement("button");
      button.setAttribute("type", "button");
      button.setAttribute("aria-label", spec.label);
      button.setAttribute("title", spec.label);
      button.setAttribute("data-hydra-page", spec.id);
      button.appendChild(iconFor(spec));
      button.addEventListener("click", function () {
        press(spec.id);
      });
      buttons[spec.id] = button;
      bar.appendChild(button);
    });
    root.appendChild(style);
    root.appendChild(bar);
    (document.body || document.documentElement).appendChild(node);
    return node;
  }

  /**
   * Apple's layout with the stylesheet applied: the sidebar hidden and the
   * strip reserved. Checked from computed styles, so a renamed Apple class or
   * a stylesheet that failed to load both read as false.
   * @returns {boolean}
   */
  function layoutHolds() {
    var container = document.querySelector(".app-container");
    var header = document.querySelector('[data-testid="header"]');
    if (!container || !header) return false;
    return (
      window.getComputedStyle(header).display === "none" &&
      window.getComputedStyle(container).paddingTop === BAR_PX + "px"
    );
  }

  /**
   * Leave Apple's sidebar as it is and say so, once per page.
   * @returns {void}
   */
  function fail() {
    document.documentElement.removeAttribute(ACTIVE_ATTRIBUTE);
    if (warned) return;
    warned = true;
    console.warn(LAYOUT_WARNING);
  }

  /**
   * Swap Apple's sidebar for the bar, or keep the sidebar if the layout is
   * not what the stylesheet expects.
   * @returns {void}
   */
  function activate() {
    if (
      !document.querySelector(".app-container") ||
      !document.querySelector('[data-testid="header"]')
    ) {
      fail();
      return;
    }
    document.documentElement.setAttribute(ACTIVE_ATTRIBUTE, "");
    if (!layoutHolds()) {
      fail();
      return;
    }
    if (!host) host = createHost();
    else if (!host.isConnected) (document.body || document.documentElement).appendChild(host);
    host.style.setProperty("display", "block", "important");
    active = true;
  }

  /**
   * Put Apple's sidebar back.
   * @returns {void}
   */
  function deactivate() {
    document.documentElement.removeAttribute(ACTIVE_ATTRIBUTE);
    if (host) host.style.setProperty("display", "none", "important");
    active = false;
  }

  /**
   * Show the bar when it is asked for, the user is signed in and the layout
   * holds; otherwise show Apple's sidebar.
   * @returns {void}
   */
  function update() {
    var ready = bindMusicKit();
    if (!ready) waitForMusicKit();
    var wanted =
      ready &&
      boundMk.isAuthorized === true &&
      document.documentElement.hasAttribute(REQUEST_ATTRIBUTE);
    if (!wanted) {
      deactivate();
      return;
    }
    if (active && !layoutHolds()) {
      deactivate();
      fail();
      return;
    }
    if (!active) activate();
    if (active) refresh();
  }

  window.__hydraTopBar = { update: update };
  update();
})();
