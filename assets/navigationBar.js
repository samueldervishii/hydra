// Add navigation and Settings buttons to the sidebar because Hydra has no browser toolbar.
//
// The buttons sit in their own row at the top of the sidebar, above the Apple
// Music logo. The expanded sidebar shows the sidebar toggle, Back, Forward,
// Reload and Settings. The collapsed strip (assets/sidebar.css, gated on
// html[data-hydra-sidebar-collapsed]) shows the toggle, Back, Home, Search and
// All Playlists instead. src/main.ts runs
// this script on every load and every in-page navigation; a repeat run only
// refreshes the current-page highlight, so no observer is needed.
(function () {
  // loadAssets() in src/main.ts replaces NAV_LABELS_TOKEN from src/i18n.ts with JSON.
  // executeJavaScript() cannot supply loadFile() query parameters, so the raw asset requires substitution.
  /** @type {{ sidebar: string, back: string, forward: string, reload: string, settings: string, home: string, search: string, allPlaylists: string }} */
  var LABELS = __HYDRA_NAV_LABELS__;

  /** @type {string} */
  var SVG_NS = "http://www.w3.org/2000/svg";
  /** @type {string} */
  var IDLE_COLOR = "var(--systemPrimary, #ffffff)";
  /** @type {string} */
  var ACTIVE_COLOR = "var(--keyColor, #fa586a)";
  /** @type {boolean} */
  var IS_CLASSICAL = window.location.hostname === "classical.music.apple.com";

  // Every icon draws in a 20px slot with the longer side of its glyph at
  // 16px, so Hydra's icons and the ones adopted from Apple read at one size.
  // Each button is the same 32px target: the slot plus 6px of padding.
  /** @type {number} */
  var ICON_PX = 20;
  /** @type {number} */
  var GLYPH_PX = 16;
  // Apple draws its sidebar icons about 16 units wide in a 24-unit box; used
  // until the real glyph can be measured.
  /** @type {[number, number, number, number]} */
  var APPLE_DEFAULT_BOX = [4, 4, 16, 16];

  // Each icon defines geometry only. Its parent SVG carries sharedAttrs and
  // strokes in currentColor, so painting the button colours the icon. Strokes
  // do not scale, so every line stays 1.8px whatever the icon's box.
  var sharedAttrs = {
    width: String(ICON_PX),
    height: String(ICON_PX),
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "1.8",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
  };

  /**
   * In-app pages for the collapsed strip. Apple's own sidebar link is used when
   * it exists, which also supplies the icon; the path is the fallback.
   * @type {Record<string, { testid: string, path: (storefront: string) => string }>}
   */
  var PAGES = {
    home: {
      testid: "home",
      path: function (sf) {
        return IS_CLASSICAL ? "/" + sf : "/" + sf + "/home";
      },
    },
    search: {
      testid: "search",
      path: function (sf) {
        return "/" + sf + "/search";
      },
    },
    // Apple's library routes carry no storefront segment.
    "all-playlists": {
      testid: "all-playlists",
      path: function () {
        return "/library/all-playlists/";
      },
    },
  };

  // show: "expanded" and "collapsed" buttons swap when the sidebar collapses.
  // box is the glyph's extent in the icon's own units: [x, y, width, height].
  /** @type {Array<{ label: string, show: string, channel?: string, page?: string, box: [number, number, number, number], icon: Array<[string, Record<string, string>]> }>} */
  var BUTTONS = [
    {
      label: LABELS.sidebar,
      show: "both",
      channel: "nav:sidebar",
      box: [3, 4, 18, 16],
      icon: [
        ["rect", { x: "3", y: "4", width: "18", height: "16", rx: "2" }],
        ["line", { x1: "9", y1: "4", x2: "9", y2: "20" }],
      ],
    },
    {
      label: LABELS.back,
      show: "both",
      channel: "nav:back",
      box: [9, 4, 6, 16],
      icon: [["polyline", { points: "15 20 9 12 15 4" }]],
    },
    {
      label: LABELS.forward,
      show: "expanded",
      channel: "nav:forward",
      box: [9, 4, 6, 16],
      icon: [["polyline", { points: "9 4 15 12 9 20" }]],
    },
    {
      label: LABELS.reload,
      show: "expanded",
      channel: "nav:reload",
      box: [3, 3, 20, 18],
      icon: [
        ["polyline", { points: "23 4 23 10 17 10" }],
        ["path", { d: "M20.49 15a9 9 0 1 1-2.12-9.36L23 10" }],
      ],
    },
    {
      label: LABELS.settings,
      show: "expanded",
      channel: "nav:settings",
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
      label: LABELS.home,
      show: "collapsed",
      page: "home",
      box: [3, 4, 18, 16],
      icon: [
        ["polyline", { points: "3 11 12 4 21 11" }],
        ["path", { d: "M5.5 9.5V20h5v-6h3v6h5V9.5" }],
      ],
    },
    {
      label: LABELS.search,
      show: "collapsed",
      page: "search",
      box: [4.5, 4.5, 15.5, 15.5],
      icon: [
        ["circle", { cx: "10.5", cy: "10.5", r: "6" }],
        ["line", { x1: "15", y1: "15", x2: "20", y2: "20" }],
      ],
    },
    {
      label: LABELS.allPlaylists,
      show: "collapsed",
      page: "all-playlists",
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

  /**
   * Send to the main process, tolerating an absent bridge.
   *
   * The injected script cannot assume that the preload bridge exists.
   * Guard it as assets/musicKitHook.js does, so clicks cannot throw for an absent bridge.
   *
   * @param {string} channel - IPC channel name
   * @returns {void}
   */
  function sendToMain(channel) {
    const bridge = window.AMWrapper;
    if (!bridge || !bridge.ipcRenderer) return;
    bridge.ipcRenderer.send(channel);
  }

  /**
   * Create an SVG element with the given tag and attributes.
   * @param {string} tag - SVG element tag name
   * @param {Record<string, string>} attrs - Attribute key-value pairs
   * @returns {SVGElement}
   */
  function createSvgElement(tag, attrs) {
    var el = document.createElementNS(SVG_NS, tag);
    for (var key in attrs) {
      el.setAttribute(key, attrs[key]);
    }
    return el;
  }

  /**
   * Frame an icon so the longer side of its glyph fills GLYPH_PX of the
   * ICON_PX slot, centred.
   * @param {SVGElement} svg - Icon to size
   * @param {[number, number, number, number]} box - Glyph extent: x, y, width, height
   * @returns {void}
   */
  function fitIcon(svg, box) {
    var side = (Math.max(box[2], box[3]) * ICON_PX) / GLYPH_PX;
    var x = box[0] + box[2] / 2 - side / 2;
    var y = box[1] + box[3] / 2 - side / 2;
    svg.setAttribute("viewBox", [x, y, side, side].join(" "));
    svg.setAttribute("width", String(ICON_PX));
    svg.setAttribute("height", String(ICON_PX));
  }

  /**
   * Apple's sidebar link for a page, if the page renders one. Classical has no
   * library, and a signed-out page has no All Playlists link.
   * @param {string} page - Key into PAGES
   * @returns {HTMLAnchorElement | null}
   */
  function appleLink(page) {
    return document.querySelector(
      'a.navigation-item__link[data-testid="' + PAGES[page].testid + '"]',
    );
  }

  /**
   * The storefront for a fallback path: the first path segment when it is one,
   * otherwise the one in Apple's own sidebar links, otherwise "us".
   * @returns {string}
   */
  function storefront() {
    var fromPath = window.location.pathname.split("/")[1] || "";
    if (/^[a-z]{2}$/.test(fromPath)) return fromPath;
    var link = document.querySelector("a.navigation-item__link[href]");
    if (link) {
      var fromLink = new URL(link.href, window.location.href).pathname.split("/")[1] || "";
      if (/^[a-z]{2}$/.test(fromLink)) return fromLink;
    }
    return "us";
  }

  /**
   * The path a page button leads to, without a trailing slash.
   * @param {string} page - Key into PAGES
   * @returns {string}
   */
  function targetPath(page) {
    var link = appleLink(page);
    var path = link
      ? new URL(link.href, window.location.href).pathname
      : PAGES[page].path(storefront());
    return path.replace(/\/+$/, "") || "/";
  }

  /**
   * Navigate in-app so playback continues: click Apple's own link, which runs
   * its router, or push the path and let the router answer the popstate.
   * @param {string} page - Key into PAGES
   * @returns {void}
   */
  function goToPage(page) {
    var link = appleLink(page);
    if (link) {
      link.click();
      return;
    }
    window.history.pushState({}, "", PAGES[page].path(storefront()));
    window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }));
  }

  /**
   * Paint a button. Inline !important styles override stylesheet :hover
   * rules, so JavaScript must update the hover styles. The current page keeps
   * the accent colour, as Apple's own sidebar does.
   *
   * @param {HTMLButtonElement} button - Button to paint
   * @param {boolean} hovered - Whether the pointer is over the button
   * @returns {void}
   */
  function paintButton(button, hovered) {
    var current = button.getAttribute("aria-current") === "page";
    button.style.setProperty("opacity", hovered || current ? "1" : "0.7", "important");
    button.style.setProperty("color", hovered || current ? ACTIVE_COLOR : IDLE_COLOR, "important");
  }

  /**
   * The extent of Apple's glyph, or null while its sidebar is not rendered,
   * which reports an empty box.
   * @param {SVGElement} svg - Apple's icon in its sidebar link
   * @returns {[number, number, number, number] | null}
   */
  function measuredBox(svg) {
    if (typeof svg.getBBox !== "function") return null;
    var b = svg.getBBox();
    return b.width > 0 && b.height > 0 ? [b.x, b.y, b.width, b.height] : null;
  }

  /**
   * Swap a page button's own icon for Apple's when the sidebar link renders
   * one, so the strip shows the icons the expanded sidebar uses. The glyph is
   * measured from Apple's copy, which is rendered when the sidebar is
   * expanded; until then a standard box stands in, and a later run refits it.
   * @param {HTMLButtonElement} button - Page button
   * @returns {void}
   */
  function adoptAppleIcon(button) {
    if (button.getAttribute("data-hydra-icon") === "apple-measured") return;
    var link = appleLink(button.getAttribute("data-hydra-page"));
    var source = link && link.querySelector("svg");
    var current = button.querySelector("svg");
    if (!source || !current) return;
    var box = measuredBox(source);
    var icon = current;
    if (button.getAttribute("data-hydra-icon") !== "apple") {
      icon = source.cloneNode(true);
      icon.setAttribute("aria-hidden", "true");
      icon.style.setProperty("fill", "currentColor", "important");
      icon.style.setProperty("stroke", "none", "important");
      button.replaceChild(icon, current);
    }
    fitIcon(icon, box || APPLE_DEFAULT_BOX);
    button.setAttribute("data-hydra-icon", box ? "apple-measured" : "apple");
  }

  /**
   * Mark the button for the current page and adopt Apple's icons once they
   * have rendered. Runs on every injection, including each in-page navigation.
   * @param {HTMLElement} container - The #hydra-nav-buttons row
   * @returns {void}
   */
  function refresh(container) {
    var here = window.location.pathname.replace(/\/+$/, "") || "/";
    var buttons = container.querySelectorAll("button[data-hydra-page]");
    for (var i = 0; i < buttons.length; i++) {
      var button = buttons[i];
      var page = button.getAttribute("data-hydra-page");
      adoptAppleIcon(button);
      if (targetPath(page) === here) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
      paintButton(button, false);
    }
  }

  /**
   * Create one button. Display is set without !important so the stylesheet
   * can swap the expanded and collapsed sets; everything else is !important
   * to hold against Apple's button styles.
   * @param {{ label: string, show: string, channel?: string, page?: string }} spec - Button definition
   * @param {SVGSVGElement} svgElement - Icon to display inside the button
   * @returns {HTMLButtonElement}
   */
  function createButton(spec, svgElement) {
    const btn = document.createElement("button");
    btn.setAttribute("aria-label", spec.label);
    btn.setAttribute("title", spec.label);
    btn.setAttribute("data-hydra-show", spec.show);
    if (spec.page) btn.setAttribute("data-hydra-page", spec.page);
    btn.setAttribute(
      "style",
      [
        "display: " + (spec.show === "collapsed" ? "none" : "flex"),
        "background: none !important",
        "border: none !important",
        "cursor: pointer !important",
        "padding: 6px !important",
        "border-radius: 6px !important",
        "align-items: center !important",
        "justify-content: center !important",
        "color: " + IDLE_COLOR + " !important",
        "opacity: 0.7 !important",
        "transition: opacity 0.15s ease, color 0.15s ease !important",
      ].join("; "),
    );

    btn.appendChild(svgElement);

    btn.addEventListener("mouseenter", function () {
      paintButton(this, true);
    });
    btn.addEventListener("mouseleave", function () {
      paintButton(this, false);
    });

    btn.addEventListener("click", function () {
      if (spec.page) goToPage(spec.page);
      else if (spec.channel) sendToMain(spec.channel);
    });

    return btn;
  }

  // SPA navigation can retain the header, so a repeat run must not duplicate buttons.
  var existing = document.getElementById("hydra-nav-buttons");
  if (existing) {
    refresh(existing);
    return;
  }

  const header = document.querySelector(".navigation__header");
  if (!header) {
    console.warn("Hydra: .navigation__header not found");
    return;
  }

  const container = document.createElement("div");
  container.id = "hydra-nav-buttons";
  // Its own grid row above the logo, spread across the sidebar. The 14px
  // inset plus each button's 6px padding puts the first and last icons on the
  // logo's 20px inset at both edges. Apple's sidebar content overlaps the
  // header with a negative top margin, hence the stacking context. Padding,
  // gap, direction and distribution stay overridable for the collapsed strip.
  container.setAttribute(
    "style",
    [
      "position: relative !important",
      "z-index: 1 !important",
      "display: flex !important",
      "align-items: center !important",
      "pointer-events: auto !important",
      "justify-content: space-between",
      "gap: 0",
      "padding: 4px 14px 0",
    ].join("; "),
  );

  BUTTONS.forEach(function (spec) {
    if (spec.page === "all-playlists" && IS_CLASSICAL) return;
    var svg = createSvgElement("svg", sharedAttrs);
    fitIcon(svg, spec.box);
    spec.icon.forEach(function (child) {
      var shape = createSvgElement(child[0], child[1]);
      shape.setAttribute("vector-effect", "non-scaling-stroke");
      svg.appendChild(shape);
    });
    container.appendChild(createButton(spec, svg));
  });

  header.insertBefore(container, header.firstChild);
  refresh(container);

  console.log("[Hydra] Navigation bar injected");
})();
