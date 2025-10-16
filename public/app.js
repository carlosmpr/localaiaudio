const DEFAULT_MODEL_OPTIONS = [
  { value: 'llama3.1:8b', label: 'Llama 3.1 8B — balanced' },
  { value: 'phi3:mini', label: 'Phi-3 Mini — lightweight' },
  { value: 'deepseek-r1:7b', label: 'DeepSeek R1 7B — reasoning' }
];

const state = {
  setupRunning: false,
  currentStep: null,
  sessionId: null,
  activeModel: null,
  hardware: null,
  paths: null,
  streamingBubble: null,
  streamingBuffer: '',
  isStreaming: false,
  shouldStopStreaming: false,
  backend: 'ollama',
  availableRuntimes: [],
  pythonBinary: null,
  modelPath: null,
  typingIndicator: null,
  conversation: [],
  conversationCache: new Map(),
  conversations: [],
  activeConversationTitle: 'New chat',
  conversationsLoaded: false,
  conversationLoading: false,
  settings: {
    contextStrategy: 'sliding',
    maxMessages: 20,
    maxTokens: 8192,
    temperature: 0.7
  }
};

const elements = {
  startSetupBtn: document.getElementById('startSetupBtn'),
  resetWizardBtn: document.getElementById('resetWizardBtn'),
  backendSelectorWrap: document.querySelector('.backend-selector'),
  backendSelect: document.getElementById('backendSelect'),
  modelSelectorWrap: document.querySelector('.model-selector'),
  setupView: document.getElementById('setupView'),
  chatView: document.getElementById('chatView'),
  stepStatus: document.getElementById('stepStatus'),
  hardwareOutput: document.getElementById('hardwareOutput'),
  logEntries: document.getElementById('logEntries'),
  steps: Array.from(document.querySelectorAll('.steps li')),
  modelSelect: document.getElementById('modelSelect'),
  chatDirDisplay: document.getElementById('chatDirDisplay'),
  chooseChatDirBtn: document.getElementById('chooseChatDirBtn'),
  chatHistory: document.getElementById('chatHistory'),
  chatForm: document.getElementById('chatForm'),
  chatInput: document.getElementById('chatInput'),
  sendBtn: document.getElementById('sendBtn'),
  stopBtn: document.getElementById('stopBtn'),
  activeModel: document.getElementById('activeModel'),
  changeChatDirBtn: document.getElementById('changeChatDirBtn'),
  newConversationBtn: document.getElementById('newConversationBtn'),
  conversationList: document.getElementById('conversationList'),
  conversationEmpty: document.getElementById('conversationEmpty'),
  conversationTitle: document.getElementById('conversationTitle'),
  settingsBtn: document.getElementById('settingsBtn'),
  settingsModal: document.getElementById('settingsModal'),
  closeSettingsBtn: document.getElementById('closeSettingsBtn'),
  saveSettingsBtn: document.getElementById('saveSettingsBtn'),
  cancelSettingsBtn: document.getElementById('cancelSettingsBtn'),
  contextStrategy: document.getElementById('contextStrategy'),
  maxMessages: document.getElementById('maxMessages'),
  maxTokens: document.getElementById('maxTokens'),
  temperature: document.getElementById('temperature'),
  temperatureValue: document.getElementById('temperatureValue'),
  currentMessageCount: document.getElementById('currentMessageCount'),
  estimatedTokens: document.getElementById('estimatedTokens'),
  willSendCount: document.getElementById('willSendCount'),
  maxMessagesContainer: document.getElementById('maxMessagesContainer')
};

const TAURI = window.__TAURI__ || {};
const invoke = TAURI.tauri?.invoke;
const listen = TAURI.event?.listen;
const openDialog = TAURI.dialog?.open;

const stepsOrder = ['scan', 'storage', 'install', 'model', 'complete'];
const STEP_LABELS = {
  ollama: {
    install: 'Install & start Ollama',
    model: 'Download model'
  },
  python: {
    install: 'Start Python engine',
    model: 'Download model'
  },
  embedded: {
    install: 'Load embedded model',
    model: 'Download model'
  }
};

function setStep(step) {
  state.currentStep = step;
  elements.steps.forEach((li) => {
    li.classList.remove('active', 'completed');
    const name = li.dataset.step;
    if (!name) return;
    if (name === step) {
      li.classList.add('active');
    } else {
      const stepIndex = stepsOrder.indexOf(step);
      const itemIndex = stepsOrder.indexOf(name);
      if (itemIndex !== -1 && itemIndex < stepIndex) {
        li.classList.add('completed');
      }
    }
  });
}

function log(level, message) {
  const entry = document.createElement('li');
  entry.dataset.level = level;
  entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  elements.logEntries.appendChild(entry);
  elements.logEntries.scrollTop = elements.logEntries.scrollHeight;
}

function showError(message) {
  log('error', message);
  elements.stepStatus.textContent = message;
  elements.startSetupBtn.disabled = false;
  state.setupRunning = false;
}

function toggleViews(showChat) {
  if (showChat) {
    elements.setupView.classList.add('hidden');
    elements.setupView.classList.remove('visible');
    elements.chatView.classList.add('visible');
    elements.chatView.classList.remove('hidden');
    elements.chatForm.style.display = 'flex';
    document.body.classList.add('chat-mode');
  } else {
    elements.setupView.classList.add('visible');
    elements.setupView.classList.remove('hidden');
    elements.chatView.classList.add('hidden');
    elements.chatView.classList.remove('visible');
    elements.chatForm.style.display = 'none';
    document.body.classList.remove('chat-mode');
  }
}

function setDefaultModelOptions() {
  elements.modelSelect.innerHTML = '';
  DEFAULT_MODEL_OPTIONS.forEach((option) => {
    const opt = document.createElement('option');
    opt.value = option.value;
    opt.textContent = option.label;
    elements.modelSelect.appendChild(opt);
  });
}

function setModelOptionsFromOllama(models) {
  const known = new Map(DEFAULT_MODEL_OPTIONS.map((item) => [item.value, item.label]));
  elements.modelSelect.innerHTML = '';
  models.forEach((model) => {
    const opt = document.createElement('option');
    opt.value = model;
    opt.textContent = known.get(model) ?? model;
    elements.modelSelect.appendChild(opt);
  });
  if (!models.length) {
    setDefaultModelOptions();
  }
}

function updateBackendUi() {
  const backend = state.backend;
  const labels = STEP_LABELS[backend] || STEP_LABELS.ollama;

  elements.steps.forEach((li) => {
    const name = li.dataset.step;
    if (!name) return;
    if (name === 'install') {
      li.textContent = labels.install;
    } else if (name === 'model') {
      li.textContent = labels.model;
    }
  });

  if (backend === 'python' || backend === 'embedded') {
    elements.modelSelectorWrap?.classList.add('disabled');
    elements.modelSelect.disabled = true;
  } else {
    elements.modelSelectorWrap?.classList.remove('disabled');
    elements.modelSelect.disabled = false;
  }
}

function updateBackendAvailability() {
  const runtimes = state.availableRuntimes;
  const selectorWrap = elements.backendSelectorWrap;
  const select = elements.backendSelect;
  if (!select || !selectorWrap) return;

  const options = Array.from(select.options);
  options.forEach((option) => {
    const allowed = runtimes.includes(option.value);
    option.disabled = !allowed;
    if (!allowed && option.selected) {
      select.value = runtimes[0] ?? option.value;
      state.backend = select.value;
    }
  });

  if (!runtimes.includes(state.backend)) {
    state.backend = runtimes[0] || state.backend;
    if (select && runtimes.includes(state.backend)) {
      select.value = state.backend;
    }
  }

  if (runtimes.length <= 1) {
    selectorWrap.classList.add('hidden');
    if (runtimes.length === 1) {
      state.backend = runtimes[0];
      select.value = runtimes[0];
    }
  } else {
    selectorWrap.classList.remove('hidden');
  }

  updateBackendUi();
}

async function ensurePythonBinary() {
  if (!state.availableRuntimes.includes('python')) return;
  if (state.pythonBinary) return;
  if (typeof invoke !== 'function') return;
  try {
    const binary = await invoke('resolve_python_binary');
    if (typeof binary === 'string' && binary.trim()) {
      state.pythonBinary = binary.trim();
    }
  } catch (error) {
    console.warn('Unable to resolve python binary automatically.', error);
  }
}

async function ensurePythonEngineReady() {
  if (!state.availableRuntimes.includes('python')) return true;
  if (typeof invoke !== 'function') return false;

  await ensurePythonBinary();
  if (!state.pythonBinary) {
    showError('Python runtime missing. Install llama-cpp-python or set PRIVATE_AI_PYTHON.');
    return false;
  }

  try {
    const healthy = await invoke('python_engine_health');
    if (healthy) return true;
  } catch (error) {
    console.debug('python_engine_health check failed:', error);
  }

  try {
    const startResult = await invoke('start_python_engine', {
      modelPath: state.modelPath,
      pythonBinary: state.pythonBinary
    });
    if (typeof startResult === 'string' && startResult !== 'already running') {
      state.modelPath = startResult;
    }
    log('info', `Python engine restart: ${startResult}`);
    const healthy = await invoke('python_engine_health');
    if (healthy) {
      return true;
    }
    showError('Python engine still not responding after restart. Check python-sidecar logs.');
  } catch (error) {
    showError(`Unable to start Python engine: ${error?.message ?? error}`);
  }
  return false;
}

function attachTypingIndicator(bubble) {
  bubble.textContent = '';
  bubble.classList.add('streaming');
  const indicator = document.createElement('span');
  indicator.className = 'typing-indicator';
  indicator.innerHTML = '<span></span><span></span><span></span>';
  bubble.appendChild(indicator);
  state.typingIndicator = indicator;
}

function clearTypingIndicator() {
  if (state.typingIndicator) {
    state.typingIndicator.remove();
    state.typingIndicator = null;
  }
  if (state.streamingBubble) {
    state.streamingBubble.classList.remove('streaming');
  }
}

function showStopButton() {
  if (elements.stopBtn) {
    elements.stopBtn.classList.remove('hidden');
  }
  if (elements.sendBtn) {
    elements.sendBtn.classList.add('hidden');
  }
}

function hideStopButton() {
  if (elements.stopBtn) {
    elements.stopBtn.classList.add('hidden');
  }
  if (elements.sendBtn) {
    elements.sendBtn.classList.remove('hidden');
  }
}

async function stopStreaming() {
  state.shouldStopStreaming = true;
  clearTypingIndicator();

  // Cancel backend generation if embedded runtime is active
  if (state.backend === 'embedded' && typeof invoke === 'function') {
    try {
      await invoke('cancel_embedded_generation');
      console.log('[DEBUG] Sent cancellation request to embedded runtime');
    } catch (error) {
      console.warn('Failed to cancel embedded generation:', error);
    }
  }

  // Update the bubble to show it was stopped (preserve markdown rendering)
  if (state.streamingBubble && state.streamingBuffer) {
    const stoppedContent = state.streamingBuffer + '\n\n*[Stopped by user]*';
    updateStreamingMarkdown(state.streamingBubble, stoppedContent);
  }

  hideStopButton();
  elements.sendBtn.disabled = false;
  elements.chatInput.focus();

  // Save the partial response
  if (state.streamingBuffer) {
    const assistantRecord = {
      role: 'assistant',
      content: state.streamingBuffer,  // Save without the "stopped" message
      timestamp: new Date().toISOString()
    };
    state.conversation.push(assistantRecord);
    syncConversationCache();
    updateActiveConversationSummary();
    updateContextStats();
    appendChatRecords([assistantRecord]).catch(console.error);
    refreshConversationList({ preserveSelection: true }).catch(console.error);
  }

  state.streamingBubble = null;
  state.streamingBuffer = '';
  state.isStreaming = false;
}

function generateSessionId() {
  return `sess-${Date.now().toString(36)}`;
}

function updateChatDirDisplay() {
  if (elements.chatDirDisplay) {
    elements.chatDirDisplay.textContent = state.paths?.chats || 'Default: ~/PrivateAI/Chats';
  }
  if (elements.changeChatDirBtn) {
    const location = state.paths?.chats || 'Default: ~/PrivateAI/Chats';
    elements.changeChatDirBtn.title = `Chats stored in: ${location}`;
  }
}

async function appendChatRecords(records) {
  if (!records.length || typeof invoke !== 'function' || !state.sessionId) return;
  try {
    await invoke('append_chat_records', {
      sessionId: state.sessionId,
      records,
      chatsDir: state.paths?.chats || null
    });
  } catch (error) {
    console.warn('Failed to persist chat records', error);
  }
}

async function chooseChatDirectory({ focusChat = false } = {}) {
  if (typeof openDialog !== 'function') return;
  try {
    const selected = await openDialog({
      directory: true,
      multiple: false,
      defaultPath: state.paths?.chats || undefined
    });
    const folder = Array.isArray(selected) ? selected[0] : selected;
    if (!folder) return;

    state.paths = state.paths || {};
    state.paths.chats = folder;
    updateChatDirDisplay();

    if (typeof invoke === 'function') {
      await invoke('ensure_directory', { path: folder });
    }

    state.conversationCache = new Map();
    await refreshConversationList({ preserveSelection: false });
    if (!state.conversations.length) {
      startNewConversation({ focusInput: focusChat, persistSummary: false });
    } else if (focusChat && elements.chatInput) {
      elements.chatInput.focus();
    }
  } catch (error) {
    console.warn('Chat directory selection cancelled or failed', error);
  }
}

function syncConversationCache() {
  if (!state.sessionId) return;
  state.conversationCache.set(state.sessionId, [...state.conversation]);
}

function getContextMessages() {
  const allMessages = state.conversation.map((record) => ({
    role: record.role,
    content: record.content
  }));

  return applyContextStrategy(allMessages);
}

// Estimate token count (rough: 1 token ≈ 4 chars)
function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

// Apply context strategy to filter messages
function applyContextStrategy(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return [];
  }

  const { contextStrategy, maxMessages, maxTokens } = state.settings;

  // Send all messages
  if (contextStrategy === 'all') {
    return messages;
  }

  // Sliding window - last N messages
  if (contextStrategy === 'sliding') {
    if (messages.length <= maxMessages) {
      return messages;
    }
    return messages.slice(-maxMessages);
  }

  // Smart limit - keep first + recent messages
  if (contextStrategy === 'smart') {
    if (messages.length <= maxMessages) {
      return messages;
    }

    const result = [];
    let tokenCount = 0;

    // Keep first message for context
    if (messages[0]) {
      result.push(messages[0]);
      tokenCount += estimateTokens(messages[0].content);
    }

    // Add recent messages respecting token limit
    const recentMessages = messages.slice(-maxMessages + 1);
    for (let i = recentMessages.length - 1; i >= 0; i--) {
      const msg = recentMessages[i];
      const msgTokens = estimateTokens(msg.content);

      if (tokenCount + msgTokens <= maxTokens) {
        result.unshift(msg);
        tokenCount += msgTokens;
      } else {
        break;
      }
    }

    return result;
  }

  return messages;
}

// Load settings from localStorage
function loadSettings() {
  try {
    const saved = localStorage.getItem('privateai_settings');
    if (saved) {
      state.settings = { ...state.settings, ...JSON.parse(saved) };
    }
  } catch (error) {
    console.warn('Failed to load settings:', error);
  }
}

// Save settings to localStorage
function saveSettings() {
  try {
    localStorage.setItem('privateai_settings', JSON.stringify(state.settings));
    return true;
  } catch (error) {
    console.error('Failed to save settings:', error);
    return false;
  }
}

// Update context stats display
function updateContextStats() {
  if (!elements.currentMessageCount) return;

  const totalMessages = state.conversation.length;
  const totalTokens = state.conversation.reduce((sum, msg) =>
    sum + estimateTokens(msg.content), 0);

  const filteredMessages = applyContextStrategy(state.conversation.map(m => ({
    role: m.role,
    content: m.content
  })));
  const willSendCount = filteredMessages.length;

  elements.currentMessageCount.textContent = totalMessages;
  elements.estimatedTokens.textContent = totalTokens;
  elements.willSendCount.textContent = willSendCount;
}

// Open settings modal
function openSettings() {
  if (!elements.settingsModal) return;

  // Populate current values
  if (elements.contextStrategy) {
    elements.contextStrategy.value = state.settings.contextStrategy;
  }
  if (elements.maxMessages) {
    elements.maxMessages.value = state.settings.maxMessages;
  }
  if (elements.maxTokens) {
    elements.maxTokens.value = state.settings.maxTokens;
  }
  if (elements.temperature) {
    elements.temperature.value = state.settings.temperature;
    if (elements.temperatureValue) {
      elements.temperatureValue.textContent = state.settings.temperature;
    }
  }

  // Update visibility of maxMessages based on strategy
  updateMaxMessagesVisibility();

  // Update stats
  updateContextStats();

  // Show modal
  elements.settingsModal.classList.remove('hidden');
}

// Close settings modal
function closeSettings() {
  if (elements.settingsModal) {
    elements.settingsModal.classList.add('hidden');
  }
}

// Update max messages container visibility
function updateMaxMessagesVisibility() {
  if (!elements.maxMessagesContainer || !elements.contextStrategy) return;

  const strategy = elements.contextStrategy.value;
  if (strategy === 'all') {
    elements.maxMessagesContainer.style.display = 'none';
  } else {
    elements.maxMessagesContainer.style.display = 'block';
  }
}

// Save settings from modal
function handleSaveSettings() {
  // Update state
  if (elements.contextStrategy) {
    state.settings.contextStrategy = elements.contextStrategy.value;
  }
  if (elements.maxMessages) {
    state.settings.maxMessages = parseInt(elements.maxMessages.value, 10);
  }
  if (elements.maxTokens) {
    state.settings.maxTokens = parseInt(elements.maxTokens.value, 10);
  }
  if (elements.temperature) {
    state.settings.temperature = parseFloat(elements.temperature.value);
  }

  // Save to localStorage
  saveSettings();

  // Close modal
  closeSettings();

  // Show confirmation
  log('success', 'Settings saved successfully');
}

function buildConversationSummary(sessionId, messages = []) {
  const safeMessages = Array.isArray(messages) ? messages : [];
  const firstUser = safeMessages.find(
    (record) => record.role === 'user' && typeof record.content === 'string' && record.content.trim()
  );
  const fallbackTitle = firstUser?.content
    ? firstUser.content.trim().split('\n')[0]
    : 'New chat';
  const title =
    fallbackTitle.length > 80 ? `${fallbackTitle.slice(0, 80)}…` : fallbackTitle;
  const lastMessage =
    [...safeMessages]
      .reverse()
      .find((record) => typeof record.content === 'string' && record.content.trim()) || null;
  const preview =
    lastMessage?.content?.trim()
      ? (lastMessage.content.trim().split('\n')[0] ?? '').slice(0, 120)
      : null;
  const createdAt = safeMessages[0]?.timestamp ?? null;
  const updatedAt =
    safeMessages[safeMessages.length - 1]?.timestamp ?? new Date().toISOString();
  return {
    sessionId,
    title,
    createdAt,
    updatedAt,
    messageCount: safeMessages.length,
    preview
  };
}

function setConversationTitle(title) {
  state.activeConversationTitle = title || 'New chat';
  if (elements.conversationTitle) {
    elements.conversationTitle.textContent = state.activeConversationTitle;
  }
}

function renderConversationHistory(messages = []) {
  clearTypingIndicator();
  elements.chatHistory.innerHTML = '';
  messages.forEach((record) => {
    if (!record || typeof record.content !== 'string') return;
    const role = record.role === 'user' ? 'user' : 'assistant';
    appendMessageBubble(role, record.content);
  });
  elements.chatHistory.scrollTop = elements.chatHistory.scrollHeight;
  updateContextStats();
}

async function deleteConversation(sessionId) {
  if (!sessionId) return;

  const confirmed = confirm('Delete this conversation? This cannot be undone.');
  if (!confirmed) return;

  try {
    if (typeof invoke === 'function') {
      await invoke('delete_chat_session', {
        sessionId,
        chatsDir: state.paths?.chats || null
      });
    }

    // Remove from cache
    state.conversationCache.delete(sessionId);

    // If deleting active conversation, start a new one
    if (sessionId === state.sessionId) {
      startNewConversation({ focusInput: true, persistSummary: true });
    }

    // Refresh the conversation list
    await refreshConversationList({ preserveSelection: false });
  } catch (error) {
    console.error('Failed to delete conversation:', error);
    alert(`Failed to delete conversation: ${error?.message ?? error}`);
  }
}

function renderConversationList() {
  if (!elements.conversationList) return;
  elements.conversationList.innerHTML = '';

  if (!state.conversations.length) {
    elements.conversationEmpty?.classList.add('visible');
    return;
  }

  elements.conversationEmpty?.classList.remove('visible');
  state.conversations.forEach((conv) => {
    const item = document.createElement('div');
    item.className = 'conversation-item';
    if (conv.sessionId === state.sessionId) {
      item.classList.add('active');
    }

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'conversation-button';

    const title = document.createElement('h3');
    title.textContent = conv.title || 'New chat';
    const preview = document.createElement('p');
    preview.textContent =
      conv.preview || `${conv.messageCount} message${conv.messageCount === 1 ? '' : 's'}`;

    button.appendChild(title);
    button.appendChild(preview);
    button.addEventListener('click', () => {
      void selectConversation(conv.sessionId);
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'delete-conversation-btn';
    deleteBtn.textContent = '×';
    deleteBtn.title = 'Delete conversation';
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      void deleteConversation(conv.sessionId);
    });

    item.appendChild(button);
    item.appendChild(deleteBtn);
    elements.conversationList.appendChild(item);
  });
}

function sortConversationsInPlace(list) {
  list.sort((a, b) => {
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
}

function updateActiveConversationSummary() {
  if (!state.sessionId) return;
  const summary = buildConversationSummary(state.sessionId, state.conversation);
  const index = state.conversations.findIndex((conv) => conv.sessionId === state.sessionId);
  if (index === -1) {
    state.conversations.unshift(summary);
  } else {
    state.conversations[index] = { ...state.conversations[index], ...summary };
  }
  sortConversationsInPlace(state.conversations);
  setConversationTitle(summary.title);
  renderConversationList();
}

async function refreshConversationList({ preserveSelection = false } = {}) {
  if (state.conversationLoading) return;
  state.conversationLoading = true;

  try {
    const summaries = [];
    if (typeof invoke === 'function') {
      try {
        const result = await invoke('list_chat_sessions', {
          chatsDir: state.paths?.chats || null
        });
        if (Array.isArray(result)) {
          result.forEach((item) => {
            summaries.push({
              sessionId: item.session_id,
              title: item.title,
              createdAt: item.created_at ?? null,
              updatedAt: item.updated_at ?? null,
              messageCount: item.message_count ?? 0,
              preview: item.preview ?? null
            });
          });
        }
      } catch (error) {
        console.warn('Unable to list chat sessions', error);
      }
    }

    if (
      state.sessionId &&
      state.conversation.length &&
      !summaries.some((conv) => conv.sessionId === state.sessionId)
    ) {
      summaries.unshift(buildConversationSummary(state.sessionId, state.conversation));
    }

    sortConversationsInPlace(summaries);

    state.conversations = summaries;
    renderConversationList();
    state.conversationsLoaded = true;

    if (!preserveSelection) {
      if (state.sessionId) {
        const current = summaries.find((conv) => conv.sessionId === state.sessionId);
        if (current) {
          setConversationTitle(current.title);
        } else if (summaries.length) {
          await selectConversation(summaries[0].sessionId, { forceReload: false });
        } else {
          setConversationTitle('New chat');
          renderConversationHistory([]);
        }
      } else if (summaries.length) {
        await selectConversation(summaries[0].sessionId, { forceReload: false });
      } else {
        setConversationTitle('New chat');
        renderConversationHistory([]);
      }
    }
  } finally {
    state.conversationLoading = false;
  }
}

async function selectConversation(sessionId, { forceReload = false } = {}) {
  if (!sessionId) return;

  if (!forceReload && sessionId === state.sessionId && state.conversationsLoaded) {
    renderConversationList();
    return;
  }

  clearTypingIndicator();
  state.sessionId = sessionId;

  let messages = state.conversationCache.get(sessionId);
  if (!Array.isArray(messages) || forceReload) {
    if (typeof invoke === 'function') {
      try {
        const result = await invoke('load_chat_history', {
          sessionId,
          chatsDir: state.paths?.chats || null,
          limit: null
        });
        if (Array.isArray(result)) {
          messages = result.map((record) => ({
            role: record.role || 'assistant',
            content: record.content || '',
            timestamp: record.timestamp ?? null
          }));
        } else {
          messages = [];
        }
      } catch (error) {
        console.warn('Unable to load chat history', error);
        messages = [];
      }
    } else {
      messages = [];
    }
  }

  state.conversation = Array.isArray(messages)
    ? messages.map((record) => ({
        role: record.role === 'user' ? 'user' : 'assistant',
        content: record.content || '',
        timestamp: record.timestamp ?? null
      }))
    : [];

  syncConversationCache();
  updateActiveConversationSummary();
  renderConversationHistory(state.conversation);
  updateContextStats();
  elements.chatInput?.focus();
}

function startNewConversation({ focusInput = true, persistSummary = true } = {}) {
  clearTypingIndicator();
  const newId = generateSessionId();
  state.sessionId = newId;
  state.conversation = [];
  syncConversationCache();
  if (persistSummary) {
    updateActiveConversationSummary();
  } else {
    setConversationTitle('New chat');
    renderConversationList();
  }
  renderConversationHistory([]);
  if (elements.chatInput) {
    elements.chatInput.value = '';
    if (focusInput) {
      elements.chatInput.focus();
    }
  }
}

async function loadAvailableRuntimes() {
  if (typeof invoke !== 'function') {
    if (!state.availableRuntimes.length) {
      state.availableRuntimes = ['ollama', 'python'];
    }
    updateBackendAvailability();
    return;
  }

  try {
    const runtimes = await invoke('get_available_runtimes');
    if (Array.isArray(runtimes) && runtimes.length) {
      state.availableRuntimes = runtimes;
    }
  } catch (error) {
    console.warn('Unable to load available runtimes, falling back to defaults.', error);
    if (!state.availableRuntimes.length) {
      state.availableRuntimes = ['ollama', 'python'];
    }
  }

  updateBackendAvailability();
  updateChatDirDisplay();
}

async function runSetup() {
  if (state.setupRunning) return;
  if (typeof invoke !== 'function') {
    showError('Tauri bridge not available. Run inside the packaged application.');
    return;
  }

  if (!state.availableRuntimes.includes(state.backend)) {
    state.backend = state.availableRuntimes[0] || 'ollama';
  }
  if (elements.backendSelect) {
    const selectedValue = elements.backendSelect.value || state.backend;
    if (state.availableRuntimes.includes(selectedValue)) {
      state.backend = selectedValue;
    } else {
      elements.backendSelect.value = state.backend;
    }
  }
  updateBackendUi();

  state.setupRunning = true;
  elements.startSetupBtn.disabled = true;
  elements.logEntries.innerHTML = '';
  elements.stepStatus.textContent =
    state.backend === 'python'
      ? 'Initializing Python sidecar setup...'
      : state.backend === 'embedded'
      ? 'Initializing embedded runtime setup...'
      : 'Initializing setup...';

  try {
    // Step 1: hardware scan
    setStep('scan');
    elements.stepStatus.textContent = 'Detecting hardware...';
    log('info', 'Detecting hardware profile.');
    const hardware = await invoke('scan_hardware');
    state.hardware = hardware;
    elements.hardwareOutput.textContent = JSON.stringify(hardware, null, 2);
    log('success', `Detected ${hardware.cpu?.model ?? 'CPU'} with ${hardware.ram_gb.toFixed(1)} GB RAM.`);

    // Step 2: storage layout
    setStep('storage');
    elements.stepStatus.textContent = 'Creating PrivateAI storage layout...';
    log('info', 'Preparing ~/PrivateAI directories.');
    const paths = await invoke('setup_storage');
    state.paths = paths;
    updateChatDirDisplay();
    log('success', `Storage ready at ${paths.base_dir}`);

    if (state.backend === 'python') {
      await ensurePythonBinary();
      if (!state.pythonBinary) {
        throw new Error('Python runtime not found. Install llama-cpp-python or set PRIVATE_AI_PYTHON.');
      }

      // Step 3: Download model if not present
      setStep('model');
      const modelsDir = String(state.paths.models).replace(/\\/g, '/');
      const expectedModelPath = `${modelsDir}/gemma-3-1b-it-Q4_0.gguf`;

      elements.stepStatus.textContent = 'Checking for AI model...';
      log('info', 'Checking for Gemma 3 1B model...');

      try {
        const downloadedModelPath = await invoke('download_model', {
          targetDir: modelsDir
        });
        state.modelPath = downloadedModelPath;
        log('success', 'Model ready!');
      } catch (error) {
        console.error('Model download error:', error);
        throw new Error(`Failed to download model: ${error?.message ?? error}`);
      }

      setStep('install');
      elements.stepStatus.textContent = 'Starting embedded Python runtime...';
      log('info', 'Launching llama-cpp sidecar.');

      try {
        await invoke('stop_python_engine');
      } catch (preflightErr) {
        console.debug('Python engine stop (preflight) ignored:', preflightErr);
      }

      const defaultModelPath = state.modelPath || expectedModelPath;

      const startResult = await invoke('start_python_engine', {
        modelPath: defaultModelPath,
        pythonBinary: state.pythonBinary
      });

      const resolvedModelPath =
        typeof startResult === 'string' && startResult !== 'already running'
          ? startResult
          : defaultModelPath;
      state.modelPath = resolvedModelPath;

      log(
        'success',
        `Python sidecar started${resolvedModelPath ? ` (model: ${resolvedModelPath})` : ''}.`
      );

      elements.stepStatus.textContent = 'Checking Python engine health...';
      const healthy = await invoke('python_engine_health');

      if (!healthy) {
        throw new Error('Python engine failed health check. Verify llama-cpp and model availability.');
      }

      log('success', 'Python engine responded to health check.');

      elements.stepStatus.textContent = 'Persisting configuration...';
      log('info', 'Saving configuration file.');

      await invoke('save_config', {
        config: {
          version: '0.1.0',
          created_at: new Date().toISOString(),
          hardware: state.hardware,
          model: {
            selected: 'gemma-1b-python',
            status: 'available',
            path: resolvedModelPath ?? null
          },
          paths: state.paths,
          backend: 'python',
          runtime: {
            python: {
              binary: state.pythonBinary
            }
          }
        }
      });

      log('success', 'Configuration saved.');

      setStep('complete');
      elements.stepStatus.textContent = 'Setup complete. Opening chat experience.';
      state.activeModel = 'gemma-1b-python';
      elements.activeModel.textContent = 'Model: gemma-1b (Python)';
      elements.sendBtn.disabled = false;
      toggleViews(true);
      void refreshConversationList({ preserveSelection: false });
      log('success', 'Setup finished successfully.');
      return;
    }

    if (state.backend === 'embedded') {
      // Step 3: Download model if not present
      setStep('model');
      const modelsDir = String(state.paths.models).replace(/\\/g, '/');
      const expectedModelPath = `${modelsDir}/llama3.2-1b.gguf`;

      elements.stepStatus.textContent = 'Checking for AI model...';
      log('info', 'Checking for Llama 3.2 1B model...');

      try {
        const downloadedModelPath = await invoke('download_model', {
          targetDir: modelsDir
        });
        state.modelPath = downloadedModelPath;
        log('success', 'Model ready!');
      } catch (error) {
        console.error('Model download error:', error);
        throw new Error(`Failed to download model: ${error?.message ?? error}`);
      }

      // Step 4: Load embedded model
      setStep('install');
      elements.stepStatus.textContent = 'Loading embedded llama.cpp runtime...';
      log('info', 'Initializing embedded runtime with model.');

      try {
        const loadResult = await invoke('load_embedded_model', {
          modelPath: state.modelPath
        });
        log('success', `Embedded model loaded: ${loadResult}`);
      } catch (error) {
        console.error('Model load error:', error);
        throw new Error(`Failed to load embedded model: ${error?.message ?? error}`);
      }

      elements.stepStatus.textContent = 'Persisting configuration...';
      log('info', 'Saving configuration file.');

      await invoke('save_config', {
        config: {
          version: '0.1.0',
          created_at: new Date().toISOString(),
          hardware: state.hardware,
          model: {
            selected: 'llama3.2-1b-embedded',
            status: 'available',
            path: state.modelPath ?? null
          },
          paths: state.paths,
          backend: 'embedded'
        }
      });

      log('success', 'Configuration saved.');

      setStep('complete');
      elements.stepStatus.textContent = 'Setup complete. Opening chat experience.';
      state.activeModel = 'llama3.2-1b-embedded';
      elements.activeModel.textContent = 'Model: llama3.2-1b (Embedded)';
      elements.sendBtn.disabled = false;
      toggleViews(true);
      void refreshConversationList({ preserveSelection: false });
      log('success', 'Setup finished successfully.');
      return;
    }

    // Step 3: ensure Ollama installed
    setStep('install');
    elements.stepStatus.textContent = 'Checking Ollama installation...';
    let installed = await invoke('check_ollama_installed');
    if (!installed) {
      log('info', 'Ollama not found. Installing...');
      const installResult = await invoke('install_ollama');
      log('success', installResult || 'Ollama installed.');
    } else {
      log('success', 'Ollama already installed.');
    }

    elements.stepStatus.textContent = 'Starting Ollama service...';
    const runningBefore = await invoke('check_ollama_running');
    if (!runningBefore) {
      const started = await invoke('start_ollama_service');
      if (!started) {
        throw new Error('Ollama service could not be started.');
      }
      log('success', 'Ollama service started.');
      await new Promise((resolve) => setTimeout(resolve, 3000));
    } else {
      log('success', 'Ollama service already running.');
    }

    try {
      const models = await invoke('list_ollama_models');
      if (Array.isArray(models) && models.length) {
        setModelOptionsFromOllama(models);
        log('info', `Found ${models.length} cached model(s).`);
      } else {
        setDefaultModelOptions();
      }
    } catch (err) {
      setDefaultModelOptions();
      log('info', 'No cached models detected yet.');
    }

    // Step 4: pull model
    setStep('model');
    const selectedModel = elements.modelSelect.value;
    elements.stepStatus.textContent = `Pulling model ${selectedModel}...`;
    log('info', `Pulling model ${selectedModel}.`);
    await invoke('pull_ollama_model', { model: selectedModel });
    log('success', `Model ${selectedModel} ready.`);

    elements.stepStatus.textContent = 'Persisting configuration...';
    log('info', 'Saving configuration file.');
    await invoke('save_config', {
      config: {
        version: '0.1.0',
        created_at: new Date().toISOString(),
        hardware: state.hardware,
        model: {
          selected: selectedModel,
          status: 'available',
          path: null
        },
        paths: state.paths,
        backend: 'ollama'
      }
    });
    log('success', 'Configuration saved.');

    setStep('complete');
    elements.stepStatus.textContent = 'Setup complete. Opening chat experience.';
    state.activeModel = selectedModel;
    elements.activeModel.textContent = `Model: ${selectedModel}`;
    elements.sendBtn.disabled = false;
    toggleViews(true);
    void refreshConversationList({ preserveSelection: false });
    log('success', 'Setup finished successfully.');
  } catch (error) {
    console.error(error);
    showError(`Setup failed: ${error?.message ?? error}`);
    return;
  } finally {
    elements.startSetupBtn.disabled = false;
    state.setupRunning = false;
  }
}

function renderMarkdown(content) {
  if (typeof marked === 'undefined') {
    console.warn('Marked library not loaded');
    return escapeHtml(content);
  }

  try {
    // Configure marked options
    marked.setOptions({
      breaks: true,
      gfm: true,
      headerIds: false,
      mangle: false
    });

    // Parse markdown to HTML
    const html = marked.parse(content);
    return html;
  } catch (err) {
    console.error('Markdown parse error:', err);
    return escapeHtml(content);
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Update streaming markdown in real-time (no double render)
function updateStreamingMarkdown(bubble, content) {
  if (!bubble || !content) return;

  // Create or get the markdown container
  let markdownContainer = bubble.querySelector('.markdown-content');
  if (!markdownContainer) {
    markdownContainer = document.createElement('div');
    markdownContainer.className = 'markdown-content';
    bubble.textContent = '';
    bubble.appendChild(markdownContainer);
  }

  // Render markdown directly
  if (typeof marked !== 'undefined') {
    try {
      const html = marked.parse(content);
      markdownContainer.innerHTML = html;

      // Apply syntax highlighting to any code blocks
      if (typeof hljs !== 'undefined') {
        markdownContainer.querySelectorAll('pre code').forEach((block) => {
          if (!block.classList.contains('hljs')) {
            hljs.highlightElement(block);
          }
          const lang = block.className.match(/language-(\w+)/);
          if (lang && lang[1]) {
            block.parentElement.setAttribute('data-language', lang[1]);
          }
        });
      }
    } catch (err) {
      // Fallback to plain text if markdown parsing fails
      markdownContainer.textContent = content;
    }
  } else {
    // Fallback if marked is not loaded
    markdownContainer.textContent = content;
  }
}

function appendMessageBubble(role, content = '') {
  const bubble = document.createElement('div');
  bubble.className = `bubble ${role}`;

  if (role === 'assistant' && content) {
    // Render markdown for assistant messages
    const markdownContainer = document.createElement('div');
    markdownContainer.className = 'markdown-content';
    markdownContainer.innerHTML = renderMarkdown(content);
    bubble.appendChild(markdownContainer);

    // Highlight all code blocks after rendering
    requestAnimationFrame(() => {
      if (typeof hljs !== 'undefined') {
        bubble.querySelectorAll('pre code').forEach((block) => {
          // Only highlight if not already highlighted
          if (!block.classList.contains('hljs')) {
            hljs.highlightElement(block);
          }

          // Add language label to pre element
          const lang = block.className.match(/language-(\w+)/);
          if (lang && lang[1]) {
            block.parentElement.setAttribute('data-language', lang[1]);
          }
        });
      }
    });
  } else {
    // Plain text for user messages
    bubble.textContent = content;
  }

  elements.chatHistory.appendChild(bubble);
  elements.chatHistory.scrollTop = elements.chatHistory.scrollHeight;
  return bubble;
}

async function handleChatSubmit(event) {
  event.preventDefault();
  if (!state.activeModel) {
    appendMessageBubble('assistant', 'No model is active. Run setup first.');
    return;
  }

  const message = elements.chatInput.value.trim();
  if (!message) return;

  appendMessageBubble('user', message);
  elements.chatInput.value = '';
  elements.sendBtn.disabled = true;
  state.isStreaming = true;
  state.shouldStopStreaming = false;
  showStopButton();

  const timestamp = new Date().toISOString();
  const userRecord = {
    role: 'user',
    content: message,
    timestamp
  };
  state.conversation.push(userRecord);
  syncConversationCache();
  updateActiveConversationSummary();
  updateContextStats();
  await appendChatRecords([userRecord]);

  const historySlice = getContextMessages();

  if (state.backend === 'python' || state.backend === 'embedded') {
    if (state.backend === 'python') {
      const ready = await ensurePythonEngineReady();
      if (!ready) {
        elements.sendBtn.disabled = false;
        elements.chatInput.focus();
        return;
      }
    }
    const assistantBubble = appendMessageBubble('assistant', '');
    attachTypingIndicator(assistantBubble);
    state.streamingBubble = assistantBubble;
    state.streamingBuffer = '';
    try {
      const command = state.backend === 'embedded' ? 'embedded_chat_stream' : 'python_chat_stream';
      console.log(`[DEBUG] Calling ${command} with:`, {
        message,
        historyLength: historySlice.length,
        sessionId: state.sessionId,
        backend: state.backend
      });
      await invoke(command, {
        message,
        history: historySlice,
        sessionId: state.sessionId,
        chatsDir: state.paths?.chats || null
      });
      console.log(`[DEBUG] ${command} returned successfully`);
      const assistantContent = state.streamingBuffer;
      if (assistantContent) {
        const assistantRecord = {
          role: 'assistant',
          content: assistantContent,
          timestamp: new Date().toISOString()
        };
        state.conversation.push(assistantRecord);
        syncConversationCache();
        updateActiveConversationSummary();
        updateContextStats();
        await appendChatRecords([assistantRecord]);
        void refreshConversationList({ preserveSelection: true });
      }
    } catch (error) {
      console.error(error);
      if (state.streamingBubble) {
        clearTypingIndicator();
        state.streamingBubble.textContent = `Python sidecar error: ${error?.message ?? error}`;
      } else {
        appendMessageBubble('assistant', `Python sidecar error: ${error?.message ?? error}`);
      }
    } finally {
      clearTypingIndicator();
      // Markdown is already rendered in real-time during streaming
      // No need for double render here
      state.streamingBubble = null;
      state.streamingBuffer = '';
      state.typingIndicator = null;
      state.isStreaming = false;
      state.shouldStopStreaming = false;
      hideStopButton();
      elements.sendBtn.disabled = false;
      elements.chatInput.focus();
    }
    return;
  }

  const assistantBubble = appendMessageBubble('assistant', '');
  attachTypingIndicator(assistantBubble);
  state.streamingBubble = assistantBubble;
  state.streamingBuffer = '';

  try {
    const response = await invoke('send_chat_message', {
      message,
      model: state.activeModel,
      history: historySlice,
      sessionId: state.sessionId,
      chatsDir: state.paths?.chats || null
    });
    if (state.streamingBubble) {
      clearTypingIndicator();
      const finalContent = response || state.streamingBuffer;

      // Render markdown in real-time (already being done during streaming)
      // Just ensure final content is rendered if stream didn't update
      if (finalContent && finalContent !== state.streamingBuffer) {
        updateStreamingMarkdown(state.streamingBubble, finalContent);
      }
    }
    const assistantContent = response || state.streamingBuffer;
    if (assistantContent) {
      const assistantRecord = {
        role: 'assistant',
        content: assistantContent,
        timestamp: new Date().toISOString()
      };
      state.conversation.push(assistantRecord);
      syncConversationCache();
      updateActiveConversationSummary();
      updateContextStats();
      await appendChatRecords([assistantRecord]);
      void refreshConversationList({ preserveSelection: true });
    }
  } catch (error) {
    console.error(error);
    if (state.streamingBubble) {
      clearTypingIndicator();
      state.streamingBubble.textContent = `Chat failed: ${error?.message ?? error}`;
    } else {
      appendMessageBubble('assistant', `Chat failed: ${error?.message ?? error}`);
    }
  } finally {
    state.streamingBubble = null;
    state.streamingBuffer = '';
    state.typingIndicator = null;
    state.isStreaming = false;
    state.shouldStopStreaming = false;
    hideStopButton();
    elements.sendBtn.disabled = false;
    elements.chatInput.focus();
  }
}

async function resetWizard() {
  if (state.backend === 'python' && typeof invoke === 'function') {
    try {
      await invoke('stop_python_engine');
      log('info', 'Python sidecar stopped.');
    } catch (error) {
      console.debug('Stop python engine ignored:', error);
    }
  }

  clearTypingIndicator();
  startNewConversation({ focusInput: false, persistSummary: false });
  state.activeModel = null;
  state.hardware = null;
  state.currentStep = null;
  elements.steps.forEach((li) => li.classList.remove('active', 'completed'));
  elements.stepStatus.textContent = 'Press "Start Setup" to begin.';
  elements.logEntries.innerHTML = '';
  elements.activeModel.textContent = 'Model: —';
  elements.chatInput.value = '';
  elements.sendBtn.disabled = true;
  elements.startSetupBtn.disabled = false;
  state.streamingBubble = null;
  state.streamingBuffer = '';
  toggleViews(false);
  setDefaultModelOptions();
  updateBackendAvailability();
  state.modelPath = null;
  state.typingIndicator = null;
  updateChatDirDisplay();
}

function attachEventListeners() {
  elements.startSetupBtn.addEventListener('click', runSetup);
  elements.chatForm.addEventListener('submit', handleChatSubmit);
  elements.stopBtn?.addEventListener('click', stopStreaming);

  // Add Enter key handler for chat input
  elements.chatInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!elements.sendBtn.disabled && elements.chatInput.value.trim()) {
        elements.chatForm.dispatchEvent(new Event('submit'));
      }
    }
  });

  elements.newConversationBtn?.addEventListener('click', () => {
    startNewConversation({ focusInput: true, persistSummary: true });
  });
  elements.resetWizardBtn.addEventListener('click', () => {
    void resetWizard();
  });
  elements.backendSelect?.addEventListener('change', () => {
    if (!elements.backendSelect) return;
    const chosen = elements.backendSelect.value || state.backend;
    if (state.availableRuntimes.includes(chosen)) {
      state.backend = chosen;
    } else if (state.availableRuntimes.length) {
      state.backend = state.availableRuntimes[0];
      elements.backendSelect.value = state.backend;
    }
    updateBackendUi();
  });
  elements.chooseChatDirBtn?.addEventListener('click', () => {
    void chooseChatDirectory({ focusChat: false });
  });
  elements.changeChatDirBtn?.addEventListener('click', () => {
    void chooseChatDirectory({ focusChat: true });
  });

  // Settings modal
  elements.settingsBtn?.addEventListener('click', openSettings);
  elements.closeSettingsBtn?.addEventListener('click', closeSettings);
  elements.cancelSettingsBtn?.addEventListener('click', closeSettings);
  elements.saveSettingsBtn?.addEventListener('click', handleSaveSettings);

  // Update temperature display
  elements.temperature?.addEventListener('input', (e) => {
    if (elements.temperatureValue) {
      elements.temperatureValue.textContent = e.target.value;
    }
  });

  // Update visibility when strategy changes
  elements.contextStrategy?.addEventListener('change', () => {
    updateMaxMessagesVisibility();
    updateContextStats();
  });

  // Update stats when values change
  elements.maxMessages?.addEventListener('input', updateContextStats);
  elements.maxTokens?.addEventListener('input', updateContextStats);

  // Close modal on backdrop click
  elements.settingsModal?.addEventListener('click', (e) => {
    if (e.target === elements.settingsModal) {
      closeSettings();
    }
  });

  if (typeof listen === 'function') {
    listen('install-status', (event) => {
      if (typeof event?.payload === 'string') {
        log('info', event.payload);
        elements.stepStatus.textContent = event.payload;
      }
    });
    listen('model-pull-status', (event) => {
      if (typeof event?.payload === 'string') {
        log('info', event.payload);
        elements.stepStatus.textContent = event.payload;
      }
    });
    listen('chat-status', (event) => {
      if (typeof event?.payload === 'string') {
        log('info', event.payload);
      }
    });
    listen('chat-stream', (event) => {
      if (state.shouldStopStreaming) {
        return;
      }
      if (typeof event?.payload === 'object' && event.payload !== null) {
        const { content } = event.payload;
        state.streamingBuffer = content || '';
        if (state.streamingBubble) {
          if (state.typingIndicator && state.streamingBuffer.length) {
            clearTypingIndicator();
          }

          // Render markdown in real-time during streaming for smooth experience
          updateStreamingMarkdown(state.streamingBubble, state.streamingBuffer);

          // Auto-scroll to bottom as messages come in
          elements.chatHistory.scrollTop = elements.chatHistory.scrollHeight;
        }
      }
    });
    listen('python-status', (event) => {
      if (typeof event?.payload === 'string') {
        log('info', event.payload);
        if (state.backend === 'python') {
          elements.stepStatus.textContent = event.payload;
        }
      }
    });
    listen('model-download-status', (event) => {
      if (typeof event?.payload === 'string') {
        log('info', event.payload);
        elements.stepStatus.textContent = event.payload;
      }
    });
    listen('model-download-progress', (event) => {
      if (typeof event?.payload === 'object' && event.payload !== null) {
        const { percent, downloaded_mb, total_mb } = event.payload;
        const message = `Downloading model: ${percent}% (${downloaded_mb}/${total_mb} MB)`;
        log('info', message);
        elements.stepStatus.textContent = message;
      }
    });
    listen('model-load-status', (event) => {
      if (typeof event?.payload === 'string') {
        log('info', event.payload);
        if (state.backend === 'embedded') {
          elements.stepStatus.textContent = event.payload;
        }
      }
    });
    listen('embedded-stream-done', (event) => {
      // Embedded stream finished
      console.debug('Embedded stream completed');
    });
  }
}

async function bootstrap() {
  setDefaultModelOptions();
  loadSettings();
  attachEventListeners();
  startNewConversation({ focusInput: false, persistSummary: false });
  updateChatDirDisplay();
  await loadAvailableRuntimes();

  if (typeof invoke !== 'function') {
    elements.stepStatus.textContent = 'Running outside Tauri. Setup requires the desktop application.';
    elements.startSetupBtn.disabled = true;
    return;
  }

  try {
    const config = await invoke('load_config');
    if (config && config.model && config.model.status === 'available') {
      state.backend = config.backend || state.availableRuntimes[0] || 'ollama';
      if (!state.availableRuntimes.includes(state.backend)) {
        state.backend = state.availableRuntimes[0] || 'ollama';
      }
      if (elements.backendSelect) {
        elements.backendSelect.value = state.backend;
      }
      updateBackendAvailability();
      elements.hardwareOutput.textContent = JSON.stringify(config.hardware, null, 2);
      state.hardware = config.hardware;
      state.paths = config.paths;
      updateChatDirDisplay();
      state.modelPath = config.model?.path ?? state.modelPath;
      if (state.backend === 'python') {
        state.pythonBinary = config.runtime?.python?.binary || state.pythonBinary;
        await ensurePythonBinary();
        let healthy = false;
        try {
          healthy = await invoke('python_engine_health');
        } catch (error) {
          console.debug('Python health check (bootstrap) failed:', error);
        }
        if (!healthy) {
          try {
            await invoke('start_python_engine', {
              modelPath: config.model?.path ?? null,
              pythonBinary: state.pythonBinary
            });
            healthy = await invoke('python_engine_health');
          } catch (error) {
            console.warn('Failed to auto-start python engine on bootstrap.', error);
          }
        }

        if (healthy) {
          state.activeModel = config.model.selected || 'gemma-1b-python';
          elements.activeModel.textContent = `Model: ${state.activeModel}`;
          elements.sendBtn.disabled = false;
          toggleViews(true);
          log('info', 'Loaded Python sidecar configuration; chat is ready.');
        } else {
          log(
            'info',
            'Python backend configured but not running. Click "Start Setup" to relaunch the sidecar.'
          );
        }
      } else if (state.backend === 'embedded') {
        try {
          await invoke('load_embedded_model', {
            modelPath: config.model?.path ?? state.modelPath
          });
          state.activeModel = config.model.selected || 'llama3.2-1b-embedded';
          elements.activeModel.textContent = `Model: ${state.activeModel}`;
          elements.sendBtn.disabled = false;
          toggleViews(true);
          log('info', 'Loaded embedded runtime configuration; chat is ready.');
        } catch (error) {
          console.warn('Failed to load embedded model on bootstrap.', error);
          log('info', 'Embedded backend configured but model not loaded. Click "Start Setup" to load the model.');
        }
      } else {
        elements.activeModel.textContent = `Model: ${config.model.selected}`;
        state.activeModel = config.model.selected;
        elements.sendBtn.disabled = false;
        toggleViews(true);
        log('info', 'Loaded existing configuration; chat is ready.');
      }
    }
  } catch (error) {
    console.warn('No config found yet.', error);
  }

  await refreshConversationList({ preserveSelection: false });
}

bootstrap();
