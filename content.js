/**
 * Question Helper - Content Script
 * Extracts practice questions, math formulas, code blocks, tables, and choices from the active tab.
 * High-fidelity extraction supporting PrairieLearn, Canvas, Blackboard, Moodle, and standard LMS.
 * Monitors DOM mutations, scrolling, and user focus to automatically track the current question.
 */

(() => {
  // Prevent duplicate injection
  if (window.__questionHelperInjected) return;
  window.__questionHelperInjected = true;

  // Track question fingerprint across in-memory changes and full page reloads
  const SESSION_STORAGE_KEY = '__qh_active_question_fp';
  let lastQuestionFp = '';
  try {
    lastQuestionFp = sessionStorage.getItem(SESSION_STORAGE_KEY) || '';
  } catch (_) {}

  let debounceTimer = null;
  const DEBOUNCE_DELAY_MS = 400;

  /**
   * Helper: Check if element is visible on page
   */
  function isElementVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  /**
   * Helper: Normalize text while preserving code block formatting and indentation
   */
  function normalizeExtractedText(text) {
    if (!text) return '';
    const codeBlockRegex = /(```[\s\S]*?```)/g;
    const parts = text.split(codeBlockRegex);

    for (let i = 0; i < parts.length; i++) {
      if (i % 2 === 0) {
        // Outside code blocks: normalize spacing, weird Unicode characters, and newlines
        parts[i] = parts[i]
          // Strip soft hyphens and invisible zero-width spaces/joiners/BOMs
          .replace(/[\u00ad\u200b\u200c\u200d\u200e\u200f\ufeff]/g, '')
          .replace(/\r\n/g, '\n')
          // Normalize various Unicode spaces (non-breaking, ideographic, thin, en, em) to regular space
          .replace(/[\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]/g, ' ')
          .replace(/[ \t]+/g, ' ')
          .replace(/ *\n */g, '\n')
          .replace(/\n{3,}/g, '\n\n');
      } else {
        // Inside code blocks: preserve indentation, only strip zero-width characters and normalize CRLF
        parts[i] = parts[i]
          .replace(/[\u00ad\u200b\u200c\u200d\u200e\u200f\ufeff]/g, '')
          .replace(/\r\n/g, '\n');
      }
    }
    return parts.join('').trim();
  }

  /**
   * Compute a normalized question fingerprint invariant to answer selection,
   * typed input values, checkmarks, score badges, or submission status.
   */
  function getQuestionFingerprint(q) {
    if (!q) return '';

    // 1. Question text normalization: strip numbers, punctuation, spaces, and blank values
    let stem = (q.questionText || q.fullText || '').trim().toLowerCase();
    stem = stem
      .replace(/\[input[^\]]*\]/gi, '[blank]')
      .replace(/\[blank[^\]]*\]/gi, '[blank]')
      .replace(/^(question\s*\d+[\.\:\-]?\s*|q\d+[\.\:\-]?\s*|\d+[\.\)\:\-]\s*)/i, '')
      .replace(/\(\s*\d+(\.\d+)?\s*(pts?|points?|marks?)\s*\)/gi, '')
      .replace(/\s+/g, ' ')
      .trim();

    // 2. Options normalization: strip prefixes A), B), selection markers (Selected), checkmarks
    let opts = '';
    if (q.options && q.options.length > 0) {
      opts = q.options.map(opt => {
        return opt
          .toLowerCase()
          .replace(/^([a-h1-9][\.\)\:\-]\s*|\([a-h1-9]\)\s*)/, '')
          .replace(/\(?\b(selected|checked|correct|incorrect|saved|chosen)\b\)?/gi, '')
          .replace(/[✓✔✗✘\u2713\u2714\u2717\u2718]/g, '')
          .replace(/\s+/g, ' ')
          .trim();
      }).sort().join('|');
    }

    // 3. Image signature if present
    let imgSig = '';
    if (q.images && q.images.length > 0) {
      imgSig = q.images.map(i => i.description || i.type || 'img').sort().join('|');
    }

    const stemSnippet = stem.slice(0, 140);
    return `${stemSnippet}:::${opts}:::${imgSig}`;
  }

  /**
   * High-fidelity DOM text extractor.
   * Accurately converts KaTeX, MathJax, MathML, Canvas LMS math images,
   * code blocks, tables, PrairieLearn components, superscripts/subscripts,
   * and image alt texts into clean, readable text/markdown.
   */
  function extractCleanDomText(rootElement) {
    if (!rootElement) return '';

    // Deep clone node so live page DOM is never modified
    const clone = rootElement.cloneNode(true);

    // 1. Remove non-content elements and scripts (keep math scripts)
    const removeSelectors = [
      'script:not([type*="math/tex"])',
      'style',
      'noscript',
      'iframe',
      '.MathJax_Preview',
      'button:not(.choice-btn)',
      '.btn:not(.choice-btn)',
      '.badge:not(.math-badge)',
      '.pl-submission-panel',
      '.submission-panel',
      '.submission-history',
      '.score-display',
      '.score',
      '.points',
      '.feedback',
      '.alert',
      '.answer-feedback',
      '.correct-answer-feedback',
      '.submission-info',
      '.card-footer',
      '.saved-status',
      'nav',
      '.navigation',
      '.sr-only:not(:has(annotation))',
      '.visually-hidden:not(:has(annotation))'
    ];
    try {
      clone.querySelectorAll(removeSelectors.join(', ')).forEach(el => el.remove());
    } catch (_) {
      clone.querySelectorAll('script:not([type*="math/tex"]), style, noscript, iframe, .MathJax_Preview').forEach(el => el.remove());
    }

    // 2. Process LaTeX / MathJax / KaTeX formulas FIRST before stripping MathML
    // KaTeX:
    clone.querySelectorAll('.katex').forEach(katexEl => {
      const isDisplay = !!katexEl.closest('.katex-display') || katexEl.classList.contains('katex-display');
      const annotation = katexEl.querySelector('annotation[encoding*="tex"]') || katexEl.querySelector('annotation');
      let tex = annotation ? annotation.textContent.trim() : '';
      if (!tex) {
        const aria = katexEl.getAttribute('aria-label');
        if (aria && !aria.startsWith('KaTeX')) tex = aria;
      }
      if (tex) {
        const mathStr = isDisplay ? `\n$$\n${tex}\n$$\n` : ` $${tex}$ `;
        const target = katexEl.closest('.katex-display') || katexEl;
        target.replaceWith(document.createTextNode(mathStr));
      }
    });

    // MathJax v2:
    clone.querySelectorAll('script[type*="math/tex"]').forEach(scriptEl => {
      const type = scriptEl.getAttribute('type') || '';
      const isDisplay = type.includes('mode=display');
      const tex = scriptEl.textContent.trim();
      if (tex) {
        const mathStr = isDisplay ? `\n$$\n${tex}\n$$\n` : ` $${tex}$ `;
        const parentSpan = scriptEl.closest('.MathJax, .MathJax_Display') || scriptEl;
        parentSpan.replaceWith(document.createTextNode(mathStr));
      }
    });

    // MathJax v3:
    clone.querySelectorAll('mjx-container').forEach(mjxEl => {
      const isDisplay = mjxEl.getAttribute('display') === 'true' || mjxEl.classList.contains('MJX-TEX-DISPLAY');
      const annotation = mjxEl.querySelector('annotation[encoding*="tex"]') || mjxEl.querySelector('annotation');
      let tex = annotation ? annotation.textContent.trim() : '';
      if (!tex) {
        tex = mjxEl.getAttribute('aria-label') || '';
      }
      if (!tex) {
        const assistive = mjxEl.querySelector('mjx-assistive-mml');
        if (assistive) tex = assistive.textContent.trim();
      }
      if (tex) {
        const mathStr = isDisplay ? `\n$$\n${tex}\n$$\n` : ` $${tex}$ `;
        mjxEl.replaceWith(document.createTextNode(mathStr));
      }
    });

    // Canvas LMS equation images and external LaTeX image services (Codecogs, Google Charts, etc.):
    clone.querySelectorAll('img.equation_image, img[data-equation-content], img[src*="latex="], img[src*="tex="]').forEach(img => {
      const src = img.getAttribute('src') || '';
      const mathUrlMatch = src.match(/[?&](?:latex|tex)=([^&]+)/i);
      let tex = '';
      if (mathUrlMatch) {
        try {
          tex = decodeURIComponent(mathUrlMatch[1]);
        } catch (_) {}
      }
      if (!tex) {
        tex = img.getAttribute('data-equation-content') || img.getAttribute('alt') || '';
      }
      if (tex) {
        img.replaceWith(document.createTextNode(` $${tex}$ `));
      }
    });

    // Custom data-latex or data-formula attributes on spans/divs:
    clone.querySelectorAll('[data-latex], [data-tex], [data-formula]').forEach(el => {
      const tex = el.getAttribute('data-latex') || el.getAttribute('data-tex') || el.getAttribute('data-formula') || '';
      if (tex && !el.querySelector('.katex, mjx-container')) {
        el.replaceWith(document.createTextNode(` $${tex}$ `));
      }
    });

    // MathML <math> tags:
    clone.querySelectorAll('math').forEach(mathEl => {
      const annotation = mathEl.querySelector('annotation[encoding*="tex"]') || mathEl.querySelector('annotation');
      const tex = annotation ? annotation.textContent.trim() : mathEl.getAttribute('alttext') || '';
      if (tex) {
        const isDisplay = mathEl.getAttribute('display') === 'block';
        mathEl.replaceWith(document.createTextNode(isDisplay ? `\n$$\n${tex}\n$$\n` : ` $${tex}$ `));
      }
    });

    // 3. Process PrairieLearn specialized components
    // PrairieLearn code blocks:
    clone.querySelectorAll('pl-code').forEach(el => {
      const lang = el.getAttribute('language') || '';
      const code = el.textContent || '';
      el.replaceWith(document.createTextNode(`\n\`\`\`${lang}\n${code}\n\`\`\`\n`));
    });

    // PrairieLearn fill-in-the-blank inputs (both custom element tags and rendered classes):
    clone.querySelectorAll(
      'pl-string-input, pl-number-input, pl-symbolic-input, pl-integer-input, pl-matrix-input, ' +
      '.pl-string-input, .pl-number-input, .pl-symbolic-input, .pl-integer-input, .pl-matrix-input'
    ).forEach(el => {
      let name = el.getAttribute('answers-name') || el.getAttribute('name') || '';
      const input = el.querySelector('input, textarea');
      if (!name && input) {
        name = input.getAttribute('name') || input.getAttribute('answers-name') || input.id || '';
      }
      name = name.replace(/^_q_submission_/, '');

      let label = el.getAttribute('label') || '';
      if (!label) {
        label = el.querySelector('.pl-number-input-label, .pl-input-label, .input-group-prepend, .input-group-text:first-child')?.textContent?.trim() || '';
      }

      let suffix = el.getAttribute('suffix') || '';
      if (!suffix) {
        suffix = el.querySelector('.pl-number-input-suffix, .pl-input-suffix, .input-group-append, .input-group-text:last-child')?.textContent?.trim() || '';
      }

      const comp = el.getAttribute('comparison') || '';
      const digits = el.getAttribute('digits') || '';
      const vars = el.getAttribute('variables') || '';
      const placeholder = el.getAttribute('placeholder') || input?.getAttribute('placeholder') || '';

      const formatParts = [];
      if (comp) {
        if (comp === 'sigfig') formatParts.push(`${digits || 3} significant figures`);
        else if (comp === 'decdig') formatParts.push(`${digits || 2} decimal digits`);
        else formatParts.push(`precision: ${comp}`);
      }
      if (vars) formatParts.push(`allowed variables: ${vars}`);
      const formatStr = formatParts.length > 0 ? ` (Format: ${formatParts.join(', ')})` : '';

      const promptPart = [label, placeholder ? `[${placeholder}]` : '___', suffix].filter(Boolean).join(' ');
      const desc = name ? `[Fill-in-the-Blank (${name}): ${promptPart}${formatStr}]` : `[Fill-in-the-Blank: ${promptPart}${formatStr}]`;
      el.replaceWith(document.createTextNode(`\n${desc}\n`));
    });

    // Rendered Bootstrap .input-group containing text/number inputs (e.g. PrairieLearn server-rendered)
    clone.querySelectorAll('.input-group').forEach(group => {
      const input = group.querySelector('input[type="text"], input[type="number"], input:not([type])');
      if (!input) return;
      const prepend = group.querySelector('.input-group-prepend, .input-group-text:first-child')?.textContent?.trim() || '';
      const append = group.querySelector('.input-group-append, .input-group-text:last-child')?.textContent?.trim() || '';
      const name = input.getAttribute('name') || input.getAttribute('answers-name') || '';
      const placeholder = input.getAttribute('placeholder') || '';
      const promptPart = [prepend, placeholder ? `[${placeholder}]` : '___', append].filter(Boolean).join(' ');
      group.replaceWith(document.createTextNode(`\n[Fill-in-the-Blank${name ? ` (${name})` : ''}: ${promptPart}]\n`));
    });

    // PrairieLearn figures & file previews:
    clone.querySelectorAll('pl-figure').forEach(el => {
      const img = el.querySelector('img');
      const caption = el.querySelector('figcaption, .caption')?.textContent?.trim() || img?.getAttribute('alt') || el.getAttribute('label') || 'Diagram';
      el.replaceWith(document.createTextNode(`\n[Figure: ${caption}]\n`));
    });

    clone.querySelectorAll('pl-file-preview').forEach(el => {
      const fname = el.getAttribute('file-name') || '';
      el.replaceWith(document.createTextNode(` [File: ${fname}] `));
    });

    // 4. Process standard HTML code blocks (<pre>, <code>)
    clone.querySelectorAll('pre').forEach(pre => {
      let lang = '';
      const codeEl = pre.querySelector('code');
      const classes = (pre.className + ' ' + (codeEl ? codeEl.className : '')).split(/\s+/);
      for (const cls of classes) {
        const m = cls.match(/lang(?:uage)?-([a-zA-Z0-9_-]+)/i);
        if (m) { lang = m[1]; break; }
      }
      const rawCode = (codeEl ? codeEl.textContent : pre.textContent) || '';
      pre.replaceWith(document.createTextNode(`\n\`\`\`${lang}\n${rawCode.trimEnd()}\n\`\`\`\n`));
    });

    clone.querySelectorAll('code').forEach(code => {
      // Inline code
      code.replaceWith(document.createTextNode(` \`${code.textContent.trim()}\` `));
    });

    // 5. Process HTML tables (convert to Markdown tables)
    clone.querySelectorAll('table').forEach(table => {
      const rows = Array.from(table.querySelectorAll('tr'));
      if (rows.length === 0) return;

      const mdRows = [];
      let maxCols = 0;

      rows.forEach(tr => {
        const cells = Array.from(tr.querySelectorAll('th, td')).map(cell => {
          return cell.textContent.trim().replace(/\|/g, '\\|').replace(/\n+/g, ' ');
        });
        if (cells.length > maxCols) maxCols = cells.length;
        mdRows.push(cells);
      });

      if (mdRows.length > 0 && maxCols > 0) {
        mdRows.forEach(r => {
          while (r.length < maxCols) r.push('');
        });

        const headerLine = `| ${mdRows[0].join(' | ')} |`;
        const separatorLine = `| ${Array(maxCols).fill('---').join(' | ')} |`;
        const bodyLines = mdRows.slice(1).map(r => `| ${r.join(' | ')} |`);

        const tableMd = `\n\n${[headerLine, separatorLine, ...bodyLines].join('\n')}\n\n`;
        table.replaceWith(document.createTextNode(tableMd));
      }
    });

    // 6. Process subscripts, superscripts, and formatting
    clone.querySelectorAll('sup').forEach(el => {
      el.replaceWith(document.createTextNode(`^{${el.textContent.trim()}}`));
    });
    clone.querySelectorAll('sub').forEach(el => {
      el.replaceWith(document.createTextNode(`_{${el.textContent.trim()}}`));
    });
    clone.querySelectorAll('strong, b').forEach(el => {
      el.replaceWith(document.createTextNode(` **${el.textContent.trim()}** `));
    });
    clone.querySelectorAll('em, i').forEach(el => {
      el.replaceWith(document.createTextNode(` *${el.textContent.trim()}* `));
    });

    // Lists:
    clone.querySelectorAll('ol > li').forEach((li, idx) => {
      li.replaceWith(document.createTextNode(`\n${idx + 1}. ${li.textContent.trim()}`));
    });
    clone.querySelectorAll('ul > li').forEach(li => {
      li.replaceWith(document.createTextNode(`\n- ${li.textContent.trim()}`));
    });

    // Line breaks and headings:
    clone.querySelectorAll('br').forEach(el => el.replaceWith(document.createTextNode('\n')));
    clone.querySelectorAll('p, div, section, article, h1, h2, h3, h4, h5, h6').forEach(el => {
      el.insertAdjacentText('afterend', '\n');
    });

    // Remove radio and checkbox inputs so values don't pollute text
    clone.querySelectorAll('input[type="radio"], input[type="checkbox"]').forEach(i => i.remove());

    // Process other form inputs (text, number, select)
    clone.querySelectorAll('input[type="text"], input[type="number"], textarea').forEach(inp => {
      const ph = inp.getAttribute('placeholder') || inp.getAttribute('aria-label') || inp.name || '';
      inp.replaceWith(document.createTextNode(` [Blank: ${ph || '___'}] `));
    });
    // Process dropdown select elements: extract available choices so matching/fill-in questions are readable
    clone.querySelectorAll('select').forEach(sel => {
      const options = Array.from(sel.querySelectorAll('option')).map(o => o.textContent.trim()).filter(Boolean);
      if (options.length > 0) {
        sel.replaceWith(document.createTextNode(` [Dropdown choices: ${options.join(' | ')}] `));
      } else {
        sel.replaceWith(document.createTextNode(' [Select Option] '));
      }
    });

    // Details / Summary (e.g. accordion context or collapsible formulas)
    clone.querySelectorAll('details').forEach(det => {
      const summary = det.querySelector('summary');
      if (summary) {
        summary.replaceWith(document.createTextNode(`\n**[Context: ${summary.textContent.trim()}]**\n`));
      }
    });

    // Definition lists (<dt>, <dd>)
    clone.querySelectorAll('dt').forEach(dt => {
      dt.replaceWith(document.createTextNode(`\n**${dt.textContent.trim()}**: `));
    });
    clone.querySelectorAll('dd').forEach(dd => {
      dd.replaceWith(document.createTextNode(`${dd.textContent.trim()}\n`));
    });

    // Monospace code blocks formatted using <tt> or inline font tags
    clone.querySelectorAll('tt, font[face*="mono"], div[style*="monospace"], span[style*="monospace"]').forEach(el => {
      if (!el.closest('pre, code')) {
        const raw = el.textContent || '';
        el.replaceWith(document.createTextNode(` \`${raw.trim()}\` `));
      }
    });

    // Meaningful images
    clone.querySelectorAll('img').forEach(img => {
      const alt = img.getAttribute('alt') || img.getAttribute('title') || '';
      if (alt && !/icon|avatar|spacer|bullet|logo/i.test(alt)) {
        img.replaceWith(document.createTextNode(` [Image: ${alt}] `));
      } else {
        img.replaceWith(document.createTextNode(' [Image] '));
      }
    });

    // Canvas / SVG (extract both title and any text elements embedded in the SVG)
    clone.querySelectorAll('canvas').forEach(c => c.replaceWith(document.createTextNode(' [Canvas Diagram] ')));
    clone.querySelectorAll('svg').forEach(svg => {
      const title = svg.querySelector('title')?.textContent?.trim() || svg.getAttribute('aria-label') || '';
      const textElements = Array.from(svg.querySelectorAll('text')).map(t => t.textContent.trim()).filter(Boolean);
      let desc = title;
      if (textElements.length > 0) {
        desc += (desc ? ' | Text in diagram: ' : 'Diagram text: ') + textElements.join(', ');
      }
      if (desc) {
        svg.replaceWith(document.createTextNode(` [Diagram: ${desc}] `));
      }
    });

    const raw = clone.innerText || clone.textContent || '';
    return normalizeExtractedText(raw);
  }

  /**
   * Fetch site-specific selector from chrome.storage.sync
   */
  async function getSiteSelector() {
    try {
      const hostname = window.location.hostname;
      const res = await chrome.storage.sync.get('siteSelectors');
      const siteSelectors = res.siteSelectors || {};
      
      for (const [pattern, selector] of Object.entries(siteSelectors)) {
        if (!selector) continue;
        if (pattern === hostname) return selector;
        if (pattern.startsWith('*.') && hostname.endsWith(pattern.slice(2))) return selector;
        if (hostname.includes(pattern)) return selector;
      }
    } catch (e) {
      // Storage access may fail if context is invalidated
    }
    return null;
  }

  /**
   * Check if container has visual media (canvas, image, iframe, svg)
   */
  function detectVisualMedia(container) {
    if (!container) return false;
    const medias = container.querySelectorAll('canvas, img:not([alt*="avatar"]):not([class*="icon"]):not([src*="logo"]), svg:not([class*="icon"]), iframe');
    for (const media of medias) {
      if (isElementVisible(media)) {
        const rect = media.getBoundingClientRect();
        if (rect.width >= 50 && rect.height >= 50) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Extract image data URLs and sources from <img> and <canvas> elements within a container
   */
  function extractImagesFromContainer(container) {
    if (!container) return [];
    const images = [];
    const seenData = new Set();

    // 1. HTML5 Canvas diagrams
    const canvases = container.querySelectorAll('canvas');
    for (const canvas of canvases) {
      if (!isElementVisible(canvas)) continue;
      const rect = canvas.getBoundingClientRect();
      if (rect.width >= 40 && rect.height >= 40) {
        try {
          const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
          if (dataUrl && dataUrl.startsWith('data:image/') && !seenData.has(dataUrl)) {
            seenData.add(dataUrl);
            const mimeType = dataUrl.substring(5, dataUrl.indexOf(';'));
            const base64 = dataUrl.split(',')[1];
            images.push({
              mimeType: mimeType || 'image/jpeg',
              data: base64,
              type: 'canvas',
              description: canvas.getAttribute('aria-label') || 'Canvas Diagram'
            });
          }
        } catch (_) {}
      }
    }

    // 2. Images (<img>)
    const imgs = container.querySelectorAll('img');
    for (const img of imgs) {
      if (!isElementVisible(img)) continue;
      const alt = (img.getAttribute('alt') || '').toLowerCase();
      const className = (img.className || '').toLowerCase();
      if (className.includes('equation_image') || img.hasAttribute('data-equation-content')) {
        continue;
      }
      if (/icon|avatar|spacer|bullet|logo|favicon/i.test(alt) || /icon|avatar|logo/i.test(className)) {
        continue;
      }

      const rect = img.getBoundingClientRect();
      const natW = img.naturalWidth || rect.width;
      const natH = img.naturalHeight || rect.height;
      if (natW >= 40 && natH >= 40) {
        let dataUrl = null;
        if (img.src && img.src.startsWith('data:image/')) {
          dataUrl = img.src;
        } else {
          try {
            const c = document.createElement('canvas');
            c.width = img.naturalWidth || rect.width;
            c.height = img.naturalHeight || rect.height;
            const ctx = c.getContext('2d');
            ctx.drawImage(img, 0, 0);
            dataUrl = c.toDataURL('image/jpeg', 0.85);
          } catch (_) {}
        }

        if (dataUrl && dataUrl.startsWith('data:image/') && !seenData.has(dataUrl)) {
          seenData.add(dataUrl);
          const mimeType = dataUrl.substring(5, dataUrl.indexOf(';'));
          const base64 = dataUrl.split(',')[1];
          images.push({
            mimeType: mimeType || 'image/jpeg',
            data: base64,
            type: 'image',
            description: img.getAttribute('alt') || img.getAttribute('title') || 'Question Image'
          });
        } else if (img.src && (img.src.startsWith('http://') || img.src.startsWith('https://')) && !seenData.has(img.src)) {
          seenData.add(img.src);
          images.push({
            src: img.src,
            mimeType: 'image/jpeg',
            type: 'image_url',
            description: img.getAttribute('alt') || img.getAttribute('title') || 'Question Image'
          });
        }
      }
    }

    return images.slice(0, 4);
  }

  /**
   * Helper: Check if active page is a PrairieLearn question
   */
  function isPrairieLearnPage() {
    return (
      window.location.hostname.includes('prairielearn') ||
      !!document.querySelector('.question-container, form.question-form, pl-question-panel, .pl-question-panel, [answers-name], pl-number-input, .pl-number-input')
    );
  }

  /**
   * Helper: Check if element is a giant multi-question container (e.g. whole quiz form or main)
   */
  function containsMultipleQuestions(el) {
    if (!el || el === document.body || el === document.documentElement) return true;

    // PrairieLearn always presents one question per page (often split into multiple pl-question-panel or card sections)
    if (isPrairieLearnPage()) return false;

    // Check if element has multiple question cards/containers
    const questionItems = el.querySelectorAll(
      '.problem, .quiz-question, .question-card, .question_holder, .display_question, ' +
      '.que, .rc-FormPartsQuestion, [data-testid*="question"], [data-testid*="quiz"], ' +
      '.freebirdFormviewerViewNumberedItemContainer'
    );
    if (questionItems.length > 1) return true;

    // Check if element has multiple distinct radio groups
    const radioNames = new Set();
    el.querySelectorAll('input[type="radio"]').forEach(r => {
      if (r.name) radioNames.add(r.name);
    });
    if (radioNames.size > 1) return true;

    return false;
  }

  /**
   * Calculate visibility and focus score for a question candidate element.
   * Prioritizes the element currently focused or closest to viewport center.
   */
  function scoreCandidate(element) {
    if (!element || !isElementVisible(element)) return -1;

    // Multi-question containers should never beat a single question
    if (containsMultipleQuestions(element)) {
      return -10000;
    }

    let score = 0;
    const activeEl = document.activeElement;

    // 1. Is active focused element inside this candidate? (Highest priority)
    if (activeEl && activeEl !== document.body && element.contains(activeEl)) {
      score += 10000;
    }

    // 2. Viewport overlap & proximity to center of viewport
    const rect = element.getBoundingClientRect();
    const viewHeight = window.innerHeight || document.documentElement.clientHeight;

    const visibleTop = Math.max(0, rect.top);
    const visibleBottom = Math.min(viewHeight, rect.bottom);
    const visibleHeight = Math.max(0, visibleBottom - visibleTop);

    if (visibleHeight > 0) {
      score += Math.min(2500, Math.round(visibleHeight * 3));

      // Distance of candidate center from viewport center (closer is better)
      const centerY = viewHeight / 2;
      const candCenterY = (rect.top + rect.bottom) / 2;
      const distFromCenter = Math.abs(centerY - candCenterY);
      score += Math.max(0, Math.round(2000 - distFromCenter * 2));
    } else {
      score -= 3000;
      if (rect.bottom < 0) {
        score -= Math.min(2000, Math.abs(rect.bottom));
      } else {
        score -= Math.min(2000, Math.abs(rect.top - viewHeight));
      }
    }

    if (rect.height > 1200) {
      score -= 3000;
    }

    return score;
  }

  /**
   * Given an element that might be a choice group, radio group, or inner wrapper,
   * resolve upwards to the true enclosing question container (e.g. .problem, .question, fieldset, form, etc.)
   */
  function resolveToQuestionContainer(element) {
    if (!element || element === document.body || element === document.documentElement) {
      return element;
    }

    const hasRadiosOrChecks = element.querySelectorAll('input[type="radio"], input[type="checkbox"]').length > 0;
    const hasExplicitPrompt = !!element.querySelector('h1, h2, h3, h4, h5, h6, .question-text, .question_text, .qtext, .stem, .prompt');

    // Clone element without inputs/labels/buttons to check if it has substantive question prompt text
    let hasSubstantivePrompt = false;
    if (hasRadiosOrChecks) {
      const clone = element.cloneNode(true);
      clone.querySelectorAll(
        '[role="radiogroup"], .choicegroup, .answers, .choices, .options, .options-group, ' +
        'label, input, button, select, textarea, .field, .form-check'
      ).forEach(e => e.remove());
      const remainingText = (clone.innerText || clone.textContent || '').trim();
      hasSubstantivePrompt = remainingText.length > 20;
    }

    const isChoicesOnly = (
      element.matches('[role="radiogroup"], [role="group"], .choicegroup, .answers, .choices, .options, .options-group, .radio-group') ||
      (hasRadiosOrChecks && !hasExplicitPrompt && !hasSubstantivePrompt)
    );

    if (isChoicesOnly) {
      // Find major question container without escaping into a multi-question wrapper
      let curr = element.parentElement;
      let bestContainer = null;

      while (curr && curr !== document.body && curr !== document.documentElement) {
        if (containsMultipleQuestions(curr)) {
          break;
        }

        if (curr.matches(
          '.problem, .problem-wrapper, .wrapper-problem-response, .xblock, [data-block-type="problem"], ' +
          '.question, .question-card, .quiz-question, .question-container, .question_holder, .display_question, ' +
          '.que, .rc-FormPartsQuestion, [data-testid*="question"], [data-testid*="quiz"], ' +
          '.card, fieldset, [role="listitem"], [role="region"], section, article'
        )) {
          bestContainer = curr;
          break;
        }

        const clone = curr.cloneNode(true);
        clone.querySelectorAll(
          '[role="radiogroup"], [role="group"], .choicegroup, .answers, .choices, .options, input[type="radio"], input[type="checkbox"], button'
        ).forEach(e => e.remove());
        const remainingText = (clone.innerText || clone.textContent || '').trim();
        if (remainingText.length > 15 && (curr.querySelector('p, h1, h2, h3, h4, h5, h6, legend') || remainingText.includes('?'))) {
          bestContainer = curr;
        }

        curr = curr.parentElement;
      }

      if (bestContainer) {
        return bestContainer;
      }
    }

    return element;
  }

  /**
   * Extract question stem and choices from a candidate container element
   */
  function extractFromContainer(container, selectorLabel) {
    if (!container || !isElementVisible(container)) return null;

    // Detect options / choices inside container
    const choiceSelectors = [
      'pl-multiple-choice .form-check',
      'pl-multiple-choice pl-answer',
      'pl-checkbox .form-check',
      'pl-checkbox pl-answer',
      '.pl-multiple-choice-option',
      '.choice',
      '.option',
      '.quiz-option',
      '.choice-label',
      '[data-choice]',
      '.answers .answer',
      'ul.choices > li',
      'ul.answers > li',
      'ol.choices > li',
      '[role="radio"]',
      '[role="checkbox"]'
    ];

    // Check for radio and checkbox inputs directly if present
    const inputs = Array.from(container.querySelectorAll('input[type="radio"], input[type="checkbox"]')).filter(isElementVisible);
    let optionNodes = [];
    if (inputs.length > 0) {
      optionNodes = inputs.map(inp => {
        const id = inp.id;
        const label = id ? container.querySelector(`label[for="${id}"]`) : null;
        return label || inp.closest('label') || inp.parentElement || inp;
      });
    } else {
      optionNodes = Array.from(container.querySelectorAll(choiceSelectors.join(', '))).filter(isElementVisible);
    }

    const options = [];
    const seenOptionTexts = new Set();

    optionNodes.forEach((node) => {
      let optText = extractCleanDomText(node);
      if (!optText) return;

      // Extract existing choice prefix if present
      const prefixMatch = optText.match(/^([A-Ha-h1-9][\.\)\:\-]\s*|\([A-Ha-h1-9]\)\s*)/);
      let cleanContent = optText;
      let existingLetter = '';
      if (prefixMatch) {
        existingLetter = prefixMatch[1].replace(/[\(\)\.\:\-\s]/g, '').toUpperCase();
        cleanContent = optText.slice(prefixMatch[0].length).trim();
      }

      if (cleanContent.length > 0 && cleanContent.length < 2500 && !seenOptionTexts.has(cleanContent)) {
        seenOptionTexts.add(cleanContent);
        const letter = existingLetter || String.fromCharCode(65 + options.length);
        options.push(`${letter}) ${cleanContent}`);
      }
    });

    // 1. Check dedicated question body / prompt containers
    const promptContainerSelectors = [
      'pl-question-panel',
      '.question-body',
      '.question_text',
      '.display_question_text',
      '.qtext',
      '.vtbegenerated',
      '.question-content'
    ];

    let dedicatedStem = '';
    for (const sel of promptContainerSelectors) {
      const promptEl = container.querySelector(sel);
      if (promptEl && isElementVisible(promptEl)) {
        const text = extractCleanDomText(promptEl);
        if (text && text.length > 10) {
          dedicatedStem = text;
          break;
        }
      }
    }

    // 2. Clone entire container and strip choices, buttons, and navigation to get complete question
    const clone = container.cloneNode(true);

    // Remove choice groups and wrappers
    clone.querySelectorAll(
      '[role="radiogroup"], .choicegroup, .choices, .answers, .options, .options-group, pl-multiple-choice, pl-checkbox'
    ).forEach(el => el.remove());

    // Remove choice selectors
    clone.querySelectorAll(choiceSelectors.join(', ')).forEach(el => el.remove());

    // Remove radio and checkbox inputs and their associated labels
    clone.querySelectorAll('input[type="radio"], input[type="checkbox"]').forEach(inp => {
      const id = inp.id;
      if (id) {
        const lbl = clone.querySelector(`label[for="${id}"]`);
        if (lbl) lbl.remove();
      }
      const parentLabel = inp.closest('label');
      if (parentLabel) {
        parentLabel.remove();
      } else {
        const parentField = inp.closest('.field, .form-check, .choice, .option, li');
        if (parentField) {
          parentField.remove();
        } else {
          inp.remove();
        }
      }
    });

    // Remove action buttons, submit/save buttons, navigation, footers
    clone.querySelectorAll(
      'button, input[type="submit"], input[type="button"], .btn, .save, .submit, ' +
      'nav, .navigation, .quiz-footer, .card-footer, .notification, .action'
    ).forEach(el => el.remove());

    const fullContainerStem = extractCleanDomText(clone);

    // Prefer fullContainerStem if it contains subparts or more context; otherwise dedicatedStem
    let questionStem = (fullContainerStem && fullContainerStem.length >= dedicatedStem.length)
      ? fullContainerStem
      : (dedicatedStem || fullContainerStem);

    // Embedded choices detection: if options array is empty, check if prompt ends with choices
    if (options.length === 0 && questionStem) {
      const lines = questionStem.split('\n').map(l => l.trim()).filter(Boolean);
      // Support (A), [A], A), A., 1., (1), [1] (Do NOT match Roman numerals like (i) as choices!)
      const choiceLineRegex = /^(\(?[A-Ha-h1-9]\)|\[[A-Ha-h1-9]\]|[A-Ha-h1-9][\.\:\-])\s+(.+)$/i;
      const detectedChoiceIndices = [];
      lines.forEach((line, idx) => {
        if (choiceLineRegex.test(line)) {
          detectedChoiceIndices.push(idx);
        }
      });

      // If at least 2 choice lines found near the bottom
      if (detectedChoiceIndices.length >= 2 && detectedChoiceIndices[0] > 0) {
        const firstChoiceIdx = detectedChoiceIndices[0];
        const extractedChoices = lines.slice(firstChoiceIdx);
        questionStem = lines.slice(0, firstChoiceIdx).join('\n\n').trim();
        extractedChoices.forEach(c => {
          const match = c.match(choiceLineRegex);
          const rawContent = match ? match[2].trim() : c;
          const letter = String.fromCharCode(65 + options.length);
          options.push(`${letter}) ${rawContent}`);
        });
      }
    }

    // Detect PrairieLearn and fill-in-the-blank inputs
    const blankInputs = [];
    const seenInputNames = new Set();

    // 1. PrairieLearn custom input tags and rendered component classes
    const plInputEls = container.querySelectorAll(
      'pl-number-input, pl-string-input, pl-symbolic-input, pl-integer-input, pl-matrix-input, ' +
      '.pl-number-input, .pl-string-input, .pl-symbolic-input, .pl-integer-input, .pl-matrix-input'
    );
    plInputEls.forEach(el => {
      let name = el.getAttribute('answers-name') || el.getAttribute('name') || '';
      const input = el.querySelector('input, textarea');
      if (!name && input) {
        name = input.getAttribute('name') || input.getAttribute('answers-name') || input.id || '';
      }
      name = (name || `field_${blankInputs.length + 1}`).replace(/^_q_submission_/, '');

      let label = el.getAttribute('label') || '';
      if (!label) {
        label = el.querySelector('.pl-number-input-label, .pl-input-label, .input-group-prepend, .input-group-text:first-child')?.textContent?.trim() || '';
      }

      let suffix = el.getAttribute('suffix') || '';
      if (!suffix) {
        suffix = el.querySelector('.pl-number-input-suffix, .pl-input-suffix, .input-group-append, .input-group-text:last-child')?.textContent?.trim() || '';
      }

      if (!seenInputNames.has(name)) {
        seenInputNames.add(name);
        const tag = el.tagName.toLowerCase();
        const type = tag.startsWith('pl-') ? tag.replace('pl-', '').replace('-input', '') : 'text';
        blankInputs.push({
          name: name,
          label: label,
          suffix: suffix,
          type: type,
          comparison: el.getAttribute('comparison') || '',
          digits: el.getAttribute('digits') || '',
          variables: el.getAttribute('variables') || '',
          placeholder: el.getAttribute('placeholder') || input?.getAttribute('placeholder') || ''
        });
      }
    });

    // 2. Standard HTML text/number inputs (if custom tags didn't already capture them)
    if (blankInputs.length === 0) {
      const rawInputs = Array.from(container.querySelectorAll(
        'input[type="text"]:not([readonly]), input[type="number"]:not([readonly]), input:not([type]):not([readonly])'
      )).filter(isElementVisible);

      rawInputs.forEach(inp => {
        // Exclude search, buttons, radio, checkbox, csrf tokens
        if (/search|btn|submit|filter|nav|csrf|token/i.test(inp.name || inp.className || inp.id)) return;
        let name = (inp.name || inp.id || `field_${blankInputs.length + 1}`).replace(/^_q_submission_/, '');
        if (!seenInputNames.has(name)) {
          seenInputNames.add(name);
          const parentGroup = inp.closest('.input-group, .form-group, .pl-number-input, .pl-string-input');
          const label = parentGroup?.querySelector('.pl-number-input-label, .pl-input-label, .input-group-prepend, .input-group-text:first-child')?.textContent?.trim() ||
                        container.querySelector(`label[for="${inp.id}"]`)?.textContent?.trim() || '';
          const suffix = parentGroup?.querySelector('.pl-number-input-suffix, .pl-input-suffix, .input-group-append, .input-group-text:last-child')?.textContent?.trim() || '';
          blankInputs.push({
            name: name,
            label: label,
            suffix: suffix,
            type: inp.type || 'text',
            comparison: '',
            digits: '',
            variables: '',
            placeholder: inp.placeholder || ''
          });
        }
      });
    }

    const isFillInBlank = (blankInputs.length > 0 || /_{2,}|\bfill\s+in\s+the\s+blank\b/i.test(questionStem)) && options.length === 0;

    const hasMedia = detectVisualMedia(container);
    const images = extractImagesFromContainer(container);

    // Build unified full text
    let fullText = questionStem;
    if (options.length > 0) {
      fullText += '\n\nOptions:\n' + options.join('\n');
    }

    if (!questionStem && options.length === 0 && !hasMedia && images.length === 0) {
      return null;
    }

    return {
      questionText: questionStem || (hasMedia || images.length > 0 ? '[Diagram / Visual Question]' : ''),
      options: options,
      optionsText: options.join('\n'),
      fullText: fullText.trim(),
      selectorUsed: selectorLabel,
      hasVisualMedia: hasMedia || images.length > 0,
      images: images,
      blankInputs: blankInputs,
      isFillInBlank: isFillInBlank,
      url: window.location.href,
      pageTitle: document.title
    };
  }

  /**
   * Main Question Extraction Engine
   */
  async function extractQuestion() {
    // 1. Site-specific custom selector
    const customSelector = await getSiteSelector();
    if (customSelector) {
      try {
        const el = document.querySelector(customSelector);
        if (el) {
          const res = extractFromContainer(el, `Custom: ${customSelector}`);
          if (res && res.fullText.length > 5) {
            return res;
          }
        }
      } catch (err) {
        console.warn('[QuestionHelper] Invalid site selector:', customSelector, err);
      }
    }

    // 2. PrairieLearn specialized detection
    if (isPrairieLearnPage()) {
      // Direct targeting of primary PrairieLearn question container
      const plPrimary = document.querySelector('.question-container, form.question-form, form[name="question-form"]') ||
                        document.querySelector('.card:has(pl-question-panel, .pl-question-panel, pl-number-input, .pl-number-input, [answers-name])') ||
                        document.querySelector('.card, pl-question-panel, .pl-question-panel');
      if (plPrimary && isElementVisible(plPrimary)) {
        const res = extractFromContainer(plPrimary, 'Heuristic: PrairieLearn');
        if (res && (res.questionText.trim().length > 5 || (res.blankInputs && res.blankInputs.length > 0))) {
          return res;
        }
      }
    }

    let plElements = [];
    try {
      plElements = Array.from(document.querySelectorAll(
        'pl-question-panel, .pl-question-panel, pl-number-input, .pl-number-input, pl-string-input, .pl-string-input, ' +
        'pl-symbolic-input, .pl-symbolic-input, pl-integer-input, .pl-integer-input, pl-matrix-input, .pl-matrix-input, ' +
        '[answers-name], form.question-form, .question-container'
      )).filter(isElementVisible);
    } catch (_) {
      plElements = Array.from(document.querySelectorAll('pl-question-panel, .pl-question-panel, form.question-form, .question-container')).filter(isElementVisible);
    }

    if (plElements.length > 0) {
      const plContainers = new Set();
      for (const el of plElements) {
        // Find enclosing card or form that contains BOTH the question prompt and inputs
        const container = el.closest('.question-container, form.question-form, form[name="question-form"], .card, [data-testid="question"]') || el.parentElement || el;
        if (container && isElementVisible(container) && !containsMultipleQuestions(container)) {
          plContainers.add(container);
        }
      }

      const plList = Array.from(plContainers);
      if (plList.length > 0) {
        plList.sort((a, b) => scoreCandidate(b) - scoreCandidate(a));
        for (const plContainer of plList) {
          const res = extractFromContainer(plContainer, 'Heuristic: PrairieLearn');
          if (res && (res.questionText.trim().length > 5 || (res.blankInputs && res.blankInputs.length > 0))) {
            return res;
          }
        }
      }
    }

    // 3. Well-known quiz containers
    const commonQuizSelectors = [
      '.problem',
      '.problem-wrapper',
      '.wrapper-problem-response',
      'div[id^="problem_"]',
      'div[data-block-type="problem"]',
      '.xblock-student_view-problem',
      '.question-container',
      '.quiz-question',
      '.question-card',
      '.question_holder',
      '.display_question',
      '.test-question',
      '.exam-question',
      '[data-question]',
      '[data-testid*="question"]',
      '[data-testid*="quiz"]',
      '.rc-FormPartsQuestion',
      '.freebirdFormviewerViewNumberedItemContainer',
      '.quantumWizListviewerBaseItem',
      '.que',
      '.vtbegenerated',
      '.takeQuestionDiv',
      '.moodle-question',
      '.assessment-question',
      '.quiz-item',
      'fieldset.question',
      'fieldset',
      '[role="radiogroup"]',
      '[role="group"]',
      '.choicegroup'
    ];

    const candidates = [];
    const seenElements = new Set();

    for (const sel of commonQuizSelectors) {
      let elements = [];
      try {
        elements = Array.from(document.querySelectorAll(sel));
      } catch (_) {
        continue;
      }

      elements.forEach(el => {
        if (!isElementVisible(el)) return;

        // Resolve choices wrappers up to their actual question container
        const questionEl = resolveToQuestionContainer(el);
        if (!questionEl || !isElementVisible(questionEl) || seenElements.has(questionEl)) {
          return;
        }

        const rect = questionEl.getBoundingClientRect();
        if (rect.height >= 30 && rect.width >= 80) {
          seenElements.add(questionEl);
          candidates.push({ element: questionEl, selector: sel });
        }
      });
    }

    if (candidates.length > 0) {
      // Sort candidates by focus and viewport proximity
      candidates.sort((a, b) => scoreCandidate(b.element) - scoreCandidate(a.element));

      for (const cand of candidates) {
        const res = extractFromContainer(cand.element, `Heuristic: ${cand.selector}`);
        if (res && (res.questionText.trim().length > 8 || (res.hasVisualMedia && res.images.length > 0))) {
          return res;
        }
      }
    }

    // 4. Fallback: Search visible main content
    const mainRoots = [
      document.querySelector('main'),
      document.querySelector('article'),
      document.querySelector('[role="main"]'),
      document.querySelector('#content'),
      document.querySelector('.content'),
      document.body
    ].filter(el => el && isElementVisible(el));

    const root = mainRoots[0] || document.body;

    const textNodes = Array.from(root.querySelectorAll('h1, h2, h3, h4, h5, h6, p, div.q-text, div[class*="question"]')).filter(isElementVisible);
    textNodes.sort((a, b) => scoreCandidate(b) - scoreCandidate(a));

    for (const node of textNodes) {
      const t = extractCleanDomText(node);
      const isQuestionLike = (
        (t.includes('?') && t.length > 15 && t.length < 5000) ||
        /^(Question\s*\d+|Q\d+|^\d+[\.\)]\s+)/i.test(t) ||
        /^(Which of the following|What is|What are|How many|Select the|Calculate|Find the|Determine|True or False|Consider|Suppose|Assume|Given)/i.test(t)
      );

      if (isQuestionLike) {
        let parent = node.closest(
          '.problem, .problem-wrapper, .wrapper-problem-response, .xblock, [data-block-type="problem"], ' +
          '.question, .question-card, .quiz-question, .question-container, .question_holder, .display_question, ' +
          '.que, .rc-FormPartsQuestion, [data-testid*="question"], [data-testid*="quiz"], ' +
          'fieldset, form, .card, [role="listitem"], [role="region"], section, article'
        );

        if (!parent) {
          let curr = node.parentElement;
          while (curr && curr !== root && curr !== document.body && curr !== document.documentElement) {
            const hasInputsOrChoices = curr.querySelector('input[type="radio"], input[type="checkbox"], [role="radio"], [role="radiogroup"], .choice, .option, select, textarea');
            if (hasInputsOrChoices) {
              parent = curr;
              break;
            }
            curr = curr.parentElement;
          }
          if (!parent) parent = node.closest('section, form, div, article') || node.parentElement;
        }

        const res = extractFromContainer(parent, 'Heuristic: Text Pattern');
        if (res && (res.questionText.trim().length > 8 || (res.hasVisualMedia && res.images.length > 0))) {
          return res;
        }
      }
    }

    // 5. Fallback if visual media (canvas/diagram) exists prominently
    const hasCanvasOrLargeImg = detectVisualMedia(root);
    if (hasCanvasOrLargeImg) {
      const rootImages = extractImagesFromContainer(root);
      return {
        questionText: 'Visual question detected (Diagram/Canvas/Image).',
        options: [],
        optionsText: '',
        fullText: '[Visual/Diagram Question on active page]',
        selectorUsed: 'Heuristic: Visual Media Fallback',
        hasVisualMedia: true,
        images: rootImages,
        url: window.location.href,
        pageTitle: document.title
      };
    }

    return null;
  }

  function safeSendMessage(msg, callback) {
    try {
      chrome.runtime.sendMessage(msg, (response) => {
        if (chrome.runtime.lastError) {
          // Service worker might be sleeping
        }
        if (callback) callback(response);
      });
    } catch (_) {}
  }

  /**
   * Run extraction and notify background if question has changed
   */
  async function checkAndSendQuestion(force = false) {
    try {
      const extracted = await extractQuestion();
      if (!extracted) {
        if (force) {
          safeSendMessage({
            type: 'NO_QUESTION_FOUND',
            url: window.location.href
          });
        }
        return;
      }

      // Compute normalized question fingerprint
      const currentFp = getQuestionFingerprint(extracted);

      // Only notify background if this is a genuinely NEW question or forced re-solve
      if (force || currentFp !== lastQuestionFp) {
        lastQuestionFp = currentFp;
        try {
          sessionStorage.setItem(SESSION_STORAGE_KEY, currentFp);
        } catch (_) {}

        safeSendMessage({
          type: 'QUESTION_DETECTED',
          data: extracted,
          forced: force
        });
      }
    } catch (e) {
      console.warn('[QuestionHelper] Extraction error:', e);
    }
  }

  /**
   * Debounced check triggered by DOM mutations, scrolling, or user clicks
   */
  function scheduleCheck() {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      checkAndSendQuestion(false);
    }, DEBOUNCE_DELAY_MS);
  }

  // --- MutationObserver Setup ---
  const observer = new MutationObserver((mutations) => {
    let significantChange = false;
    for (const m of mutations) {
      if (m.type === 'childList' && (m.addedNodes.length > 0 || m.removedNodes.length > 0)) {
        significantChange = true;
        break;
      }
      if (m.type === 'characterData') {
        significantChange = true;
        break;
      }
    }

    if (significantChange) {
      scheduleCheck();
    }
  });

  if (document.body) {
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true
      });
    });
  }

  // Listen for navigation & clicks
  window.addEventListener('popstate', scheduleCheck);
  window.addEventListener('hashchange', scheduleCheck);

  // Debounced scroll listener: detects when user scrolls to next question on a multi-question test
  let scrollTimer = null;
  window.addEventListener('scroll', () => {
    if (scrollTimer) clearTimeout(scrollTimer);
    scrollTimer = setTimeout(scheduleCheck, 400);
  }, { passive: true });

  // Focus listener: immediately check when user clicks or focuses an input or radio choice
  document.addEventListener('focusin', () => {
    scheduleCheck();
  }, true);

  document.addEventListener('click', (e) => {
    const target = e.target;
    if (!target) return;
    const clickable = target.closest('button, a, input[type="button"], input[type="submit"], input[type="radio"], input[type="checkbox"], [role="button"], [role="radio"], [role="checkbox"], label');
    if (clickable) {
      const text = (clickable.innerText || clickable.value || '').toLowerCase();
      if (
        text.includes('next') ||
        text.includes('prev') ||
        text.includes('continue') ||
        text.includes('submit') ||
        text.includes('back') ||
        clickable.classList.contains('next') ||
        clickable.classList.contains('prev')
      ) {
        setTimeout(scheduleCheck, 200);
      } else {
        // Option selection or question card click
        setTimeout(scheduleCheck, 150);
      }
    }
  }, true);

  // --- Message Listener from Background / Side Panel ---
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'FORCE_EXTRACT') {
      checkAndSendQuestion(true).then(() => {
        sendResponse({ success: true });
      });
      return true;
    }

    if (message.type === 'GET_CURRENT_QUESTION') {
      extractQuestion().then((res) => {
        sendResponse({ data: res });
      });
      return true;
    }
  });

  // Initial check on load
  setTimeout(() => {
    checkAndSendQuestion(false);
  }, 300);

})();
