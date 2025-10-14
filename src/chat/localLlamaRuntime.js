const fs = require('fs/promises');
const path = require('path');
const { getLlama, LlamaChatSession } = require('node-llama-cpp');
const { resolveBaseDir } = require('../utils/baseDir');

const DEFAULT_MODEL_FILENAME = 'gemma-3-1b-it-Q4_0.gguf';
const DEFAULT_SESSION_KEY = '__default__';

let llamaSingletonPromise = null;
let modelLoadPromise = null;
let cachedModelPath = null;

const sessionCache = new Map();

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveModelPath(baseDir, explicitPath) {
  const candidates = [
    explicitPath,
    process.env.PRIVATE_AI_MODEL_PATH,
    baseDir ? path.join(baseDir, 'Models', DEFAULT_MODEL_FILENAME) : null
  ]
    .filter(Boolean)
    .map((candidate) => path.resolve(candidate));

  for (const candidate of candidates) {
    if (await fileExists(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    [
      'No GGUF model file found.',
      'Set PRIVATE_AI_MODEL_PATH or place a model (e.g., gemma-3-1b-it-Q4_0.gguf)',
      'inside the Models directory of the PrivateAI storage location.'
    ].join(' ')
  );
}

async function ensureModel({ baseDir, modelPath: overrideModelPath } = {}) {
  const resolvedBase = resolveBaseDir(baseDir);

  if (!llamaSingletonPromise) {
    llamaSingletonPromise = getLlama();
  }
  const llama = await llamaSingletonPromise;

  if (!modelLoadPromise) {
    modelLoadPromise = (async () => {
      const modelPath = await resolveModelPath(resolvedBase, overrideModelPath);
      const model = await llama.loadModel({ modelPath });
      cachedModelPath = modelPath;
      return model;
    })().catch((error) => {
      modelLoadPromise = null;
      throw error;
    });
  }

  const model = await modelLoadPromise;
  return { llama, model, modelPath: cachedModelPath };
}

async function ensureSession(sessionId, options = {}) {
  const key = sessionId || DEFAULT_SESSION_KEY;
  if (sessionCache.has(key)) {
    return sessionCache.get(key);
  }

  const { baseDir, modelPath, maxContextLength, chatWrapper } = options;
  const { model } = await ensureModel({ baseDir, modelPath });

  const context = await model.createContext(
    maxContextLength ? { contextSize: maxContextLength } : undefined
  );
  const session = new LlamaChatSession({
    contextSequence: context.getSequence(),
    chatWrapper
  });

  const entry = { session, context, queue: Promise.resolve() };
  sessionCache.set(key, entry);
  return entry;
}

async function generateReply({ sessionId, message, baseDir, modelPath, options = {} }) {
  if (!message || !message.trim()) {
    throw new Error('Cannot generate a reply for an empty message.');
  }

  const entry = await ensureSession(sessionId, { baseDir, modelPath, ...options });
  const { session } = entry;

  const generationOptions = {
    temperature: options.temperature ?? 0.7,
    maxTokens: options.maxTokens ?? 512,
    topP: options.topP,
    topK: options.topK
  };

  // Queue prompts serially per session to avoid concurrent context access.
  const run = entry.queue
    .catch(() => undefined)
    .then(async () => {
      const response = await session.prompt(message, generationOptions);
      return typeof response === 'string' ? response.trim() : String(response);
    });

  entry.queue = run.then(
    () => undefined,
    () => undefined
  );

  return run;
}

function getLoadedModelPath() {
  return cachedModelPath;
}

function resetRuntime() {
  sessionCache.clear();
  modelLoadPromise = null;
  cachedModelPath = null;
  llamaSingletonPromise = null;
}

module.exports = {
  generateReply,
  ensureModel,
  getLoadedModelPath,
  resetRuntime
};
