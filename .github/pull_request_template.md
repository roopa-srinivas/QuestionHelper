## Description
<!-- Provide a brief summary of the changes introduced by this pull request. -->

## Type of Change
- [ ] 🐛 Bug fix (non-breaking change fixing an issue)
- [ ] ✨ New feature (non-breaking change adding functionality)
- [ ] 🎨 UI/UX improvement (styling, responsiveness, accessibility)
- [ ] ⚡ Performance optimization (caching, debounce, DOM querying)
- [ ] 📝 Documentation update (README, comments)
- [ ] 🔧 Refactoring or code cleanup

## Affected Components
- [ ] `manifest.json` (permissions, manifest version, action, side_panel)
- [ ] `background.js` (service worker, AI API streaming, caching, tab capture)
- [ ] `content.js` (DOM extraction, mutation observer, quiz platform heuristics)
- [ ] `sidepanel.html` / `sidepanel.js` / `sidepanel.css` (side panel UI, markdown rendering)
- [ ] `options.html` / `options.js` / `options.css` (settings, API keys, models, site selectors)
- [ ] `sample_quiz.html` / `sample_quiz.js` (interactive testing environment)
- [ ] Icons or asset files

## Testing & Verification
Please describe the tests conducted to verify your changes:
- [ ] Reloaded extension unpacked in Chrome (`chrome://extensions`)
- [ ] Verified background service worker starts with no errors in DevTools
- [ ] Tested on sample quiz (`sample_quiz.html`) or live quiz platform
- [ ] Tested with Google Gemini provider
- [ ] Tested with Anthropic Claude provider
- [ ] Verified light mode and dark mode appearance
- [ ] Checked browser console for warnings or uncaught exceptions

## Screenshots / Screen Recordings (if UI changed)
<!-- Attach before/after screenshots or a short recording if applicable. -->

## Checklist
- [ ] My code adheres to the existing coding style of this project.
- [ ] I have commented my code where necessary, especially for complex regex or DOM selectors.
- [ ] I have verified that no API keys, secrets, or personal tokens are committed.
- [ ] If changing manifest permissions, I have verified they are strictly necessary.
