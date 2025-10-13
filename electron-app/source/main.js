import { app, BrowserWindow } from 'electron';
import path from 'path';
import fs from 'fs';
import http from 'http';
import { fileURLToPath } from 'url';
import Module from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow = null;
let backendController = null;
let backendStartPromise = null;

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
  process.exit(0);
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.focus();
  } else {
    createWindow();
  }
});

// This function resolves paths to resources correctly for both development and packaged apps.
function resolveResourcePath(...segments) {
  const isDev = process.env.NODE_ENV === 'development';
  // In development, resources are in the project root.
  // In production, they are copied to the `resources` directory of the packaged app.
  const basePath = isDev ? process.cwd() : process.resourcesPath;
  return path.join(basePath, ...segments);
}

function pathExists(candidate) {
  if (!candidate) return false;
  try {
    fs.accessSync(candidate);
    return true;
  } catch {
    return false;
  }
}



const shouldForceDevTools = process.env.PRIVATE_AI_DEBUG === '1';

const BACKEND_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'backend')
  : resolveResourcePath('resources', 'backend');

const MODELS_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'models')
  : resolveResourcePath('resources', 'models');

function registerModulePath(candidate) {
  if (!pathExists(candidate)) {
    return;
  }

  if (!Module.globalPaths.includes(candidate)) {
    Module.globalPaths.unshift(candidate);
    console.log(`Registered module search path: ${candidate}`);
  }

  const segments = (process.env.NODE_PATH ?? '').split(path.delimiter).filter(Boolean);
  if (!segments.includes(candidate)) {
    segments.unshift(candidate);
    process.env.NODE_PATH = segments.join(path.delimiter);
    Module._initPaths();
  }
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function copyBundledModel(destinationDir) {
  try {
    const files = fs.readdirSync(MODELS_DIR);
    for (const file of files) {
      if (file.endsWith('.gguf')) {
        const src = path.join(MODELS_DIR, file);
        const dest = path.join(destinationDir, file);
        // Always copy to ensure the model is present and correct.
        fs.copyFileSync(src, dest);
        return dest;
      }
    }
  } catch (error) {
    console.warn('No bundled model found:', error.message);
  }
  return null;
}

async function startBackend() {
  if (backendController) {
    console.log('Backend server already running.');
    return backendController;
  }

  if (backendStartPromise) {
    return backendStartPromise;
  }

  backendStartPromise = (async () => {
    const userDataDir = app.getPath('userData');
    const privateAiDir = path.join(userDataDir, 'PrivateAI');
    const modelsDestDir = path.join(privateAiDir, 'Models');
    ensureDir(modelsDestDir);

    const modelPath = copyBundledModel(modelsDestDir);
    if (modelPath) {
      process.env.PRIVATE_AI_MODEL_PATH = modelPath;
    }

    const appPath = app.getAppPath();
    process.env.PRIVATE_AI_RENDERER_DIR = path.join(appPath, 'build', 'renderer');

    process.env.PRIVATE_AI_BASE_DIR = privateAiDir;

    const moduleCandidates = [
      path.join(appPath, 'node_modules'),
      path.join(process.resourcesPath, 'app.asar', 'node_modules'),
      path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules'),
      path.join(process.resourcesPath, 'node_modules'),
      app.getAppPath()
    ];
    moduleCandidates.forEach(registerModulePath);

    const serverEntry = path.join(BACKEND_DIR, 'index.js');
    console.log(`Starting backend server from: ${serverEntry}`);

    let backendModule;
    try {
      backendModule = runtimeRequire(serverEntry);
    } catch (error) {
      console.error('Unable to load backend module:', error);
      throw error;
    }

    const startServer =
      typeof backendModule?.startServer === 'function'
        ? backendModule.startServer
        : typeof backendModule?.default === 'function'
          ? backendModule.default
          : null;

    if (!startServer) {
      throw new Error('Backend module does not export a startServer function.');
    }

    const host = process.env.HOST || '127.0.0.1';
    const port = Number(process.env.PORT || '3333');

    process.env.PORT = String(port);
    process.env.HOST = host;

    const controller = await startServer({
      host,
      port,
      onListening: (info) => {
        console.log(`Backend server ready at ${info.url}`);
      }
    });

    backendController = controller;
    return controller;
  })()
    .catch((error) => {
      backendController = null;
      throw error;
    })
    .finally(() => {
      backendStartPromise = null;
    });

  return backendStartPromise;
}

async function waitForBackend(url, timeout = 20000) {
  const start = Date.now();
  console.log(`Waiting for backend to be ready at ${url}...`);
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(url, { timeout: 1000 }, () => {
        console.log('Backend is ready.');
        req.destroy();
        resolve();
      });
      req.on('error', (error) => {
        if (Date.now() - start > timeout) {
          reject(new Error(`Backend did not respond in time: ${error.message}`));
        } else {
          setTimeout(attempt, 500);
        }
      });
      req.end();
    };
    attempt();
  });
}

async function createWindow() {
  // Singleton pattern guard: If a window already exists, do nothing.
  if (mainWindow !== null) {
    mainWindow.focus();
    return;
  }

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'Private AI',
    webPreferences: {
      contextIsolation: true,
      // Note: The preload script path needs to be correct for the bundled app.
      // Webpack doesn't handle this automatically, so we use __dirname which points to `build` dir.
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // Set mainWindow to null when the window is closed.
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  const logPrefix = '[renderer]';
  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    const levels = ['log', 'warning', 'error'];
    const label = levels[level] ?? `level-${level}`;
    console.log(`${logPrefix} ${label}: ${message} (${sourceId}:${line})`);
  });

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    console.error(
      `${logPrefix} failed to load`,
      JSON.stringify({ errorCode, errorDescription, validatedURL, isMainFrame }, null, 2)
    );
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error(`${logPrefix} render process gone`, details);
  });

  mainWindow.webContents.on('did-finish-load', () => {
    console.log(`${logPrefix} finished load`);
  });

  let controller = backendController;
  if (!controller) {
    try {
      controller = await startBackend();
    } catch (error) {
      console.error('Failed to ensure backend is running:', error);
      throw error;
    }
  }

  const backendUrl =
    controller?.url || `http://${process.env.HOST || '127.0.0.1'}:${process.env.PORT || '3333'}`;
  try {
    await waitForBackend(backendUrl);
    // The renderer is now served by the backend.
    const renderUrl = `${backendUrl}/index.html`;
    console.log(`Loading renderer from: ${renderUrl}`);
    await mainWindow.loadURL(renderUrl);
  } catch (error) {
    console.error('Failed to load renderer:', error);
    // Optionally, load a local error page
    // mainWindow.loadFile('path/to/error.html');
  }

  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  if (shouldForceDevTools && app.isPackaged) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

// This is a workaround for a bug in Electron where `app.isPackaged` is not reliable
// in the main process on startup. We check for an env var set by electron-builder.
const isPackaged = app.isPackaged || process.env.APP_IMAGE;

// Quit when all windows are closed, except on macOS.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// On macOS, re-create a window when the dock icon is clicked and there are no other windows open.
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('quit', () => {
  const controller = backendController;
  backendController = null;
  if (controller?.stop) {
    console.log('Stopping backend server.');
    controller
      .stop()
      .catch((error) => console.warn('Failed to stop backend cleanly:', error));
  }
});

// Start the app once Electron is ready.
app.whenReady().then(async () => {
  try {
    await startBackend();
  } catch (error) {
    console.error('Unable to start backend server during app init:', error);
  }

  // On macOS, the window is created by the 'activate' event handler.
  if (process.platform !== 'darwin') {
    await createWindow();
  }
});
