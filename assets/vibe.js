// Vibe for music.apple.com: a music chat with Claude in a side panel, opened
// from a button Hydra adds to Apple's player bar, beside Up Next, and from the
// top bar's Vibe item. This panel only shows the chat. Each turn runs in the
// main process (src/integrations/vibe/), which holds the API key; the panel
// sends messages on vibe:send and hears the reply, streamed, through
// window.__hydraVibe.update(). Claude's songs appear as rows: a row plays the
// set from that song, its menu offers Play next and Add to queue, and Play all
// plays the set. Claude never starts playback; only the user does, here.
//
// Claude looks songs up through window.__hydraVibe.search() and reads the
// recently played list through recent(), which the main process calls with
// executeJavaScript(): MusicKit's catalogue API only works in the page. The
// main process re-checks everything these functions return, since any script
// in the page could have replaced them.
//
// The panel copies Apple's Up Next drawer: fixed to the right edge, full
// height, Apple's glass over an opaque --pageBG, and the floating player moved
// clear of it by assets/vibe.css while data-hydra-vibe-open is on <html>. Only
// one drawer shows at a time: opening this one closes Apple's, and Apple's
// opening closes this one. Built like assets/songSearch.js: shadow roots,
// Apple's colour variables, every value written as text, and key events kept
// from Apple's shortcuts. Apple Music only: Classical is left alone.
(function () {
  if (window.location.hostname !== "music.apple.com") return;

  // src/main.ts fills this in at every injection: today's spend and the budget.
  /** @type {{ status: string, spent: string, budget: string }} */
  var SPEND = __HYDRA_VIBE_SPEND__;

  // src/main.ts runs this on every load and every in-page navigation. A repeat
  // run means an in-page navigation: the panel stays as it is, Apple's player
  // bar may have been drawn again, and the spend is current.
  if (window.__hydraVibe) {
    window.__hydraVibe.update(SPEND);
    window.__hydraVibe.refresh();
    return;
  }

  // loadAssets() in src/main.ts replaces VIBE_LABELS_TOKEN from src/i18n.ts with JSON.
  /** @type {{ vibe: string, placeholder: string, send: string, stop: string, newChat: string, close: string, empty: string, thinking: string, working: string, playAll: string, moreOptions: string, playNext: string, addToQueue: string, queuedNext: string, queuedLater: string, queueFailed: string, spend: string, openSettings: string, explicit: string, errors: Record<string, string> }} */
  var LABELS = __HYDRA_VIBE_LABELS__;

  /** Matches src/integrations/vibe/agent.ts MAX_PROMPT_LENGTH. */
  var MAX_PROMPT_LENGTH = 500;
  /** Results read from Apple for one search, before ranking. */
  var SEARCH_LIMIT = 10;
  /** Matches src/integrations/vibe/catalog.ts MAX_SEARCH_RESULTS. */
  var MAX_MATCHES = 3;
  /** Matches src/integrations/vibe/catalog.ts MAX_RECENT_TRACKS. */
  var RECENT_LIMIT = 20;
  /** Matches MAX_QUEUED_SONGS in assets/musicKitHook.js. */
  var MAX_QUEUED = 25;
  /** Artwork is drawn at 40px; twice that stays sharp at 200% zoom. */
  var ARTWORK_PX = 80;
  /** How long a queue notice stays under the field. */
  var NOTICE_MS = 2500;
  /** How often the player bar button is checked for, since Apple can draw the bar again. */
  var BUTTON_CHECK_MS = 1000;
  /** Errors that the user fixes in Settings. */
  var SETTINGS_ERRORS = { "no-key": true, "key-refused": true, "key-unreadable": true, budget: true };
  /** Set on <html> while Vibe is switched off; src/integrations/vibe/index.ts holds the name. */
  var OFF_ATTRIBUTE = "data-hydra-vibe-off";
  /** Set on <html> while the panel is open, for assets/vibe.css. */
  var OPEN_ATTRIBUTE = "data-hydra-vibe-open";
  var SVG_NS = "http://www.w3.org/2000/svg";

  // Apple's player and drawer draw var(--glassMaterialBackground), picked with
  // a theme class the shadow root cannot see, so the -onDark and -onLight
  // variants are taken through prefers-color-scheme, as the top bar does.
  var STYLE = [
    ":host { width: 360px; --glass: var(--glassMaterialBackground-onDark, rgba(38, 38, 40, 0.6));",
    "  --glass-shadow: var(--glassMaterialShadowColor-onDark, rgba(0, 0, 0, 0.2));",
    "  --glass-stroke: color-mix(in srgb, var(--glassMaterialInnerStroke-onDark, #fff) 20%, transparent); }",
    "@media (prefers-color-scheme: light) {",
    "  :host { --glass: var(--glassMaterialBackground-onLight, rgba(245, 245, 247, 0.55));",
    "    --glass-shadow: var(--glassMaterialShadowColor-onLight, rgba(0, 0, 0, 0.1));",
    "    --glass-stroke: color-mix(in srgb, var(--glassMaterialInnerStroke-onLight, #000) 5%, transparent); } }",
    "@media (max-width: 700px) { :host { width: 100vw; } }",
    ".panel { position: absolute; inset: 0; box-sizing: border-box; display: flex; flex-direction: column;",
    "  font-size: 13px; color: var(--systemPrimary, #ffffff);",
    "  background: linear-gradient(var(--glass), var(--glass)), var(--pageBG, #1f1f1f);",
    "  border-inline-start: 1px solid var(--glass-stroke); box-shadow: 0 10px 40px var(--glass-shadow); }",
    "button { margin: 0; font: inherit; color: inherit; cursor: pointer; border: 0; background: transparent; }",
    "button:focus-visible, .input:focus-visible { outline: 2px solid var(--keyColor, #fa586a); outline-offset: 2px; }",
    "button:disabled { cursor: default; opacity: 0.6; }",
    ".header { display: flex; align-items: center; gap: 4px; padding: 23px 12px 12px 20px; }",
    ".heading { flex: 1 1 auto; margin: 0; font: var(--title-2-emphasized, 700 17px/22px system-ui); }",
    ".icon { width: 28px; height: 28px; display: grid; place-items: center; border-radius: 6px;",
    "  font-size: 16px; line-height: 1; color: var(--systemSecondary, rgba(128, 128, 128, 0.9)); }",
    ".icon:hover { background: var(--systemQuaternary, rgba(128, 128, 128, 0.2)); }",
    ".log { flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 0 12px 12px; }",
    ".empty { padding: 32px 12px; text-align: center; line-height: 1.5;",
    "  color: var(--systemSecondary, rgba(128, 128, 128, 0.9)); }",
    ".msg { margin: 12px 0; }",
    ".msg.user { display: flex; justify-content: flex-end; }",
    ".bubble { max-width: 85%; padding: 8px 12px; border-radius: 14px; line-height: 1.4; white-space: pre-wrap;",
    "  overflow-wrap: anywhere; color: #ffffff; background: var(--keyColor, #fa586a); }",
    ".text p { margin: 0 0 8px; line-height: 1.45; white-space: pre-wrap; overflow-wrap: anywhere; }",
    ".text ul { margin: 0 0 8px; padding-inline-start: 18px; line-height: 1.45; }",
    ".songs { margin: 4px 0 10px; padding: 4px; border-radius: 10px;",
    "  background: color-mix(in srgb, var(--systemQuaternary, rgba(128, 128, 128, 0.2)) 45%, transparent); }",
    ".list { list-style: none; margin: 0; padding: 0; }",
    ".song { display: flex; align-items: flex-start; gap: 2px; border-radius: 6px; }",
    ".song:hover { background: var(--systemQuaternary, rgba(128, 128, 128, 0.2)); }",
    ".play-row { flex: 1 1 auto; min-width: 0; display: flex; align-items: flex-start; gap: 10px; padding: 6px;",
    "  text-align: start; border-radius: 6px; }",
    ".art { flex: none; width: 40px; height: 40px; border-radius: 4px; object-fit: cover;",
    "  background: var(--systemQuaternary, rgba(128, 128, 128, 0.2)); }",
    ".info { flex: 1 1 auto; min-width: 0; }",
    ".title { display: flex; align-items: center; gap: 6px; }",
    ".name, .artist { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }",
    ".artist { margin-top: 2px; color: var(--systemSecondary, rgba(128, 128, 128, 0.9)); }",
    ".reason { margin-top: 3px; line-height: 1.35; color: var(--systemSecondary, rgba(128, 128, 128, 0.9)); }",
    ".explicit { flex: none; padding: 2px 3px; border-radius: 2px; font-size: 9px; font-weight: 600;",
    "  line-height: 1; color: var(--pageBG, #1f1f1f); background: var(--systemSecondary, rgba(128, 128, 128, 0.9)); }",
    ".more { flex: none; margin-top: 12px; }",
    ".songs-footer { display: flex; padding: 4px 6px 2px; }",
    ".play-all { padding: 5px 12px; border-radius: 999px; font-weight: 600; color: #ffffff;",
    "  background: var(--keyColor, #fa586a); }",
    ".status { padding: 2px 0; font-size: 12px; color: var(--systemSecondary, rgba(128, 128, 128, 0.9)); }",
    ".error { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 2px 0;",
    "  color: var(--systemSecondary, rgba(128, 128, 128, 0.9)); }",
    ".settings { padding: 4px 10px; border-radius: 6px; color: var(--keyColor, #fa586a);",
    "  border: 1px solid var(--labelDivider, rgba(128, 128, 128, 0.3)); }",
    ".menu { position: fixed; z-index: 1; min-width: 170px; padding: 4px; border-radius: 8px;",
    "  background: var(--pageBG, #1f1f1f); border: 1px solid var(--labelDivider, rgba(128, 128, 128, 0.3));",
    "  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3); }",
    ".menu[hidden] { display: none; }",
    ".menu button { display: block; width: 100%; padding: 6px 10px; border-radius: 5px; text-align: start; }",
    ".menu button:hover, .menu button:focus { background: var(--systemQuaternary, rgba(128, 128, 128, 0.2)); outline: none; }",
    ".footer { padding: 10px 12px 12px; border-top: 1px solid var(--labelDivider, rgba(128, 128, 128, 0.3)); }",
    ".form { display: flex; align-items: flex-end; gap: 8px; }",
    ".input { flex: 1 1 auto; box-sizing: border-box; min-height: 36px; max-height: 120px; resize: none;",
    "  padding: 8px 12px; font: inherit; line-height: 1.4; color: inherit; background: transparent;",
    "  border: 1px solid var(--labelDivider, rgba(128, 128, 128, 0.3)); border-radius: 18px; outline: none; }",
    ".input:focus { border-color: var(--keyColor, #fa586a); }",
    ".input::placeholder { color: var(--systemTertiary, rgba(128, 128, 128, 0.8)); }",
    ".send { flex: none; width: 32px; height: 32px; margin-bottom: 2px; border-radius: 50%; font-size: 15px;",
    "  font-weight: 700; color: #ffffff; background: var(--keyColor, #fa586a); }",
    ".send.stop { color: var(--systemPrimary, #ffffff); background: var(--systemQuaternary, rgba(128, 128, 128, 0.2)); }",
    ".meta { display: flex; justify-content: space-between; gap: 8px; margin-top: 6px; font-size: 11px;",
    "  color: var(--systemTertiary, rgba(128, 128, 128, 0.8)); }",
  ].join("\n");

  // Apple's player bar buttons are 32 by 28 with a 4px radius, and fill their
  // icon with currentColor; an open drawer's button gets the platter colours.
  var BUTTON_STYLE = [
    ":host { display: flex; align-items: center; }",
    "button { width: var(--player-action-button-width, 32px); height: 28px; margin: 0; padding: 0;",
    "  display: grid; place-items: center; border: 0; border-radius: 4px; cursor: pointer;",
    "  color: inherit; background: transparent; }",
    "button[aria-expanded='true'] { color: var(--playerPlatterButtonIconFill, inherit);",
    "  background: var(--playerPlatterButtonBGFill, rgba(128, 128, 128, 0.25)); }",
    "button:focus-visible { outline: 2px solid var(--keyColor, #fa586a); outline-offset: 1px; }",
    "svg { width: 18px; height: 18px; fill: currentColor; }",
  ].join("\n");

  /** A turn is running in the main process. */
  var pending = false;
  var isOpen = false;
  /** @type {Element | null} Focused before the panel opened, refocused when it closes. */
  var returnFocus = null;
  /**
   * The reply being written: its element, the text segment new text joins,
   * and the status line kept last.
   * @type {{ root: HTMLElement, segment: { node: HTMLElement, text: string } | null, status: HTMLElement | null } | null}
   */
  var reply = null;
  /** @type {MutationObserver | null} Watches Apple's drawer while the panel is open. */
  var drawerWatch = null;
  /** @type {{ id: string, anchor: HTMLElement } | null} The row whose menu is open. */
  var menuFor = null;
  var noticeTimer = 0;

  /**
   * Create an element with attributes.
   * @param {string} tag - Element name
   * @param {Record<string, string>} attrs - Attributes
   * @returns {HTMLElement}
   */
  function el(tag, attrs) {
    var node = document.createElement(tag);
    for (var name in attrs) node.setAttribute(name, attrs[name]);
    return node;
  }

  /**
   * Fix a host to the page with inline !important rules, so nothing of Apple's
   * can move it.
   * @param {HTMLElement} node - The host
   * @param {Array<[string, string]>} rules - Property and value pairs
   * @returns {void}
   */
  function pin(node, rules) {
    rules.forEach(function (rule) {
      node.style.setProperty(rule[0], rule[1], "important");
    });
  }

  /**
   * The sparkle the top bar's Vibe item draws, filled as Apple's player icons are.
   * @returns {Element}
   */
  function sparkle() {
    if (typeof document.createElementNS !== "function") {
      var glyph = el("span", { "aria-hidden": "true" });
      glyph.textContent = "✦";
      return glyph;
    }
    var svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "3 2 19 19");
    svg.setAttribute("aria-hidden", "true");
    [
      "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z",
      "M18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z",
    ].forEach(function (d) {
      var path = document.createElementNS(SVG_NS, "path");
      path.setAttribute("d", d);
      svg.appendChild(path);
    });
    return svg;
  }

  var host = el("div", { id: "hydra-vibe" });
  pin(host, [
    ["display", "none"],
    ["position", "fixed"],
    ["top", "0"],
    ["bottom", "0"],
    ["right", "0"],
    // Apple's Up Next drawer sits at this level.
    ["z-index", "9902"],
  ]);
  var root = host.attachShadow({ mode: "open" });
  var style = el("style", {});
  style.textContent = STYLE;
  var panel = el("aside", { class: "panel", "aria-labelledby": "hydra-vibe-heading" });
  var header = el("div", { class: "header" });
  var heading = el("h3", { class: "heading", id: "hydra-vibe-heading" });
  heading.textContent = LABELS.vibe;
  var newChatButton = el("button", {
    class: "icon",
    type: "button",
    title: LABELS.newChat,
    "aria-label": LABELS.newChat,
  });
  newChatButton.textContent = "✎";
  var closeButton = el("button", {
    class: "icon",
    type: "button",
    title: LABELS.close,
    "aria-label": LABELS.close,
  });
  closeButton.textContent = "✕";
  header.appendChild(heading);
  header.appendChild(newChatButton);
  header.appendChild(closeButton);
  var log = el("div", { class: "log", role: "log", "aria-live": "polite" });
  var empty = el("div", { class: "empty" });
  empty.textContent = LABELS.empty;
  log.appendChild(empty);
  var footer = el("div", { class: "footer" });
  var form = el("div", { class: "form" });
  var input = el("textarea", {
    class: "input",
    rows: "1",
    maxlength: String(MAX_PROMPT_LENGTH),
    placeholder: LABELS.placeholder,
    "aria-label": LABELS.placeholder,
    spellcheck: "false",
  });
  var sendButton = el("button", { class: "send", type: "button" });
  form.appendChild(input);
  form.appendChild(sendButton);
  var meta = el("div", { class: "meta" });
  var notice = el("span", { class: "notice", role: "status" });
  var spendLine = el("span", { class: "spend" });
  meta.appendChild(notice);
  meta.appendChild(spendLine);
  footer.appendChild(form);
  footer.appendChild(meta);
  var menu = el("div", { class: "menu", role: "menu", hidden: "" });
  menu.hidden = true;
  var menuNext = el("button", { type: "button", role: "menuitem" });
  menuNext.textContent = LABELS.playNext;
  var menuLater = el("button", { type: "button", role: "menuitem" });
  menuLater.textContent = LABELS.addToQueue;
  menu.appendChild(menuNext);
  menu.appendChild(menuLater);
  panel.appendChild(header);
  panel.appendChild(log);
  panel.appendChild(footer);
  root.appendChild(style);
  root.appendChild(panel);
  root.appendChild(menu);

  var buttonHost = el("div", { id: "hydra-vibe-button" });
  pin(buttonHost, [["display", "flex"]]);
  var buttonRoot = buttonHost.attachShadow({ mode: "open" });
  var buttonStyle = el("style", {});
  buttonStyle.textContent = BUTTON_STYLE;
  var toggleButton = el("button", {
    type: "button",
    title: LABELS.vibe,
    "aria-label": LABELS.vibe,
    "aria-expanded": "false",
  });
  toggleButton.appendChild(sparkle());
  buttonRoot.appendChild(buttonStyle);
  buttonRoot.appendChild(toggleButton);

  /**
   * The hooked MusicKit instance, or null before the hook has attached.
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
   * Send to the main process, tolerating an absent bridge.
   * @param {string} channel - A vibe: or nav: channel
   * @param {unknown} [payload] - Its payload
   * @returns {boolean} Whether the bridge took it
   */
  function sendToMain(channel, payload) {
    var bridge = window.AMWrapper;
    if (!bridge || !bridge.ipcRenderer) return false;
    bridge.ipcRenderer.send(channel, payload);
    return true;
  }

  /**
   * Fold case, width and spacing, so two spellings of one name compare equal.
   * @param {unknown} text - A title or artist name
   * @returns {string}
   */
  function normalise(text) {
    return String(text || "").normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
  }

  /**
   * A sized artwork URL on Apple's image host, or "" for anything else.
   * @param {unknown} artwork - The song's artwork attribute
   * @returns {string}
   */
  function artworkUrl(artwork) {
    var template = artwork && artwork.url;
    if (typeof template !== "string") return "";
    try {
      var url = new URL(
        template.replace("{w}", String(ARTWORK_PX)).replace("{h}", String(ARTWORK_PX)),
      );
      return url.protocol === "https:" && /\.mzstatic\.com$/.test(url.hostname)
        ? url.href
        : "";
    } catch (_) {
      return "";
    }
  }

  /**
   * A name reduced to its letters and digits, so "Don't Stop" and "Dont
   * Stop!" compare equal.
   * @param {unknown} text - A title or artist name
   * @returns {string}
   */
  function bare(text) {
    return normalise(text)
      .replace(/['’]/g, "")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  }

  /**
   * The URL when it parses as https on Apple's image host, else "". Parsed
   * rather than matched, since "https://evil.example?.mzstatic.com/" looks
   * like Apple's host to a pattern but loads from evil.example.
   * @param {unknown} value - A URL from the main process
   * @returns {string}
   */
  function imageUrl(value) {
    if (typeof value !== "string") return "";
    try {
      var url = new URL(value);
      return url.protocol === "https:" && /\.mzstatic\.com$/.test(url.hostname)
        ? url.href
        : "";
    } catch (_) {
      return "";
    }
  }

  /**
   * How well a result matches the song asked for, or 0 when its title is a
   * different song. Apple ranks by popularity, so a famous song that merely
   * shares a word can come before the one Claude meant, and a search for a
   * song Apple lacks still answers with something; neither may reach Claude
   * as a match. A title that extends the one asked for ("No Idea (feat. X)")
   * still counts, below an exact one; the artist then breaks ties.
   * @param {{ title: string, artist: string }} song - A result
   * @param {string} artist - The artist asked for, bare
   * @param {string} title - The title asked for, bare
   * @returns {number}
   */
  function score(song, artist, title) {
    var name = bare(song.title);
    if (!title || !name) return 0;
    var points =
      name === title
        ? 4
        : name.indexOf(title) === 0
          ? 2
          : name.indexOf(title) !== -1 || title.indexOf(name) !== -1
            ? 1
            : 0;
    if (!points) return 0;
    if (artist && bare(song.artist).indexOf(artist) !== -1) points += 3;
    return points;
  }

  /**
   * Search the catalogue for one song: the best few matches, the explicit
   * version of a song first when Apple lists both. Called by the main process.
   * @param {unknown} artist - The artist's name
   * @param {unknown} title - The song title
   * @returns {Promise<Array<{ id: string, title: string, artist: string, album: string, explicit: boolean, artwork: string }>>}
   */
  function search(artist, title) {
    var mk = musicKit();
    if (!mk || !mk.api || typeof mk.api.music !== "function") {
      return Promise.reject(new Error("MusicKit is not ready"));
    }
    var wantedArtist = bare(artist);
    var wantedTitle = bare(title);
    var term = (String(artist || "") + " " + String(title || "")).trim().slice(0, 200);
    return Promise.resolve(
      mk.api.music("/v1/catalog/{{storefrontId}}/search", {
        term: term,
        types: "songs",
        limit: SEARCH_LIMIT,
      }),
    ).then(function (response) {
      var data =
        response &&
        response.data &&
        response.data.results &&
        response.data.results.songs &&
        response.data.results.songs.data;
      if (!Array.isArray(data)) return [];
      var found = [];
      data.forEach(function (item, index) {
        var a = item && item.attributes;
        if (
          !a ||
          !a.playParams ||
          typeof item.id !== "string" ||
          !/^\d{1,20}$/.test(item.id) ||
          typeof a.name !== "string"
        )
          return;
        found.push({
          id: item.id,
          title: a.name,
          artist: typeof a.artistName === "string" ? a.artistName : "",
          album: typeof a.albumName === "string" ? a.albumName : "",
          explicit: a.contentRating === "explicit",
          artwork: artworkUrl(a.artwork),
          order: index,
        });
      });
      found.forEach(function (song) {
        song.score = score(song, wantedArtist, wantedTitle);
        if (song.score && song.explicit) song.score += 0.5;
      });
      found = found.filter(function (song) {
        return song.score > 0;
      });
      found.sort(function (x, y) {
        return y.score - x.score || x.order - y.order;
      });
      return found.slice(0, MAX_MATCHES).map(function (song) {
        return {
          id: song.id,
          title: song.title,
          artist: song.artist,
          album: song.album,
          explicit: song.explicit,
          artwork: song.artwork,
        };
      });
    });
  }

  /**
   * The signed-in account's recently played songs, newest first, as artist
   * and title only, or none when signed out or unavailable. Called by the
   * main process, which falls back to the songs this session has played.
   * @returns {Promise<Array<{ artist: string, title: string }>>}
   */
  function recent() {
    var mk = musicKit();
    if (!mk || !mk.isAuthorized || !mk.api || typeof mk.api.music !== "function") {
      return Promise.resolve([]);
    }
    return Promise.resolve(
      mk.api.music("/v1/me/recent/played/tracks", { limit: RECENT_LIMIT }),
    ).then(
      function (response) {
        var data = response && response.data && response.data.data;
        if (!Array.isArray(data)) return [];
        var tracks = [];
        data.forEach(function (item) {
          var a = item && item.attributes;
          if (a && typeof a.name === "string") {
            tracks.push({
              artist: typeof a.artistName === "string" ? a.artistName : "",
              title: a.name,
            });
          }
        });
        return tracks;
      },
      function () {
        return [];
      },
    );
  }

  /** @returns {void} */
  function render() {
    sendButton.textContent = pending ? "■" : "↑";
    sendButton.setAttribute("class", pending ? "send stop" : "send");
    sendButton.setAttribute("aria-label", pending ? LABELS.stop : LABELS.send);
    sendButton.setAttribute("title", pending ? LABELS.stop : LABELS.send);
    toggleButton.setAttribute("aria-expanded", isOpen ? "true" : "false");
  }

  /** Keep the newest message in view while the user has not scrolled up. */
  function scrollToEnd() {
    var height = Number(log.scrollHeight) || 0;
    if (height - (Number(log.scrollTop) || 0) - (Number(log.clientHeight) || 0) < 80) {
      log.scrollTop = height;
    }
  }

  /**
   * Say something briefly under the field, such as a song being queued.
   * @param {string} text - The notice
   * @returns {void}
   */
  function showNotice(text) {
    notice.textContent = text;
    if (noticeTimer) clearTimeout(noticeTimer);
    noticeTimer = setTimeout(function () {
      notice.textContent = "";
      noticeTimer = 0;
    }, NOTICE_MS);
  }

  /**
   * Draw reply text as paragraphs, and lines starting "- ", "* ", "• " or a
   * number as a list, every piece as text. Claude is asked for plain text, so
   * Markdown's emphasis markers are dropped rather than drawn.
   * @param {HTMLElement} node - The segment's element
   * @param {string} text - The segment's text so far
   * @returns {void}
   */
  function renderText(node, text) {
    node.replaceChildren();
    text
      .replace(/\*\*|__/g, "")
      .split(/\n{2,}/)
      .forEach(function (block) {
        var paragraph = [];
        var list = null;
        var flush = function () {
          if (!paragraph.length) return;
          var p = el("p", {});
          p.textContent = paragraph.join("\n");
          node.appendChild(p);
          paragraph = [];
        };
        block.split("\n").forEach(function (line) {
          var item = /^\s*(?:[-*•]|\d{1,2}[.)])\s+(.*)$/.exec(line);
          if (item) {
            flush();
            if (!list) {
              list = el("ul", {});
              node.appendChild(list);
            }
            var li = el("li", {});
            li.textContent = item[1];
            list.appendChild(li);
          } else if (line.trim()) {
            list = null;
            paragraph.push(line);
          }
        });
        flush();
      });
  }

  /**
   * The reply being written, started when the first part of it arrives.
   * @returns {{ root: HTMLElement, segment: { node: HTMLElement, text: string } | null, status: HTMLElement | null }}
   */
  function currentReply() {
    if (!reply) {
      if (empty.isConnected) log.removeChild(empty);
      reply = { root: el("div", { class: "msg assistant" }), segment: null, status: null };
      log.appendChild(reply.root);
    }
    return reply;
  }

  /**
   * Put a part of the reply above its status line, which stays last.
   * @param {HTMLElement} node - The part
   * @returns {void}
   */
  function addToReply(node) {
    var current = currentReply();
    current.root.insertBefore(node, current.status);
    scrollToEnd();
  }

  /**
   * Show a status line under the reply, or with "" take it away.
   * @param {string} text - The line
   * @returns {void}
   */
  function setStatus(text) {
    var current = currentReply();
    if (!text) {
      if (current.status) current.root.removeChild(current.status);
      current.status = null;
      return;
    }
    if (!current.status) {
      current.status = el("div", { class: "status" });
      current.root.appendChild(current.status);
    }
    current.status.textContent = text;
    scrollToEnd();
  }

  /**
   * Add the user's message to the chat.
   * @param {string} text - The message
   * @returns {void}
   */
  function addUserMessage(text) {
    if (empty.isConnected) log.removeChild(empty);
    var row = el("div", { class: "msg user" });
    var bubble = el("div", { class: "bubble" });
    bubble.textContent = text;
    row.appendChild(bubble);
    log.appendChild(row);
    reply = null;
    log.scrollTop = Number(log.scrollHeight) || 0;
  }

  /**
   * Queue one song through the hook, telling the user how it went.
   * @param {"next" | "later"} where - After the current song, or at the end
   * @param {string} id - A catalogue song id
   * @returns {void}
   */
  function queueSong(where, id) {
    var call = where === "next" ? window.__hydraPlayNext : window.__hydraPlayLater;
    if (typeof call !== "function") {
      showNotice(LABELS.queueFailed);
      return;
    }
    Promise.resolve(call([id])).then(
      function (ok) {
        showNotice(
          ok === false ? LABELS.queueFailed : where === "next" ? LABELS.queuedNext : LABELS.queuedLater,
        );
      },
      function () {
        showNotice(LABELS.queueFailed);
      },
    );
  }

  /**
   * Play a set of songs from one of them, so Next carries on through the set.
   * @param {string[]} ids - The set's song ids
   * @param {number} index - The song to start from
   * @returns {void}
   */
  function playFrom(ids, index) {
    if (typeof window.__hydraPlaySongs !== "function" || !ids.length) return;
    Promise.resolve(window.__hydraPlaySongs(ids, index)).catch(function () {
      showNotice(LABELS.queueFailed);
    });
  }

  /**
   * Open a row's menu below its button.
   * @param {HTMLElement} anchor - The row's menu button
   * @param {string} id - The row's song id
   * @returns {void}
   */
  function openMenu(anchor, id) {
    menuFor = { id: id, anchor: anchor };
    var box = anchor.getBoundingClientRect();
    var width = 180;
    var viewport = Number(window.innerWidth) || 0;
    var left = Math.max(8, Math.min(box.right - width, viewport - width - 8));
    menu.style.setProperty("left", left + "px");
    menu.style.setProperty("top", box.bottom + 4 + "px");
    menu.hidden = false;
    menu.removeAttribute("hidden");
    anchor.setAttribute("aria-expanded", "true");
    menuNext.focus();
  }

  /**
   * Close the row menu, returning focus to its button when asked.
   * @param {boolean} refocus - Focus the row's menu button again
   * @returns {void}
   */
  function closeMenu(refocus) {
    if (!menuFor) return;
    var anchor = menuFor.anchor;
    menuFor = null;
    menu.hidden = true;
    menu.setAttribute("hidden", "");
    anchor.setAttribute("aria-expanded", "false");
    if (refocus) anchor.focus();
  }

  /**
   * One song row: a button that plays the set from this song, then a menu
   * button. Every value reaches the page as text, never as markup.
   * @param {{ id: string, title: string, artist: string, explicit: boolean, artwork: string, reason: string }} song
   * @param {string[]} ids - The set's song ids
   * @param {number} index - This song's place in the set
   * @returns {HTMLElement}
   */
  function createRow(song, ids, index) {
    var row = el("li", { class: "song" });
    var play = el("button", {
      class: "play-row",
      type: "button",
      "aria-label": String(song.title || "") + ", " + String(song.artist || ""),
    });
    var art = el("img", {
      class: "art",
      alt: "",
      width: "40",
      height: "40",
      loading: "lazy",
      draggable: "false",
    });
    var src = imageUrl(song.artwork);
    if (src) art.setAttribute("src", src);
    var info = el("div", { class: "info" });
    var title = el("div", { class: "title" });
    var name = el("span", { class: "name" });
    name.textContent = String(song.title || "");
    title.appendChild(name);
    if (song.explicit === true) {
      var badge = el("span", {
        class: "explicit",
        title: LABELS.explicit,
        "aria-label": LABELS.explicit,
      });
      badge.textContent = "E";
      title.appendChild(badge);
    }
    var by = el("div", { class: "artist" });
    by.textContent = String(song.artist || "");
    info.appendChild(title);
    info.appendChild(by);
    if (song.reason) {
      var reason = el("div", { class: "reason" });
      reason.textContent = String(song.reason);
      info.appendChild(reason);
    }
    play.appendChild(art);
    play.appendChild(info);
    play.addEventListener("click", function () {
      playFrom(ids, index);
    });
    var more = el("button", {
      class: "icon more",
      type: "button",
      title: LABELS.moreOptions,
      "aria-label": LABELS.moreOptions,
      "aria-haspopup": "menu",
      "aria-expanded": "false",
    });
    more.textContent = "…";
    more.addEventListener("click", function () {
      if (menuFor && menuFor.anchor === more) closeMenu(true);
      else {
        closeMenu(false);
        openMenu(more, ids[index]);
      }
    });
    // Keeps the panel's pointerdown, which closes an open menu, from closing
    // this one before its click reopens it.
    more.addEventListener("pointerdown", function (event) {
      event.stopPropagation();
    });
    row.appendChild(play);
    row.appendChild(more);
    return row;
  }

  /**
   * A set of songs Claude showed, with Play all.
   * @param {unknown[]} songs - The songs, as the main process checked them
   * @returns {HTMLElement | null}
   */
  function createSongs(songs) {
    var shown = songs
      .filter(function (song) {
        return song && typeof song.id === "string" && /^\d{1,20}$/.test(song.id);
      })
      .slice(0, MAX_QUEUED);
    if (!shown.length) return null;
    var ids = shown.map(function (song) {
      return song.id;
    });
    var block = el("div", { class: "songs" });
    var list = el("ul", { class: "list" });
    shown.forEach(function (song, index) {
      list.appendChild(createRow(song, ids, index));
    });
    var bottom = el("div", { class: "songs-footer" });
    var playAll = el("button", { class: "play-all", type: "button" });
    playAll.textContent = LABELS.playAll;
    playAll.addEventListener("click", function () {
      playFrom(ids, 0);
    });
    bottom.appendChild(playAll);
    block.appendChild(list);
    block.appendChild(bottom);
    return block;
  }

  /**
   * Show a turn's error under the reply, with Open Settings for errors fixed there.
   * @param {string} code - The error code
   * @returns {void}
   */
  function showError(code) {
    setStatus("");
    var line = el("div", { class: "error", role: "alert" });
    var text = el("span", {});
    text.textContent = LABELS.errors[code] || LABELS.errors.failed;
    line.appendChild(text);
    if (SETTINGS_ERRORS[code] === true) {
      var settings = el("button", { class: "settings", type: "button" });
      settings.textContent = LABELS.openSettings;
      settings.addEventListener("click", function () {
        sendToMain("nav:settings");
      });
      line.appendChild(settings);
    }
    addToReply(line);
  }

  /**
   * Hear how the turn is going. Called by the main process.
   * @param {any} state - A VibeUpdate from src/integrations/vibe/index.ts
   * @returns {void}
   */
  function update(state) {
    if (!state || typeof state !== "object") return;
    switch (state.status) {
      case "spend":
        spendLine.textContent = LABELS.spend
          .replace("{spent}", function () {
            return String(state.spent || "");
          })
          .replace("{budget}", function () {
            return String(state.budget || "");
          });
        return;
      case "working": {
        pending = true;
        render();
        var count = Number(state.searches) || 0;
        setStatus(
          count
            ? LABELS.working
                .replace("{count}", function () {
                  return String(count);
                })
                .replace("{max}", function () {
                  return String(Number(state.maxSearches) || 0);
                })
            : LABELS.thinking,
        );
        return;
      }
      case "text": {
        if (typeof state.text !== "string" || !state.text) return;
        var current = currentReply();
        if (!current.segment) {
          var node = el("div", { class: "text" });
          current.segment = { node: node, text: "" };
          addToReply(node);
        }
        current.segment.text += state.text;
        renderText(current.segment.node, current.segment.text);
        scrollToEnd();
        return;
      }
      case "songs": {
        if (!Array.isArray(state.songs)) return;
        var block = createSongs(state.songs);
        if (!block) return;
        currentReply().segment = null;
        addToReply(block);
        return;
      }
      case "done":
        if (reply) setStatus("");
        reply = null;
        pending = false;
        render();
        return;
      case "error":
        showError(String(state.code));
        reply = null;
        pending = false;
        render();
        return;
    }
  }

  /**
   * Send the message, or stop the running turn.
   * @returns {void}
   */
  function submit() {
    if (pending) {
      sendToMain("vibe:cancel");
      return;
    }
    var prompt = String(input.value || "").trim().slice(0, MAX_PROMPT_LENGTH);
    if (!prompt) {
      input.focus();
      return;
    }
    if (!sendToMain("vibe:send", { prompt: prompt })) {
      showError("failed");
      reply = null;
      return;
    }
    addUserMessage(prompt);
    input.value = "";
    // Shown until the main process answers with its own state.
    pending = true;
    render();
    setStatus(LABELS.thinking);
  }

  /**
   * Start over: the main process forgets the chat and stops a turn still running.
   * @returns {void}
   */
  function newChat() {
    sendToMain("vibe:new-chat");
    closeMenu(false);
    reply = null;
    pending = false;
    log.replaceChildren(empty);
    render();
    input.focus();
  }

  /**
   * Let the top bar (assets/topBar.js) mark Vibe as active while the panel is open.
   * @returns {void}
   */
  function notifyTopBar() {
    if (window.__hydraTopBar && typeof window.__hydraTopBar.refresh === "function") {
      window.__hydraTopBar.refresh();
    }
  }

  /**
   * Close Apple's Up Next or Lyrics drawer through its own button, so Apple's
   * state stays its own.
   * @returns {void}
   */
  function closeAppleDrawer() {
    var drawer = document.querySelector('[data-testid="side-panel"]');
    var id = drawer && drawer.getAttribute("id");
    if (!id || !/^[\w-]{1,64}$/.test(id)) return;
    var button = document.querySelector('[aria-controls="' + id + '"]');
    if (button && button.getAttribute("aria-expanded") === "true" && typeof button.click === "function") {
      button.click();
    }
  }

  /**
   * Close this panel when Apple opens its own drawer. Apple marks the app
   * container with is-drawer-open; only that one element's class is watched,
   * and only while the panel is open.
   * @returns {void}
   */
  function watchAppleDrawer() {
    var container = document.querySelector('[data-testid="app-container"]');
    if (!container || typeof MutationObserver !== "function") return;
    drawerWatch = new MutationObserver(function () {
      if (container.classList.contains("is-drawer-open")) close();
    });
    drawerWatch.observe(container, { attributes: true, attributeFilter: ["class"] });
  }

  /**
   * Open the panel, or refocus it when open.
   * @returns {void}
   */
  function open() {
    // Switched off in Settings (src/integrations/vibe/index.ts sets this).
    if (document.documentElement.hasAttribute(OFF_ATTRIBUTE)) return;
    if (!host.isConnected) (document.body || document.documentElement).appendChild(host);
    if (!isOpen) {
      closeAppleDrawer();
      isOpen = true;
      returnFocus = document.activeElement;
      host.style.setProperty("display", "block", "important");
      document.documentElement.setAttribute(OPEN_ATTRIBUTE, "");
      watchAppleDrawer();
      render();
      notifyTopBar();
    }
    input.focus();
  }

  /**
   * Hide the panel, keeping the chat for the next open; a running turn
   * carries on and its reply is there when the panel opens again.
   * @returns {void}
   */
  function close() {
    if (!isOpen) return;
    isOpen = false;
    closeMenu(false);
    if (drawerWatch) drawerWatch.disconnect();
    drawerWatch = null;
    host.style.setProperty("display", "none", "important");
    document.documentElement.removeAttribute(OPEN_ATTRIBUTE);
    render();
    notifyTopBar();
    var previous = returnFocus;
    returnFocus = null;
    if (previous && previous.isConnected && typeof previous.focus === "function") {
      previous.focus({ preventScroll: true });
    }
  }

  /** @returns {void} */
  function toggle() {
    if (isOpen) close();
    else open();
  }

  /**
   * Put the player bar button in front of Apple's Up Next button, or take it
   * away while Vibe is switched off. Apple can draw its player bar again, so
   * this runs every BUTTON_CHECK_MS and on every injection.
   * @returns {void}
   */
  function ensureButton() {
    if (document.documentElement.hasAttribute(OFF_ATTRIBUTE)) {
      if (buttonHost.parentNode) buttonHost.parentNode.removeChild(buttonHost);
      return;
    }
    var upNext = document.querySelector('[data-testid="up-next-button"]');
    var bar = upNext && upNext.parentElement;
    if (!bar) return;
    if (buttonHost.parentNode === bar && buttonHost.nextSibling === upNext) return;
    bar.insertBefore(buttonHost, upNext);
  }

  /**
   * Apply the Vibe setting and Apple's latest player bar. Called on every
   * injection and by src/integrations/vibe/index.ts when Settings changes.
   * @returns {void}
   */
  function refresh() {
    if (document.documentElement.hasAttribute(OFF_ATTRIBUTE)) close();
    ensureButton();
  }

  newChatButton.addEventListener("click", newChat);
  closeButton.addEventListener("click", close);
  sendButton.addEventListener("click", submit);
  toggleButton.addEventListener("click", toggle);
  menuNext.addEventListener("click", function () {
    var id = menuFor && menuFor.id;
    closeMenu(true);
    if (id) queueSong("next", id);
  });
  menuLater.addEventListener("click", function () {
    var id = menuFor && menuFor.id;
    closeMenu(true);
    if (id) queueSong("later", id);
  });
  // A press anywhere else in the panel closes the row menu.
  panel.addEventListener("pointerdown", function () {
    closeMenu(false);
  });
  log.addEventListener("scroll", function () {
    closeMenu(false);
  });

  panel.addEventListener("keydown", onKey);
  menu.addEventListener("keydown", onKey);

  /**
   * Keys in the panel and its row menu.
   * @param {KeyboardEvent} event - The key
   * @returns {void}
   */
  function onKey(event) {
    switch (event.key) {
      case "Escape":
        event.preventDefault();
        if (menuFor) closeMenu(true);
        else close();
        break;
      case "ArrowDown":
      case "ArrowUp":
        if (!menuFor) break;
        event.preventDefault();
        (root.activeElement === menuNext ? menuLater : menuNext).focus();
        break;
      case "Tab":
        if (menuFor) closeMenu(false);
        break;
      case "Enter":
        // Enter sends; Shift+Enter starts a new line. While a turn runs it
        // does nothing: only the Stop button stops it.
        if (root.activeElement !== input || event.shiftKey || event.isComposing) break;
        event.preventDefault();
        if (!pending) submit();
        break;
    }
  }

  // Apple's page shortcuts see a key typed here as one aimed at the host, not
  // at a text field, so a space could reach its play/pause handler.
  [host, buttonHost].forEach(function (node) {
    ["keydown", "keyup", "keypress"].forEach(function (type) {
      node.addEventListener(type, function (event) {
        event.stopPropagation();
      });
    });
  });

  render();
  update(SPEND);
  (document.body || document.documentElement).appendChild(host);
  ensureButton();
  if (typeof setInterval === "function") setInterval(ensureButton, BUTTON_CHECK_MS);

  window.__hydraVibe = {
    open: open,
    close: close,
    toggle: toggle,
    isOpen: function () {
      return isOpen;
    },
    refresh: refresh,
    search: search,
    recent: recent,
    update: update,
  };
})();
