/**
 * Sound Ninja Design Studio — offline desktop shell (Electron).
 *
 * Starts the full studio server in-process on 127.0.0.1 (random free port) with an embedded
 * database (PGlite) and local file storage in the user's app-data folder, then opens it in a
 * window. Nothing listens on the network and no internet connection is required.
 */
import { app, BrowserWindow, dialog, Menu, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(app.getPath('userData'), 'studio-data');
let server = null;
let win = null;

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
  server = await startEmbedded({ dbDir: path.join(dataDir, 'db') });
  const origin = `http://127.0.0.1:${server.port}`;

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
