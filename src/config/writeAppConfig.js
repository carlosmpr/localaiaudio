const fs = require('fs/promises');
const path = require('path');

/**
 * Writes the application configuration file under Config/app.json.
 * Returns the absolute path to the written file.
 */
async function writeAppConfig(baseDir, config) {
  const resolvedBase = path.resolve(baseDir);
  const configDir = path.join(resolvedBase, 'Config');
  await fs.mkdir(configDir, { recursive: true });

  const configPath = path.join(configDir, 'app.json');
  const serialized = JSON.stringify(config, null, 2);
  await fs.writeFile(configPath, serialized, 'utf8');
  return configPath;
}

module.exports = {
  writeAppConfig
};
