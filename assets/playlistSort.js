// Sorting for playlist pages on music.apple.com, library and catalogue alike.
// Apple sorts its All Playlists grid but never a playlist's tracks, so this is
// Hydra's own: a toolbar above Apple's track list with a Sort button, and,
// while a sort other than the playlist's own order is chosen, a "Sorted by … ·
// Reset" line that says whose view it is and Hydra's list in place of Apple's.
// Apple's Play then plays that order. The toolbar is not in Apple's header:
// its Play and Shuffle sit in a grid of fixed columns, where another button
// lands on a line of its own, and the header's stacking keeps a menu opened
// there under the track list. The menu has a host of its own on <body>.
//
// Apple's list loads its rows in batches as the page scrolls and is laid out
// as a table, so it can be neither reordered nor relied on to hold every
// track. Hydra fetches the whole playlist through MusicKit instead, a hundred
// tracks a request, sorts it here, and draws only the rows in view, so a
// playlist of thousands costs no more on screen than one of twenty. Queueing
// goes through window.__hydraPlayTracks() in assets/musicKitHook.js; MusicKit
// keeps only one copy of a repeated song, so repeats are dropped first, keeping
// the copy the sorted list shows first.
//
// The choice is remembered per playlist: the page sends it on playlist:sort,
// src/config.ts keeps it, and src/main.ts hands the stored map back in at every
// injection. Nothing here logs a title, an artist or an id.
//
// Built like assets/songSearch.js: shadow roots, Apple's colour variables,
// every value written as text, keys kept from Apple's shortcuts. Apple Music
// only: Classical is left alone. The one rule that reaches Apple's page, hiding
// its track list while Hydra's shows, is in assets/playlistSort.css, gated on
// data-hydra-playlist-sorted on <html>.
(function () {
  if (window.location.hostname !== "music.apple.com") return;
  // src/main.ts fills this in at every injection with the stored sorts.
  /** @type {unknown} */
  var STORED = __HYDRA_PLAYLIST_SORTS__;
  // A repeat run means an in-page navigation: follow the new page. On an
  // in-page navigation src/rendererRefresh.ts makes the same call instead of
  // running the script again, so keep the two in step.
  if (window.__hydraPlaylistSort) {
    window.__hydraPlaylistSort.refresh(STORED);
    return;
  }

  // loadAssets() in src/main.ts replaces PLAYLIST_SORT_LABELS_TOKEN from src/i18n.ts with JSON.
  /** @type {Record<string, string>} */
  var LABELS = __HYDRA_PLAYLIST_SORT_LABELS__;

  /** Apple's own row height in its playlist track list. */
  var ROW_PX = 54;
  /** Rows drawn beyond the visible ones at each end, so a fast scroll shows no gap. */
  var OVERSCAN = 8;
  /** Tracks asked for per request; the most the API returns at once. */
  var PAGE_LIMIT = 100;
  /** The longest playlist sorted; MusicKit queues no more than this either. */
  var MAX_TRACKS = 10000;
  var MAX_PAGES = Math.ceil(MAX_TRACKS / PAGE_LIMIT) + 1;
  /** How often, and how long, to look for Apple's header and list after a navigation. */
  var ATTACH_POLL_MS = 250;
  var ATTACH_TIMEOUT_MS = 15000;
  /** How often to check that Apple has not re-rendered Hydra's controls away. */
  var KEEPALIVE_MS = 1000;
  /** Artwork is drawn at 40px; twice that stays sharp at 200% zoom. */
  var ARTWORK_PX = 80;
  var SORTED_ATTRIBUTE = "data-hydra-playlist-sorted";
  var KEYS = ["playlist", "title", "artist", "album", "duration"];
  /** A library (p.) or catalogue (pl.) playlist id; src/config.ts holds the same pattern. */
  var PLAYLIST_ID = /^(?:p|pl)\.[A-Za-z0-9._-]{1,100}$/;
  /** A catalogue song id, or a library one; the hook checks the same pattern. */
  var TRACK_ID = /^(?:\d{1,20}|i\.[A-Za-z0-9]{1,64})$/;
  var DEFAULT_SORT = { by: "playlist", dir: "asc" };
  var LIST_ID = "hydra-playlist-sort-rows";
  var OPTION_ID = "hydra-playlist-sort-row-";

  var STYLE = [
    ":host { all: initial; font: inherit; color: var(--systemPrimary, #ffffff); }",
    "button { margin: 0; font: inherit; color: inherit; cursor: pointer; border: 0; background: transparent; }",
    "button:focus-visible { outline: 2px solid var(--keyColor, #fa586a); outline-offset: 2px; }",
    ".toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px;",
    "  min-height: 44px; font-size: 13px; color: var(--systemSecondary, rgba(128, 128, 128, 0.9)); }",
    ".sort { display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 14px; margin-left: auto;",
    "  border-radius: 15px; font-size: 13px; font-weight: 600; color: var(--systemPrimary, #ffffff);",
    "  background: color-mix(in srgb, var(--systemPrimary, #ffffff) 10%, transparent); }",
    ".sort:hover { background: color-mix(in srgb, var(--systemPrimary, #ffffff) 16%, transparent); }",
    ".sort[aria-pressed='true'] { color: var(--keyColor, #fa586a); }",
    "svg { flex: none; width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 1.8;",
    "  stroke-linecap: round; stroke-linejoin: round; }",
    ".menu { display: none; position: fixed; min-width: 200px; padding: 6px;",
    "  box-sizing: border-box; border-radius: 10px; font-size: 13px; color: var(--systemPrimary, #ffffff);",
    "  background: linear-gradient(var(--glassMaterialBackground-onDark, rgba(38, 38, 40, 0.6)),",
    "    var(--glassMaterialBackground-onDark, rgba(38, 38, 40, 0.6))), var(--pageBG, #1f1f1f);",
    "  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3), inset 0 0 0 0.5px rgba(255, 255, 255, 0.2); }",
    "@media (prefers-color-scheme: light) { .menu {",
    "  background: linear-gradient(var(--glassMaterialBackground-onLight, rgba(245, 245, 247, 0.55)),",
    "    var(--glassMaterialBackground-onLight, rgba(245, 245, 247, 0.55))), var(--pageBG, #ffffff);",
    "  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.15), inset 0 0 0 0.5px rgba(0, 0, 0, 0.1); } }",
    ".menu.open { display: block; }",
    ".heading { padding: 4px 10px 6px; font-size: 11px; font-weight: 600;",
    "  color: var(--systemSecondary, rgba(128, 128, 128, 0.9)); }",
    ".item { display: flex; align-items: center; width: 100%; padding: 6px 10px 6px 28px;",
    "  border-radius: 6px; text-align: left; position: relative; }",
    ".item:hover, .item:focus { outline: none; background: var(--systemQuaternary, rgba(128, 128, 128, 0.2)); }",
    ".item[aria-checked='true']::before { content: ''; position: absolute; left: 10px; top: 50%;",
    "  width: 8px; height: 4px; margin-top: -4px; border: solid currentColor; border-width: 0 0 2px 2px;",
    "  transform: rotate(-45deg); }",
    ".separator { height: 1px; margin: 6px 4px; background: var(--labelDivider, rgba(128, 128, 128, 0.3)); }",
    ".indicator { display: flex; align-items: center; gap: 8px; min-width: 0; }",
    ".indicator[hidden] { display: none; }",
    ".indicator strong { color: var(--systemPrimary, #ffffff); font-weight: 600; }",
    ".reset { color: var(--keyColor, #fa586a); font-weight: 600; padding: 2px 4px; border-radius: 4px; }",
    ".status:empty { display: none; }",
    ".visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }",
    ".columns, .row { display: grid; align-items: center; column-gap: 16px;",
    "  grid-template-columns: minmax(0, 2.2fr) minmax(0, 1.4fr) minmax(0, 1.4fr) 56px; }",
    ".columns { height: 32px; padding: 0 12px; font-size: 12px;",
    "  color: var(--systemSecondary, rgba(128, 128, 128, 0.9));",
    "  border-bottom: 1px solid var(--labelDivider, rgba(128, 128, 128, 0.3)); }",
    ".columns .time, .row .time { text-align: right; font-variant-numeric: tabular-nums; }",
    ".viewport { position: relative; outline: none; }",
    ".viewport:focus-visible { outline: 2px solid var(--keyColor, #fa586a); outline-offset: 2px; }",
    ".row { position: absolute; left: 0; right: 0; box-sizing: border-box; height: " + ROW_PX + "px;",
    "  padding: 0 12px; font-size: 13px; border-radius: 6px; cursor: default; }",
    ".row { box-shadow: inset 0 -1px 0 var(--labelDivider, rgba(128, 128, 128, 0.3)); }",
    ".row:hover { background: var(--systemQuaternary, rgba(128, 128, 128, 0.2)); }",
    ".row[aria-selected='true'] { background: color-mix(in srgb, var(--keyColor, #fa586a) 28%, transparent); }",
    ".song { display: flex; align-items: center; gap: 12px; min-width: 0; }",
    ".art { position: relative; flex: none; width: 40px; height: 40px; border-radius: 4px; overflow: hidden;",
    "  background: var(--systemQuaternary, rgba(128, 128, 128, 0.2)); }",
    ".art img { width: 100%; height: 100%; object-fit: cover; display: block; }",
    ".play { position: absolute; inset: 0; display: none; align-items: center; justify-content: center;",
    "  color: #ffffff; background: rgba(0, 0, 0, 0.45); }",
    ".row:hover .play, .row[aria-selected='true'] .play { display: flex; }",
    ".play svg { width: 16px; height: 16px; fill: currentColor; stroke: none; }",
    ".name, .cell { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }",
    ".cell, .time { color: var(--systemSecondary, rgba(128, 128, 128, 0.9)); }",
    ".explicit { flex: none; margin-left: 6px; padding: 2px 3px; border-radius: 2px; font-size: 9px;",
    "  font-weight: 600; line-height: 1; color: var(--pageBG, #1f1f1f);",
    "  background: var(--systemSecondary, rgba(128, 128, 128, 0.9)); }",
    ".title { display: flex; align-items: center; min-width: 0; }",
  ].join("\n");

  /**
   * @typedef {{ by: string, dir: string }} Sort
   * @typedef {{ index: number, id: string, name: string, artist: string, album: string,
   *   duration: number, explicit: boolean, artwork: string, resource: object }} Track
   * @typedef {{ id: string, kind: string }} Route
   */

  /** @type {Record<string, Sort>} The stored sort per playlist id. */
  var sorts = readSorts(STORED);
  /**
   * The playlist page on screen, or null.
   * @type {{ route: Route, sort: Sort, tracks: Track[] | null, view: Track[] | null,
   *   loading: boolean, failed: boolean } | null}
   */
  var page = null;
  /** Advances whenever the page or its sort changes, so a stale fetch is dropped. */
  var generation = 0;
  var attachTimer = null;
  var attachStarted = 0;
  var keepAliveTimer = null;
  /** @type {Element | null} Apple's scrolling page, which Hydra's list scrolls with. */
  var scroller = null;
  var renderFrame = null;
  /** Rows drawn, as [first, last) indexes into the view. */
  var drawn = [0, 0];
  var active = -1;
  /** @type {Element | null} Focused before the menu opened. */
  var menuReturn = null;

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
   * An SVG icon from path data.
   * @param {string} d - Path data in a 24-unit box
   * @returns {Element}
   */
  function icon(d) {
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    var path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    svg.appendChild(path);
    return svg;
  }

  /**
   * A shadow-rooted host whose key events stay away from Apple's shortcuts,
   * as the song search's do: a space typed here would otherwise reach
   * Apple's play/pause.
   * @param {string} id - The host's id
   * @returns {{ host: HTMLElement, root: ShadowRoot }}
   */
  function shadowHost(id) {
    var host = el("div", { id: id });
    var root = host.attachShadow({ mode: "open" });
    var style = el("style", {});
    style.textContent = STYLE;
    root.appendChild(style);
    ["keydown", "keyup", "keypress"].forEach(function (type) {
      host.addEventListener(type, function (event) {
        event.stopPropagation();
      });
    });
    return { host: host, root: root };
  }

  // The Sort button's menu, in a host of its own on <body>, so nothing on the
  // page can paint over it.
  var menuLayer = shadowHost("hydra-playlist-sort-menu");
  ["position: fixed", "inset: 0 auto auto 0", "z-index: 2147483000"].forEach(function (rule) {
    var parts = rule.split(": ");
    menuLayer.host.style.setProperty(parts[0], parts[1], "important");
  });
  var sortButton = el("button", {
    class: "sort",
    type: "button",
    "aria-haspopup": "menu",
    "aria-expanded": "false",
    "aria-pressed": "false",
  });
  sortButton.appendChild(icon("M7 4v16M3 8l4-4 4 4M17 20V4M13 16l4 4 4-4"));
  var sortText = el("span", {});
  sortText.textContent = LABELS.sort;
  sortButton.appendChild(sortText);
  var menu = el("div", { class: "menu", role: "menu", "aria-label": LABELS.sort });
  /** @type {HTMLElement[]} */
  var menuItems = [];
  /** @type {Record<string, HTMLElement>} */
  var fieldItems = {};
  /** @type {Record<string, HTMLElement>} */
  var dirItems = {};
  var fieldLabels = {
    playlist: LABELS.playlistOrder,
    title: LABELS.title,
    artist: LABELS.artist,
    album: LABELS.album,
    duration: LABELS.duration,
  };
  KEYS.forEach(function (key) {
    var item = el("button", { class: "item", type: "button", role: "menuitemradio", tabindex: "-1" });
    item.textContent = fieldLabels[key];
    item.addEventListener("click", function () {
      if (page) choose({ by: key, dir: page.sort.dir });
    });
    fieldItems[key] = item;
    menuItems.push(item);
    menu.appendChild(item);
  });
  menu.appendChild(el("div", { class: "separator", role: "separator" }));
  ["asc", "desc"].forEach(function (dir) {
    var item = el("button", { class: "item", type: "button", role: "menuitemradio", tabindex: "-1" });
    item.textContent = dir === "asc" ? LABELS.ascending : LABELS.descending;
    item.addEventListener("click", function () {
      if (page) choose({ by: page.sort.by, dir: dir });
    });
    dirItems[dir] = item;
    menuItems.push(item);
    menu.appendChild(item);
  });
  menuLayer.root.appendChild(menu);

  // The toolbar, always above Apple's list on a playlist page, and Hydra's
  // list, in place of Apple's while a sort is chosen.
  var list = shadowHost("hydra-playlist-sort-list");
  list.host.style.setProperty("display", "block", "important");
  var toolbar = el("div", { class: "toolbar" });
  var indicator = el("div", { class: "indicator", role: "status", "aria-live": "polite" });
  var sortedBy = el("span", {});
  var direction = el("span", { "aria-hidden": "true" });
  var directionName = el("span", { class: "visually-hidden" });
  var statusText = el("span", { class: "status" });
  var resetButton = el("button", { class: "reset", type: "button" });
  resetButton.textContent = LABELS.reset;
  indicator.appendChild(sortedBy);
  indicator.appendChild(direction);
  indicator.appendChild(directionName);
  indicator.appendChild(statusText);
  indicator.appendChild(resetButton);
  var columns = el("div", { class: "columns", "aria-hidden": "true" });
  var columnCells = ["song", "artist", "album", "time"].map(function (name) {
    var cell = el("div", { class: name === "time" ? "time" : "cell" });
    columns.appendChild(cell);
    return cell;
  });
  var viewport = el("div", {
    class: "viewport",
    id: LIST_ID,
    role: "listbox",
    tabindex: "0",
  });
  toolbar.appendChild(indicator);
  toolbar.appendChild(sortButton);
  list.root.appendChild(toolbar);
  list.root.appendChild(columns);
  list.root.appendChild(viewport);

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
   * The stored sorts that are well formed, keyed by playlist id.
   * @param {unknown} value - The map src/main.ts injected
   * @returns {Record<string, Sort>}
   */
  function readSorts(value) {
    /** @type {Record<string, Sort>} */
    var out = {};
    if (!value || typeof value !== "object") return out;
    Object.keys(value).forEach(function (id) {
      var sort = value[id];
      if (PLAYLIST_ID.test(id) && isSort(sort) && !isDefault(sort)) {
        out[id] = { by: sort.by, dir: sort.dir };
      }
    });
    return out;
  }

  /**
   * @param {any} sort - A candidate sort
   * @returns {boolean}
   */
  function isSort(sort) {
    return !!sort && KEYS.indexOf(sort.by) !== -1 && (sort.dir === "asc" || sort.dir === "desc");
  }

  /**
   * @param {Sort} sort
   * @returns {boolean} Whether it is the playlist's own order, which Apple's list shows
   */
  function isDefault(sort) {
    return sort.by === "playlist" && sort.dir === "asc";
  }

  /**
   * The playlist a path shows: /<sf>/library/playlist/<id> for the library,
   * /<sf>/playlist/<slug>/<id> for the catalogue, or null for any other page.
   * @param {string} pathname - The page's path
   * @returns {Route | null}
   */
  function routeOf(pathname) {
    var match = /^\/(?:[a-z]{2}\/)?library\/playlist\/([^/?#]+)\/?$/.exec(pathname);
    var kind = "library";
    if (!match) {
      match = /^\/[a-z]{2}\/playlist\/[^/?#]+\/([^/?#]+)\/?$/.exec(pathname);
      kind = "catalog";
    }
    if (!match) return null;
    var id;
    try {
      id = decodeURIComponent(match[1]);
    } catch (_) {
      return null;
    }
    return PLAYLIST_ID.test(id) ? { id: id, kind: kind } : null;
  }

  /**
   * An artwork URL on Apple's image host at ARTWORK_PX, or "".
   * @param {any} artwork - A track's artwork attribute
   * @returns {string}
   */
  function artworkUrl(artwork) {
    var template = artwork && artwork.url;
    if (typeof template !== "string") return "";
    try {
      var url = new URL(
        template.replace("{w}", String(ARTWORK_PX)).replace("{h}", String(ARTWORK_PX)),
      );
      return url.protocol === "https:" && /\.mzstatic\.com$/.test(url.hostname) ? url.href : "";
    } catch (_) {
      return "";
    }
  }

  /**
   * A playable track from an API resource, or null.
   * @param {any} item - One entry of the API's data array
   * @param {number} index - Its place in the playlist
   * @returns {Track | null}
   */
  function trackFrom(item, index) {
    var a = item && item.attributes;
    if (
      !a ||
      typeof a !== "object" ||
      (item.type !== "songs" && item.type !== "library-songs") ||
      typeof item.id !== "string" ||
      !TRACK_ID.test(item.id) ||
      typeof a.name !== "string" ||
      !a.playParams
    )
      return null;
    return {
      index: index,
      id: item.id,
      name: a.name,
      artist: typeof a.artistName === "string" ? a.artistName : "",
      album: typeof a.albumName === "string" ? a.albumName : "",
      duration:
        typeof a.durationInMillis === "number" && isFinite(a.durationInMillis) && a.durationInMillis > 0
          ? a.durationInMillis
          : 0,
      explicit: a.contentRating === "explicit",
      artwork: artworkUrl(a.artwork),
      resource: item,
    };
  }

  /**
   * Fetch every track of a playlist, a page at a time, following the API's
   * next link, until the end or MAX_TRACKS. Rejects when the page or sort
   * has moved on, so a slow answer never lands on another playlist.
   * @param {Route} route - The playlist
   * @param {number} mine - The generation this fetch belongs to
   * @param {(loaded: number) => void} progress - Called after each page
   * @returns {Promise<Track[]>}
   */
  function fetchTracks(route, mine, progress) {
    var mk = musicKit();
    if (!mk || !mk.api || typeof mk.api.music !== "function") {
      return Promise.reject(new Error("MusicKit is not ready"));
    }
    var path =
      route.kind === "library"
        ? "/v1/me/library/playlists/" + encodeURIComponent(route.id) + "/tracks"
        : "/v1/catalog/{{storefrontId}}/playlists/" + encodeURIComponent(route.id) + "/tracks";
    /** @type {Track[]} */
    var tracks = [];
    var seen = 0;
    var pages = 0;
    /**
     * @param {string} next - The path to ask for
     * @param {object} query - Its query, the limit on the first request only
     * @returns {Promise<Track[]>}
     */
    function step(next, query) {
      pages += 1;
      return Promise.resolve(mk.api.music(next, query)).then(function (response) {
        if (mine !== generation) throw new Error("superseded");
        var body = response && response.data;
        var data = body && Array.isArray(body.data) ? body.data : [];
        for (var i = 0; i < data.length && tracks.length < MAX_TRACKS; i++) {
          var track = trackFrom(data[i], seen + i);
          if (track) tracks.push(track);
        }
        seen += data.length;
        progress(tracks.length);
        var link = body && body.next;
        if (
          typeof link === "string" &&
          link.indexOf("/v1/") === 0 &&
          data.length &&
          tracks.length < MAX_TRACKS &&
          pages < MAX_PAGES
        ) {
          return step(link, {});
        }
        return tracks;
      });
    }
    return step(path, { limit: PAGE_LIMIT });
  }

  var collator =
    typeof Intl !== "undefined" && Intl.Collator
      ? new Intl.Collator(undefined, { sensitivity: "base", numeric: true })
      : null;

  /**
   * The tracks in a sort's order. Ties, and tracks with no value for the
   * field, keep their playlist order, and the valueless ones go last in
   * either direction.
   * @param {Track[]} tracks - In playlist order
   * @param {Sort} sort - The sort
   * @returns {Track[]}
   */
  function sortTracks(tracks, sort) {
    var sign = sort.dir === "desc" ? -1 : 1;
    var field = { title: "name", artist: "artist", album: "album", duration: "duration" }[sort.by];
    return tracks.slice().sort(function (a, b) {
      if (!field) return sign * (a.index - b.index);
      var x = a[field];
      var y = b[field];
      var emptyX = field === "duration" ? !(x > 0) : x === "";
      var emptyY = field === "duration" ? !(y > 0) : y === "";
      if (emptyX || emptyY) return emptyX === emptyY ? a.index - b.index : emptyX ? 1 : -1;
      var order =
        field === "duration"
          ? x - y
          : collator
            ? collator.compare(x, y)
            : x < y
              ? -1
              : x > y
                ? 1
                : 0;
      return order ? sign * order : a.index - b.index;
    });
  }

  /**
   * Format a duration as m:ss, or h:mm:ss from an hour.
   * @param {number} ms - Duration in milliseconds
   * @returns {string}
   */
  function formatDuration(ms) {
    if (!(ms > 0)) return "";
    var total = Math.round(ms / 1000);
    var h = Math.floor(total / 3600);
    var m = Math.floor((total % 3600) / 60);
    var s = total % 60;
    var ss = (s < 10 ? "0" : "") + s;
    return h ? h + ":" + (m < 10 ? "0" : "") + m + ":" + ss : m + ":" + ss;
  }

  /**
   * Queue the sorted list and start at one of its rows. Repeats of a song
   * are dropped, keeping the one shown first, since MusicKit would otherwise
   * keep the last; a repeat's row starts at its kept copy.
   * @param {number} viewIndex - The row to start at
   * @returns {boolean} Whether the queue was handed to the hook
   */
  function playFrom(viewIndex) {
    var view = page && page.view;
    var play = window.__hydraPlayTracks;
    if (!view || !view.length || typeof play !== "function") return false;
    /** @type {object[]} */
    var items = [];
    /** @type {Record<string, number>} */
    var at = {};
    for (var i = 0; i < view.length; i++) {
      if (!Object.prototype.hasOwnProperty.call(at, view[i].id)) {
        at[view[i].id] = items.length;
        items.push(view[i].resource);
      }
    }
    var start = at[view[Math.max(0, Math.min(viewIndex, view.length - 1))].id];
    play(items, start);
    return true;
  }

  /**
   * Send the chosen sort to the main process to remember.
   * @param {string} id - The playlist
   * @param {Sort} sort - Its sort
   * @returns {void}
   */
  function remember(id, sort) {
    var bridge = window.AMWrapper;
    if (!bridge || !bridge.ipcRenderer) return;
    bridge.ipcRenderer.send("playlist:sort", { id: id, by: sort.by, dir: sort.dir });
  }

  /**
   * Put the toolbar and list into Apple's page, just above its track list,
   * once that exists. False until it does.
   * @returns {boolean}
   */
  function attach() {
    var tracklist = document.querySelector('[data-testid="tracklist"]');
    if (!tracklist || !tracklist.parentNode) return false;
    if (list.host.nextElementSibling !== tracklist) {
      tracklist.parentNode.insertBefore(list.host, tracklist);
    }
    alignWith(tracklist);
    if (!menuLayer.host.isConnected) (document.body || document.documentElement).appendChild(menuLayer.host);
    // Apple's own column names, already in Apple's language.
    var names = [
      ["song", LABELS.song],
      ["secondary", LABELS.artist],
      ["tertiary", LABELS.album],
      ["time", LABELS.time],
    ];
    names.forEach(function (pair, i) {
      var cell = document.querySelector('[data-testid="tracklist-column-header-' + pair[0] + '"]');
      var text = cell && cell.textContent ? cell.textContent.trim() : "";
      columnCells[i].textContent = text || pair[1];
    });
    var nextScroller = document.getElementById("scrollable-page");
    if (nextScroller !== scroller) {
      if (scroller) scroller.removeEventListener("scroll", scheduleRender);
      scroller = nextScroller;
      if (scroller) scroller.addEventListener("scroll", scheduleRender, { passive: true });
    }
    return true;
  }

  /**
   * Inset Hydra's toolbar and rows as Apple insets its list, so the columns
   * line up: Apple gives its list side margins of its own.
   * @param {Element} tracklist - Apple's track list
   * @returns {void}
   */
  function alignWith(tracklist) {
    if (typeof window.getComputedStyle !== "function") return;
    var style = window.getComputedStyle(tracklist);
    list.host.style.setProperty("margin-left", style.marginLeft, "important");
    list.host.style.setProperty("margin-right", style.marginRight, "important");
  }

  /**
   * Look for Apple's header and list until they are there, then show the
   * current state; Apple renders the page after the navigation that ran this.
   * @returns {void}
   */
  function startAttach() {
    stopAttach();
    attachStarted = Date.now();
    var tick = function () {
      if (!page) return stopAttach();
      if (attach()) {
        stopAttach();
        apply();
        return;
      }
      if (Date.now() - attachStarted > ATTACH_TIMEOUT_MS) stopAttach();
    };
    attachTimer = setInterval(tick, ATTACH_POLL_MS);
    tick();
  }

  /** @returns {void} */
  function stopAttach() {
    if (attachTimer !== null) clearInterval(attachTimer);
    attachTimer = null;
  }

  /**
   * Show the page's sort: the button's state, and Hydra's list or Apple's.
   * Apple's list stays until Hydra's has every track, so there is always a
   * list to play from.
   * @returns {void}
   */
  function apply() {
    if (!page) return;
    var sort = page.sort;
    var sorted = !isDefault(sort);
    sortButton.setAttribute("aria-pressed", sorted ? "true" : "false");
    KEYS.forEach(function (key) {
      fieldItems[key].setAttribute("aria-checked", key === sort.by ? "true" : "false");
    });
    dirItems.asc.setAttribute("aria-checked", sort.dir === "asc" ? "true" : "false");
    dirItems.desc.setAttribute("aria-checked", sort.dir === "desc" ? "true" : "false");
    if (!sorted) {
      document.documentElement.removeAttribute(SORTED_ATTRIBUTE);
      indicator.hidden = true;
      indicator.setAttribute("hidden", "");
      columns.style.setProperty("display", "none");
      viewport.style.setProperty("display", "none");
      viewport.replaceChildren();
      drawn = [0, 0];
      return;
    }
    indicator.hidden = false;
    indicator.removeAttribute("hidden");
    sortedBy.textContent = LABELS.sortedBy.replace("{field}", function () {
      return fieldLabels[sort.by];
    });
    direction.textContent = sort.dir === "asc" ? "↑" : "↓";
    directionName.textContent = sort.dir === "asc" ? LABELS.ascending : LABELS.descending;
    if (page.tracks) {
      page.view = sortTracks(page.tracks, sort);
      statusText.textContent = "";
      document.documentElement.setAttribute(SORTED_ATTRIBUTE, "");
      columns.style.removeProperty("display");
      viewport.style.removeProperty("display");
      drawn = [0, 0];
      render();
      return;
    }
    columns.style.setProperty("display", "none");
    viewport.style.setProperty("display", "none");
    document.documentElement.removeAttribute(SORTED_ATTRIBUTE);
    if (page.failed) {
      statusText.textContent = "· " + LABELS.failed;
      return;
    }
    load();
  }

  /**
   * Fetch the page's tracks once; apply() shows them when they arrive.
   * @returns {void}
   */
  function load() {
    if (!page || page.loading || page.tracks) return;
    var current = page;
    var mine = generation;
    current.loading = true;
    statusText.textContent = "· " + LABELS.loading.replace("{count}", "0");
    fetchTracks(current.route, mine, function (loaded) {
      if (mine === generation) statusText.textContent = "· " + LABELS.loading.replace("{count}", String(loaded));
    }).then(
      function (tracks) {
        current.loading = false;
        if (mine !== generation || page !== current) return;
        current.tracks = tracks;
        apply();
      },
      function () {
        current.loading = false;
        if (mine !== generation || page !== current) return;
        current.failed = true;
        // The playlist stays in its own words; only the fact is logged.
        console.warn("[Hydra] playlist tracks could not be loaded");
        apply();
      },
    );
  }

  /**
   * Choose a sort for the page, remember it and show it.
   * @param {Sort} sort - The new sort
   * @returns {void}
   */
  function choose(sort) {
    closeMenu(true);
    if (!page || !isSort(sort)) return;
    var id = page.route.id;
    if (isDefault(sort)) delete sorts[id];
    else sorts[id] = { by: sort.by, dir: sort.dir };
    page.sort = { by: sort.by, dir: sort.dir };
    page.failed = false;
    remember(id, page.sort);
    active = -1;
    viewport.removeAttribute("aria-activedescendant");
    apply();
  }

  /**
   * The rows in view, plus OVERSCAN at each end, as [first, last).
   * @param {number} total - Rows in the list
   * @returns {number[]}
   */
  function visibleRange(total) {
    var box = viewport.getBoundingClientRect();
    var top = 0;
    var bottom = window.innerHeight || 0;
    if (scroller) {
      var frame = scroller.getBoundingClientRect();
      top = frame.top;
      bottom = frame.bottom;
    }
    var first = Math.floor((top - box.top) / ROW_PX) - OVERSCAN;
    var last = Math.ceil((bottom - box.top) / ROW_PX) + OVERSCAN;
    first = Math.max(0, Math.min(total, first));
    last = Math.max(first, Math.min(total, last));
    return [first, last];
  }

  /**
   * One row. Every value reaches the page as text, never as markup.
   * @param {Track} track - The track
   * @param {number} i - Its index in the view
   * @param {number} total - Rows in the list
   * @returns {HTMLElement}
   */
  function createRow(track, i, total) {
    var row = el("div", {
      class: "row",
      id: OPTION_ID + i,
      role: "option",
      "aria-selected": i === active ? "true" : "false",
      "aria-posinset": String(i + 1),
      "aria-setsize": String(total),
    });
    row.style.top = i * ROW_PX + "px";
    var song = el("div", { class: "song" });
    var art = el("div", { class: "art" });
    if (track.artwork) {
      var img = el("img", { alt: "", loading: "lazy", draggable: "false" });
      img.setAttribute("src", track.artwork);
      art.appendChild(img);
    }
    var playButton = el("button", { class: "play", type: "button", tabindex: "-1", "aria-label": LABELS.play });
    playButton.appendChild(icon("M8 5v14l11-7z"));
    playButton.addEventListener("click", function (event) {
      event.stopPropagation();
      setActive(i, false);
      playFrom(i);
    });
    art.appendChild(playButton);
    var title = el("div", { class: "title" });
    var name = el("span", { class: "name" });
    name.textContent = track.name;
    title.appendChild(name);
    if (track.explicit) {
      var badge = el("span", { class: "explicit", title: LABELS.explicit, "aria-label": LABELS.explicit });
      badge.textContent = "E";
      title.appendChild(badge);
    }
    song.appendChild(art);
    song.appendChild(title);
    var artist = el("div", { class: "cell" });
    artist.textContent = track.artist;
    var album = el("div", { class: "cell" });
    album.textContent = track.album;
    var time = el("div", { class: "time" });
    time.textContent = formatDuration(track.duration);
    row.appendChild(song);
    row.appendChild(artist);
    row.appendChild(album);
    row.appendChild(time);
    row.addEventListener("click", function () {
      setActive(i, false);
    });
    row.addEventListener("dblclick", function () {
      setActive(i, false);
      playFrom(i);
    });
    return row;
  }

  /**
   * Draw the rows in view, and only those.
   * @returns {void}
   */
  function render() {
    renderFrame = null;
    var view = page && page.view;
    if (!view || !list.host.isConnected) return;
    viewport.style.height = view.length * ROW_PX + "px";
    var range = visibleRange(view.length);
    if (range[0] === drawn[0] && range[1] === drawn[1] && viewport.children.length === range[1] - range[0]) return;
    drawn = range;
    var rows = [];
    for (var i = range[0]; i < range[1]; i++) rows.push(createRow(view[i], i, view.length));
    viewport.replaceChildren.apply(viewport, rows);
  }

  /** @returns {void} */
  function scheduleRender() {
    if (renderFrame !== null) return;
    if (typeof requestAnimationFrame !== "function") {
      render();
      return;
    }
    renderFrame = requestAnimationFrame(render);
  }

  /**
   * Select a row, and bring it into view when asked.
   * @param {number} index - The row, or -1
   * @param {boolean} reveal - Scroll it into view
   * @returns {void}
   */
  function setActive(index, reveal) {
    var view = page && page.view;
    if (!view) return;
    active = Math.max(-1, Math.min(view.length - 1, index));
    if (active < 0) viewport.removeAttribute("aria-activedescendant");
    else viewport.setAttribute("aria-activedescendant", OPTION_ID + active);
    if (reveal && active >= 0 && scroller) {
      var box = viewport.getBoundingClientRect();
      var frame = scroller.getBoundingClientRect();
      var rowTop = box.top + active * ROW_PX;
      if (rowTop < frame.top) scroller.scrollTop -= frame.top - rowTop;
      else if (rowTop + ROW_PX > frame.bottom) scroller.scrollTop += rowTop + ROW_PX - frame.bottom;
    }
    drawn = [0, 0];
    render();
  }

  viewport.addEventListener("keydown", function (event) {
    var view = page && page.view;
    if (!view || !view.length) return;
    var pageRows = scroller ? Math.max(1, Math.floor(scroller.clientHeight / ROW_PX) - 1) : 10;
    var next = null;
    switch (event.key) {
      case "ArrowDown":
        next = active + 1;
        break;
      case "ArrowUp":
        next = Math.max(0, active - 1);
        break;
      case "PageDown":
        next = active + pageRows;
        break;
      case "PageUp":
        next = Math.max(0, active - pageRows);
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = view.length - 1;
        break;
      case "Enter":
        event.preventDefault();
        playFrom(active < 0 ? 0 : active);
        return;
      default:
        return;
    }
    event.preventDefault();
    setActive(next, true);
  });

  resetButton.addEventListener("click", function () {
    choose(DEFAULT_SORT);
  });

  /**
   * Open the Sort menu under its button, focusing the chosen field.
   * @returns {void}
   */
  function openMenu() {
    var box = sortButton.getBoundingClientRect();
    menu.style.top = Math.round(box.bottom + 6) + "px";
    menu.style.left = Math.round(box.left) + "px";
    menu.setAttribute("class", "menu open");
    sortButton.setAttribute("aria-expanded", "true");
    menuReturn = sortButton;
    var chosen = page ? fieldItems[page.sort.by] : menuItems[0];
    chosen.focus();
    document.addEventListener("pointerdown", onOutsidePress, true);
  }

  /**
   * @param {boolean} refocus - Give focus back to the Sort button
   * @returns {void}
   */
  function closeMenu(refocus) {
    if (sortButton.getAttribute("aria-expanded") !== "true") return;
    menu.setAttribute("class", "menu");
    sortButton.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", onOutsidePress, true);
    if (refocus && menuReturn && typeof menuReturn.focus === "function") menuReturn.focus();
    menuReturn = null;
  }

  /**
   * Close the menu on a press anywhere but on it or its button.
   * @param {Event} event
   * @returns {void}
   */
  function onOutsidePress(event) {
    // A press on the menu or on the Sort button is the menu's own business.
    var path = typeof event.composedPath === "function" ? event.composedPath() : [event.target];
    if (path.indexOf(menu) !== -1 || path.indexOf(sortButton) !== -1) return;
    closeMenu(false);
  }

  sortButton.addEventListener("click", function () {
    if (sortButton.getAttribute("aria-expanded") === "true") closeMenu(true);
    else openMenu();
  });

  menu.addEventListener("keydown", function (event) {
    var at = menuItems.indexOf(menuLayer.root.activeElement);
    var next = null;
    switch (event.key) {
      case "ArrowDown":
        next = (at + 1) % menuItems.length;
        break;
      case "ArrowUp":
        next = (at - 1 + menuItems.length) % menuItems.length;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = menuItems.length - 1;
        break;
      case "Escape":
        event.preventDefault();
        closeMenu(true);
        return;
      case "Tab":
        closeMenu(false);
        return;
      default:
        return;
    }
    event.preventDefault();
    menuItems[next].focus();
  });

  /**
   * While a sort shows, Apple's own Play button plays Hydra's order. Only
   * that button, in Apple's header, and only once Hydra's list has every
   * track; otherwise Apple's Play does what it always does.
   * @param {Event} event - A click, in the capture phase
   * @returns {void}
   */
  function onCaptureClick(event) {
    if (!page || !page.view || isDefault(page.sort)) return;
    var target = event.target;
    if (!target || typeof target.closest !== "function") return;
    var button = target.closest("button");
    if (!button || !button.closest('[data-testid="container-detail-header"]')) return;
    if (!button.querySelector('[data-testid="play-icon"]')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    playFrom(0);
  }

  /**
   * Leave the playlist page: forget its state and take Hydra's parts out.
   * @returns {void}
   */
  function detach() {
    generation += 1;
    stopAttach();
    closeMenu(false);
    page = null;
    active = -1;
    drawn = [0, 0];
    document.documentElement.removeAttribute(SORTED_ATTRIBUTE);
    if (list.host.parentNode) list.host.parentNode.removeChild(list.host);
    if (menuLayer.host.parentNode) menuLayer.host.parentNode.removeChild(menuLayer.host);
    viewport.replaceChildren();
    if (scroller) scroller.removeEventListener("scroll", scheduleRender);
    scroller = null;
  }

  /**
   * Follow the page: a new playlist starts afresh with its stored sort; the
   * same one keeps its tracks and puts back anything Apple re-rendered away.
   * @param {unknown} [stored] - The stored sorts, from a repeat injection or the in-page refresh
   * @returns {void}
   */
  function refresh(stored) {
    if (stored !== undefined) sorts = readSorts(stored);
    var route = routeOf(window.location.pathname);
    if (!route) {
      if (page) detach();
      return;
    }
    if (!page || page.route.id !== route.id) {
      if (page) detach();
      generation += 1;
      page = {
        route: route,
        sort: sorts[route.id] || { by: DEFAULT_SORT.by, dir: DEFAULT_SORT.dir },
        tracks: null,
        view: null,
        loading: false,
        failed: false,
      };
    }
    startAttach();
  }

  /**
   * Apple re-renders its header and list as the page updates; put Hydra's
   * parts back when they have gone.
   * @returns {void}
   */
  function keepAlive() {
    if (!page || attachTimer !== null) return;
    if (!list.host.isConnected) {
      if (attach()) apply();
    } else if (!isDefault(page.sort)) {
      scheduleRender();
    }
  }

  window.addEventListener("click", onCaptureClick, true);
  window.addEventListener(
    "resize",
    function () {
      var tracklist = document.querySelector('[data-testid="tracklist"]');
      if (page && tracklist) alignWith(tracklist);
      scheduleRender();
    },
    { passive: true },
  );
  keepAliveTimer = setInterval(keepAlive, KEEPALIVE_MS);

  window.__hydraPlaylistSort = {
    refresh: refresh,
    /** The sort and track count on screen, for tests and diagnostics: no titles. */
    state: function () {
      return page
        ? {
            kind: page.route.kind,
            sort: { by: page.sort.by, dir: page.sort.dir },
            tracks: page.tracks ? page.tracks.length : null,
            drawn: drawn.slice(),
          }
        : null;
    },
  };
  refresh();
})();
