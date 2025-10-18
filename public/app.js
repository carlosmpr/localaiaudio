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
  isStreaming: false,
  shouldStopStreaming: false,
  backend: 'ollama',
  availableRuntimes: [],
  pythonBinary: null,
  modelPath: null,
  typingIndicator: null,
  conversation: [],
  conversationCache: new Map(),
  conversations: [],
  activeConversationTitle: 'New chat',
  conversationsLoaded: false,
  conversationLoading: false,
  settings: {
    contextStrategy: 'auto',  // Always auto-manage context
    maxMessages: 100,  // High limit - token count is the real limit
    maxTokens: 60000,  // 60k tokens for 8GB RAM systems (backend adjusts based on RAM)
    temperature: 0.7
  },
  attachedDocument: null,  // Holds {path, name, text, summary} when a document is attached

  // Step Prompter state
  currentView: 'chat',  // 'chat' or 'stepper'
  activeWorkflow: null,  // Current workflow being executed
  workflowSteps: [],     // Steps for current workflow
  currentStepIndex: 0,   // Current step being executed
  stepResults: []        // Results from completed steps
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
  chatDirDisplay: document.getElementById('chatDirDisplay'),
  chooseChatDirBtn: document.getElementById('chooseChatDirBtn'),
  chatHistory: document.getElementById('chatHistory'),
  chatForm: document.getElementById('chatForm'),
  chatInput: document.getElementById('chatInput'),
  sendBtn: document.getElementById('sendBtn'),
  stopBtn: document.getElementById('stopBtn'),
  activeModel: document.getElementById('activeModel'),
  changeChatDirBtn: document.getElementById('changeChatDirBtn'),
  newConversationBtn: document.getElementById('newConversationBtn'),
  conversationList: document.getElementById('conversationList'),
  conversationEmpty: document.getElementById('conversationEmpty'),
  conversationTitle: document.getElementById('conversationTitle'),
  settingsBtn: document.getElementById('settingsBtn'),
  settingsModal: document.getElementById('settingsModal'),
  closeSettingsBtn: document.getElementById('closeSettingsBtn'),
  saveSettingsBtn: document.getElementById('saveSettingsBtn'),
  cancelSettingsBtn: document.getElementById('cancelSettingsBtn'),
  contextStrategy: document.getElementById('contextStrategy'),
  maxMessages: document.getElementById('maxMessages'),
  maxTokens: document.getElementById('maxTokens'),
  temperature: document.getElementById('temperature'),
  temperatureValue: document.getElementById('temperatureValue'),
  currentMessageCount: document.getElementById('currentMessageCount'),
  estimatedTokens: document.getElementById('estimatedTokens'),
  willSendCount: document.getElementById('willSendCount'),
  maxMessagesContainer: document.getElementById('maxMessagesContainer'),
  themeToggle: document.getElementById('themeToggle'),
  themeIcon: document.getElementById('themeIcon'),
  highlightTheme: document.getElementById('highlightTheme'),
  attachDocBtn: document.getElementById('attachDocBtn'),
  documentPreview: document.getElementById('documentPreview'),
  documentName: document.getElementById('documentName'),
  documentStats: document.getElementById('documentStats'),
  removeDocBtn: document.getElementById('removeDocBtn'),

  // Step Prompter elements
  chatViewNav: document.getElementById('chatViewNav'),
  stepperViewNav: document.getElementById('stepperViewNav'),
  stepperView: document.getElementById('stepperView'),
  workflowTitle: document.getElementById('workflowTitle'),
  stepperContent: document.getElementById('stepperContent'),
  newWorkflowBtn: document.getElementById('newWorkflowBtn'),
  exportResultsBtn: document.getElementById('exportResultsBtn'),
  templateCards: document.querySelectorAll('.template-card'),

  // Workflow Builder elements
  workflowBuilderModal: document.getElementById('workflowBuilderModal'),
  closeWorkflowBuilderBtn: document.getElementById('closeWorkflowBuilderBtn'),
  cancelWorkflowBuilderBtn: document.getElementById('cancelWorkflowBuilderBtn'),
  saveWorkflowBtn: document.getElementById('saveWorkflowBtn'),
  workflowName: document.getElementById('workflowName'),
  workflowDescription: document.getElementById('workflowDescription'),
  workflowIcon: document.getElementById('workflowIcon'),
  addStepBtn: document.getElementById('addStepBtn'),
  workflowStepsBuilder: document.getElementById('workflowStepsBuilder')
};

// ========================================
// THEME MANAGEMENT
// ========================================

function loadTheme() {
  try {
    const savedTheme = localStorage.getItem('privateai_theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const theme = savedTheme || (prefersDark ? 'dark' : 'light');
    applyTheme(theme);
  } catch (error) {
    console.warn('Failed to load theme:', error);
    applyTheme('light');
  }
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);

  if (elements.themeIcon) {
    elements.themeIcon.textContent = theme === 'dark' ? '🌙' : '☀️';
  }

  // Update syntax highlighting theme
  if (elements.highlightTheme) {
    const highlightHref = theme === 'dark'
      ? 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/atom-one-dark.min.css'
      : 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github.min.css';
    elements.highlightTheme.href = highlightHref;
  }

  try {
    localStorage.setItem('privateai_theme', theme);
  } catch (error) {
    console.warn('Failed to save theme:', error);
  }
}

function toggleTheme() {
  const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
  const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
  applyTheme(newTheme);
}

const TAURI = window.__TAURI__ || {};
const invoke = TAURI.tauri?.invoke;
const listen = TAURI.event?.listen;
const openDialog = TAURI.dialog?.open;

// ========================================
// STEP PROMPTER / WORKFLOW SYSTEM
// ========================================

const WORKFLOW_TEMPLATES = {
  'social-media': {
    name: 'Social Media Post Generator',
    icon: '📱',
    description: 'Automatically generate engaging social media content from a topic',
    inputPrompt: 'Enter your topic or message (e.g., "Launching a new AI privacy tool"):',
    acceptsFile: false,
    steps: [
      {
        title: 'Analyze Topic & Identify Hooks',
        systemPrompt: 'You are a social media expert. Analyze this topic and identify 3-5 engaging angles or hooks that would make this compelling for social media:\n\n{input}\n\nProvide your analysis as a brief summary of the best angle to pursue.'
      },
      {
        title: 'Generate Caption Options',
        systemPrompt: 'Based on the previous analysis, write ONE polished social media caption (2-3 sentences) that is engaging, professional, and optimized for engagement. Include 3-5 relevant hashtags at the end.'
      },
      {
        title: 'Add Call-to-Action',
        systemPrompt: 'Take the caption from the previous step and enhance it with a compelling call-to-action that encourages audience engagement (like, comment, share, visit link, etc.). Provide the complete final post ready to publish.'
      },
      {
        title: 'Create Final Deliverable',
        systemPrompt: 'Format the final social media post in a clean, ready-to-copy format with:\n1. The complete caption with CTA\n2. Hashtags on separate line\n3. Suggested posting time and platform tips\n\nThis is the final output.'
      }
    ]
  },
  'blog-post': {
    name: 'Blog Post Writer',
    icon: '📝',
    description: 'Automatically write a complete, structured blog post',
    inputPrompt: 'Enter your blog topic (e.g., "How to build AI apps locally"):',
    acceptsFile: false,
    steps: [
      {
        title: 'Generate Title & Outline',
        systemPrompt: 'You are a professional blog writer. For this topic:\n\n{input}\n\nCreate:\n1. ONE compelling, SEO-friendly blog post title\n2. A detailed outline with introduction, 4-5 main sections with subpoints, and conclusion\n\nProvide the title and outline.'
      },
      {
        title: 'Write Introduction',
        systemPrompt: 'Based on the title and outline from the previous step, write an engaging introduction (2-3 paragraphs) that hooks the reader, establishes credibility, and previews what they will learn.'
      },
      {
        title: 'Write Main Body',
        systemPrompt: 'Using the outline and introduction, write the complete main body of the blog post. Include all sections with clear headings, practical examples, and actionable insights. Make it comprehensive and well-structured.'
      },
      {
        title: 'Write Conclusion',
        systemPrompt: 'Write a strong conclusion that summarizes key points, provides actionable takeaways, and ends with a compelling call-to-action.'
      },
      {
        title: 'Format Final Post',
        systemPrompt: 'Combine all parts (introduction, body, conclusion) into one complete, polished blog post with proper formatting, headings, and flow. This is the final deliverable ready to publish.'
      }
    ]
  },
  'email': {
    name: 'Email Campaign Generator',
    icon: '✉️',
    description: 'Automatically generate professional email campaigns',
    inputPrompt: 'Enter your campaign goal (e.g., "Promote new product launch"):',
    acceptsFile: false,
    steps: [
      {
        title: 'Generate Subject Lines',
        systemPrompt: 'You are an email marketing expert. For this campaign goal:\n\n{input}\n\nCreate ONE compelling subject line that would achieve high open rates. Focus on value, curiosity, or urgency.'
      },
      {
        title: 'Write Opening',
        systemPrompt: 'Write an attention-grabbing opening paragraph for the email that hooks the reader immediately and establishes relevance.'
      },
      {
        title: 'Write Email Body',
        systemPrompt: 'Write the main body of the email with persuasive copywriting, clear benefits, and engaging content that maintains reader interest.'
      },
      {
        title: 'Add Call-to-Action',
        systemPrompt: 'Add a compelling call-to-action section with CTA button text, supporting copy, and a sense of urgency or value.'
      },
      {
        title: 'Format Complete Email',
        systemPrompt: 'Combine all parts into one complete, professional email ready to send. Include subject line at top, formatted body, and clear CTA. This is the final deliverable.'
      }
    ]
  },
  'product-desc': {
    name: 'Product Description Writer',
    icon: '🛍️',
    description: 'Automatically create compelling product descriptions',
    inputPrompt: 'Enter product details (name, category, key features):',
    acceptsFile: false,
    steps: [
      {
        title: 'Analyze Product & Benefits',
        systemPrompt: 'You are a product copywriter. Analyze this product:\n\n{input}\n\nIdentify the top 3-5 benefits and selling points. Focus on customer outcomes, not just features.'
      },
      {
        title: 'Write Headline',
        systemPrompt: 'Write a compelling headline and opening paragraph that speaks directly to customer needs and desires. Make it emotionally resonant and benefit-focused.'
      },
      {
        title: 'Write Feature Section',
        systemPrompt: 'Create a features section using benefit-driven language that connects features to customer value. Format with bullet points for scannability.'
      },
      {
        title: 'Add Closing & CTA',
        systemPrompt: 'Add a strong closing paragraph that includes any unique selling points and a compelling call-to-action that drives purchase.'
      },
      {
        title: 'Format Final Description',
        systemPrompt: 'Combine all parts into one complete, polished product description with proper formatting and flow. This is the final deliverable ready for use on product pages.'
      }
    ]
  },
  'document-summary': {
    name: 'Document Summarizer',
    icon: '📄',
    description: 'Automatically summarize documents with key insights',
    inputPrompt: 'Attach your document to summarize:',
    acceptsFile: true,
    steps: [
      {
        title: 'Extract Key Information',
        systemPrompt: 'Read the following document and extract the main topics, key points, and important information:\n\n{input}'
      },
      {
        title: 'Create Executive Summary',
        systemPrompt: 'Based on the key information extracted, write a concise executive summary (2-3 paragraphs) that captures the essence of the document.'
      },
      {
        title: 'Generate Key Insights',
        systemPrompt: 'Identify and list 5-7 key insights or takeaways from the document in bullet point format.'
      },
      {
        title: 'Format Final Summary',
        systemPrompt: 'Combine the executive summary and key insights into one well-formatted document summary ready to share. This is the final deliverable.'
      }
    ]
  }
};

// View navigation
function switchToView(viewName) {
  // Don't allow view switching if model is not active (setup not complete)
  if (!state.activeModel && viewName !== 'setup') {
    console.log('Cannot switch views - setup not complete');
    return;
  }

  state.currentView = viewName;

  if (viewName === 'chat') {
    // Show chat, hide stepper and setup
    elements.setupView?.classList.add('hidden');
    elements.setupView?.classList.remove('visible');
    elements.chatView?.classList.remove('hidden');
    elements.chatView?.classList.add('visible');
    elements.stepperView?.classList.add('hidden');
    elements.stepperView?.classList.remove('visible');

    elements.chatViewNav?.classList.add('active');
    elements.stepperViewNav?.classList.remove('active');
  } else if (viewName === 'stepper') {
    // Show stepper, hide chat and setup
    elements.setupView?.classList.add('hidden');
    elements.setupView?.classList.remove('visible');
    elements.chatView?.classList.add('hidden');
    elements.chatView?.classList.remove('visible');
    elements.stepperView?.classList.remove('hidden');
    elements.stepperView?.classList.add('visible');

    elements.chatViewNav?.classList.remove('active');
    elements.stepperViewNav?.classList.add('active');
  } else if (viewName === 'setup') {
    // Show setup, hide chat and stepper
    elements.setupView?.classList.add('visible');
    elements.setupView?.classList.remove('hidden');
    elements.chatView?.classList.add('hidden');
    elements.chatView?.classList.remove('visible');
    elements.stepperView?.classList.add('hidden');
    elements.stepperView?.classList.remove('visible');

    elements.chatViewNav?.classList.remove('active');
    elements.stepperViewNav?.classList.remove('active');
  }
}

// Start a workflow - show input form
function startWorkflow(templateId) {
  const template = WORKFLOW_TEMPLATES[templateId];
  if (!template) return;

  state.activeWorkflow = templateId;
  state.workflowSteps = JSON.parse(JSON.stringify(template.steps)); // Deep copy
  state.currentStepIndex = 0;
  state.stepResults = [];

  if (elements.workflowTitle) {
    elements.workflowTitle.textContent = template.name;
  }

  if (elements.exportResultsBtn) {
    elements.exportResultsBtn.classList.add('hidden');
  }

  renderWorkflowInputForm(template);
}

// Render workflow input form (entry point)
function renderWorkflowInputForm(template) {
  if (!elements.stepperContent) return;

  elements.stepperContent.innerHTML = '';

  // Workflow description
  const descCard = document.createElement('div');
  descCard.className = 'workflow-description-card';
  descCard.innerHTML = `
    <div class="workflow-icon">${template.icon}</div>
    <h3>${template.name}</h3>
    <p>${template.description}</p>
  `;
  elements.stepperContent.appendChild(descCard);

  // Input form card
  const inputCard = document.createElement('div');
  inputCard.className = 'workflow-input-card';

  const inputLabel = document.createElement('label');
  inputLabel.className = 'workflow-input-label';
  inputLabel.textContent = template.inputPrompt;

  const inputWrapper = document.createElement('div');
  inputWrapper.className = 'workflow-input-wrapper';

  if (template.acceptsFile) {
    // File input
    const fileBtn = document.createElement('button');
    fileBtn.type = 'button';
    fileBtn.className = 'secondary attach-workflow-doc-btn';
    fileBtn.innerHTML = '📎 Attach Document';
    fileBtn.onclick = () => attachWorkflowDocument(inputWrapper);

    const filePreview = document.createElement('div');
    filePreview.className = 'workflow-file-preview hidden';
    filePreview.id = 'workflowFilePreview';

    inputWrapper.appendChild(fileBtn);
    inputWrapper.appendChild(filePreview);
  } else {
    // Text input
    const textarea = document.createElement('textarea');
    textarea.className = 'workflow-input-textarea';
    textarea.id = 'workflowInputText';
    textarea.placeholder = 'Enter your input here...';
    textarea.rows = 4;

    inputWrapper.appendChild(textarea);
  }

  const startBtn = document.createElement('button');
  startBtn.className = 'primary workflow-start-btn';
  startBtn.textContent = `🚀 Run ${template.name}`;
  startBtn.onclick = () => executeAutomatedWorkflow(template);

  inputCard.appendChild(inputLabel);
  inputCard.appendChild(inputWrapper);
  inputCard.appendChild(startBtn);

  elements.stepperContent.appendChild(inputCard);

  // Steps preview
  const stepsPreview = document.createElement('div');
  stepsPreview.className = 'workflow-steps-preview';
  stepsPreview.innerHTML = '<h4>Automation Steps:</h4>';

  const stepsList = document.createElement('ol');
  stepsList.className = 'workflow-steps-list';
  template.steps.forEach((step, index) => {
    const stepItem = document.createElement('li');
    stepItem.textContent = step.title;
    stepsList.appendChild(stepItem);
  });

  stepsPreview.appendChild(stepsList);
  elements.stepperContent.appendChild(stepsPreview);
}

// Attach document for workflow
async function attachWorkflowDocument(container) {
  if (typeof openDialog !== 'function') {
    alert('File dialog not available in this environment.');
    return;
  }

  try {
    const selected = await openDialog({
      multiple: false,
      filters: [
        {
          name: 'Documents',
          extensions: ['pdf', 'docx', 'xlsx', 'xls', 'txt', 'md', 'markdown',
                      'rs', 'py', 'js', 'ts', 'jsx', 'tsx', 'java', 'c', 'cpp',
                      'h', 'hpp', 'go', 'rb', 'php', 'swift', 'kt', 'cs',
                      'html', 'css', 'scss', 'json', 'xml', 'yaml', 'yml',
                      'toml', 'sh', 'bash', 'sql']
        }
      ]
    });

    const filePath = Array.isArray(selected) ? selected[0] : selected;
    if (!filePath) return;

    try {
      const docInfo = await invoke('parse_document', { filePath });

      state.attachedDocument = {
        path: docInfo.path,
        name: docInfo.name,
        text: docInfo.text,
        summary: docInfo.summary
      };

      // Show file preview
      const preview = container.querySelector('#workflowFilePreview');
      if (preview) {
        preview.innerHTML = `
          <div class="file-preview-content">
            <span>📄 ${docInfo.name}</span>
            <p>${docInfo.text.length} characters</p>
          </div>
        `;
        preview.classList.remove('hidden');
      }
    } catch (error) {
      console.error('Failed to parse document:', error);
      alert(`Failed to parse document: ${error?.message ?? error}`);
      state.attachedDocument = null;
    }
  } catch (error) {
    console.warn('File selection cancelled or failed:', error);
  }
}

// Execute automated workflow - runs all steps automatically
async function executeAutomatedWorkflow(template) {
  // Get user input
  let userInput = '';

  if (template.acceptsFile) {
    if (!state.attachedDocument) {
      alert('Please attach a document first.');
      return;
    }
    userInput = state.attachedDocument.text;
  } else {
    const inputTextarea = document.getElementById('workflowInputText');
    if (!inputTextarea || !inputTextarea.value.trim()) {
      alert('Please enter your input first.');
      return;
    }
    userInput = inputTextarea.value.trim();
  }

  // Initialize
  state.currentStepIndex = 0;
  state.stepResults = [];

  // Render progress view
  renderWorkflowProgress(template);

  // Execute all steps sequentially
  for (let i = 0; i < template.steps.length; i++) {
    state.currentStepIndex = i;
    updateWorkflowProgress(i, 'processing');

    try {
      const result = await executeWorkflowNode(i, userInput, template.steps[i]);
      state.stepResults[i] = result;
      updateWorkflowProgress(i, 'completed', result);
    } catch (error) {
      console.error(`Workflow step ${i} failed:`, error);
      updateWorkflowProgress(i, 'error', error.message);
      return; // Stop workflow on error
    }
  }

  // Workflow complete
  showWorkflowComplete();
}

// Execute a single workflow node
async function executeWorkflowNode(nodeIndex, initialInput, step) {
  if (!state.activeModel) {
    throw new Error('No model is active. Please run setup first.');
  }

  // Build the prompt for this node
  let promptForModel;

  if (nodeIndex === 0) {
    // First node: use initial user input
    promptForModel = step.systemPrompt.replace('{input}', initialInput);
  } else {
    // Subsequent nodes: pass the previous node's output
    const previousResult = state.stepResults[nodeIndex - 1];
    promptForModel = step.systemPrompt + '\n\n[Output from previous step]:\n' + previousResult + '\n\nNow complete your task based on the above output.';
  }

  let response = '';

  // Use streaming for all backends but collect the full result
  if (state.backend === 'python' || state.backend === 'embedded') {
    const command = state.backend === 'embedded' ? 'embedded_chat_stream' : 'python_chat_stream';

    // Collect streaming response
    state.streamingBuffer = '';

    await invoke(command, {
      message: promptForModel,
      history: [],  // Workflows don't use conversation history
      sessionId: `workflow-${state.activeWorkflow}-${Date.now()}`,
      chatsDir: state.paths?.chats || null
    });

    // Small delay to ensure all events processed
    await new Promise(resolve => setTimeout(resolve, 500));

    response = state.streamingBuffer;
  } else {
    // Ollama - already non-streaming
    response = await invoke('send_chat_message', {
      message: promptForModel,
      model: state.activeModel,
      history: [],
      sessionId: `workflow-${state.activeWorkflow}-${Date.now()}`,
      chatsDir: state.paths?.chats || null
    });
  }

  // Clear streaming buffer
  state.streamingBuffer = '';

  return response || 'No response generated.';
}

// Render workflow progress view
function renderWorkflowProgress(template) {
  if (!elements.stepperContent) return;

  elements.stepperContent.innerHTML = '';

  const progressHeader = document.createElement('div');
  progressHeader.className = 'workflow-progress-header';
  progressHeader.innerHTML = `
    <h3>🔄 Running Automation...</h3>
    <p>Processing ${template.steps.length} steps automatically</p>
  `;
  elements.stepperContent.appendChild(progressHeader);

  const progressContainer = document.createElement('div');
  progressContainer.className = 'workflow-progress-container';
  progressContainer.id = 'workflowProgressContainer';

  template.steps.forEach((step, index) => {
    const stepCard = document.createElement('div');
    stepCard.className = 'workflow-step-progress';
    stepCard.dataset.stepIndex = index;

    stepCard.innerHTML = `
      <div class="step-progress-header">
        <div class="step-progress-number">${index + 1}</div>
        <div class="step-progress-title">${step.title}</div>
        <div class="step-progress-status" id="stepStatus${index}">⏳ Pending</div>
      </div>
      <div class="step-progress-result hidden" id="stepResult${index}"></div>
    `;

    progressContainer.appendChild(stepCard);
  });

  elements.stepperContent.appendChild(progressContainer);
}

// Update workflow progress for a specific step
function updateWorkflowProgress(stepIndex, status, result = null) {
  const statusEl = document.getElementById(`stepStatus${stepIndex}`);
  const resultEl = document.getElementById(`stepResult${stepIndex}`);
  const stepCard = document.querySelector(`[data-step-index="${stepIndex}"]`);

  if (!statusEl || !stepCard) return;

  if (status === 'processing') {
    statusEl.textContent = '⏳ Processing...';
    statusEl.className = 'step-progress-status processing';
    stepCard.classList.add('active');
  } else if (status === 'completed') {
    statusEl.textContent = '✓ Complete';
    statusEl.className = 'step-progress-status completed';
    stepCard.classList.remove('active');
    stepCard.classList.add('completed');

    if (resultEl && result) {
      resultEl.innerHTML = renderMarkdown(result);
      resultEl.classList.remove('hidden');

      // Highlight code blocks
      if (typeof hljs !== 'undefined') {
        resultEl.querySelectorAll('pre code').forEach((block) => {
          if (!block.classList.contains('hljs')) {
            hljs.highlightElement(block);
          }
        });
      }
    }
  } else if (status === 'error') {
    statusEl.textContent = '❌ Error';
    statusEl.className = 'step-progress-status error';
    stepCard.classList.remove('active');
    stepCard.classList.add('error');

    if (resultEl && result) {
      resultEl.innerHTML = `<p class="error-message">${result}</p>`;
      resultEl.classList.remove('hidden');
    }
  }

  // Auto-scroll to current step
  stepCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// Show workflow completion
function showWorkflowComplete() {
  if (elements.exportResultsBtn) {
    elements.exportResultsBtn.classList.remove('hidden');
  }

  const completionMsg = document.createElement('div');
  completionMsg.className = 'workflow-complete-message';
  completionMsg.innerHTML = `
    <p>✅ <strong>Workflow Complete!</strong></p>
    <p>All automation steps executed successfully. You can export the final result below.</p>
  `;

  elements.stepperContent.appendChild(completionMsg);
}

// Render workflow steps (OLD - keeping for compatibility)
function renderWorkflowSteps() {
  if (!elements.stepperContent) return;

  elements.stepperContent.innerHTML = '';

  state.workflowSteps.forEach((step, index) => {
    const stepCard = document.createElement('div');
    stepCard.className = 'step-card';
    stepCard.dataset.stepIndex = index;

    if (index === state.currentStepIndex) {
      stepCard.classList.add('active');
    } else if (index < state.currentStepIndex) {
      stepCard.classList.add('completed');
    }

    const stepNumber = document.createElement('div');
    stepNumber.className = 'step-number';
    stepNumber.textContent = index + 1;

    const stepContent = document.createElement('div');
    stepContent.className = 'step-content-inner';

    const stepTitle = document.createElement('h3');
    stepTitle.className = 'step-title';
    stepTitle.textContent = step.title;

    const stepPrompt = document.createElement('p');
    stepPrompt.className = 'step-prompt';
    stepPrompt.textContent = step.prompt;

    stepContent.appendChild(stepTitle);
    stepContent.appendChild(stepPrompt);

    // If this step is active, show input field
    if (index === state.currentStepIndex) {
      const inputWrapper = document.createElement('div');
      inputWrapper.className = 'step-input-wrapper';

      // Check if this step requires user input
      const requiresUserInput = step.systemPrompt && step.systemPrompt.includes('{input}');

      if (requiresUserInput) {
        const textarea = document.createElement('textarea');
        textarea.className = 'step-input';
        textarea.placeholder = 'Enter your response...';
        textarea.rows = 3;
        textarea.dataset.stepIndex = index;

        const buttonWrapper = document.createElement('div');
        buttonWrapper.className = 'step-actions';

        const generateBtn = document.createElement('button');
        generateBtn.className = 'primary';
        generateBtn.textContent = 'Generate';
        generateBtn.onclick = () => executeWorkflowStep(index, textarea.value);

        buttonWrapper.appendChild(generateBtn);
        inputWrapper.appendChild(textarea);
        inputWrapper.appendChild(buttonWrapper);
      } else {
        // For steps that don't require input, show just the button
        const buttonWrapper = document.createElement('div');
        buttonWrapper.className = 'step-actions';

        const generateBtn = document.createElement('button');
        generateBtn.className = 'primary';
        generateBtn.textContent = 'Generate';
        generateBtn.onclick = () => executeWorkflowStep(index, '');

        const helpText = document.createElement('p');
        helpText.className = 'step-help-text';
        helpText.textContent = 'This step will use the output from the previous step.';

        inputWrapper.appendChild(helpText);
        buttonWrapper.appendChild(generateBtn);
        inputWrapper.appendChild(buttonWrapper);
      }

      stepContent.appendChild(inputWrapper);
    }

    // If this step has results, show them
    if (state.stepResults[index]) {
      const resultWrapper = document.createElement('div');
      resultWrapper.className = 'step-result';

      const resultLabel = document.createElement('h4');
      resultLabel.textContent = 'Result:';

      const resultContent = document.createElement('div');
      resultContent.className = 'step-result-content markdown-content';
      resultContent.innerHTML = renderMarkdown(state.stepResults[index]);

      // Highlight code blocks
      requestAnimationFrame(() => {
        if (typeof hljs !== 'undefined') {
          resultContent.querySelectorAll('pre code').forEach((block) => {
            if (!block.classList.contains('hljs')) {
              hljs.highlightElement(block);
            }
          });
        }
      });

      resultWrapper.appendChild(resultLabel);
      resultWrapper.appendChild(resultContent);
      stepContent.appendChild(resultWrapper);
    }

    stepCard.appendChild(stepNumber);
    stepCard.appendChild(stepContent);
    elements.stepperContent.appendChild(stepCard);
  });
}

// Execute a workflow step by calling the model (non-streaming, node-by-node)
async function executeWorkflowStep(stepIndex, userInput) {
  if (!state.activeModel) {
    alert('No model is active. Please run setup first.');
    return;
  }

  const step = state.workflowSteps[stepIndex];
  if (!step) return;

  // Check if this step requires user input (has {input} placeholder)
  const requiresUserInput = step.systemPrompt.includes('{input}');

  // For steps that require user input, validate it's provided
  if (requiresUserInput && !userInput.trim()) {
    alert('Please enter a response first.');
    return;
  }

  // Build the prompt for the model
  let promptForModel = step.systemPrompt;

  // Replace {input} placeholder if present and we have user input
  if (requiresUserInput && userInput) {
    promptForModel = promptForModel.replace('{input}', userInput);
  }

  // For workflows, we pass the FULL result from the previous step as context
  // This creates a proper node-by-node chain where each node builds on the previous
  if (stepIndex > 0 && state.stepResults[stepIndex - 1]) {
    const previousResult = state.stepResults[stepIndex - 1];
    promptForModel = `[Context from previous step]:\n${previousResult}\n\n[Current task]:\n${promptForModel}`;
  }

  // Disable the button and show loading state
  const stepCard = elements.stepperContent.querySelector(`[data-step-index="${stepIndex}"]`);
  const generateBtn = stepCard?.querySelector('button.primary');
  const textarea = stepCard?.querySelector('textarea.step-input');

  if (generateBtn) {
    generateBtn.disabled = true;
    generateBtn.textContent = 'Generating...';
  }
  if (textarea) {
    textarea.disabled = true;
  }

  // Show a loading indicator in the step result area
  let resultWrapper = stepCard?.querySelector('.step-result');
  if (!resultWrapper) {
    resultWrapper = document.createElement('div');
    resultWrapper.className = 'step-result';
    const stepContent = stepCard?.querySelector('.step-content-inner');
    if (stepContent) {
      stepContent.appendChild(resultWrapper);
    }
  }
  resultWrapper.innerHTML = '<p class="loading-indicator">⏳ Processing node...</p>';

  try {
    let response = '';

    // Use streaming for all backends but collect the full result
    if (state.backend === 'python' || state.backend === 'embedded') {
      const command = state.backend === 'embedded' ? 'embedded_chat_stream' : 'python_chat_stream';

      // Collect streaming response
      state.streamingBuffer = '';

      // Set up a temporary listener to collect the stream
      const streamingComplete = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Workflow step timed out')), 120000); // 2 min timeout

        if (typeof listen === 'function') {
          const unlisten = listen('chat-stream', (event) => {
            if (event?.payload?.content) {
              state.streamingBuffer = event.payload.content;
              // Update the loading indicator with partial result
              resultWrapper.innerHTML = `<p class="loading-indicator">⏳ Processing...</p><div class="step-result-content markdown-content">${renderMarkdown(state.streamingBuffer)}</div>`;
            }
          });

          // Also listen for completion
          const unlistenDone = state.backend === 'embedded' ? listen('embedded-stream-done', () => {
            clearTimeout(timeout);
            resolve();
          }) : null;
        }
      });

      await invoke(command, {
        message: promptForModel,
        history: [],  // Workflows don't use conversation history - they use node chaining
        sessionId: `workflow-${state.activeWorkflow}-${Date.now()}`,
        chatsDir: state.paths?.chats || null
      });

      // For non-embedded, the invoke completes when streaming is done
      if (state.backend !== 'embedded') {
        await new Promise(resolve => setTimeout(resolve, 500)); // Small delay to ensure all events processed
      }

      response = state.streamingBuffer;
    } else {
      // Ollama - already non-streaming
      response = await invoke('send_chat_message', {
        message: promptForModel,
        model: state.activeModel,
        history: [],  // Workflows don't use conversation history
        sessionId: `workflow-${state.activeWorkflow}-${Date.now()}`,
        chatsDir: state.paths?.chats || null
      });
    }

    // Store the result - this becomes input for the next node
    state.stepResults[stepIndex] = response || 'No response generated.';

    // Clear streaming buffer
    state.streamingBuffer = '';

    // Move to next step
    if (stepIndex < state.workflowSteps.length - 1) {
      state.currentStepIndex = stepIndex + 1;
      renderWorkflowSteps();
    } else {
      // Workflow complete - show final result
      state.currentStepIndex = stepIndex + 1;
      renderWorkflowSteps();

      if (elements.exportResultsBtn) {
        elements.exportResultsBtn.classList.remove('hidden');
      }

      // Show completion message
      const completionMsg = document.createElement('div');
      completionMsg.className = 'workflow-complete-message';
      completionMsg.innerHTML = '<p>✅ <strong>Workflow Complete!</strong> All nodes processed successfully. You can export the results below.</p>';
      elements.stepperContent.appendChild(completionMsg);
    }
  } catch (error) {
    console.error('Failed to execute workflow step:', error);

    // Show error in the result area
    resultWrapper.innerHTML = `<p class="error-message">❌ Error: ${error?.message ?? error}</p>`;

    if (generateBtn) {
      generateBtn.disabled = false;
      generateBtn.textContent = 'Retry';
    }
    if (textarea) {
      textarea.disabled = false;
    }
  }
}

// Export workflow results
function exportWorkflowResults() {
  if (!state.activeWorkflow || state.stepResults.length === 0) {
    alert('No results to export.');
    return;
  }

  const template = WORKFLOW_TEMPLATES[state.activeWorkflow];
  let exportText = `# ${template.name}\n\n`;
  exportText += `Generated: ${new Date().toLocaleString()}\n\n`;
  exportText += `---\n\n`;

  state.workflowSteps.forEach((step, index) => {
    if (state.stepResults[index]) {
      exportText += `## ${step.title}\n\n`;
      exportText += `${state.stepResults[index]}\n\n`;
      exportText += `---\n\n`;
    }
  });

  // Copy to clipboard
  navigator.clipboard.writeText(exportText).then(() => {
    alert('Results copied to clipboard!');
  }).catch((error) => {
    console.error('Failed to copy:', error);
    alert('Failed to copy to clipboard. See console for details.');
  });
}

// Custom workflow builder state
let customWorkflowSteps = [];

// Open workflow builder modal
function openWorkflowBuilder() {
  customWorkflowSteps = [];

  if (elements.workflowName) elements.workflowName.value = '';
  if (elements.workflowDescription) elements.workflowDescription.value = '';
  if (elements.workflowIcon) elements.workflowIcon.value = '📝';
  if (elements.workflowStepsBuilder) elements.workflowStepsBuilder.innerHTML = '';

  // Add first step by default
  addWorkflowStep();

  if (elements.workflowBuilderModal) {
    elements.workflowBuilderModal.classList.remove('hidden');
  }
}

// Close workflow builder modal
function closeWorkflowBuilder() {
  if (elements.workflowBuilderModal) {
    elements.workflowBuilderModal.classList.add('hidden');
  }
  customWorkflowSteps = [];
}

// Add a new workflow step
function addWorkflowStep() {
  const stepIndex = customWorkflowSteps.length;
  const step = {
    title: '',
    systemPrompt: ''
  };

  customWorkflowSteps.push(step);

  const stepCard = document.createElement('div');
  stepCard.className = 'workflow-step-builder-card';
  stepCard.dataset.stepIndex = stepIndex;

  stepCard.innerHTML = `
    <div class="workflow-step-header">
      <h4>Step ${stepIndex + 1}</h4>
      ${stepIndex > 0 ? '<button type="button" class="remove-step-btn" onclick="removeWorkflowStep(' + stepIndex + ')">Remove</button>' : ''}
    </div>
    <div class="setting-item">
      <label>Step Title</label>
      <input type="text" class="step-title-input" data-step="${stepIndex}" placeholder="E.g., Generate Outline" />
    </div>
    <div class="setting-item">
      <label>System Prompt</label>
      <textarea class="step-prompt-input" data-step="${stepIndex}" placeholder="Instructions for the AI. Use {input} to reference user input."></textarea>
      <p class="setting-hint">Use {input} as a placeholder for user input. If you don't include {input}, the step will automatically use the previous step's output.</p>
    </div>
  `;

  if (elements.workflowStepsBuilder) {
    elements.workflowStepsBuilder.appendChild(stepCard);
  }

  // Add event listeners for this step
  const titleInput = stepCard.querySelector('.step-title-input');
  const promptInput = stepCard.querySelector('.step-prompt-input');

  if (titleInput) {
    titleInput.addEventListener('input', (e) => {
      customWorkflowSteps[stepIndex].title = e.target.value;
    });
  }

  if (promptInput) {
    promptInput.addEventListener('input', (e) => {
      customWorkflowSteps[stepIndex].systemPrompt = e.target.value;
    });
  }
}

// Remove a workflow step
function removeWorkflowStep(index) {
  customWorkflowSteps.splice(index, 1);
  renderWorkflowStepsBuilder();
}

// Re-render workflow steps builder
function renderWorkflowStepsBuilder() {
  if (!elements.workflowStepsBuilder) return;

  elements.workflowStepsBuilder.innerHTML = '';

  const tempSteps = [...customWorkflowSteps];
  customWorkflowSteps = [];

  tempSteps.forEach((step) => {
    const stepIndex = customWorkflowSteps.length;
    customWorkflowSteps.push(step);

    const stepCard = document.createElement('div');
    stepCard.className = 'workflow-step-builder-card';
    stepCard.dataset.stepIndex = stepIndex;

    stepCard.innerHTML = `
      <div class="workflow-step-header">
        <h4>Step ${stepIndex + 1}</h4>
        ${stepIndex > 0 ? '<button type="button" class="remove-step-btn" onclick="removeWorkflowStep(' + stepIndex + ')">Remove</button>' : ''}
      </div>
      <div class="setting-item">
        <label>Step Title</label>
        <input type="text" class="step-title-input" data-step="${stepIndex}" value="${step.title || ''}" placeholder="E.g., Generate Outline" />
      </div>
      <div class="setting-item">
        <label>System Prompt</label>
        <textarea class="step-prompt-input" data-step="${stepIndex}" placeholder="Instructions for the AI. Use {input} to reference user input.">${step.systemPrompt || ''}</textarea>
        <p class="setting-hint">Use {input} as a placeholder for user input. If you don't include {input}, the step will automatically use the previous step's output.</p>
      </div>
    `;

    elements.workflowStepsBuilder.appendChild(stepCard);

    // Re-add event listeners
    const titleInput = stepCard.querySelector('.step-title-input');
    const promptInput = stepCard.querySelector('.step-prompt-input');

    if (titleInput) {
      titleInput.addEventListener('input', (e) => {
        customWorkflowSteps[stepIndex].title = e.target.value;
      });
    }

    if (promptInput) {
      promptInput.addEventListener('input', (e) => {
        customWorkflowSteps[stepIndex].systemPrompt = e.target.value;
      });
    }
  });
}

// Save custom workflow
function saveCustomWorkflow() {
  const name = elements.workflowName?.value.trim();
  const description = elements.workflowDescription?.value.trim();
  const icon = elements.workflowIcon?.value.trim() || '📝';

  if (!name) {
    alert('Please enter a workflow name');
    return;
  }

  if (customWorkflowSteps.length === 0) {
    alert('Please add at least one step');
    return;
  }

  // Validate all steps have titles and prompts
  for (let i = 0; i < customWorkflowSteps.length; i++) {
    if (!customWorkflowSteps[i].title || !customWorkflowSteps[i].systemPrompt) {
      alert(`Step ${i + 1} is missing a title or prompt`);
      return;
    }
  }

  // Create the custom workflow template
  const templateId = 'custom-' + Date.now();
  const template = {
    name,
    icon,
    description: description || 'Custom workflow',
    inputPrompt: 'Enter your initial input:',
    acceptsFile: false,
    steps: customWorkflowSteps.map(step => ({
      title: step.title,
      systemPrompt: step.systemPrompt
    }))
  };

  // Add to templates
  WORKFLOW_TEMPLATES[templateId] = template;

  // Save to localStorage
  saveCustomWorkflows();

  // Add to sidebar
  addCustomWorkflowToSidebar(templateId, template);

  // Close modal and start the workflow
  closeWorkflowBuilder();
  startWorkflow(templateId);
}

// Save custom workflows to localStorage
function saveCustomWorkflows() {
  const customWorkflows = {};
  Object.keys(WORKFLOW_TEMPLATES).forEach((key) => {
    if (key.startsWith('custom-')) {
      customWorkflows[key] = WORKFLOW_TEMPLATES[key];
    }
  });
  localStorage.setItem('customWorkflows', JSON.stringify(customWorkflows));
}

// Load custom workflows from localStorage
function loadCustomWorkflows() {
  try {
    const saved = localStorage.getItem('customWorkflows');
    if (saved) {
      const customWorkflows = JSON.parse(saved);
      Object.assign(WORKFLOW_TEMPLATES, customWorkflows);

      // Add to sidebar
      Object.keys(customWorkflows).forEach((templateId) => {
        addCustomWorkflowToSidebar(templateId, customWorkflows[templateId]);
      });
    }
  } catch (error) {
    console.error('Failed to load custom workflows:', error);
  }
}

// Add custom workflow card to sidebar
function addCustomWorkflowToSidebar(templateId, template) {
  const templateList = document.querySelector('.template-list');
  if (!templateList) return;

  // Check if already exists
  const existing = templateList.querySelector(`[data-template="${templateId}"]`);
  if (existing) return;

  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'template-card';
  card.dataset.template = templateId;
  card.innerHTML = `
    <span class="template-icon">${template.icon}</span>
    <span class="template-name">${template.name}</span>
  `;

  card.addEventListener('click', () => {
    startWorkflow(templateId);
  });

  templateList.appendChild(card);
}

// Reset workflow
function resetWorkflow() {
  state.activeWorkflow = null;
  state.workflowSteps = [];
  state.currentStepIndex = 0;
  state.stepResults = [];

  if (elements.workflowTitle) {
    elements.workflowTitle.textContent = 'Select a workflow to begin';
  }

  if (elements.exportResultsBtn) {
    elements.exportResultsBtn.classList.add('hidden');
  }

  if (elements.stepperContent) {
    elements.stepperContent.innerHTML = `
      <div class="stepper-empty">
        <p>👈 Choose a template from the sidebar to start a guided workflow</p>
      </div>
    `;
  }
}

const stepsOrder = ['scan', 'storage', 'install', 'model', 'complete'];
const STEP_LABELS = {
  ollama: {
    install: 'Install & start Ollama',
    model: 'Download model'
  },
  python: {
    install: 'Start Python engine',
    model: 'Download model'
  },
  embedded: {
    install: 'Load embedded model',
    model: 'Download model'
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
    // Setup complete - switch to chat view
    switchToView('chat');
    // Remove inline style - let CSS handle visibility
    if (elements.chatForm && elements.chatForm.style.display) {
      elements.chatForm.style.display = '';
    }
    document.body.classList.add('chat-mode');

    // Show navigation buttons
    const viewNav = document.querySelector('.view-nav');
    if (viewNav) {
      viewNav.style.display = 'flex';
    }
  } else {
    // Show setup view
    switchToView('setup');
    // Remove inline style - let CSS handle visibility
    if (elements.chatForm && elements.chatForm.style.display) {
      elements.chatForm.style.display = '';
    }
    document.body.classList.remove('chat-mode');

    // Hide navigation buttons during setup
    const viewNav = document.querySelector('.view-nav');
    if (viewNav) {
      viewNav.style.display = 'none';
    }
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

  if (backend === 'python' || backend === 'embedded') {
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

function attachTypingIndicator(bubble) {
  bubble.textContent = '';
  bubble.classList.add('streaming');
  const indicator = document.createElement('span');
  indicator.className = 'typing-indicator';
  indicator.innerHTML = '<span></span><span></span><span></span>';
  bubble.appendChild(indicator);
  state.typingIndicator = indicator;
}

function clearTypingIndicator() {
  if (state.typingIndicator) {
    state.typingIndicator.remove();
    state.typingIndicator = null;
  }
  if (state.streamingBubble) {
    state.streamingBubble.classList.remove('streaming');
  }
}

function showStopButton() {
  if (elements.stopBtn) {
    elements.stopBtn.classList.remove('hidden');
  }
  if (elements.sendBtn) {
    elements.sendBtn.classList.add('hidden');
  }
}

function hideStopButton() {
  if (elements.stopBtn) {
    elements.stopBtn.classList.add('hidden');
  }
  if (elements.sendBtn) {
    elements.sendBtn.classList.remove('hidden');
  }
}

async function stopStreaming() {
  state.shouldStopStreaming = true;
  clearTypingIndicator();

  // Cancel backend generation if embedded runtime is active
  if (state.backend === 'embedded' && typeof invoke === 'function') {
    try {
      await invoke('cancel_embedded_generation');
      console.log('[DEBUG] Sent cancellation request to embedded runtime');
    } catch (error) {
      console.warn('Failed to cancel embedded generation:', error);
    }
  }

  // Update the bubble to show it was stopped (preserve markdown rendering)
  if (state.streamingBubble && state.streamingBuffer) {
    const stoppedContent = state.streamingBuffer + '\n\n*[Stopped by user]*';
    updateStreamingMarkdown(state.streamingBubble, stoppedContent);
  }

  hideStopButton();
  elements.sendBtn.disabled = false;
  elements.chatInput.focus();

  // Save the partial response
  if (state.streamingBuffer) {
    const assistantRecord = {
      role: 'assistant',
      content: state.streamingBuffer,  // Save without the "stopped" message
      timestamp: new Date().toISOString()
    };
    state.conversation.push(assistantRecord);
    syncConversationCache();
    updateActiveConversationSummary();
    updateContextStats();
    appendChatRecords([assistantRecord]).catch(console.error);
    refreshConversationList({ preserveSelection: true }).catch(console.error);
  }

  state.streamingBubble = null;
  state.streamingBuffer = '';
  state.isStreaming = false;
}

function generateSessionId() {
  return `sess-${Date.now().toString(36)}`;
}

function updateChatDirDisplay() {
  if (elements.chatDirDisplay) {
    elements.chatDirDisplay.textContent = state.paths?.chats || 'Default: ~/PrivateAI/Chats';
  }
  if (elements.changeChatDirBtn) {
    const location = state.paths?.chats || 'Default: ~/PrivateAI/Chats';
    elements.changeChatDirBtn.title = `Chats stored in: ${location}`;
  }
}

async function appendChatRecords(records) {
  if (!records.length || typeof invoke !== 'function' || !state.sessionId) return;
  try {
    await invoke('append_chat_records', {
      sessionId: state.sessionId,
      records,
      chatsDir: state.paths?.chats || null
    });
  } catch (error) {
    console.warn('Failed to persist chat records', error);
  }
}

async function chooseChatDirectory({ focusChat = false } = {}) {
  if (typeof openDialog !== 'function') return;
  try {
    const selected = await openDialog({
      directory: true,
      multiple: false,
      defaultPath: state.paths?.chats || undefined
    });
    const folder = Array.isArray(selected) ? selected[0] : selected;
    if (!folder) return;

    state.paths = state.paths || {};
    state.paths.chats = folder;
    updateChatDirDisplay();

    if (typeof invoke === 'function') {
      await invoke('ensure_directory', { path: folder });
    }

    state.conversationCache = new Map();
    await refreshConversationList({ preserveSelection: false });
    if (!state.conversations.length) {
      startNewConversation({ focusInput: focusChat, persistSummary: false });
    } else if (focusChat && elements.chatInput) {
      elements.chatInput.focus();
    }
  } catch (error) {
    console.warn('Chat directory selection cancelled or failed', error);
  }
}

function syncConversationCache() {
  if (!state.sessionId) return;
  state.conversationCache.set(state.sessionId, [...state.conversation]);
}

function getContextMessages() {
  const allMessages = state.conversation.map((record) => ({
    role: record.role,
    content: record.content
  }));

  return applyContextStrategy(allMessages);
}

// Estimate token count (rough: 1 token ≈ 4 chars)
function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

// Apply automatic context management - ALWAYS trims based on token count
// This ensures the conversation can continue indefinitely like Claude does
function applyContextStrategy(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return [];
  }

  const { maxTokens } = state.settings;

  // ALWAYS use token-based trimming - keep most recent messages that fit
  // Target 75% of max tokens to leave room for new user message + response
  const targetTokens = maxTokens * 0.75;
  const result = [];
  let tokenCount = 0;

  // Work backwards from most recent messages
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    const msgTokens = estimateTokens(msg.content);

    // If adding this message would exceed target, stop
    if (tokenCount + msgTokens > targetTokens) {
      break;
    }

    result.unshift(msg);
    tokenCount += msgTokens;
  }

  // Safety: always keep at least the last 2 messages (user + assistant pair)
  if (result.length < 2 && messages.length >= 2) {
    const lastTwo = messages.slice(-2);
    const lastTwoTokens = lastTwo.reduce((sum, msg) => sum + estimateTokens(msg.content), 0);
    console.log(`[AUTO-CLEANUP] Keeping minimum 2 messages (${lastTwoTokens} tokens)`);
    return lastTwo;
  }

  // Log cleanup if messages were dropped
  if (result.length < messages.length) {
    const droppedCount = messages.length - result.length;
    console.log(`[AUTO-CLEANUP] Dropped ${droppedCount} old messages. Keeping ${result.length} recent messages (${tokenCount}/${maxTokens} tokens)`);
  }

  return result;
}

// Load settings from localStorage
function loadSettings() {
  try {
    const saved = localStorage.getItem('privateai_settings');
    if (saved) {
      state.settings = { ...state.settings, ...JSON.parse(saved) };
    }
  } catch (error) {
    console.warn('Failed to load settings:', error);
  }
}

// Save settings to localStorage
function saveSettings() {
  try {
    localStorage.setItem('privateai_settings', JSON.stringify(state.settings));
    return true;
  } catch (error) {
    console.error('Failed to save settings:', error);
    return false;
  }
}

// Update context stats display
function updateContextStats() {
  if (!elements.currentMessageCount) return;

  const totalMessages = state.conversation.length;
  const totalTokens = state.conversation.reduce((sum, msg) =>
    sum + estimateTokens(msg.content), 0);

  const filteredMessages = applyContextStrategy(state.conversation.map(m => ({
    role: m.role,
    content: m.content
  })));
  const willSendCount = filteredMessages.length;

  // Calculate tokens that will be sent to model
  const willSendTokens = filteredMessages.reduce((sum, msg) =>
    sum + estimateTokens(msg.content), 0);

  elements.currentMessageCount.textContent = totalMessages;
  elements.estimatedTokens.textContent = `${willSendTokens}/${state.settings.maxTokens}`;
  elements.willSendCount.textContent = willSendCount;

  // Visual warning if approaching context limit
  const usagePercent = (willSendTokens / state.settings.maxTokens) * 100;
  if (elements.estimatedTokens) {
    elements.estimatedTokens.style.color = usagePercent >= 90 ? '#ff6b6b' :
                                            usagePercent >= 70 ? '#ffa500' : '';
  }
}

// Open settings modal
function openSettings() {
  if (!elements.settingsModal) return;

  // Populate current values
  if (elements.contextStrategy) {
    elements.contextStrategy.value = state.settings.contextStrategy;
  }
  if (elements.maxMessages) {
    elements.maxMessages.value = state.settings.maxMessages;
  }
  if (elements.maxTokens) {
    elements.maxTokens.value = state.settings.maxTokens;
  }
  if (elements.temperature) {
    elements.temperature.value = state.settings.temperature;
    if (elements.temperatureValue) {
      elements.temperatureValue.textContent = state.settings.temperature;
    }
  }

  // Update visibility of maxMessages based on strategy
  updateMaxMessagesVisibility();

  // Update stats
  updateContextStats();

  // Show modal
  elements.settingsModal.classList.remove('hidden');
}

// Close settings modal
function closeSettings() {
  if (elements.settingsModal) {
    elements.settingsModal.classList.add('hidden');
  }
}

// Update max messages container visibility
function updateMaxMessagesVisibility() {
  if (!elements.maxMessagesContainer || !elements.contextStrategy) return;

  const strategy = elements.contextStrategy.value;
  if (strategy === 'all') {
    elements.maxMessagesContainer.style.display = 'none';
  } else {
    elements.maxMessagesContainer.style.display = 'block';
  }
}

// Save settings from modal
function handleSaveSettings() {
  // Update state
  if (elements.contextStrategy) {
    state.settings.contextStrategy = elements.contextStrategy.value;
  }
  if (elements.maxMessages) {
    state.settings.maxMessages = parseInt(elements.maxMessages.value, 10);
  }
  if (elements.maxTokens) {
    state.settings.maxTokens = parseInt(elements.maxTokens.value, 10);
  }
  if (elements.temperature) {
    state.settings.temperature = parseFloat(elements.temperature.value);
  }

  // Save to localStorage
  saveSettings();

  // Close modal
  closeSettings();

  // Show confirmation
  log('success', 'Settings saved successfully');
}

function buildConversationSummary(sessionId, messages = []) {
  const safeMessages = Array.isArray(messages) ? messages : [];
  const firstUser = safeMessages.find(
    (record) => record.role === 'user' && typeof record.content === 'string' && record.content.trim()
  );
  const fallbackTitle = firstUser?.content
    ? firstUser.content.trim().split('\n')[0]
    : 'New chat';
  const title =
    fallbackTitle.length > 80 ? `${fallbackTitle.slice(0, 80)}…` : fallbackTitle;
  const lastMessage =
    [...safeMessages]
      .reverse()
      .find((record) => typeof record.content === 'string' && record.content.trim()) || null;
  const preview =
    lastMessage?.content?.trim()
      ? (lastMessage.content.trim().split('\n')[0] ?? '').slice(0, 120)
      : null;
  const createdAt = safeMessages[0]?.timestamp ?? null;
  const updatedAt =
    safeMessages[safeMessages.length - 1]?.timestamp ?? new Date().toISOString();
  return {
    sessionId,
    title,
    createdAt,
    updatedAt,
    messageCount: safeMessages.length,
    preview
  };
}

function setConversationTitle(title) {
  state.activeConversationTitle = title || 'New chat';
  if (elements.conversationTitle) {
    elements.conversationTitle.textContent = state.activeConversationTitle;
  }
}

function renderConversationHistory(messages = []) {
  clearTypingIndicator();
  elements.chatHistory.innerHTML = '';
  messages.forEach((record) => {
    if (!record || typeof record.content !== 'string') return;
    const role = record.role === 'user' ? 'user' : 'assistant';
    appendMessageBubble(role, record.content);
  });
  elements.chatHistory.scrollTop = elements.chatHistory.scrollHeight;
  updateContextStats();
}

async function deleteConversation(sessionId) {
  if (!sessionId) return;

  const confirmed = confirm('Delete this conversation? This cannot be undone.');
  if (!confirmed) return;

  try {
    if (typeof invoke === 'function') {
      await invoke('delete_chat_session', {
        sessionId,
        chatsDir: state.paths?.chats || null
      });
    }

    // Remove from cache
    state.conversationCache.delete(sessionId);

    // If deleting active conversation, start a new one
    if (sessionId === state.sessionId) {
      startNewConversation({ focusInput: true, persistSummary: true });
    }

    // Refresh the conversation list
    await refreshConversationList({ preserveSelection: false });
  } catch (error) {
    console.error('Failed to delete conversation:', error);
    alert(`Failed to delete conversation: ${error?.message ?? error}`);
  }
}

function renderConversationList() {
  if (!elements.conversationList) return;
  elements.conversationList.innerHTML = '';

  if (!state.conversations.length) {
    elements.conversationEmpty?.classList.add('visible');
    return;
  }

  elements.conversationEmpty?.classList.remove('visible');
  state.conversations.forEach((conv) => {
    const item = document.createElement('div');
    item.className = 'conversation-item';
    if (conv.sessionId === state.sessionId) {
      item.classList.add('active');
    }

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'conversation-button';

    const title = document.createElement('h3');
    title.textContent = conv.title || 'New chat';
    const preview = document.createElement('p');
    preview.textContent =
      conv.preview || `${conv.messageCount} message${conv.messageCount === 1 ? '' : 's'}`;

    button.appendChild(title);
    button.appendChild(preview);
    button.addEventListener('click', () => {
      void selectConversation(conv.sessionId);
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'delete-conversation-btn';
    deleteBtn.textContent = '×';
    deleteBtn.title = 'Delete conversation';
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      void deleteConversation(conv.sessionId);
    });

    item.appendChild(button);
    item.appendChild(deleteBtn);
    elements.conversationList.appendChild(item);
  });
}

function sortConversationsInPlace(list) {
  list.sort((a, b) => {
    if (a.updatedAt && b.updatedAt) {
      if (a.updatedAt === b.updatedAt) {
        return b.sessionId.localeCompare(a.sessionId);
      }
      return b.updatedAt.localeCompare(a.updatedAt);
    }
    if (a.updatedAt) return -1;
    if (b.updatedAt) return 1;
    return b.sessionId.localeCompare(a.sessionId);
  });
}

function updateActiveConversationSummary() {
  if (!state.sessionId) return;
  const summary = buildConversationSummary(state.sessionId, state.conversation);
  const index = state.conversations.findIndex((conv) => conv.sessionId === state.sessionId);
  if (index === -1) {
    state.conversations.unshift(summary);
  } else {
    state.conversations[index] = { ...state.conversations[index], ...summary };
  }
  sortConversationsInPlace(state.conversations);
  setConversationTitle(summary.title);
  renderConversationList();
}

async function refreshConversationList({ preserveSelection = false } = {}) {
  if (state.conversationLoading) return;
  state.conversationLoading = true;

  try {
    const summaries = [];
    if (typeof invoke === 'function') {
      try {
        const result = await invoke('list_chat_sessions', {
          chatsDir: state.paths?.chats || null
        });
        if (Array.isArray(result)) {
          result.forEach((item) => {
            summaries.push({
              sessionId: item.session_id,
              title: item.title,
              createdAt: item.created_at ?? null,
              updatedAt: item.updated_at ?? null,
              messageCount: item.message_count ?? 0,
              preview: item.preview ?? null
            });
          });
        }
      } catch (error) {
        console.warn('Unable to list chat sessions', error);
      }
    }

    if (
      state.sessionId &&
      state.conversation.length &&
      !summaries.some((conv) => conv.sessionId === state.sessionId)
    ) {
      summaries.unshift(buildConversationSummary(state.sessionId, state.conversation));
    }

    sortConversationsInPlace(summaries);

    state.conversations = summaries;
    renderConversationList();
    state.conversationsLoaded = true;

    if (!preserveSelection) {
      if (state.sessionId) {
        const current = summaries.find((conv) => conv.sessionId === state.sessionId);
        if (current) {
          setConversationTitle(current.title);
        } else if (summaries.length) {
          await selectConversation(summaries[0].sessionId, { forceReload: false });
        } else {
          setConversationTitle('New chat');
          renderConversationHistory([]);
        }
      } else if (summaries.length) {
        await selectConversation(summaries[0].sessionId, { forceReload: false });
      } else {
        setConversationTitle('New chat');
        renderConversationHistory([]);
      }
    }
  } finally {
    state.conversationLoading = false;
  }
}

async function selectConversation(sessionId, { forceReload = false } = {}) {
  if (!sessionId) return;

  if (!forceReload && sessionId === state.sessionId && state.conversationsLoaded) {
    renderConversationList();
    return;
  }

  clearTypingIndicator();
  state.sessionId = sessionId;

  let messages = state.conversationCache.get(sessionId);
  if (!Array.isArray(messages) || forceReload) {
    if (typeof invoke === 'function') {
      try {
        const result = await invoke('load_chat_history', {
          sessionId,
          chatsDir: state.paths?.chats || null,
          limit: null
        });
        if (Array.isArray(result)) {
          messages = result.map((record) => ({
            role: record.role || 'assistant',
            content: record.content || '',
            timestamp: record.timestamp ?? null
          }));
        } else {
          messages = [];
        }
      } catch (error) {
        console.warn('Unable to load chat history', error);
        messages = [];
      }
    } else {
      messages = [];
    }
  }

  state.conversation = Array.isArray(messages)
    ? messages.map((record) => ({
        role: record.role === 'user' ? 'user' : 'assistant',
        content: record.content || '',
        timestamp: record.timestamp ?? null
      }))
    : [];

  syncConversationCache();
  updateActiveConversationSummary();
  renderConversationHistory(state.conversation);
  updateContextStats();
  elements.chatInput?.focus();
}

function startNewConversation({ focusInput = true, persistSummary = true } = {}) {
  clearTypingIndicator();
  const newId = generateSessionId();
  state.sessionId = newId;
  state.conversation = [];
  syncConversationCache();
  if (persistSummary) {
    updateActiveConversationSummary();
  } else {
    setConversationTitle('New chat');
    renderConversationList();
  }
  renderConversationHistory([]);
  if (elements.chatInput) {
    elements.chatInput.value = '';
    if (focusInput) {
      elements.chatInput.focus();
    }
  }
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
  updateChatDirDisplay();
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
      : state.backend === 'embedded'
      ? 'Initializing embedded runtime setup...'
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
    updateChatDirDisplay();
    log('success', `Storage ready at ${paths.base_dir}`);

    if (state.backend === 'python') {
      await ensurePythonBinary();
      if (!state.pythonBinary) {
        throw new Error('Python runtime not found. Install llama-cpp-python or set PRIVATE_AI_PYTHON.');
      }

      // Step 3: Download model if not present
      setStep('model');
      const modelsDir = String(state.paths.models).replace(/\\/g, '/');
      const expectedModelPath = `${modelsDir}/gemma-3-1b-it-Q4_0.gguf`;

      elements.stepStatus.textContent = 'Checking for AI model...';
      log('info', 'Checking for Gemma 3 1B model...');

      try {
        const downloadedModelPath = await invoke('download_model', {
          targetDir: modelsDir
        });
        state.modelPath = downloadedModelPath;
        log('success', 'Model ready!');
      } catch (error) {
        console.error('Model download error:', error);
        throw new Error(`Failed to download model: ${error?.message ?? error}`);
      }

      setStep('install');
      elements.stepStatus.textContent = 'Starting embedded Python runtime...';
      log('info', 'Launching llama-cpp sidecar.');

      try {
        await invoke('stop_python_engine');
      } catch (preflightErr) {
        console.debug('Python engine stop (preflight) ignored:', preflightErr);
      }

      const defaultModelPath = state.modelPath || expectedModelPath;

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
      void refreshConversationList({ preserveSelection: false });
      log('success', 'Setup finished successfully.');
      return;
    }

    if (state.backend === 'embedded') {
      // Step 3: Download model if not present
      setStep('model');
      const modelsDir = String(state.paths.models).replace(/\\/g, '/');
      const expectedModelPath = `${modelsDir}/llama3.2-1b.gguf`;

      elements.stepStatus.textContent = 'Checking for AI model...';
      log('info', 'Checking for Llama 3.2 1B model...');

      try {
        const downloadedModelPath = await invoke('download_model', {
          targetDir: modelsDir
        });
        state.modelPath = downloadedModelPath;
        log('success', 'Model ready!');
      } catch (error) {
        console.error('Model download error:', error);
        throw new Error(`Failed to download model: ${error?.message ?? error}`);
      }

      // Step 4: Load embedded model
      setStep('install');
      elements.stepStatus.textContent = 'Loading embedded llama.cpp runtime...';
      log('info', 'Initializing embedded runtime with model.');

      try {
        const loadResult = await invoke('load_embedded_model', {
          modelPath: state.modelPath
        });
        log('success', `Embedded model loaded: ${loadResult}`);
      } catch (error) {
        console.error('Model load error:', error);
        throw new Error(`Failed to load embedded model: ${error?.message ?? error}`);
      }

      elements.stepStatus.textContent = 'Persisting configuration...';
      log('info', 'Saving configuration file.');

      await invoke('save_config', {
        config: {
          version: '0.1.0',
          created_at: new Date().toISOString(),
          hardware: state.hardware,
          model: {
            selected: 'llama3.2-1b-embedded',
            status: 'available',
            path: state.modelPath ?? null
          },
          paths: state.paths,
          backend: 'embedded'
        }
      });

      log('success', 'Configuration saved.');

      setStep('complete');
      elements.stepStatus.textContent = 'Setup complete. Opening chat experience.';
      state.activeModel = 'llama3.2-1b-embedded';
      elements.activeModel.textContent = 'Model: llama3.2-1b (Embedded)';
      elements.sendBtn.disabled = false;
      toggleViews(true);
      void refreshConversationList({ preserveSelection: false });
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
    void refreshConversationList({ preserveSelection: false });
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

function renderMarkdown(content) {
  if (typeof marked === 'undefined') {
    console.warn('Marked library not loaded');
    return escapeHtml(content);
  }

  try {
    // Configure marked options
    marked.setOptions({
      breaks: true,
      gfm: true,
      headerIds: false,
      mangle: false
    });

    // Parse markdown to HTML
    const html = marked.parse(content);
    return html;
  } catch (err) {
    console.error('Markdown parse error:', err);
    return escapeHtml(content);
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Update streaming markdown in real-time (no double render)
function updateStreamingMarkdown(bubble, content) {
  if (!bubble || !content) return;

  // Create or get the markdown container
  let markdownContainer = bubble.querySelector('.markdown-content');
  if (!markdownContainer) {
    markdownContainer = document.createElement('div');
    markdownContainer.className = 'markdown-content';
    bubble.textContent = '';
    bubble.appendChild(markdownContainer);
  }

  // Render markdown directly
  if (typeof marked !== 'undefined') {
    try {
      const html = marked.parse(content);
      markdownContainer.innerHTML = html;

      // Apply syntax highlighting to any code blocks
      if (typeof hljs !== 'undefined') {
        markdownContainer.querySelectorAll('pre code').forEach((block) => {
          if (!block.classList.contains('hljs')) {
            hljs.highlightElement(block);
          }

          // Add language label and copy button
          const pre = block.parentElement;
          if (!pre.querySelector('.code-header')) {
            const lang = block.className.match(/language-(\w+)/);
            const language = lang && lang[1] ? lang[1] : 'text';

            // Create code header with language label and copy button
            const header = document.createElement('div');
            header.className = 'code-header';

            const langLabel = document.createElement('span');
            langLabel.className = 'code-language';
            langLabel.textContent = language;

            const copyBtn = document.createElement('button');
            copyBtn.className = 'code-copy-btn';
            copyBtn.textContent = 'Copy';
            copyBtn.onclick = () => {
              const code = block.textContent;
              navigator.clipboard.writeText(code).then(() => {
                copyBtn.textContent = 'Copied!';
                setTimeout(() => {
                  copyBtn.textContent = 'Copy';
                }, 2000);
              });
            };

            header.appendChild(langLabel);
            header.appendChild(copyBtn);
            pre.insertBefore(header, block);
            pre.setAttribute('data-language', language);
          }
        });
      }
    } catch (err) {
      // Fallback to plain text if markdown parsing fails
      markdownContainer.textContent = content;
    }
  } else {
    // Fallback if marked is not loaded
    markdownContainer.textContent = content;
  }
}

function appendMessageBubble(role, content = '') {
  const bubble = document.createElement('div');
  bubble.className = `bubble ${role}`;

  if (role === 'assistant' && content) {
    // Render markdown for assistant messages
    const markdownContainer = document.createElement('div');
    markdownContainer.className = 'markdown-content';
    markdownContainer.innerHTML = renderMarkdown(content);
    bubble.appendChild(markdownContainer);

    // Highlight all code blocks after rendering
    requestAnimationFrame(() => {
      if (typeof hljs !== 'undefined') {
        bubble.querySelectorAll('pre code').forEach((block) => {
          // Only highlight if not already highlighted
          if (!block.classList.contains('hljs')) {
            hljs.highlightElement(block);
          }

          // Add language label and copy button
          const pre = block.parentElement;
          if (!pre.querySelector('.code-header')) {
            const lang = block.className.match(/language-(\w+)/);
            const language = lang && lang[1] ? lang[1] : 'text';

            // Create code header with language label and copy button
            const header = document.createElement('div');
            header.className = 'code-header';

            const langLabel = document.createElement('span');
            langLabel.className = 'code-language';
            langLabel.textContent = language;

            const copyBtn = document.createElement('button');
            copyBtn.className = 'code-copy-btn';
            copyBtn.textContent = 'Copy';
            copyBtn.onclick = () => {
              const code = block.textContent;
              navigator.clipboard.writeText(code).then(() => {
                copyBtn.textContent = 'Copied!';
                setTimeout(() => {
                  copyBtn.textContent = 'Copy';
                }, 2000);
              });
            };

            header.appendChild(langLabel);
            header.appendChild(copyBtn);
            pre.insertBefore(header, block);
            pre.setAttribute('data-language', language);
          }
        });
      }
    });
  } else {
    // Plain text for user messages
    bubble.textContent = content;
  }

  elements.chatHistory.appendChild(bubble);
  elements.chatHistory.scrollTop = elements.chatHistory.scrollHeight;
  return bubble;
}

// ========================================
// DOCUMENT HANDLING
// ========================================

async function attachDocument() {
  if (typeof openDialog !== 'function') {
    alert('File dialog not available in this environment.');
    return;
  }

  try {
    const selected = await openDialog({
      multiple: false,
      filters: [
        {
          name: 'Documents',
          extensions: ['pdf', 'docx', 'xlsx', 'xls', 'txt', 'md', 'markdown',
                      'rs', 'py', 'js', 'ts', 'jsx', 'tsx', 'java', 'c', 'cpp',
                      'h', 'hpp', 'go', 'rb', 'php', 'swift', 'kt', 'cs',
                      'html', 'css', 'scss', 'json', 'xml', 'yaml', 'yml',
                      'toml', 'sh', 'bash', 'sql']
        }
      ]
    });

    const filePath = Array.isArray(selected) ? selected[0] : selected;
    if (!filePath) return;

    // Show loading state
    showDocumentLoading(true);

    try {
      const docInfo = await invoke('parse_document', { filePath });

      state.attachedDocument = {
        path: docInfo.path,
        name: docInfo.name,
        text: docInfo.text,
        summary: docInfo.summary
      };

      showDocumentPreview();
    } catch (error) {
      console.error('Failed to parse document:', error);
      alert(`Failed to parse document: ${error?.message ?? error}`);
      state.attachedDocument = null;
    } finally {
      showDocumentLoading(false);
    }
  } catch (error) {
    console.warn('File selection cancelled or failed:', error);
  }
}

function showDocumentLoading(loading) {
  if (elements.attachDocBtn) {
    elements.attachDocBtn.disabled = loading;
    elements.attachDocBtn.textContent = loading ? '⏳' : '📎';
  }
}

function showDocumentPreview() {
  if (!state.attachedDocument || !elements.documentPreview) return;

  const { name, text } = state.attachedDocument;
  const charCount = text.length;
  const wordCount = text.split(/\s+/).filter(w => w).length;

  if (elements.documentName) {
    elements.documentName.textContent = name;
  }

  if (elements.documentStats) {
    elements.documentStats.textContent = `${charCount} chars, ${wordCount} words`;
  }

  elements.documentPreview.classList.remove('hidden');
}

function removeDocument() {
  state.attachedDocument = null;
  if (elements.documentPreview) {
    elements.documentPreview.classList.add('hidden');
  }
  if (elements.documentName) {
    elements.documentName.textContent = '';
  }
  if (elements.documentStats) {
    elements.documentStats.textContent = '';
  }
}

async function handleChatSubmit(event) {
  event.preventDefault();
  if (!state.activeModel) {
    appendMessageBubble('assistant', 'No model is active. Run setup first.');
    return;
  }

  const userMessage = elements.chatInput.value.trim();
  if (!userMessage && !state.attachedDocument) return;

  // Keep track of the visible message and the actual message sent to model
  let visibleMessage = userMessage;
  let modelMessage = userMessage;

  // If a document is attached, add it to the model context invisibly
  let documentContext = null;
  if (state.attachedDocument) {
    // Create document context for the model (invisible to user)
    documentContext = {
      role: 'system',
      content: `[Attached Document: ${state.attachedDocument.name}]\n\n${state.attachedDocument.text}`
    };

    // If user didn't type anything, show a placeholder message
    if (!userMessage) {
      visibleMessage = `📄 Analyze document: ${state.attachedDocument.name}`;
      modelMessage = 'Please analyze the attached document and provide insights.';
    }

    // Clear the attached document after preparing
    removeDocument();
  }

  // Show only the user's typed message (or placeholder) in the UI
  appendMessageBubble('user', visibleMessage);
  elements.chatInput.value = '';
  elements.sendBtn.disabled = true;
  state.isStreaming = true;
  state.shouldStopStreaming = false;
  showStopButton();

  const timestamp = new Date().toISOString();

  // Save only the visible message to conversation history (what user sees)
  const userRecord = {
    role: 'user',
    content: visibleMessage,
    timestamp
  };
  state.conversation.push(userRecord);
  syncConversationCache();
  updateActiveConversationSummary();
  updateContextStats();
  await appendChatRecords([userRecord]);

  // Prepare context for the model
  let historySlice = getContextMessages();

  // If there's document context, inject it strategically
  if (documentContext) {
    // Calculate available space for document
    const historyTokens = historySlice.reduce((sum, msg) => sum + estimateTokens(msg.content), 0);
    const docTokens = estimateTokens(documentContext.content);
    const maxTokens = state.settings.maxTokens;

    // Reserve 25% for response, 75% for context + document
    const availableForContext = maxTokens * 0.75;

    if (historyTokens + docTokens > availableForContext) {
      // Document + history exceeds limit - need to trim
      console.log(`[DOC-CONTEXT] Document (${docTokens} tokens) + History (${historyTokens} tokens) exceeds limit`);

      // Prioritize: recent messages + document
      // Keep last few messages and the document
      const targetHistoryTokens = availableForContext - docTokens;

      if (targetHistoryTokens > 0) {
        // Trim history to fit with document
        const trimmedHistory = [];
        let currentTokens = 0;

        for (let i = historySlice.length - 1; i >= 0; i--) {
          const msgTokens = estimateTokens(historySlice[i].content);
          if (currentTokens + msgTokens <= targetHistoryTokens) {
            trimmedHistory.unshift(historySlice[i]);
            currentTokens += msgTokens;
          } else {
            break;
          }
        }

        historySlice = trimmedHistory;
        console.log(`[DOC-CONTEXT] Trimmed history to ${historySlice.length} messages (${currentTokens} tokens) to fit document`);
      } else {
        // Document alone exceeds limit - truncate document
        const targetDocLength = Math.floor(availableForContext * 4); // ~4 chars per token
        documentContext.content = documentContext.content.substring(0, targetDocLength) + '\n\n[Document truncated due to size...]';
        historySlice = historySlice.slice(-2); // Keep only last 2 messages
        console.log(`[DOC-CONTEXT] Document too large, truncated to ${targetDocLength} chars`);
      }
    }

    // Add document context at the beginning (after trimming if needed)
    historySlice.unshift(documentContext);
  }

  // Replace the last user message with the actual model message (not the visible one)
  if (historySlice.length > 0) {
    const lastMsg = historySlice[historySlice.length - 1];
    if (lastMsg.role === 'user') {
      lastMsg.content = modelMessage;
    }
  }

  if (state.backend === 'python' || state.backend === 'embedded') {
    if (state.backend === 'python') {
      const ready = await ensurePythonEngineReady();
      if (!ready) {
        elements.sendBtn.disabled = false;
        elements.chatInput.focus();
        return;
      }
    }
    const assistantBubble = appendMessageBubble('assistant', '');
    attachTypingIndicator(assistantBubble);
    state.streamingBubble = assistantBubble;
    state.streamingBuffer = '';
    try {
      const command = state.backend === 'embedded' ? 'embedded_chat_stream' : 'python_chat_stream';
      console.log(`[DEBUG] Calling ${command} with:`, {
        message: modelMessage,
        historyLength: historySlice.length,
        sessionId: state.sessionId,
        backend: state.backend,
        hasDocumentContext: !!documentContext
      });
      await invoke(command, {
        message: modelMessage,
        history: historySlice,
        sessionId: state.sessionId,
        chatsDir: state.paths?.chats || null
      });
      console.log(`[DEBUG] ${command} returned successfully`);
      const assistantContent = state.streamingBuffer;
      if (assistantContent) {
        const assistantRecord = {
          role: 'assistant',
          content: assistantContent,
          timestamp: new Date().toISOString()
        };
        state.conversation.push(assistantRecord);
        syncConversationCache();
        updateActiveConversationSummary();
        updateContextStats();
        await appendChatRecords([assistantRecord]);
        void refreshConversationList({ preserveSelection: true });
      }
    } catch (error) {
      console.error(error);
      if (state.streamingBubble) {
        clearTypingIndicator();
        state.streamingBubble.textContent = `Python sidecar error: ${error?.message ?? error}`;
      } else {
        appendMessageBubble('assistant', `Python sidecar error: ${error?.message ?? error}`);
      }
    } finally {
      clearTypingIndicator();
      // Markdown is already rendered in real-time during streaming
      // No need for double render here
      state.streamingBubble = null;
      state.streamingBuffer = '';
      state.typingIndicator = null;
      state.isStreaming = false;
      state.shouldStopStreaming = false;
      hideStopButton();
      elements.sendBtn.disabled = false;
      elements.chatInput.focus();
    }
    return;
  }

  const assistantBubble = appendMessageBubble('assistant', '');
  attachTypingIndicator(assistantBubble);
  state.streamingBubble = assistantBubble;
  state.streamingBuffer = '';

  try {
    console.log(`[DEBUG] Calling send_chat_message with:`, {
      message: modelMessage,
      model: state.activeModel,
      historyLength: historySlice.length,
      hasDocumentContext: !!documentContext
    });
    const response = await invoke('send_chat_message', {
      message: modelMessage,
      model: state.activeModel,
      history: historySlice,
      sessionId: state.sessionId,
      chatsDir: state.paths?.chats || null
    });
    if (state.streamingBubble) {
      clearTypingIndicator();
      const finalContent = response || state.streamingBuffer;

      // Render markdown in real-time (already being done during streaming)
      // Just ensure final content is rendered if stream didn't update
      if (finalContent && finalContent !== state.streamingBuffer) {
        updateStreamingMarkdown(state.streamingBubble, finalContent);
      }
    }
    const assistantContent = response || state.streamingBuffer;
    if (assistantContent) {
      const assistantRecord = {
        role: 'assistant',
        content: assistantContent,
        timestamp: new Date().toISOString()
      };
      state.conversation.push(assistantRecord);
      syncConversationCache();
      updateActiveConversationSummary();
      updateContextStats();
      await appendChatRecords([assistantRecord]);
      void refreshConversationList({ preserveSelection: true });
    }
  } catch (error) {
    console.error(error);
    if (state.streamingBubble) {
      clearTypingIndicator();
      state.streamingBubble.textContent = `Chat failed: ${error?.message ?? error}`;
    } else {
      appendMessageBubble('assistant', `Chat failed: ${error?.message ?? error}`);
    }
  } finally {
    state.streamingBubble = null;
    state.streamingBuffer = '';
    state.typingIndicator = null;
    state.isStreaming = false;
    state.shouldStopStreaming = false;
    hideStopButton();
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

  clearTypingIndicator();
  startNewConversation({ focusInput: false, persistSummary: false });
  state.activeModel = null;
  state.hardware = null;
  state.currentStep = null;
  elements.steps.forEach((li) => li.classList.remove('active', 'completed'));
  elements.stepStatus.textContent = 'Press "Start Setup" to begin.';
  elements.logEntries.innerHTML = '';
  elements.activeModel.textContent = 'Model: —';
  elements.chatInput.value = '';
  elements.sendBtn.disabled = true;
  elements.startSetupBtn.disabled = false;
  state.streamingBubble = null;
  state.streamingBuffer = '';

  // Reset to setup view (this will hide navigation)
  toggleViews(false);

  setDefaultModelOptions();
  updateBackendAvailability();
  state.modelPath = null;
  state.typingIndicator = null;
  updateChatDirDisplay();
}

function attachEventListeners() {
  elements.startSetupBtn.addEventListener('click', runSetup);
  elements.chatForm.addEventListener('submit', handleChatSubmit);
  elements.stopBtn?.addEventListener('click', stopStreaming);
  elements.themeToggle?.addEventListener('click', toggleTheme);

  // Add Enter key handler for chat input
  elements.chatInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!elements.sendBtn.disabled && elements.chatInput.value.trim()) {
        elements.chatForm.dispatchEvent(new Event('submit'));
      }
    }
  });

  elements.newConversationBtn?.addEventListener('click', () => {
    startNewConversation({ focusInput: true, persistSummary: true });
  });
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
  elements.chooseChatDirBtn?.addEventListener('click', () => {
    void chooseChatDirectory({ focusChat: false });
  });
  elements.changeChatDirBtn?.addEventListener('click', () => {
    void chooseChatDirectory({ focusChat: true });
  });

  // Document attachment
  elements.attachDocBtn?.addEventListener('click', () => {
    void attachDocument();
  });
  elements.removeDocBtn?.addEventListener('click', removeDocument);

  // Step Prompter navigation
  elements.chatViewNav?.addEventListener('click', () => {
    switchToView('chat');
  });
  elements.stepperViewNav?.addEventListener('click', () => {
    switchToView('stepper');
  });

  // Workflow templates
  elements.templateCards.forEach((card) => {
    card.addEventListener('click', () => {
      const templateId = card.dataset.template;
      if (templateId) {
        startWorkflow(templateId);
      }
    });
  });

  // Workflow controls
  elements.newWorkflowBtn?.addEventListener('click', openWorkflowBuilder);
  elements.exportResultsBtn?.addEventListener('click', exportWorkflowResults);

  // Workflow builder controls
  elements.closeWorkflowBuilderBtn?.addEventListener('click', closeWorkflowBuilder);
  elements.cancelWorkflowBuilderBtn?.addEventListener('click', closeWorkflowBuilder);
  elements.saveWorkflowBtn?.addEventListener('click', saveCustomWorkflow);
  elements.addStepBtn?.addEventListener('click', addWorkflowStep);

  // Close workflow builder modal on backdrop click
  elements.workflowBuilderModal?.addEventListener('click', (e) => {
    if (e.target === elements.workflowBuilderModal) {
      closeWorkflowBuilder();
    }
  });

  // Settings modal
  elements.settingsBtn?.addEventListener('click', openSettings);
  elements.closeSettingsBtn?.addEventListener('click', closeSettings);
  elements.cancelSettingsBtn?.addEventListener('click', closeSettings);
  elements.saveSettingsBtn?.addEventListener('click', handleSaveSettings);

  // Update temperature display
  elements.temperature?.addEventListener('input', (e) => {
    if (elements.temperatureValue) {
      elements.temperatureValue.textContent = e.target.value;
    }
  });

  // Update visibility when strategy changes
  elements.contextStrategy?.addEventListener('change', () => {
    updateMaxMessagesVisibility();
    updateContextStats();
  });

  // Update stats when values change
  elements.maxMessages?.addEventListener('input', updateContextStats);
  elements.maxTokens?.addEventListener('input', updateContextStats);

  // Close modal on backdrop click
  elements.settingsModal?.addEventListener('click', (e) => {
    if (e.target === elements.settingsModal) {
      closeSettings();
    }
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
      if (state.shouldStopStreaming) {
        return;
      }
      if (typeof event?.payload === 'object' && event.payload !== null) {
        const { content } = event.payload;
        state.streamingBuffer = content || '';
        if (state.streamingBubble) {
          if (state.typingIndicator && state.streamingBuffer.length) {
            clearTypingIndicator();
          }

          // Render markdown in real-time during streaming for smooth experience
          updateStreamingMarkdown(state.streamingBubble, state.streamingBuffer);

          // Auto-scroll to bottom as messages come in
          elements.chatHistory.scrollTop = elements.chatHistory.scrollHeight;
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
    listen('model-download-status', (event) => {
      if (typeof event?.payload === 'string') {
        log('info', event.payload);
        elements.stepStatus.textContent = event.payload;
      }
    });
    listen('model-download-progress', (event) => {
      if (typeof event?.payload === 'object' && event.payload !== null) {
        const { percent, downloaded_mb, total_mb } = event.payload;
        const message = `Downloading model: ${percent}% (${downloaded_mb}/${total_mb} MB)`;
        log('info', message);
        elements.stepStatus.textContent = message;
      }
    });
    listen('model-load-status', (event) => {
      if (typeof event?.payload === 'string') {
        log('info', event.payload);
        if (state.backend === 'embedded') {
          elements.stepStatus.textContent = event.payload;
        }
      }
    });
    listen('embedded-stream-done', (event) => {
      // Embedded stream finished
      console.debug('Embedded stream completed');
    });
  }
}

async function bootstrap() {
  loadTheme();  // Initialize theme first
  setDefaultModelOptions();
  loadSettings();
  loadCustomWorkflows();  // Load saved custom workflows
  attachEventListeners();
  startNewConversation({ focusInput: false, persistSummary: false });
  updateChatDirDisplay();
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
      updateChatDirDisplay();
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
      } else if (state.backend === 'embedded') {
        try {
          await invoke('load_embedded_model', {
            modelPath: config.model?.path ?? state.modelPath
          });
          state.activeModel = config.model.selected || 'llama3.2-1b-embedded';
          elements.activeModel.textContent = `Model: ${state.activeModel}`;
          elements.sendBtn.disabled = false;
          toggleViews(true);
          log('info', 'Loaded embedded runtime configuration; chat is ready.');
        } catch (error) {
          console.warn('Failed to load embedded model on bootstrap.', error);
          log('info', 'Embedded backend configured but model not loaded. Click "Start Setup" to load the model.');
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

  await refreshConversationList({ preserveSelection: false });
}

bootstrap();
