const { invoke } = window.__TAURI__.tauri;
const { open } = window.__TAURI__.dialog;
const tauriWindowApi = window.__TAURI__?.window;
const tauriEventApi = window.__TAURI__?.event;

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
  openPublishPanelBtn: document.getElementById('openPublishPanelBtn'),
  loadingScreen: document.getElementById('loadingScreen'),
  loadingMessage: document.getElementById('loadingMessage'),
  trialBanner: document.getElementById('trialBanner'),
  trialBannerMessage: document.getElementById('trialBannerMessage'),
  trialBannerSubtext: document.getElementById('trialBannerSubtext'),
  trialBannerAction: document.getElementById('trialBannerAction'),
  manageLicenseBtn: document.getElementById('manageLicenseBtn')
};

const licenseState = {
  trialExpiry: null,
  trialBannerTimer: null,
  licenseStatus: null,
  licenseCheckInterval: null
};

let licenseRedirectPending = false;
let licenseCheckEventsBound = false;
let licenseExpiredListenerRegistered = false;

function setLoadingScreen(visible, message) {
  if (typeof message === 'string' && elements.loadingMessage) {
    elements.loadingMessage.textContent = message;
  }

  if (elements.loadingScreen) {
    if (visible) {
      elements.loadingScreen.classList.remove('hidden');
    } else {
      elements.loadingScreen.classList.add('hidden');
    }
  }
}

function clearTrialBannerCountdown() {
  if (licenseState.trialBannerTimer) {
    window.clearInterval(licenseState.trialBannerTimer);
    licenseState.trialBannerTimer = null;
  }
}

function hideTrialBanner() {
  clearTrialBannerCountdown();
  licenseState.trialExpiry = null;
  elements.trialBanner?.classList.add('hidden');
}

function renderTrialBannerCountdown() {
  if (!licenseState.trialExpiry) {
    return;
  }

  const now = Date.now();
  const msRemaining = licenseState.trialExpiry - now;

  if (msRemaining <= 0) {
    elements.trialBannerMessage.textContent = 'Trial expired';
    elements.trialBannerSubtext.textContent =
      'Your trial has ended. Activate a license to continue using PrivateAI Voice.';
    return;
  }

  const daysRemaining = Math.max(0, Math.floor(msRemaining / (1000 * 60 * 60 * 24)));

  if (daysRemaining >= 1) {
    elements.trialBannerMessage.textContent =
      daysRemaining === 1 ? 'Trial active – 1 day remaining' : `Trial active – ${daysRemaining} days remaining`;
  } else {
    const hoursRemaining = Math.max(1, Math.floor(msRemaining / (1000 * 60 * 60)));
    elements.trialBannerMessage.textContent =
      hoursRemaining === 1
        ? 'Trial expiring – 1 hour left'
        : `Trial expiring – ${hoursRemaining} hours left`;
  }

  const expiryDate = new Date(licenseState.trialExpiry);
  elements.trialBannerSubtext.textContent = `Expires on ${expiryDate.toLocaleString()}. Activate a license to keep access.`;
}

function updateTrialBanner(status) {
  if (!elements.trialBanner || !status || status.status !== 'Trial') {
    hideTrialBanner();
    return;
  }

  elements.trialBanner.classList.remove('hidden');
  licenseState.trialExpiry = status.expires_at * 1000;
  renderTrialBannerCountdown();
  clearTrialBannerCountdown();
  licenseState.trialBannerTimer = window.setInterval(renderTrialBannerCountdown, 60_000);
}

function redirectToLicense(reason) {
  if (licenseRedirectPending) {
    return false;
  }

  licenseRedirectPending = true;
  console.warn(`[License] ${reason} – redirecting to license page`);
  setLoadingScreen(false);
  window.location.href = '/license.html';
  return false;
}

function handleLicenseStatus(status) {
  licenseState.licenseStatus = status;

  if (!status || typeof status.status !== 'string') {
    hideTrialBanner();
    return true;
  }

  switch (status.status) {
    case 'NeedActivation':
      hideTrialBanner();
      return redirectToLicense('No license or trial detected');
    case 'TrialExpired':
      hideTrialBanner();
      return redirectToLicense('Trial expired');
    case 'Invalid':
      hideTrialBanner();
      return redirectToLicense(`License invalid: ${status.reason ?? 'Unknown reason'}`);
    case 'Trial':
      updateTrialBanner(status);
      return true;
    case 'Active':
      hideTrialBanner();
      return true;
    default:
      hideTrialBanner();
      return true;
  }
}

async function refreshLicenseStatus() {
  if (typeof invoke !== 'function') {
    return;
  }

  try {
    const status = await invoke('check_license_status');
    console.log('[License] Refreshed status:', status);
    const allowed = handleLicenseStatus(status);
    if (!allowed) {
      return;
    }
  } catch (error) {
    console.error('[License] Failed to refresh license status:', error);
  }
}

/* ========================================
   LICENSE MODAL FUNCTIONALITY
   ======================================== */

const licenseModalElements = {
  modal: document.getElementById('licenseModal'),
  closeBtn: document.getElementById('closeLicenseModalBtn'),
  trialInfo: document.getElementById('licenseTrialInfo'),
  trialStatus: document.getElementById('licenseTrialStatus'),
  trialMessage: document.getElementById('licenseTrialMessage'),
  statusMessage: document.getElementById('licenseStatusMessage'),
  tabButtons: document.querySelectorAll('.license-tab-btn'),
  startTrialBtn: document.getElementById('licenseStartTrialBtn'),
  activateLicenseBtn: document.getElementById('licenseActivateBtn'),
  purchaseBtn: document.getElementById('licensePurchaseBtn'),
  licenseCodeInput: document.getElementById('licenseCodeInput'),
  licenseDetailsSection: document.getElementById('licenseDetailsSection'),
  noLicenseSection: document.getElementById('licenseNoLicenseSection'),
  licenseTier: document.getElementById('manageLicenseTier'),
  licenseEmail: document.getElementById('manageLicenseEmail'),
  licenseId: document.getElementById('manageLicenseId'),
  licenseActivated: document.getElementById('manageLicenseActivated'),
  licenseExpires: document.getElementById('manageLicenseExpires'),
  requestRefundBtn: document.getElementById('licenseRequestRefundBtn'),
  deactivateLicenseBtn: document.getElementById('licenseDeactivateBtn'),
  refundModal: document.getElementById('refundConfirmModal'),
  cancelRefundBtn: document.getElementById('cancelRefundBtn'),
  confirmRefundBtn: document.getElementById('confirmRefundBtn'),
};

let currentLicenseTab = 'trial';
let currentLicenseData = null;

function openLicenseModal() {
  licenseModalElements.modal?.classList.remove('hidden');
  void checkLicenseStatus();
}

function closeLicenseModal() {
  licenseModalElements.modal?.classList.add('hidden');
}

function switchLicenseTab(tab) {
  currentLicenseTab = tab;

  licenseModalElements.tabButtons.forEach(btn => {
    if (btn.dataset.tab === tab) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  document.querySelectorAll('.license-tab-content').forEach(content => {
    content.classList.remove('active');
  });

  const tabId = `license${tab.charAt(0).toUpperCase() + tab.slice(1)}Tab`;
  document.getElementById(tabId)?.classList.add('active');

  if (tab === 'manage') {
    void loadLicenseDetails();
  }
}

async function checkLicenseStatus() {
  try {
    const status = await invoke('check_license_status');
    console.log('[License Modal] Status:', status);

    if (status.status === 'Active') {
      licenseModalElements.trialInfo.style.display = 'block';
      licenseModalElements.trialInfo.classList.remove('expired');
      licenseModalElements.trialStatus.textContent = `License Active: ${status.tier}`;
      licenseModalElements.trialMessage.textContent = `Licensed to: ${status.email}`;

      if (licenseModalElements.startTrialBtn) {
        licenseModalElements.startTrialBtn.disabled = true;
        licenseModalElements.startTrialBtn.textContent = 'License Active';
      }

      switchLicenseTab('manage');
      return;
    }

    if (status.status === 'Trial') {
      licenseModalElements.trialInfo.style.display = 'block';
      licenseModalElements.trialInfo.classList.remove('expired');
      licenseModalElements.trialStatus.textContent = `Trial Active - ${status.days_remaining} Day${status.days_remaining !== 1 ? 's' : ''} Remaining`;

      const expiryDate = new Date(status.expires_at * 1000);
      licenseModalElements.trialMessage.textContent = `Your trial expires on ${expiryDate.toLocaleDateString()}. Purchase a license to continue using PrivateAI Voice.`;

      if (licenseModalElements.startTrialBtn) {
        licenseModalElements.startTrialBtn.disabled = true;
        licenseModalElements.startTrialBtn.textContent = 'Trial Already Started';
      }

      return;
    }

    if (status.status === 'TrialExpired') {
      licenseModalElements.trialInfo.style.display = 'block';
      licenseModalElements.trialInfo.classList.add('expired');
      licenseModalElements.trialStatus.textContent = '⚠️ Trial Expired';
      licenseModalElements.trialMessage.textContent = 'Your 7-day trial has ended. Purchase a license or activate an existing one to continue.';

      if (licenseModalElements.startTrialBtn) {
        licenseModalElements.startTrialBtn.disabled = true;
        licenseModalElements.startTrialBtn.textContent = 'Trial Expired';
      }

      switchLicenseTab('purchase');
      return;
    }

    licenseModalElements.trialInfo.style.display = 'none';
    if (licenseModalElements.startTrialBtn) {
      licenseModalElements.startTrialBtn.disabled = false;
      licenseModalElements.startTrialBtn.textContent = 'Start 7-Day Free Trial';
    }
  } catch (error) {
    console.error('[License Modal] Error checking status:', error);
    showLicenseError('Failed to check license status: ' + error);
  }
}

async function startTrial() {
  if (licenseModalElements.startTrialBtn) {
    licenseModalElements.startTrialBtn.disabled = true;
    licenseModalElements.startTrialBtn.textContent = 'Starting Trial...';
  }

  try {
    const trial = await invoke('start_trial_command');
    console.log('[License Modal] Trial started:', trial);

    const expiresAtMs = trial.expires_at * 1000;
    const msRemaining = Math.max(0, expiresAtMs - Date.now());
    const daysRemaining = Math.max(1, Math.floor((msRemaining + 86_399_999) / 86_400_000));

    licenseModalElements.trialInfo.style.display = 'block';
    licenseModalElements.trialInfo.classList.remove('expired');
    licenseModalElements.trialStatus.textContent = `Trial Active - ${daysRemaining} Day${daysRemaining !== 1 ? 's' : ''} Remaining`;

    const expiryDate = new Date(expiresAtMs);
    licenseModalElements.trialMessage.textContent = `Your trial expires on ${expiryDate.toLocaleString()}. Activate a license to keep using PrivateAI Voice after the trial.`;

    if (licenseModalElements.startTrialBtn) {
      licenseModalElements.startTrialBtn.disabled = true;
      licenseModalElements.startTrialBtn.textContent = 'Trial Active';
    }

    showLicenseSuccess(`Trial started! ${daysRemaining} day${daysRemaining !== 1 ? 's' : ''} remaining.`);

    setTimeout(() => {
      closeLicenseModal();
    }, 2000);
  } catch (error) {
    console.error('[License Modal] Trial error:', error);
    showLicenseError('Failed to start trial: ' + error);
    if (licenseModalElements.startTrialBtn) {
      licenseModalElements.startTrialBtn.disabled = false;
      licenseModalElements.startTrialBtn.textContent = 'Start 7-Day Free Trial';
    }
  }
}

async function activateLicense() {
  const licenseCode = licenseModalElements.licenseCodeInput?.value.trim();

  if (!licenseCode) {
    showLicenseError('Please enter a license code');
    return;
  }

  if (licenseModalElements.activateLicenseBtn) {
    licenseModalElements.activateLicenseBtn.disabled = true;
    licenseModalElements.activateLicenseBtn.textContent = 'Activating...';
  }

  try {
    const result = await invoke('activate_license_command', { licenseCode });
    console.log('[License Modal] Activated:', result);

    if (licenseModalElements.activateLicenseBtn) {
      licenseModalElements.activateLicenseBtn.textContent = '✓ Activated';
      licenseModalElements.activateLicenseBtn.classList.add('success');
    }

    showLicenseSuccess(`License activated successfully!
Email: ${result.license_data.email}
Tier: ${result.license_data.tier}
Devices: ${result.license_data.max_devices}`);

    await refreshLicenseStatus();

    setTimeout(() => {
      if (licenseModalElements.activateLicenseBtn) {
        licenseModalElements.activateLicenseBtn.disabled = false;
        licenseModalElements.activateLicenseBtn.textContent = 'Activate License';
        licenseModalElements.activateLicenseBtn.classList.remove('success');
      }
      closeLicenseModal();
    }, 3000);
  } catch (error) {
    console.error('[License Modal] Activation error:', error);
    showLicenseError('Activation failed: ' + error);
    if (licenseModalElements.activateLicenseBtn) {
      licenseModalElements.activateLicenseBtn.disabled = false;
      licenseModalElements.activateLicenseBtn.textContent = 'Activate License';
    }
  }
}

async function openPurchasePage() {
  try {
    await invoke('open_buy_license_window');
    showLicenseSuccess('Opening purchase page...');
  } catch (error) {
    console.error('[License Modal] Failed to open purchase page:', error);
    showLicenseError('Failed to open purchase page: ' + error);
  }
}

async function loadLicenseDetails() {
  try {
    const status = await invoke('check_license_status');

    if (status.status === 'Active') {
      currentLicenseData = status;

      licenseModalElements.licenseDetailsSection.style.display = 'block';
      licenseModalElements.noLicenseSection.style.display = 'none';

      licenseModalElements.licenseTier.textContent = status.tier || '—';
      licenseModalElements.licenseEmail.textContent = status.email || '—';
      licenseModalElements.licenseId.textContent = status.id ? `${status.id.substring(0, 16)}...` : '—';

      if (status.activated_at) {
        const activatedDate = new Date(status.activated_at * 1000);
        licenseModalElements.licenseActivated.textContent = activatedDate.toLocaleDateString();
      } else {
        licenseModalElements.licenseActivated.textContent = '—';
      }

      if (status.expires_at) {
        const expiresDate = new Date(status.expires_at * 1000);
        licenseModalElements.licenseExpires.textContent = expiresDate.toLocaleDateString();
      } else {
        licenseModalElements.licenseExpires.textContent = 'Never (Lifetime)';
      }
    } else if (status.status === 'Trial') {
      licenseModalElements.licenseDetailsSection.style.display = 'none';
      licenseModalElements.noLicenseSection.style.display = 'block';
      licenseModalElements.noLicenseSection.querySelector('p').textContent =
        'You are currently using a trial. Purchase a license to manage your subscription.';
    } else {
      licenseModalElements.licenseDetailsSection.style.display = 'none';
      licenseModalElements.noLicenseSection.style.display = 'block';
      licenseModalElements.noLicenseSection.querySelector('p').textContent =
        'No active license found. Please activate a license or start a trial.';
    }
  } catch (error) {
    console.error('[License Modal] Error loading license details:', error);
    licenseModalElements.licenseDetailsSection.style.display = 'none';
    licenseModalElements.noLicenseSection.style.display = 'block';
    licenseModalElements.noLicenseSection.querySelector('p').textContent = 'Failed to load license details.';
  }
}

function openRefundModal() {
  licenseModalElements.refundModal?.classList.remove('hidden');
}

function closeRefundModal() {
  licenseModalElements.refundModal?.classList.add('hidden');
}

async function processRefund() {
  if (licenseModalElements.confirmRefundBtn) {
    licenseModalElements.confirmRefundBtn.disabled = true;
    licenseModalElements.confirmRefundBtn.textContent = 'Processing...';
  }
  if (licenseModalElements.cancelRefundBtn) {
    licenseModalElements.cancelRefundBtn.disabled = true;
  }

  try {
    const message = await invoke('request_refund');
    closeRefundModal();
    showLicenseSuccess(message);

    setTimeout(() => {
      void checkLicenseStatus();
      switchLicenseTab('trial');
    }, 2000);
  } catch (error) {
    console.error('[License Modal] Refund error:', error);
    showLicenseError('Refund failed: ' + error);

    if (licenseModalElements.confirmRefundBtn) {
      licenseModalElements.confirmRefundBtn.disabled = false;
      licenseModalElements.confirmRefundBtn.textContent = 'Confirm Refund';
    }
    if (licenseModalElements.cancelRefundBtn) {
      licenseModalElements.cancelRefundBtn.disabled = false;
    }

    setTimeout(() => {
      closeRefundModal();
    }, 1000);
  }
}

async function deactivateLicense() {
  if (!confirm('Are you sure you want to deactivate your license? You can reactivate it later with your license code.')) {
    return;
  }

  if (licenseModalElements.deactivateLicenseBtn) {
    licenseModalElements.deactivateLicenseBtn.disabled = true;
    licenseModalElements.deactivateLicenseBtn.textContent = 'Deactivating...';
  }

  try {
    await invoke('deactivate_license');

    if (licenseModalElements.deactivateLicenseBtn) {
      licenseModalElements.deactivateLicenseBtn.textContent = '✓ Deactivated';
      licenseModalElements.deactivateLicenseBtn.classList.add('success');
    }

    showLicenseSuccess('License deactivated successfully');

    await refreshLicenseStatus();

    setTimeout(() => {
      if (licenseModalElements.deactivateLicenseBtn) {
        licenseModalElements.deactivateLicenseBtn.disabled = false;
        licenseModalElements.deactivateLicenseBtn.textContent = 'Deactivate License';
        licenseModalElements.deactivateLicenseBtn.classList.remove('success');
      }
      void checkLicenseStatus();
      switchLicenseTab('trial');
    }, 2000);
  } catch (error) {
    console.error('[License Modal] Deactivation error:', error);
    showLicenseError('Deactivation failed: ' + error);
    if (licenseModalElements.deactivateLicenseBtn) {
      licenseModalElements.deactivateLicenseBtn.disabled = false;
      licenseModalElements.deactivateLicenseBtn.textContent = 'Deactivate License';
    }
  }
}

function showLicenseSuccess(message) {
  if (!licenseModalElements.statusMessage) return;
  licenseModalElements.statusMessage.textContent = message;
  licenseModalElements.statusMessage.className = 'license-status-message success';

  setTimeout(() => {
    licenseModalElements.statusMessage.style.display = 'none';
  }, 5000);
}

function showLicenseError(message) {
  if (!licenseModalElements.statusMessage) return;
  licenseModalElements.statusMessage.textContent = message;
  licenseModalElements.statusMessage.className = 'license-status-message error';

  setTimeout(() => {
    licenseModalElements.statusMessage.style.display = 'none';
  }, 5000);
}

function setupLicenseModalListeners() {
  licenseModalElements.closeBtn?.addEventListener('click', closeLicenseModal);

  licenseModalElements.modal?.addEventListener('click', (event) => {
    if (event.target === licenseModalElements.modal) {
      closeLicenseModal();
    }
  });

  licenseModalElements.tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      switchLicenseTab(tab);
    });
  });

  licenseModalElements.startTrialBtn?.addEventListener('click', () => {
    void startTrial();
  });

  licenseModalElements.activateLicenseBtn?.addEventListener('click', () => {
    void activateLicense();
  });

  licenseModalElements.purchaseBtn?.addEventListener('click', () => {
    void openPurchasePage();
  });

  licenseModalElements.requestRefundBtn?.addEventListener('click', () => openRefundModal());

  licenseModalElements.deactivateLicenseBtn?.addEventListener('click', () => {
    void deactivateLicense();
  });

  licenseModalElements.cancelRefundBtn?.addEventListener('click', () => closeRefundModal());
  licenseModalElements.confirmRefundBtn?.addEventListener('click', () => {
    void processRefund();
  });

  licenseModalElements.refundModal?.addEventListener('click', (event) => {
    if (event.target === licenseModalElements.refundModal) {
      closeRefundModal();
    }
  });
}

setupLicenseModalListeners();

async function bootstrap() {
  setLoadingScreen(true, 'Initializing PrivateAI Voice…');

  if (typeof invoke !== 'function') {
    setLoadingScreen(false);
    return;
  }

  try {
    const onboardingStatus = await invoke('check_onboarding_status');
    if (!onboardingStatus.completed) {
      console.log('[Bootstrap] Onboarding not completed, redirecting to onboarding flow');
      window.location.href = '/onboarding.html';
      return;
    }
    console.log('[Bootstrap] Onboarding completed, continuing to main app');
  } catch (error) {
    console.error('[Bootstrap] Failed to check onboarding status:', error);
  }

  try {
    const licenseStatus = await invoke('check_license_status');
    console.log('[Bootstrap] License status:', licenseStatus);
    const allowed = handleLicenseStatus(licenseStatus);
    if (!allowed) {
      return;
    }

    if (!licenseCheckEventsBound) {
      window.addEventListener('focus', () => {
        void refreshLicenseStatus();
      });
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          void refreshLicenseStatus();
        }
      });
      licenseCheckEventsBound = true;
    }

    if (!licenseExpiredListenerRegistered && tauriEventApi?.listen) {
      void tauriEventApi.listen('license-expired', () => {
        redirectToLicense('License expired or became invalid');
      });
      licenseExpiredListenerRegistered = true;
    }

    if (!licenseState.licenseCheckInterval) {
      licenseState.licenseCheckInterval = window.setInterval(() => {
        void refreshLicenseStatus();
      }, 5 * 60 * 1000);
    }
  } catch (error) {
    console.error('[Bootstrap] Failed to check license status:', error);
  }

  setLoadingScreen(false);
}

elements.trialBannerAction?.addEventListener('click', () => {
  openLicenseModal();
});

elements.manageLicenseBtn?.addEventListener('click', () => {
  openLicenseModal();
});

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

try {
  const storedTranscript = window.localStorage.getItem(TRANSCRIPTION_STORAGE_KEY);
  if (storedTranscript) {
    latestTranscription = storedTranscript;
    elements.transcriptionOutput.value = storedTranscript;
    const hasOutput = storedTranscript.trim().length > 0;
    elements.copyBtn.disabled = !hasOutput;
    elements.openPublishPanelBtn.disabled = !hasOutput;
  }
} catch (error) {
  console.warn('Unable to restore transcription from storage:', error);
}

if (
  !window.location.pathname.includes('license.html') &&
  !window.location.pathname.includes('onboarding.html')
) {
  void bootstrap();
}
