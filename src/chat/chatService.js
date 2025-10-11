const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { createStorageLayout } = require('../setup/createStorageLayout');
const { resolveBaseDir } = require('../utils/baseDir');

function createSessionId() {
  const timeComponent = Date.now().toString(36);
  const randomComponent = crypto.randomBytes(4).toString('hex');
  return `${timeComponent}-${randomComponent}`;
}

async function appendJsonl(filePath, record) {
  const line = `${JSON.stringify(record)}\n`;
  await fs.appendFile(filePath, line, 'utf8');
}

function generateAssistantReply(message) {
  if (!message || !message.trim()) {
    return 'I need a bit more detail to help out. Try asking a question or describing a task.';
  }
  if (message.trim().length < 20) {
    return `You said: "${message.trim()}". In the MVP this is an echo; later it will call the selected model.`;
  }
  return `Thanks for the detailed prompt. In the full build, I will reason over it using the recommended local model. For now, here is an acknowledgement: "${message.trim().slice(0, 120)}"`;
}

async function sendMessage({ message, sessionId, baseDir: explicitBase } = {}) {
  if (!message) {
    throw new Error('Message is required.');
  }

  const baseDir = resolveBaseDir(explicitBase);
  const directories = await createStorageLayout(baseDir);

  const activeSessionId = sessionId || createSessionId();
  const filePath = path.join(directories.chats, `${activeSessionId}.jsonl`);
  const timestamp = new Date().toISOString();

  const userRecord = { id: crypto.randomUUID(), role: 'user', content: message, timestamp };
  await appendJsonl(filePath, userRecord);

  const assistantContent = generateAssistantReply(message);
  const assistantRecord = {
    id: crypto.randomUUID(),
    role: 'assistant',
    content: assistantContent,
    timestamp: new Date().toISOString()
  };
  await appendJsonl(filePath, assistantRecord);

  return {
    sessionId: activeSessionId,
    messages: [userRecord, assistantRecord],
    filePath
  };
}

async function getSessionMessages(sessionId, baseDir) {
  if (!sessionId) {
    return [];
  }
  const resolvedBase = resolveBaseDir(baseDir);
  const directories = await createStorageLayout(resolvedBase);
  const filePath = path.join(directories.chats, `${sessionId}.jsonl`);

  try {
    const data = await fs.readFile(filePath, 'utf8');
    return data
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

module.exports = {
  sendMessage,
  getSessionMessages
};
