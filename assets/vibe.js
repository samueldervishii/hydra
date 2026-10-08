// Vibe for music.apple.com: describe a mood and Claude queues songs for it,
// each with a one-line reason. This panel only collects the description and
// shows the outcome. The request runs in the main process
// (src/integrations/vibe/), which holds the API key; the panel sends it on
// vibe:request and hears back through window.__hydraVibe.update().
//
// Claude looks songs up through window.__hydraVibe.search(), which the main
// process calls with executeJavaScript(): MusicKit's catalogue API only works
// in the page. The main process re-checks everything these functions return,
// since any script in the page could have replaced them.
//
// Built like assets/songSearch.js: a shadow root, Apple's colour variables, an
// opaque panel, every value written as text, and key events kept from Apple's
// shortcuts. Apple Music only: Classical is left alone.
(function () {
  if (window.location.hostname !== "music.apple.com") return;
  // src/main.ts runs this on every load and every in-page navigation. A repeat
  // run means the page navigated, so it closes the panel and adds nothing.
  if (window.__hydraVibe) {
    window.__hydraVibe.close();
    return;
  }

  // loadAssets() in src/main.ts replaces VIBE_LABELS_TOKEN from src/i18n.ts with JSON.
  /** @type {{ vibe: string, placeholder: string, playNext: string, replaceQueue: string, submit: string, cancel: string, working: string, openSettings: string, queuedNext: string, queuedReplace: string, queueFailed: string, explicit: string, errors: Record<string, string> }} */
  var LABELS = __HYDRA_VIBE_LABELS__;

  /** Matches src/integrations/vibe/agent.ts MAX_PROMPT_LENGTH. */
  var MAX_PROMPT_LENGTH = 500;
  /** Results read from Apple for one search, before ranking. */
  var SEARCH_LIMIT = 10;
  /** Matches src/integrations/vibe/catalog.ts MAX_SEARCH_RESULTS. */
  var MAX_MATCHES = 3;
  /** Matches src/integrations/vibe/catalog.ts MAX_RECENT_TRACKS. */
  var RECENT_LIMIT = 20;
  /** Artwork is drawn at 40px; twice that stays sharp at 200% zoom. */
  var ARTWORK_PX = 80;
  /** Errors that the user fixes in Settings. */
  var SETTINGS_ERRORS = { "no-key": true, "key-refused": true, "key-unreadable": true };

  var STYLE = [
    ".backdrop { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.4); }",
    ".panel { position: fixed; top: 12vh; left: 50%; transform: translateX(-50%);",
    "  box-sizing: border-box; width: min(600px, calc(100vw - 32px)); max-height: 76vh;",
    "  display: flex; flex-direction: column; overflow: hidden; font-size: 13px;",
    "  background: var(--pageBG, #1f1f1f); color: var(--systemPrimary, #ffffff);",
    "  border: 1px solid var(--labelDivider, rgba(128, 128, 128, 0.3)); border-radius: 12px;",
    "  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.4); }",
    ".form { display: flex; flex-direction: column; gap: 10px; padding: 12px; }",
    ".input { box-sizing: border-box; width: 100%; min-height: 64px; resize: none; padding: 10px 12px;",
    "  font: inherit; font-size: 15px; line-height: 1.4; color: inherit; background: transparent;",
    "  border: 1px solid var(--labelDivider, rgba(128, 128, 128, 0.3)); border-radius: 8px; outline: none; }",
    ".input:focus { border-color: var(--keyColor, #fa586a); }",
    ".input::placeholder { color: var(--systemTertiary, rgba(128, 128, 128, 0.8)); }",
    ".input:disabled { opacity: 0.6; }",
    ".actions { display: flex; align-items: center; justify-content: space-between; gap: 10px; }",
    ".modes { display: flex; padding: 2px; border-radius: 8px;",
    "  background: var(--systemQuaternary, rgba(128, 128, 128, 0.2)); }",
    "button { margin: 0; font: inherit; color: inherit; cursor: pointer; border: 0; }",
    "button:focus-visible { outline: 2px solid var(--keyColor, #fa586a); outline-offset: 2px; }",
    "button:disabled { cursor: default; opacity: 0.6; }",
    ".mode { padding: 5px 10px; border-radius: 6px; background: transparent;",
    "  color: var(--systemSecondary, rgba(128, 128, 128, 0.9)); }",
    ".mode[aria-checked='true'] { color: var(--systemPrimary, #ffffff); background: var(--pageBG, #1f1f1f); }",
    ".go { padding: 7px 14px; border-radius: 8px; font-weight: 600; color: #ffffff;",
    "  background: var(--keyColor, #fa586a); }",
    ".go.cancel { color: inherit; background: var(--systemQuaternary, rgba(128, 128, 128, 0.2)); }",
    ".status { display: flex; align-items: center; gap: 10px; padding: 0 16px 12px;",
    "  color: var(--systemSecondary, rgba(128, 128, 128, 0.9)); }",
    ".status[hidden] { display: none; }",
    ".settings { padding: 4px 10px; border-radius: 6px; color: var(--keyColor, #fa586a);",
    "  background: transparent; border: 1px solid var(--labelDivider, rgba(128, 128, 128, 0.3)); }",
    ".heading { padding: 10px 16px 4px; font-weight: 600;",
    "  border-top: 1px solid var(--labelDivider, rgba(128, 128, 128, 0.3)); }",
    ".heading:empty { display: none; }",
    ".results { list-style: none; margin: 0; padding: 0 6px 6px; flex: 1 1 auto; min-height: 0;",
    "  overflow-y: auto; overscroll-behavior: contain; }",
    ".results:empty { display: none; }",
    ".song { display: flex; align-items: flex-start; gap: 10px; padding: 6px 8px; border-radius: 6px; }",
    ".art { flex: none; width: 40px; height: 40px; border-radius: 4px; object-fit: cover;",
    "  background: var(--systemQuaternary, rgba(128, 128, 128, 0.2)); }",
    ".text { flex: 1 1 auto; min-width: 0; }",
    ".title { display: flex; align-items: center; gap: 6px; }",
    ".name, .artist { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }",
    ".artist { margin-top: 2px; color: var(--systemSecondary, rgba(128, 128, 128, 0.9)); }",
    ".reason { margin-top: 3px; line-height: 1.35; color: var(--systemSecondary, rgba(128, 128, 128, 0.9)); }",
    ".explicit { flex: none; padding: 2px 3px; border-radius: 2px; font-size: 9px; font-weight: 600;",
    "  line-height: 1; color: var(--pageBG, #1f1f1f);",
    "  background: var(--systemSecondary, rgba(128, 128, 128, 0.9)); }",
  ].join("\n");

  /** @type {"next" | "replace"} Where the songs go: after the current one, or instead of the queue. */
  var mode = "next";
  /** A request is running in the main process. */
  var pending = false;
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

  var host = el("div", { id: "hydra-vibe" });
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
    "aria-label": LABELS.vibe,
  });
  var form = el("div", { class: "form" });
  var input = el("textarea", {
    class: "input",
    rows: "2",
    maxlength: String(MAX_PROMPT_LENGTH),
    placeholder: LABELS.placeholder,
    "aria-label": LABELS.vibe,
    spellcheck: "false",
  });
  var actions = el("div", { class: "actions" });
  var modes = el("div", { class: "modes", role: "radiogroup", "aria-label": LABELS.vibe });
  var modeButtons = {
    next: el("button", { class: "mode", type: "button", role: "radio" }),
    replace: el("button", { class: "mode", type: "button", role: "radio" }),
  };
  modeButtons.next.textContent = LABELS.playNext;
  modeButtons.replace.textContent = LABELS.replaceQueue;
  modes.appendChild(modeButtons.next);
  modes.appendChild(modeButtons.replace);
  var go = el("button", { class: "go", type: "button" });
  actions.appendChild(modes);
  actions.appendChild(go);
  form.appendChild(input);
  form.appendChild(actions);
  var status = el("div", { class: "status", role: "status", "aria-live": "polite" });
  var statusText = el("span", {});
  var settingsButton = el("button", { class: "settings", type: "button" });
  settingsButton.textContent = LABELS.openSettings;
  status.appendChild(statusText);
  status.appendChild(settingsButton);
  var heading = el("div", { class: "heading" });
  var list = el("ul", { class: "results", "aria-label": LABELS.vibe });
  panel.appendChild(form);
  panel.appendChild(status);
  panel.appendChild(heading);
  panel.appendChild(list);
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
   * Send to the main process, tolerating an absent bridge.
   * @param {string} channel - A vibe: channel
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
      .replace(/['\u2019]/g, "")
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

  /**
   * Show a line under the form, with the Settings button for errors fixed there.
   * @param {string} text - The line, or "" to hide it
   * @param {boolean} [settings] - Offer Open Settings
   * @returns {void}
   */
  function setStatus(text, settings) {
    statusText.textContent = text;
    status.hidden = !text;
    settingsButton.hidden = !settings;
  }

  /** @returns {void} */
  function render() {
    modeButtons.next.setAttribute("aria-checked", mode === "next" ? "true" : "false");
    modeButtons.replace.setAttribute("aria-checked", mode === "replace" ? "true" : "false");
    modeButtons.next.disabled = pending;
    modeButtons.replace.disabled = pending;
    input.disabled = pending;
    go.textContent = pending ? LABELS.cancel : LABELS.submit;
    go.setAttribute("class", pending ? "go cancel" : "go");
  }

  /**
   * One result row. Every value reaches the page as text, never as markup.
   * @param {{ title: string, artist: string, explicit: boolean, artwork: string, reason: string }} pick
   * @returns {HTMLElement}
   */
  function createRow(pick) {
    var row = el("li", { class: "song" });
    var art = el("img", {
      class: "art",
      alt: "",
      width: "40",
      height: "40",
      loading: "lazy",
      draggable: "false",
    });
    var src = imageUrl(pick.artwork);
    if (src) art.setAttribute("src", src);
    var text = el("div", { class: "text" });
    var title = el("div", { class: "title" });
    var name = el("span", { class: "name" });
    name.textContent = String(pick.title || "");
    title.appendChild(name);
    if (pick.explicit === true) {
      var badge = el("span", {
        class: "explicit",
        title: LABELS.explicit,
        "aria-label": LABELS.explicit,
      });
      badge.textContent = "E";
      title.appendChild(badge);
    }
    var by = el("div", { class: "artist" });
    by.textContent = String(pick.artist || "");
    text.appendChild(title);
    text.appendChild(by);
    if (pick.reason) {
      var reason = el("div", { class: "reason" });
      reason.textContent = String(pick.reason);
      text.appendChild(reason);
    }
    row.appendChild(art);
    row.appendChild(text);
    return row;
  }

  /**
   * Queue the picks the way the request asked, then list them with their reasons.
   * @param {"next" | "replace"} queueMode - Where they go
   * @param {Array<{ id: string }>} picks - The songs, in play order
   * @returns {void}
   */
  function queue(queueMode, picks) {
    var ids = picks.map(function (pick) {
      return pick.id;
    });
    list.replaceChildren.apply(list, picks.map(createRow));
    heading.textContent = "";
    var done = function (ok) {
      if (ok === false) {
        setStatus(LABELS.queueFailed, false);
        return;
      }
      setStatus("", false);
      heading.textContent = queueMode === "next" ? LABELS.queuedNext : LABELS.queuedReplace;
    };
    var fail = function () {
      setStatus(LABELS.queueFailed, false);
    };
    if (queueMode === "next" && typeof window.__hydraPlayNext === "function") {
      window.__hydraPlayNext(ids).then(done, fail);
    } else if (queueMode === "replace" && typeof window.__hydraPlaySongs === "function") {
      window.__hydraPlaySongs(ids, 0).then(done, fail);
    } else {
      fail();
    }
  }

  /**
   * Hear how the request is going. Called by the main process.
   * @param {any} state - A VibeUpdate from src/integrations/vibe/index.ts
   * @returns {void}
   */
  function update(state) {
    if (!state || typeof state !== "object") return;
    if (state.status === "working") {
      pending = true;
      render();
      setStatus(
        LABELS.working
          .replace("{count}", function () {
            return String(Number(state.searches) || 0);
          })
          .replace("{max}", function () {
            return String(Number(state.maxSearches) || 0);
          }),
        false,
      );
      return;
    }
    pending = false;
    render();
    if (state.status === "done" && Array.isArray(state.picks) && state.picks.length) {
      queue(state.mode === "replace" ? "replace" : "next", state.picks);
    } else if (state.status === "error") {
      var code = String(state.code);
      setStatus(LABELS.errors[code] || LABELS.errors.failed, SETTINGS_ERRORS[code] === true);
    }
    if (isOpen && root.activeElement !== input) input.focus();
  }

  /**
   * Send the description, or cancel the running request.
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
    if (!sendToMain("vibe:request", { prompt: prompt, mode: mode })) {
      setStatus(LABELS.errors.failed, false);
      return;
    }
    // Shown until the main process answers with its own state.
    pending = true;
    render();
    setStatus(
      LABELS.working.replace("{count}", "0").replace("{max}", "…"),
      false,
    );
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
   * Open the panel, or refocus it when open.
   * @returns {void}
   */
  function open() {
    // Switched off in Settings (src/integrations/vibe/index.ts sets this).
    if (document.documentElement.hasAttribute("data-hydra-vibe-off")) return;
    if (!host.isConnected) (document.body || document.documentElement).appendChild(host);
    if (!isOpen) {
      isOpen = true;
      returnFocus = document.activeElement;
      host.style.setProperty("display", "block", "important");
      notifyTopBar();
    }
    if (!pending) input.focus();
    else go.focus();
  }

  /**
   * Hide the panel, keeping its text and results for the next open; a
   * running request carries on and queues its songs when it finishes.
   * @returns {void}
   */
  function close() {
    if (!isOpen) return;
    isOpen = false;
    host.style.setProperty("display", "none", "important");
    notifyTopBar();
    var previous = returnFocus;
    returnFocus = null;
    if (previous && previous.isConnected && typeof previous.focus === "function") {
      previous.focus({ preventScroll: true });
    }
  }

  /** @returns {HTMLElement[]} The panel's focus stops, in order. */
  function focusStops() {
    return [input, modeButtons.next, modeButtons.replace, go, settingsButton].filter(
      function (node) {
        return !node.disabled && !node.hidden && !(node === settingsButton && status.hidden);
      },
    );
  }

  ["next", "replace"].forEach(function (value) {
    modeButtons[value].addEventListener("click", function () {
      if (pending) return;
      mode = value;
      render();
    });
  });
  go.addEventListener("click", submit);
  settingsButton.addEventListener("click", function () {
    close();
    sendToMain("nav:settings");
  });
  backdrop.addEventListener("click", close);

  panel.addEventListener("keydown", function (event) {
    switch (event.key) {
      case "Escape":
        event.preventDefault();
        close();
        break;
      // Focus stays inside the panel while it is open.
      case "Tab": {
        var stops = focusStops();
        if (!stops.length) break;
        event.preventDefault();
        var at = stops.indexOf(root.activeElement);
        var next = event.shiftKey ? at - 1 : at + 1;
        stops[(next + stops.length) % stops.length].focus();
        break;
      }
      case "Enter":
        // Enter sends; Shift+Enter starts a new line.
        if (root.activeElement !== input || event.shiftKey || event.isComposing) break;
        event.preventDefault();
        submit();
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

  render();
  setStatus("", false);
  (document.body || document.documentElement).appendChild(host);

  window.__hydraVibe = {
    open: open,
    close: close,
    isOpen: function () {
      return isOpen;
    },
    search: search,
    recent: recent,
    update: update,
  };
})();
