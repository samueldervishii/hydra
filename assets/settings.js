// Render settings from the isolated preload bridge and serialise user changes.
(() => {
  'use strict';

  const bridge = window.hydraSettings;
  const byId = (id) => document.getElementById(id);
  const params = new URLSearchParams(window.location.search);
  const lang = params.get('lang') || 'en';
  document.documentElement.lang = lang;
  document.documentElement.dir = /^(ar|he)(-|$)/i.test(lang) ? 'rtl' : 'ltr';
  document.title = params.get('settings') || 'Settings';
  document.querySelector('[data-label="settings"]').textContent = document.title;
  const selects = ['musicService', 'startPage', 'theme', 'zoomFactor', 'navigation', 'vibeModel'];
  const toggles = ['performanceMode', 'closeToTray', 'lastfmEnabled'];
  let state;
  // Pushed state supersedes pending replies from getState() and apply().
  let revision = 0;
  let closed = false;
  let queue = Promise.resolve();

  function showError() {
    if (closed) return;
    byId('error').textContent = state?.labels.settingsError || params.get('settingsError') || 'Could not update settings. Please try again.';
    byId('error').hidden = false;
  }

  function render(next) {
    if (closed) return;
    const focusedId = document.activeElement?.id;
    state = next;
    document.documentElement.lang = state.lang;
    document.documentElement.dataset.theme = state.theme;
    document.documentElement.dir = /^(ar|he)(-|$)/i.test(state.lang) ? 'rtl' : 'ltr';
    document.title = state.labels.settings;
    for (const element of document.querySelectorAll('[data-label]')) {
      element.textContent = state.labels[element.dataset.label];
    }
    for (const key of selects) {
      const select = byId(key);
      const options = state.options[key];
      if (select.options.length !== options.length || options.some((option, index) =>
        select.options[index].value !== String(option.value) || select.options[index].textContent !== option.label)) {
        select.replaceChildren(...options.map(({ value, label }) => {
          const option = document.createElement('option');
          option.value = String(value);
          option.textContent = label;
          return option;
        }));
      }
      select.value = String(state[key]);
    }
    for (const key of toggles) {
      byId(key).checked = key === 'lastfmEnabled' ? state.lastfm.enabled : state[key];
    }
    renderLastfm(focusedId);
    renderVibe(focusedId);
    byId('preferences').hidden = false;
  }

  function renderLastfm(focusedId) {
    const { lastfm, labels } = state;
    byId('lastfm').hidden = !lastfm.available;
    if (!lastfm.available) return;
    byId('lastfmEnabled').disabled = !lastfm.connected;
    // The account name is inserted as text, so a $ in it is not a replacement pattern.
    byId('lastfm-status').textContent = lastfm.connected
      ? labels.lastfmConnected.replace('{name}', () => lastfm.username)
      : lastfm.failed ? labels.lastfmConnectFailed : '';
    byId('lastfmConnect').hidden = lastfm.connected;
    byId('lastfmConnect').disabled = lastfm.connecting;
    byId('lastfmDisconnect').hidden = !lastfm.connected;
    if (focusedId === 'lastfmConnect' && lastfm.connected) byId('lastfmDisconnect').focus();
    if (focusedId === 'lastfmDisconnect' && !lastfm.connected) byId('lastfmConnect').focus();
  }

  function renderVibe(focusedId) {
    const { vibe, labels } = state;
    // Settings never receives the key: only whether one is saved.
    const lines = [];
    if (vibe.hasKey) lines.push(vibe.keyPersisted ? labels.vibeKeySaved : labels.vibeKeyMemoryOnly);
    lines.push(labels.vibeUsage
      .replace('{used}', () => String(vibe.usedToday))
      .replace('{limit}', () => String(vibe.dailyLimit)));
    byId('vibe-status').textContent = lines.join(' · ');
    byId('vibeClearKey').hidden = !vibe.hasKey;
    if (focusedId === 'vibeClearKey' && !vibe.hasKey) byId('vibeApiKey').focus();
  }

  async function refresh() {
    const requestedAt = revision;
    const next = await bridge.getState();
    if (requestedAt === revision) render(next);
  }

  function apply(action) {
    queue = queue.then(async () => {
      if (closed) return;
      byId('error').hidden = true;
      try {
        const requestedAt = revision;
        const next = await bridge.apply(action);
        if (requestedAt === revision) render(next);
      } catch {
        try { await refresh(); } catch { if (state) render(state); }
        if (!closed) showError();
      }
    });
  }

  for (const key of selects) {
    byId(key).addEventListener('change', () => {
      const action = { type: key, value: key === 'zoomFactor' ? Number(byId(key).value) : byId(key).value };
      // Keep the selection tied to the displayed service while earlier actions wait.
      if (key === 'startPage') action.serviceId = state.musicService;
      apply(action);
    });
  }
  for (const key of toggles) {
    byId(key).addEventListener('change', () => apply({ type: key, value: byId(key).checked }));
  }
  byId('vibe-key-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const value = byId('vibeApiKey').value.trim();
    if (!value) return;
    // Clear the field at once, so the key does not stay on screen or in the DOM.
    byId('vibeApiKey').value = '';
    apply({ type: 'vibeApiKey', value });
  });
  byId('vibeClearKey').addEventListener('click', () => apply({ type: 'vibeClearKey' }));
  for (const key of ['lastfmConnect', 'lastfmDisconnect']) {
    byId(key).addEventListener('click', () => apply({ type: key }));
  }
  const unsubscribe = bridge.onState((next) => {
    revision++;
    render(next);
  });
  window.addEventListener('pagehide', () => {
    closed = true;
    unsubscribe();
  }, { once: true });
  refresh().catch(showError);
})();
