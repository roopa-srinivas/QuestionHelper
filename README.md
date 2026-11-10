# Question Helper (Chrome Extension - Manifest V3)

**Question Helper** is an AI study tutor that lives in the Chrome Side Panel (`chrome.sidePanel` API). When you're working through practice problems, it reads the question on your active tab (or the one you pick) and walks you to the answer in three steps, one click at a time, with feedback on your own attempts along the way. It works with **Google Gemini** (free API key from Google AI Studio) or **Anthropic Claude**.

**Status:** in progress. Step-by-step help, answer checking, question picking and course materials work today, and I'm still improving it.

It's built for practice and homework you're allowed to get help on. Don't use it on graded exams or anywhere outside help isn't permitted.

---

## 🎓 How Tutoring Works

1. **🎯 Choose the question** (optional): The panel follows the question you're looking at. To lock onto a specific one, click 🎯, then click the question on the page (<kbd>↑</kbd>/<kbd>↓</kbd> to select more or less, <kbd>Esc</kbd> to cancel). It stays put while you scroll; click **📌 Your pick ✕** to go back to automatic.
2. **👣 Step 1 → Step 2 → Step 3: Answer**: One click per step, and each builds on the last.
   - **Step 1** names the concept the question tests and the first move: what to identify, set up or recall.
   - **Step 2** works through the main reasoning (and rules out wrong choices), stopping one move short of the answer.
   - **Step 3** finishes it: the final answer, a key takeaway, and the most common mistake.
3. **Check my answer**: At any point, type your answer and/or reasoning. The tutor tells you whether you're on track. If you're wrong, it points to the step or misconception that went off course without revealing the answer (unless you've already reached step 3).

Each question keeps its own conversation. If you move to the next question and come back, your steps and attempts are still there. Use the ↺ button on the tutor card to start a question over.

---

## 📚 Course Materials

Give the tutor the chapters, slides or notes you're studying, and it teaches the way your course does: your textbook's definitions, notation and methods, with page citations like *(Ch. 8, p. 256)* so you can go reread the passage.

1. In **Settings → Course Materials**, enter the course (e.g. `CS 169A`) and choose one or more PDFs, `.txt` or `.md` files. The text is extracted in your browser with [pdf.js](https://github.com/mozilla/pdf.js).
2. Titles are filled in automatically (`08-testing-tdd.pdf` becomes **Ch. 8: Testing TDD**) and can be renamed. Printed page numbers are detected from the page headers, so citations match your book rather than the PDF's page count.
3. In the side panel, open **📚 Studying** and check what you're working on. New uploads are checked automatically. The tutor card shows a 📚 badge with the materials it used.

How the materials reach the model:
- **Up to ~75k tokens** (two typical textbook chapters are ~45k) are sent whole with every request, after the tutor's rules. The prefix stays identical between requests, so it is cached: Claude uses an explicit 1-hour prompt cache, and Gemini 2.5 models cache repeated prefixes automatically. Cache hits are logged in the service worker console.
- **Larger selections** send only the pages most related to the current question, ranked with BM25, in book order.

Scanned PDFs (pictures of pages) have no text layer, so they can't be read. Course PDFs are git-ignored so they never end up in this repo.

---

## ⚡ Features

- **Side Panel Integration**: Opens alongside your active tab.
- **Dual AI Provider Support**:
  - **Google Gemini (Recommended / Free Tier)**: Use a free key from [Google AI Studio](https://aistudio.google.com/apikey). Defaults to `gemini-2.5-flash`, with automatic fallback to other available models when one is overloaded (503), rate limited (429) or unavailable (404).
  - **Anthropic Claude**: Claude Opus 5.5 (default), Sonnet 5.5 or Haiku 5.5 with your Anthropic Console key.
- **Grounded in Your Course**: Upload textbook chapters or notes and the tutor uses their definitions and cites their pages (see [Course Materials](#-course-materials)).
- **Automatic Question Detection**: A debounced (~400ms) `MutationObserver` picks up the new question when you click **Next** or navigate.
- **Choose the Question**: Click 🎯 and then the question on the page. It stays pinned while you scroll and answer other questions.
- **Diagrams**: Inline SVG diagrams in a 🎯-picked question are converted to images (with the page's colors and fonts) so the model can see them.
- **Streaming Replies**: The tutor's replies stream in as they're written.
- **Images & Diagrams**:
  - Extracts `<canvas>` graphs, diagrams and `<img>` figures from the question and sends them to the vision model.
  - Falls back to a tab screenshot when the page has visual media that can't be extracted directly.
  - **Capture Tab** (camera icon): use a screenshot of the visible tab as the question.
  - **Upload / Paste** (image icon, or <kbd>Cmd+V</kbd> / <kbd>Ctrl+V</kbd> in the panel): use an image of a question, e.g. a textbook problem or worksheet.
- **Question Parsing**: Standard quiz DOM structures (`[role="radiogroup"]`, `.question-card`, forms, labels), PrairieLearn question panels (`<pl-question-panel>`, `<pl-multiple-choice>`, `<pl-number-input>`, ...), and LaTeX from KaTeX and MathJax.
- **Site-Specific CSS Selectors**: Configure custom question container selectors per hostname in Settings.
- **Survives Idle**: Conversations are kept in `chrome.storage.session`, so they aren't lost when Chrome suspends the background service worker. They are cleared when the browser closes.
- **Privacy**: API keys are stored only in `chrome.storage.local`. They are never logged, synced, or sent anywhere except the provider's own API. Course materials are also stored only in `chrome.storage.local`; selected ones are sent to your AI provider with each question.
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
Under **Tutor Preferences** in Settings you can add extra instructions, such as your course level, the notation you use, or how detailed you want each step to be. These are added to the tutor's built-in instructions.

---

## 🧪 Testing Walkthrough (Sample Quiz Included)

`sample_quiz.html` is an interactive practice page for trying out the extension.

1. Open `sample_quiz.html` in Chrome (drag it into a tab, or press `Cmd+O` / `Ctrl+O`).
2. Open the side panel: click the **Question Helper** icon, or press `Alt + Shift + Q`.
3. **Question 1 (QuickSort time complexity)**: the question and choices appear in the panel.
   - Click **👣 Step 1**. The tutor names the concept and the first move, without giving the answer.
   - Type a wrong answer (e.g. "A, because it's always n log n") and click **Check my answer**. The tutor explains what's off without revealing the right choice.
   - Click **👣 Step 2**, then **👣 Step 3: Answer** for the worked answer.
4. **Question detection**: click **Next Question →**. Within ~400ms the panel switches to Question 2 with a fresh conversation.
5. **Restored conversations**: click **← Previous**. Your Question 1 conversation is still there.
6. **Vision (Question 4)**: Question 4 draws a right triangle on an HTML5 `<canvas>`. Ask for step 1 and the tutor gets a screenshot of the diagram automatically, or click **Capture Tab** (camera icon) to use the screenshot as the question.

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| <kbd>Alt</kbd> + <kbd>Shift</kbd> + <kbd>Q</kbd> | Toggle the Question Helper side panel |
| <kbd>Alt</kbd> + <kbd>Shift</kbd> + <kbd>R</kbd> | Get the next step for the current question |
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
├── content.js            # Content script: question extraction, debounced MutationObserver, question picker
├── sidepanel.html        # Side panel layout
├── sidepanel.css         # Light theme styles for the side panel
├── sidepanel.js          # Side panel UI: conversation, step/attempt controls, question picker, markdown renderer
├── options.html          # Options / settings page
├── options.css           # Options page styling
├── options.js            # Settings controller (API keys, models, tutor preferences, site selectors)
├── materials.js          # Settings: course material uploads (PDF text extraction, titles, removal)
├── lib/
│   ├── course-materials.js  # Page labels, titles, BM25 page ranking, materials block for the prompt
│   └── pdfjs/            # pdf.js 6.4.299 browser build (Apache-2.0)
├── tests/                # Node unit tests: node --test tests/*.test.mjs
├── icons/                # Extension icons (16x16, 48x48, 128x128)
├── sample_quiz.html      # Interactive practice page
├── sample_quiz.js        # Logic & canvas diagram for the practice page
└── README.md             # Documentation
```

### Running the tests

With Node 22 or later: `node --test tests/*.test.mjs`. CI runs them on every push and pull request, along with manifest and syntax checks.
