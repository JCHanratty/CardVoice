const { app, BrowserWindow, shell, ipcMain, Menu, dialog } = require('electron');
const path = require('path');
const { autoUpdater } = require('electron-updater');

let mainWindow;
let serverHandle; // { app, server, db } from createServer()
const BACKEND_PORT = 8000;

// ============================================================
// Resource paths — different in dev vs packaged
// ============================================================

function getServerPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'server');
  }
  return path.join(__dirname, '..', 'server');
}

function getFrontendPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'frontend', 'dist', 'index.html');
  }
  return path.join(__dirname, '..', 'frontend', 'dist', 'index.html');
}

// ============================================================
// Backend Management — in-process Node.js server
// ============================================================

function startBackend() {
  const serverDir = getServerPath();

  // Ensure native modules (better-sqlite3) resolve from the server's node_modules
  if (app.isPackaged) {
    process.env.NODE_PATH = path.join(serverDir, 'node_modules');
    require('module').Module._initPaths();
  }

  process.env.ELECTRON_IS_PACKAGED = app.isPackaged ? 'true' : 'false';
  process.env.APP_VERSION = app.getVersion();

  const { createServer } = require(path.join(serverDir, 'index.js'));
  serverHandle = createServer({ port: BACKEND_PORT });
  console.log(`[Backend] Node.js server started on port ${BACKEND_PORT}`);
}

// ============================================================
// Auto-Update
// ============================================================

function setupAutoUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.disableDifferentialDownload = true;

  autoUpdater.on('update-available', (info) => {
    console.log('Update available:', info.version);
    if (mainWindow) {
      mainWindow.webContents.send('update-available', info);
    }
  });

  autoUpdater.on('download-progress', (progress) => {
    if (mainWindow) {
      mainWindow.webContents.send('download-progress', {
        percent: Math.round(progress.percent),
        transferred: progress.transferred,
        total: progress.total,
        bytesPerSecond: progress.bytesPerSecond,
      });
    }
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log('Update downloaded:', info.version);
    if (mainWindow) {
      mainWindow.webContents.send('update-downloaded', info);
    }
  });

  autoUpdater.on('error', (err) => {
    console.error('Auto-update error:', err.message);
    if (mainWindow) {
      mainWindow.webContents.send('update-error', { message: err.message });
    }
  });

  autoUpdater.checkForUpdates();
}

// ============================================================
// Application Menu
// ============================================================

function buildMenu() {
  const isMac = process.platform === 'darwin';

  const template = [
    // File Menu
    {
      label: 'File',
      submenu: [
        {
          label: 'New Set',
          accelerator: 'CmdOrCtrl+N',
          click: () => sendMenuAction('navigate', '/sets/add'),
        },
        { type: 'separator' },
        {
          label: 'Import CSV',
          click: () => sendMenuAction('import-csv'),
        },
        {
          label: 'Import from CardVision',
          click: () => sendMenuAction('import-cardvision'),
        },
        { type: 'separator' },
        {
          label: 'Export Current Set as CSV',
          click: () => sendMenuAction('export-csv'),
        },
        {
          label: 'Export Current Set as Excel',
          click: () => sendMenuAction('export-excel'),
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { label: 'Exit', accelerator: 'Alt+F4', click: () => app.quit() },
      ],
    },
    // Edit Menu
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    // View Menu
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    // Window Menu
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'maximize' },
        { type: 'separator' },
        { role: 'close' },
      ],
    },
    // Help Menu
    {
      label: 'Help',
      submenu: [
        {
          label: 'How To Guide',
          click: () => sendMenuAction('navigate', '/how-to'),
        },
        { type: 'separator' },
        {
          label: 'Request a Set',
          click: () => shell.openExternal('https://github.com/JCHanratty/CardVoice/issues/new?template=set-request.yml'),
        },
        {
          label: 'Submit a Checklist',
          click: () => shell.openExternal('https://github.com/JCHanratty/CardVoice/issues/new?template=checklist-submission.yml'),
        },
        {
          label: 'Report a Bug',
          click: () => shell.openExternal('https://github.com/JCHanratty/CardVoice/issues/new?template=bug-report.yml'),
        },
        { type: 'separator' },
        {
          label: 'About CardVoice',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'About CardVoice',
              message: 'CardVoice',
              detail: `Version ${app.getVersion()}\n\nCard collection management with voice entry, checklist import, and price tracking.\n\nSupport: buymeacoffee.com/jchanratty`,
              buttons: ['OK'],
            });
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function sendMenuAction(action, payload) {
  if (mainWindow) {
    mainWindow.webContents.send('menu-action', { action, payload });
  }
}

// ============================================================
// Window Management
// ============================================================

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    title: 'CardVoice',
    backgroundColor: '#18181B',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    icon: path.join(__dirname, 'icon.png'),
  });

  // Grant microphone permission automatically
  mainWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'media') {
      callback(true);
    } else {
      callback(false);
    }
  });

  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
  if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(getFrontendPath());
  }

  // Open external links in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ============================================================
// IPC Handlers
// ============================================================

ipcMain.handle('get-app-version', () => app.getVersion());

ipcMain.handle('quit-and-install', () => {
  // Close server/DB first so app.quit() doesn't hang
  if (serverHandle) {
    try { serverHandle.server.close(); } catch (e) {}
    try { serverHandle.db.close(); } catch (e) {}
    serverHandle = null;
  }
  // Use isSilent=false so NSIS can handle the close properly,
  // isForceRunAfter=true to relaunch after install
  autoUpdater.quitAndInstall(false, true);
});

ipcMain.handle('check-for-updates', async () => {
  try {
    const result = await autoUpdater.checkForUpdates();
    return { checking: true, version: result?.updateInfo?.version || null };
  } catch (err) {
    return { checking: false, error: err.message };
  }
});

// ============================================================
// App Lifecycle
// ============================================================

app.whenReady().then(() => {
  console.log('Starting CardVoice...');

  try {
    startBackend();
  } catch (err) {
    console.error('Backend startup error:', err);
  }

  createWindow();
  buildMenu();

  if (app.isPackaged) {
    setupAutoUpdater();
  }
});

app.on('window-all-closed', () => {
  if (serverHandle) {
    try { serverHandle.server.close(); } catch (e) {}
    try { serverHandle.db.close(); } catch (e) {}
    serverHandle = null;
  }
  app.quit();
});

app.on('before-quit', () => {
  if (serverHandle) {
    try { serverHandle.server.close(); } catch (e) {}
    try { serverHandle.db.close(); } catch (e) {}
    serverHandle = null;
  }
});
