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
  backend: 'ollama',
  availableRuntimes: [],
  pythonBinary: null,
  modelPath: null
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
  chatHistory: document.getElementById('chatHistory'),
  chatForm: document.getElementById('chatForm'),
  chatInput: document.getElementById('chatInput'),
  sendBtn: document.getElementById('sendBtn'),
  activeModel: document.getElementById('activeModel')
};

const TAURI = window.__TAURI__ || {};
const invoke = TAURI.tauri?.invoke;
const listen = TAURI.event?.listen;

const stepsOrder = ['scan', 'storage', 'install', 'model', 'complete'];
const STEP_LABELS = {
  ollama: {
    install: 'Install & start Ollama',
    model: 'Download model'
  },
  python: {
    install: 'Start Python engine',
    model: 'Verify model & health'
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

  if (backend === 'python') {
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
    log('success', `Storage ready at ${paths.base_dir}`);

    if (state.backend === 'python') {
      await ensurePythonBinary();
      if (!state.pythonBinary) {
        throw new Error('Python runtime not found. Install llama-cpp-python or set PRIVATE_AI_PYTHON.');
      }

      setStep('install');
      elements.stepStatus.textContent = 'Starting embedded Python runtime...';
      log('info', 'Launching llama-cpp sidecar.');

      try {
        await invoke('stop_python_engine');
      } catch (preflightErr) {
        console.debug('Python engine stop (preflight) ignored:', preflightErr);
      }

      const defaultModelPath =
        state.modelPath ||
        (state.paths?.models != null
          ? `${String(state.paths.models).replace(/\\/g, '/')}/gemma-1b-it-q4_0.gguf`
          : null);

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

      setStep('model');
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

function appendMessageBubble(role, content = '') {
  const bubble = document.createElement('div');
  bubble.className = `bubble ${role}`;
  bubble.textContent = content;
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

  if (state.backend === 'python') {
    const ready = await ensurePythonEngineReady();
    if (!ready) {
      elements.sendBtn.disabled = false;
      elements.chatInput.focus();
      return;
    }
    const assistantBubble = appendMessageBubble('assistant', '');
    assistantBubble.classList.add('streaming');
    state.streamingBubble = assistantBubble;
    state.streamingBuffer = '';
    try {
      await invoke('python_chat_stream', { message });
      if (state.streamingBubble) {
        state.streamingBubble.textContent = state.streamingBuffer;
        state.streamingBubble.classList.remove('streaming');
      }
    } catch (error) {
      console.error(error);
      if (state.streamingBubble) {
        state.streamingBubble.textContent = `Python sidecar error: ${error?.message ?? error}`;
        state.streamingBubble.classList.remove('streaming');
      } else {
        appendMessageBubble('assistant', `Python sidecar error: ${error?.message ?? error}`);
      }
    } finally {
      state.streamingBubble = null;
      state.streamingBuffer = '';
      elements.sendBtn.disabled = false;
      elements.chatInput.focus();
    }
    return;
  }

  const assistantBubble = appendMessageBubble('assistant', '...');
  assistantBubble.classList.add('streaming');
  state.streamingBubble = assistantBubble;
  state.streamingBuffer = '';

  try {
    const response = await invoke('send_chat_message', {
      message,
      model: state.activeModel
    });
    if (state.streamingBubble) {
      state.streamingBubble.textContent = response;
      state.streamingBubble.classList.remove('streaming');
    }
  } catch (error) {
    console.error(error);
    if (state.streamingBubble) {
      state.streamingBubble.textContent = `Chat failed: ${error?.message ?? error}`;
      state.streamingBubble.classList.remove('streaming');
    } else {
      appendMessageBubble('assistant', `Chat failed: ${error?.message ?? error}`);
    }
  } finally {
    state.streamingBubble = null;
    state.streamingBuffer = '';
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

  state.sessionId = null;
  state.activeModel = null;
  state.hardware = null;
  state.paths = null;
  state.currentStep = null;
  elements.steps.forEach((li) => li.classList.remove('active', 'completed'));
  elements.stepStatus.textContent = 'Press "Start Setup" to begin.';
  elements.logEntries.innerHTML = '';
  elements.chatHistory.innerHTML = '';
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
}

function attachEventListeners() {
  elements.startSetupBtn.addEventListener('click', runSetup);
  elements.chatForm.addEventListener('submit', handleChatSubmit);
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
      if (typeof event?.payload === 'object' && event.payload !== null) {
        const { content } = event.payload;
        state.streamingBuffer = content || '';
        if (state.streamingBubble) {
          state.streamingBubble.textContent = state.streamingBuffer;
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
  }
}

async function bootstrap() {
  setDefaultModelOptions();
  attachEventListeners();
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
}

bootstrap();
