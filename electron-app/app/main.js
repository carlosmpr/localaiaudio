const { app, BrowserWindow } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

const RESOURCE_DIR = path.join(__dirname, '..', 'resources');
const BACKEND_DIR = path.join(RESOURCE_DIR, 'backend');

let backendProcess = null;

function startBackend() {
  const serverEntry = path.join(BACKEND_DIR, 'index.js');
  backendProcess = spawn(process.execPath, [serverEntry], {
    stdio: 'inherit',
    env: {
      ...process.env,
      PORT: process.env.PORT || '3333',
      HOST: process.env.HOST || '127.0.0.1'
    }
  });

  backendProcess.on('exit', () => {
    backendProcess = null;
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, '..', 'source', 'preload.cjs')
    }
  });

  startBackend();

  win.loadFile(path.join(RESOURCE_DIR, 'backend', 'public', 'index.html'));
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('quit', () => {
  if (backendProcess) {
    backendProcess.kill();
  }
});
