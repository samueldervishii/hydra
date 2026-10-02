// The About page's script, loaded from about.html under a CSP that allows
// scripts from this folder only. The main process passes every value in the
// query string; nothing here parses markup.
(function () {
  var params = new URLSearchParams(window.location.search);
  var lang = params.get('lang') || 'en';
  document.documentElement.lang = lang;
  document.documentElement.dir = /^(ar|he)(-|$)/i.test(lang) ? 'rtl' : 'ltr';
  var name = params.get('name') || 'Hydra';
  var version = params.get('version') || '';
  var description = params.get('description') || '';
  var copyright = params.get('copyright') || '';
  var author = params.get('author') || '';
  var authorUrl = params.get('authorUrl') || '';
  var credit = params.get('credit') || '';
  var originalAuthor = params.get('originalAuthor') || '';
  var originalAuthorUrl = params.get('originalAuthorUrl') || '';
  var license = params.get('license') || '';
  var aboutText = params.get('about') || 'About ' + name;
  var closeText = params.get('close') || 'Close';
  var versionPrefix = params.get('versionPrefix') || 'Version';

  document.title = aboutText;

  document.getElementById('name').textContent = name;
  document.getElementById('icon').alt = name;
  document.getElementById('version').textContent = versionPrefix + ' ' + version;
  document.getElementById('description').textContent = description;
  /**
   * The canonical address of a GitHub profile, or null for anything else.
   * Only https://github.com/<user> qualifies: no other scheme or host, and no
   * port, credentials, query, fragment or deeper path. The result is rebuilt
   * from the fixed origin and the parsed user name, so nothing in the query
   * string decides the scheme or the host of a link.
   * @param {string} value - Address from the query string
   * @returns {string | null}
   */
  function githubProfileUrl(value) {
    var url;
    try {
      url = new URL(value);
    } catch (e) {
      return null;
    }
    if (url.protocol !== 'https:' || url.hostname !== 'github.com') return null;
    if (url.port || url.username || url.password || url.search || url.hash) return null;
    if (!/^\/[A-Za-z0-9-]+$/.test(url.pathname)) return null;
    return 'https://github.com' + url.pathname;
  }

  /**
   * Append text as a text node, never as markup.
   * @param {HTMLElement} element - Line to extend
   * @param {string} text - Text to show
   * @returns {void}
   */
  function appendText(element, text) {
    element.appendChild(document.createTextNode(text));
  }

  /**
   * Append an author's name: a link to their GitHub profile, or plain text
   * when the address is not one. The main process opens the link in the
   * system browser, and only if it is HTTPS on github.com.
   * @param {HTMLElement} element - Line to extend
   * @param {string} name - Author's name
   * @param {string} profile - Address of their GitHub profile
   * @returns {void}
   */
  function appendAuthor(element, name, profile) {
    var href = githubProfileUrl(profile);
    if (href === null) {
      appendText(element, name);
      return;
    }
    var link = document.createElement('a');
    link.href = href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = name;
    element.appendChild(link);
  }

  var copyrightLine = document.getElementById('copyright');
  appendText(copyrightLine, copyright + ' ');
  appendAuthor(copyrightLine, author, authorUrl);

  var creditLine = document.getElementById('credit');
  appendText(creditLine, credit + ' ');
  appendAuthor(creditLine, originalAuthor, originalAuthorUrl);
  appendText(creditLine, ' \u00B7 ' + license);

  document.getElementById('close-btn').textContent = closeText;
  document.querySelector('.close-btn').addEventListener('click', function() { window.close(); });
})();
