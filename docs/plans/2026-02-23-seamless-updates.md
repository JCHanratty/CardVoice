# Seamless In-App Updates Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the broken NSIS assisted-installer update with a silent oneClick update that shows an in-app download progress bar and seamlessly restarts.

**Architecture:** Switch electron-builder from `oneClick: false` (wizard UI) to `oneClick: true` (silent per-user install). Add `download-progress` IPC event so the renderer can show a real progress bar. Delete the now-unnecessary custom `installer.nsh`. The update flow becomes: auto-download with progress bar -> modal "Restart Now" -> silent NSIS install (2-5s) -> app relaunches.

**Tech Stack:** electron-updater ^6.3.0, electron-builder ^25.0.0, NSIS oneClick, React (Vite)

---

### Task 1: Switch NSIS to oneClick and clean up installer config

**Files:**
- Modify: `electron/package.json:42-59` (nsis section)
- Delete: `electron/build/installer.nsh`

**Step 1: Update the NSIS config in electron/package.json**

Replace the entire `nsis` block (lines 47-59) with:

```json
    "nsis": {
      "oneClick": true,
      "perMachine": false,
      "runAfterFinish": true,
      "createDesktopShortcut": "always",
      "createStartMenuShortcut": true,
      "shortcutName": "CardVoice",
      "installerIcon": "icon.ico",
      "uninstallerIcon": "icon.ico",
      "artifactName": "CardVoice.${ext}"
    },
```

Key changes:
- `oneClick` changed from `false` to `true` — no installer wizard, no Windows popup
- `perMachine` set to `false` — installs to `%LOCALAPPDATA%\Programs\cardvoice\`, no UAC
- `runAfterFinish` set to `true` — app relaunches after silent install
- Removed `allowToChangeInstallationDirectory` — not compatible with oneClick
- Removed `differentialPackage: false` — handled in code now via `disableDifferentialDownload`
- Removed `include: "build/installer.nsh"` — no longer needed
- Removed `installerHeaderIcon` — not used by oneClick installers

**Step 2: Delete the custom installer.nsh file**

Delete: `electron/build/installer.nsh`

This file was a workaround for the assisted installer's install-path mismatch. With oneClick, the install path is always `%LOCALAPPDATA%\Programs\cardvoice\` so no registry lookup is needed.

**Step 3: Verify the config is valid JSON**

Run: `cd /tmp/CardVoice && node -e "JSON.parse(require('fs').readFileSync('electron/package.json','utf8')); console.log('OK')"`
Expected: `OK`

**Step 4: Commit**

```bash
git add electron/package.json
git rm electron/build/installer.nsh
git commit -m "fix: switch to oneClick NSIS for silent seamless updates"
```

---

### Task 2: Add download-progress event to main process

**Files:**
- Modify: `electron/main.js:52-75` (setupAutoUpdater function)

**Step 1: Update the setupAutoUpdater function**

Replace lines 52-75 in `electron/main.js` with:

```javascript
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
  });

  autoUpdater.checkForUpdatesAndNotify();
}
```

Key additions:
- `autoUpdater.disableDifferentialDownload = true` — forces full download so progress events fire reliably (known electron-builder bug with differential downloads)
- `download-progress` listener — sends `{ percent, transferred, total, bytesPerSecond }` to the renderer

**Step 2: Verify the file is syntactically valid**

Run: `cd /tmp/CardVoice && node -c electron/main.js`
Expected: No errors

**Step 3: Commit**

```bash
git add electron/main.js
git commit -m "feat: add download-progress event and disable differential downloads"
```

---

### Task 3: Expose download-progress in preload bridge

**Files:**
- Modify: `electron/preload.js:1-21`

**Step 1: Add onDownloadProgress to the exposed API**

Replace the full contents of `electron/preload.js` with:

```javascript
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  onUpdateAvailable: (callback) => {
    ipcRenderer.removeAllListeners('update-available');
    ipcRenderer.on('update-available', (_e, info) => callback(info));
  },
  onDownloadProgress: (callback) => {
    ipcRenderer.removeAllListeners('download-progress');
    ipcRenderer.on('download-progress', (_e, progress) => callback(progress));
  },
  onUpdateDownloaded: (callback) => {
    ipcRenderer.removeAllListeners('update-downloaded');
    ipcRenderer.on('update-downloaded', (_e, info) => callback(info));
  },
  quitAndInstall: () => ipcRenderer.invoke('quit-and-install'),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  onMenuAction: (callback) => {
    ipcRenderer.removeAllListeners('menu-action');
    ipcRenderer.on('menu-action', (_e, data) => callback(data));
  },
});
```

Only change: added `onDownloadProgress` method between `onUpdateAvailable` and `onUpdateDownloaded`.

**Step 2: Verify syntax**

Run: `cd /tmp/CardVoice && node -c electron/preload.js`
Expected: No errors

**Step 3: Commit**

```bash
git add electron/preload.js
git commit -m "feat: expose download-progress event in preload bridge"
```

---

### Task 4: Replace download banner with progress bar in App.jsx

**Files:**
- Modify: `frontend/src/App.jsx:110-182` (Layout component — state, useEffect, and the banner/modal JSX)

**Step 1: Add downloadProgress state and subscribe to the IPC event**

In the Layout component (line 110), add a new state variable after `updateReady`:

```javascript
const [downloadProgress, setDownloadProgress] = useState(null);
```

In the `useEffect` block (lines 116-143), add the progress listener after the `onUpdateAvailable` call. The full useEffect becomes:

```javascript
  useEffect(() => {
    if (window.electronAPI) {
      window.electronAPI.onUpdateAvailable((info) => setUpdateInfo(info));
      window.electronAPI.onDownloadProgress((progress) => setDownloadProgress(progress));
      window.electronAPI.onUpdateDownloaded((info) => {
        setUpdateInfo(info);
        setUpdateReady(true);
        setDownloadProgress(null);
      });
      window.electronAPI.onMenuAction(({ action, payload }) => {
        switch (action) {
          case 'navigate':
            navigate(payload);
            break;
          case 'import-csv':
            window.dispatchEvent(new CustomEvent('menu-import-csv'));
            break;
          case 'import-cardvision':
            window.dispatchEvent(new CustomEvent('menu-import-cardvision'));
            break;
          case 'export-csv':
            window.dispatchEvent(new CustomEvent('menu-export-csv'));
            break;
          case 'export-excel':
            window.dispatchEvent(new CustomEvent('menu-export-excel'));
            break;
        }
      });
    }
  }, [navigate]);
```

Key change: added `onDownloadProgress` subscription, and `setDownloadProgress(null)` when download completes.

**Step 2: Replace the download banner with a progress bar**

Replace lines 177-182 (the downloading banner):

```jsx
      {/* Downloading banner (non-modal, subtle) */}
      {updateInfo && !updateReady && (
        <div className="fixed top-0 left-0 right-0 z-50 bg-cv-gold/15 border-b border-cv-gold/30 px-4 py-2 text-center text-sm text-cv-gold font-medium backdrop-blur-sm">
          Downloading update v{updateInfo.version}...
        </div>
      )}
```

With this progress bar version:

```jsx
      {/* Download progress banner */}
      {updateInfo && !updateReady && (
        <div className="fixed top-0 left-0 right-0 z-50 bg-cv-panel/95 border-b border-cv-gold/30 backdrop-blur-sm">
          <div className="px-4 py-2 flex items-center justify-between">
            <span className="text-sm text-cv-gold font-medium">
              Downloading CardVoice v{updateInfo.version}...
            </span>
            <span className="text-xs text-cv-muted font-mono">
              {downloadProgress ? `${downloadProgress.percent}%` : 'Starting...'}
            </span>
          </div>
          <div className="h-1 bg-cv-border/30">
            <div
              className="h-full bg-gradient-to-r from-cv-accent to-cv-gold transition-all duration-300"
              style={{ width: `${downloadProgress?.percent || 0}%` }}
            />
          </div>
        </div>
      )}
```

This shows:
- The version being downloaded
- A percentage counter (right-aligned)
- A gradient progress bar at the bottom of the banner

**Step 3: Build the frontend to verify no errors**

Run: `cd /tmp/CardVoice/frontend && npm run build`
Expected: Build succeeds with no errors

**Step 4: Commit**

```bash
git add frontend/src/App.jsx
git commit -m "feat: replace download banner with real progress bar"
```

---

### Task 5: Bump version, build, tag, push, and publish

**Files:**
- Modify: `package.json` (version)
- Modify: `electron/package.json` (version)

**Step 1: Bump versions to 1.4.0**

This is a minor version bump because the update behavior changes significantly (oneClick vs assisted installer).

In `package.json`: change `"version":"1.3.3"` to `"version":"1.4.0"`
In `electron/package.json`: change `"version": "1.3.3"` to `"version": "1.4.0"`

**Step 2: Commit the version bump**

```bash
git add package.json electron/package.json
git commit -m "chore: bump version to 1.4.0"
```

**Step 3: Tag and push**

```bash
git tag v1.4.0
git push origin main --tags
```

**Step 4: Wait for the GitHub Actions build to complete**

Run: `gh run list --limit 1` and then `gh run watch <run-id> --exit-status`
Expected: Build succeeds

**Step 5: Publish the release**

```bash
gh release edit v1.4.0 --draft=false --latest --notes "$(cat <<'EOF'
### Seamless Updates (v1.4.0)

Completely overhauled the update system:
- Updates now install silently with no Windows popup
- In-app progress bar shows download percentage
- App restarts automatically after update — no manual reinstall needed
- Fixed broken desktop shortcuts after update

**Note:** This is a one-time reinstall. Existing users should download this version from the release page. Future updates will be fully seamless.
EOF
)"
```

**Important note for users:** Since this switches from assisted installer to oneClick, existing users with a custom install path need to download v1.4.0 manually from the releases page. After that, all future updates will be seamless.
