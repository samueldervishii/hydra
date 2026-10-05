import { app, BrowserWindow } from 'electron';
import log from 'electron-log/main';
import { getTrayStrings, getAboutStrings, getLoadingText } from './i18n';
import { getAssetPath, getProductInfo } from './paths';
import { getZoomFactor } from './config';
import { openExternalUrl } from './utils/openExternal';
import {
  COPYRIGHT_HOLDER,
  COPYRIGHT_HOLDER_URL,
  COPYRIGHT_YEAR,
  ORIGINAL_AUTHOR,
  ORIGINAL_AUTHOR_URL,
  ORIGINAL_NAME,
} from './identity';

const ABOUT_WINDOW_WIDTH_PX = 400;
const ABOUT_WINDOW_HEIGHT_PX = 400;

const aboutLog = log.scope('about');

let aboutWindow: BrowserWindow | null = null;

/**
 * The only links the About page may open: HTTPS pages on github.com, which is
 * where both authors' profiles live. Anything else is refused and logged.
 */
export function isAboutLinkAllowed(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname === 'github.com';
  } catch {
    return false;
  }
}

// Hand an allowed link to the system browser through the app's one guard.
function openAboutLink(url: string): void {
  if (!isAboutLinkAllowed(url)) {
    aboutLog.warn('blocked About link outside https://github.com/');
    return;
  }
  openExternalUrl(url, aboutLog);
}

/**
 * Close the About window if it is open. main.ts calls this when the main window
 * closes: About is a separate top-level window, and left open it would keep
 * window-all-closed from firing and Hydra running with no main window.
 */
export function closeAboutWindow(): void {
  if (aboutWindow && !aboutWindow.isDestroyed()) aboutWindow.close();
}

/** Show the About window, or focus the one already open. */
export function showAboutWindow(): void {
  if (aboutWindow) {
    aboutWindow.focus();
    return;
  }

  aboutLog.info('showing About window');
  // Scale the fixed window with its contents to prevent clipping at higher zoom.
  const zoomFactor = getZoomFactor();
  aboutWindow = new BrowserWindow({
    width: Math.round(ABOUT_WINDOW_WIDTH_PX * zoomFactor),
    height: Math.round(ABOUT_WINDOW_HEIGHT_PX * zoomFactor),
    frame: false,
    resizable: false,
    fullscreenable: false,
    fullscreen: false,
    center: true,
    skipTaskbar: true,
    backgroundColor: '#0A121F',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Wait for the page to render so the window does not flash empty.
  aboutWindow.once('ready-to-show', () => {
    aboutWindow?.webContents.setZoomFactor(getZoomFactor());
    aboutWindow?.show();
  });

  aboutWindow.on('closed', () => {
    aboutWindow = null;
  });

  // The author names are links. A link must never load inside this window:
  // a new-window request and an in-window navigation both go to the browser.
  aboutWindow.webContents.setWindowOpenHandler(({ url }) => {
    openAboutLink(url);
    return { action: 'deny' };
  });
  aboutWindow.webContents.on('will-navigate', (event, url) => {
    event.preventDefault();
    openAboutLink(url);
  });

  const info = getProductInfo();
  const trayStrings = getTrayStrings();
  const aboutStrings = getAboutStrings();

  // With no preload, the sandboxed page receives text and product details through query parameters.
  aboutWindow.loadFile(getAssetPath('assets', 'about.html'), {
    query: {
      name: info.productName,
      version: app.getVersion(),
      description: aboutStrings.description,
      lang: getLoadingText().lang,
      // Two lines: this fork's notice, then the credit to Sidra and the
      // licence. Each author's name becomes a link to their GitHub profile.
      copyright: `${info.productName} \u00A9 ${COPYRIGHT_YEAR}`,
      author: COPYRIGHT_HOLDER,
      authorUrl: COPYRIGHT_HOLDER_URL,
      credit: `Based on ${ORIGINAL_NAME} \u00A9`,
      originalAuthor: ORIGINAL_AUTHOR,
      originalAuthorUrl: ORIGINAL_AUTHOR_URL,
      license: info.license,
      about: trayStrings.about,
      close: aboutStrings.close,
      versionPrefix: aboutStrings.versionPrefix,
    },
  });
}
