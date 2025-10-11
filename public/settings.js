// Context Management Settings Module

// Default settings
const DEFAULT_SETTINGS = {
  contextStrategy: 'sliding', // 'all', 'sliding', 'smart'
  maxMessages: 20,
  maxTokens: 4096,
  temperature: 0.7
};

// Load settings from localStorage
export function loadSettings() {
  try {
    const saved = localStorage.getItem('privateai_settings');
    if (saved) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
    }
  } catch (error) {
    console.warn('Failed to load settings:', error);
  }
  return { ...DEFAULT_SETTINGS };
}

// Save settings to localStorage
export function saveSettings(settings) {
  try {
    localStorage.setItem('privateai_settings', JSON.stringify(settings));
    return true;
  } catch (error) {
    console.error('Failed to save settings:', error);
    return false;
  }
}

// Estimate token count (rough approximation: 1 token ≈ 4 characters)
export function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

// Apply context strategy to messages
export function applyContextStrategy(messages, settings) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return [];
  }

  const { contextStrategy, maxMessages, maxTokens } = settings;

  // Strategy 1: Send all messages
  if (contextStrategy === 'all') {
    return messages;
  }

  // Strategy 2: Sliding window - last N messages
  if (contextStrategy === 'sliding') {
    if (messages.length <= maxMessages) {
      return messages;
    }
    return messages.slice(-maxMessages);
  }

  // Strategy 3: Smart limit - keep important messages + recent
  if (contextStrategy === 'smart') {
    // Keep first message (context) + last N messages
    if (messages.length <= maxMessages) {
      return messages;
    }

    const result = [];
    let tokenCount = 0;

    // Always include the first user message for context
    if (messages[0]) {
      result.push(messages[0]);
      tokenCount += estimateTokens(messages[0].content);
    }

    // Add recent messages from the end, respecting token limit
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

// Get context statistics
export function getContextStats(messages, settings) {
  const totalMessages = messages.length;
  const totalTokens = messages.reduce((sum, msg) => sum + estimateTokens(msg.content), 0);
  const willSend = applyContextStrategy(messages, settings);
  const willSendCount = willSend.length;
  const willSendTokens = willSend.reduce((sum, msg) => sum + estimateTokens(msg.content), 0);

  return {
    totalMessages,
    totalTokens,
    willSendCount,
    willSendTokens
  };
}
