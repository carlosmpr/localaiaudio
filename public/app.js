const { invoke } = window.__TAURI__.tauri;
const { open } = window.__TAURI__.dialog;

let selectedFilePath = null;

const elements = {
  selectAudioBtn: document.getElementById('selectAudioBtn'),
  selectedFile: document.getElementById('selectedFile'),
  languageSelect: document.getElementById('languageSelect'),
  transcribeBtn: document.getElementById('transcribeBtn'),
  transcriptionOutput: document.getElementById('transcriptionOutput'),
  copyBtn: document.getElementById('copyBtn'),
  status: document.getElementById('status')
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

  showStatus('Transcribing... This may take a moment.', 'info');

  try {
    const language = elements.languageSelect.value || null;

    const result = await invoke('transcribe_audio', {
      filePath: selectedFilePath,
      language: language
    });

    elements.transcriptionOutput.value = result.text;
    elements.copyBtn.disabled = false;
    showStatus('Transcription complete!', 'success');
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
