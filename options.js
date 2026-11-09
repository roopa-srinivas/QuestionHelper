/**
 * Question Helper - Settings / Options Script
 * Supports Google Gemini API (Free tier) and Anthropic Claude API.
 * Handles API keys in chrome.storage.local, models, custom site selectors, and test calls.
 */

const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';
const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-5-5';

// DOM Elements
const btnProviderGemini = document.getElementById('btnProviderGemini');
const btnProviderAnthropic = document.getElementById('btnProviderAnthropic');
const geminiConfigSection = document.getElementById('geminiConfigSection');
const anthropicConfigSection = document.getElementById('anthropicConfigSection');

// Gemini Elements
const geminiApiKeyInput = document.getElementById('geminiApiKeyInput');
const btnToggleGeminiKey = document.getElementById('btnToggleGeminiKey');
const btnTestGeminiKey = document.getElementById('btnTestGeminiKey');
const geminiValidationResult = document.getElementById('geminiValidationResult');
const geminiModelSelect = document.getElementById('geminiModelSelect');
const geminiCustomModelGroup = document.getElementById('geminiCustomModelGroup');
const geminiCustomModelInput = document.getElementById('geminiCustomModelInput');

// Anthropic Elements
const anthropicApiKeyInput = document.getElementById('anthropicApiKeyInput');
const btnToggleAnthropicKey = document.getElementById('btnToggleAnthropicKey');
const btnTestAnthropicKey = document.getElementById('btnTestAnthropicKey');
const anthropicValidationResult = document.getElementById('anthropicValidationResult');
const anthropicModelSelect = document.getElementById('anthropicModelSelect');
const anthropicCustomModelGroup = document.getElementById('anthropicCustomModelGroup');
const anthropicCustomModelInput = document.getElementById('anthropicCustomModelInput');

// Common Elements
const tutorInstructionsInput = document.getElementById('tutorInstructionsInput');

const newSiteHostname = document.getElementById('newSiteHostname');
const newSiteSelector = document.getElementById('newSiteSelector');
const btnAddSite = document.getElementById('btnAddSite');
const selectorsTableBody = document.getElementById('selectorsTableBody');

const btnSaveSettings = document.getElementById('btnSaveSettings');
const toastMessage = document.getElementById('toastMessage');
const toastText = document.getElementById('toastText');

let currentProvider = 'gemini';
let currentSiteSelectors = {};

function showToast(text, duration = 3000) {
  toastText.textContent = text;
  toastMessage.classList.remove('hidden');
  setTimeout(() => {
    toastMessage.classList.add('hidden');
  }, duration);
}

function setProvider(provider) {
  currentProvider = provider;
  if (provider === 'gemini') {
    btnProviderGemini.classList.add('active');
    btnProviderAnthropic.classList.remove('active');
    geminiConfigSection.classList.remove('hidden');
    anthropicConfigSection.classList.add('hidden');
  } else {
    btnProviderAnthropic.classList.add('active');
    btnProviderGemini.classList.remove('active');
    anthropicConfigSection.classList.remove('hidden');
    geminiConfigSection.classList.add('hidden');
  }
}

function escapeHtml(str) {
  return str.replace(/[&<>'"]/g, 
    tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag));
}

function renderSelectorsTable() {
  selectorsTableBody.innerHTML = '';
  const entries = Object.entries(currentSiteSelectors);

  if (entries.length === 0) {
    const tr = document.createElement('tr');
    tr.className = 'empty-row';
    tr.innerHTML = `<td colspan="3">No custom site selectors configured yet. Built-in heuristics & PrairieLearn rules are used everywhere.</td>`;
    selectorsTableBody.appendChild(tr);
    return;
  }

  entries.forEach(([hostname, selector]) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${escapeHtml(hostname)}</strong></td>
      <td><code>${escapeHtml(selector)}</code></td>
      <td style="text-align: right;">
        <button type="button" class="btn-delete-rule" data-hostname="${escapeHtml(hostname)}">Remove</button>
      </td>
    `;
    selectorsTableBody.appendChild(tr);
  });

  selectorsTableBody.querySelectorAll('.btn-delete-rule').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const host = e.currentTarget.getAttribute('data-hostname');
      delete currentSiteSelectors[host];
      chrome.storage.sync.set({ siteSelectors: currentSiteSelectors }, () => {
        renderSelectorsTable();
        showToast(`Removed selector rule for ${host}`);
      });
    });
  });
}

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

function populateGeminiModels(models, selectedValue) {
  const cleanModels = (models || []).filter(isTextGenerationModel);
  if (cleanModels.length === 0) return;
  geminiModelSelect.innerHTML = '';
  cleanModels.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m;
    const desc = m.includes('flash') ? ' (Fast / Free Tier)' : ' (Reasoning / Pro)';
    opt.textContent = `${m}${desc}`;
    geminiModelSelect.appendChild(opt);
  });
  const customOpt = document.createElement('option');
  customOpt.value = 'custom';
  customOpt.textContent = 'Other / Custom Gemini Model Name...';
  geminiModelSelect.appendChild(customOpt);

  if (selectedValue && cleanModels.includes(selectedValue) && isTextGenerationModel(selectedValue)) {
    geminiModelSelect.value = selectedValue;
  } else {
    const flashModel = cleanModels.find(m => m.includes('flash') && !m.includes('preview')) || cleanModels[0];
    geminiModelSelect.value = flashModel;
  }
}

async function loadSettings() {
  const localData = await chrome.storage.local.get([
    'aiProvider',
    'geminiApiKey',
    'anthropicApiKey',
    'geminiModel',
    'geminiCustomModel',
    'verifiedGeminiModels',
    'model',
    'customModel',
    'tutorInstructions'
  ]);

  // Provider
  const provider = localData.aiProvider || (localData.geminiApiKey ? 'gemini' : (localData.anthropicApiKey ? 'anthropic' : 'gemini'));
  setProvider(provider);

  // Gemini settings
  if (localData.geminiApiKey) {
    geminiApiKeyInput.value = localData.geminiApiKey;
  }

  if (localData.verifiedGeminiModels && localData.verifiedGeminiModels.length > 0) {
    populateGeminiModels(localData.verifiedGeminiModels, localData.geminiModel);
  } else {
    let gModel = localData.geminiModel || DEFAULT_GEMINI_MODEL;
    if (/^gemini-(1\.0|1\.5|2\.0)/.test(gModel)) {
      // Retired model saved by an earlier version
      gModel = DEFAULT_GEMINI_MODEL;
    }
    const knownGModels = Array.from(geminiModelSelect.options).map(o => o.value);
    if (knownGModels.includes(gModel)) {
      geminiModelSelect.value = gModel;
      geminiCustomModelGroup.classList.add('hidden');
    } else {
      geminiModelSelect.value = 'custom';
      geminiCustomModelGroup.classList.remove('hidden');
      geminiCustomModelInput.value = gModel;
    }
  }

  // Anthropic settings
  if (localData.anthropicApiKey) {
    anthropicApiKeyInput.value = localData.anthropicApiKey;
  }
  let aModel = localData.model || DEFAULT_ANTHROPIC_MODEL;
  if (/^claude-(3|2|instant)/.test(aModel)) {
    // Retired model saved by an earlier version
    aModel = DEFAULT_ANTHROPIC_MODEL;
  }
  const knownAModels = Array.from(anthropicModelSelect.options).map(o => o.value);
  if (knownAModels.includes(aModel)) {
    anthropicModelSelect.value = aModel;
    anthropicCustomModelGroup.classList.add('hidden');
  } else {
    anthropicModelSelect.value = 'custom';
    anthropicCustomModelGroup.classList.remove('hidden');
    anthropicCustomModelInput.value = aModel;
  }

  // Tutor preferences
  tutorInstructionsInput.value = localData.tutorInstructions || '';

  // Site selectors
  const syncData = await chrome.storage.sync.get('siteSelectors');
  currentSiteSelectors = syncData.siteSelectors || {};
  renderSelectorsTable();
}

async function saveAllSettings() {
  const gKey = geminiApiKeyInput.value.trim();
  let gModel = geminiModelSelect.value;
  if (gModel === 'custom') {
    gModel = geminiCustomModelInput.value.trim() || DEFAULT_GEMINI_MODEL;
  }

  const aKey = anthropicApiKeyInput.value.trim();
  let aModel = anthropicModelSelect.value;
  if (aModel === 'custom') {
    aModel = anthropicCustomModelInput.value.trim() || DEFAULT_ANTHROPIC_MODEL;
  }

  const tutorInstructions = tutorInstructionsInput.value.trim();

  await chrome.storage.local.set({
    aiProvider: currentProvider,
    geminiApiKey: gKey,
    geminiModel: gModel,
    anthropicApiKey: aKey,
    model: aModel,
    tutorInstructions
  });

  await chrome.storage.sync.set({
    siteSelectors: currentSiteSelectors
  });

  showToast('Settings saved successfully!');
}

// --- Event Handlers ---

btnProviderGemini.addEventListener('click', () => setProvider('gemini'));
btnProviderAnthropic.addEventListener('click', () => setProvider('anthropic'));

// Toggle passwords
btnToggleGeminiKey.addEventListener('click', () => {
  geminiApiKeyInput.type = geminiApiKeyInput.type === 'password' ? 'text' : 'password';
  btnToggleGeminiKey.textContent = geminiApiKeyInput.type === 'password' ? 'Show' : 'Hide';
});

btnToggleAnthropicKey.addEventListener('click', () => {
  anthropicApiKeyInput.type = anthropicApiKeyInput.type === 'password' ? 'text' : 'password';
  btnToggleAnthropicKey.textContent = anthropicApiKeyInput.type === 'password' ? 'Show' : 'Hide';
});

// Model select listeners
geminiModelSelect.addEventListener('change', () => {
  if (geminiModelSelect.value === 'custom') {
    geminiCustomModelGroup.classList.remove('hidden');
    geminiCustomModelInput.focus();
  } else {
    geminiCustomModelGroup.classList.add('hidden');
  }
});

anthropicModelSelect.addEventListener('change', () => {
  if (anthropicModelSelect.value === 'custom') {
    anthropicCustomModelGroup.classList.remove('hidden');
    anthropicCustomModelInput.focus();
  } else {
    anthropicCustomModelGroup.classList.add('hidden');
  }
});

// Test Gemini Key
btnTestGeminiKey.addEventListener('click', async () => {
  const key = geminiApiKeyInput.value.trim();
  if (!key) {
    geminiValidationResult.className = 'validation-result error';
    geminiValidationResult.textContent = 'Please enter a Gemini API key first.';
    geminiValidationResult.classList.remove('hidden');
    return;
  }

  geminiValidationResult.className = 'validation-result';
  geminiValidationResult.textContent = 'Testing connection with Google Gemini API...';
  geminiValidationResult.classList.remove('hidden');
  btnTestGeminiKey.disabled = true;

  // Set up 7-second timeout so the request never hangs
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 7000);

  try {
    // Lightweight GET request to verify API key validity without generation overhead or model deprecation hurdles
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models', {
      method: 'GET',
      headers: { 'x-goog-api-key': key },
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      const models = (data.models || [])
        .filter(isTextGenerationModel)
        .map(m => m.name.replace(/^models\//, ''));

      if (models.length > 0) {
        chrome.storage.local.set({ verifiedGeminiModels: models });
        populateGeminiModels(models, geminiModelSelect.value);
        geminiValidationResult.className = 'validation-result success';
        geminiValidationResult.textContent = `✓ Gemini Key verified! Loaded ${models.length} active text models from Google AI Studio.`;
      } else {
        geminiValidationResult.className = 'validation-result success';
        geminiValidationResult.textContent = '✓ Gemini API Key is valid! Connected to Google AI Studio successfully.';
      }
    } else {
      const err = await res.json().catch(() => ({}));
      const msg = err.error?.message || `HTTP ${res.status}`;
      geminiValidationResult.className = 'validation-result error';
      geminiValidationResult.textContent = `✗ Connection failed: ${msg}`;
    }
  } catch (err) {
    clearTimeout(timeoutId);
    geminiValidationResult.className = 'validation-result error';
    if (err.name === 'AbortError') {
      geminiValidationResult.textContent = '✗ Connection timed out (7s). Please check your internet connection or VPN, or click "Save All Settings" directly.';
    } else {
      geminiValidationResult.textContent = `✗ Network error: ${err.message}`;
    }
  } finally {
    btnTestGeminiKey.disabled = false;
  }
});

// Test Anthropic Key
btnTestAnthropicKey.addEventListener('click', async () => {
  const key = anthropicApiKeyInput.value.trim();
  if (!key) {
    anthropicValidationResult.className = 'validation-result error';
    anthropicValidationResult.textContent = 'Please enter an Anthropic API key first.';
    anthropicValidationResult.classList.remove('hidden');
    return;
  }

  anthropicValidationResult.className = 'validation-result';
  anthropicValidationResult.textContent = 'Testing connection with Anthropic API...';
  anthropicValidationResult.classList.remove('hidden');
  btnTestAnthropicKey.disabled = true;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 7000);

  try {
    // Listing models verifies the key without spending tokens
    const res = await fetch('https://api.anthropic.com/v1/models?limit=1', {
      method: 'GET',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2026-10-21',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (res.ok) {
      anthropicValidationResult.className = 'validation-result success';
      anthropicValidationResult.textContent = '✓ Anthropic API Key is valid!';
    } else {
      const err = await res.json().catch(() => ({}));
      const msg = err.error?.message || `HTTP ${res.status}`;
      anthropicValidationResult.className = 'validation-result error';
      anthropicValidationResult.textContent = `✗ Connection failed: ${msg}`;
    }
  } catch (err) {
    clearTimeout(timeoutId);
    anthropicValidationResult.className = 'validation-result error';
    if (err.name === 'AbortError') {
      anthropicValidationResult.textContent = '✗ Connection timed out (7s).';
    } else {
      anthropicValidationResult.textContent = `✗ Network error: ${err.message}`;
    }
  } finally {
    btnTestAnthropicKey.disabled = false;
  }
});

// Add site selector
btnAddSite.addEventListener('click', async () => {
  let host = newSiteHostname.value.trim().toLowerCase();
  const selector = newSiteSelector.value.trim();
  host = host.replace(/^https?:\/\//i, '').split('/')[0];

  if (!host || !selector) {
    alert('Please enter both a valid hostname (e.g. canvas.instructure.com) and a CSS selector.');
    return;
  }

  currentSiteSelectors[host] = selector;
  await chrome.storage.sync.set({ siteSelectors: currentSiteSelectors });
  newSiteHostname.value = '';
  newSiteSelector.value = '';
  renderSelectorsTable();
  showToast(`Added selector for ${host}`);
});

btnSaveSettings.addEventListener('click', saveAllSettings);

document.addEventListener('DOMContentLoaded', loadSettings);
