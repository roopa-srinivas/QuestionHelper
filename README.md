# Question Helper (Chrome Extension - Manifest V3)

**Question Helper** is an AI study tutor that lives in the Chrome Side Panel (`chrome.sidePanel` API). When you're working through practice problems, it reads the question on your active tab and coaches you toward the answer: hints that get more specific each time, feedback on your own attempts, and a full worked solution once you've tried it yourself. It works with **Google Gemini** (free API key from Google AI Studio) or **Anthropic Claude**.

**Status:** in progress. Hints, answer checking and worked solutions work today, and I'm still improving it.

It's built for practice and homework you're allowed to get help on. Don't use it on graded exams or anywhere outside help isn't permitted.

---

## 🎓 How Tutoring Works

1. **💡 Hint**: The first hint names the concept the question is testing and asks a guiding question. Each **Next hint** gets more specific (the relevant formula or definition, how to set up the first step, which options can be ruled out) but never gives away the final answer.
2. **Check my answer**: Type your answer and/or reasoning. The tutor tells you whether you're on track. If you're wrong, it points to the step or misconception that went off course without revealing the answer. If you're right, it confirms and explains why.
3. **📖 Full solution**: Unlocks after your first attempt. You get a step-by-step worked solution, a key takeaway, and the most common mistake.

Each question keeps its own conversation. If you move to the next question and come back, your hints and attempts are still there. Use the ↺ button on the tutor card to start a question over.

---

## ⚡ Features

- **Side Panel Integration**: Opens alongside your active tab.
- **Dual AI Provider Support**:
  - **Google Gemini (Recommended / Free Tier)**: Use a free key from [Google AI Studio](https://aistudio.google.com/apikey). Defaults to `gemini-2.5-flash`, with automatic fallback to other available models when one is overloaded (503), rate limited (429) or unavailable (404).
  - **Anthropic Claude**: Claude Opus 5.5 (default), Sonnet 5.5 or Haiku 5.5 with your Anthropic Console key.
- **Automatic Question Detection**: A debounced (~400ms) `MutationObserver` picks up the new question when you click **Next** or navigate.
- **Streaming Replies**: The tutor's replies stream in as they're written.
- **Images & Diagrams**:
  - Extracts `<canvas>` graphs, diagrams and `<img>` figures from the question and sends them to the vision model.
  - Falls back to a tab screenshot when the page has visual media that can't be extracted directly.
  - **Capture Tab** (camera icon): use a screenshot of the visible tab as the question.
  - **Upload / Paste** (image icon, or <kbd>Cmd+V</kbd> / <kbd>Ctrl+V</kbd> in the panel): use an image of a question, e.g. a textbook problem or worksheet.
- **Question Parsing**: Standard quiz DOM structures (`[role="radiogroup"]`, `.question-card`, forms, labels), PrairieLearn question panels (`<pl-question-panel>`, `<pl-multiple-choice>`, `<pl-number-input>`, ...), and LaTeX from KaTeX and MathJax.
- **Site-Specific CSS Selectors**: Configure custom question container selectors per hostname in Settings.
- **Survives Idle**: Conversations are kept in `chrome.storage.session`, so they aren't lost when Chrome suspends the background service worker. They are cleared when the browser closes.
- **Privacy**: API keys are stored only in `chrome.storage.local`. They are never logged, synced, or sent anywhere except the provider's own API.
- **Light Theme**: The side panel and Settings page always use a light theme, whatever your system or browser theme.

---

## 📦 Installation & Setup

### 1. Load Unpacked in Chrome
1. Open Google Chrome and navigate to `chrome://extensions`.
2. Turn on **Developer mode** using the toggle switch in the top-right corner.
3. Click the **Load unpacked** button in the top-left corner.
4. Select this project's directory.
5. The **Question Helper** icon will now appear in your Chrome toolbar.

If you already had an earlier version loaded, click the reload icon on its card in `chrome://extensions`.

### 2. Get a Free Gemini API Key (No Credit Card Needed)
1. Navigate to **[aistudio.google.com/apikey](https://aistudio.google.com/apikey)**.
2. Sign in with any Google account.
3. Click **"Create API Key"** and copy the generated key (`AIzaSy...`).
4. In Chrome, click the **Question Helper** icon in your toolbar, then click the **Settings (⚙)** gear icon (or right-click the extension → **Options**).
5. Make sure **Google Gemini** is selected, paste your key into the **Gemini API Key** field, and click **Test Key**.
6. Click **Save All Settings**.

*(Or switch to Anthropic Claude in Settings if you prefer using Claude.)*

### 3. Optional: Tutor Preferences
Under **Tutor Preferences** in Settings you can add extra instructions, such as your course level, the notation you use, or how detailed you want hints to be. These are added to the tutor's built-in instructions.

---

## 🧪 Testing Walkthrough (Sample Quiz Included)

`sample_quiz.html` is an interactive practice page for trying out the extension.

1. Open `sample_quiz.html` in Chrome (drag it into a tab, or press `Cmd+O` / `Ctrl+O`).
2. Open the side panel: click the **Question Helper** icon, or press `Alt + Shift + Q`.
3. **Question 1 (QuickSort time complexity)**: the question and choices appear in the panel.
   - Click **💡 Hint**. The tutor names the concept and asks a guiding question, without giving the answer.
   - Type a wrong answer (e.g. "A, because it's always n log n") and click **Check my answer**. The tutor explains what's off without revealing the right choice.
   - Click **📖 Show the full worked solution**, which unlocked after your attempt.
4. **Question detection**: click **Next Question →**. Within ~400ms the panel switches to Question 2 with a fresh conversation.
5. **Restored conversations**: click **← Previous**. Your Question 1 conversation is still there.
6. **Vision (Question 4)**: Question 4 draws a right triangle on an HTML5 `<canvas>`. Ask for a hint and the tutor gets a screenshot of the diagram automatically, or click **Capture Tab** (camera icon) to use the screenshot as the question.

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| <kbd>Alt</kbd> + <kbd>Shift</kbd> + <kbd>Q</kbd> | Toggle the Question Helper side panel |
| <kbd>Alt</kbd> + <kbd>Shift</kbd> + <kbd>R</kbd> | Get a hint for the current question |
| <kbd>Cmd</kbd>/<kbd>Ctrl</kbd> + <kbd>Enter</kbd> | Send your answer (in the answer box) |

*To change keyboard shortcuts, navigate to `chrome://extensions/shortcuts` in Chrome.*

---

## 🛠️ Custom CSS Selectors for Practice Sites

If a site uses an unusual DOM structure that the built-in heuristics don't isolate:
1. Open Question Helper **Settings** (Options page).
2. Under **Site-Specific CSS Selectors**:
   - Enter the **Hostname** (e.g. `canvas.instructure.com`, `moodle.school.edu`).
   - Enter the question container **CSS Selector** (e.g. `.question_holder`, `.quiz-card`, `.form-question`).
3. Click **Add Site Selector**.
4. The rule is saved to `chrome.storage.sync` and applied across your synced Chrome browsers.

If the panel shows the wrong question, click the ↻ button on the question card to re-read the page.

---

## 🔍 How to Debug

### Content Script (question extraction)
1. On the practice page, press `F12` (or right-click → **Inspect**).
2. Go to the **Console** tab and look for `[QuestionHelper]` messages.

### Background Service Worker (API calls, tutoring session)
1. Navigate to `chrome://extensions`.
2. Find **Question Helper** and click **Inspect views: service worker**.
3. Check the console and the network requests to `generativelanguage.googleapis.com` or `api.anthropic.com`.

### Side Panel
1. Right-click inside the open side panel.
2. Select **Inspect** to open DevTools for `sidepanel.html`.

---

## 📁 Project Structure

```
QuestionHelper/
├── manifest.json         # Manifest V3 configuration & permissions
├── background.js         # Service worker: tutoring sessions, Gemini/Claude streaming, tab capture
├── content.js            # Content script: question extraction & debounced MutationObserver
├── sidepanel.html        # Side panel layout
├── sidepanel.css         # Light theme styles for the side panel
├── sidepanel.js          # Side panel UI: conversation, hint/attempt/solution controls, markdown renderer
├── options.html          # Options / settings page
├── options.css           # Options page styling
├── options.js            # Settings controller (API keys, models, tutor preferences, site selectors)
├── icons/                # Extension icons (16x16, 48x48, 128x128)
├── sample_quiz.html      # Interactive practice page
├── sample_quiz.js        # Logic & canvas diagram for the practice page
└── README.md             # Documentation
```
