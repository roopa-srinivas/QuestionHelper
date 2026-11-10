/**
 * Question Helper - Side Panel Script
 * Renders the detected question and the tutoring conversation, streams tutor replies
 * from the background worker, and sends hint / attempt / solution requests.
 */

// DOM Elements
const statusIndicator = document.getElementById('statusIndicator');
const statusText = document.getElementById('statusText');
const errorBanner = document.getElementById('errorBanner');
const errorMessage = document.getElementById('errorMessage');
const btnDismissError = document.getElementById('btnDismissError');

const emptyQuestionState = document.getElementById('emptyQuestionState');
const detectedQuestionContent = document.getElementById('detectedQuestionContent');
const questionTextEl = document.getElementById('questionText');
const questionImagesEl = document.getElementById('questionImages');
const optionsListEl = document.getElementById('optionsList');
const selectorTag = document.getElementById('selectorTag');
const visualTag = document.getElementById('visualTag');
const blankInputsBadge = document.getElementById('blankInputsBadge');
const btnRereadPage = document.getElementById('btnRereadPage');

const btnScreenshot = document.getElementById('btnScreenshot');
const btnUploadImage = document.getElementById('btnUploadImage');
const fileInputImage = document.getElementById('fileInputImage');
const btnOptions = document.getElementById('btnOptions');

const thinkingState = document.getElementById('thinkingState');
const thinkingText = document.getElementById('thinkingText');
const emptyAnswerState = document.getElementById('emptyAnswerState');
const emptyAnswerDesc = document.getElementById('emptyAnswerDesc');
const conversationEl = document.getElementById('conversation');
const modelBadge = document.getElementById('modelBadge');
const materialsBadge = document.getElementById('materialsBadge');
const studySummary = document.getElementById('studySummary');
const studyList = document.getElementById('studyList');
const btnManageMaterials = document.getElementById('btnManageMaterials');
const btnResetConversation = document.getElementById('btnResetConversation');
const answerCardContent = document.getElementById('answerCardContent');

const attemptInput = document.getElementById('attemptInput');
const btnHint = document.getElementById('btnHint');
const btnCheckAttempt = document.getElementById('btnCheckAttempt');
const btnCancel = document.getElementById('btnCancel');
const btnSolution = document.getElementById('btnSolution');
const progressStats = document.getElementById('progressStats');

// State
let currentRequestId = 0;
let currentState = null;
let streamingBubble = null;

/**
 * Basic Markdown to HTML converter
 */
function renderMarkdown(md) {
  if (!md) return '';

  let html = md;

  // Escape HTML tags to prevent XSS
  html = html
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Pull code and math out first so emphasis rules don't mangle things like x_1 or a*b
  const protectedSpans = [];
  const protect = (rendered) => {
    protectedSpans.push(rendered);
    return `\u0000${protectedSpans.length - 1}\u0000`;
  };

  // Code blocks: ```lang ... ```
  html = html.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (match, lang, code) => {
    return protect(`<pre><code>${code.trim()}</code></pre>`);
  });

  // Inline code: `code`
  html = html.replace(/`([^`]+)`/g, (m, code) => protect(`<code>${code}</code>`));

  // Math Blocks: $$ ... $$
  html = html.replace(/\$\$([\s\S]*?)\$\$/g, (m, formula) => {
    return protect(`<div class="math-block"><code>${formula.trim()}</code></div>`);
  });

  // Inline Math: $ ... $
  html = html.replace(/\$([^\$\n]+)\$/g, (m, formula) => {
    return protect(`<code class="math-inline">${formula.trim()}</code>`);
  });

  // Markdown tables:
  html = html.replace(/((?:\|[^\n]+\|\r?\n?)+)/g, (tableMatch) => {
    const lines = tableMatch.trim().split(/\r?\n/);
    if (lines.length < 2) return tableMatch;

    let tableHtml = '<div class="table-wrap"><table>';
    let isHeader = true;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line.startsWith('|')) continue;
      if (/^\|[\s\-:|]+\|$/.test(line)) {
        isHeader = false;
        continue;
      }
      const cells = line.split('|').slice(1, -1).map(c => c.trim());
      const tag = isHeader ? 'th' : 'td';
      tableHtml += '<tr>' + cells.map(c => `<${tag}>${c}</${tag}>`).join('') + '</tr>';
      if (!(i === 0 && lines.length > 1 && /^\|[\s\-:|]+\|$/.test(lines[1].trim()))) {
        isHeader = false;
      }
    }
    tableHtml += '</table></div>';
    return tableHtml;
  });

  // Headers: ###, ##, #
  html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
  html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
  html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');

  // Bold & Italic
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  html = html.replace(/(^|\W)_([^_\n]+)_(?=\W|$)/g, '$1<em>$2</em>');

  // Bullet points
  html = html.replace(/^\s*[-*+]\s+(.*$)/gim, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>)/gim, '<ul>$1</ul>');
  // Clean duplicate <ul> wraps
  html = html.replace(/<\/ul>\s*<ul>/g, '');

  // Paragraphs
  const blocks = html.split(/\n{2,}/);
  html = blocks.map(block => {
    block = block.trim();
    if (!block) return '';
    if (block.startsWith('<h') || block.startsWith('<ul') || block.startsWith('<div') || block.startsWith('<table') || /^\u0000\d+\u0000$/.test(block)) {
      return block;
    }
    return `<p>${block.replace(/\n/g, '<br>')}</p>`;
  }).join('\n');

  return html.replace(/\u0000(\d+)\u0000/g, (m, idx) => protectedSpans[Number(idx)]);
}

function isBusy(state) {
  return state && (state.status === 'thinking' || state.status === 'streaming');
}

function hasQuestion(question) {
  return !!question && !!(
    question.questionText ||
    (question.options && question.options.length > 0) ||
    (question.blankInputs && question.blankInputs.length > 0) ||
    (question.images && question.images.length > 0)
  );
}

/**
 * Update header status, error banner and composer controls
 */
function updateStatusUI(state) {
  const busy = isBusy(state);
  const status = state.error ? 'error' : state.status;
  statusIndicator.className = `status-indicator ${status}`;
  statusText.textContent = {
    thinking: 'Thinking...',
    streaming: 'Replying...',
    error: 'Error'
  }[status] || 'Ready';

  thinkingState.classList.toggle('hidden', state.status !== 'thinking');

  if (state.error) {
    errorMessage.textContent = state.error;
    errorBanner.classList.remove('hidden');
  } else {
    errorBanner.classList.add('hidden');
  }

  const questionReady = hasQuestion(state.question);
  const turns = state.turns || [];
  const attempts = turns.filter(t => t.kind === 'attempt').length;
  const hints = turns.filter(t => t.kind === 'hint').length;
  const solutionShown = turns.some(t => t.kind === 'solution');

  btnHint.disabled = busy || !questionReady;
  btnHint.textContent = hints === 0 ? '💡 Hint' : '💡 Next hint';
  btnCheckAttempt.disabled = busy || !questionReady || !attemptInput.value.trim();
  btnCheckAttempt.classList.toggle('hidden', busy);
  btnCancel.classList.toggle('hidden', !busy);

  btnSolution.disabled = busy || attempts === 0 || solutionShown;
  if (solutionShown) {
    btnSolution.textContent = '✓ Full solution shown above';
  } else if (attempts === 0) {
    btnSolution.textContent = '🔒 Full solution unlocks after your first attempt';
  } else {
    btnSolution.textContent = '📖 Show the full worked solution';
  }

  btnResetConversation.classList.toggle('hidden', turns.length === 0);

  const stats = [];
  if (hints) stats.push(`${hints} hint${hints === 1 ? '' : 's'}`);
  if (attempts) stats.push(`${attempts} attempt${attempts === 1 ? '' : 's'}`);
  progressStats.textContent = stats.join(' · ');
}

/**
 * Update Question Card
 */
function updateQuestionUI(question) {
  if (!hasQuestion(question)) {
    emptyQuestionState.classList.remove('hidden');
    detectedQuestionContent.classList.add('hidden');
    selectorTag.classList.add('hidden');
    visualTag.classList.add('hidden');
    blankInputsBadge.classList.add('hidden');
    return;
  }

  emptyQuestionState.classList.add('hidden');
  detectedQuestionContent.classList.remove('hidden');

  if (question.questionText) {
    questionTextEl.innerHTML = renderMarkdown(question.questionText);
    questionTextEl.classList.remove('hidden');
  } else {
    questionTextEl.innerHTML = '';
    questionTextEl.classList.toggle('hidden', question.source === 'image');
    if (question.source !== 'image') questionTextEl.textContent = '(No question stem found)';
  }

  // Tags
  if (question.selectorUsed) {
    selectorTag.textContent = question.selectorUsed.replace('Heuristic: ', '');
    selectorTag.classList.remove('hidden');
  } else {
    selectorTag.classList.add('hidden');
  }

  visualTag.classList.toggle('hidden', !(question.hasVisualMedia || (question.images && question.images.length > 0)));
  blankInputsBadge.classList.toggle('hidden', !(question.isFillInBlank || (question.blankInputs && question.blankInputs.length > 0)));

  // Render Image Thumbnails
  questionImagesEl.innerHTML = '';
  const images = (question.images || []).filter(img => img.data || img.src);
  if (images.length > 0) {
    images.forEach((img, idx) => {
      const wrap = document.createElement('div');
      wrap.className = 'question-thumbnail-wrap';

      const imgEl = document.createElement('img');
      imgEl.className = 'question-thumbnail';
      imgEl.src = img.data ? `data:${img.mimeType || 'image/jpeg'};base64,${img.data}` : img.src;
      imgEl.alt = img.description || `Question Image ${idx + 1}`;
      imgEl.title = 'Click to open full image';
      imgEl.addEventListener('click', () => {
        const w = window.open('');
        if (w) {
          const full = w.document.createElement('img');
          full.src = imgEl.src;
          full.style.cssText = 'max-width:100%;height:auto;display:block;margin:20px auto;';
          w.document.body.appendChild(full);
          w.document.title = imgEl.alt;
        }
      });

      wrap.appendChild(imgEl);
      if (img.description) {
        const caption = document.createElement('div');
        caption.className = 'thumbnail-caption';
        caption.textContent = img.description;
        wrap.appendChild(caption);
      }
      questionImagesEl.appendChild(wrap);
    });
    questionImagesEl.classList.remove('hidden');
  } else {
    questionImagesEl.classList.add('hidden');
  }

  // Options
  optionsListEl.innerHTML = '';
  if (question.options && question.options.length > 0) {
    question.options.forEach(opt => {
      const optEl = document.createElement('div');
      optEl.className = 'option-item markdown-body';
      optEl.innerHTML = renderMarkdown(opt);
      optionsListEl.appendChild(optEl);
    });
    optionsListEl.classList.remove('hidden');
  } else {
    optionsListEl.classList.add('hidden');
  }
}

const STUDENT_ACTION_LABELS = {
  hint: '💡 Asked for a hint',
  solution: '📖 Asked for the full solution'
};

function createBubble(turn) {
  const bubble = document.createElement('div');
  if (turn.role === 'student') {
    if (turn.kind === 'attempt') {
      bubble.className = 'bubble student';
      bubble.textContent = turn.text;
    } else {
      bubble.className = 'bubble student-action';
      bubble.textContent = STUDENT_ACTION_LABELS[turn.kind] || '';
    }
  } else {
    bubble.className = 'bubble tutor markdown-body';
    bubble.innerHTML = renderMarkdown(turn.text);
  }
  return bubble;
}

/**
 * Render the full conversation (and any in-progress tutor reply)
 */
function renderConversation(state) {
  const turns = state.turns || [];
  conversationEl.innerHTML = '';
  turns.forEach(turn => conversationEl.appendChild(createBubble(turn)));

  streamingBubble = null;
  if (state.status === 'streaming') {
    streamingBubble = createBubble({ role: 'tutor', text: state.streamingText || '' });
    conversationEl.appendChild(streamingBubble);
  }

  const isEmpty = turns.length === 0;
  conversationEl.classList.toggle('hidden', isEmpty);
  emptyAnswerState.classList.toggle('hidden', !isEmpty || isBusy(state));

  if (hasQuestion(state.question)) {
    emptyAnswerDesc.innerHTML = 'Ask for a <strong>hint</strong>, or type your answer below and the tutor will tell you if you\'re on the right track.';
  } else {
    emptyAnswerDesc.innerHTML = 'Open a practice question on your active tab, or use <strong>Capture Tab</strong> / upload an image.';
  }
}

function scrollConversationToBottom(onlyIfNearBottom) {
  const distanceFromBottom = answerCardContent.scrollHeight - answerCardContent.scrollTop - answerCardContent.clientHeight;
  if (!onlyIfNearBottom || distanceFromBottom < 100) {
    answerCardContent.scrollTop = answerCardContent.scrollHeight;
  }
}

/**
 * Apply full state update
 */
function applyState(state) {
  if (!state) return;
  const prevTurnCount = currentState?.turns?.length || 0;
  currentState = state;
  currentRequestId = state.requestId;

  updateQuestionUI(state.question);
  renderConversation(state);

  const providerName = state.provider === 'anthropic' ? 'Claude' : 'Gemini';
  thinkingText.textContent = `${providerName} is thinking...`;
  if (state.model) {
    modelBadge.textContent = state.model;
  }
  // Which course materials the last tutor request used
  if (state.materialsUsed) {
    materialsBadge.textContent = `📚 ${state.materialsUsed.label}`;
    materialsBadge.title = state.materialsUsed.partial
      ? `Used the ${state.materialsUsed.pagesIncluded} most relevant of ${state.materialsUsed.pagesTotal} pages`
      : `Used all ${state.materialsUsed.pagesTotal} pages`;
    materialsBadge.classList.remove('hidden');
  } else {
    materialsBadge.classList.add('hidden');
  }

  updateStatusUI(state);

  if ((state.turns || []).length !== prevTurnCount || isBusy(state)) {
    scrollConversationToBottom(false);
  }
}

function safeSendMessage(msg, callback) {
  try {
    chrome.runtime.sendMessage(msg, (response) => {
      if (chrome.runtime.lastError) {
        // Harmless: Service worker sleeping or not yet listening
      }
      if (callback) callback(response);
    });
  } catch (_) {}
}

function submitAttempt() {
  const text = attemptInput.value.trim();
  if (!text || isBusy(currentState)) return;
  attemptInput.value = '';
  safeSendMessage({ type: 'TUTOR_ATTEMPT', text });
}

function loadImageQuestion(file, description) {
  const reader = new FileReader();
  reader.onload = (e) => {
    safeSendMessage({
      type: 'LOAD_IMAGE_QUESTION',
      dataUrl: e.target.result,
      description
    });
  };
  reader.readAsDataURL(file);
}

function rereadActiveTab() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]?.id) return;
    try {
      chrome.tabs.sendMessage(tabs[0].id, { type: 'FORCE_EXTRACT' }, () => {
        if (chrome.runtime.lastError) {
          // Harmless: content script might not run on chrome:// pages
        }
      });
    } catch (_) {}
  });
}

// --- Event Listeners ---

btnHint.addEventListener('click', () => {
  safeSendMessage({ type: 'TUTOR_HINT' });
});

btnCheckAttempt.addEventListener('click', submitAttempt);

attemptInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    submitAttempt();
  }
});

attemptInput.addEventListener('input', () => {
  if (currentState) updateStatusUI(currentState);
});

btnSolution.addEventListener('click', () => {
  safeSendMessage({ type: 'TUTOR_SOLUTION' });
});

btnCancel.addEventListener('click', () => {
  safeSendMessage({ type: 'CANCEL_SOLVE' });
});

btnResetConversation.addEventListener('click', () => {
  if (confirm('Start this question over? The current conversation will be cleared.')) {
    safeSendMessage({ type: 'TUTOR_RESET' });
  }
});

btnRereadPage.addEventListener('click', rereadActiveTab);

// Capture Tab: use a screenshot of the visible tab as the question
btnScreenshot.addEventListener('click', () => {
  safeSendMessage({ type: 'CAPTURE_TAB' });
});

// Upload Image Button
btnUploadImage.addEventListener('click', () => {
  fileInputImage.click();
});

fileInputImage.addEventListener('change', () => {
  const file = fileInputImage.files[0];
  if (!file) return;
  loadImageQuestion(file, file.name);
  fileInputImage.value = '';
});

// Clipboard Paste Image Support: Cmd+V / Ctrl+V in Side Panel (text pastes into the answer box as usual)
window.addEventListener('paste', (e) => {
  const clipboardData = e.clipboardData || window.clipboardData;
  if (!clipboardData || !clipboardData.items) return;

  for (const item of clipboardData.items) {
    if (item.type.indexOf('image') !== -1) {
      const file = item.getAsFile();
      if (!file) continue;
      loadImageQuestion(file, 'Pasted Image');
      e.preventDefault();
      break;
    }
  }
});

// Open Settings
function openSettings() {
  if (chrome.runtime.openOptionsPage) {
    chrome.runtime.openOptionsPage();
  } else {
    window.open(chrome.runtime.getURL('options.html'));
  }
}
btnOptions.addEventListener('click', openSettings);
btnManageMaterials.addEventListener('click', openSettings);

// --- Course materials picker ---

function citeName(title) {
  const match = title.match(/^(Ch\.\s*\d+)/i);
  return match ? match[1] : title;
}

async function renderStudyPicker() {
  const { courseMaterials = [], studyingMaterialIds = [] } =
    await chrome.storage.local.get(['courseMaterials', 'studyingMaterialIds']);
  const studying = new Set(studyingMaterialIds);

  studyList.textContent = '';
  if (courseMaterials.length === 0) {
    studySummary.textContent = 'No course materials';
    studySummary.classList.add('muted');
    const empty = document.createElement('p');
    empty.className = 'study-empty';
    empty.textContent = 'Add textbook chapters or notes in Settings, and the tutor will teach from them and cite their pages.';
    studyList.appendChild(empty);
    return;
  }

  const courses = Array.from(new Set(courseMaterials.map(m => m.course || 'Other')));
  for (const course of courses) {
    const heading = document.createElement('div');
    heading.className = 'study-course';
    heading.textContent = course;
    studyList.appendChild(heading);

    for (const m of courseMaterials.filter(x => (x.course || 'Other') === course)) {
      const label = document.createElement('label');
      label.className = 'study-item';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.dataset.id = m.id;
      box.checked = studying.has(m.id);
      // Save what the checkboxes show, so quick clicks can't overwrite each other
      box.addEventListener('change', () => {
        const next = Array.from(studyList.querySelectorAll('input[type="checkbox"]:checked'), b => b.dataset.id);
        chrome.storage.local.set({ studyingMaterialIds: next });
      });
      const text = document.createElement('span');
      text.textContent = m.title;
      label.append(box, text);
      studyList.appendChild(label);
    }
  }

  updateStudySummary(courseMaterials, studying);
}

function updateStudySummary(courseMaterials, studying) {
  if (courseMaterials.length === 0) return;
  const selected = courseMaterials.filter(m => studying.has(m.id));
  if (selected.length === 0) {
    studySummary.textContent = 'Nothing selected';
    studySummary.classList.add('muted');
  } else {
    const selectedCourses = Array.from(new Set(selected.map(m => m.course || 'Other')));
    studySummary.textContent = selectedCourses
      .map(c => `${c} · ${selected.filter(m => (m.course || 'Other') === c).map(m => citeName(m.title)).join(', ')}`)
      .join(' | ');
    studySummary.classList.remove('muted');
  }
}

// Only a selection change: update the checkboxes in place so keyboard focus stays put
async function syncStudySelection() {
  const { courseMaterials = [], studyingMaterialIds = [] } =
    await chrome.storage.local.get(['courseMaterials', 'studyingMaterialIds']);
  const studying = new Set(studyingMaterialIds);
  studyList.querySelectorAll('input[type="checkbox"]').forEach(box => {
    box.checked = studying.has(box.dataset.id);
  });
  updateStudySummary(courseMaterials, studying);
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.courseMaterials) {
    renderStudyPicker();
  } else if (changes.studyingMaterialIds) {
    syncStudySelection();
  }
});

// Dismiss Error
btnDismissError.addEventListener('click', () => {
  errorBanner.classList.add('hidden');
  safeSendMessage({ type: 'DISMISS_ERROR' });
});

const EXPANDED_ICON = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 14 10 14 10 20"></polyline><polyline points="20 10 14 10 14 4"></polyline><line x1="14" y1="10" x2="21" y2="3"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>`;
const COLLAPSED_ICON = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" y1="3" x2="14" y2="10"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>`;

function setupExpandToggle(card, button, name) {
  button.addEventListener('click', () => {
    card.classList.toggle('expanded');
    const isExpanded = card.classList.contains('expanded');
    button.title = `${isExpanded ? 'Collapse' : 'Expand'} ${name} Box`;
    button.innerHTML = isExpanded ? EXPANDED_ICON : COLLAPSED_ICON;
  });
}

setupExpandToggle(document.getElementById('questionCard'), document.getElementById('btnToggleQuestionExpand'), 'Question');
setupExpandToggle(document.getElementById('answerCard'), document.getElementById('btnToggleAnswerExpand'), 'Tutor');

// Listen to Background Messages
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'STATUS_CHANGE') {
    applyState(message.state);
  } else if (message.type === 'STREAM_CHUNK') {
    if (message.requestId !== currentRequestId || !currentState) return;
    currentState.status = 'streaming';
    currentState.streamingText = message.accumulated;
    if (!streamingBubble) {
      renderConversation(currentState);
      updateStatusUI(currentState);
    }
    streamingBubble.innerHTML = renderMarkdown(message.accumulated);
    scrollConversationToBottom(true);
  }
});

// Initialize on Load
document.addEventListener('DOMContentLoaded', () => {
  renderStudyPicker();
  safeSendMessage({ type: 'GET_CURRENT_STATE' }, (res) => {
    if (res && res.state) {
      applyState(res.state);
    }
    if (!res || !res.state || !res.state.question) {
      // No question yet: ask the content script on the active tab
      rereadActiveTab();
    }
  });
});
