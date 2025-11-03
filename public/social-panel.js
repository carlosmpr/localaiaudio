const tauriWindowApi = window.__TAURI__?.window;
const appWindow = tauriWindowApi?.appWindow;

const draftText = document.getElementById('draftText');
const copyDraftBtn = document.getElementById('copyDraftBtn');
const clearDraftBtn = document.getElementById('clearDraftBtn');
const statusElement = document.getElementById('panelStatus');
const characterCountElement = document.getElementById('characterCount');
const platformButtons = Array.from(document.querySelectorAll('.platform-btn'));
const mediaPathDisplay = document.getElementById('mediaPathDisplay');
const copyMediaPathBtn = document.getElementById('copyMediaPathBtn');
const linkedinStartPostBtn = document.getElementById('linkedinStartPostBtn');
const linkedinOpenVideoBtn = document.getElementById('linkedinOpenVideoBtn');

const automationControllers = new Map();

const MEDIA_PATH_STORAGE_KEY = 'privateai:lastMediaPath';

const PLATFORM_URLS = {
  linkedin: 'https://www.linkedin.com/feed/?createPost=true',
  tiktok: 'https://www.tiktok.com/upload?lang=en',
  youtube: 'https://studio.youtube.com/',
  instagram: 'https://www.instagram.com/create/select/',
  x: 'https://x.com/compose/post'
};

const PLATFORM_TITLES = {
  linkedin: 'LinkedIn Publisher',
  tiktok: 'TikTok Upload',
  youtube: 'YouTube Studio',
  instagram: 'Instagram Creator',
  x: 'X Composer'
};

const PLATFORM_WINDOW_SIZES = {
  linkedin: { width: 1100, height: 850 },
  tiktok: { width: 1100, height: 850 },
  youtube: { width: 1200, height: 900 },
  instagram: { width: 1100, height: 850 },
  x: { width: 900, height: 700 }
};

let latestDraft = '';
let latestMediaPath = '';

function updateCharacterCount() {
  if (!characterCountElement) return;
  const length = draftText.value.length;
  const suffix = length === 1 ? 'character' : 'characters';
  characterCountElement.textContent = `${length} ${suffix}`;
}

function showPanelStatus(message, type = 'info') {
  if (!statusElement) return;
  statusElement.textContent = message;
  statusElement.className = `status ${type}`;
  statusElement.classList.remove('hidden');
}

function hidePanelStatus() {
  if (!statusElement) return;
  statusElement.classList.add('hidden');
}

function applyTranscription(text) {
  latestDraft = typeof text === 'string' ? text : '';
  draftText.value = latestDraft;
  updateCharacterCount();

  if (latestDraft.trim().length > 0) {
    showPanelStatus('Draft updated from the latest transcription.', 'success');
  } else {
    showPanelStatus('No transcription text received. Paste or type your post manually.', 'info');
  }
}

function updateMediaPathDisplay(path) {
  latestMediaPath = typeof path === 'string' ? path : '';
  if (mediaPathDisplay) {
    mediaPathDisplay.textContent = latestMediaPath || 'No media file captured yet.';
    mediaPathDisplay.classList.toggle('media-path--empty', latestMediaPath.length === 0);
  }
  if (copyMediaPathBtn) {
    copyMediaPathBtn.disabled = !latestMediaPath;
  }

  try {
    if (latestMediaPath) {
      window.localStorage.setItem(MEDIA_PATH_STORAGE_KEY, latestMediaPath);
    } else {
      window.localStorage.removeItem(MEDIA_PATH_STORAGE_KEY);
    }
  } catch (error) {
    console.warn('Unable to persist media path for sharing panel:', error);
  }
}

function setLinkedInButtonsState(enabled) {
  if (linkedinStartPostBtn) linkedinStartPostBtn.disabled = !enabled;
  if (linkedinOpenVideoBtn) linkedinOpenVideoBtn.disabled = !enabled;
}

function getLinkedInWindow() {
  if (!tauriWindowApi?.WebviewWindow || typeof tauriWindowApi.WebviewWindow.getByLabel !== 'function') {
    return null;
  }
  try {
    return tauriWindowApi.WebviewWindow.getByLabel('publish-linkedin');
  } catch {
    return null;
  }
}

async function copyDraftToClipboard({ showFeedback = true } = {}) {
  const value = draftText.value.trim();
  if (!value) {
    if (showFeedback) {
      showPanelStatus('Draft is empty. Add some text before copying.', 'error');
    }
    return false;
  }

  try {
    await navigator.clipboard.writeText(value);
    if (showFeedback) {
      showPanelStatus('Draft copied to clipboard.', 'success');
    }
    return true;
  } catch (error) {
    console.error('Failed to copy draft:', error);
    if (showFeedback) {
      showPanelStatus(`Failed to copy draft: ${error}`, 'error');
    }
    return false;
  }
}

function registerTranscriptionListener() {
  if (!appWindow || typeof appWindow.listen !== 'function') {
    console.warn('Tauri appWindow API unavailable; transcription updates will not sync.');
    return;
  }

  appWindow.listen('transcription:update', (event) => {
    const payload = event?.payload;
    if (typeof payload === 'string') {
      applyTranscription(payload);
      return;
    }

    if (payload && typeof payload === 'object') {
      if (typeof payload.text === 'string') {
        applyTranscription(payload.text);
      }
      if (typeof payload.mediaPath === 'string') {
        updateMediaPathDisplay(payload.mediaPath);
      }
    }
  });
}

async function launchPlatform(platform) {
  const url = PLATFORM_URLS[platform];
  const title = PLATFORM_TITLES[platform];
  const size = PLATFORM_WINDOW_SIZES[platform];

  if (!url || !tauriWindowApi?.WebviewWindow) {
    showPanelStatus('Platform launch is unavailable in this environment.', 'error');
    return;
  }

  const hasContent = draftText.value.trim().length > 0;
  if (hasContent) {
    await copyDraftToClipboard({ showFeedback: false });
  }

  const windowLabel = `publish-${platform}`;
  let targetWindow = null;

  try {
    targetWindow = tauriWindowApi.WebviewWindow.getByLabel(windowLabel);
  } catch (error) {
    console.warn(`Unable to lookup existing window for ${platform}:`, error);
  }

  if (targetWindow) {
    try {
      await targetWindow.show();
      await targetWindow.setFocus();
      showPanelStatus(`Focusing ${title}.`, 'info');
    } catch (error) {
      console.warn(`Unable to focus ${platform} window:`, error);
    }
    if (platform === 'linkedin') {
      ensureLinkedInAutomation(targetWindow);
    }
    return;
  }

  targetWindow = new tauriWindowApi.WebviewWindow(windowLabel, {
    url,
    title,
    width: size?.width ?? 1024,
    height: size?.height ?? 768,
    resizable: true,
    focus: true
  });

  if (platform === 'linkedin') {
    ensureLinkedInAutomation(targetWindow);
  }

  targetWindow.once('tauri://created', () => {
    const message = hasContent
      ? `Opening ${title}. Your draft is ready to paste.`
      : `Opening ${title}. Add content to your draft for quick pasting.`;
    showPanelStatus(message, 'info');
    if (platform === 'linkedin') {
      ensureLinkedInAutomation(targetWindow);
    }
  });

  targetWindow.once('tauri://error', (event) => {
    console.error(`Failed to open ${platform}:`, event);
    showPanelStatus(`Unable to open ${title}.`, 'error');
  });
}

copyDraftBtn.addEventListener('click', () => {
  copyDraftToClipboard().catch((error) => {
    console.error('Copy action failed:', error);
  });
});

clearDraftBtn.addEventListener('click', () => {
  draftText.value = '';
  latestDraft = '';
  updateCharacterCount();
  hidePanelStatus();
  draftText.focus();
});

draftText.addEventListener('input', () => {
  latestDraft = draftText.value;
  updateCharacterCount();
});

platformButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const platform = button.dataset.platform;
    if (!platform) return;
    launchPlatform(platform).catch((error) => {
      console.error(`Failed to launch ${platform}:`, error);
      showPanelStatus(`Unable to open ${PLATFORM_TITLES[platform] ?? 'platform'}.`, 'error');
    });
  });
});

if (copyMediaPathBtn) {
  copyMediaPathBtn.addEventListener('click', async () => {
    if (!latestMediaPath) {
      showPanelStatus('No media file path available yet.', 'error');
      return;
    }

    try {
      await navigator.clipboard.writeText(latestMediaPath);
      showPanelStatus('Media file path copied to clipboard.', 'success');
    } catch (error) {
      console.error('Failed to copy media path:', error);
      showPanelStatus(`Unable to copy media path: ${error}`, 'error');
    }
  });
}

if (linkedinStartPostBtn) {
  linkedinStartPostBtn.addEventListener('click', () => {
    const linkedInWindow = getLinkedInWindow();
    if (!linkedInWindow) {
      showPanelStatus('Open the LinkedIn window first.', 'error');
      return;
    }
    runLinkedInAutomation('start-post', linkedInWindow);
  });
}

if (linkedinOpenVideoBtn) {
  linkedinOpenVideoBtn.addEventListener('click', () => {
    const linkedInWindow = getLinkedInWindow();
    if (!linkedInWindow) {
      showPanelStatus('Open the LinkedIn window first.', 'error');
      return;
    }
    runLinkedInAutomation('open-video', linkedInWindow);
  });
}

function ensureLinkedInAutomation(linkedInWindow) {
  if (!linkedInWindow) return;

  const label = linkedInWindow.label ?? 'publish-linkedin';
  let controller = automationControllers.get(label);

  if (controller?.initialised) {
    controller.window = linkedInWindow;
    setLinkedInButtonsState(Boolean(controller.ready));
    return;
  }

  controller = { initialised: true, ready: false, window: linkedInWindow };
  automationControllers.set(label, controller);
  setLinkedInButtonsState(false);
  showPanelStatus('LinkedIn window opened. Waiting for page to load…', 'info');

  linkedInWindow
    .listen('privateai-linkedin-automation', (event) => {
      const result = event?.payload;
      if (!result) return;

      if (result.success) {
        if (result.step === 'start-post') {
          showPanelStatus('LinkedIn post composer opened.', 'info');
        } else if (result.step === 'open-video') {
          showPanelStatus('LinkedIn video composer ready. Upload your video.', 'success');
        } else {
          showPanelStatus('LinkedIn automation completed.', 'success');
        }
      } else {
        const fallback =
          result.step === 'start-post'
            ? 'Unable to locate the "Start a post" button automatically.'
            : result.step === 'open-video'
            ? 'Unable to find the video button automatically.'
            : 'LinkedIn automation failed.';
        const message = result.message || fallback;
        showPanelStatus(`${message} Please continue manually.`, 'error');
      }

      setLinkedInButtonsState(true);
    })
    .catch((error) => {
      console.warn('Failed to attach LinkedIn automation status listener:', error);
    });

  linkedInWindow
    .listen('tauri://page-load', (event) => {
      const url = event?.payload?.url || '';
      if (!url.includes('linkedin.com')) return;
      controller.ready = true;
      setLinkedInButtonsState(true);
      showPanelStatus('LinkedIn is ready. Use the quick action buttons to jump into posting.', 'info');
    })
    .catch((error) => {
      console.warn('Failed to listen for LinkedIn page load events:', error);
    });
}

function runLinkedInAutomation(action, linkedInWindow) {
  const label = linkedInWindow?.label ?? 'publish-linkedin';
  const controller = automationControllers.get(label);
  if (controller && !controller.ready) {
    showPanelStatus('LinkedIn is still loading. Try again in a moment.', 'info');
    return;
  }

  if (!linkedInWindow?.eval) {
    showPanelStatus('LinkedIn automation is unavailable in this environment.', 'error');
    return;
  }

  if (action === 'start-post') {
    showPanelStatus('Attempting to open the LinkedIn post composer…', 'info');
  } else if (action === 'open-video') {
    showPanelStatus('Trying to reveal the LinkedIn video picker…', 'info');
  }

  setLinkedInButtonsState(false);
  const script = buildLinkedInAutomationScript(action);

  linkedInWindow
    .eval(script)
    .catch((error) => {
      console.warn('LinkedIn automation script failed to evaluate:', error);
      showPanelStatus('Unable to execute LinkedIn helper. Please continue manually.', 'error');
    })
    .finally(() => {
      const refreshed = automationControllers.get(linkedInWindow.label ?? 'publish-linkedin');
      if (refreshed?.ready) {
        setLinkedInButtonsState(true);
      } else {
        setLinkedInButtonsState(false);
      }
    });
}

function buildLinkedInAutomationScript(action) {
  const helperFunctions = `
    const emitStatus = (payload) => {
      try {
        const emitter = window.__TAURI__?.event;
        if (!emitter || typeof emitter.emit !== 'function') {
          return Promise.resolve();
        }
        return emitter.emit('privateai-linkedin-automation', payload);
      } catch (err) {
        console.warn('LinkedIn automation failed to emit status:', err);
        return Promise.resolve();
      }
    };

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    const clickWithRetries = async (resolver, attempts, delay) => {
      for (let index = 0; index < attempts; index += 1) {
        try {
          const element = resolver();
          if (element) {
            element.scrollIntoView({ block: 'center', inline: 'center' });
            await tryClickElement(element);
            return true;
          }
        } catch (error) {
          console.warn('LinkedIn automation click error:', error);
        }
        await sleep(delay);
      }
      return false;
    };

    const tryClickElement = async (element) => {
      try {
        element.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
        element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
        element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      } catch (error) {
        console.warn('LinkedIn automation pointer click fallback error:', error);
        try {
          element.click();
        } catch (clickError) {
          console.warn('LinkedIn automation direct click failed:', clickError);
        }
      }
      await sleep(50);
    };

    const findBySelectors = (selectors) => {
      for (const selector of selectors) {
        const element = document.querySelector(selector);
        if (element) return element;
      }
      return null;
    };

    const findButtonByText = (keywords = []) => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const lowerKeywords = keywords.map((word) => word.toLowerCase());
      return buttons.find((button) => {
        const candidates = [
          button.textContent,
          button.innerText,
          button.getAttribute('aria-label'),
          button.getAttribute('title')
        ]
          .map((value) => (value || '').trim().toLowerCase())
          .filter(Boolean);
        return candidates.some((text) => lowerKeywords.some((keyword) => text.includes(keyword)));
      });
    };
  `;

  if (action === 'start-post') {
    return `
      ;(async () => {
        ${helperFunctions}

        try {
          await sleep(400);
          window.scrollTo({ top: 0, behavior: 'smooth' });
          const selectors = [
            'button[aria-label="Start a post"]',
            'button[data-control-name="share.trigger"]',
            'button.share-box-feed-entry__trigger',
            'button.share-box-feed-entry__trigger.artdeco-button',
            '.share-box-feed-entry__top-bar button',
            '.share-box-feed-entry__top-bar button.artdeco-button--muted',
            '.share-box-feed-entry__top-bar button[data-control-name]'
          ];
          const keywords = ['start a post', 'create a post', 'post', 'share'];
          const opened = await clickWithRetries(
            () => findBySelectors(selectors) || findButtonByText(keywords),
            15,
            600
          );
          await emitStatus({
            success: opened,
            step: 'start-post',
            message: opened ? undefined : 'Unable to find the "Start a post" button automatically.'
          });
        } catch (error) {
          console.warn('LinkedIn automation runtime error:', error);
          await emitStatus({
            success: false,
            step: 'start-post',
            message: error?.message || 'LinkedIn helper failed while starting a post.'
          });
        }
      })();
    `;
  }

  if (action === 'open-video') {
    return `
      ;(async () => {
        ${helperFunctions}

        try {
          await sleep(250);
          const selectors = [
            'button.video-detour-btn',
            'button[aria-label="Add a video"]',
            'button.share-box-feed-entry-toolbar__item[aria-label="Add a video"]',
            'button[data-control-name="video"]',
            '.share-box-feed-entry-toolbar__item[type="button"]'
          ];
          const keywords = ['video', 'add video'];
          const opened = await clickWithRetries(
            () => findBySelectors(selectors) || findButtonByText(keywords),
            20,
            600
          );
          await emitStatus({
            success: opened,
            step: 'open-video',
            message: opened ? undefined : 'Video button not found automatically.'
          });
        } catch (error) {
          console.warn('LinkedIn automation runtime error:', error);
          await emitStatus({
            success: false,
            step: 'open-video',
            message: error?.message || 'LinkedIn helper failed while opening the video picker.'
          });
        }
      })();
    `;
  }

  return `
    ;(async () => {
      console.warn('Unknown LinkedIn automation action: ${action}');
      await (window.__TAURI__?.event?.emit?.('privateai-linkedin-automation', {
        success: false,
        step: 'automation',
        message: 'Unknown LinkedIn helper action.'
      }) || Promise.resolve());
    })();
  `;
}

updateCharacterCount();
registerTranscriptionListener();

try {
  const stored = window.localStorage.getItem('privateai:lastTranscription');
  if (stored && stored.trim().length > 0) {
    applyTranscription(stored);
  }
} catch (error) {
  console.warn('Unable to restore transcription from storage:', error);
}

try {
  const storedMediaPath = window.localStorage.getItem(MEDIA_PATH_STORAGE_KEY);
  updateMediaPathDisplay(storedMediaPath || '');
} catch (error) {
  console.warn('Unable to restore media path from storage:', error);
  updateMediaPathDisplay('');
}
