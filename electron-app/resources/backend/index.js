const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { URL, pathToFileURL } = require('node:url');
const storage = require('./storage.js');
const conversations = require('./conversationStore.js');

const { resolveBaseDir } = storage;
const {
  ensureDirectories,
  listConversations,
  getConversation,
  createConversation,
  saveConversation,
  createMessage,
  buildSummary,
  createSessionId
} = conversations;

const DEFAULT_PORT = Number(process.env.PORT ?? 3333);
const DEFAULT_HOST = process.env.HOST ?? '127.0.0.1';
const DEFAULT_MODEL_FILENAME = 'gemma-3-1b-it-Q4_0.gguf';

const workspaceModelPath = path.join(__dirname, '..', 'Models', DEFAULT_MODEL_FILENAME);
const baseStorageDir = resolveBaseDir();

function pathExistsSync(candidate) {
  if (!candidate) return false;
  try {
    fs.accessSync(candidate);
    return true;
  } catch {
    return false;
  }
}

const sessionMap = new Map();
let singletonLlamaPromise = null;
let modelLoadPromise = null;
let cachedModelPath = null;
let llamaModulePromise = null;

function loadLlamaModule() {
  if (!llamaModulePromise) {
    llamaModulePromise = import('node-llama-cpp').catch((error) => {
      if (error?.code !== 'ERR_MODULE_NOT_FOUND') {
        throw error;
      }

      let modulePath;
      try {
        modulePath = require.resolve('node-llama-cpp');
      } catch (resolveError) {
        const resolutionError = new Error('Unable to locate node-llama-cpp module');
        resolutionError.cause = resolveError;
        throw resolutionError;
      }

      const moduleUrl = pathToFileURL(modulePath).href;
      return import(moduleUrl);
    });
  }
  return llamaModulePromise;
}

async function pathExists(candidate) {
  if (!candidate) return false;
  try {
    await fsp.access(candidate);
    return true;
  } catch {
    return false;
  }
}

async function resolveModelPath() {
  const explicit = process.env.PRIVATE_AI_MODEL_PATH;
  const defaultPath = path.join(baseStorageDir, 'Models', DEFAULT_MODEL_FILENAME);

  const candidates = [explicit, workspaceModelPath, defaultPath].filter(Boolean);
  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return path.resolve(candidate);
    }
  }

  throw new Error(
    [
      'Unable to locate a GGUF model file.',
      'Set PRIVATE_AI_MODEL_PATH or place a model named',
      `"${DEFAULT_MODEL_FILENAME}" inside either ${path.dirname(workspaceModelPath)} or ${path.dirname(defaultPath)}.`
    ].join(' ')
  );
}

async function ensureModel() {
  if (!singletonLlamaPromise) {
    const { getLlama } = await loadLlamaModule();
    singletonLlamaPromise = getLlama();
  }
  const llama = await singletonLlamaPromise;

  if (!modelLoadPromise) {
    modelLoadPromise = (async () => {
      try {
        const modelPath = await resolveModelPath();
        const model = await llama.loadModel({ modelPath });
        cachedModelPath = modelPath;
        return model;
      } catch (error) {
        modelLoadPromise = null;
        throw error;
      }
    })();
  }

  return modelLoadPromise;
}

async function ensureSession(sessionId, options = {}) {
  const key = sessionId ?? createSessionId();
  if (sessionMap.has(key)) {
    return { key, ...sessionMap.get(key) };
  }

  const model = await ensureModel();
  const context = await model.createContext();
  const { LlamaChatSession } = await loadLlamaModule();
  const chatSession = new LlamaChatSession({
    contextSequence: context.getSequence()
  });

  const entry = {
    session: chatSession,
    context,
    queue: Promise.resolve()
  };
  sessionMap.set(key, entry);

  // If there is existing chat history, load it into the session.
  if (options.chatHistory && Array.isArray(options.chatHistory) && options.chatHistory.length) {
    try {
      chatSession.setChatHistory(options.chatHistory);
    } catch (error) {
      console.warn(`Failed to restore chat history for session ${key}`, error);
    }
  }

  return { key, ...entry };
}

function sendEvent(res, payload) {
  if (res.writableEnded) return;
  res.write(`${JSON.stringify(payload)}\n`);
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  if (!chunks.length) {
    return {};
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Error('Invalid JSON payload');
  }
}

function contentTypeForPath(filePath) {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.json')) return 'application/json; charset=utf-8';
  if (filePath.endsWith('.svg')) return 'image/svg+xml; charset=utf-8';
  return 'text/plain; charset=utf-8';
}

async function serveStaticFile(res, filePath) {
  try {
    const data = await fsp.readFile(filePath);
    res.writeHead(200, { 'Content-Type': contentTypeForPath(filePath) });
    res.end(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Internal Server Error');
  }
}

function mapSettings(settings = {}) {
  const temperature = Number.isFinite(settings.temperature)
    ? settings.temperature
    : 0.7;
  const maxTokens = Number.isFinite(settings.maxTokens) ? settings.maxTokens : undefined;
  const topP = Number.isFinite(settings.topP) ? settings.topP : undefined;
  const topK = Number.isFinite(settings.topK) ? settings.topK : undefined;
  const contextStrategy = settings.contextStrategy ?? 'auto';
  return {
    temperature,
    maxTokens,
    topP,
    topK,
    contextStrategy
  };
}

function resolveContextShift(contextStrategy) {
  if (contextStrategy === 'none') {
    return null;
  }
  if (contextStrategy === 'sliding') {
    return {
      size: (sequence) => Math.max(1, Math.floor(sequence.context.contextSize / 10)),
      strategy: 'eraseFirstResponseAndKeepFirstSystem'
    };
  }
  return undefined;
}

function resolveRepeatPenalty(settings) {
  if (settings.repeatPenalty && typeof settings.repeatPenalty === 'object') {
    return settings.repeatPenalty;
  }
  return {
    lastTokens: 128,
    penalty: 1.1,
    penalizeNewLine: true
  };
}

async function handleChat(req, res) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error.message }));
    return;
  }

  const prompt = body.message?.toString().trim();
  if (!prompt) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Message cannot be empty.' }));
    return;
  }

  const sessionId = body.sessionId ?? createSessionId();
  const baseDir = body.baseDir ?? baseStorageDir;
  const settings = mapSettings(body.settings);

  const directories = await ensureDirectories(baseDir);

  let conversationResult = await getConversation(sessionId, baseDir);
  let conversation = conversationResult.conversation;
  let filePath = conversationResult.filePath;

  const isNewConversation = !conversation;
  if (!conversation) {
    const userMessage = createMessage('user', prompt);
    ({ conversation, filePath } = await createConversation({
      baseDir,
      sessionId,
      firstMessage: userMessage
    }));
  } else {
    const userMessage = createMessage('user', prompt);
    conversation.messages.push(userMessage);
    conversation.updatedAt = new Date().toISOString();
    await saveConversation(conversation, directories, filePath);
  }

  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive'
  });

  sendEvent(res, {
    type: 'session',
    sessionId: conversation.sessionId,
    isNew: isNewConversation,
    summary: buildSummary(conversation)
  });

  const abortController = new AbortController();
  const onClose = () => {
    abortController.abort();
  };
  req.on('close', onClose);

  let assistantMessage = createMessage('assistant', '');
  assistantMessage.streaming = true;
  sendEvent(res, {
    type: 'user-message',
    message: conversation.messages[conversation.messages.length - 1]
  });

  try {
    const { key: resolvedSessionId, session, queue } = await ensureSession(sessionId, {
      chatHistory: conversation.chatHistory
    });

    let accumulated = '';
    const run = queue
      .catch(() => undefined)
      .then(async () => {
        await session.prompt(prompt, {
          temperature: settings.temperature,
          maxTokens: settings.maxTokens,
          topP: settings.topP,
          topK: settings.topK,
          contextShift: resolveContextShift(settings.contextStrategy),
          repeatPenalty: resolveRepeatPenalty(settings),
          signal: abortController.signal,
          stopOnAbortSignal: true,
          onTextChunk(chunk) {
            accumulated += chunk;
            assistantMessage.content = accumulated;
            sendEvent(res, { type: 'token', chunk });
          }
        });
        assistantMessage.content = accumulated;
        assistantMessage.timestamp = new Date().toISOString();
        assistantMessage.streaming = false;
        conversation.messages.push(assistantMessage);
        conversation.chatHistory = session.getChatHistory();
        conversation.updatedAt = assistantMessage.timestamp;
        await saveConversation(conversation, directories, filePath);

        sendEvent(res, {
          type: 'done',
          message: assistantMessage,
          conversation: buildSummary(conversation)
        });
      });

    sessionMap.set(resolvedSessionId, {
      session,
      queue: run.then(() => undefined, () => undefined)
    });

    await run;
  } catch (error) {
    if (abortController.signal.aborted || error.name === 'AbortError') {
      console.warn('Generation aborted by client');
      assistantMessage.streaming = false;
      sendEvent(res, {
        type: 'aborted',
        message: assistantMessage,
        conversation: buildSummary(conversation)
      });
    } else {
      console.error('Chat error:', error);
      assistantMessage.streaming = false;
      sendEvent(res, {
        type: 'error',
        message: error.message ?? 'Failed to generate response'
      });
    }
  } finally {
    req.off('close', onClose);
    if (!res.writableEnded) {
      res.end();
    }
  }
}

async function handleListConversations(res) {
  try {
    const summaries = await listConversations(baseStorageDir);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ conversations: summaries }));
  } catch (error) {
    console.error('Failed to list conversations', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Failed to list conversations' }));
  }
}

async function handleGetConversation(res, sessionId) {
  try {
    const { conversation } = await getConversation(sessionId, baseStorageDir);
    if (!conversation) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Conversation not found' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ conversation, summary: buildSummary(conversation) }));
  } catch (error) {
    console.error(`Failed to fetch conversation ${sessionId}`, error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Failed to fetch conversation' }));
  }
}

async function handleCreateConversation(res, baseDir) {
  try {
    const { conversation } = await createConversation({ baseDir });
    res.writeHead(201, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ conversation, summary: buildSummary(conversation) }));
  } catch (error) {
    console.error('Failed to create conversation', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Failed to create conversation' }));
  }
}

const isDev = process.env.NODE_ENV === 'development';
const customRendererDir = process.env.PRIVATE_AI_RENDERER_DIR;
const defaultRendererDir = isDev
  ? path.resolve(__dirname, '..', '..', 'build', 'renderer')
  : path.join(process.resourcesPath, 'build', 'renderer');
const asarRendererDir = isDev ? null : path.join(process.resourcesPath, 'app.asar', 'build', 'renderer');

const rendererDirCandidates = [customRendererDir, defaultRendererDir, asarRendererDir].filter(Boolean);
const publicDir =
  rendererDirCandidates.find((candidate) => pathExistsSync(candidate)) ?? rendererDirCandidates[0];

if (!publicDir) {
  console.warn('Renderer assets directory could not be resolved. Static requests will fail.');
} else {
  console.log(`Serving renderer assets from: ${publicDir}`);
}

function createServer() {
  return http.createServer(async (req, res) => {
    try {
      const method = req.method ?? 'GET';
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      const pathname = url.pathname;

      if (method === 'GET' && pathname === '/api/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            status: 'ok',
            modelLoaded: Boolean(cachedModelPath),
            modelPath: cachedModelPath ?? null
          })
        );
        return;
      }

      if (method === 'GET' && pathname === '/api/conversations') {
        await handleListConversations(res);
        return;
      }

      if (method === 'POST' && pathname === '/api/conversations') {
        await handleCreateConversation(res, baseStorageDir);
        return;
      }

      if (method === 'GET' && pathname.startsWith('/api/conversations/')) {
        const sessionId = pathname.split('/').pop();
        await handleGetConversation(res, sessionId);
        return;
      }

      if (method === 'POST' && pathname === '/api/chat') {
        await handleChat(req, res);
        return;
      }

      const relative = pathname === '/' ? '/index.html' : pathname;
      const filePath = path.join(publicDir, relative);
      await serveStaticFile(res, filePath);
    } catch (error) {
      console.error('Request handling error:', error);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
      }
      if (!res.writableEnded) {
        res.end(JSON.stringify({ error: 'Internal Server Error' }));
      }
    }
  });
}

let runningServer = null;

async function startServer(options = {}) {
  if (runningServer) {
    return runningServer;
  }

  const host = options.host ?? DEFAULT_HOST;
  const port = Number(options.port ?? DEFAULT_PORT);
  const server = createServer();

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });

  console.log(`Local LLM server running at http://${host}:${port}`);
  resolveModelPath()
    .then((modelPath) => console.log(`Waiting to load model: ${modelPath}`))
    .catch((error) => console.warn(`Model discovery warning: ${error.message}`));

  const stop = () =>
    new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });

  runningServer = {
    server,
    host,
    port,
    url: `http://${host}:${port}`,
    stop
  };

  server.once('close', () => {
    runningServer = null;
  });

  if (typeof options.onListening === 'function') {
    try {
      options.onListening(runningServer);
    } catch (error) {
      console.warn('onListening callback failed:', error);
    }
  }

  return runningServer;
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error('Failed to start backend server', error);
    process.exit(1);
  });
}

module.exports = {
  startServer
};
