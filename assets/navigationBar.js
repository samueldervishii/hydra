// Add navigation and Settings buttons to Apple's sidebar because Hydra has no browser toolbar.
//
// The buttons sit in their own row at the top of the sidebar, above the Apple
// Music logo: Back, Forward, Reload and Settings. They are what Apple's sidebar
// shows on Classical, with the Navigation setting on Apple sidebar, and while
// signed out; Hydra's top bar (assets/topBar.js) replaces the sidebar
// otherwise. src/main.ts runs this script on every load, and on an in-page
// navigation again only when src/rendererRefresh.ts finds no row; a repeat run
// finds the row and stops.
(function () {
  // loadAssets() in src/main.ts replaces NAV_LABELS_TOKEN from src/i18n.ts with JSON.
  // executeJavaScript() cannot supply loadFile() query parameters, so the raw asset requires substitution.
  /** @type {{ back: string, forward: string, reload: string, settings: string }} */
  var LABELS = __HYDRA_NAV_LABELS__;

  /** @type {string} */
  var SVG_NS = "http://www.w3.org/2000/svg";
  /** @type {string} */
  var IDLE_COLOR = "var(--systemPrimary, #ffffff)";
  /** @type {string} */
  var HOVER_COLOR = "var(--keyColor, #fa586a)";

  // Every icon draws in a 20px slot with the longer side of its glyph at
  // 16px. Each button is the same 32px target, the slot plus 6px on each side,
  // and shrinks towards the slot when the sidebar is too narrow for all four.
  /** @type {number} */
  var ICON_PX = 20;
  /** @type {number} */
  var GLYPH_PX = 16;

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

  // box is the glyph's extent in the icon's own units: [x, y, width, height].
  /** @type {Array<{ label: string, channel: string, box: [number, number, number, number], icon: Array<[string, Record<string, string>]> }>} */
  var BUTTONS = [
    {
      label: LABELS.back,
      channel: "nav:back",
      box: [9, 4, 6, 16],
      icon: [["polyline", { points: "15 20 9 12 15 4" }]],
    },
    {
      label: LABELS.forward,
      channel: "nav:forward",
      box: [9, 4, 6, 16],
      icon: [["polyline", { points: "9 4 15 12 9 20" }]],
    },
    {
      label: LABELS.reload,
      channel: "nav:reload",
      box: [3, 3, 20, 18],
      icon: [
        ["polyline", { points: "23 4 23 10 17 10" }],
        ["path", { d: "M20.49 15a9 9 0 1 1-2.12-9.36L23 10" }],
      ],
    },
    {
      label: LABELS.settings,
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
   * Paint a button. Inline !important styles override stylesheet :hover
   * rules, so JavaScript must update the hover styles.
   *
   * @param {HTMLButtonElement} button - Button to paint
   * @param {boolean} hovered - Whether the pointer is over the button
   * @returns {void}
   */
  function paintButton(button, hovered) {
    button.style.setProperty("opacity", hovered ? "1" : "0.7", "important");
    button.style.setProperty("color", hovered ? HOVER_COLOR : IDLE_COLOR, "important");
  }

  /**
   * Create one button. Every style is !important to hold against Apple's
   * button styles.
   * @param {{ label: string, channel: string }} spec - Button definition
   * @param {SVGSVGElement} svgElement - Icon to display inside the button
   * @returns {HTMLButtonElement}
   */
  function createButton(spec, svgElement) {
    const btn = document.createElement("button");
    btn.setAttribute("aria-label", spec.label);
    btn.setAttribute("title", spec.label);
    btn.setAttribute(
      "style",
      [
        "display: flex !important",
        "background: none !important",
        "border: none !important",
        "cursor: pointer !important",
        // 32px wide, shrinking to the icon's own 20px: Apple narrows the
        // sidebar with the window, to 164px at the 484px minimum.
        "flex: 0 1 " + (ICON_PX + 12) + "px !important",
        "width: " + (ICON_PX + 12) + "px !important",
        "min-width: " + ICON_PX + "px !important",
        "padding: 6px 0 !important",
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
      sendToMain(spec.channel);
    });

    return btn;
  }

  // SPA navigation can retain the header, so a repeat run must not duplicate buttons.
  if (document.getElementById("hydra-nav-buttons")) return;

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
  // header with a negative top margin, hence the stacking context.
  container.setAttribute(
    "style",
    [
      "position: relative !important",
      "z-index: 1 !important",
      "display: flex !important",
      "align-items: center !important",
      "pointer-events: auto !important",
      // A grid item stops at its content's minimum width unless told
      // otherwise, which kept the row at full width and let the shrinkable
      // buttons overflow the sidebar anyway.
      "min-width: 0 !important",
      "justify-content: space-between !important",
      "gap: 0 !important",
      "padding: 4px 14px 0 !important",
    ].join("; "),
  );

  BUTTONS.forEach(function (spec) {
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

  console.log("[Hydra] Navigation bar injected");
})();
