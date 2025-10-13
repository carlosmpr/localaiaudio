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

import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const API_HOST = window.env?.HOST ?? '127.0.0.1';
const API_PORT = window.env?.PORT ?? '3333';
const API_BASE = `http://${API_HOST}:${API_PORT}`;

function App() {
  const [status, setStatus] = useState('Checking runtime…');
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState('');
  const [conversations, setConversations] = useState([]);
  const [sessionId, setSessionId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [prompt, setPrompt] = useState('');
  const [streaming, setStreaming] = useState(false);

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
                tempAssistant = {
                  id: `assistant-${Date.now()}`,
                  role: 'assistant',
                  content: '',
                  timestamp: new Date().toISOString()
                };
                setMessages((prev) => [...prev, tempAssistant]);
              }
              tempAssistant.content += eventPayload.chunk;
              setMessages((prev) => prev.map((msg) => (msg.id === tempAssistant.id ? tempAssistant : msg)));
              break;
            case 'done':
              tempAssistant = eventPayload.message;
              setMessages((prev) => prev.map((msg) => (msg.id === tempAssistant.id ? tempAssistant : msg)));
              loadConversations();
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

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#0f172a', color: '#e5e7eb' }}>
      <aside style={{ width: 280, borderRight: '1px solid rgba(148,163,184,0.2)', padding: 16 }}>
        <h2 style={{ marginTop: 0 }}>Conversations</h2>
        <button onClick={startNewConversation} style={{ marginBottom: 16 }}>New chat</button>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {conversations.map((conv) => (
            <li key={conv.sessionId}>
              <button
                style={{
                  width: '100%',
                  textAlign: 'left',
                  background: conv.sessionId === sessionId ? 'rgba(99,102,241,0.2)' : 'transparent',
                  color: 'inherit',
                  border: '1px solid rgba(99,102,241,0.2)',
                  borderRadius: 8,
                  padding: '8px 10px',
                  marginBottom: 8,
                  cursor: 'pointer'
                }}
                onClick={() => loadConversation(conv.sessionId)}
              >
                <div style={{ fontWeight: 600 }}>{conv.title ?? 'Untitled chat'}</div>
                <div style={{ fontSize: 12, opacity: 0.8 }}>{conv.preview ?? '—'}</div>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <main style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <header style={{ padding: '16px 24px', borderBottom: '1px solid rgba(148,163,184,0.2)' }}>
          <h1 style={{ margin: 0 }}>Private AI</h1>
          <p style={{ margin: '4px 0 0', color: '#cbd5f5' }}>{status}</p>
        </header>

        <section style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
          {messages.map((msg) => (
            <div key={msg.id} style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, opacity: 0.8 }}>{msg.role === 'assistant' ? 'AI' : 'You'}</div>
              <div style={{
                background: msg.role === 'assistant' ? 'rgba(99,102,241,0.15)' : 'rgba(239,68,68,0.15)',
                padding: '10px 14px',
                borderRadius: 12
              }}>
                {msg.content}
              </div>
            </div>
          ))}
        </section>

        <form onSubmit={sendMessage} style={{ padding: 24, borderTop: '1px solid rgba(148,163,184,0.2)' }}>
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Ask anything…"
            disabled={streaming}
            style={{ width: '100%', minHeight: 120, borderRadius: 12, padding: 12, resize: 'vertical' }}
          />
          <button type="submit" disabled={streaming || !prompt.trim()} style={{ marginTop: 12 }}>
            {streaming ? 'Generating…' : 'Send'}
          </button>
        </form>
      </main>
    </div>
  );
}

const container = document.getElementById('root');
createRoot(container).render(<App />);
