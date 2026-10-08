// Hydra's top bar for music.apple.com, in place of Apple's sidebar: Back on
// the left, a floating pill in the centre with Home, Search and All Playlists,
// and Settings and the account menu on the right, in a 56px strip across the
// top of the window.
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
  /** @type {{ back: string, home: string, search: string, vibe: string, allPlaylists: string, settings: string, account: string, switchToSidebar: string, signOut: string }} */
  var LABELS = __HYDRA_TOP_BAR_LABELS__;

  var REQUEST_ATTRIBUTE = "data-hydra-top-bar-requested";
  var ACTIVE_ATTRIBUTE = "data-hydra-top-bar";
  /** The strip assets/topBar.css reserves above Apple's grid. */
  var BAR_PX = 56;
  /** src/main.ts matches this exact line and logs a fixed warning. */
  var LAYOUT_WARNING = "[hydra] top-bar: layout-unavailable";
  /** Apple's library route; library routes carry no storefront segment. */
  var ALL_PLAYLISTS_PATH = "/library/all-playlists";
  /** Custom property on the host carrying the colour sampled below the strip. */
  var STRIP_PROPERTY = "--hydra-strip";
  /** Set on <html> while Vibe is switched off in Settings; src/integrations/vibe/index.ts holds the name. */
  var VIBE_OFF_ATTRIBUTE = "data-hydra-vibe-off";
  /** The pill and round buttons on a tinted page: the strip colour, 10% lighter in dark mode, 10% darker in light. */
  var TINT_PROPERTY = "--hydra-tint";
  /** Their icon colour on that tint: white or black, whichever contrasts more. */
  var TINT_FG_PROPERTY = "--hydra-tint-fg";
  /** How far the tint moves from the strip colour, towards white or black. */
  var TINT_MIX = 0.1;
  /** How far below the strip the page colour is sampled, in CSS pixels. */
  var SAMPLE_BELOW_PX = 4;
  /** Space between an active item's icon and its label, in CSS pixels. */
  var LABEL_GAP_PX = 8;
  /** The avatar's pixel size requested from Apple: twice the 40px it is drawn at. */
  var AVATAR_PX = 80;
  var MENU_ID = "hydra-account-menu";
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
    ":host { background-color: var(--pageBG, #1f1f1f); }",
    ".bar { position: relative; box-sizing: border-box; height: 100%; display: flex;",
    "  align-items: center; justify-content: space-between; padding: 0 36px;",
    "  background-color: var(" + STRIP_PROPERTY + ", var(--pageBG, #1f1f1f));",
    "  transition: background-color 0.25s ease; }",
    ".side { display: flex; align-items: center; gap: 8px; }",
    "button { display: flex; align-items: center; justify-content: center; margin: 0; padding: 0;",
    "  border: 0; cursor: pointer; font: inherit; background: transparent;",
    "  color: var(--systemSecondary, rgba(128, 128, 128, 0.9)); }",
    "button:hover { color: var(--systemPrimary, #ffffff); }",
    "button[hidden] { display: none; }",
    "button:focus-visible { outline: 2px solid var(--keyColor, #fa586a); outline-offset: 2px; }",
    ".round { width: 32px; height: 32px; border-radius: 50%;",
    "  background: linear-gradient(var(--glass), var(--glass)), var(--pageBG, #1f1f1f);",
    "  box-shadow: inset 0 0 0 0.5px var(--glass-stroke); }",
    ".round[aria-disabled='true'] { opacity: 0.4; cursor: default; }",
    ".round[aria-disabled='true']:hover { color: var(--systemSecondary, rgba(128, 128, 128, 0.9)); }",
    ".pill { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);",
    "  display: flex; align-items: center; gap: 4px; height: 44px; padding: 0 4px;",
    "  box-sizing: border-box; border-radius: 1000px;",
    "  background: linear-gradient(var(--glass), var(--glass)), var(--pageBG, #1f1f1f);",
    "  box-shadow: 0 10px 40px var(--glass-shadow), inset 0 0 0 0.5px var(--glass-stroke); }",
    // On a page Apple tinted from its artwork, the pill and round buttons take
    // the strip's colour instead of the neutral glass, and their icons switch
    // to whichever of white or black reads better on it.
    ".pill, .round { transition: background-color 0.25s ease; }",
    ":host([data-tinted]) .pill, :host([data-tinted]) .round { background: var(" + TINT_PROPERTY + "); }",
    ":host([data-tinted]) .pill .item, :host([data-tinted]) .round {",
    "  color: color-mix(in srgb, var(" + TINT_FG_PROPERTY + ") 72%, transparent); }",
    ":host([data-tinted]) .pill .item:hover, :host([data-tinted]) .round:hover,",
    ":host([data-tinted]) .item[aria-current='page'] { color: var(" + TINT_FG_PROPERTY + "); }",
    ":host([data-tinted]) .capsule { background: color-mix(in srgb, var(" + TINT_FG_PROPERTY + ") 16%, transparent); }",
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
    ".account { overflow: hidden; }",
    ".account img, .face img { width: 100%; height: 100%; object-fit: cover; }",
    ".menu { display: none; position: absolute; top: 52px; right: 36px; min-width: 220px;",
    "  box-sizing: border-box; padding: 6px; border-radius: 12px; font-size: 13px;",
    "  background: linear-gradient(var(--glass), var(--glass)), var(--pageBG, #1f1f1f);",
    "  box-shadow: 0 10px 40px var(--glass-shadow), inset 0 0 0 0.5px var(--glass-stroke); }",
    ".menu.open { display: block; }",
    ".header { display: flex; justify-content: center; padding: 6px 0 10px; margin-bottom: 6px;",
    "  border-bottom: 1px solid var(--labelDivider, rgba(128, 128, 128, 0.3)); }",
    ".face { display: flex; align-items: center; justify-content: center; width: 40px;",
    "  height: 40px; border-radius: 50%; overflow: hidden;",
    "  background: var(--systemQuaternary, rgba(128, 128, 128, 0.2)); color: var(--systemSecondary, rgba(128, 128, 128, 0.9)); }",
    ".menuitem { width: 100%; justify-content: flex-start; padding: 8px 10px; border-radius: 8px;",
    "  color: var(--systemPrimary, #ffffff); text-align: left; }",
    ".menuitem:hover, .menuitem:focus { background: var(--systemQuaternary, rgba(128, 128, 128, 0.2)); }",
    ".menuitem:focus-visible { outline-offset: -2px; }",
    "@media (prefers-reduced-motion: reduce) { .bar, .pill, .round, .label, .capsule { transition: none; } }",
  ].join("\n");

  // The account button's stand-in until Apple's avatar loads, and when there is
  // none: a person, since no name is read for an initial.
  var PERSON_BOX = [4, 4, 16, 16];
  /** @type {Array<[string, Record<string, string>]>} */
  var PERSON_ICON = [
    ["circle", { cx: "12", cy: "8.5", r: "4" }],
    ["path", { d: "M4 20c0-3.6 3.6-6 8-6s8 2.4 8 6" }],
  ];

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
      id: "vibe",
      label: LABELS.vibe,
      place: "pill",
      box: [5, 3, 16, 17.5],
      icon: [
        ["path", { d: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" }],
        ["path", { d: "M18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" }],
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
    {
      id: "account",
      label: LABELS.account,
      place: "right",
      box: PERSON_BOX,
      icon: PERSON_ICON,
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
  /** @type {string | null} The section of the last page that had one. */
  var lastSection = null;
  /**
   * The section each history entry showed, by Navigation API entry key, so a
   * page outside every section shows the one it was opened from again when
   * Back returns to it.
   * @type {Map<string, string | null>}
   */
  var entrySections = new Map();
  /** Entries remembered at most; the oldest is forgotten first. */
  var MAX_REMEMBERED_ENTRIES = 200;
  /** @type {any} The MusicKit instance whose sign-in changes are followed. */
  var boundMk = null;
  /** @type {HTMLElement | null} The account menu. */
  var menu = null;
  /** @type {HTMLElement[]} Its items, in order. */
  var menuItems = [];
  /** @type {HTMLElement | null} The avatar slot in the menu's header. */
  var face = null;
  /** @type {any} The MusicKit instance the avatar was read for. */
  var avatarFor = null;
  /** @type {MutationObserver | null} Watches the elements the strip colour came from. */
  var stripObserver = null;
  /** @type {number | null} A strip sample waiting for the next frame. */
  var stripFrame = null;
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
   * The section a page belongs to: Home on any storefront's home page, All
   * Playlists on the library's playlist list, every library playlist and
   * every playlist folder, and none elsewhere.
   * @param {string} path - Page path without a trailing slash
   * @returns {string | null}
   */
  function sectionOf(path) {
    if (/^\/[a-z]{2}\/home$/.test(path)) return "home";
    if (
      path === ALL_PLAYLISTS_PATH ||
      path.indexOf("/library/playlist/") === 0 ||
      path.indexOf("/library/playlist-folder/") === 0
    ) {
      return "all-playlists";
    }
    return null;
  }

  /** @returns {string | null} The current history entry's key, where the Navigation API has one. */
  function entryKey() {
    var entry = window.navigation && window.navigation.currentEntry;
    return entry && typeof entry.key === "string" ? entry.key : null;
  }

  /**
   * @param {string} key - History entry key
   * @param {string | null} section - The section it shows
   * @returns {void}
   */
  function remember(key, section) {
    entrySections.delete(key);
    entrySections.set(key, section);
    if (entrySections.size > MAX_REMEMBERED_ENTRIES) {
      entrySections.delete(entrySections.keys().next().value);
    }
  }

  /**
   * The page item to mark. Search or Vibe while its panel is open; otherwise
   * the open page's section; and on a page outside every section (an album,
   * an artist) the section it was opened from, so the capsule never leaves the
   * pill. That section is remembered for the page's history entry, so Back
   * shows it again even after other sections were visited since.
   * @returns {string | null}
   */
  function activeItem() {
    var search = window.__hydraSongSearch;
    if (search && typeof search.isOpen === "function" && search.isOpen()) return "search";
    var vibe = window.__hydraVibe;
    if (vibe && typeof vibe.isOpen === "function" && vibe.isOpen()) return "vibe";
    var key = entryKey();
    var section = sectionOf(currentPath());
    if (!section) {
      section = key && entrySections.has(key) ? entrySections.get(key) : lastSection;
    }
    if (key) remember(key, section);
    lastSection = section;
    return section;
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
    // Vibe switched off in Settings hides its item; the items after it move
    // up, so the capsule moves with them.
    var vibeOff = document.documentElement.hasAttribute(VIBE_OFF_ATTRIBUTE);
    var vibeChanged = buttons.vibe.hasAttribute("hidden") !== vibeOff;
    if (vibeOff) buttons.vibe.setAttribute("hidden", "");
    else buttons.vibe.removeAttribute("hidden");
    var current = activeItem();
    BUTTONS.forEach(function (spec) {
      if (spec.place !== "pill") return;
      if (spec.id === current) buttons[spec.id].setAttribute("aria-current", "page");
      else buttons[spec.id].removeAttribute("aria-current");
    });
    buttons.back.setAttribute("aria-disabled", canGoBack() ? "false" : "true");
    if (current !== capsuleOn || vibeChanged) moveCapsule(current);
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
    if (id === "account") {
      if (menu && menu.classList.contains("open")) closeMenu(false);
      else openMenu(0);
    } else if (id === "back") {
      if (canGoBack()) sendToMain("nav:back");
    } else if (id === "settings") sendToMain("nav:settings");
    else if (id === "search") {
      if (window.__hydraSongSearch) window.__hydraSongSearch.open();
    } else if (id === "vibe") {
      if (window.__hydraVibe) window.__hydraVibe.open();
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
    if (spec.id === "account") {
      button.setAttribute("class", "round account");
      button.setAttribute("aria-haspopup", "menu");
      button.setAttribute("aria-expanded", "false");
      button.setAttribute("aria-controls", MENU_ID);
      button.addEventListener("keydown", function (event) {
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
        event.preventDefault();
        openMenu(event.key === "ArrowDown" ? 0 : -1);
      });
    }
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
   * A sized avatar URL on Apple's image host, or "" for anything else. Apple's
   * artwork templates carry {w} and {h}, and may carry {c} and {f}.
   * @param {unknown} template - attributes.avatarArtwork.url from mk.me()
   * @returns {string}
   */
  function avatarUrl(template) {
    if (typeof template !== "string") return "";
    try {
      var url = new URL(
        template
          .replace("{w}", String(AVATAR_PX))
          .replace("{h}", String(AVATAR_PX))
          .replace("{c}", "cc")
          .replace("{f}", "jpg"),
      );
      return url.protocol === "https:" && /\.mzstatic\.com$/.test(url.hostname) ? url.href : "";
    } catch (_) {
      return "";
    }
  }

  /**
   * Put Apple's avatar in the account button and the menu's header, once per
   * signed-in MusicKit instance. mk.me() is where Apple's own account menu
   * gets it. Until it loads, or when there is none, the person icon stays.
   * @returns {void}
   */
  function loadAvatar() {
    var mk = boundMk;
    if (!mk || avatarFor === mk || typeof mk.me !== "function") return;
    avatarFor = mk;
    var answer;
    try {
      answer = Promise.resolve(mk.me());
    } catch (_) {
      return;
    }
    answer.then(
      function (me) {
        if (avatarFor !== mk) return;
        var src = avatarUrl(me && me.attributes && me.attributes.avatarArtwork && me.attributes.avatarArtwork.url);
        if (!src) return;
        [buttons.account, face].forEach(function (slot) {
          var img = document.createElement("img");
          img.setAttribute("src", src);
          img.setAttribute("alt", "");
          img.setAttribute("draggable", "false");
          slot.replaceChildren(img);
        });
      },
      function () {
        // The person icon stays; nothing about the account is logged.
      },
    );
  }

  /**
   * Close the account menu when a press lands outside the bar.
   * @param {Event} event - pointerdown on window
   * @returns {void}
   */
  function onOutsidePress(event) {
    var path = typeof event.composedPath === "function" ? event.composedPath() : [];
    if (path.indexOf(host) === -1) closeMenu(false);
  }

  /**
   * Open the account menu and focus one of its items.
   * @param {number} index - Item to focus; -1 for the last
   * @returns {void}
   */
  function openMenu(index) {
    if (!menu) return;
    if (!menu.classList.contains("open")) {
      menu.classList.add("open");
      buttons.account.setAttribute("aria-expanded", "true");
      window.addEventListener("pointerdown", onOutsidePress, true);
    }
    var item = menuItems[index < 0 ? menuItems.length - 1 : index];
    if (item) item.focus();
  }

  /**
   * Close the account menu.
   * @param {boolean} refocus - Give focus back to the account button
   * @returns {void}
   */
  function closeMenu(refocus) {
    if (!menu || !menu.classList.contains("open")) return;
    menu.classList.remove("open");
    buttons.account.setAttribute("aria-expanded", "false");
    window.removeEventListener("pointerdown", onOutsidePress, true);
    if (refocus) buttons.account.focus();
  }

  /**
   * The account menu: Apple's avatar, then the way to Apple's sidebar, where
   * Apple's own account menu and Sign Out are. Hydra does not sign out itself:
   * Apple's sign-out also ends the store session and resets its own state.
   * @returns {HTMLElement}
   */
  function createMenu() {
    var node = document.createElement("div");
    node.setAttribute("class", "menu");
    node.setAttribute("id", MENU_ID);
    node.setAttribute("role", "menu");
    node.setAttribute("aria-label", LABELS.account);
    var header = document.createElement("div");
    header.setAttribute("class", "header");
    header.setAttribute("role", "presentation");
    face = document.createElement("div");
    face.setAttribute("class", "face");
    face.appendChild(iconFor({ box: PERSON_BOX, icon: PERSON_ICON }));
    header.appendChild(face);
    node.appendChild(header);
    menuItems = [LABELS.switchToSidebar, LABELS.signOut].map(function (text) {
      var item = document.createElement("button");
      item.setAttribute("type", "button");
      item.setAttribute("class", "menuitem");
      item.setAttribute("role", "menuitem");
      item.setAttribute("tabindex", "-1");
      item.textContent = text;
      item.addEventListener("click", function () {
        closeMenu(false);
        sendToMain("nav:apple-sidebar");
      });
      node.appendChild(item);
      return item;
    });
    node.addEventListener("keydown", function (event) {
      var at = menuItems.indexOf(event.target);
      var last = menuItems.length - 1;
      var next = null;
      if (event.key === "ArrowDown") next = at >= last ? 0 : at + 1;
      else if (event.key === "ArrowUp") next = at <= 0 ? last : at - 1;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = last;
      else if (event.key === "Escape") {
        event.preventDefault();
        closeMenu(true);
        return;
      } else if (event.key === "Tab") {
        closeMenu(false);
        return;
      }
      if (next === null) return;
      event.preventDefault();
      menuItems[next].focus();
    });
    return node;
  }

  /**
   * Whether a computed colour paints nothing.
   * @param {string} colour - A computed background-color
   * @returns {boolean}
   */
  function isTransparent(colour) {
    if (!colour || colour === "transparent") return true;
    var rgba = /^rgba\((?:[^,]+,){3}\s*([\d.]+)\)$/.exec(colour);
    if (rgba) return parseFloat(rgba[1]) === 0;
    var slash = /\/\s*([\d.]+)%?\s*\)$/.exec(colour);
    return !!slash && parseFloat(slash[1]) === 0;
  }

  /**
   * The red, green and blue of a computed rgb() or rgba() colour, or null.
   * @param {string | null} colour - A computed colour
   * @returns {number[] | null}
   */
  function parseRgb(colour) {
    var match = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(colour || "");
    return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
  }

  /**
   * WCAG relative luminance of an sRGB colour.
   * @param {number[]} rgb - Red, green and blue, 0 to 255
   * @returns {number}
   */
  function luminance(rgb) {
    var c = rgb.map(function (v) {
      var s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }

  /**
   * Tint the pill and round buttons from the strip colour, or go back to the
   * glass when the page is not tinted: its colour is the page's own, or not
   * an rgb() Hydra can read.
   * @param {string | null} colour - The sampled strip colour
   * @returns {void}
   */
  function applyTint(colour) {
    if (!host) return;
    var strip = parseRgb(colour);
    var pageColour = parseRgb(window.getComputedStyle(host).backgroundColor);
    var plain =
      !strip ||
      (pageColour &&
        Math.abs(strip[0] - pageColour[0]) +
          Math.abs(strip[1] - pageColour[1]) +
          Math.abs(strip[2] - pageColour[2]) <=
          6);
    if (plain) {
      host.removeAttribute("data-tinted");
      host.style.removeProperty(TINT_PROPERTY);
      host.style.removeProperty(TINT_FG_PROPERTY);
      return;
    }
    var dark =
      typeof window.matchMedia !== "function" ||
      window.matchMedia("(prefers-color-scheme: dark)").matches;
    var towards = dark ? 255 : 0;
    var tint = strip.map(function (v) {
      return Math.round(v + (towards - v) * TINT_MIX);
    });
    // Contrast against white is 1.05 / (L + 0.05), against black (L + 0.05) / 0.05.
    var l = luminance(tint);
    var fg = 1.05 / (l + 0.05) >= (l + 0.05) / 0.05 ? "rgb(255, 255, 255)" : "rgb(0, 0, 0)";
    host.style.setProperty(TINT_PROPERTY, "rgb(" + tint.join(", ") + ")");
    host.style.setProperty(TINT_FG_PROPERTY, fg);
    host.setAttribute("data-tinted", "");
  }

  /**
   * Match the strip to the colour Apple painted just below it: the first
   * element up from that point with a background, read from computed styles
   * so no Apple class is named. Album and playlist pages tint themselves from
   * the artwork, and a strip in the default colour left a seam above them.
   * Anything unexpected falls back to the page colour. While a Hydra panel
   * covers the point, the colour stays as it is.
   * @returns {void}
   */
  function sampleStrip() {
    stripFrame = null;
    if (!active || !host) return;
    var colour = null;
    /** @type {Element[]} */
    var chain = [];
    try {
      var hit = document.elementFromPoint(
        Math.round(window.innerWidth / 2),
        BAR_PX + SAMPLE_BELOW_PX,
      );
      if (hit && /^hydra-/.test(hit.id || "")) return;
      for (var node = hit; node && node.nodeType === 1; node = node.parentElement) {
        chain.push(node);
        if (colour) continue;
        var background = window.getComputedStyle(node).backgroundColor;
        if (!isTransparent(background)) colour = background;
      }
    } catch (_) {
      colour = null;
    }
    if (colour) host.style.setProperty(STRIP_PROPERTY, colour);
    else host.style.removeProperty(STRIP_PROPERTY);
    applyTint(colour);
    watchStrip(chain);
  }

  /**
   * Sample again on the next frame, once however many changes arrive.
   * @returns {void}
   */
  function scheduleStrip() {
    if (stripFrame !== null) return;
    if (typeof requestAnimationFrame !== "function") {
      sampleStrip();
      return;
    }
    stripFrame = requestAnimationFrame(sampleStrip);
  }

  /**
   * Resample when the page's background changes: watch only the elements
   * under the sample point, from the one hit up to <html>, for a new class or
   * style and for their children being replaced. No subtree is observed, so
   * the page's own updates elsewhere cost nothing.
   * @param {Element[]} chain - The hit element and its ancestors
   * @returns {void}
   */
  function watchStrip(chain) {
    if (typeof MutationObserver !== "function") return;
    if (!stripObserver) stripObserver = new MutationObserver(scheduleStrip);
    stripObserver.disconnect();
    chain.forEach(function (node) {
      stripObserver.observe(node, {
        attributes: true,
        attributeFilter: ["class", "style"],
        childList: true,
      });
    });
  }

  /**
   * Stop following the page and go back to the page colour.
   * @returns {void}
   */
  function resetStrip() {
    if (stripObserver) stripObserver.disconnect();
    if (stripFrame !== null && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(stripFrame);
    }
    stripFrame = null;
    if (host) host.style.removeProperty(STRIP_PROPERTY);
    applyTint(null);
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
    menu = createMenu();
    bar.appendChild(left);
    bar.appendChild(pill);
    bar.appendChild(right);
    bar.appendChild(menu);
    // Apple's page shortcuts would see a key pressed here as aimed at the
    // host, not a button, so Space could reach its play/pause handler.
    ["keydown", "keyup", "keypress"].forEach(function (type) {
      node.addEventListener(type, function (event) {
        event.stopPropagation();
      });
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
    // Shown again, the capsule lands on its item without travelling.
    capsuleOn = null;
  }

  /**
   * Put Apple's sidebar back.
   * @returns {void}
   */
  function deactivate() {
    closeMenu(false);
    resetStrip();
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
    if (active) {
      refresh();
      loadAvatar();
      // main.ts re-runs the script after every in-page navigation.
      scheduleStrip();
    }
  }

  window.__hydraTopBar = { update: update, refresh: refresh };
  update();
})();
