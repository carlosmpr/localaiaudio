# Settings Implementation Guide

## Overview
The settings panel has been created with UI and CSS. You need to add the JavaScript functions to make it functional.

## What's Already Done
✅ Settings modal HTML in `index.html`
✅ Settings modal CSS in `styles.css`
✅ Settings button added to chat header
✅ Settings module created in `settings.js`
✅ State object updated with settings
✅ Elements object updated with settings references

## Implementation Steps

### 1. Add these utility functions after the `getContextMessages()` function in app.js:

```javascript
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
```

### 2. Update `getContextMessages()` function to use context strategy:

Replace the existing `getContextMessages()` with:

```javascript
function getContextMessages() {
  const allMessages = state.conversation.map((record) => ({
    role: record.role,
    content: record.content
  }));

  return applyContextStrategy(allMessages);
}
```

### 3. Add event listeners in `attachEventListeners()` function:

Add these before the `if (typeof listen === 'function')` block:

```javascript
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
```

### 4. Load settings on bootstrap:

Add this at the beginning of the `bootstrap()` function, right after `setDefaultModelOptions()`:

```javascript
  loadSettings();
```

### 5. Update context stats when conversation changes:

Add `updateContextStats()` call after these operations:
- After `state.conversation.push(...)` in `handleChatSubmit()`
- After loading conversation in `selectConversation()`
- After rendering in `renderConversationHistory()`

## Testing

1. Start the app
2. Click "Settings" button in chat header
3. Change context strategy between "Full History", "Sliding Window", "Smart Limit"
4. Adjust max messages and see the "Will send to model" count update
5. Save settings and verify they persist after page reload
6. Send messages and verify only the filtered messages are sent to the model

## How It Works

- **Full History**: Sends all conversation messages (may hit context limits)
- **Sliding Window**: Sends only the last N messages (configurable)
- **Smart Limit**: Keeps first message + recent messages within token limit

This allows users to continue long conversations without hitting context limits!
