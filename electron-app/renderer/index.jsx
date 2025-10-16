// Polyfills for Node globals expected by some dependencies
if (typeof globalThis !== 'undefined') {
  if (!globalThis.global) {
    globalThis.global = globalThis;
  }
  if (!globalThis.process) {
    globalThis.process = { env: {} };
  } else if (!globalThis.process.env) {
    globalThis.process.env = {};
  }
}

import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import MarkdownMessage from './components/MarkdownMessage';

const API_HOST = window.env?.HOST ?? '127.0.0.1';
const API_PORT = window.env?.PORT ?? '3333';
const API_BASE = `http://${API_HOST}:${API_PORT}`;
const SETTINGS_STORAGE_KEY = 'privateai:settings';
const MIN_ALLOWED_TOKENS = 64;
const MAX_ALLOWED_TOKENS = 8192;

const DEFAULT_SETTINGS = {
  temperature: 0.7,
  maxTokens: 4096,
  contextStrategy: 'auto',
  messageWindow: 0,
  repeatPenalty: 1.18,
  repeatPenaltyTokens: 256
};

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function normaliseSettings(raw = {}) {
  const source = typeof raw === 'object' && raw !== null ? raw : {};
  const rawTemperature = Number(source.temperature);
  const temperature = Number.isFinite(rawTemperature)
    ? clamp(rawTemperature, 0, 2)
    : DEFAULT_SETTINGS.temperature;

  const rawMaxTokens = Number(source.maxTokens);
  const maxTokens = Number.isFinite(rawMaxTokens)
    ? clamp(Math.round(rawMaxTokens), MIN_ALLOWED_TOKENS, MAX_ALLOWED_TOKENS)
    : DEFAULT_SETTINGS.maxTokens;

  const allowedStrategies = new Set(['auto', 'sliding', 'none']);
  const contextStrategy = allowedStrategies.has(source.contextStrategy)
    ? source.contextStrategy
    : DEFAULT_SETTINGS.contextStrategy;

  const rawWindow = Number(source.messageWindow);
  const messageWindow = Number.isFinite(rawWindow)
    ? Math.max(0, Math.round(rawWindow))
    : DEFAULT_SETTINGS.messageWindow;

  const rawPenalty = Number(source.repeatPenalty);
  const repeatPenalty = Number.isFinite(rawPenalty)
    ? clamp(rawPenalty, 1, 2)
    : DEFAULT_SETTINGS.repeatPenalty;

  const rawPenaltyTokens = Number(source.repeatPenaltyTokens);
  const repeatPenaltyTokens = Number.isFinite(rawPenaltyTokens)
    ? clamp(Math.round(rawPenaltyTokens), 32, 1024)
    : DEFAULT_SETTINGS.repeatPenaltyTokens;

  return {
    temperature,
    maxTokens,
    contextStrategy,
    messageWindow,
    repeatPenalty,
    repeatPenaltyTokens
  };
}

function buildHistoryPayload(messages, windowSize) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return [];
  }
  const serialised = messages
    .filter(
      (msg) =>
        msg &&
        (msg.role === 'user' || msg.role === 'assistant' || msg.role === 'system') &&
        typeof msg.content === 'string'
    )
    .map((msg, index, arr) => {
      if (msg.role === 'user' && index === arr.length - 1) {
        return null;
      }
      return {
        role: msg.role,
        content: msg.content
      };
    })
    .filter(Boolean);

  if (!Number.isFinite(windowSize) || windowSize <= 0) {
    return serialised;
  }

  const maxEntries = Math.max(2, Math.floor(windowSize) * 2);
  return serialised.slice(-maxEntries);
}

function describeContext(settings) {
  if (!settings) return '';
  if (settings.contextStrategy === 'none') {
    return 'Context: reset each reply';
  }
  if (settings.contextStrategy === 'sliding') {
    if (!settings.messageWindow || settings.messageWindow <= 0) {
      return 'Context: sliding (unlimited)';
    }
    return `Context: last ${settings.messageWindow} turn${
      settings.messageWindow === 1 ? '' : 's'
    }`;
  }
  return 'Context: full conversation';
}

function formatTimestamp(value) {
  if (!value) return null;
  try {
    return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return null;
  }
}

function App() {
  const [status, setStatus] = useState('Checking runtime…');
  const [conversations, setConversations] = useState([]);
  const [sessionId, setSessionId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [prompt, setPrompt] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [settings, setSettings] = useState(() => normaliseSettings(DEFAULT_SETTINGS));
  const [draftSettings, setDraftSettings] = useState(() => normaliseSettings(DEFAULT_SETTINGS));
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const messagesViewportRef = useRef(null);
  const activeStreamControllerRef = useRef(null);
  const activeStreamMessageRef = useRef(null);

  function openSettings() {
    setDraftSettings(settings);
    setIsSettingsOpen(true);
  }

  function closeSettings() {
    setIsSettingsOpen(false);
  }

  function handleSettingsSubmit(event) {
    event.preventDefault();
    const normalised = normaliseSettings(draftSettings);
    setSettings(normalised);
    setDraftSettings(normalised);
    closeSettings();
  }

  function handleSettingsCancel(event) {
    event.preventDefault();
    setDraftSettings(settings);
    closeSettings();
  }

  function handleResetSettings() {
    const defaults = normaliseSettings(DEFAULT_SETTINGS);
    setDraftSettings(defaults);
  }

  const handleTemperatureChange = (event) => {
    const value = Number(event.target.value);
    setDraftSettings((prev) => ({
      ...prev,
      temperature: clamp(Number.isFinite(value) ? value : prev.temperature, 0, 2)
    }));
  };

  const handleMaxTokensChange = (event) => {
    const value = Number(event.target.value);
    if (!Number.isFinite(value)) {
      return;
    }
    setDraftSettings((prev) => ({
      ...prev,
      maxTokens: clamp(Math.round(value), MIN_ALLOWED_TOKENS, MAX_ALLOWED_TOKENS)
    }));
  };

  const handleMessageWindowChange = (event) => {
    const value = Number(event.target.value);
    setDraftSettings((prev) => ({
      ...prev,
      messageWindow: Number.isFinite(value) ? Math.max(0, Math.round(value)) : prev.messageWindow
    }));
  };

  const handleStrategyChange = (event) => {
    const value = event.target.value;
    setDraftSettings((prev) => ({
      ...prev,
      contextStrategy: ['auto', 'sliding', 'none'].includes(value) ? value : prev.contextStrategy
    }));
  };

  const handleSettingsBackdrop = (event) => {
    if (event.target === event.currentTarget) {
      setDraftSettings(settings);
      closeSettings();
    }
  };

  const handleRepeatPenaltyChange = (event) => {
    const value = Number(event.target.value);
    setDraftSettings((prev) => ({
      ...prev,
      repeatPenalty: Number.isFinite(value) ? clamp(value, 1, 2) : prev.repeatPenalty
    }));
  };

  const handleRepeatTokensChange = (event) => {
    const value = Number(event.target.value);
    setDraftSettings((prev) => ({
      ...prev,
      repeatPenaltyTokens: Number.isFinite(value)
        ? clamp(Math.round(value), 32, 1024)
        : prev.repeatPenaltyTokens
    }));
  };

  function stopStreamingResponse() {
    const controller = activeStreamControllerRef.current;
    if (controller) {
      controller.abort();
      activeStreamControllerRef.current = null;
    }
    const streamingId = activeStreamMessageRef.current;
    if (streamingId) {
      setMessages((prev) =>
        prev.map((msg) =>
          (msg.localId ?? msg.id) === streamingId ? { ...msg, streaming: false } : msg
        )
      );
      activeStreamMessageRef.current = null;
    }
    setStreaming(false);
  }

  async function deleteConversationRequest(targetSessionId) {
    if (!targetSessionId) return;
    if (streaming && targetSessionId === sessionId) {
      stopStreamingResponse();
    }
    const confirmed = window.confirm('Delete this conversation? This action cannot be undone.');
    if (!confirmed) return;
    try {
      const res = await fetch(`${API_BASE}/api/conversations/${targetSessionId}`, {
        method: 'DELETE'
      });
      if (!res.ok) {
        throw new Error(`Failed with status ${res.status}`);
      }
      setConversations((prev) => prev.filter((conv) => conv.sessionId !== targetSessionId));
      if (targetSessionId === sessionId) {
        setSessionId(null);
        setMessages([]);
      }
      loadConversations();
    } catch (error) {
      console.error(`Unable to delete conversation ${targetSessionId}`, error);
    }
  }

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        const normalised = normaliseSettings({ ...DEFAULT_SETTINGS, ...parsed });
        setSettings(normalised);
        setDraftSettings(normalised);
      }
    } catch (error) {
      console.warn('Unable to restore saved settings', error);
    }
  }, []);

  useEffect(() => () => {
    const controller = activeStreamControllerRef.current;
    if (controller) {
      controller.abort();
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    } catch (error) {
      console.warn('Unable to persist settings', error);
    }
  }, [settings]);

  async function refreshStatus() {
    try {
      const res = await fetch(`${API_BASE}/api/health`);
      if (!res.ok) throw new Error('Health check failed');
      const payload = await res.json();
      if (payload.modelLoaded && payload.modelPath) {
        setStatus(`Model ready: ${payload.modelPath}`);
      } else if (payload.modelPath) {
        setStatus(`Preparing model at ${payload.modelPath}`);
      } else {
        setStatus('Model not loaded yet. Add a GGUF model to resources/models.');
      }
    } catch (error) {
      setStatus(`Runtime unavailable: ${error.message}`);
    }
  }

  async function loadConversations() {
    try {
      const res = await fetch(`${API_BASE}/api/conversations`);
      if (!res.ok) throw new Error('Failed to load conversations');
      const payload = await res.json();
      setConversations(payload.conversations ?? []);
    } catch (error) {
      console.warn('Unable to load conversations', error);
    }
  }

  async function loadConversation(id) {
    try {
      const res = await fetch(`${API_BASE}/api/conversations/${id}`);
      if (!res.ok) throw new Error('Conversation not found');
      const payload = await res.json();
      setSessionId(id);
      setMessages(payload.conversation?.messages ?? []);
    } catch (error) {
      console.error(error);
    }
  }

  async function startNewConversation() {
    try {
      const res = await fetch(`${API_BASE}/api/conversations`, { method: 'POST' });
      if (!res.ok) throw new Error('Unable to create conversation');
      const payload = await res.json();
      setSessionId(payload.summary?.sessionId ?? null);
      setMessages(payload.conversation?.messages ?? []);
      setConversations((prev) => [payload.summary, ...prev]);
    } catch (error) {
      console.error(error);
    }
  }

  async function sendMessage(event) {
    event.preventDefault();
    if (!prompt.trim()) return;

    const trimmedPrompt = prompt.trim();
    const normalizedSettings = normaliseSettings(settings);
    activeStreamMessageRef.current = null;
    const payload = {
      message: trimmedPrompt,
      sessionId,
      settings: {
        temperature: normalizedSettings.temperature,
        maxTokens: normalizedSettings.maxTokens,
        contextStrategy: normalizedSettings.contextStrategy,
        messageWindow:
          normalizedSettings.contextStrategy === 'sliding' ? normalizedSettings.messageWindow : 0,
        repeatPenalty: {
          penalty: normalizedSettings.repeatPenalty,
          lastTokens: normalizedSettings.repeatPenaltyTokens,
          penalizeNewLine: true
        }
      }
    };

    setPrompt('');
    setStreaming(true);

    const localUser = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: trimmedPrompt,
      timestamp: new Date().toISOString()
    };
    const pendingMessages = [...messages, localUser];
    const historyWindow =
      normalizedSettings.contextStrategy === 'sliding'
        ? normalizedSettings.messageWindow
        : 0;
    payload.history = buildHistoryPayload(pendingMessages, historyWindow);

    setMessages((prev) => [...prev, localUser]);

    const controller = new AbortController();
    activeStreamControllerRef.current = controller;

    try {
      const res = await fetch(`${API_BASE}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      if (!res.ok || !res.body) {
        const errorPayload = await res.json().catch(() => ({}));
        throw new Error(errorPayload.error ?? `Request failed with status ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let tempAssistant = null;
      let tempAssistantLocalId = null;
      let tempAssistantIndex = null;
      let streamingBuffer = '';
      let flushTimer = null;

      const flushStreamingBuffer = () => {
        if (!tempAssistant || !streamingBuffer) {
          return;
        }
        tempAssistant = {
          ...tempAssistant,
          content: `${tempAssistant.content ?? ''}${streamingBuffer}`,
          streaming: true
        };
        streamingBuffer = '';
        setMessages((prev) => {
          if (!prev.length) return prev;
          const next = [...prev];
          let index = tempAssistantIndex ?? next.length - 1;
          if (
            index < 0 ||
            index >= next.length ||
            (next[index].localId ?? next[index].id) !== tempAssistant.localId
          ) {
            index = next.findIndex(
              (msg) => (msg.localId ?? msg.id) === tempAssistant.localId
            );
            tempAssistantIndex = index;
          }
          if (index >= 0) {
            next[index] = tempAssistant;
            return next;
          }
          return prev;
        });
      };

      const scheduleFlush = () => {
        if (flushTimer) return;
        flushTimer = setTimeout(() => {
          flushTimer = null;
          flushStreamingBuffer();
        }, 32);
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let index;
        while ((index = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, index).trim();
          buffer = buffer.slice(index + 1);
          if (!line) continue;
          let eventPayload;
          try {
            eventPayload = JSON.parse(line);
          } catch (error) {
            console.warn('Failed to parse chunk', error, line);
            continue;
          }

          switch (eventPayload.type) {
            case 'session':
              setSessionId(eventPayload.sessionId);
              loadConversations();
              break;
            case 'user-message':
              setMessages((prev) => [...prev.slice(0, -1), eventPayload.message]);
              break;
            case 'token':
              if (!tempAssistant) {
                tempAssistantLocalId = `assistant-${Date.now()}`;
                const streamingMessage = {
                  id: tempAssistantLocalId,
                  localId: tempAssistantLocalId,
                  role: 'assistant',
                  content: eventPayload.chunk ?? '',
                  timestamp: new Date().toISOString(),
                  streaming: true
                };
                tempAssistant = streamingMessage;
                activeStreamMessageRef.current = streamingMessage.localId;
                setMessages((prev) => {
                  const next = [...prev, streamingMessage];
                  tempAssistantIndex = next.length - 1;
                  return next;
                });
              } else {
                streamingBuffer += eventPayload.chunk ?? '';
                scheduleFlush();
              }
              break;
            case 'done':
              if (flushTimer) {
                clearTimeout(flushTimer);
                flushTimer = null;
              }
              flushStreamingBuffer();
              if (eventPayload.message) {
                const finalMessage = {
                  ...eventPayload.message,
                  localId: tempAssistant?.localId ?? tempAssistantLocalId ?? eventPayload.message.id,
                  streaming: false
                };
                tempAssistant = finalMessage;
                activeStreamMessageRef.current = null;
                setMessages((prev) => {
                  if (!prev.length) {
                    return [finalMessage];
                  }
                  const next = [...prev];
                  let index = tempAssistantIndex ?? next.length - 1;
                  const matches = (msg) =>
                    (msg.localId ?? msg.id) === (finalMessage.localId ?? finalMessage.id);
                  if (index < 0 || index >= next.length || !matches(next[index])) {
                    index = next.findIndex(matches);
                    tempAssistantIndex = index;
                  }
                  if (index >= 0) {
                    next[index] = finalMessage;
                    return next;
                  }
                  return [...prev, finalMessage];
                });
              }
              loadConversations();
              break;
            case 'aborted':
              if (tempAssistant) {
                if (flushTimer) {
                  clearTimeout(flushTimer);
                  flushTimer = null;
                }
                flushStreamingBuffer();
                const abortedMessage = {
                  ...tempAssistant,
                  streaming: false
                };
                tempAssistant = abortedMessage;
                activeStreamMessageRef.current = null;
                setMessages((prev) => {
                  if (!prev.length) return prev;
                  const next = [...prev];
                  let index = tempAssistantIndex ?? next.length - 1;
                  if (
                    index < 0 ||
                    index >= next.length ||
                    (next[index].localId ?? next[index].id) !== abortedMessage.localId
                  ) {
                    index = next.findIndex(
                      (msg) => (msg.localId ?? msg.id) === abortedMessage.localId
                    );
                    tempAssistantIndex = index;
                  }
                  if (index >= 0) {
                    next[index] = abortedMessage;
                    return next;
                  }
                  return prev;
                });
              }
              break;
            case 'error':
              console.error(eventPayload.message);
              break;
            default:
              break;
          }
        }
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        if (flushTimer) {
          clearTimeout(flushTimer);
          flushTimer = null;
        }
        flushStreamingBuffer();
        if (tempAssistant) {
          tempAssistant = {
            ...tempAssistant,
            streaming: false
          };
          setMessages((prev) => {
            const streamingId = tempAssistant.localId ?? tempAssistant.id;
            return prev.map((msg) =>
              (msg.localId ?? msg.id) === streamingId ? { ...msg, streaming: false } : msg
            );
          });
        }
      } else {
        console.error(error);
      }
    } finally {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      setStreaming(false);
      streamingBuffer = '';
      activeStreamControllerRef.current = null;
      activeStreamMessageRef.current = null;
      loadConversations();
    }
  }

  useEffect(() => {
    refreshStatus();
    loadConversations();
  }, []);

  useEffect(() => {
    if (sessionId) {
      loadConversation(sessionId);
    }
  }, [sessionId]);

  useEffect(() => {
    const viewport = messagesViewportRef.current;
    if (viewport) {
      viewport.scrollTop = viewport.scrollHeight;
    }
  }, [messages]);

  return (
    <div className="app">
      <aside className="panel sidebar">
        <div className="sidebar-header">
          <h2 className="sidebar-title">Conversations</h2>
          <button
            type="button"
            className="secondary"
            onClick={startNewConversation}
            disabled={streaming}
          >
            New chat
          </button>
        </div>
        <div className="conversation-list">
          {conversations.length === 0 ? (
            <div className="empty-state">Start a new chat to see it listed here.</div>
          ) : (
            conversations.map((conv) => {
              const isActive = conv.sessionId === sessionId;
              return (
                <button
                  key={conv.sessionId}
                  type="button"
                  className={`conversation-item${isActive ? ' active' : ''}`}
                  onClick={() => loadConversation(conv.sessionId)}
                >
                  <div className="conversation-item-header">
                    <h4>{conv.title ?? 'Untitled chat'}</h4>
                    <button
                      type="button"
                      className="icon-button delete-button"
                      title="Delete conversation"
                      aria-label={`Delete conversation ${conv.title ?? 'Untitled chat'}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        deleteConversationRequest(conv.sessionId);
                      }}
                    >
                      ✕
                    </button>
                  </div>
                  <p>{conv.preview ?? '—'}</p>
                </button>
              );
            })
          )}
        </div>
      </aside>

      <main className="panel chat">
        <header className="chat-header">
          <div>
            <h1>Private AI</h1>
            <p>{status}</p>
            <p className="settings-summary">
              {describeContext(settings)} • Temp: {settings.temperature.toFixed(2)} • Max tokens:{' '}
              {settings.maxTokens} • Anti-repeat: {settings.repeatPenalty.toFixed(2)} /{' '}
              {settings.repeatPenaltyTokens}
            </p>
          </div>
          <div className="chat-actions">
            <button
              type="button"
              className="secondary icon-button"
              aria-label="Conversation settings"
              onClick={openSettings}
            >
              <span aria-hidden="true">⚙️</span>
            </button>
            <div className="status">
              <span className="status-dot" />
              <span>{streaming ? 'Generating response…' : 'Ready'}</span>
            </div>
          </div>
        </header>

        <section className="messages" ref={messagesViewportRef}>
          {messages.length === 0 ? (
            <div className="empty-thread">
              Ask a question to start chatting with your private model.
            </div>
          ) : (
            messages.map((msg) => {
              const key = msg.id ?? msg.localId;
              const timestamp = formatTimestamp(msg.timestamp);
              return (
                <article key={key} className="message">
                  <div className={`message-avatar ${msg.role}`}>
                    {msg.role === 'assistant' ? 'AI' : 'You'}
                  </div>
                  <div
                    className={[
                      'message-content',
                      msg.role,
                      msg.streaming ? 'streaming' : ''
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    <div className="message-header">
                      <span className={`message-role ${msg.role}`}>
                        {msg.role === 'assistant' ? 'Assistant' : 'You'}
                      </span>
                      {timestamp ? (
                        <span className="message-timestamp">{timestamp}</span>
                      ) : null}
                    </div>
                    <MarkdownMessage content={msg.content ?? ''} streaming={Boolean(msg.streaming)} />
                  </div>
                </article>
              );
            })
          )}
        </section>

        <form className="composer" onSubmit={sendMessage}>
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Ask anything…"
            disabled={streaming}
          />
          <div className="composer-actions">
            <span className="status">
              <span className="status-dot" />
              <span>{streaming ? 'Generating response…' : 'Ready for input'}</span>
            </span>
            <div className="composer-buttons">
              {streaming ? (
                <button type="button" className="danger" onClick={stopStreamingResponse}>
                  Stop
                </button>
              ) : null}
              <button type="submit" className="primary" disabled={streaming || !prompt.trim()}>
                {streaming ? 'Generating…' : 'Send'}
              </button>
            </div>
          </div>
        </form>
      </main>

      <div
        className={`settings-modal ${isSettingsOpen ? 'visible' : ''}`}
        onMouseDown={handleSettingsBackdrop}
      >
        <form
          className="settings-panel"
          onMouseDown={(event) => event.stopPropagation()}
          onSubmit={handleSettingsSubmit}
        >
          <h2>Chat Settings</h2>
          <p className="settings-subtitle">
            Tune how much context is remembered and how long the assistant can respond.
          </p>

          <div className="settings-group">
            <label htmlFor="contextStrategySelect">Memory strategy</label>
            <select
              id="contextStrategySelect"
              value={draftSettings.contextStrategy}
              onChange={handleStrategyChange}
            >
              <option value="auto">Full conversation</option>
              <option value="sliding">Sliding window</option>
              <option value="none">Reset every reply</option>
            </select>
            <span className="settings-hint">
              {draftSettings.contextStrategy === 'sliding'
                ? 'Keeps a moving window of recent turns inside the model context.'
                : draftSettings.contextStrategy === 'none'
                ? 'Starts fresh for every reply and ignores earlier messages.'
                : 'Sends the entire conversation to the model until the context limit is reached.'}
            </span>
          </div>

          <div className="settings-group">
            <label htmlFor="messageWindowInput">Remembered turns</label>
            <input
              id="messageWindowInput"
              type="number"
              min={0}
              max={50}
              step={1}
              value={draftSettings.messageWindow}
              onChange={handleMessageWindowChange}
              disabled={draftSettings.contextStrategy !== 'sliding'}
            />
            <span className="settings-hint">
              {draftSettings.contextStrategy !== 'sliding'
                ? 'Enable sliding mode to limit how many turns stay in memory.'
                : draftSettings.messageWindow === 0
                ? 'Keeps the full conversation in memory (0 = unlimited).'
                : `Keeps the last ${draftSettings.messageWindow} turn${
                    draftSettings.messageWindow === 1 ? '' : 's'
                  } in the sliding window.`}
            </span>
          </div>

          <div className="settings-group">
            <label htmlFor="maxTokensInput">Max response tokens</label>
            <input
              id="maxTokensInput"
              type="number"
              min={MIN_ALLOWED_TOKENS}
              max={MAX_ALLOWED_TOKENS}
              step={64}
              value={draftSettings.maxTokens}
              onChange={handleMaxTokensChange}
            />
            <span className="settings-hint">
              Higher values let the assistant write longer answers (model limit {MAX_ALLOWED_TOKENS}
              ).
            </span>
          </div>

          <div className="settings-group">
            <label htmlFor="repeatPenaltyInput">Repetition penalty</label>
            <input
              id="repeatPenaltyInput"
              type="range"
              min={1}
              max={2}
              step={0.01}
              value={draftSettings.repeatPenalty}
              onChange={handleRepeatPenaltyChange}
            />
            <span className="settings-hint">
              {draftSettings.repeatPenalty.toFixed(2)} — push higher if responses loop, lower if the
              model stops too early.
            </span>
          </div>

          <div className="settings-group">
            <label htmlFor="repeatTokensInput">Penalty window (tokens)</label>
            <input
              id="repeatTokensInput"
              type="number"
              min={32}
              max={1024}
              step={32}
              value={draftSettings.repeatPenaltyTokens}
              onChange={handleRepeatTokensChange}
            />
            <span className="settings-hint">
              How many recent tokens to penalise when avoiding repetition. Larger values provide
              stronger anti-looping behaviour.
            </span>
          </div>

          <div className="settings-group">
            <label htmlFor="temperatureInput">Creativity</label>
            <input
              id="temperatureInput"
              type="range"
              min={0}
              max={2}
              step={0.05}
              value={draftSettings.temperature}
              onChange={handleTemperatureChange}
            />
            <span className="settings-hint">
              {draftSettings.temperature.toFixed(2)} — lower is more focused, higher is more
              exploratory.
            </span>
          </div>

          <div className="settings-actions">
            <button type="button" className="secondary" onClick={handleResetSettings}>
              Restore defaults
            </button>
            <div className="settings-actions-end">
              <button type="button" className="secondary" onClick={handleSettingsCancel}>
                Cancel
              </button>
              <button type="submit" className="primary">
                Save
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

const container = document.getElementById('root');
createRoot(container).render(<App />);
