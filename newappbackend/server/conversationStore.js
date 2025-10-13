import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { createStorageLayout, resolveBaseDir } from './storage.js';

function now() {
  return new Date().toISOString();
}

function createMessage(role, content) {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    timestamp: now()
  };
}

export function createSessionId() {
  const timeComponent = Date.now().toString(36);
  const randomComponent = crypto.randomBytes(4).toString('hex');
  return `${timeComponent}-${randomComponent}`;
}

function conversationPath(directories, sessionId) {
  return path.join(directories.chats, `${sessionId}.json`);
}

function deriveTitle(messages) {
  const firstUser = messages.find((msg) => msg.role === 'user' && msg.content?.trim());
  if (!firstUser) {
    return 'New chat';
  }
  const line = firstUser.content.trim().split('\n')[0] ?? 'New chat';
  return line.length > 80 ? `${line.slice(0, 80)}…` : line;
}

function derivePreview(messages) {
  const last = [...messages]
    .reverse()
    .find((msg) => typeof msg.content === 'string' && msg.content.trim());
  if (!last) return null;
  const line = last.content.trim().split('\n')[0] ?? '';
  return line.slice(0, 160);
}

function buildSummary(conversation) {
  return {
    sessionId: conversation.sessionId,
    title: conversation.title,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    messageCount: conversation.messages.length,
    preview: conversation.preview
  };
}

function normaliseConversation(raw) {
  if (!raw) return null;
  const messages = Array.isArray(raw.messages) ? raw.messages : [];
  const conversation = {
    sessionId: raw.sessionId ?? createSessionId(),
    messages,
    chatHistory: raw.chatHistory ?? null,
    createdAt: raw.createdAt ?? now(),
    updatedAt: raw.updatedAt ?? raw.createdAt ?? now(),
    title: raw.title ?? deriveTitle(messages),
    preview: raw.preview ?? derivePreview(messages)
  };
  conversation.title = deriveTitle(conversation.messages);
  conversation.preview = derivePreview(conversation.messages);
  return conversation;
}

async function readConversationFile(filePath) {
  try {
    const data = await fs.readFile(filePath, 'utf8');
    return normaliseConversation(JSON.parse(data));
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function writeConversationFile(filePath, conversation) {
  const data = JSON.stringify(
    {
      ...conversation,
      // ensure computed fields persisted
      title: deriveTitle(conversation.messages),
      preview: derivePreview(conversation.messages),
      updatedAt: conversation.updatedAt ?? now()
    },
    null,
    2
  );
  await fs.writeFile(filePath, data, 'utf8');
}

export async function ensureDirectories(baseDir) {
  const resolved = resolveBaseDir(baseDir);
  return createStorageLayout(resolved);
}

export async function loadConversation(sessionId, baseDir) {
  const directories = await ensureDirectories(baseDir);
  const filePath = conversationPath(directories, sessionId);
  const conversation = await readConversationFile(filePath);
  return { conversation, directories, filePath };
}

export async function listConversations(baseDir) {
  const directories = await ensureDirectories(baseDir);
  let entries = [];
  try {
    entries = await fs.readdir(directories.chats, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
  const summaries = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith('.json')) continue;
    const sessionId = entry.name.slice(0, -'.json'.length);
    try {
      const raw = await readConversationFile(path.join(directories.chats, entry.name));
      if (!raw) continue;
      summaries.push(buildSummary(raw));
    } catch (error) {
      console.warn(`Failed to read conversation ${sessionId}`, error);
    }
  }
  summaries.sort((a, b) => {
    if (a.updatedAt && b.updatedAt) {
      if (a.updatedAt === b.updatedAt) {
        return b.sessionId.localeCompare(a.sessionId);
      }
      return b.updatedAt.localeCompare(a.updatedAt);
    }
    if (a.updatedAt) return -1;
    if (b.updatedAt) return 1;
    return b.sessionId.localeCompare(a.sessionId);
  });
  return summaries;
}

export async function getConversation(sessionId, baseDir) {
  const { conversation, directories, filePath } = await loadConversation(sessionId, baseDir);
  if (!conversation) {
    return { conversation: null, directories, filePath };
  }
  return { conversation, directories, filePath };
}

export async function createConversation({ baseDir, sessionId, firstMessage }) {
  const directories = await ensureDirectories(baseDir);
  const effectiveSessionId = sessionId ?? createSessionId();
  const filePath = conversationPath(directories, effectiveSessionId);
  const conversation = normaliseConversation({
    sessionId: effectiveSessionId,
    messages: firstMessage ? [firstMessage] : [],
    createdAt: now(),
    updatedAt: now()
  });
  if (conversation.messages.length === 0 && firstMessage) {
    conversation.messages.push(firstMessage);
  }
  conversation.title = deriveTitle(conversation.messages);
  conversation.preview = derivePreview(conversation.messages);
  await writeConversationFile(filePath, conversation);
  return { conversation, directories, filePath };
}

export async function saveConversation(conversation, directories, filePath) {
  conversation.messages = conversation.messages.map((msg) => {
    const { streaming, ...rest } = msg;
    return rest;
  });
  conversation.updatedAt = now();
  conversation.title = deriveTitle(conversation.messages);
  conversation.preview = derivePreview(conversation.messages);
  await writeConversationFile(filePath, conversation);
  return conversation;
}

export { createMessage, buildSummary };
