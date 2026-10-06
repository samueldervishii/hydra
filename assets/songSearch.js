// Songs-first search for music.apple.com: Hydra's own panel, fed by the
// MusicKit catalogue API rather than by Apple's search page, so nothing here
// depends on Apple's markup or class names. Clicking a result queues every
// result, starting at that one, through window.__hydraPlaySongs() in
// assets/musicKitHook.js, without navigating. "All results in Apple Music"
// opens Apple's own search page for the same term.
//
// The panel lives in a shadow root, so Apple's stylesheets, Hydra's themes and
// Performance mode cannot reach its rules; it reads Apple's colour variables,
// which inherit into it, so it follows the light and dark schemes and the
// active theme. Its background is opaque and blurs nothing behind it. It opens
// from the collapsed sidebar's Search button (assets/navigationBar.js) and
// from Ctrl+K, which src/shortcuts.ts catches in the main process, because a
// focused iframe keeps keys from the page. Apple Music only: Classical is left
// alone.
(function () {
  if (window.location.hostname !== "music.apple.com") return;
  // src/main.ts runs this on every load and every in-page navigation. A repeat
  // run means the page navigated, so it closes the panel and adds nothing.
  if (window.__hydraSongSearch) {
    window.__hydraSongSearch.close();
    return;
  }

  // loadAssets() in src/main.ts replaces SEARCH_LABELS_TOKEN from src/i18n.ts with JSON.
  /** @type {{ search: string, searching: string, noResults: string, failed: string, allResults: string, explicit: string }} */
  var LABELS = __HYDRA_SEARCH_LABELS__;

  /** Apple's catalogue search returns at most 25 results of one type. */
  var MAX_RESULTS = 25;
  /** A longer term is cut, so a paste cannot send an oversized request. */
  var MAX_TERM_LENGTH = 200;
  /** Wait this long after the last keystroke before searching. */
  var DEBOUNCE_MS = 250;
  /** Artwork is drawn at 40px; twice that stays sharp at 200% zoom. */
  var ARTWORK_PX = 80;
  var LIST_ID = "hydra-song-search-results";
  var OPTION_ID = "hydra-song-search-option-";

  var STYLE = [
    ".backdrop { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.4); }",
    ".panel { position: fixed; top: 12vh; left: 50%; transform: translateX(-50%);",
    "  box-sizing: border-box; width: min(640px, calc(100vw - 32px)); max-height: 76vh;",
    "  display: flex; flex-direction: column; overflow: hidden; font-size: 13px;",
    "  background: var(--pageBG, #1f1f1f); color: var(--systemPrimary, #ffffff);",
    "  border: 1px solid var(--labelDivider, rgba(128, 128, 128, 0.3)); border-radius: 12px;",
    "  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.4); }",
    ".input { margin: 12px; padding: 10px 12px; font: inherit; font-size: 15px; color: inherit;",
    "  background: transparent; border: 1px solid var(--labelDivider, rgba(128, 128, 128, 0.3));",
    "  border-radius: 8px; outline: none; }",
    ".input:focus { border-color: var(--keyColor, #fa586a); }",
    ".input::placeholder { color: var(--systemTertiary, rgba(128, 128, 128, 0.8)); }",
    ".status { padding: 0 16px 12px; color: var(--systemSecondary, rgba(128, 128, 128, 0.9)); }",
    ".status:empty { display: none; }",
    ".results { list-style: none; margin: 0; padding: 0 6px 6px; flex: 1 1 auto; min-height: 0;",
    "  overflow-y: auto; overscroll-behavior: contain; }",
    ".results:empty { display: none; }",
    ".song { display: flex; align-items: center; gap: 10px; padding: 6px 8px; border-radius: 6px;",
    "  cursor: pointer; }",
    ".song[aria-selected='true'] { background: var(--systemQuaternary, rgba(128, 128, 128, 0.2)); }",
    ".art { flex: none; width: 40px; height: 40px; border-radius: 4px; object-fit: cover;",
    "  background: var(--systemQuaternary, rgba(128, 128, 128, 0.2)); }",
    ".text { flex: 1 1 auto; min-width: 0; }",
    ".title { display: flex; align-items: center; gap: 6px; }",
    ".name, .subtitle { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }",
    ".subtitle { margin-top: 2px; color: var(--systemSecondary, rgba(128, 128, 128, 0.9)); }",
    ".explicit { flex: none; padding: 2px 3px; border-radius: 2px; font-size: 9px; font-weight: 600;",
    "  line-height: 1; color: var(--pageBG, #1f1f1f);",
    "  background: var(--systemSecondary, rgba(128, 128, 128, 0.9)); }",
    ".time { flex: none; color: var(--systemSecondary, rgba(128, 128, 128, 0.9));",
    "  font-variant-numeric: tabular-nums; }",
    ".all { margin: 0; padding: 12px 16px; font: inherit; text-align: left; cursor: pointer;",
    "  color: var(--keyColor, #fa586a); background: transparent; border: 0;",
    "  border-top: 1px solid var(--labelDivider, rgba(128, 128, 128, 0.3)); }",
    ".all:hover, .all:focus-visible { outline: none;",
    "  background: var(--systemQuaternary, rgba(128, 128, 128, 0.2)); }",
  ].join("\n");

  /**
   * @typedef {{ id: string, name: string, artist: string, album: string,
   *   duration: string, artwork: string, explicit: boolean }} Song
   */

  /** @type {Song[]} The results on screen. */
  var songs = [];
  /** @type {HTMLElement[]} One row per song, in the same order. */
  var rows = [];
  /** Index of the highlighted row, or -1. */
  var active = -1;
  /** Advances with every change of term, so a slower, older answer is dropped. */
  var request = 0;
  /** The request whose answer is on screen. */
  var shownRequest = 0;
  /** Enter was pressed before the current term's answer arrived. */
  var playOnArrival = false;
  /** @type {number | null} */
  var timer = null;
  /** @type {Element | null} Focused before the panel opened, refocused when it closes. */
  var returnFocus = null;
  var isOpen = false;

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

  var host = el("div", { id: "hydra-song-search" });
  [
    ["display", "none"],
    ["position", "fixed"],
    ["inset", "0"],
    ["z-index", "2147483000"],
  ].forEach(function (rule) {
    host.style.setProperty(rule[0], rule[1], "important");
  });
  var root = host.attachShadow({ mode: "open" });
  var style = el("style", {});
  style.textContent = STYLE;
  var backdrop = el("div", { class: "backdrop" });
  var panel = el("div", {
    class: "panel",
    role: "dialog",
    "aria-modal": "true",
    "aria-label": LABELS.search,
  });
  var input = el("input", {
    class: "input",
    type: "search",
    role: "combobox",
    placeholder: LABELS.search,
    "aria-label": LABELS.search,
    "aria-autocomplete": "list",
    "aria-controls": LIST_ID,
    "aria-expanded": "false",
    autocomplete: "off",
    spellcheck: "false",
  });
  var status = el("div", { class: "status", role: "status", "aria-live": "polite" });
  var list = el("ul", {
    class: "results",
    id: LIST_ID,
    role: "listbox",
    "aria-label": LABELS.search,
  });
  var allResults = el("button", { class: "all", type: "button" });
  allResults.textContent = LABELS.allResults;
  panel.appendChild(input);
  panel.appendChild(status);
  panel.appendChild(list);
  panel.appendChild(allResults);
  root.appendChild(style);
  root.appendChild(backdrop);
  root.appendChild(panel);

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
   * The input's term, trimmed and cut to MAX_TERM_LENGTH.
   * @returns {string}
   */
  function currentTerm() {
    return String(input.value || "").trim().slice(0, MAX_TERM_LENGTH);
  }

  /**
   * Format a duration as m:ss, or h:mm:ss from an hour.
   * @param {unknown} ms - Duration in milliseconds
   * @returns {string}
   */
  function formatDuration(ms) {
    if (typeof ms !== "number" || !isFinite(ms) || ms <= 0) return "";
    var total = Math.round(ms / 1000);
    var h = Math.floor(total / 3600);
    var m = Math.floor((total % 3600) / 60);
    var s = total % 60;
    var ss = (s < 10 ? "0" : "") + s;
    return h ? h + ":" + (m < 10 ? "0" : "") + m + ":" + ss : m + ":" + ss;
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
   * Fold case, width and spacing, so two spellings of one name compare equal.
   * @param {string} text - A title, artist or album name
   * @returns {string}
   */
  function normalise(text) {
    return text.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
  }

  /**
   * One entry per track. Apple lists a track's explicit and clean versions as
   * two songs with the same title, artist and album; keep the explicit one, or
   * else the first, in the place the group first appeared. Titles are compared
   * whole, so a remix, live or sped-up version stays a song of its own.
   * @param {Song[]} found - Songs in Apple's order
   * @returns {Song[]}
   */
  function withoutDuplicates(found) {
    var kept = [];
    /** @type {Map<string, number>} Group key to its index in kept. */
    var groups = new Map();
    found.forEach(function (song) {
      var key = [song.name, song.artist, song.album].map(normalise).join("\u0000");
      var at = groups.get(key);
      if (at === undefined) {
        groups.set(key, kept.length);
        kept.push(song);
      } else if (song.explicit && !kept[at].explicit) {
        kept[at] = song;
      }
    });
    return kept;
  }

  /**
   * The playable songs in a catalogue search answer, at most MAX_RESULTS.
   * @param {any} response - The answer from mk.api.music()
   * @returns {Song[]}
   */
  function songsFrom(response) {
    var data =
      response &&
      response.data &&
      response.data.results &&
      response.data.results.songs &&
      response.data.results.songs.data;
    if (!Array.isArray(data)) return [];
    var found = [];
    for (var i = 0; i < data.length && found.length < MAX_RESULTS; i++) {
      var item = data[i];
      var a = item && item.attributes;
      if (
        !a ||
        !a.playParams ||
        typeof item.id !== "string" ||
        !/^\d{1,20}$/.test(item.id) ||
        typeof a.name !== "string"
      )
        continue;
      found.push({
        id: item.id,
        name: a.name,
        artist: typeof a.artistName === "string" ? a.artistName : "",
        album: typeof a.albumName === "string" ? a.albumName : "",
        duration: formatDuration(a.durationInMillis),
        artwork: artworkUrl(a.artwork),
        explicit: a.contentRating === "explicit",
      });
    }
    return withoutDuplicates(found);
  }

  /**
   * @param {string} text - Status line, or "" to hide it
   * @returns {void}
   */
  function setStatus(text) {
    status.textContent = text;
  }

  /**
   * Highlight one row and point the input's active descendant at it.
   * @param {number} index - Row index, or -1 for none
   * @param {boolean} reveal - Scroll the row into view
   * @returns {void}
   */
  function setActive(index, reveal) {
    if (rows[active]) rows[active].setAttribute("aria-selected", "false");
    active = index;
    var row = rows[active];
    if (!row) {
      input.removeAttribute("aria-activedescendant");
      return;
    }
    row.setAttribute("aria-selected", "true");
    input.setAttribute("aria-activedescendant", row.id);
    if (reveal && typeof row.scrollIntoView === "function") {
      row.scrollIntoView({ block: "nearest" });
    }
  }

  /**
   * One result row. Every value reaches the page as text, never as markup.
   * @param {Song} song - The song
   * @param {number} index - Its position in the results
   * @returns {HTMLElement}
   */
  function createRow(song, index) {
    var row = el("li", {
      class: "song",
      id: OPTION_ID + index,
      role: "option",
      "aria-selected": "false",
    });
    var art = el("img", {
      class: "art",
      alt: "",
      width: "40",
      height: "40",
      loading: "lazy",
      draggable: "false",
    });
    if (song.artwork) art.setAttribute("src", song.artwork);
    var text = el("div", { class: "text" });
    var title = el("div", { class: "title" });
    var name = el("span", { class: "name" });
    name.textContent = song.name;
    title.appendChild(name);
    if (song.explicit) {
      var badge = el("span", {
        class: "explicit",
        title: LABELS.explicit,
        "aria-label": LABELS.explicit,
      });
      badge.textContent = "E";
      title.appendChild(badge);
    }
    var subtitle = el("div", { class: "subtitle" });
    subtitle.textContent = [song.artist, song.album]
      .filter(function (part) {
        return part;
      })
      .join(" — ");
    text.appendChild(title);
    text.appendChild(subtitle);
    var time = el("div", { class: "time" });
    time.textContent = song.duration;
    row.appendChild(art);
    row.appendChild(text);
    row.appendChild(time);
    row.addEventListener("click", function () {
      play(index);
    });
    row.addEventListener("mouseenter", function () {
      setActive(index, false);
    });
    return row;
  }

  /**
   * Replace the results on screen, highlighting the first.
   * @param {Song[]} found - The songs to show
   * @returns {void}
   */
  function showSongs(found) {
    songs = found;
    rows = found.map(createRow);
    active = -1;
    list.replaceChildren.apply(list, rows);
    input.setAttribute("aria-expanded", rows.length ? "true" : "false");
    setActive(rows.length ? 0 : -1, false);
  }

  /**
   * Search the catalogue for songs, unless a newer term has replaced this one.
   * @param {string} term - The search term
   * @param {number} mine - The request this search answers
   * @returns {void}
   */
  function search(term, mine) {
    timer = null;
    var mk = musicKit();
    var answer;
    try {
      if (!mk || !mk.api || typeof mk.api.music !== "function") {
        throw new Error("MusicKit is not ready");
      }
      setStatus(LABELS.searching);
      answer = Promise.resolve(
        mk.api.music("/v1/catalog/{{storefrontId}}/search", {
          term: term,
          types: "songs",
          limit: MAX_RESULTS,
        }),
      );
    } catch (_) {
      answer = Promise.reject(new Error("search failed"));
    }
    answer.then(
      function (response) {
        if (mine !== request) return;
        shownRequest = mine;
        showSongs(songsFrom(response));
        setStatus(songs.length ? "" : LABELS.noResults);
        if (playOnArrival) {
          playOnArrival = false;
          play(active);
        }
      },
      function () {
        if (mine !== request) return;
        shownRequest = mine;
        playOnArrival = false;
        showSongs([]);
        setStatus(LABELS.failed);
        // The term is the user's own text, so it stays out of the log.
        console.warn("[Hydra] song search failed");
      },
    );
  }

  /**
   * Start a debounced search for the input's term. An empty term clears the
   * results at once.
   * @returns {void}
   */
  function onInput() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    playOnArrival = false;
    var mine = ++request;
    var term = currentTerm();
    if (!term) {
      shownRequest = mine;
      showSongs([]);
      setStatus("");
      return;
    }
    timer = setTimeout(function () {
      search(term, mine);
    }, DEBOUNCE_MS);
  }

  /**
   * Queue every result and start at one, then close the panel.
   * @param {number} index - The result to play first
   * @returns {void}
   */
  function play(index) {
    if (index < 0 || index >= songs.length) return;
    var playSongs = window.__hydraPlaySongs;
    if (typeof playSongs !== "function") {
      setStatus(LABELS.failed);
      return;
    }
    var ids = songs.map(function (song) {
      return song.id;
    });
    close();
    playSongs(ids, index);
  }

  /**
   * The storefront for Apple's search page: the first path segment when it is
   * one, otherwise MusicKit's, otherwise "us".
   * @returns {string}
   */
  function storefront() {
    var fromPath = window.location.pathname.split("/")[1] || "";
    if (/^[a-z]{2}$/.test(fromPath)) return fromPath;
    var mk = musicKit();
    var id = mk && mk.storefrontId;
    return typeof id === "string" && /^[a-z]{2}$/.test(id) ? id : "us";
  }

  /**
   * Open Apple's search page for the term in-app, so playback continues, the
   * way assets/navigationBar.js reaches a page without a link to click.
   * @returns {void}
   */
  function openAllResults() {
    var term = currentTerm();
    close();
    var path = "/" + storefront() + "/search";
    if (term) path += "?term=" + encodeURIComponent(term);
    window.history.pushState({}, "", path);
    window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }));
  }

  /**
   * Open the panel, or refocus it when open, with the term selected.
   * @returns {void}
   */
  function open() {
    if (!host.isConnected) (document.body || document.documentElement).appendChild(host);
    if (!isOpen) {
      isOpen = true;
      returnFocus = document.activeElement;
      host.style.setProperty("display", "block", "important");
    }
    input.focus();
    input.select();
  }

  /**
   * Hide the panel, keeping its term and results for the next open, and give
   * focus back to what had it.
   * @returns {void}
   */
  function close() {
    if (!isOpen) return;
    isOpen = false;
    playOnArrival = false;
    host.style.setProperty("display", "none", "important");
    var previous = returnFocus;
    returnFocus = null;
    if (previous && previous.isConnected && typeof previous.focus === "function") {
      previous.focus({ preventScroll: true });
    }
  }

  input.addEventListener("input", onInput);
  allResults.addEventListener("click", openAllResults);
  backdrop.addEventListener("click", close);

  panel.addEventListener("keydown", function (event) {
    var onInputField = root.activeElement === input;
    switch (event.key) {
      case "Escape":
        event.preventDefault();
        close();
        break;
      // The input and the All results button are the panel's only stops,
      // and focus stays inside it while it is open.
      case "Tab":
        event.preventDefault();
        (onInputField ? allResults : input).focus();
        break;
      case "ArrowDown":
      case "ArrowUp":
        if (!onInputField || !rows.length) break;
        event.preventDefault();
        setActive(
          event.key === "ArrowDown"
            ? Math.min(active + 1, rows.length - 1)
            : Math.max(active - 1, 0),
          true,
        );
        break;
      case "Enter":
        if (!onInputField) break;
        event.preventDefault();
        if (shownRequest === request) play(active);
        else playOnArrival = true;
        break;
    }
  });

  // Apple's page shortcuts see a key typed here as one aimed at the panel's
  // host, not at a text field, so a space could reach its play/pause handler.
  ["keydown", "keyup", "keypress"].forEach(function (type) {
    host.addEventListener(type, function (event) {
      event.stopPropagation();
    });
  });

  (document.body || document.documentElement).appendChild(host);

  window.__hydraSongSearch = { open: open, close: close };
})();
