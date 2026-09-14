import { app, BrowserWindow, globalShortcut, ipcMain, Tray, Menu, nativeImage, session, shell, desktopCapturer, type DesktopCapturerSource } from 'electron';
import path from 'path';
import { autoUpdater } from 'electron-updater';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

/**
 * A screen-share request that is waiting on the user's choice in the renderer's
 * custom picker. We hold Electron's getDisplayMedia `callback` open here until the
 * renderer replies over IPC with a chosen source id (grant) or null (cancel).
 *
 * Keyed by a monotonically increasing id so a late/duplicate reply for a request
 * that was already superseded is ignored, and a new request rejects the previous
 * pending one cleanly instead of leaking its callback.
 */
interface PendingScreenShare {
  id: number;
  sources: DesktopCapturerSource[];
  callback: (streams: { video?: DesktopCapturerSource; audio?: 'loopback' }) => void;
  audioRequested: boolean;
}
let pendingScreenShare: PendingScreenShare | null = null;
let screenShareRequestSeq = 0;

// True once the user has actually chosen to quit (tray "Quit", Cmd+Q, etc.) so the
// close handler knows to let the window close instead of hiding it to the tray.
let isQuitting = false;

const isDev = process.env.NODE_ENV !== 'production';

// The desktop app is a native shell around the SAME web client the browser loads. It
// points at your running Relay stack; override with RELAY_URL for a LAN IP / domain
// (e.g. RELAY_URL=https://your-host:5173 when running on a different PC).
const RELAY_URL = process.env.RELAY_URL || 'https://localhost:5173';
let trustedHost = '';
let trustedHostname = '';
try {
  const u = new URL(RELAY_URL);
  trustedHost = u.host;         // host + port, e.g. "localhost:5173" — for URL matching
  trustedHostname = u.hostname; // host only, e.g. "localhost" — for cert verification
} catch { /* invalid URL — nothing trusted */ }

// The self-hosted server uses a self-signed cert; trust it ONLY for the configured
// server host, and reject every other certificate error.
app.on('certificate-error', (event, _webContents, url, _error, _cert, callback) => {
  try {
    if (trustedHost && new URL(url).host === trustedHost) {
      event.preventDefault();
      callback(true);
      return;
    }
  } catch { /* fall through to reject */ }
  callback(false);
});

/**
 * Grant the renderer the media access it needs for voice + screen share.
 *
 * The desktop app is a shell around the same web client the browser loads, and that
 * client calls `navigator.mediaDevices.getUserMedia` (mic/camera -> voice) and
 * `getDisplayMedia` (screen share). In a browser those work once the user allows the
 * permission prompt, but Electron DENIES both by default until the main process opts
 * in — which is why voice and screen share appeared completely broken in the app while
 * working fine in a browser tab:
 *   - getUserMedia's 'media' permission is rejected unless a permission handler allows it.
 *   - getDisplayMedia does nothing at all until `setDisplayMediaRequestHandler` is set;
 *     with no handler the promise just rejects, so the "Go Live" / camera flow fails.
 *
 * We grant these only to our own trusted server origin (the host the app is pointed at),
 * and reject everything else, so a stray cross-origin frame can't grab the mic/screen.
 */
function setupMediaAccess() {
  const ses = session.defaultSession;

  // Trust our self-hosted server's self-signed cert for the configured host. The
  // `certificate-error` handler below already lets these connections through, but it
  // fires only AFTER the network stack has failed verification — so Chromium logs a
  // "handshake failed … net_error -202 (ERR_CERT_AUTHORITY_INVALID)" for EVERY request to
  // the (self-signed) server, spamming the console on connect. Overriding verification
  // here, before it fails, makes the cert verify cleanly and silences that noise, while
  // every other host still goes through Chromium's normal verification (callback(-3)).
  // Host-scoped exactly like the certificate-error handler, so this is no weaker.
  ses.setCertificateVerifyProc((request, callback) => {
    if (trustedHostname && request.hostname === trustedHostname) {
      callback(0); // 0 = trusted / verification succeeded
    } else {
      callback(-3); // -3 = use Chromium's default verification result
    }
  });

  // The desktop app only ever loads our own server (trustedHost); everything it renders is
  // our first-party client. So grant permissions to that origin and deny every other origin.
  // This is what unblocks getUserMedia ('media' = mic/camera → voice); it also covers
  // notifications, clipboard, etc. without a brittle per-permission allowlist that could
  // silently break a first-party feature. A stray/cross-origin frame still gets nothing.
  const isTrustedOrigin = (origin: string | undefined | null): boolean => {
    if (!trustedHost || !origin) return false;
    try {
      return new URL(origin).host === trustedHost;
    } catch {
      return false;
    }
  };

  // Async grant path (getUserMedia, notifications, ...). Only our server origin.
  ses.setPermissionRequestHandler((_wc, _permission, callback, details) => {
    callback(isTrustedOrigin(details?.requestingUrl));
  });

  // Synchronous capability check some renderer code paths use instead of the request.
  ses.setPermissionCheckHandler((_wc, _permission, requestingOrigin) => {
    return isTrustedOrigin(requestingOrigin);
  });

  // getDisplayMedia: without this handler the renderer's promise rejects and screen
  // share is dead. Instead of auto-selecting a screen (which gave the desktop app no
  // source choice at all), enumerate every screen + window and hand the list to the
  // renderer's custom picker; we hold `callback` open until the user chooses. Audio is
  // still piped from the system (loopback, Windows-only) when the client asks for it.
  //
  // useSystemPicker is disabled so this handler drives our own picker on every platform
  // rather than silently auto-granting (its picker also never appeared on Windows here).
  ses.setDisplayMediaRequestHandler((request, callback) => {
    const targetWindow = BrowserWindow.getFocusedWindow() ?? mainWindow;
    if (!targetWindow || targetWindow.isDestroyed()) {
      callback({}); // no renderer to drive the picker -> reject cleanly
      return;
    }

    desktopCapturer
      .getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width: 320, height: 180 },
        fetchWindowIcons: true,
      })
      .then((sources) => {
        if (sources.length === 0) {
          callback({}); // nothing capturable -> reject cleanly in the renderer
          return;
        }

        // A newer request supersedes any still-pending one: reject the old picker so
        // its renderer promise settles and no callback is left dangling.
        if (pendingScreenShare) {
          pendingScreenShare.callback({});
          pendingScreenShare = null;
        }

        const requestId = ++screenShareRequestSeq;
        pendingScreenShare = {
          id: requestId,
          sources,
          callback,
          audioRequested: request.audioRequested,
        };

        // Serialize sources for the renderer (NativeImage -> data URL). appIcon is
        // only present for windows (and only when non-empty).
        const payload = sources.map((source) => ({
          id: source.id,
          name: source.name,
          type: source.id.startsWith('screen:') ? 'screen' : 'window',
          thumbnail: source.thumbnail.toDataURL(),
          appIcon:
            source.appIcon && !source.appIcon.isEmpty()
              ? source.appIcon.toDataURL()
              : null,
        }));

        targetWindow.webContents.send('screen-share:request', { requestId, sources: payload });
      })
      .catch(() => callback({}));
  }, { useSystemPicker: false });
}

/** Load the client, showing a friendly retry page if the stack isn't reachable. */
function loadClient(win: BrowserWindow) {
  win.loadURL(RELAY_URL).catch(() => { /* handled by did-fail-load */ });
}

function showUnreachable(win: BrowserWindow) {
  const html = `<!doctype html><meta charset="utf-8">
    <style>html,body{height:100%;margin:0;background:#1a1d24;color:#e0e3e6;
      font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center}
      .box{text-align:center;max-width:420px;padding:24px}
      code{background:#0d0f14;padding:2px 6px;border-radius:4px}
      button{margin-top:16px;padding:10px 20px;border:0;border-radius:6px;background:#3b82f6;color:#fff;font-size:14px;cursor:pointer}</style>
    <div class="box"><h2>Can't reach Relay</h2>
    <p>No server responded at <code>${RELAY_URL}</code>.</p>
    <p>Make sure the Relay stack is running (<code>docker compose up -d</code>), or set
    <code>RELAY_URL</code> to your server's address.</p>
    <button onclick="location.href='${RELAY_URL}'">Retry</button></div>`;
  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 940,
    minHeight: 500,
    frame: process.platform === 'darwin' ? true : false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : undefined,
    backgroundColor: '#36383d',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    icon: path.join(__dirname, '../../resources/icon.png'),
    show: false,
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  // Always load the live client (the desktop app is a shell for the self-hosted server;
  // there is no bundled offline renderer because the backend is required regardless).
  loadClient(mainWindow);
  // Only open DevTools when explicitly requested (RELAY_DEVTOOLS=1). A normal app
  // launch must never pop DevTools.
  if (process.env.RELAY_DEVTOOLS === '1') {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  // Links to other sites (attachments, embeds, markdown links, etc.) must open in the
  // user's real browser, not as a chromeless in-app window with no address bar. Deny the
  // new-window and hand the URL to the OS; only http(s)/mailto are forwarded.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?:|mailto:)/i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  // Likewise, block top-level navigations away from our own origin (a stray link that
  // tries to replace the app) and send them to the browser instead.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(RELAY_URL)) {
      event.preventDefault();
      if (/^https?:/i.test(url)) void shell.openExternal(url);
    }
  });

  // If the server is down, show a friendly retry page instead of a blank window.
  mainWindow.webContents.on('did-fail-load', (_e, errorCode, _desc, validatedURL) => {
    // -3 (ABORTED) fires on normal in-app navigations; ignore it. Only handle the
    // top-level document failing to load.
    if (errorCode !== -3 && validatedURL.startsWith(RELAY_URL) && mainWindow) {
      showUnreachable(mainWindow);
    }
  });

  // Keep the maximize button icon in sync with the actual window state.
  const emitMax = () => mainWindow?.webContents.send('maximize-change', mainWindow?.isMaximized());
  mainWindow.on('maximize', emitMax);
  mainWindow.on('unmaximize', emitMax);

  mainWindow.on('close', (e) => {
    // Closing the window hides to the tray (Relay keeps running) UNLESS the user has
    // actually asked to quit -- otherwise Cmd+Q / app.quit() could never exit the app.
    if (tray && !isQuitting) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createTray() {
  const icon = nativeImage.createFromPath(
    path.join(__dirname, '../../resources/icon.png')
  ).resize({ width: 16, height: 16 });

  tray = new Tray(icon);

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Open Relay', click: () => mainWindow?.show() },
    { type: 'separator' },
    { label: 'Quit', click: () => { tray = null; app.quit(); } },
  ]);

  tray.setToolTip('Relay');
  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => mainWindow?.show());
}

// IPC handlers
ipcMain.handle('get-version', () => app.getVersion());
ipcMain.handle('minimize', () => mainWindow?.minimize());
ipcMain.handle('maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.handle('close', () => mainWindow?.close());
ipcMain.handle('is-maximized', () => mainWindow?.isMaximized());

// The renderer's custom screen-share picker replies here with the chosen source id,
// or null to cancel. Guard on the request id so a stale/duplicate reply for a request
// that was already superseded (or resolved) is ignored.
ipcMain.handle('screen-share:pick', (_event, requestId: number, sourceId: string | null) => {
  const pending = pendingScreenShare;
  if (!pending || pending.id !== requestId) {
    return; // stale or unknown reply -> nothing to grant
  }
  pendingScreenShare = null;

  if (!sourceId) {
    pending.callback({}); // user cancelled -> reject cleanly in the renderer
    return;
  }

  const chosen = pending.sources.find((source) => source.id === sourceId);
  if (!chosen) {
    pending.callback({});
    return;
  }

  // Preserve the existing audio-loopback behavior: pipe system audio (Windows-only)
  // when the client asked to share audio.
  if (pending.audioRequested && process.platform === 'win32') {
    pending.callback({ video: chosen, audio: 'loopback' });
  } else {
    pending.callback({ video: chosen });
  }
});

// Single-instance: if Relay is already running, focus it instead of opening a second
// window (double-clicking Relay.bat again just re-focuses the app).
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  // App lifecycle
  app.whenReady().then(() => {
    // Must run before the client loads so the first getUserMedia/getDisplayMedia is granted.
    setupMediaAccess();
    createWindow();
    createTray();

    if (!isDev) {
      // Auto-update only does anything once the project publishes releases to an update
      // feed; until then the check is a harmless no-op. Swallow the "no feed configured"
      // error so it never surfaces to the user.
      autoUpdater.on('error', (err) => console.error('[updater]', err?.message ?? err));
      autoUpdater.checkForUpdatesAndNotify().catch(() => { /* no release feed configured */ });
    }
  });
}

// Let the window actually close (rather than hide to tray) once a real quit is underway.
app.on('before-quit', () => { isQuitting = true; });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
  else mainWindow?.show();
});

// Deep links
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('relay', process.execPath, [path.resolve(process.argv[1]!)]);
  }
} else {
  app.setAsDefaultProtocolClient('relay');
}
