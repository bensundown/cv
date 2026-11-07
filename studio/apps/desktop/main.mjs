/**
 * Sound Ninja Design Studio — offline desktop shell (Electron).
 *
 * Starts the full studio server in-process on 127.0.0.1 (random free port) with an embedded
 * database (PGlite) and local file storage in the user's app-data folder, then opens it in a
 * window. Nothing listens on the network and no internet connection is required.
 */
import { app, BrowserWindow, dialog, Menu, shell } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import QRCode from 'qrcode';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(app.getPath('userData'), 'studio-data');
let server = null;
let win = null;
const PHONE_PORT = 8787;
const settingsFile = path.join(app.getPath('userData'), 'settings.json');
const readSettings = () => {
  try {
    return JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  } catch {
    return {};
  }
};
const writeSettings = (s) => {
  fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
  fs.writeFileSync(settingsFile, JSON.stringify(s, null, 2));
};
/** IPv4 addresses on this computer's Wi-Fi / LAN (what a phone types or scans). */
const lanAddresses = () =>
  Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

async function start() {
  // Configure the embedded server BEFORE importing it (config is read at import time).
  process.env.STORAGE_DIR = path.join(dataDir, 'files');
  process.env.WEB_DIST = path.join(here, 'web');
  process.env.MIGRATIONS_DIR = path.join(here, 'migrations');
  process.env.FONT_DIR = path.join(here, 'web', 'brand', 'fonts');
  process.env.HOST = '127.0.0.1';
  const { startEmbedded } = await import(pathToFileURL(path.join(here, 'server', 'embedded.mjs')).href);
  const settings = readSettings();
  const phone = !!settings.phoneAccess;
  try {
    server = await startEmbedded({ dbDir: path.join(dataDir, 'db'), host: phone ? '0.0.0.0' : '127.0.0.1', port: phone ? PHONE_PORT : 0 });
  } catch (e) {
    if (!phone) throw e;
    // Port in use or blocked: fall back to this-computer-only so the app still opens.
    writeSettings({ ...settings, phoneAccess: false });
    dialog.showErrorBox('Phone access could not start', `Port ${PHONE_PORT} is not available (${e.message}). Phone access has been turned off.`);
    server = await startEmbedded({ dbDir: path.join(dataDir, 'db') });
  }
  const origin = `http://127.0.0.1:${server.port}`;
  const phoneOn = phone && server.port === PHONE_PORT;

  win = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1100,
    minHeight: 700,
    title: 'Sound Ninja Design Studio',
    backgroundColor: '#131313',
    icon: path.join(here, 'icon.png'),
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  // Keep the app inside its own origin; anything else opens in the system browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(origin)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(origin)) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });

  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
      {
        label: 'File',
        submenu: [
          phoneOn
            ? { label: 'Phone access: ON — show QR code', click: () => showPhoneWindow(server.port) }
            : { label: 'Turn on phone access (same Wi-Fi)…', click: () => enablePhoneAccess(origin) },
          ...(phoneOn ? [{ label: 'Turn off phone access', click: () => setPhoneAccess(false) }] : []),
          { type: 'separator' },
          { label: 'Open data folder (for backups)', click: () => shell.openPath(dataDir) },
          { type: 'separator' },
          process.platform === 'darwin' ? { role: 'close' } : { role: 'quit' },
        ],
      },
      { role: 'editMenu' },
      { label: 'View', submenu: [{ role: 'reload' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
      { role: 'windowMenu' },
    ]),
  );
  await win.loadURL(`${origin}/`);
  if (phoneOn && settings.showQrOnStart) {
    writeSettings({ ...readSettings(), showQrOnStart: false });
    showPhoneWindow(server.port);
  }
}

function setPhoneAccess(on) {
  writeSettings({ ...readSettings(), phoneAccess: on, showQrOnStart: on });
  app.relaunch();
  app.quit();
}

async function enablePhoneAccess(origin) {
  // Only after an admin account exists: otherwise someone else on the network could claim first-run setup.
  let needsSetup = true;
  try {
    needsSetup = (await (await fetch(`${origin}/api/setup/status`)).json()).needsSetup;
  } catch {
    /* treat as not ready */
  }
  if (needsSetup) {
    await dialog.showMessageBox(win, { type: 'info', message: 'Create your account first', detail: 'Finish the first-run setup on this computer before turning on phone access.' });
    return;
  }
  const r = await dialog.showMessageBox(win, {
    type: 'question',
    buttons: ['Turn on and restart', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
    message: 'Use the studio from your phone?',
    detail:
      'Phones and tablets on the SAME Wi-Fi (or this computer’s hotspot) will be able to open the studio and sign in. ' +
      'No internet is needed. The connection is not encrypted, so only use trusted networks (your own Wi-Fi or hotspot) — not venue guest Wi-Fi. ' +
      'Windows may ask to allow network access: choose Private networks.',
  });
  if (r.response === 0) setPhoneAccess(true);
}

async function showPhoneWindow(port) {
  const urls = lanAddresses().map((a) => `http://${a}:${port}/`);
  const cards = await Promise.all(
    urls.map(async (u) => `<div class="card"><img src="${await QRCode.toDataURL(u, { margin: 1, width: 260 })}" alt="QR code"><div class="url">${u}</div></div>`),
  );
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Phone access</title><style>
    body{margin:0;background:#131313;color:#fff;font-family:system-ui,Segoe UI,Arial,sans-serif;padding:24px;text-align:center}
    h1{font-size:20px;letter-spacing:.04em;text-transform:uppercase;margin:0 0 6px} p{color:#D6D6D6;font-size:14px;margin:6px 0}
    .wrap{display:flex;gap:16px;justify-content:center;flex-wrap:wrap;margin-top:16px}
    .card{background:#fff;color:#0C0C0C;border-radius:9px;padding:14px} .url{font:600 14px ui-monospace,monospace;margin-top:8px}
    .note{color:#FA2158}</style></head><body>
    <h1>Open the studio on your phone</h1>
    <p>Connect your phone to the same Wi-Fi as this computer, then scan the code with the camera.</p>
    <p>Sign in with your studio account. Tip: use “Add to Home Screen” for an app icon.</p>
    <div class="wrap">${cards.join('') || '<p class="note">No Wi-Fi/LAN connection found on this computer.</p>'}</div>
    <p class="note">Keep this computer on and the studio open while you use it from the phone.</p></body></html>`;
  const qr = new BrowserWindow({ width: 620, height: 640, parent: win, title: 'Phone access', backgroundColor: '#131313', webPreferences: { sandbox: true } });
  qr.setMenuBarVisibility(false);
  await qr.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
}

let quitting = false;
app.on('before-quit', (e) => {
  if (server && !quitting) {
    // Close the database cleanly before exiting so no data is lost.
    quitting = true;
    e.preventDefault();
    server.close().finally(() => app.quit());
  }
});
app.on('window-all-closed', () => app.quit());
app
  .whenReady()
  .then(start)
  .catch((e) => {
    dialog.showErrorBox('Sound Ninja Design Studio could not start', String(e?.stack ?? e));
    app.quit();
  });
