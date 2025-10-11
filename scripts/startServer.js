const path = require('path');
const { createServer } = require('../src/server/httpServer');

async function run() {
  try {
    const publicDir = path.join(process.cwd(), 'public');
    const result = await createServer({ port: process.env.PORT || 4173, publicDir });
    console.log(`PrivateAI MVP server running at http://localhost:${result.port}`);
    console.log(`Storage base directory: ${result.baseDir}`);
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exitCode = 1;
  }
}

run();
