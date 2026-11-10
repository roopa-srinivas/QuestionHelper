/**
 * Question Helper - Content Script
 * Extracts practice questions, math formulas, code blocks, tables, and choices from the active tab.
 * High-fidelity extraction supporting PrairieLearn, Canvas, Blackboard, Moodle, and standard LMS.
 * Monitors DOM mutations, scrolling, and user focus to automatically track the current question.
 */

(() => {
  // Prevent duplicate injection. A copy left over from before the extension was reloaded has lost its
  // connection to the extension (chrome.runtime.id is gone), so a fresh copy takes over from it.
  if (window.__questionHelperAlive && window.__questionHelperAlive()) return;
  window.__questionHelperAlive = () => {
    try {
      return !!(chrome.runtime && chrome.runtime.id);
    } catch (_) {
      return false;
    }
  };

  // Track question fingerprint across in-memory changes and full page reloads
  const SESSION_STORAGE_KEY = '__qh_active_question_fp';
  let lastQuestionFp = '';
  try {
    lastQuestionFp = sessionStorage.getItem(SESSION_STORAGE_KEY) || '';
  } catch (_) {}

  let debounceTimer = null;
  const DEBOUNCE_DELAY_MS = 400;

  // A question the student chose on the page: { element } from the 🎯 picker or { range } from a
  // text selection, plus the url it was chosen on. See "Choosing the question" below.
  let pinned = null;
  let picker = null;

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
        // MathJax 2 renders the formula in the element just before its script; drop it so the math isn't doubled
        const rendered = scriptEl.previousElementSibling;
        if (rendered && rendered.matches('.MathJax, .MathJax_Display, .MathJax_SVG, .MathJax_SVG_Display, .MathJax_CHTML')) {
          rendered.remove();
        }
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
  const VISUAL_MEDIA_SELECTOR = 'canvas, img:not([alt*="avatar"]):not([class*="icon"]):not([src*="logo"]), svg:not([class*="icon"]), iframe';

  function detectVisualMedia(container) {
    if (!container) return false;
    return hasVisibleMedia(container.querySelectorAll(VISUAL_MEDIA_SELECTOR));
  }

  function hasVisibleMedia(medias) {
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
    return imagesFromElements(container.querySelectorAll('canvas'), container.querySelectorAll('img'), 4);
  }

  function imagesFromElements(canvases, imgs, limit = 4) {
    const images = [];
    const seenData = new Set();

    // 1. HTML5 Canvas diagrams
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

    return images.slice(0, limit);
  }

  /**
   * Turn inline <svg> diagrams into PNG images the model can see. Page CSS doesn't travel with
   * a serialized SVG, so the computed colors, strokes and fonts are copied onto the copy first.
   */
  const SVG_STYLE_PROPS = ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-opacity',
    'opacity', 'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor', 'dominant-baseline', 'color'];

  async function svgToImage(svg) {
    if (!isElementVisible(svg)) return null;
    const rect = svg.getBoundingClientRect();
    if (rect.width < 40 || rect.height < 40) return null;
    if (/icon|logo/i.test(svg.getAttribute('class') || '') || svg.closest('button, a[role="button"]')) return null;

    const clone = svg.cloneNode(true);
    const liveEls = [svg, ...svg.querySelectorAll('*')];
    const cloneEls = [clone, ...clone.querySelectorAll('*')];
    liveEls.forEach((el, i) => {
      const cs = window.getComputedStyle(el);
      const target = cloneEls[i];
      if (!target) return;
      SVG_STYLE_PROPS.forEach(prop => {
        const value = cs.getPropertyValue(prop);
        if (value) target.style.setProperty(prop, value);
      });
    });
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('width', String(rect.width));
    clone.setAttribute('height', String(rect.height));

    try {
      const xml = new XMLSerializer().serializeToString(clone);
      const img = new Image();
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
      await img.decode();
      const scale = Math.min(2, 1600 / Math.max(rect.width, rect.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(rect.width * scale);
      canvas.height = Math.round(rect.height * scale);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/png');
      const title = svg.querySelector('title')?.textContent?.trim() || svg.getAttribute('aria-label') || 'SVG Diagram';
      return { mimeType: 'image/png', data: dataUrl.split(',')[1], type: 'svg', description: title };
    } catch (_) {
      return null;
    }
  }

  /** Add rasterized SVG diagrams to an extracted question, up to `limit` images in total. */
  async function addSvgImages(result, svgs, limit) {
    for (const svg of svgs) {
      if (result.images.length >= limit) break;
      // Skip SVGs nested in another SVG (the outer one already includes them)
      if (svg.parentElement && svg.parentElement.closest('svg')) continue;
      const image = await svgToImage(svg);
      if (image) {
        result.images.push(image);
        result.hasVisualMedia = true;
      }
    }
    return result;
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
  const CHOICE_SELECTORS = [
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

  /**
   * Where a question is read from: a page element (automatic detection, the 🎯 picker)
   * or a text selection. Both give live elements to inspect and a detached copy for text.
   */
  function containerScope(container, label) {
    return {
      label,
      queryAll: sel => Array.from(container.querySelectorAll(sel)),
      labelFor: id => container.querySelector(`label[for="${CSS.escape(id)}"]`),
      cloneForText: () => container.cloneNode(true),
      useDedicatedStem: true,
      imageLimit: 4
    };
  }

  function extractFromContainer(container, selectorLabel) {
    if (!container || !isElementVisible(container)) return null;
    return extractFromScope(containerScope(container, selectorLabel));
  }

  function extractFromScope(scope) {
    const selectorLabel = scope.label;
    const choiceSelectors = CHOICE_SELECTORS;

    // Check for radio and checkbox inputs directly if present
    const inputs = scope.queryAll('input[type="radio"], input[type="checkbox"]').filter(isElementVisible);
    let optionNodes = [];
    if (inputs.length > 0) {
      optionNodes = inputs.map(inp => {
        const id = inp.id;
        const label = id ? scope.labelFor(id) : null;
        return label || inp.closest('label') || inp.parentElement || inp;
      });
    } else {
      optionNodes = scope.queryAll(choiceSelectors.join(', ')).filter(isElementVisible);
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

    // (A selection is read exactly as selected, so it skips this)
    let dedicatedStem = '';
    for (const sel of (scope.useDedicatedStem ? promptContainerSelectors : [])) {
      const promptEl = scope.queryAll(sel)[0];
      if (promptEl && isElementVisible(promptEl)) {
        const text = extractCleanDomText(promptEl);
        if (text && text.length > 10) {
          dedicatedStem = text;
          break;
        }
      }
    }

    // 2. Clone entire container and strip choices, buttons, and navigation to get complete question
    const clone = scope.cloneForText();

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
        const lbl = clone.querySelector(`label[for="${CSS.escape(id)}"]`);
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
    const plInputEls = scope.queryAll(
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
      const rawInputs = scope.queryAll(
        'input[type="text"]:not([readonly]), input[type="number"]:not([readonly]), input:not([type]):not([readonly])'
      ).filter(isElementVisible);

      rawInputs.forEach(inp => {
        // Exclude search, buttons, radio, checkbox, csrf tokens
        if (/search|btn|submit|filter|nav|csrf|token/i.test(inp.name || inp.className || inp.id)) return;
        let name = (inp.name || inp.id || `field_${blankInputs.length + 1}`).replace(/^_q_submission_/, '');
        if (!seenInputNames.has(name)) {
          seenInputNames.add(name);
          const parentGroup = inp.closest('.input-group, .form-group, .pl-number-input, .pl-string-input');
          const label = parentGroup?.querySelector('.pl-number-input-label, .pl-input-label, .input-group-prepend, .input-group-text:first-child')?.textContent?.trim() ||
                        (inp.id ? scope.labelFor(inp.id)?.textContent?.trim() : '') || '';
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

    const hasMedia = hasVisibleMedia(scope.queryAll(VISUAL_MEDIA_SELECTOR));
    const images = imagesFromElements(scope.queryAll('canvas'), scope.queryAll('img'), scope.imageLimit);

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
    // A question the student picked stays put: scrolling, focus and page changes don't replace it
    if (pinned) {
      if (pinnedIsAlive()) {
        if (force) await sendPinnedQuestion();
        return;
      }
      // The picked question left the page (or the page navigated): go back to automatic detection
      unpinQuestion();
      force = true;
    }

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

  // --- Question picker: the student chooses which question on the page to work on ---

  const PICKED_LABEL = 'Picked by you';
  const KNOWN_QUESTION_SELECTOR =
    '.problem, .problem-wrapper, .wrapper-problem-response, div[id^="problem_"], [data-block-type="problem"], ' +
    '.question-container, .quiz-question, .question-card, .question_holder, .display_question, .test-question, ' +
    '[data-question], [data-testid*="question"], .rc-FormPartsQuestion, .freebirdFormviewerViewNumberedItemContainer, ' +
    '.que, .takeQuestionDiv, .moodle-question, .assessment-question, .quiz-item, fieldset.question, ' +
    'pl-question-panel, .pl-question-panel, form.question-form';

  const SELECTION_LABEL = 'Your selection';
  const PINNED_IMAGE_LIMIT = 8;

  function pinnedIsAlive() {
    if (!pinned || window.location.href !== pinned.url) return false;
    if (pinned.result) return true; // text selected inside a text box: kept as read
    if (pinned.element) return pinned.element.isConnected;
    const r = pinned.range;
    return r.startContainer.isConnected && r.endContainer.isConnected && !r.collapsed;
  }

  /** Read the pinned question again, with every image and SVG diagram in it. */
  async function extractPinned() {
    if (pinned.result) return pinned.result;
    if (pinned.range) return extractFromRange(pinned.range, pinned.text);
    const res = extractFromScope({ ...containerScope(pinned.element, PICKED_LABEL), imageLimit: PINNED_IMAGE_LIMIT });
    return res ? addSvgImages(res, pinned.element.querySelectorAll('svg'), PINNED_IMAGE_LIMIT) : null;
  }

  async function sendPinnedQuestion() {
    if (!pinned || (pinned.element && !isElementVisible(pinned.element))) return false;
    const res = await extractPinned();
    if (!res) return false;
    lastQuestionFp = getQuestionFingerprint(res);
    safeSendMessage({ type: 'QUESTION_DETECTED', data: res, forced: true, picked: true });
    return true;
  }

  function unpinQuestion() {
    pinned = null;
  }

  // --- Reading a text selection ---

  /** Elements inside the selection that match a selector (used to find its images). */
  function elementsInRange(range, selector) {
    const common = range.commonAncestorContainer;
    const root = common.nodeType === Node.ELEMENT_NODE ? common : common.parentElement;
    if (!root) return [];
    return Array.from(root.querySelectorAll(selector)).filter(el => {
      try { return range.intersectsNode(el); } catch (_) { return false; }
    });
  }

  /**
   * The selection exactly as selected, plus any images and diagrams inside it. `text` is the selection's
   * text as Chrome shows it (Selection.toString(), captured when it was made), which unlike Range.toString()
   * keeps line breaks between blocks and leaves out hidden text.
   */
  async function extractFromRange(range, text) {
    text = normalizeExtractedText(text || range.toString());
    const images = imagesFromElements(elementsInRange(range, 'canvas'), elementsInRange(range, 'img'), PINNED_IMAGE_LIMIT);
    const res = { ...textOnlyQuestion(text), images, hasVisualMedia: images.length > 0 };
    return addSvgImages(res, elementsInRange(range, 'svg'), PINNED_IMAGE_LIMIT);
  }

  function hasContent(res) {
    return !!res && !!(res.questionText.trim() || res.images.length);
  }

  // Remember the last selection made on the page: some pages clear it when focus moves to the side panel
  const REMEMBERED_SELECTION_MS = 10 * 60 * 1000;
  let lastSelection = null;   // { range, text, at }
  let lastFieldSelection = null; // { text, at } for text selected inside a text box

  document.addEventListener('selectionchange', () => {
    // Runs on every click and caret move, so skip the (slower) shadow DOM lookup here
    const live = liveSelection(false);
    if (live) lastSelection = { ...live, at: Date.now() };
  });
  document.addEventListener('select', (e) => {
    const text = fieldSelectionText(e.target);
    if (text) lastFieldSelection = { text, at: Date.now() };
  }, true);

  /** All open shadow roots on the page, so selections inside web components can be read too. */
  function openShadowRoots() {
    const roots = [];
    const walk = (root) => {
      root.querySelectorAll('*').forEach(el => {
        if (el.shadowRoot) {
          roots.push(el.shadowRoot);
          walk(el.shadowRoot);
        }
      });
    };
    walk(document);
    return roots;
  }

  /** The current selection as { range, text }, or null if nothing is selected. */
  function liveSelection(includeShadow = true) {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0);
    if (!sel.isCollapsed && !range.collapsed) return { range: range.cloneRange(), text: sel.toString() };

    // Selections inside a shadow root are only visible through getComposedRanges (Chrome 137+)
    if (includeShadow && typeof sel.getComposedRanges === 'function') {
      try {
        const roots = openShadowRoots();
        if (roots.length > 0) {
          const [composed] = sel.getComposedRanges({ shadowRoots: roots });
          if (composed && !composed.collapsed) {
            const r = document.createRange();
            r.setStart(composed.startContainer, composed.startOffset);
            r.setEnd(composed.endContainer, composed.endOffset);
            if (!r.collapsed) return { range: r, text: sel.toString() || r.toString() };
          }
        }
      } catch (_) {}
    }
    return null;
  }

  function fieldSelectionText(el) {
    if (!el || !(el.tagName === 'TEXTAREA' || el.tagName === 'INPUT')) return '';
    try {
      if (typeof el.selectionStart !== 'number' || el.selectionEnd <= el.selectionStart) return '';
      return el.value.slice(el.selectionStart, el.selectionEnd).trim();
    } catch (_) {
      return ''; // Some input types (number, email) don't expose a selection
    }
  }

  function isFresh(entry) {
    return entry && Date.now() - entry.at < REMEMBERED_SELECTION_MS;
  }

  /** What the student selected: a live selection, a remembered one, or text selected in a text box. */
  function findSelection() {
    // Text selected inside a text box comes first: Chrome reports the box itself as the page selection
    const fieldText = fieldSelectionText(document.activeElement);
    if (fieldText) return { text: fieldText };
    const live = liveSelection();
    if (live) return live;
    if (isFresh(lastSelection) && lastSelection.range.startContainer.isConnected && !lastSelection.range.collapsed) {
      return { range: lastSelection.range, text: lastSelection.text };
    }
    if (isFresh(lastFieldSelection)) return { text: lastFieldSelection.text };
    return null;
  }

  function textOnlyQuestion(text) {
    return {
      questionText: text,
      options: [],
      optionsText: '',
      fullText: text,
      selectorUsed: SELECTION_LABEL,
      hasVisualMedia: false,
      images: [],
      blankInputs: [],
      isFillInBlank: false,
      url: window.location.href,
      pageTitle: document.title
    };
  }

  async function useSelection() {
    const found = findSelection();
    if (!found) {
      return {
        ok: false,
        noSelection: true,
        error: 'No selection found. Drag across the question\'s text, choices and any diagrams, then click T (or right-click the selection → Help with this selection).'
      };
    }

    let res;
    let range = null;
    if (found.range) {
      range = found.range;
      res = await extractFromRange(range, found.text);
    } else {
      res = textOnlyQuestion(found.text);
    }
    if (!hasContent(res)) {
      return {
        ok: false,
        error: "Your selection has no text the extension can read. Some pages (Google Docs, PDFs, some quiz apps) draw text as images. Use Capture Tab (the camera icon), or paste the question in."
      };
    }

    if (picker) finishPicker(null);
    pinned = range ? { range, text: found.text, url: window.location.href } : { result: res, url: window.location.href };
    lastQuestionFp = getQuestionFingerprint(res);
    safeSendMessage({ type: 'QUESTION_DETECTED', data: res, forced: true, picked: true });
    return { ok: true, images: res.images.length, options: res.options.length };
  }

  function visibleTextLength(el) {
    return ((el.innerText || el.textContent || '').trim()).length;
  }

  /** Ancestors of the hovered element, innermost first, stopping before any that hold several questions. */
  function pickChain(target) {
    const chain = [];
    let el = target;
    while (el && el !== document.body && el !== document.documentElement) {
      if (chain.length > 0 && containsMultipleQuestions(el)) break;
      chain.push(el);
      el = el.parentElement;
    }
    return chain;
  }

  /** Best guess at the question around the hovered element, as an index into its chain. */
  function defaultPickIndex(chain) {
    let idx = chain.findIndex(el => el.matches(KNOWN_QUESTION_SELECTOR));
    if (idx === -1) {
      idx = chain.findIndex(el => visibleTextLength(el) >= 40 &&
        (el.querySelector('input, select, textarea, [role="radio"], [role="checkbox"]') || /\?/.test(el.innerText || '')));
    }
    if (idx === -1) idx = chain.findIndex(el => visibleTextLength(el) >= 20);
    if (idx === -1) return 0;
    // A choices-only block grows to include its question stem
    const resolved = resolveToQuestionContainer(chain[idx]);
    const resolvedIdx = chain.indexOf(resolved);
    return resolvedIdx > idx ? resolvedIdx : idx;
  }

  function positionOverlay() {
    if (!picker) return;
    const el = picker.chain[picker.index];
    if (!el) {
      picker.overlay.style.display = 'none';
      return;
    }
    const r = el.getBoundingClientRect();
    Object.assign(picker.overlay.style, {
      display: 'block',
      top: `${r.top - 4}px`,
      left: `${r.left - 4}px`,
      width: `${r.width + 8}px`,
      height: `${r.height + 8}px`
    });
  }

  function isInsideBanner(e) {
    return picker && e.composedPath().includes(picker.bannerHost);
  }

  function onPickerHover(e) {
    if (!picker || isInsideBanner(e) || e.target === picker.hoverTarget) return;
    picker.hoverTarget = e.target;
    picker.chain = pickChain(e.target);
    picker.index = defaultPickIndex(picker.chain);
    positionOverlay();
  }

  function swallow(e) {
    if (!picker || isInsideBanner(e)) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  }

  function onPickerClick(e) {
    if (!picker || isInsideBanner(e)) return;
    swallow(e);
    const el = picker.chain[picker.index];
    if (el) finishPicker(el);
  }

  function onPickerKey(e) {
    if (!picker) return;
    if (e.key === 'Escape') {
      swallow(e);
      finishPicker(null);
    } else if (e.key === 'ArrowUp' && picker.index < picker.chain.length - 1) {
      swallow(e);
      picker.index++;
      positionOverlay();
    } else if (e.key === 'ArrowDown' && picker.index > 0) {
      swallow(e);
      picker.index--;
      positionOverlay();
    } else if (e.key === 'Enter' && picker.chain[picker.index]) {
      swallow(e);
      finishPicker(picker.chain[picker.index]);
    }
  }

  const PICKER_EVENTS = [
    ['mouseover', onPickerHover],
    ['click', onPickerClick],
    ['mousedown', swallow],
    ['mouseup', swallow],
    ['pointerdown', swallow],
    ['pointerup', swallow],
    ['dblclick', swallow],
    ['keydown', onPickerKey]
  ];

  function startPicker() {
    if (picker) return;

    const overlay = document.createElement('div');
    overlay.style.cssText = 'all: initial; position: fixed; display: none; z-index: 2147483646; pointer-events: none; ' +
      'box-sizing: border-box; border: 2px solid #6366f1; border-radius: 8px; background: rgba(99, 102, 241, 0.08); ' +
      'box-shadow: 0 0 0 4px rgba(99, 102, 241, 0.18); transition: top 60ms, left 60ms, width 60ms, height 60ms;';

    const bannerHost = document.createElement('div');
    bannerHost.style.cssText = 'all: initial; position: fixed; top: 12px; left: 50%; transform: translateX(-50%); z-index: 2147483647;';
    const shadow = bannerHost.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        .bar { display: flex; align-items: center; gap: 12px; padding: 10px 12px 10px 16px; border-radius: 12px;
          background: #ffffff; color: #0f172a; border: 1px solid #c7d2fe; box-shadow: 0 8px 24px rgba(15, 23, 42, 0.18);
          font: 500 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; max-width: min(640px, calc(100vw - 32px)); }
        .hint { color: #475569; font-size: 12px; }
        kbd { font: 600 11px system-ui, sans-serif; background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 4px; padding: 0 4px; }
        button { font: 600 12px system-ui, sans-serif; color: #4338ca; background: #eef2ff; border: none; border-radius: 8px;
          padding: 6px 10px; cursor: pointer; white-space: nowrap; }
        button:hover { background: #e0e7ff; }
      </style>
      <div class="bar" role="status">
        <div>🎯 <strong>Click the question you want help with.</strong>
          <div class="hint"><kbd>↑</kbd> select more · <kbd>↓</kbd> select less · <kbd>Esc</kbd> cancel</div></div>
        <button type="button">Cancel</button>
      </div>`;
    shadow.querySelector('button').addEventListener('click', () => finishPicker(null));

    document.documentElement.append(overlay, bannerHost);
    picker = { overlay, bannerHost, chain: [], index: 0, hoverTarget: null };

    PICKER_EVENTS.forEach(([type, fn]) => window.addEventListener(type, fn, true));
    window.addEventListener('scroll', positionOverlay, true);
    window.addEventListener('resize', positionOverlay);
  }

  async function finishPicker(chosen) {
    if (!picker) return;
    PICKER_EVENTS.forEach(([type, fn]) => window.removeEventListener(type, fn, true));
    window.removeEventListener('scroll', positionOverlay, true);
    window.removeEventListener('resize', positionOverlay);
    picker.overlay.remove();
    picker.bannerHost.remove();
    picker = null;

    if (!chosen) {
      safeSendMessage({ type: 'PICKER_ENDED', picked: false });
      return;
    }
    pinned = { element: chosen, url: window.location.href };
    const ok = await sendPinnedQuestion();
    if (!ok) unpinQuestion();
    safeSendMessage({
      type: 'PICKER_ENDED',
      picked: ok,
      error: ok ? null : "Couldn't read a question there. Try clicking closer to the question's text, press ↑ to select more, or click 📋 to paste it in."
    });
  }

  // --- Message Listener from Background / Side Panel ---
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'FORCE_EXTRACT') {
      checkAndSendQuestion(true).then(() => {
        sendResponse({ success: true });
      });
      return true;
    }

    if (message.type === 'GET_CURRENT_QUESTION') {
      (pinnedIsAlive() ? extractPinned() : extractQuestion()).then((res) => {
        sendResponse({ data: res });
      });
      return true;
    }

    if (message.type === 'USE_SELECTION') {
      useSelection().then(sendResponse).catch((err) => {
        console.warn('[QuestionHelper] Could not read the selection:', err);
        sendResponse({ ok: false, error: `Couldn't read that selection (${err.message || err}).` });
      });
      return true;
    }

    if (message.type === 'START_PICKER') {
      startPicker();
      sendResponse({ started: true });
      return;
    }

    if (message.type === 'CANCEL_PICKER') {
      finishPicker(null);
      sendResponse({ cancelled: true });
      return;
    }

    if (message.type === 'UNPIN_QUESTION') {
      unpinQuestion();
      checkAndSendQuestion(true).then(() => sendResponse({ unpinned: true }));
      return true;
    }
  });

  // Initial check on load
  setTimeout(() => {
    checkAndSendQuestion(false);
  }, 300);

})();
