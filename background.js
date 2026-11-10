/**
 * Question Helper - Background Service Worker (Manifest V3)
 * Runs a tutoring session for the detected question: three steps, one per click
 * (step 3 is the worked answer), plus feedback on the student's own attempts.
 * Supports Google Gemini and Anthropic Claude with SSE streaming.
 */

import { buildMaterialsContext, citeName } from './lib/course-materials.js';

const TUTOR_SYSTEM_PROMPT = `You are a patient, encouraging study tutor. A student is working through a practice problem and wants to learn how to solve it themselves. Your job is to build their understanding, not to hand over answers.

Each student message is tagged with what they want. The student works through the problem in three steps, asking for one step at a time; each step builds on the steps (and any attempts) earlier in this conversation and never repeats them.

[STEP 1 OF 3]
- Start with "**Step 1: <short title>**".
- Name the concept or skill the question is testing and give the first move: what to identify, set up or recall (the relevant definition, formula or rule), and why it applies here. Then stop.
- Do not go further, and do not state the final answer, the correct option letter, or the final value.

[STEP 2 OF 3]
- Start with "**Step 2: <short title>**".
- Carry the reasoning from step 1 through the main work, stopping just before the final answer so that one move is left for the student. For multiple choice, rule out the options that can be ruled out and say why.
- Still do not state the final answer, the correct option letter, or the final value.

[STEP 3 OF 3: ANSWER]
- Start with "**Step 3: Answer**".
- Finish the reasoning from step 2 and give the final answer in bold (for multiple choice, the option letter and its text).
- Then add "**Key takeaway:**" (one sentence) and "**Common mistake:**" (one sentence).

[ATTEMPT]
- If the attempt is correct: confirm it, briefly explain why it works, and name the key idea to remember.
- If it is wrong or incomplete: say so kindly, point to the specific step or misconception that went wrong, and ask a question that helps them fix it. Do not reveal the correct answer unless step 3 has already been given.
- If they gave an answer with no reasoning, you may ask them how they got it.

General rules:
- Keep steps 1 and 2 and feedback on attempts short, about 2-6 sentences. Step 3 may be longer.
- Read the question exactly as given, including negative phrasing (NOT, EXCEPT, LEAST), units, and constraints.
- If an image is attached, read the diagram, plot or figure carefully.
- If the question text looks garbled or incomplete, say what you can see and ask the student to paste or screenshot the full question.
- Use Markdown. Write math inline with $...$ and code in backticks.`;

const TOTAL_STEPS = 3;

const STUDENT_PROMPTS = {
  step: (n) => (n < TOTAL_STEPS
    ? `[STEP ${n} OF ${TOTAL_STEPS}] Could I get step ${n}?`
    : `[STEP ${n} OF ${TOTAL_STEPS}: ANSWER] Please finish it and give me the answer.`),
  attempt: (text) => `[ATTEMPT]\n${text}`
};

const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';
const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-5-5';
// Saved model names from earlier versions that have since been retired
const RETIRED_GEMINI_MODEL = /^gemini-(1\.0|1\.5|2\.0)/;
const RETIRED_ANTHROPIC_MODEL = /^claude-(3|2|instant)/;
// Models that accept server-side refusal fallbacks (fallbacks: "default")
const ANTHROPIC_FALLBACK_MODELS = ['claude-opus-5-5', 'claude-opus-5', 'claude-fable-5-1', 'claude-sonnet-5-5'];

const MAX_GEMINI_MODEL_ATTEMPTS = 4;
const GEMINI_CONNECT_TIMEOUT_MS = 20000;
const MAX_SAVED_SESSIONS = 10;

// Global state
let currentRequestId = 0;
let activeAbortController = null;
let latestState = emptyState();
// Previous page questions' conversations, keyed by question fingerprint, so going back restores them
let savedSessions = {};
let stateLoaded = null;

function emptyState(question = null, prev = null) {
  return {
    question,
    turns: [], // { role: 'student' | 'tutor', kind: 'step' | 'attempt' | 'reply', step, text }
    streamingText: '',
    status: 'idle', // 'idle' | 'thinking' | 'streaming' | 'error'
    error: null,
    model: prev?.model || DEFAULT_GEMINI_MODEL,
    provider: prev?.provider || 'gemini',
    materialsUsed: null, // { label, partial, pagesIncluded, pagesTotal } for the latest request
    requestId: currentRequestId
  };
}

// Configure side panel behavior on installation and drop settings from the old answer-solving mode
chrome.runtime.onInstalled.addListener(() => {
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((err) => {
      console.warn('[QuestionHelper] Could not set panel behavior:', err);
    });
  }
  chrome.storage.local.remove(['systemPrompt', 'autoAnswer', 'answerCache']);
});

/**
 * The service worker is stopped after ~30s idle, which would wipe the conversation.
 * Persist it in chrome.storage.session (memory-backed, cleared when the browser closes).
 */
function ensureStateLoaded() {
  if (!stateLoaded) {
    stateLoaded = chrome.storage.session.get(['tutorState', 'savedSessions']).then((res) => {
      if (res.tutorState) {
        latestState = { ...res.tutorState, status: 'idle', streamingText: '' };
        currentRequestId = latestState.requestId || 0;
      }
      savedSessions = res.savedSessions || {};
    }).catch(() => {});
  }
  return stateLoaded;
}

function persistState() {
  chrome.storage.session.set({ tutorState: latestState, savedSessions }).catch((err) => {
    console.warn('[QuestionHelper] Could not persist session:', err);
  });
}

/**
 * Broadcast event to runtime listeners safely without throwing unhandled rejections
 */
function broadcast(msg) {
  try {
    chrome.runtime.sendMessage(msg, () => {
      if (chrome.runtime.lastError) {
        // Harmless: Side panel or popup might not be open right now
      }
    });
  } catch (_) {}
}

function broadcastState() {
  broadcast({ type: 'STATUS_CHANGE', state: latestState });
}

/**
 * Cancel any ongoing API streaming request
 */
function cancelInFlightRequest() {
  if (activeAbortController) {
    activeAbortController.abort();
    activeAbortController = null;
  }
}

function isBusy() {
  return latestState.status === 'thinking' || latestState.status === 'streaming';
}

// Helper: Filter only text generation models (exclude TTS, audio, image output, embeddings, Gemma)
function isTextGenerationModel(m) {
  const name = (typeof m === 'string' ? m : m.name || '').toLowerCase();
  const excluded = ['tts', 'audio', 'speech', 'embed', 'image', 'realtime', 'live', 'whisper', 'gemma', 'computer-use', 'aqa'];
  if (excluded.some(word => name.includes(word))) {
    return false;
  }
  if (typeof m === 'object') {
    if (m.supportedGenerationMethods && !m.supportedGenerationMethods.includes('generateContent')) {
      return false;
    }
    if (m.supportedResponseModalities && !m.supportedResponseModalities.includes('TEXT')) {
      return false;
    }
  }
  return true;
}

// Cache of verified available models from Google ListModels
let cachedAvailableModels = null;
let lastModelFetchTime = 0;

async function getAvailableGeminiModels(apiKey) {
  if (cachedAvailableModels && (Date.now() - lastModelFetchTime < 300000)) {
    return cachedAvailableModels;
  }
  try {
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models', {
      headers: { 'x-goog-api-key': apiKey }
    });
    if (res.ok) {
      const data = await res.json();
      const models = (data.models || [])
        .filter(isTextGenerationModel)
        .map(m => m.name.replace(/^models\//, ''))
        .sort((a, b) => {
          const aTop = a === DEFAULT_GEMINI_MODEL || (a.includes('flash') && !a.includes('preview') && !a.includes('exp'));
          const bTop = b === DEFAULT_GEMINI_MODEL || (b.includes('flash') && !b.includes('preview') && !b.includes('exp'));
          if (aTop && !bTop) return -1;
          if (!aTop && bTop) return 1;
          return a.localeCompare(b);
        });

      if (models.length > 0) {
        cachedAvailableModels = models;
        lastModelFetchTime = Date.now();
        chrome.storage.local.set({ verifiedGeminiModels: models });
        return models;
      }
    }
  } catch (err) {
    console.warn('[QuestionHelper] Could not fetch model list from Google:', err);
  }
  return cachedAvailableModels || [DEFAULT_GEMINI_MODEL];
}

/**
 * Helper: Convert Uint8Array to base64 safely in chunks
 */
function uint8ArrayToBase64(bytes) {
  let binary = '';
  const len = bytes.byteLength;
  const chunkSize = 8192;
  for (let i = 0; i < len; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, len));
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}

/**
 * Helper: Fetch an image URL and convert to base64 using extension privileges
 */
async function fetchImageAsBase64(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    const mimeType = blob.type || 'image/jpeg';
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const data = uint8ArrayToBase64(bytes);
    return { mimeType, data };
  } catch (err) {
    console.warn('[QuestionHelper] Could not fetch image as base64:', err);
    return null;
  }
}

async function captureTabScreenshot() {
  const screenshotDataUrl = await chrome.tabs.captureVisibleTab(null, {
    format: 'jpeg',
    quality: 85
  });
  return {
    mimeType: 'image/jpeg',
    data: screenshotDataUrl.replace(/^data:image\/[a-z]+;base64,/, ''),
    description: 'Page Screenshot',
    type: 'screenshot'
  };
}

/**
 * Collect all images for a question as base64. Fetched data is stored back on the
 * question so later turns in the conversation reuse it.
 */
async function collectQuestionImages(questionData) {
  if (!questionData.images) questionData.images = [];

  // Visual media detected on the page but none extracted (canvas, iframe, etc.): fall back to a screenshot
  if (questionData.hasVisualMedia && questionData.images.length === 0) {
    try {
      questionData.images.push(await captureTabScreenshot());
    } catch (e) {
      console.warn('[QuestionHelper] Could not capture tab screenshot:', e);
    }
  }

  const images = [];
  for (const img of questionData.images) {
    if (!img.data && img.src) {
      const fetched = await fetchImageAsBase64(img.src);
      if (fetched) {
        img.data = fetched.data;
        img.mimeType = fetched.mimeType;
      }
    }
    if (img.data) {
      images.push({
        mimeType: img.mimeType || 'image/jpeg',
        data: img.data,
        description: img.description || 'Question Image'
      });
    }
  }
  return images;
}

/**
 * Describe the problem for the first message of the conversation
 */
function buildQuestionContext(questionData, hasImages) {
  let text = "Here is the practice problem I'm working on.\n\n";
  if (hasImages) {
    text += 'The attached image(s) are part of the problem.\n\n';
  }
  if (questionData.questionText) {
    text += `Question:\n${questionData.questionText}\n\n`;
  }
  if (questionData.options && questionData.options.length > 0) {
    text += `Choices:\n${questionData.options.join('\n')}\n\n`;
  }
  if (questionData.blankInputs && questionData.blankInputs.length > 0) {
    text += 'Answer fields:\n';
    questionData.blankInputs.forEach((b, idx) => {
      const parts = [];
      if (b.name) parts.push(`name "${b.name}"`);
      if (b.label) parts.push(`label "${b.label}"`);
      if (b.suffix) parts.push(`units "${b.suffix}"`);
      text += `  - Field ${idx + 1}: ${parts.join(', ') || 'free response'}\n`;
    });
    text += '\n';
  }
  return text;
}

/**
 * Convert the session's turns into a provider-neutral message list.
 * The question (and any images) are attached to the first student message.
 */
function buildConversation(turns, questionData, images) {
  const context = buildQuestionContext(questionData, images.length > 0);
  return turns.map((turn, idx) => ({
    role: turn.role === 'student' ? 'user' : 'assistant',
    text: idx === 0 ? `${context}${turn.apiText}` : turn.apiText,
    images: idx === 0 ? images : []
  }));
}

async function readSSE(response, onData) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data: ')) continue;
      const dataStr = trimmed.slice(6);
      if (dataStr === '[DONE]') continue;

      let dataObj;
      try {
        dataObj = JSON.parse(dataStr);
      } catch (_) {
        continue;
      }
      onData(dataObj);
    }
  }
}

function emitChunk(requestId, accumulated) {
  if (currentRequestId !== requestId) return;
  latestState.streamingText = accumulated;
  broadcast({
    type: 'STREAM_CHUNK',
    requestId: requestId,
    accumulated: accumulated
  });
}

function markStreaming(requestId) {
  if (currentRequestId !== requestId) return;
  latestState.status = 'streaming';
  broadcastState();
}

/**
 * Stream a tutor reply from Google Gemini
 */
async function streamGemini(apiKey, model, systemParts, conversation, controller, requestId, onConnected) {
  const contents = conversation.map(msg => ({
    role: msg.role === 'assistant' ? 'model' : 'user',
    parts: [
      ...msg.images.map(img => ({ inlineData: { mimeType: img.mimeType, data: img.data } })),
      { text: msg.text }
    ]
  }));

  const payload = {
    // Course materials come last and stay identical between requests, so Gemini's implicit caching can reuse them
    systemInstruction: {
      parts: systemParts.map(text => ({ text }))
    },
    contents,
    generationConfig: {
      temperature: 0.3,
      // Gemini 2.5 thinking tokens count against this limit, so leave plenty of room
      maxOutputTokens: 8192
    }
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;

  // Retry up to 3 times on transient 503 High Demand spikes
  let response = null;
  let attempts = 0;
  const maxAttempts = 3;

  while (attempts < maxAttempts) {
    attempts++;
    if (controller.signal.aborted) break;

    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    if (response.status === 503 && attempts < maxAttempts) {
      console.warn(`[QuestionHelper] ${model} returned 503 (high demand spike). Retrying attempt ${attempts}/${maxAttempts} in 1.5s...`);
      await new Promise(r => setTimeout(r, 1500));
      continue;
    }
    break;
  }

  if (!response.ok) {
    const errText = await response.text();
    let msg = '';
    try {
      const jsonErr = JSON.parse(errText);
      msg = jsonErr.error?.message || errText;
    } catch (_) {
      msg = errText;
    }

    const err = new Error(`Gemini API Error (${response.status}): ${msg}`);
    err.status = response.status;
    if (response.status === 400 && msg.includes('API_KEY_INVALID')) {
      err.message = 'Invalid Gemini API Key. Please verify your key in Settings.';
      err.fatal = true;
    } else if (response.status === 503) {
      err.message = 'Gemini model is currently experiencing high demand (503).';
    } else if (response.status === 429) {
      err.message = 'Gemini rate limit reached (429). Wait a minute and try again.';
    }
    throw err;
  }

  onConnected();
  markStreaming(requestId);

  let accumulated = '';
  let finishReason = null;
  let usage = null;
  await readSSE(response, (dataObj) => {
    if (dataObj.usageMetadata) usage = dataObj.usageMetadata;
    const candidate = dataObj.candidates?.[0];
    if (candidate?.finishReason) finishReason = candidate.finishReason;
    const chunkText = (candidate?.content?.parts || [])
      .filter(p => p.text && !p.thought)
      .map(p => p.text)
      .join('');
    if (chunkText) {
      accumulated += chunkText;
      emitChunk(requestId, accumulated);
    }
  });

  if (usage) {
    console.log(`[QuestionHelper] ${model} usage: ${usage.promptTokenCount ?? '?'} prompt tokens (${usage.cachedContentTokenCount ?? 0} cached), ${usage.candidatesTokenCount ?? '?'} reply tokens`);
  }

  if (!accumulated.trim()) {
    const err = new Error(finishReason === 'SAFETY'
      ? 'Gemini declined to respond to this question.'
      : `Gemini returned an empty response${finishReason ? ` (${finishReason})` : ''}. Try again.`);
    err.streamStarted = true;
    throw err;
  }
  return accumulated;
}

/**
 * Gemini with ListModels discovery and a fallback cascade for unavailable or overloaded models.
 * Fallback only happens before a reply starts streaming; a reply is never spliced across models.
 */
async function solveGeminiWithFallback(apiKey, primaryModel, systemParts, conversation, controller, requestId) {
  const verifiedModels = await getAvailableGeminiModels(apiKey);

  const fallbackChain = [
    primaryModel,
    DEFAULT_GEMINI_MODEL,
    ...verifiedModels,
    'gemini-2.5-flash-lite'
  ].filter(Boolean).filter(isTextGenerationModel);

  const uniqueModels = Array.from(new Set(fallbackChain)).slice(0, MAX_GEMINI_MODEL_ATTEMPTS);
  let lastError = null;

  for (let i = 0; i < uniqueModels.length; i++) {
    const currentModel = uniqueModels[i];
    if (controller.signal.aborted || currentRequestId !== requestId) return '';

    if (i > 0) {
      latestState.model = currentModel;
      latestState.status = 'thinking';
      broadcastState();
    }

    // Time out only the connection phase; once the reply streams, let it finish
    const attemptController = new AbortController();
    const onParentAbort = () => attemptController.abort();
    controller.signal.addEventListener('abort', onParentAbort);
    const connectTimeout = setTimeout(() => attemptController.abort(), GEMINI_CONNECT_TIMEOUT_MS);
    let streamStarted = false;

    try {
      return await streamGemini(apiKey, currentModel, systemParts, conversation, attemptController, requestId, () => {
        streamStarted = true;
        clearTimeout(connectTimeout);
      });
    } catch (attemptErr) {
      if (controller.signal.aborted || currentRequestId !== requestId) return '';
      if (streamStarted || attemptErr.streamStarted || attemptErr.fatal) throw attemptErr;

      lastError = attemptErr.name === 'AbortError'
        ? new Error(`${currentModel} did not respond within ${GEMINI_CONNECT_TIMEOUT_MS / 1000}s.`)
        : attemptErr;
      const isRecoverableError =
        attemptErr.name === 'AbortError' ||
        [404, 429, 500, 503].includes(attemptErr.status) ||
        /not found|high demand|modalit|not supported/i.test(attemptErr.message);

      if (!isRecoverableError) throw attemptErr;
      if (i < uniqueModels.length - 1) {
        console.warn(`[QuestionHelper] Model ${currentModel} failed (${lastError.message}), trying ${uniqueModels[i + 1]}...`);
      }
    } finally {
      clearTimeout(connectTimeout);
      controller.signal.removeEventListener('abort', onParentAbort);
    }
  }

  throw lastError || new Error('Gemini servers are currently experiencing high demand. Please try again in a few moments.');
}

/**
 * Stream a tutor reply from Anthropic Claude
 */
async function streamAnthropic(apiKey, model, systemParts, conversation, controller, requestId) {
  const messages = conversation.map(msg => ({
    role: msg.role,
    content: [
      ...msg.images.map(img => ({
        type: 'image',
        source: { type: 'base64', media_type: img.mimeType || 'image/jpeg', data: img.data }
      })),
      { type: 'text', text: msg.text }
    ]
  }));

  const headers = {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2026-10-21',
    'anthropic-dangerous-direct-browser-access': 'true'
  };
  const payload = {
    model: model,
    max_tokens: 16000,
    stream: true,
    system: systemParts.length === 1
      ? systemParts[0]
      // Cache the tutor rules + course materials. Students often take more than 5 minutes
      // between steps, so use the 1-hour cache rather than the 5-minute default.
      : systemParts.map((text, idx) => (idx === systemParts.length - 1
        ? { type: 'text', text, cache_control: { type: 'ephemeral', ttl: '1h' } }
        : { type: 'text', text })),
    messages
  };
  // If a safety classifier declines, retry on Anthropic's recommended fallback model server-side
  if (ANTHROPIC_FALLBACK_MODELS.includes(model)) {
    headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
    payload.fallbacks = 'default';
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    signal: controller.signal
  });

  if (!response.ok) {
    const errText = await response.text();
    let msg = '';
    try {
      const jsonErr = JSON.parse(errText);
      msg = jsonErr.error?.message || errText;
    } catch (_) {
      msg = errText;
    }

    if (response.status === 401) {
      throw new Error('Invalid Anthropic API Key. Please verify your key in Settings.');
    } else if (response.status === 404) {
      throw new Error(`Claude model "${model}" was not found. Pick a current model in Settings.`);
    } else if (response.status === 429) {
      throw new Error('Anthropic API rate limit reached. Please wait a moment and try again.');
    } else {
      throw new Error(`Anthropic API Error (${response.status}): ${msg}`);
    }
  }

  markStreaming(requestId);

  let accumulated = '';
  let stopReason = null;
  let streamError = null;
  await readSSE(response, (dataObj) => {
    if (dataObj.type === 'message_start' && dataObj.message?.usage) {
      const u = dataObj.message.usage;
      console.log(`[QuestionHelper] ${model} input: ${u.input_tokens} uncached, ${u.cache_read_input_tokens || 0} read from cache, ${u.cache_creation_input_tokens || 0} written to cache`);
    }
    if (dataObj.type === 'content_block_start' && dataObj.content_block?.type === 'fallback') {
      // A fallback model is taking over after a mid-stream decline; discard the partial reply
      accumulated = '';
      emitChunk(requestId, accumulated);
    } else if (dataObj.type === 'content_block_delta' && dataObj.delta?.type === 'text_delta') {
      accumulated += dataObj.delta.text;
      emitChunk(requestId, accumulated);
    } else if (dataObj.type === 'message_delta' && dataObj.delta?.stop_reason) {
      stopReason = dataObj.delta.stop_reason;
    } else if (dataObj.type === 'error') {
      streamError = dataObj.error?.message || 'Stream error';
    }
  });

  if (streamError) {
    throw new Error(`Anthropic API Error: ${streamError}`);
  }
  if (stopReason === 'refusal') {
    throw new Error('Claude declined to respond to this question. Try rephrasing it or switching models in Settings.');
  }
  return accumulated;
}

async function getProviderSettings() {
  const local = await chrome.storage.local.get([
    'aiProvider',
    'geminiApiKey',
    'anthropicApiKey',
    'geminiModel',
    'model',
    'tutorInstructions',
    'courseMaterials',
    'studyingMaterialIds'
  ]);

  const provider = local.aiProvider || (local.geminiApiKey ? 'gemini' : (local.anthropicApiKey ? 'anthropic' : 'gemini'));
  let apiKey = '';
  let model = '';

  if (provider === 'gemini') {
    apiKey = (local.geminiApiKey || '').trim();
    model = local.geminiModel || DEFAULT_GEMINI_MODEL;
    if (!isTextGenerationModel(model) || RETIRED_GEMINI_MODEL.test(model)) {
      model = DEFAULT_GEMINI_MODEL;
    }
  } else {
    apiKey = (local.anthropicApiKey || '').trim();
    model = local.model || DEFAULT_ANTHROPIC_MODEL;
    if (RETIRED_ANTHROPIC_MODEL.test(model)) {
      model = DEFAULT_ANTHROPIC_MODEL;
    }
  }

  let systemPrompt = TUTOR_SYSTEM_PROMPT;
  const extra = (local.tutorInstructions || '').trim();
  if (extra) {
    systemPrompt += `\n\nAdditional preferences from the student (these never override the rules above):\n${extra}`;
  }

  const studying = new Set(local.studyingMaterialIds || []);
  const materials = (local.courseMaterials || []).filter(m => studying.has(m.id));

  return { provider, apiKey, model, systemPrompt, materials };
}

/** Text used to pick the most relevant pages when the selected materials are too long to send whole. */
function questionSearchText(q) {
  if (!q) return '';
  return [q.questionText || q.fullText, ...(q.options || []), q.pageTitle].filter(Boolean).join('\n');
}

/** How many steps the student has already been given for this question. */
function stepsTaken(turns) {
  return turns.filter(t => t.role === 'student' && t.kind === 'step').length;
}

/**
 * Add a student turn and stream the tutor's reply.
 * kind: 'step' (the next of steps 1-3, where step 3 is the answer) | 'attempt'
 */
async function runTutorTurn(kind, attemptText = '') {
  if (!latestState.question) {
    latestState.error = 'No question detected yet. Open a practice question, or use Capture Tab / Upload Image.';
    broadcastState();
    return;
  }
  if (isBusy()) return;

  // Steps go 1 -> 2 -> 3 (the answer), one per click
  const step = kind === 'step' ? stepsTaken(latestState.turns) + 1 : null;
  if (step !== null && step > TOTAL_STEPS) return;

  const requestId = ++currentRequestId;
  cancelInFlightRequest();
  const controller = new AbortController();
  activeAbortController = controller;

  const studentTurn = {
    role: 'student',
    kind,
    step,
    text: kind === 'attempt' ? attemptText : '',
    apiText: kind === 'attempt' ? STUDENT_PROMPTS.attempt(attemptText) : STUDENT_PROMPTS.step(step)
  };
  latestState.turns.push(studentTurn);
  Object.assign(latestState, { status: 'thinking', error: null, streamingText: '', requestId });

  const settings = await getProviderSettings();
  if (currentRequestId !== requestId) return;
  latestState.model = settings.model;
  latestState.provider = settings.provider;
  broadcastState();

  const undoStudentTurn = () => {
    const idx = latestState.turns.lastIndexOf(studentTurn);
    if (idx !== -1) latestState.turns.splice(idx, 1);
  };

  if (!settings.apiKey) {
    undoStudentTurn();
    latestState.status = 'error';
    latestState.error = settings.provider === 'gemini'
      ? 'Gemini API Key is missing. Click Settings (⚙) to add your free key from Google AI Studio (aistudio.google.com).'
      : 'Anthropic API Key is missing. Click Settings (⚙) to configure your key.';
    broadcastState();
    return;
  }

  try {
    const images = await collectQuestionImages(latestState.question);
    const conversation = buildConversation(latestState.turns, latestState.question, images);

    const materials = buildMaterialsContext(settings.materials, questionSearchText(latestState.question));
    const systemParts = materials ? [settings.systemPrompt, materials.text] : [settings.systemPrompt];
    latestState.materialsUsed = materials
      ? {
          label: materials.titles.map(citeName).join(', ') + (materials.partial ? ' (relevant pages)' : ''),
          partial: materials.partial,
          pagesIncluded: materials.pagesIncluded,
          pagesTotal: materials.pagesTotal
        }
      : null;
    broadcastState();

    const reply = settings.provider === 'gemini'
      ? await solveGeminiWithFallback(settings.apiKey, settings.model, systemParts, conversation, controller, requestId)
      : await streamAnthropic(settings.apiKey, settings.model, systemParts, conversation, controller, requestId);

    if (currentRequestId !== requestId) return;
    if (controller.signal.aborted) {
      // The Gemini cascade returns '' when cancelled; handle it like any other abort below
      throw Object.assign(new Error('Request cancelled'), { name: 'AbortError' });
    }

    latestState.turns.push({ role: 'tutor', kind: 'reply', text: reply, apiText: reply });
    latestState.status = 'idle';
    latestState.streamingText = '';
    broadcastState();
    persistState();
  } catch (err) {
    if (currentRequestId !== requestId) return;
    undoStudentTurn();
    latestState.streamingText = '';
    if (err.name === 'AbortError' || controller.signal.aborted) {
      latestState.status = 'idle';
    } else {
      latestState.status = 'error';
      latestState.error = err.message || 'An error occurred while contacting the tutor.';
    }
    broadcastState();
  } finally {
    if (activeAbortController === controller) {
      activeAbortController = null;
    }
  }
}

/**
 * Compute normalized question fingerprint invariant to option selection,
 * input values, score badges, or submission status.
 */
function getQuestionFingerprint(q) {
  if (!q) return '';

  let stem = (q.questionText || q.fullText || '').trim().toLowerCase();
  stem = stem
    .replace(/\[input[^\]]*\]/gi, '[blank]')
    .replace(/\[blank[^\]]*\]/gi, '[blank]')
    .replace(/^(question\s*\d+[\.\:\-]?\s*|q\d+[\.\:\-]?\s*|\d+[\.\)\:\-]\s*)/i, '')
    .replace(/\(\s*\d+(\.\d+)?\s*(pts?|points?|marks?)\s*\)/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  let opts = '';
  if (q.options && q.options.length > 0) {
    opts = q.options.map(opt => {
      return opt
        .toLowerCase()
        .replace(/^([a-h1-9][\.\)\:\-]\s*|\([a-h1-9]\)\s*)/, '')
        .replace(/\(?\b(selected|checked|correct|incorrect|saved|chosen)\b\)?/gi, '')
        .replace(/[✓✔✗✘✓✔✗✘]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    }).sort().join('|');
  }

  let imgSig = '';
  if (q.images && q.images.length > 0) {
    imgSig = q.images.map(i => i.description || i.type || 'img').sort().join('|');
  }

  const stemSnippet = stem.slice(0, 140);
  return `${stemSnippet}:::${opts}:::${imgSig}`;
}

function isSameQuestion(q1, q2) {
  if (!q1 || !q2) return false;
  const fp1 = getQuestionFingerprint(q1);
  const fp2 = getQuestionFingerprint(q2);
  if (!fp1 || !fp2) return false;
  return fp1 === fp2;
}

/**
 * Switch to a new question. Page questions' conversations are kept so that
 * navigating back to a question restores where the student left off.
 */
function switchToQuestion(question) {
  cancelInFlightRequest();
  currentRequestId++;

  const prev = latestState;
  if (prev.question && prev.question.source !== 'image' && prev.turns.length > 0) {
    // Drop downloaded image bytes that can be re-fetched, to stay within session storage limits
    const slimQuestion = {
      ...prev.question,
      images: (prev.question.images || [])
        .filter(img => img.type !== 'screenshot')
        .map(img => (img.src ? { ...img, data: undefined } : img))
    };
    const fp = getQuestionFingerprint(prev.question);
    delete savedSessions[fp];
    // An interrupted request can leave a student turn without a reply; drop it so turns keep alternating
    const turns = prev.turns[prev.turns.length - 1]?.role === 'student' ? prev.turns.slice(0, -1) : prev.turns;
    savedSessions[fp] = { question: slimQuestion, turns };
    const keys = Object.keys(savedSessions);
    if (keys.length > MAX_SAVED_SESSIONS) {
      delete savedSessions[keys[0]];
    }
  }

  const saved = question.source !== 'image' ? savedSessions[getQuestionFingerprint(question)] : null;
  latestState = emptyState(question, prev);
  latestState.requestId = currentRequestId;
  if (saved) {
    latestState.turns = saved.turns;
  }
  broadcastState();
  persistState();
}

function resetConversation() {
  cancelInFlightRequest();
  currentRequestId++;
  if (latestState.question) {
    delete savedSessions[getQuestionFingerprint(latestState.question)];
  }
  latestState = emptyState(latestState.question, latestState);
  latestState.requestId = currentRequestId;
  broadcastState();
  persistState();
}

function requestQuestionFromActiveTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]?.id) return resolve(null);
      chrome.tabs.sendMessage(tabs[0].id, { type: 'GET_CURRENT_QUESTION' }, (res) => {
        if (chrome.runtime.lastError) return resolve(null);
        resolve(res && res.data ? res.data : null);
      });
    });
  });
}

async function startNextStep() {
  if (!latestState.question) {
    const question = await requestQuestionFromActiveTab();
    if (question) switchToQuestion(question);
  }
  runTutorTurn('step');
}

function imageQuestion(image, label) {
  return {
    questionText: '',
    options: [],
    fullText: `[Image question: ${label}]`,
    images: [image],
    hasVisualMedia: true,
    source: 'image',
    selectorUsed: label
  };
}

async function handleMessage(message, sendResponse) {
  await ensureStateLoaded();

  switch (message.type) {
    case 'QUESTION_DETECTED': {
      // picked: the student chose this question on the page, so it stays until they unpin it
      const qData = { ...message.data, picked: !!message.picked };
      // Keep an image/screenshot question until the student explicitly re-reads the page
      const pinnedImageQuestion = latestState.question?.source === 'image' && !message.forced;
      if (pinnedImageQuestion) {
        sendResponse({ received: true, preserved: true });
      } else if (isSameQuestion(qData, latestState.question)) {
        // Same question (e.g. a choice was selected or the page reloaded): keep the conversation
        latestState.question = { ...qData, images: latestState.question.images?.length ? latestState.question.images : qData.images };
        broadcastState();
        sendResponse({ received: true, preserved: true });
      } else {
        switchToQuestion(qData);
        sendResponse({ received: true });
      }
      return;
    }

    case 'TUTOR_NEXT_STEP':
      startNextStep();
      sendResponse({ status: 'started' });
      return;

    case 'TUTOR_ATTEMPT': {
      const text = (message.text || '').trim();
      if (text) runTutorTurn('attempt', text);
      sendResponse({ status: text ? 'started' : 'empty' });
      return;
    }

    case 'TUTOR_RESET':
      resetConversation();
      sendResponse({ status: 'reset' });
      return;

    case 'CAPTURE_TAB': {
      try {
        const screenshot = await captureTabScreenshot();
        switchToQuestion(imageQuestion(screenshot, 'Tab Screenshot'));
        sendResponse({ status: 'captured' });
      } catch (err) {
        latestState.error = `Could not capture the tab: ${err.message}`;
        broadcastState();
        sendResponse({ status: 'error' });
      }
      return;
    }

    case 'LOAD_IMAGE_QUESTION': {
      const { dataUrl, description } = message;
      const mimeMatch = dataUrl.match(/^data:([^;]+);/);
      const image = {
        mimeType: mimeMatch ? mimeMatch[1] : 'image/jpeg',
        data: dataUrl.split(',')[1],
        description: description || 'Uploaded Image',
        type: 'upload'
      };
      switchToQuestion(imageQuestion(image, description || 'Uploaded Image'));
      sendResponse({ status: 'loaded' });
      return;
    }

    case 'CANCEL_SOLVE':
      cancelInFlightRequest();
      sendResponse({ status: 'cancelled' });
      return;

    case 'DISMISS_ERROR':
      latestState.error = null;
      if (latestState.status === 'error') latestState.status = 'idle';
      sendResponse({ status: 'ok' });
      return;

    case 'GET_CURRENT_STATE':
      sendResponse({ state: latestState });
      return;

    case 'NO_QUESTION_FOUND':
      if (latestState.question?.source !== 'image' && !isBusy()) {
        latestState.error = 'No question found on this page. Try Capture Tab, upload an image, or add a CSS selector in Settings.';
        broadcastState();
      }
      sendResponse({ received: true });
      return;

    default:
      sendResponse(undefined);
  }
}

// --- Message Router ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sendResponse).catch((err) => {
    console.warn('[QuestionHelper] Message handling error:', err);
    sendResponse({ error: err.message });
  });
  return true;
});

// Keyboard Commands Handler
chrome.commands.onCommand.addListener(async (command, tab) => {
  if (!tab) return;

  // Open synchronously: sidePanel.open() must run within the shortcut's user gesture
  if (chrome.sidePanel && chrome.sidePanel.open) {
    chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
  }
  if (command === 'get_hint') {
    await ensureStateLoaded();
    startNextStep();
  }
});
