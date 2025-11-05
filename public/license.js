// License Activation Page Logic
const { invoke } = window.__TAURI__.tauri;

const elements = {
  trialInfo: document.getElementById('trialInfo'),
  trialStatus: document.getElementById('trialStatus'),
  trialMessage: document.getElementById('trialMessage'),
  statusMessage: document.getElementById('statusMessage'),
  tabButtons: document.querySelectorAll('.tab-btn'),
  startTrialBtn: document.getElementById('startTrialBtn'),
  activateLicenseBtn: document.getElementById('activateLicenseBtn'),
  purchaseBtn: document.getElementById('purchaseBtn'),
  purchaseBackBtn: document.getElementById('purchaseBackBtn'),
  closeBtn: document.getElementById('closeBtn'),
  licenseInput: document.getElementById('licenseInput'),
  headerSubtitle: document.getElementById('headerSubtitle'),
  // Manage tab elements
  licenseDetailsSection: document.getElementById('licenseDetailsSection'),
  noLicenseSection: document.getElementById('noLicenseSection'),
  licenseTier: document.getElementById('licenseTier'),
  licenseEmail: document.getElementById('licenseEmail'),
  licenseId: document.getElementById('licenseId'),
  licenseActivated: document.getElementById('licenseActivated'),
  licenseExpires: document.getElementById('licenseExpires'),
  requestRefundBtn: document.getElementById('requestRefundBtn'),
  deactivateLicenseBtn: document.getElementById('deactivateLicenseBtn'),
  // Modal elements
  refundModal: document.getElementById('refundModal'),
  cancelRefundBtn: document.getElementById('cancelRefundBtn'),
  confirmRefundBtn: document.getElementById('confirmRefundBtn'),
};

// State
let currentTab = 'trial';
let trialStatus = null;
let currentLicenseData = null;

// Initialize
async function init() {
  setupEventListeners();
  await checkExistingStatus();
}

function setupEventListeners() {
  // Tab switching
  elements.tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      switchTab(tab);
    });
  });

  // Start trial
  elements.startTrialBtn.addEventListener('click', () => startTrial());

  // Activate license
  elements.activateLicenseBtn.addEventListener('click', () => activateLicense());

  // Purchase
  elements.purchaseBtn.addEventListener('click', () => openPurchasePage());

  // Purchase back button (cancel)
  elements.purchaseBackBtn.addEventListener('click', () => {
    switchTab('trial');
  });

  // Close button - go back to main app
  elements.closeBtn.addEventListener('click', () => {
    window.location.href = '/index.html';
  });

  // Footer links (prevent navigation)
  document.getElementById('supportLink').addEventListener('click', (e) => {
    e.preventDefault();
    alert('Email support@privateai.app for assistance');
  });

  document.getElementById('privacyLink').addEventListener('click', (e) => {
    e.preventDefault();
    alert('Privacy policy available in app after activation');
  });

  document.getElementById('termsLink').addEventListener('click', (e) => {
    e.preventDefault();
    alert('Terms available in app after activation');
  });

  // Manage tab - refund
  elements.requestRefundBtn.addEventListener('click', () => openRefundModal());

  // Manage tab - deactivate
  elements.deactivateLicenseBtn.addEventListener('click', () => deactivateLicense());

  // Refund modal
  elements.cancelRefundBtn.addEventListener('click', () => closeRefundModal());
  elements.confirmRefundBtn.addEventListener('click', () => processRefund());

  // Close modal on overlay click
  elements.refundModal.addEventListener('click', (e) => {
    if (e.target === elements.refundModal) {
      closeRefundModal();
    }
  });
}

function switchTab(tab) {
  currentTab = tab;

  // Update buttons
  elements.tabButtons.forEach(btn => {
    if (btn.dataset.tab === tab) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  // Update content
  document.querySelectorAll('.tab-content').forEach(content => {
    content.classList.remove('active');
  });

  const tabId = tab === 'manage' ? 'manageTabContent' : `${tab}Tab`;
  document.getElementById(tabId).classList.add('active');

  // Load license data when switching to manage tab
  if (tab === 'manage') {
    loadLicenseDetails();
  }
}

async function checkExistingStatus() {
  try {
    const status = await invoke('check_license_status');

    console.log('[License] Status:', status);

    if (status.status === 'Active') {
      // Already licensed, redirect to main app
      showSuccess(`License active: ${status.email} (${status.tier})`);
      setTimeout(() => {
        window.location.href = '/index.html';
      }, 2000);
      return;
    }

    if (status.status === 'Trial') {
      // Show trial info
      trialStatus = status;
      elements.trialInfo.style.display = 'block';
      elements.trialInfo.classList.remove('expired');
      elements.trialStatus.textContent = `Trial Active - ${status.days_remaining} Day${status.days_remaining !== 1 ? 's' : ''} Remaining`;

      const expiryDate = new Date(status.expires_at * 1000);
      elements.trialMessage.textContent = `Your trial expires on ${expiryDate.toLocaleDateString()}. Purchase a license to continue using PrivateAI.`;

      // Disable start trial button
      elements.startTrialBtn.disabled = true;
      elements.startTrialBtn.textContent = 'Trial Already Started';

      // Switch to purchase tab if less than 2 days remaining
      if (status.days_remaining < 2) {
        switchTab('purchase');
      }

      return;
    }

    if (status.status === 'TrialExpired') {
      // Show expired trial
      elements.trialInfo.style.display = 'block';
      elements.trialInfo.classList.add('expired');
      elements.trialStatus.textContent = '⚠️ Trial Expired';
      elements.trialMessage.textContent = 'Your 7-day trial has ended. Purchase a license or activate an existing one to continue.';

      // Disable trial button
      elements.startTrialBtn.disabled = true;
      elements.startTrialBtn.textContent = 'Trial Expired';

      // Switch to purchase tab
      switchTab('purchase');

      return;
    }

    // No license or trial - default state
    console.log('[License] No active license or trial');
  } catch (error) {
    console.error('[License] Error checking status:', error);
    showError('Failed to check license status: ' + error);
  }
}

async function startTrial() {
  elements.startTrialBtn.disabled = true;
  elements.startTrialBtn.textContent = 'Starting Trial...';

  try {
    const trial = await invoke('start_trial_command');

    console.log('[License] Trial started:', trial);

    const expiresAtMs = trial.expires_at * 1000;
    const msRemaining = Math.max(0, expiresAtMs - Date.now());
    const daysRemaining = Math.max(
      1,
      Math.floor((msRemaining + 86_399_999) / 86_400_000)
    );

    elements.trialInfo.style.display = 'block';
    elements.trialInfo.classList.remove('expired');
    elements.trialStatus.textContent = `Trial Active - ${daysRemaining} Day${daysRemaining !== 1 ? 's' : ''} Remaining`;

    const expiryDate = new Date(expiresAtMs);
    elements.trialMessage.textContent = `Your trial expires on ${expiryDate.toLocaleString()}. Activate a license to keep using PrivateAI after the trial.`;

    elements.startTrialBtn.disabled = true;
    elements.startTrialBtn.textContent = 'Trial Active';

    showSuccess(`Trial started! ${daysRemaining} day${daysRemaining !== 1 ? 's' : ''} remaining.`);

    setTimeout(() => {
      window.location.href = '/index.html';
    }, 2000);
  } catch (error) {
    console.error('[License] Trial error:', error);
    showError('Failed to start trial: ' + error);
    elements.startTrialBtn.disabled = false;
    elements.startTrialBtn.textContent = 'Start 7-Day Free Trial';
  }
}

async function activateLicense() {
  const licenseCode = elements.licenseInput.value.trim();

  if (!licenseCode) {
    showError('Please enter a license code');
    return;
  }

  elements.activateLicenseBtn.disabled = true;
  elements.activateLicenseBtn.textContent = 'Activating...';

  try {
    const result = await invoke('activate_license_command', { licenseCode });

    console.log('[License] Activated:', result);

    showSuccess(`License activated successfully!
Email: ${result.license_data.email}
Tier: ${result.license_data.tier}
Devices: ${result.license_data.max_devices}`);

    setTimeout(() => {
      window.location.href = '/index.html';
    }, 3000);
  } catch (error) {
    console.error('[License] Activation error:', error);
    showError('Activation failed: ' + error);
    elements.activateLicenseBtn.disabled = false;
    elements.activateLicenseBtn.textContent = 'Activate License';
  }
}

async function openPurchasePage() {
  try {
    // Open embedded browser window with the buy license page
    await invoke('open_buy_license_window');
    showSuccess('Opening purchase page...');
  } catch (error) {
    console.error('[License] Failed to open purchase page:', error);
    showError('Failed to open purchase page: ' + error);
  }
}

function showSuccess(message) {
  elements.statusMessage.textContent = message;
  elements.statusMessage.className = 'status-message success';
  elements.statusMessage.style.display = 'block';

  setTimeout(() => {
    elements.statusMessage.style.display = 'none';
  }, 5000);
}

function showError(message) {
  elements.statusMessage.textContent = message;
  elements.statusMessage.className = 'status-message error';
  elements.statusMessage.style.display = 'block';

  setTimeout(() => {
    elements.statusMessage.style.display = 'none';
  }, 5000);
}

// Manage Tab Functions
async function loadLicenseDetails() {
  try {
    const status = await invoke('check_license_status');

    if (status.status === 'Active') {
      // Store license data for refund
      currentLicenseData = status;

      // Show license details
      elements.licenseDetailsSection.style.display = 'block';
      elements.noLicenseSection.style.display = 'none';

      // Populate fields
      elements.licenseTier.textContent = status.tier || '—';
      elements.licenseEmail.textContent = status.email || '—';
      elements.licenseId.textContent = status.id ? status.id.substring(0, 16) + '...' : '—';

      // Format dates
      if (status.activated_at) {
        const activatedDate = new Date(status.activated_at * 1000);
        elements.licenseActivated.textContent = activatedDate.toLocaleDateString();
      } else {
        elements.licenseActivated.textContent = '—';
      }

      if (status.expires_at) {
        const expiresDate = new Date(status.expires_at * 1000);
        elements.licenseExpires.textContent = expiresDate.toLocaleDateString();
      } else {
        elements.licenseExpires.textContent = 'Never (Lifetime)';
      }

    } else if (status.status === 'Trial') {
      // Show message for trial users
      elements.licenseDetailsSection.style.display = 'none';
      elements.noLicenseSection.style.display = 'block';
      elements.noLicenseSection.querySelector('p').textContent = 'You are currently using a trial. Purchase a license to manage your subscription.';
    } else {
      // No license
      elements.licenseDetailsSection.style.display = 'none';
      elements.noLicenseSection.style.display = 'block';
      elements.noLicenseSection.querySelector('p').textContent = 'No active license found. Please activate a license or start a trial.';
    }
  } catch (error) {
    console.error('[License] Error loading license details:', error);
    elements.licenseDetailsSection.style.display = 'none';
    elements.noLicenseSection.style.display = 'block';
    elements.noLicenseSection.querySelector('p').textContent = 'Failed to load license details.';
  }
}

function openRefundModal() {
  elements.refundModal.classList.add('active');
}

function closeRefundModal() {
  elements.refundModal.classList.remove('active');
}

async function processRefund() {
  // Disable buttons to prevent double-click
  elements.confirmRefundBtn.disabled = true;
  elements.cancelRefundBtn.disabled = true;
  elements.confirmRefundBtn.textContent = 'Processing...';

  try {
    const message = await invoke('request_refund');

    // Close modal
    closeRefundModal();

    // Show success message
    showSuccess(message);

    // Reload status after 2 seconds, then redirect to trial page
    setTimeout(() => {
      checkExistingStatus();
      switchTab('trial');
    }, 2000);

  } catch (error) {
    console.error('[License] Refund error:', error);
    showError('Refund failed: ' + error);

    // Re-enable buttons
    elements.confirmRefundBtn.disabled = false;
    elements.cancelRefundBtn.disabled = false;
    elements.confirmRefundBtn.textContent = 'Confirm Refund';

    // Close modal after error
    setTimeout(() => {
      closeRefundModal();
    }, 1000);
  }
}

async function deactivateLicense() {
  if (!confirm('Are you sure you want to deactivate your license? You can reactivate it later with your license code.')) {
    return;
  }

  elements.deactivateLicenseBtn.disabled = true;
  elements.deactivateLicenseBtn.textContent = 'Deactivating...';

  try {
    await invoke('deactivate_license');

    showSuccess('License deactivated successfully');

    // Reload status and switch to trial tab
    setTimeout(() => {
      checkExistingStatus();
      switchTab('trial');
    }, 2000);

  } catch (error) {
    console.error('[License] Deactivation error:', error);
    showError('Deactivation failed: ' + error);
    elements.deactivateLicenseBtn.disabled = false;
    elements.deactivateLicenseBtn.textContent = 'Deactivate License';
  }
}

// Start on page load
document.addEventListener('DOMContentLoaded', init);
