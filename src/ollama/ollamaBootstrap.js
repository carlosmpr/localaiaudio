const fs = require('fs/promises');
const path = require('path');

async function checkOllamaInstalled() {
  return { installed: true, detail: 'Stubbed check assumes Ollama is available.' };
}

async function installOllama() {
  return { installed: true, detail: 'Stubbed installer skipped real download.' };
}

async function startOllamaService() {
  return { running: true, pid: 4321, detail: 'Stubbed service start succeeded.' };
}

async function pullModel(modelName) {
  return {
    model: modelName,
    status: 'available',
    detail: 'Stubbed model pull recorded; no network call executed.'
  };
}

async function ensureOllamaReady(options = {}) {
  const { model = 'phi3:mini', logDir } = options;
  const events = [];

  let installCheck = await checkOllamaInstalled();
  events.push({ step: 'checkInstalled', ...installCheck });

  if (!installCheck.installed) {
    installCheck = await installOllama();
    events.push({ step: 'install', ...installCheck });
  }

  const service = await startOllamaService();
  events.push({ step: 'startService', ...service });

  const modelPull = await pullModel(model);
  events.push({ step: 'pullModel', ...modelPull });

  if (logDir) {
    const logPath = path.join(logDir, 'installer.log');
    const timestamp = new Date().toISOString();
    const body = events.map((event) => `${timestamp} ${event.step} ${event.detail}`).join('\n');
    await fs.appendFile(logPath, `${body}\n`, 'utf8');
  }

  return {
    installCheck,
    service,
    model: modelPull,
    events
  };
}

module.exports = {
  ensureOllamaReady,
  checkOllamaInstalled,
  installOllama,
  startOllamaService,
  pullModel
};
