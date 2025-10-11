const fs = require('fs/promises');
const path = require('path');

const DEFAULT_SUBDIRECTORIES = ['Chats', 'Config', 'Models', 'Logs', 'Index'];

/**
 * Ensures the PrivateAI storage layout exists.
 * Returns absolute paths for the base directory and each child directory.
 */
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
  createStorageLayout,
  DEFAULT_SUBDIRECTORIES
};
