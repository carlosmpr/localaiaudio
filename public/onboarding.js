// Onboarding Flow Logic
const { invoke } = window.__TAURI__.tauri;

const screens = {
  welcome: document.getElementById('welcomeScreen'),
  eula: document.getElementById('eulaScreen'),
  privacy: document.getElementById('privacyScreen'),
  terms: document.getElementById('termsScreen'),
  analytics: document.getElementById('analyticsScreen'),
  completion: document.getElementById('completionScreen')
};

const state = {
  currentScreen: 0,
  eulaAccepted: false,
  privacyAccepted: false,
  termsAccepted: false,
  analyticsOptIn: false,
  analyticsScrolled: false,
  eulaScrolled: false,
  privacyScrolled: false,
  termsScrolled: false
};

const screenOrder = ['welcome', 'eula', 'privacy', 'terms', 'analytics', 'completion'];

// Initialize
function init() {
  setupEventListeners();
  showScreen(0);
  updateProgress();
}

function setupEventListeners() {
  // Welcome screen
  document.getElementById('continueBtn').addEventListener('click', () => nextScreen());

  // EULA screen
  setupDocumentScreen('eula', 'eulaScroll', 'eulaScrollIndicator', 'eulaAccept', 'eulaNextBtn');
  document.getElementById('eulaBackBtn').addEventListener('click', () => prevScreen());
  document.getElementById('eulaNextBtn').addEventListener('click', () => {
    state.eulaAccepted = document.getElementById('eulaAccept').checked;
    nextScreen();
  });

  // Privacy screen
  setupDocumentScreen('privacy', 'privacyScroll', 'privacyScrollIndicator', 'privacyAccept', 'privacyNextBtn');
  document.getElementById('privacyBackBtn').addEventListener('click', () => prevScreen());
  document.getElementById('privacyNextBtn').addEventListener('click', () => {
    state.privacyAccepted = document.getElementById('privacyAccept').checked;
    nextScreen();
  });

  // Terms screen
  setupDocumentScreen('terms', 'termsScroll', 'termsScrollIndicator', 'termsAccept', 'termsNextBtn');
  document.getElementById('termsBackBtn').addEventListener('click', () => prevScreen());
  document.getElementById('termsNextBtn').addEventListener('click', () => {
    state.termsAccepted = document.getElementById('termsAccept').checked;
    nextScreen();
  });

  // Analytics screen - no scroll requirement, button is always enabled
  state.analyticsScrolled = true; // Mark as scrolled immediately
  document.getElementById('analyticsBackBtn').addEventListener('click', () => prevScreen());
  document.getElementById('analyticsNextBtn').addEventListener('click', () => {
    const analyticsYes = document.getElementById('analyticsYes');
    state.analyticsOptIn = analyticsYes.checked;
    nextScreen();
  });

  // Completion screen
  document.getElementById('completeBtn').addEventListener('click', () => completeOnboarding());

  // Prevent accidental link navigation
  document.getElementById('eulaFullLink').addEventListener('click', (e) => e.preventDefault());
  document.getElementById('privacyFullLink').addEventListener('click', (e) => e.preventDefault());
  document.getElementById('termsFullLink').addEventListener('click', (e) => e.preventDefault());
}

function setupDocumentScreen(name, scrollId, indicatorId, checkboxId, nextBtnId) {
  const scrollEl = document.getElementById(scrollId);
  const indicatorEl = document.getElementById(indicatorId);
  const checkboxEl = document.getElementById(checkboxId);
  const nextBtnEl = document.getElementById(nextBtnId);

  // Check if user scrolled to bottom
  scrollEl.addEventListener('scroll', () => {
    const scrolled = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight < 10;

    if (scrolled) {
      state[`${name}Scrolled`] = true;
      indicatorEl.classList.add('hidden');
      checkboxEl.disabled = false;
    }
  });

  // Enable next button when checkbox is checked
  checkboxEl.addEventListener('change', () => {
    nextBtnEl.disabled = !checkboxEl.checked;
  });
}

function setupScrollRequirement(scrollId, indicatorId, onScrolledToEnd) {
  const scrollEl = document.getElementById(scrollId);
  const indicatorEl = document.getElementById(indicatorId);

  const evaluateScrollPosition = () => {
    const scrolled = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight < 10;

    if (scrolled) {
      indicatorEl.classList.add('hidden');
      onScrolledToEnd();
    }
  };

  evaluateScrollPosition();
  scrollEl.addEventListener('scroll', evaluateScrollPosition);
}

function showScreen(index) {
  // Hide all screens
  Object.values(screens).forEach(screen => screen.classList.remove('visible'));

  // Show target screen
  const screenName = screenOrder[index];
  screens[screenName].classList.add('visible');

  state.currentScreen = index;
  updateProgress();

  // Special handling for completion screen
  if (screenName === 'completion') {
    updateCompletionScreen();
  }

  if (screenName === 'analytics') {
    // Analytics screen always has the button enabled (no scroll requirement)
    const nextBtn = document.getElementById('analyticsNextBtn');
    nextBtn.disabled = false;
  }
}

function nextScreen() {
  if (state.currentScreen < screenOrder.length - 1) {
    showScreen(state.currentScreen + 1);
  }
}

function prevScreen() {
  if (state.currentScreen > 0) {
    showScreen(state.currentScreen - 1);
  }
}

function updateProgress() {
  const progress = ((state.currentScreen + 1) / screenOrder.length) * 100;
  document.getElementById('progressFill').style.width = `${progress}%`;
  document.getElementById('progressText').textContent = `Step ${state.currentScreen + 1} of ${screenOrder.length}`;
}

function updateCompletionScreen() {
  const analyticsChoice = state.analyticsOptIn ? 'Enabled' : 'Not enabled';
  document.getElementById('analyticsChoice').textContent = analyticsChoice;
}

async function completeOnboarding() {
  const completeBtn = document.getElementById('completeBtn');
  completeBtn.disabled = true;
  completeBtn.textContent = 'Processing...';

  try {
    // Step 1: Accept legal terms
    console.log('[Onboarding] Accepting legal terms...');
    await invoke('accept_legal_terms', {
      eulaAccepted: state.eulaAccepted,
      privacyAccepted: state.privacyAccepted,
      termsAccepted: state.termsAccepted,
      analyticsOptIn: state.analyticsOptIn
    });

    console.log('[Onboarding] Legal terms accepted');

    // Step 2: Complete onboarding
    console.log('[Onboarding] Marking onboarding as complete...');
    await invoke('complete_onboarding');

    console.log('[Onboarding] Onboarding completed successfully');

    // Step 3: Redirect to main app
    window.location.href = '/index.html';
  } catch (error) {
    console.error('[Onboarding] Error:', error);
    alert(`Failed to complete onboarding: ${error}`);
    completeBtn.disabled = false;
    completeBtn.textContent = 'Start Using PrivateAI';
  }
}

// Start the onboarding flow
document.addEventListener('DOMContentLoaded', init);
