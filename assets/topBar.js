// Hydra's top bar for music.apple.com, in place of Apple's sidebar: Back on
// the left, a floating pill in the centre with Home, Search and All Playlists,
// and Settings on the right, in a 56px strip across the top of the window.
//
// It is built like assets/songSearch.js: its own markup in a shadow root, and
// nothing taken from Apple's classes except the two assets/topBar.css needs to
// hide the sidebar, .app-container and [data-testid="header"]. The pill copies
// Apple's floating player bar through its variables alone: the glass material,
// its shadow and inner stroke, picked for the colour scheme with
// prefers-color-scheme, over an opaque --pageBG so nothing shows through and
// nothing is blurred, with or without Performance mode. It shows only when all
// of these hold, and otherwise leaves Apple's sidebar exactly as it is:
// - the main process asks for it (data-hydra-top-bar-requested on <html>,
//   from the Navigation setting in src/navigation.ts);
// - MusicKit says the user is signed in, because Apple's Sign In button and
//   account menu live in the sidebar; the bar follows authorizationStatusDidChange;
// - .app-container and [data-testid="header"] exist, and once
//   data-hydra-top-bar is set the stylesheet has visibly taken: the sidebar
//   is hidden and the strip is reserved. Anything else removes the attribute
//   again and prints one fixed warning, which src/main.ts relays to its log.
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
  /** @type {{ back: string, home: string, search: string, allPlaylists: string, settings: string }} */
  var LABELS = __HYDRA_TOP_BAR_LABELS__;

  var REQUEST_ATTRIBUTE = "data-hydra-top-bar-requested";
  var ACTIVE_ATTRIBUTE = "data-hydra-top-bar";
  /** The strip assets/topBar.css reserves above Apple's grid. */
  var BAR_PX = 56;
  /** src/main.ts matches this exact line and logs a fixed warning. */
  var LAYOUT_WARNING = "[hydra] top-bar: layout-unavailable";
  /** Apple's library route; library routes carry no storefront segment. */
  var ALL_PLAYLISTS_PATH = "/library/all-playlists";
  /** Space between an active item's icon and its label, in CSS pixels. */
  var LABEL_GAP_PX = 8;
  var SVG_NS = "http://www.w3.org/2000/svg";
  var ICON_PX = 20;
  var GLYPH_PX = 16;

  // Apple's player paints var(--glassMaterialBackground) with a shadow and an
  // inner stroke, choosing each -onDark or -onLight through a theme class on
  // .app-container that a shadow root cannot see; the colour scheme picks the
  // same pair here. The opaque --pageBG beneath is what Performance mode gives
  // Apple's own floating surfaces.
  var STYLE = [
    ":host { --glass: var(--glassMaterialBackground-onDark, rgba(38, 38, 40, 0.6));",
    "  --glass-shadow: var(--glassMaterialShadowColor-onDark, rgba(0, 0, 0, 0.2));",
    "  --glass-stroke: color-mix(in srgb, var(--glassMaterialInnerStroke-onDark, #fff) 20%, transparent); }",
    "@media (prefers-color-scheme: light) {",
    "  :host { --glass: var(--glassMaterialBackground-onLight, rgba(245, 245, 247, 0.55));",
    "    --glass-shadow: var(--glassMaterialShadowColor-onLight, rgba(0, 0, 0, 0.1));",
    "    --glass-stroke: color-mix(in srgb, var(--glassMaterialInnerStroke-onLight, #000) 5%, transparent); } }",
    ".bar { position: relative; box-sizing: border-box; height: 100%; display: flex;",
    "  align-items: center; justify-content: space-between; padding: 0 36px;",
    "  background: var(--pageBG, #1f1f1f); }",
    ".side { display: flex; align-items: center; gap: 8px; }",
    "button { display: flex; align-items: center; justify-content: center; margin: 0; padding: 0;",
    "  border: 0; cursor: pointer; font: inherit; background: transparent;",
    "  color: var(--systemSecondary, rgba(128, 128, 128, 0.9)); }",
    "button:hover { color: var(--systemPrimary, #ffffff); }",
    "button:focus-visible { outline: 2px solid var(--keyColor, #fa586a); outline-offset: 2px; }",
    ".round { width: 32px; height: 32px; border-radius: 50%;",
    "  background: var(--systemQuaternary, rgba(128, 128, 128, 0.2)); }",
    ".round[aria-disabled='true'] { opacity: 0.4; cursor: default; }",
    ".round[aria-disabled='true']:hover { color: var(--systemSecondary, rgba(128, 128, 128, 0.9)); }",
    ".pill { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);",
    "  display: flex; align-items: center; gap: 4px; height: 44px; padding: 0 4px;",
    "  box-sizing: border-box; border-radius: 1000px;",
    "  background: linear-gradient(var(--glass), var(--glass)), var(--pageBG, #1f1f1f);",
    "  box-shadow: 0 10px 40px var(--glass-shadow), inset 0 0 0 0.5px var(--glass-stroke); }",
    ".capsule { position: absolute; top: 4px; bottom: 4px; left: 0; width: 0; opacity: 0;",
    "  border-radius: 1000px; pointer-events: none;",
    "  transition: left 0.2s ease, width 0.2s ease, opacity 0.15s ease;",
    "  background: color-mix(in srgb, var(--systemPrimary, #ffffff) 14%, transparent); }",
    ".item { position: relative; z-index: 1; height: 36px; padding: 0 10px; border-radius: 1000px; }",
    ".item[aria-current='page'] { color: var(--systemPrimary, #ffffff); }",
    ".label { display: inline-block; overflow: hidden; white-space: nowrap; max-width: 0;",
    "  margin-left: 0; opacity: 0; font-size: 13px; font-weight: 500;",
    "  transition: max-width 0.2s ease, margin-left 0.2s ease, opacity 0.2s ease; }",
    ".item[aria-current='page'] .label { max-width: 140px; margin-left: " + LABEL_GAP_PX + "px; opacity: 1; }",
    "svg { flex: none; width: 20px; height: 20px; fill: none; stroke: currentColor;",
    "  stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }",
    "@media (prefers-reduced-motion: reduce) { .label, .capsule { transition: none; } }",
  ].join("\n");

  // box is the glyph's extent in the icon's own units: [x, y, width, height].
  // place: "left" and "right" are round actions, "pill" items are pages.
  /** @type {Array<{ id: string, label: string, place: string, box: number[], icon: Array<[string, Record<string, string>]> }>} */
  var BUTTONS = [
    {
      id: "back",
      label: LABELS.back,
      place: "left",
      box: [9, 4, 6, 16],
      icon: [["polyline", { points: "15 20 9 12 15 4" }]],
    },
    {
      id: "home",
      label: LABELS.home,
      place: "pill",
      box: [3, 4, 18, 16],
      icon: [
        ["polyline", { points: "3 11 12 4 21 11" }],
        ["path", { d: "M5.5 9.5V20h5v-6h3v6h5V9.5" }],
      ],
    },
    {
      id: "search",
      label: LABELS.search,
      place: "pill",
      box: [4.5, 4.5, 15.5, 15.5],
      icon: [
        ["circle", { cx: "10.5", cy: "10.5", r: "6" }],
        ["line", { x1: "15", y1: "15", x2: "20", y2: "20" }],
      ],
    },
    {
      id: "all-playlists",
      label: LABELS.allPlaylists,
      place: "pill",
      box: [4, 6, 17, 14],
      icon: [
        ["line", { x1: "4", y1: "6", x2: "16", y2: "6" }],
        ["line", { x1: "4", y1: "11", x2: "16", y2: "11" }],
        ["line", { x1: "4", y1: "16", x2: "11", y2: "16" }],
        ["circle", { cx: "16.5", cy: "17.5", r: "2.5" }],
        ["polyline", { points: "19 17.5 19 9 21 9.5" }],
      ],
    },
    {
      id: "settings",
      label: LABELS.settings,
      place: "right",
      box: [2, 2, 20, 20],
      icon: [
        ["circle", { cx: "12", cy: "12", r: "3.7" }],
        [
          "path",
          {
            d: "M10 2h4l.5 2.5 1.5.6 2.1-1.4 2.2 2.2-1.4 2.1.6 1.5L22 10v4l-2.5.5-.6 1.5 1.4 2.1-2.2 2.2-2.1-1.4-1.5.6L14 22h-4l-.5-2.5-1.5-.6-2.1 1.4-2.2-2.2L5.1 16l-.6-1.5L2 14v-4l2.5-.5.6-1.5-1.4-2.1 2.2-2.2L8 5.1l1.5-.6z",
          },
        ],
      ],
    },
  ];

  /** @type {HTMLElement | null} */
  var host = null;
  /** @type {Record<string, HTMLElement>} */
  var buttons = {};
  /** @type {Record<string, HTMLElement>} The label inside each page item. */
  var labels = {};
  /** @type {HTMLElement | null} The pill that holds the page items. */
  var pill = null;
  /** @type {HTMLElement | null} The lighter capsule behind the active item. */
  var capsule = null;
  /** @type {string | null} The item the capsule sits behind. */
  var capsuleOn = null;
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
   * The path a page item leads to, or null for one that does not navigate.
   * @param {string} id - Button id
   * @returns {string | null}
   */
  function pathFor(id) {
    if (id === "all-playlists") return ALL_PLAYLISTS_PATH;
    var sf = storefront();
    if (id === "home" && sf) return "/" + sf + "/home";
    return null;
  }

  /** @returns {string} The current path without a trailing slash. */
  function currentPath() {
    return window.location.pathname.replace(/\/+$/, "") || "/";
  }

  /**
   * The page item to mark: Search while the search panel is open, otherwise
   * the item whose page is open, otherwise none.
   * @returns {string | null}
   */
  function activeItem() {
    var search = window.__hydraSongSearch;
    if (search && typeof search.isOpen === "function" && search.isOpen()) return "search";
    var here = currentPath();
    if (pathFor("home") === here) return "home";
    if (pathFor("all-playlists") === here) return "all-playlists";
    return null;
  }

  /**
   * Whether the page has an entry to go back to. The Navigation API answers
   * for this tab's history; without it, Back stays available.
   * @returns {boolean}
   */
  function canGoBack() {
    var nav = window.navigation;
    return !nav || typeof nav.canGoBack !== "boolean" ? true : nav.canGoBack;
  }

  /**
   * Where an item will sit once the labels have finished changing: its
   * offset in the pill and its width. Labels animate their width, so the live
   * layout is still moving when the capsule sets off; aiming at it made the
   * capsule run past the item and come back. Each item's width without its
   * label is measured live, and only the active item's label is added back.
   * @param {string} id - The item that becomes active
   * @returns {{ x: number, w: number }}
   */
  function settledBox(id) {
    var style = window.getComputedStyle(pill);
    var x = parseFloat(style.paddingLeft) || 0;
    var gap = parseFloat(style.columnGap) || 0;
    var box = { x: 0, w: 0 };
    BUTTONS.forEach(function (spec) {
      if (spec.place !== "pill") return;
      var label = labels[spec.id];
      var margin = parseFloat(window.getComputedStyle(label).marginLeft) || 0;
      var width = buttons[spec.id].offsetWidth - label.offsetWidth - margin;
      if (spec.id === id) {
        width += label.scrollWidth + LABEL_GAP_PX;
        box = { x: x, w: width };
      }
      x += width + gap;
    });
    return box;
  }

  /**
   * Move the capsule behind the active item. Its left and width carry a
   * 200ms ease transition in the stylesheet, which prefers-reduced-motion
   * turns off; the first placement after the bar shows skips it, so the
   * capsule appears on its item instead of travelling from the edge.
   * @param {string | null} id - The active item, or null for none
   * @returns {void}
   */
  function moveCapsule(id) {
    if (!capsule) return;
    if (!id || !buttons[id]) {
      capsule.style.setProperty("opacity", "0");
      capsuleOn = null;
      return;
    }
    var instant = capsuleOn === null;
    capsuleOn = id;
    var box = settledBox(id);
    if (instant) capsule.style.setProperty("transition", "none");
    capsule.style.setProperty("left", box.x + "px");
    capsule.style.setProperty("width", box.w + "px");
    capsule.style.setProperty("opacity", "1");
    if (instant) {
      // Apply the jump before the transition comes back.
      void capsule.offsetWidth;
      capsule.style.removeProperty("transition");
    }
  }

  /**
   * Mark the active item, move the capsule and show whether Back can go back.
   * @returns {void}
   */
  function refresh() {
    if (!host) return;
    var current = activeItem();
    BUTTONS.forEach(function (spec) {
      if (spec.place !== "pill") return;
      if (spec.id === current) buttons[spec.id].setAttribute("aria-current", "page");
      else buttons[spec.id].removeAttribute("aria-current");
    });
    buttons.back.setAttribute("aria-disabled", canGoBack() ? "false" : "true");
    if (current !== capsuleOn) moveCapsule(current);
  }

  /**
   * Open a page in-app so playback continues: push the path and let Apple's
   * router answer the popstate.
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
    if (id === "back") {
      if (canGoBack()) sendToMain("nav:back");
    } else if (id === "settings") sendToMain("nav:settings");
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
   * slot, centred, as the navigation row frames its icons.
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
   * One button. A page item carries its label, shown beside the icon while it
   * is active; every button has the label as its tooltip and accessible name.
   * @param {{ id: string, label: string, place: string }} spec - Button definition
   * @returns {HTMLElement}
   */
  function createButton(spec) {
    var button = document.createElement("button");
    button.setAttribute("type", "button");
    button.setAttribute("class", spec.place === "pill" ? "item" : "round");
    button.setAttribute("aria-label", spec.label);
    button.setAttribute("title", spec.label);
    button.setAttribute("data-hydra-page", spec.id);
    button.appendChild(iconFor(spec));
    if (spec.place === "pill") {
      var label = document.createElement("span");
      label.setAttribute("class", "label");
      label.setAttribute("aria-hidden", "true");
      label.textContent = spec.label;
      button.appendChild(label);
      labels[spec.id] = label;
    }
    button.addEventListener("click", function () {
      press(spec.id);
    });
    buttons[spec.id] = button;
    return button;
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
    var bar = document.createElement("div");
    bar.setAttribute("class", "bar");
    var left = document.createElement("div");
    left.setAttribute("class", "side");
    pill = document.createElement("nav");
    pill.setAttribute("class", "pill");
    capsule = document.createElement("div");
    capsule.setAttribute("class", "capsule");
    capsule.setAttribute("aria-hidden", "true");
    pill.appendChild(capsule);
    var right = document.createElement("div");
    right.setAttribute("class", "side");
    BUTTONS.forEach(function (spec) {
      var into = spec.place === "pill" ? pill : spec.place === "left" ? left : right;
      into.appendChild(createButton(spec));
    });
    bar.appendChild(left);
    bar.appendChild(pill);
    bar.appendChild(right);
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
    // Shown again, the capsule lands on its item without travelling.
    capsuleOn = null;
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

  window.__hydraTopBar = { update: update, refresh: refresh };
  update();
})();
