const conversationListEl = document.getElementById('conversationList');
const messagesEl = document.getElementById('messages');
const chatForm = document.getElementById('chatForm');
const chatInput = document.getElementById('chatInput');
const sendBtn = document.getElementById('sendBtn');
const stopBtn = document.getElementById('stopBtn');
const charCountEl = document.getElementById('charCount');
const modelStatusEl = document.getElementById('modelStatus');
const newChatBtn = document.getElementById('newChatBtn');

const settingsModal = document.getElementById('settingsModal');
const settingsBtn = document.getElementById('settingsBtn');
const cancelSettingsBtn = document.getElementById('cancelSettingsBtn');
const saveSettingsBtn = document.getElementById('saveSettingsBtn');
const temperatureInput = document.getElementById('temperatureInput');
const maxTokensInput = document.getElementById('maxTokensInput');
const contextStrategySelect = document.getElementById('contextStrategySelect');
const topPInput = document.getElementById('topPInput');
const topKInput = document.getElementById('topKInput');

const toastEl = document.getElementById('toast');

const API_HOST = window.env?.HOST ?? '127.0.0.1';
const API_PORT = window.env?.PORT ?? '3333';
const API_BASE = `http://${API_HOST}:${API_PORT}`;

function apiFetch(path, options) {
  return fetch(`${API_BASE}${path}`, options);
}

const state = {
  conversations: [],
  activeConversationId: null,
  messages: [],
  streaming: false,
  pendingUserId: null,
  pendingAssistantId: null,
  abortController: null,
  messageElements: new Map(),
  conversationElements: new Map(),
  settings: {
    temperature: 0.7,
    maxTokens: null,
    contextStrategy: 'auto',
    topP: null,
    topK: null
  }
};

function showToast(message, duration = 3000) {
  toastEl.textContent = message;
  toastEl.classList.add('visible');
  setTimeout(() => toastEl.classList.remove('visible'), duration);
}

function formatTimestamp(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function updateCharCount() {
  const length = chatInput.value.trim().length;
  charCountEl.textContent = `${length} character${length === 1 ? '' : 's'}`;
}

function clearMessages() {
  state.messages = [];
  state.messageElements.forEach((el) => el.remove());
  state.messageElements.clear();
}

function renderMessage(message) {
  const existing = state.messageElements.get(message.id);
  if (existing) {
    const bubble = existing.querySelector('.message-bubble');
    bubble.textContent = message.content ?? '';
    existing.classList.toggle('streaming', Boolean(message.streaming));
    const meta = existing.querySelector('.message-meta');
    if (meta) {
      meta.textContent = formatTimestamp(message.timestamp);
    }
    return existing;
  }

  const wrapper = document.createElement('div');
  wrapper.className = `message message--${message.role}`;
  wrapper.dataset.id = message.id;

  const avatar = document.createElement('div');
  avatar.className = 'message-avatar';
  avatar.textContent = message.role === 'assistant' ? 'AI' : 'You';

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  bubble.textContent = message.content ?? '';

  const meta = document.createElement('div');
  meta.className = 'message-meta';
  meta.textContent = formatTimestamp(message.timestamp);

  wrapper.append(avatar, bubble, meta);
  wrapper.classList.toggle('streaming', Boolean(message.streaming));

  messagesEl.appendChild(wrapper);
  state.messageElements.set(message.id, wrapper);
  messagesEl.scrollTo({ top: messagesEl.scrollHeight, behavior: 'smooth' });
  return wrapper;
}

function replaceMessage(oldId, newMessage) {
  const index = state.messages.findIndex((msg) => msg.id === oldId);
  if (index !== -1) {
    state.messages.splice(index, 1, newMessage);
  } else {
    state.messages.push(newMessage);
  }
  const oldEl = state.messageElements.get(oldId);
  if (oldEl) {
    oldEl.remove();
    state.messageElements.delete(oldId);
  }
  renderMessage(newMessage);
}

function upsertMessage(message) {
  const index = state.messages.findIndex((msg) => msg.id === message.id);
  if (index === -1) {
    state.messages.push(message);
  } else {
    state.messages.splice(index, 1, { ...state.messages[index], ...message });
  }
  renderMessage(message);
}

function setModelStatus(text, isError = false) {
  modelStatusEl.textContent = text;
  modelStatusEl.style.color = isError ? '#fca5a5' : 'var(--text-muted)';
}

async function refreshStatus() {
  try {
    setModelStatus('Checking runtime…');
    const res = await apiFetch('/api/health');
    if (!res.ok) throw new Error('Health check failed');
    const payload = await res.json();
    if (payload.modelLoaded && payload.modelPath) {
      setModelStatus(`Model ready: ${payload.modelPath}`);
    } else if (payload.modelPath) {
      setModelStatus(`Preparing model at ${payload.modelPath}`);
    } else {
      setModelStatus('Model not loaded yet. Add a GGUF model to start.', true);
    }
  } catch (error) {
    setModelStatus(`Runtime unavailable: ${error.message}`, true);
  }
}

function renderConversationList() {
  conversationListEl.innerHTML = '';
  state.conversationElements.clear();
  state.conversations.forEach((conversation) => {
    const item = document.createElement('div');
    item.className = 'conversation-item';
    item.dataset.id = conversation.sessionId;
    if (conversation.sessionId === state.activeConversationId) {
      item.classList.add('active');
    }

    const title = document.createElement('h4');
    title.textContent = conversation.title ?? 'New chat';

    const preview = document.createElement('p');
    preview.textContent = conversation.preview ?? '—';

    item.append(title, preview);
    item.addEventListener('click', () => {
      if (state.streaming) return;
      setActiveConversation(conversation.sessionId);
    });

    conversationListEl.appendChild(item);
    state.conversationElements.set(conversation.sessionId, item);
  });
}

async function loadConversations() {
  try {
    const res = await apiFetch('/api/conversations');
    if (!res.ok) throw new Error('Failed to load conversations');
    const payload = await res.json();
    state.conversations = payload.conversations ?? [];
    renderConversationList();
  } catch (error) {
    console.warn('Unable to load conversations', error);
  }
}

async function setActiveConversation(sessionId, { silent } = {}) {
  if (state.streaming) {
    showToast('Wait for the current response to finish or stop it first.');
    return;
  }
  state.activeConversationId = sessionId;
  state.pendingUserId = null;
  state.pendingAssistantId = null;
  clearMessages();

  state.conversationElements.forEach((el, id) => {
    el.classList.toggle('active', id === sessionId);
  });

  if (!sessionId) {
    modelStatusEl.textContent = 'New conversation — awaiting your message.';
    return;
  }

  try {
    const res = await apiFetch(`/api/conversations/${sessionId}`);
    if (!res.ok) throw new Error('Conversation not found');
    const payload = await res.json();
    const conversation = payload.conversation ?? { messages: [] };
    state.messages = [];
    conversation.messages.forEach((msg) => {
      state.messages.push(msg);
      renderMessage(msg);
    });
    messagesEl.scrollTo({ top: messagesEl.scrollHeight });
    if (!silent) {
      modelStatusEl.textContent = `Conversation updated ${formatTimestamp(
        conversation.updatedAt
      )}`;
    }
  } catch (error) {
    showToast(error.message);
  }
}

function localMessage(role, content) {
  return {
    id: `${role}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    role,
    content,
    timestamp: new Date().toISOString()
  };
}

async function createNewConversation() {
  if (state.streaming) {
    showToast('Stop the current response before starting a new chat.');
    return;
  }
  try {
    const res = await apiFetch('/api/conversations', { method: 'POST' });
    if (!res.ok) throw new Error('Unable to create conversation');
    const payload = await res.json();
    const summary = payload.summary;
    state.conversations.unshift(summary);
    renderConversationList();
    await setActiveConversation(summary.sessionId, { silent: true });
  } catch (error) {
    showToast(error.message);
  }
}

async function sendMessage(event) {
  event.preventDefault();
  if (state.streaming) return;

  const message = chatInput.value.trim();
  if (!message) {
    showToast('Please enter a message first.');
    return;
  }

  const localUser = localMessage('user', message);
  state.messages.push(localUser);
  state.pendingUserId = localUser.id;
  renderMessage(localUser);
  chatInput.value = '';
  updateCharCount();

  const payload = {
    message,
    sessionId: state.activeConversationId,
    settings: state.settings
  };

  state.streaming = true;
  stopBtn.classList.remove('hidden');
  sendBtn.disabled = true;
  chatInput.disabled = true;

  state.abortController = new AbortController();

  try {
    const response = await apiFetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: state.abortController.signal
    });

    if (!response.ok || !response.body) {
      const errorPayload = await response.json().catch(() => ({}));
      throw new Error(errorPayload.error ?? `Request failed with status ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    state.pendingAssistantId = null;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newlineIndex;
      while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (!line) continue;

        let event;
        try {
          event = JSON.parse(line);
        } catch (error) {
          console.warn('Failed to parse stream chunk', error, line);
          continue;
        }
        handleStreamEvent(event);
      }
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      showToast('Generation aborted.');
    } else {
      console.error('Chat error', error);
      showToast(error.message ?? 'Chat request failed');
    }
  } finally {
    state.streaming = false;
    state.abortController = null;
    stopBtn.classList.add('hidden');
    sendBtn.disabled = false;
    chatInput.disabled = false;
    chatInput.focus();
    await loadConversations();
  }
}

function handleStreamEvent(event) {
  switch (event.type) {
    case 'session': {
      state.activeConversationId = event.sessionId;
      const summary = event.summary;
      const existingIndex = state.conversations.findIndex(
        (conv) => conv.sessionId === summary.sessionId
      );
      if (existingIndex === -1) {
        state.conversations.unshift(summary);
      } else {
        state.conversations.splice(existingIndex, 1, summary);
      }
      renderConversationList();
      state.conversationElements.forEach((el, id) => {
        el.classList.toggle('active', id === summary.sessionId);
      });
      break;
    }

    case 'user-message': {
      const message = event.message;
      if (state.pendingUserId) {
        replaceMessage(state.pendingUserId, message);
        state.pendingUserId = null;
      } else {
        upsertMessage(message);
      }
      break;
    }

    case 'token': {
      if (!state.pendingAssistantId) {
        const tempAssistant = localMessage('assistant', '');
        tempAssistant.streaming = true;
        state.pendingAssistantId = tempAssistant.id;
        state.messages.push(tempAssistant);
        renderMessage(tempAssistant);
      }
      const assistantIndex = state.messages.findIndex(
        (msg) => msg.id === state.pendingAssistantId
      );
      if (assistantIndex !== -1) {
        state.messages[assistantIndex].streaming = true;
        state.messages[assistantIndex].content += event.chunk;
        const el = state.messageElements.get(state.pendingAssistantId);
        if (el) {
          el.querySelector('.message-bubble').textContent = state.messages[assistantIndex].content;
          el.classList.add('streaming');
        }
        messagesEl.scrollTo({ top: messagesEl.scrollHeight });
      }
      break;
    }

    case 'done': {
      const message = event.message;
      message.streaming = false;
      if (state.pendingAssistantId) {
        replaceMessage(state.pendingAssistantId, message);
        state.pendingAssistantId = null;
      } else {
        upsertMessage(message);
      }
      if (event.conversation) {
        const summary = event.conversation;
        const existingIndex = state.conversations.findIndex(
          (conv) => conv.sessionId === summary.sessionId
        );
        if (existingIndex === -1) state.conversations.unshift(summary);
        else state.conversations.splice(existingIndex, 1, summary);
        renderConversationList();
      }
      break;
    }

    case 'aborted': {
      if (state.pendingAssistantId) {
        const msg = state.messages.find((m) => m.id === state.pendingAssistantId);
        if (msg) {
          msg.streaming = false;
          const el = state.messageElements.get(state.pendingAssistantId);
          if (el) el.classList.remove('streaming');
        }
        state.pendingAssistantId = null;
      }
      if (event.conversation) {
        const summary = event.conversation;
        const existingIndex = state.conversations.findIndex(
          (conv) => conv.sessionId === summary.sessionId
        );
        if (existingIndex === -1) state.conversations.unshift(summary);
        else state.conversations.splice(existingIndex, 1, summary);
        renderConversationList();
      }
      break;
    }

    case 'error': {
      showToast(event.message ?? 'Generation failed');
      if (state.pendingAssistantId) {
        const el = state.messageElements.get(state.pendingAssistantId);
        if (el) el.remove();
        state.messageElements.delete(state.pendingAssistantId);
        state.messages = state.messages.filter((msg) => msg.id !== state.pendingAssistantId);
        state.pendingAssistantId = null;
      }
      break;
    }

    default:
      break;
  }
}

function stopGeneration() {
  if (!state.streaming) return;
  state.abortController?.abort();
}

function toggleSettingsModal(show) {
  settingsModal.classList.toggle('visible', show);
  if (show) {
    temperatureInput.value = state.settings.temperature;
    maxTokensInput.value = state.settings.maxTokens ?? '';
    contextStrategySelect.value = state.settings.contextStrategy ?? 'auto';
    topPInput.value = state.settings.topP ?? '';
    topKInput.value = state.settings.topK ?? '';
  }
}

function saveSettings() {
  state.settings.temperature = Number.parseFloat(temperatureInput.value) || 0.7;
  state.settings.maxTokens = maxTokensInput.value ? Number.parseInt(maxTokensInput.value, 10) : null;
  state.settings.contextStrategy = contextStrategySelect.value;
  state.settings.topP = topPInput.value ? Number.parseFloat(topPInput.value) : null;
  state.settings.topK = topKInput.value ? Number.parseInt(topKInput.value, 10) : null;
  toggleSettingsModal(false);
  showToast('Settings updated', 2000);
}

function handleTextareaResize(event) {
  const textarea = event.target;
  textarea.style.height = 'auto';
  textarea.style.height = `${Math.min(textarea.scrollHeight, 320)}px`;
}

function handleKeyboardShortcuts(event) {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
    sendBtn.click();
  }
}

async function init() {
  updateCharCount();
  await refreshStatus();
  await loadConversations();
  if (state.conversations.length > 0) {
    await setActiveConversation(state.conversations[0].sessionId, { silent: true });
  }
}

chatForm.addEventListener('submit', sendMessage);
chatInput.addEventListener('input', () => {
  updateCharCount();
  handleTextareaResize({ target: chatInput });
});
chatInput.addEventListener('keydown', handleKeyboardShortcuts);
stopBtn.addEventListener('click', stopGeneration);
newChatBtn.addEventListener('click', createNewConversation);

settingsBtn.addEventListener('click', () => toggleSettingsModal(true));
cancelSettingsBtn.addEventListener('click', () => toggleSettingsModal(false));
saveSettingsBtn.addEventListener('click', saveSettings);
settingsModal.addEventListener('click', (event) => {
  if (event.target === settingsModal) toggleSettingsModal(false);
});

init().catch((error) => {
  console.error('Initialization failed', error);
  showToast(error.message ?? 'Failed to initialise UI');
});
