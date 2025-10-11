const { scanHardware } = require('../hardware/hardwareScanStub');
const { createStorageLayout } = require('../setup/createStorageLayout');
const { writeAppConfig } = require('../config/writeAppConfig');
const { ensureOllamaReady } = require('../ollama/ollamaBootstrap');
const { resolveBaseDir } = require('../utils/baseDir');

/**
 * Executes the local installer workflow:
 * 1. Scan hardware (stubbed for now).
 * 2. Ensure storage layout exists.
 * 3. Write initial application configuration.
 */
async function runInstaller(options = {}) {
  const baseDir = resolveBaseDir(options.baseDir);

  const targetModel = options.model || 'phi3:mini';
  const hardware = await scanHardware();
  const directories = await createStorageLayout(baseDir);

  const ollama = await ensureOllamaReady({
    model: targetModel,
    logDir: directories.logs
  });

  const configPayload = {
    version: '0.1.0',
    createdAt: new Date().toISOString(),
    hardware,
    model: {
      selected: targetModel,
      status: ollama.model.status
    },
    runtime: {
      ollama
    },
    paths: directories
  };

  const configPath = await writeAppConfig(baseDir, configPayload);

  return {
    baseDir: directories.baseDir,
    hardware,
    directories,
    configPath
  };
}

module.exports = {
  runInstaller
};
