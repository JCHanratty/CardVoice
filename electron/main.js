const { app, BrowserWindow, shell, ipcMain, Menu, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { autoUpdater } = require('electron-updater');

let mainWindow;
let serverHandle; // { app, server, db } from createServer()
let downloadedInstallerPath = null; // Cached path from electron-updater
let isUpdating = false; // True once quitAndInstall starts — prevents race with app.quit()
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
// Update cleanup — remove leftover update scripts on startup
// ============================================================

function cleanupUpdateArtifacts() {
  const updatesDir = path.join(app.getPath('temp'), 'cardvoice-update');
  if (fs.existsSync(updatesDir)) {
    try {
      fs.rmSync(updatesDir, { recursive: true, force: true });
      console.log('[Update] Cleaned up update artifacts');
    } catch (e) {
      console.warn('[Update] Could not clean update artifacts:', e.message);
    }
  }

  // Clear stale electron-updater cache (pending downloads from failed installs)
  // Without this, a failed quitAndInstall leaves a cached installer that blocks
  // future update checks from discovering newer versions.
  // Check both old (cardvoice-updater) and new (CardVoice-updater) cache dir names.
  const appDataLocal = path.join(app.getPath('userData'), '..');
  for (const dirName of ['cardvoice-updater', 'CardVoice-updater']) {
    const pendingDir = path.join(appDataLocal, dirName, 'pending');
    if (fs.existsSync(pendingDir)) {
      try {
        fs.rmSync(pendingDir, { recursive: true, force: true });
        console.log(`[Update] Cleared stale pending cache in ${dirName}`);
      } catch (e) {
        console.warn(`[Update] Could not clear pending cache in ${dirName}:`, e.message);
      }
    }
  }
}

// ============================================================
// Auto-Update — uses electron-updater for check/download,
// but CPR-Tracker-style external script for the actual install.
//
// Why: autoUpdater.quitAndInstall() is broken on Windows.
// The NSIS installer starts before Electron fully exits,
// causing "cannot be closed" errors and infinite loops.
// Instead, we spawn an external .bat script that waits for
// our PID to die, THEN runs the installer silently.
// ============================================================

function setupAutoUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false; // We handle install ourselves
  autoUpdater.disableDifferentialDownload = true;
  autoUpdater.allowPrerelease = false;
  // Ensure we only look at published (non-draft) releases
  autoUpdater.allowDowngrade = false;

  autoUpdater.on('checking-for-update', () => {
    console.log('[Update] Checking for updates...');
  });

  autoUpdater.on('update-not-available', (info) => {
    console.log('[Update] No update available. Current:', app.getVersion(), 'Latest:', info?.version);
    if (mainWindow) {
      mainWindow.webContents.send('update-not-available', info);
    }
  });

  autoUpdater.on('update-available', (info) => {
    console.log('[Update] Update available:', info.version);
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
    // Capture the downloaded installer path from electron-updater
    downloadedInstallerPath = info.downloadedFile || null;
    console.log('[Update] Update downloaded:', info.version, 'at', downloadedInstallerPath);
    if (mainWindow) {
      mainWindow.webContents.send('update-downloaded', info);
    }
  });

  autoUpdater.on('error', (err) => {
    // Provide a user-friendly error message
    let userMessage = err.message;
    if (err.message.includes('net::ERR') || err.message.includes('ENOTFOUND')) {
      userMessage = 'No internet connection. Check your network and try again.';
    } else if (err.message.includes('404') || err.message.includes('No published versions')) {
      userMessage = 'No installer available for this release. The developer needs to upload build artifacts.';
    } else if (err.message.includes('SHA512') || err.message.includes('checksum')) {
      userMessage = 'Download corrupted. Try again.';
    }
    console.error('[Update] Auto-update error:', err.message);
    if (mainWindow) {
      mainWindow.webContents.send('update-error', { message: userMessage, detail: err.message });
    }
  });

  autoUpdater.checkForUpdates().catch((err) => {
    console.error('[Update] Initial check failed:', err.message);
  });

  // Re-check every 30 minutes while the app is running
  setInterval(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 30 * 60 * 1000);
}

/**
 * Quit-and-install: let electron-updater handle the full sequence.
 *
 * CRITICAL: Do NOT manually close the window or call app.quit() before
 * autoUpdater.quitAndInstall(). Doing so triggers window-all-closed →
 * app.quit(), which races with the updater's own quit sequence. The result:
 * NSIS uninstalls the old version, but Electron dies before NSIS finishes
 * writing the new one → empty install directory, broken app.
 *
 * Instead: set isUpdating flag (prevents window-all-closed from quitting),
 * release server file locks, then let quitAndInstall() handle window
 * closing, app quitting, and NSIS spawning in the correct order.
 */
function quitAndInstallViaScript() {
  console.log('[Update] Starting quit-and-install...');
  isUpdating = true;

  // Release server/DB file locks so NSIS can overwrite resources
  if (serverHandle) {
    try { serverHandle.server.close(); } catch (e) {}
    try { serverHandle.db.close(); } catch (e) {}
    serverHandle = null;
    console.log('[Update] Server and DB closed');
  }

  // Let electron-updater handle everything: isSilent=false, isForceRunAfter=true
  // It will close windows, quit the app, and spawn the NSIS installer in the right order.
  console.log('[Update] Calling autoUpdater.quitAndInstall(false, true)...');
  autoUpdater.quitAndInstall(false, true);
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
  quitAndInstallViaScript();
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

  cleanupUpdateArtifacts();

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

function shutdownServer() {
  if (serverHandle) {
    try { serverHandle.server.close(); } catch (e) {}
    try { serverHandle.db.close(); } catch (e) {}
    serverHandle = null;
  }
}

app.on('window-all-closed', () => {
  if (isUpdating) return; // Let autoUpdater.quitAndInstall() handle the quit sequence
  shutdownServer();
  app.quit();
});

app.on('before-quit', () => {
  if (isUpdating) return; // Server already closed in quitAndInstallViaScript()
  shutdownServer();
});
