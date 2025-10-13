const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const DEFAULT_SUBDIRECTORIES = ['Chats', 'Config', 'Models', 'Logs', 'Index'];

function resolveBaseDir(explicitDir) {
  if (explicitDir) {
    return path.resolve(explicitDir);
  }
  if (process.env.PRIVATE_AI_BASE_DIR) {
    return path.resolve(process.env.PRIVATE_AI_BASE_DIR);
  }
  return path.join(os.homedir(), 'PrivateAI');
}

async function createStorageLayout(baseDir) {
  const resolvedBase = path.resolve(baseDir);
  await fs.mkdir(resolvedBase, { recursive: true });

  const directories = { baseDir: resolvedBase };
  for (const name of DEFAULT_SUBDIRECTORIES) {
    const fullPath = path.join(resolvedBase, name);
    await fs.mkdir(fullPath, { recursive: true });
    directories[name.toLowerCase()] = fullPath;
  }

  return directories;
}

module.exports = {
  DEFAULT_SUBDIRECTORIES,
  resolveBaseDir,
  createStorageLayout
};
