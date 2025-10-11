const http = require('http');
const path = require('path');
const fs = require('fs/promises');
const { URL } = require('url');
const { hardwareScanHandler } = require('../api/hardwareHandler');
const { sendMessage, getSessionMessages } = require('../chat/chatService');
const { resolveBaseDir } = require('../utils/baseDir');

function createJsonResponse(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req
      .on('data', (chunk) => chunks.push(chunk))
      .on('end', () => {
        if (!chunks.length) {
          resolve({});
          return;
        }
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          resolve(data);
        } catch (error) {
          reject(new Error('Invalid JSON payload'));
        }
      })
      .on('error', reject);
  });
}

async function serveStaticFile(res, filePath, contentType = 'text/html') {
  try {
    const data = await fs.readFile(filePath);
    res.statusCode = 200;
    res.setHeader('Content-Type', contentType);
    res.end(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      res.statusCode = 404;
      res.end('Not Found');
      return;
    }
    res.statusCode = 500;
    res.end('Internal Server Error');
  }
}

function resolveContentType(filePath) {
  if (filePath.endsWith('.js')) return 'application/javascript';
  if (filePath.endsWith('.css')) return 'text/css';
  if (filePath.endsWith('.json')) return 'application/json';
  if (filePath.endsWith('.svg')) return 'image/svg+xml';
  return 'text/plain';
}

async function createServer(options = {}) {
  const port = options.port || 5173;
  const baseDir = resolveBaseDir(options.baseDir);
  const publicDir = path.resolve(options.publicDir || path.join(process.cwd(), 'public'));

  const server = http.createServer(async (req, res) => {
    const method = req.method || 'GET';
    const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
    const pathname = parsedUrl.pathname;

    if (method === 'GET' && pathname === '/api/hardware') {
      await hardwareScanHandler(req, res);
      return;
    }

    if (method === 'POST' && pathname === '/api/chat') {
      try {
        const body = await readJsonBody(req);
        const response = await sendMessage({
          message: body.message,
          sessionId: body.sessionId,
          baseDir
        });
        createJsonResponse(res, 200, response);
      } catch (error) {
        createJsonResponse(res, 400, { error: error.message });
      }
      return;
    }

    if (method === 'GET' && pathname.startsWith('/api/chat/session/')) {
      const sessionId = pathname.split('/').pop();
      try {
        const messages = await getSessionMessages(sessionId, baseDir);
        createJsonResponse(res, 200, { sessionId, messages });
      } catch (error) {
        createJsonResponse(res, 500, { error: 'Unable to load session messages' });
      }
      return;
    }

    // Static files
    const relativePath = pathname === '/' ? '/index.html' : pathname;
    const filePath = path.join(publicDir, relativePath);
    const contentType = resolveContentType(filePath);
    await serveStaticFile(res, filePath, contentType);
  });

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      resolve({ server, port, baseDir, publicDir });
    });
  });
}

module.exports = {
  createServer
};
