# Seamless In-App Updates Design

## Problem

The current NSIS assisted installer (`oneClick: false` + `allowToChangeInstallationDirectory: true`) causes:
1. Windows popup during update (the NSIS wizard UI)
2. Install path mismatch — updater installs to default AppData while original was in a custom dir
3. Broken desktop shortcuts after update
4. Users have to redownload and reinstall manually

## Goal

Steam/Epic-style update: in-app progress bar during download, user clicks "Restart Now", app closes for 2-5 seconds, reopens on new version. Zero Windows popups.

## Approach

Switch to `oneClick: true` NSIS with silent install. Add download progress tracking to the in-app UI.

## Update Flow

```
App starts
  → autoUpdater.checkForUpdatesAndNotify()
  → Update found: download starts automatically in background
  → Renderer shows progress bar with percentage (download-progress IPC)
  → Download completes: modal appears "v1.x.x ready — Restart Now / Later"
  → User clicks "Restart Now"
  → quitAndInstall(true, true) — silent NSIS, force relaunch
  → App closes, NSIS installs silently (2-5s), app reopens on new version
```

## Changes

### 1. electron/package.json — NSIS config
- `oneClick: true`
- `perMachine: false` (per-user install, no UAC)
- Remove `allowToChangeInstallationDirectory`
- Remove `include: "build/installer.nsh"` (no longer needed)
- Remove `differentialPackage: false` (replaced by disableDifferentialDownload in code)

### 2. electron/main.js — Auto-updater setup
- Add `autoUpdater.disableDifferentialDownload = true`
- Add `download-progress` event → send to renderer via IPC

### 3. electron/preload.js — Bridge
- Add `onDownloadProgress(callback)` exposure

### 4. frontend/src/App.jsx — UI
- Replace text banner with progress bar showing download percentage
- Keep existing restart modal

### 5. Cleanup
- Delete `electron/build/installer.nsh` (no longer needed)

## Trade-offs

- Loses "choose install directory" — always installs to `%LOCALAPPDATA%\Programs\cardvoice\`
- Existing users with custom install paths will get a fresh install to the new location on next update
- 2-5 second blackout during restart (same as Discord/VS Code/Slack)
