const { invoke } = window.__TAURI__.tauri;
const { listen } = window.__TAURI__.event;

const hardwareOutput = document.getElementById('hardwareOutput');
const statusOutput = document.getElementById('statusOutput');
const chatHistory = document.getElementById('chatHistory');
const chatForm = document.getElementById('chatForm');
const chatInput = document.getElementById('chatInput');
const installBtn = document.getElementById('installBtn');
const pullModelBtn = document.getElementById('pullModelBtn');
const modelSelect = document.getElementById('modelSelect');

let activeSessionId = null;
let isSending = false;
let currentModel = 'phi3:mini';
let availableRuntimes = [];
let currentRuntime = null;
let currentTypingIndicator = null;
let pythonHistory = [];
let ollamaHistory = [];
let chatsDir = null;

// Generate a session ID
function generateSessionId() {
  const timestamp = Date.now().toString(36);
  const randomPart = Math.random().toString(36).substring(2, 10);
  return `${timestamp}-${randomPart}`;
}

// Listen for status updates
listen('install-status', (event) => {
  appendStatus(event.payload);
});

listen('model-pull-status', (event) => {
  appendStatus(event.payload);
});

listen('chat-status', (event) => {
  appendStatus(event.payload);
});

function appendStatus(message) {
  const timestamp = new Date().toLocaleTimeString();
  statusOutput.textContent += `[${timestamp}] ${message}\n`;
  statusOutput.scrollTop = statusOutput.scrollHeight;
}

function appendMessageBubble({ role, content }) {
  const bubble = document.createElement('div');
  bubble.className = `bubble ${role}`;
  bubble.textContent = content;
  chatHistory.appendChild(bubble);
  chatHistory.scrollTop = chatHistory.scrollHeight;
  return bubble;
}

function attachTypingIndicator(bubble) {
  bubble.textContent = '';
  bubble.classList.add('streaming');
  const indicator = document.createElement('span');
  indicator.className = 'typing-indicator';
  indicator.innerHTML = '<span></span><span></span><span></span>';
  bubble.appendChild(indicator);
  currentTypingIndicator = indicator;
}

function clearTypingIndicator() {
  if (currentTypingIndicator) {
    const parent = currentTypingIndicator.parentElement;
    if (parent) {
      parent.classList.remove('streaming');
    }
    currentTypingIndicator.remove();
    currentTypingIndicator = null;
  }
}

async function initializeApp() {
  appendStatus('Initializing PrivateAI...');

  try {
    // Detect available runtimes
    appendStatus('Detecting available runtimes...');
    availableRuntimes = await invoke('get_available_runtimes');
    appendStatus(`Available runtimes: ${availableRuntimes.join(', ')}`);

    // Prefer Python runtime if available
    if (availableRuntimes.includes('python')) {
      currentRuntime = 'python';
      appendStatus('Using Python llama.cpp runtime');
      await initializePythonRuntime();
      return;
    }

    // Fall back to Ollama
    if (availableRuntimes.includes('ollama')) {
      currentRuntime = 'ollama';
      appendStatus('Using Ollama runtime');
      await initializeOllamaRuntime();
      return;
    }

    appendStatus('Error: No runtime available');
  } catch (error) {
    appendStatus(`Initialization error: ${error}`);
    console.error('Initialization error:', error);
  }
}

async function initializePythonRuntime() {
  try {
    pythonHistory = [];
    // Generate new session ID
    activeSessionId = generateSessionId();
    appendStatus(`Starting new session: ${activeSessionId}`);

    // Scan hardware
    appendStatus('Scanning hardware...');
    const hardware = await invoke('scan_hardware');
    hardwareOutput.textContent = JSON.stringify(hardware, null, 2);
    appendStatus('Hardware scan complete');

    // Setup storage
    appendStatus('Setting up storage directories...');
    const storagePaths = await invoke('setup_storage');
    chatsDir = storagePaths.chats;
    appendStatus('Storage setup complete');

    // Start Python engine with the downloaded model
    appendStatus('Starting Python AI engine...');
    const modelPath = `${await invoke('setup_storage').then(p => p.base_dir)}/Models/gemma-2-2b-it-Q4_K_M.gguf`;
    const pythonBinary = await invoke('resolve_python_binary');
    const result = await invoke('start_python_engine', { modelPath, pythonBinary });
    appendStatus(`Python engine started: ${result}`);

    // Hide Ollama-specific buttons
    installBtn.style.display = 'none';
    pullModelBtn.style.display = 'none';
    modelSelect.parentElement.style.display = 'none';

    appendStatus('Ready to chat with Python runtime!');
    chatForm.style.display = 'flex';

  } catch (error) {
    appendStatus(`Python runtime error: ${error}`);
    console.error('Python runtime error:', error);
  }
}

async function initializeOllamaRuntime() {
  try {
    pythonHistory = [];
    ollamaHistory = [];
    // Generate new session ID
    activeSessionId = generateSessionId();
    appendStatus(`Starting new session: ${activeSessionId}`);

    // Scan hardware
    appendStatus('Scanning hardware...');
    const hardware = await invoke('scan_hardware');
    hardwareOutput.textContent = JSON.stringify(hardware, null, 2);
    appendStatus('Hardware scan complete');

    // Setup storage
    appendStatus('Setting up storage directories...');
    const storagePaths = await invoke('setup_storage');
    chatsDir = storagePaths.chats;
    appendStatus('Storage setup complete');

    // Check if Ollama is installed
    appendStatus('Checking for Ollama...');
    const ollamaInstalled = await invoke('check_ollama_installed');

    if (!ollamaInstalled) {
      appendStatus('Ollama not found. Please click "Install Ollama" button.');
      installBtn.disabled = false;
      installBtn.style.display = 'block';
      return;
    }

    appendStatus('Ollama is installed');

    // Check if Ollama is running
    appendStatus('Checking Ollama service...');
    let ollamaRunning = await invoke('check_ollama_running');

    if (!ollamaRunning) {
      appendStatus('Starting Ollama service...');
      try {
        await invoke('start_ollama_service');
        // Wait a bit and check again
        await new Promise(resolve => setTimeout(resolve, 3000));
        ollamaRunning = await invoke('check_ollama_running');
      } catch (error) {
        appendStatus(`Failed to start Ollama: ${error}`);
        appendStatus('Please start Ollama manually and restart the app');
        return;
      }
    }

    if (!ollamaRunning) {
      appendStatus('Ollama service is not running. Please start it manually.');
      return;
    }

    appendStatus('Ollama service is running');

    // List available models
    appendStatus('Loading available models...');
    const models = await invoke('list_ollama_models');

    if (models.length === 0) {
      appendStatus('No models found. Please pull a model first.');
      pullModelBtn.disabled = false;
      pullModelBtn.style.display = 'block';
      return;
    }

    appendStatus(`Found ${models.length} model(s): ${models.join(', ')}`);

    // Populate model selector
    modelSelect.innerHTML = '';
    models.forEach((model) => {
      const option = document.createElement('option');
      option.value = model;
      option.textContent = model;
      modelSelect.appendChild(option);
    });

    if (models.length > 0) {
      currentModel = models[0];
      modelSelect.value = currentModel;
      // Show model selector
      modelSelect.parentElement.style.display = 'flex';
    }

    // Enable model pulling
    pullModelBtn.disabled = false;
    pullModelBtn.style.display = 'block';

    appendStatus('Ready to chat!');
    chatForm.style.display = 'flex';

  } catch (error) {
    appendStatus(`Initialization error: ${error}`);
    console.error('Initialization error:', error);
  }
}

async function installOllama() {
  try {
    installBtn.disabled = true;
    appendStatus('Starting Ollama installation...');

    const result = await invoke('install_ollama');
    appendStatus(result);

    if (result.includes('successfully')) {
      appendStatus('Ollama installed! Continuing setup...');
      installBtn.style.display = 'none';

      // Wait a moment for Ollama to fully start
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Continue initialization
      await continueSetup();
    }
  } catch (error) {
    appendStatus(`Installation failed: ${error}`);
    installBtn.disabled = false;
  }
}

async function continueSetup() {
  try {
    // Check if Ollama is running
    appendStatus('Checking Ollama service...');
    let ollamaRunning = await invoke('check_ollama_running');

    if (!ollamaRunning) {
      appendStatus('Ollama service not responding, waiting a bit more...');
      await new Promise(resolve => setTimeout(resolve, 5000));
      ollamaRunning = await invoke('check_ollama_running');
    }

    if (!ollamaRunning) {
      appendStatus('Ollama service is not running. Trying to start it...');
      try {
        await invoke('start_ollama_service');
        await new Promise(resolve => setTimeout(resolve, 3000));
        ollamaRunning = await invoke('check_ollama_running');
      } catch (error) {
        appendStatus(`Failed to start Ollama: ${error}`);
        appendStatus('Please start Ollama manually and restart the app');
        return;
      }
    }

    if (!ollamaRunning) {
      appendStatus('Ollama service is still not running. Please check if Ollama is running in your menu bar.');
      return;
    }

    appendStatus('Ollama service is running');

    // List available models
    appendStatus('Loading available models...');
    const models = await invoke('list_ollama_models');

    if (models.length === 0) {
      appendStatus('No models found. Please pull a model to start chatting.');
      pullModelBtn.disabled = false;
      pullModelBtn.style.display = 'block';
      return;
    }

    appendStatus(`Found ${models.length} model(s): ${models.join(', ')}`);

    // Populate model selector
    modelSelect.innerHTML = '';
    models.forEach((model) => {
      const option = document.createElement('option');
      option.value = model;
      option.textContent = model;
      modelSelect.appendChild(option);
    });

    if (models.length > 0) {
      currentModel = models[0];
      modelSelect.value = currentModel;
      modelSelect.parentElement.style.display = 'flex';
      chatForm.style.display = 'flex';
    }

    // Enable model pulling
    pullModelBtn.disabled = false;
    pullModelBtn.style.display = 'block';

    appendStatus('Ready to chat!');
  } catch (error) {
    appendStatus(`Setup error: ${error}`);
    console.error('Setup error:', error);
  }
}

async function pullModel() {
  try {
    pullModelBtn.disabled = true;

    // Default to phi3:mini - a small, fast model perfect for getting started
    const defaultModel = 'phi3:mini';
    const modelName = prompt(
      'Enter model name to pull:\n\nRecommended models:\n- phi3:mini (2GB, fast, good for most tasks)\n- llama3.2:3b (2GB, very capable)\n- llama3.1:8b (4.7GB, more powerful)\n\nLeave blank to pull phi3:mini:',
      defaultModel
    );

    const modelToPull = modelName && modelName.trim() !== '' ? modelName.trim() : defaultModel;

    appendStatus(`Pulling model: ${modelToPull}. This may take several minutes depending on model size...`);
    appendStatus('Download progress will be shown below...');

    const result = await invoke('pull_ollama_model', { model: modelToPull });
    appendStatus(result);

    // Refresh model list
    appendStatus('Refreshing model list...');
    const models = await invoke('list_ollama_models');
    modelSelect.innerHTML = '';
    models.forEach((model) => {
      const option = document.createElement('option');
      option.value = model;
      option.textContent = model;
      modelSelect.appendChild(option);
    });

    if (models.length > 0) {
      // Select the newly pulled model
      const pulledModel = models.find(m => m.startsWith(modelToPull.split(':')[0]));
      currentModel = pulledModel || models[0];
      modelSelect.value = currentModel;
      modelSelect.parentElement.style.display = 'flex';
      chatForm.style.display = 'flex';
      appendStatus(`Ready to chat with ${currentModel}!`);
    }

    pullModelBtn.disabled = false;
  } catch (error) {
    appendStatus(`Failed to pull model: ${error}`);
    pullModelBtn.disabled = false;
  }
}

// Listen for streaming tokens
let currentStreamBubble = null;
listen('python-stream-token', (event) => {
  if (currentStreamBubble) {
    if (currentTypingIndicator) {
      clearTypingIndicator();
    }
    currentStreamBubble.textContent += event.payload;
    chatHistory.scrollTop = chatHistory.scrollHeight;
  }
});

listen('python-stream-done', async () => {
  const bubble = currentStreamBubble;
  clearTypingIndicator();
  if (bubble) {
    const content = bubble.textContent || '';
    if (content) {
      pythonHistory.push({ role: 'assistant', content });

      // Save the assistant response to disk
      try {
        await invoke('append_chat_records', {
          sessionId: activeSessionId,
          records: [{ role: 'assistant', content, timestamp: new Date().toISOString() }],
          chatsDir: chatsDir
        });
      } catch (error) {
        console.error('Failed to save assistant message:', error);
      }
    }
  }
  currentStreamBubble = null;
  appendStatus('Response complete');
  isSending = false;
  chatInput.focus();
});

async function sendMessage(event) {
  event.preventDefault();
  if (isSending) return;

  const message = chatInput.value.trim();
  if (!message) return;

  isSending = true;
  chatInput.value = '';
  appendMessageBubble({ role: 'user', content: message });

  try {
    if (currentRuntime === 'python') {
      appendStatus('Sending message to Python AI...');

      // Save user message to disk
      try {
        await invoke('append_chat_records', {
          sessionId: activeSessionId,
          records: [{ role: 'user', content: message, timestamp: new Date().toISOString() }],
          chatsDir: chatsDir
        });
      } catch (error) {
        console.error('Failed to save user message:', error);
      }

      // Create empty bubble for streaming response
      currentStreamBubble = appendMessageBubble({ role: 'assistant', content: '' });
      attachTypingIndicator(currentStreamBubble);

      // Start streaming - pass sessionId and chatsDir to backend
      pythonHistory.push({ role: 'user', content: message });
      await invoke('python_chat_stream', {
        message,
        history: [],  // Send empty array - backend will load from disk
        sessionId: activeSessionId,
        chatsDir: chatsDir
      });

    } else if (currentRuntime === 'ollama') {
      currentModel = modelSelect.value;
      appendStatus(`Sending message to ${currentModel}...`);

      // Save user message to disk
      try {
        await invoke('append_chat_records', {
          sessionId: activeSessionId,
          records: [{ role: 'user', content: message, timestamp: new Date().toISOString() }],
          chatsDir: chatsDir
        });
      } catch (error) {
        console.error('Failed to save user message:', error);
      }

      ollamaHistory.push({ role: 'user', content: message });
      const response = await invoke('send_chat_message', {
        message: message,
        model: currentModel,
        history: [],  // Send empty array - backend will load from disk
        sessionId: activeSessionId,
        chatsDir: chatsDir
      });
      appendMessageBubble({ role: 'assistant', content: response });
      ollamaHistory.push({ role: 'assistant', content: response });

      // Save assistant response to disk
      try {
        await invoke('append_chat_records', {
          sessionId: activeSessionId,
          records: [{ role: 'assistant', content: response, timestamp: new Date().toISOString() }],
          chatsDir: chatsDir
        });
      } catch (error) {
        console.error('Failed to save assistant message:', error);
      }

      appendStatus('Response received');
      isSending = false;
      chatInput.focus();
    } else {
      throw new Error('No runtime selected');
      isSending = false;
      chatInput.focus();
    }
  } catch (error) {
    if (currentRuntime === 'python' && pythonHistory.length) {
      pythonHistory.pop();
    }
    if (currentRuntime === 'ollama' && ollamaHistory.length) {
      ollamaHistory.pop();
    }
    clearTypingIndicator();
    currentStreamBubble = null;
    appendMessageBubble({
      role: 'assistant',
      content: `Sorry, something went wrong: ${error}`,
    });
    appendStatus(`Error: ${error}`);
    isSending = false;
    chatInput.focus();
  }
}

// Event listeners
chatForm.addEventListener('submit', sendMessage);
installBtn.addEventListener('click', installOllama);
pullModelBtn.addEventListener('click', pullModel);
modelSelect.addEventListener('change', (e) => {
  currentModel = e.target.value;
  appendStatus(`Switched to model: ${currentModel}`);
});

// Initialize when page loads
initializeApp();
