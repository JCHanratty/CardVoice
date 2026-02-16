const { app, BrowserWindow, shell } = require('electron');
const path = require('path');

let mainWindow;
let serverHandle; // { app, server, db } from createServer()
const BACKEND_PORT = 8000;
const FRONTEND_PORT = 3000;

// ============================================================
// Backend Management — in-process Node.js server (no Python)
// ============================================================

function startBackend() {
  const { createServer } = require('../server');
  serverHandle = createServer({ port: BACKEND_PORT });
  console.log(`[Backend] Node.js server started on port ${BACKEND_PORT}`);
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
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0f1419',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      // Enable microphone access
      permissions: ['microphone'],
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

  // In development, load from React dev server
  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
  if (isDev) {
    mainWindow.loadURL(`http://localhost:${FRONTEND_PORT}`);
    // Open DevTools in dev
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    // In production, load built React files (Vite outputs to dist/)
    mainWindow.loadFile(path.join(__dirname, '..', 'frontend', 'dist', 'index.html'));
  }

  // Open links in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

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
});

app.on('window-all-closed', () => {
  if (serverHandle) {
    serverHandle.server.close();
    serverHandle.db.close();
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

app.on('before-quit', () => {
  if (serverHandle) {
    serverHandle.server.close();
    serverHandle.db.close();
  }
});
