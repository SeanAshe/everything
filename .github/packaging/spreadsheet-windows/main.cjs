const { app, BrowserWindow, shell, dialog, ipcMain } = require('electron');
const path = require('path');
const { PORT, listenLoopback } = require('./serve-dist.cjs');
const { spreadsheetArg } = require('./open-file.cjs');
const { createDesktopFiles } = require('./desktop-files.cjs');

const desktopFiles = createDesktopFiles();

const DIST = path.join(__dirname, 'dist');
const APP_ORIGIN = `http://127.0.0.1:${PORT}`;

function isAppUrl(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname;
    const loopback = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
    return parsed.protocol === 'http:' && loopback && parsed.port === String(PORT);
  } catch {
    return false;
  }
}

/** puter.com, where the sign-in popup is opened. */
function isPuterUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && (parsed.hostname === 'puter.com' || parsed.hostname.endsWith('.puter.com'));
  } catch {
    return false;
  }
}

function openOutside(url) {
  if (url.startsWith('https://') || url.startsWith('http://')) shell.openExternal(url);
}

function attachGuards(contents, allow) {
  const block = (event, url) => {
    if (allow(url)) return;
    event.preventDefault();
    openOutside(url);
  };
  contents.on('will-navigate', block);
  contents.on('will-redirect', block);
  contents.setWindowOpenHandler(({ url }) => {
    // Sign-in opens a popup (often about:blank, then puter.com) and posts the token back to this window.
    if (url === 'about:blank' || isPuterUrl(url) || isAppUrl(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 480,
          height: 720,
          autoHideMenuBar: true,
          webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
          },
        },
      };
    }
    openOutside(url);
    return { action: 'deny' };
  });
  contents.on('did-create-window', (child) => {
    // The popup has to follow Puter through account providers, then back here with the token.
    attachGuards(child.webContents, (url) => isAppUrl(url) || isPuterUrl(url) || url.startsWith('https://') || url.startsWith('about:'));
  });
}

let mainWindow = null;

function focusMain() {
  const win = mainWindow;
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.focus();
}

/** The workbook Windows asked this process to open, remembered for the window that is already running. */
function acceptLaunch(argv, cwd) {
  const file = spreadsheetArg(argv, cwd);
  if (!file) return null;
  try { return desktopFiles.add(file, { asLaunch: true }); } catch { return null; }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow = win;

  win.once('ready-to-show', () => win.show());
  attachGuards(win.webContents, isAppUrl);
  win.loadURL(`${APP_ORIGIN}/`);
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  ipcMain.handle('desktop-take-launch', () => desktopFiles.launch);

  app.on('second-instance', (_event, argv, cwd) => {
    const info = acceptLaunch(argv, cwd);
    focusMain();
    if (info && mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('desktop-open-file', info);
  });

  app.whenReady().then(async () => {
    acceptLaunch(process.argv, process.cwd());
    try {
      await listenLoopback(DIST, PORT, (req, res) => desktopFiles.handle(req, res));
    } catch (err) {
      dialog.showErrorBox('Spreadsheet', `Spreadsheet could not start (${err.code || err.message}).`);
      app.quit();
      return;
    }
    createWindow();
  });

  app.on('window-all-closed', () => {
    app.quit();
  });
}
