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
  const messagesViewportRef = useRef(null);

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

    const payload = {
      message: prompt.trim(),
      sessionId,
      settings: {}
    };

    setPrompt('');
    setStreaming(true);

    const localUser = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: payload.message,
      timestamp: new Date().toISOString()
    };
    setMessages((prev) => [...prev, localUser]);

    try {
      const res = await fetch(`${API_BASE}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
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
                tempAssistant = {
                  id: tempAssistantLocalId,
                  localId: tempAssistantLocalId,
                  role: 'assistant',
                  content: eventPayload.chunk ?? '',
                  timestamp: new Date().toISOString(),
                  streaming: true
                };
                setMessages((prev) => [...prev, tempAssistant]);
              } else {
                tempAssistant = {
                  ...tempAssistant,
                  content: `${tempAssistant.content ?? ''}${eventPayload.chunk ?? ''}`,
                  streaming: true
                };
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.localId === tempAssistant.localId ? tempAssistant : msg
                  )
                );
              }
              break;
            case 'done':
              if (eventPayload.message) {
                const finalMessage = {
                  ...eventPayload.message,
                  localId: tempAssistant?.localId ?? tempAssistantLocalId ?? eventPayload.message.id,
                  streaming: false
                };
                tempAssistant = finalMessage;
                setMessages((prev) => {
                  const hasPlaceholder = prev.some(
                    (msg) =>
                      msg.localId === finalMessage.localId || msg.id === finalMessage.id
                  );
                  if (hasPlaceholder) {
                    return prev.map((msg) =>
                      msg.localId === finalMessage.localId || msg.id === finalMessage.id
                        ? finalMessage
                        : msg
                    );
                  }
                  return [...prev, finalMessage];
                });
              }
              loadConversations();
              break;
            case 'aborted':
              if (tempAssistant) {
                const abortedMessage = {
                  ...tempAssistant,
                  streaming: false
                };
                tempAssistant = abortedMessage;
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.localId === abortedMessage.localId ? abortedMessage : msg
                  )
                );
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
      console.error(error);
    } finally {
      setStreaming(false);
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
                  <h4>{conv.title ?? 'Untitled chat'}</h4>
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
          </div>
          <div className="chat-actions">
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
                    <MarkdownMessage content={msg.content ?? ''} />
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
            <button type="submit" className="primary" disabled={streaming || !prompt.trim()}>
              {streaming ? 'Generating…' : 'Send'}
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}

const container = document.getElementById('root');
createRoot(container).render(<App />);
