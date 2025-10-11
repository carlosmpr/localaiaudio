const os = require('os');
const path = require('path');

function resolveBaseDir(explicitDir) {
  if (explicitDir) {
    return path.resolve(explicitDir);
  }
  if (process.env.PRIVATE_AI_BASE_DIR) {
    return path.resolve(process.env.PRIVATE_AI_BASE_DIR);
  }
  return path.join(os.homedir(), 'PrivateAI');
}

module.exports = {
  resolveBaseDir
};
