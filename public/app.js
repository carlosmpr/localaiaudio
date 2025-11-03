const { invoke } = window.__TAURI__.tauri;
const { open } = window.__TAURI__.dialog;
const tauriWindowApi = window.__TAURI__?.window;

let selectedFilePath = null;
let latestTranscription = '';
let latestMediaPath = '';
const SOCIAL_PANEL_LABEL = 'social-panel';
const TRANSCRIPTION_STORAGE_KEY = 'privateai:lastTranscription';
const MEDIA_PATH_STORAGE_KEY = 'privateai:lastMediaPath';

const elements = {
  selectAudioBtn: document.getElementById('selectAudioBtn'),
  selectedFile: document.getElementById('selectedFile'),
  languageSelect: document.getElementById('languageSelect'),
  transcribeBtn: document.getElementById('transcribeBtn'),
  transcriptionOutput: document.getElementById('transcriptionOutput'),
  copyBtn: document.getElementById('copyBtn'),
  status: document.getElementById('status'),
  openPublishPanelBtn: document.getElementById('openPublishPanelBtn')
};

// Select audio file
elements.selectAudioBtn.addEventListener('click', async () => {
  try {
    const selected = await open({
      multiple: false,
      filters: [{
        name: 'Audio Files',
        extensions: ['wav', 'mp3', 'mp4', 'm4a', 'ogg', 'flac', 'aac', 'wma', 'webm']
      }]
    });

    if (selected) {
      selectedFilePath = selected;
      const fileName = selected.split('/').pop();

      elements.selectedFile.textContent = fileName;
      elements.transcribeBtn.disabled = false;
      latestTranscription = '';
      elements.openPublishPanelBtn.disabled = true;
      persistLatestTranscription('');
      latestMediaPath = selectedFilePath;
      persistLatestMediaPath(selectedFilePath);

      // Show info message for non-WAV files
      const fileExt = fileName.toLowerCase().split('.').pop();
      if (fileExt !== 'wav') {
        showStatus('Audio will be automatically converted to WAV format for transcription', 'info');
      } else {
        hideStatus();
      }

      // Reset output
      elements.transcriptionOutput.value = '';
      elements.copyBtn.disabled = true;
    }
  } catch (error) {
    showStatus('Error selecting file: ' + error, 'error');
  }
});

// Transcribe audio
elements.transcribeBtn.addEventListener('click', async () => {
  if (!selectedFilePath) {
    showStatus('Please select an audio file first', 'error');
    return;
  }

  // Disable buttons during transcription
  elements.transcribeBtn.disabled = true;
  elements.selectAudioBtn.disabled = true;
  elements.transcriptionOutput.value = '';
  elements.openPublishPanelBtn.disabled = true;
  latestTranscription = '';
  persistLatestTranscription('');

  showStatus('Transcribing... This may take a moment.', 'info');

  try {
    const language = elements.languageSelect.value || null;

    const result = await invoke('transcribe_audio', {
      filePath: selectedFilePath,
      language: language
    });

    const outputText = typeof result?.text === 'string' ? result.text : '';
    elements.transcriptionOutput.value = outputText;
    latestTranscription = outputText;
    persistLatestTranscription(outputText);
    const hasOutput = outputText.trim().length > 0;
    elements.copyBtn.disabled = !hasOutput;
    elements.openPublishPanelBtn.disabled = !hasOutput;
    if (hasOutput) {
      emitTranscriptionUpdate({
        text: outputText,
        mediaPath: latestMediaPath || selectedFilePath || null
      });
      showStatus('Transcription complete!', 'success');
    } else {
      showStatus('Transcription finished, but no text was returned.', 'info');
    }
  } catch (error) {
    console.error('Transcription error:', error);
    showStatus('Error: ' + error, 'error');
  } finally {
    elements.transcribeBtn.disabled = false;
    elements.selectAudioBtn.disabled = false;
  }
});

// Copy transcription
elements.copyBtn.addEventListener('click', async () => {
  const text = elements.transcriptionOutput.value;

  if (!text) return;

  try {
    await navigator.clipboard.writeText(text);
    showStatus('Copied to clipboard!', 'success');

    // Reset status after 2 seconds
    setTimeout(() => {
      hideStatus();
    }, 2000);
  } catch (error) {
    showStatus('Failed to copy: ' + error, 'error');
  }
});

// Helper functions
function showStatus(message, type) {
  elements.status.textContent = message;
  elements.status.className = `status ${type}`;
  elements.status.classList.remove('hidden');
}

function hideStatus() {
  elements.status.classList.add('hidden');
}

async function emitTranscriptionUpdate(payload) {
  if (!tauriWindowApi?.WebviewWindow || typeof tauriWindowApi.WebviewWindow.getByLabel !== 'function') {
    return;
  }

  try {
    const existing = tauriWindowApi.WebviewWindow.getByLabel(SOCIAL_PANEL_LABEL);
    if (existing) {
      await existing.emit('transcription:update', payload);
    }
  } catch (error) {
    console.warn('Unable to update social panel window:', error);
  }
}

async function openSocialPanel() {
  if (!latestTranscription || latestTranscription.trim().length === 0) {
    showStatus('Complete a transcription before opening the sharing panel.', 'info');
    return;
  }

  if (!tauriWindowApi?.WebviewWindow) {
    showStatus('Sharing panel is unavailable in this environment.', 'error');
    return;
  }

  const payload = { text: latestTranscription, mediaPath: latestMediaPath || null };
  let panel = null;

  try {
    panel = tauriWindowApi.WebviewWindow.getByLabel(SOCIAL_PANEL_LABEL);
  } catch (error) {
    console.warn('Unable to check for existing panel window:', error);
  }

  if (panel) {
    try {
      await panel.emit('transcription:update', payload);
      await panel.show();
      await panel.setFocus();
    } catch (error) {
      console.warn('Unable to focus sharing panel:', error);
    }
    return;
  }

  panel = new tauriWindowApi.WebviewWindow(SOCIAL_PANEL_LABEL, {
    url: 'social-panel.html',
    title: 'Publishing Control Panel',
    width: 1024,
    height: 780,
    resizable: true,
    focus: true
  });

  panel.once('tauri://created', () => {
    panel
      .emit('transcription:update', payload)
      .catch((error) => console.warn('Unable to send transcription to new panel:', error));
  });

  panel.once('tauri://error', (event) => {
    console.error('Failed to open sharing panel:', event);
    showStatus('Unable to open sharing panel.', 'error');
  });

  showStatus('Opening sharing panel…', 'info');
}

elements.openPublishPanelBtn.addEventListener('click', () => {
  openSocialPanel().catch((error) => {
    console.error('Failed to open sharing panel:', error);
    showStatus('Unable to open sharing panel.', 'error');
  });
});

function persistLatestTranscription(value) {
  try {
    window.localStorage.setItem(TRANSCRIPTION_STORAGE_KEY, value ?? '');
  } catch (error) {
    console.warn('Unable to persist transcription locally:', error);
  }
}

function persistLatestMediaPath(value) {
  try {
    if (value) {
      window.localStorage.setItem(MEDIA_PATH_STORAGE_KEY, value);
    } else {
      window.localStorage.removeItem(MEDIA_PATH_STORAGE_KEY);
    }
  } catch (error) {
    console.warn('Unable to persist media path locally:', error);
  }
}

try {
  const storedPath = window.localStorage.getItem(MEDIA_PATH_STORAGE_KEY);
  if (storedPath) {
    latestMediaPath = storedPath;
  }
} catch (error) {
  console.warn('Unable to restore media path from storage:', error);
}
