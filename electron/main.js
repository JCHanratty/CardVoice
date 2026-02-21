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

  autoUpdater.on('update-available', (info) => {
    console.log('Update available:', info.version);
    if (mainWindow) {
      mainWindow.webContents.send('update-available', info);
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
  });

  autoUpdater.checkForUpdatesAndNotify();
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
          label: 'About CardVoice',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'About CardVoice',
              message: 'CardVoice',
              detail: `Version ${app.getVersion()}\n\nCard collection management with voice entry, checklist import, and price tracking.`,
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
    serverHandle.server.close();
    serverHandle.db.close();
  }
  app.quit();
});

app.on('before-quit', () => {
  if (serverHandle) {
    serverHandle.server.close();
    serverHandle.db.close();
  }
});
