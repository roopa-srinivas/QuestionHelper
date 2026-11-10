/**
 * Question Helper - Course Materials (Settings page)
 * Reads uploaded PDFs / notes into page-tagged text with pdf.js and stores them in
 * chrome.storage.local. The side panel picks which ones are being studied.
 */

import * as pdfjsLib from './lib/pdfjs/pdf.min.mjs';
import { extractPdfPages, buildMaterial, guessTitle, splitTextIntoPages } from './lib/course-materials.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('lib/pdfjs/pdf.worker.min.mjs');

const courseInput = document.getElementById('materialCourseInput');
const courseList = document.getElementById('materialCourseList');
const fileInput = document.getElementById('materialFileInput');
const btnAdd = document.getElementById('btnAddMaterials');
const statusEl = document.getElementById('materialsStatus');
const listEl = document.getElementById('materialsList');

function setStatus(text, kind = '') {
  if (!text) {
    statusEl.classList.add('hidden');
    return;
  }
  statusEl.textContent = text;
  statusEl.className = `validation-result ${kind}`.trim();
}

async function loadMaterials() {
  const { courseMaterials = [], studyingMaterialIds = [] } =
    await chrome.storage.local.get(['courseMaterials', 'studyingMaterialIds']);
  return { materials: courseMaterials, studying: studyingMaterialIds };
}

function pageRange(m) {
  if (!m.pages.length) return '';
  const first = m.pages[0].label;
  const last = m.pages[m.pages.length - 1].label;
  if (!m.printedPageNumbers) return `${m.pages.length} pages`;
  return first === last ? `p. ${first}` : `pp. ${first}–${last}`;
}

async function render() {
  const { materials } = await loadMaterials();
  listEl.textContent = '';

  const courses = Array.from(new Set(materials.map(m => m.course || 'Other')));
  courseList.textContent = '';
  courses.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c;
    courseList.appendChild(opt);
  });

  if (materials.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'materials-empty';
    empty.textContent = 'No course materials yet. Add a chapter above to get started.';
    listEl.appendChild(empty);
    return;
  }

  for (const course of courses) {
    const group = document.createElement('div');
    group.className = 'materials-course';
    const heading = document.createElement('h3');
    heading.textContent = course;
    group.appendChild(heading);

    for (const m of materials.filter(x => (x.course || 'Other') === course)) {
      const row = document.createElement('div');
      row.className = 'material-row';

      const title = document.createElement('input');
      title.type = 'text';
      title.className = 'material-title';
      title.value = m.title;
      title.title = `Rename (from ${m.fileName})`;
      title.setAttribute('aria-label', `Title for ${m.fileName}`);
      title.addEventListener('change', () => renameMaterial(m.id, title.value));

      const meta = document.createElement('span');
      meta.className = 'material-meta';
      const pages = m.printedPageNumbers ? `${m.pages.length} pages · ${pageRange(m)}` : pageRange(m);
      meta.textContent = `${pages} · ~${Math.round(m.chars / 4 / 1000)}k tokens`;

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'btn-delete-rule';
      remove.textContent = 'Remove';
      remove.addEventListener('click', () => removeMaterial(m.id));

      row.append(title, meta, remove);
      group.appendChild(row);
    }
    listEl.appendChild(group);
  }
}

async function renameMaterial(id, newTitle) {
  const title = newTitle.trim();
  if (!title) return render();
  const { materials } = await loadMaterials();
  const m = materials.find(x => x.id === id);
  if (!m) return;
  m.title = title;
  await chrome.storage.local.set({ courseMaterials: materials });
}

async function removeMaterial(id) {
  const { materials, studying } = await loadMaterials();
  await chrome.storage.local.set({
    courseMaterials: materials.filter(m => m.id !== id),
    studyingMaterialIds: studying.filter(x => x !== id)
  });
  render();
}

async function readFile(file, index, total) {
  const prefix = total > 1 ? `(${index + 1}/${total}) ` : '';
  if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') {
    const data = new Uint8Array(await file.arrayBuffer());
    return extractPdfPages(pdfjsLib, data, (page, pages) => {
      setStatus(`${prefix}Reading ${file.name}: page ${page} of ${pages}...`);
    });
  }
  setStatus(`${prefix}Reading ${file.name}...`);
  return splitTextIntoPages(await file.text());
}

btnAdd.addEventListener('click', async () => {
  const course = courseInput.value.trim();
  const files = Array.from(fileInput.files || []);
  if (!course) {
    setStatus('Enter the course these materials are for, e.g. CS 169A.', 'error');
    courseInput.focus();
    return;
  }
  if (files.length === 0) {
    setStatus('Choose one or more PDF, .txt or .md files.', 'error');
    return;
  }

  btnAdd.disabled = true;
  const added = [];
  const problems = [];
  try {
    for (const [i, file] of files.entries()) {
      try {
        const pageTexts = await readFile(file, i, files.length);
        const material = buildMaterial({
          id: crypto.randomUUID(),
          course,
          fileName: file.name,
          pageTexts,
          title: guessTitle(file.name, pageTexts)
        });
        if (material.chars < 200) {
          problems.push(`${file.name} has no readable text (it may be a scanned PDF)`);
          continue;
        }
        added.push(material);
      } catch (err) {
        console.warn('[QuestionHelper] Could not read', file.name, err);
        problems.push(`${file.name} could not be read (${err.message || err})`);
      }
    }

    if (added.length > 0) {
      const { materials, studying } = await loadMaterials();
      // New materials are what you're studying now, so select them in the side panel
      await chrome.storage.local.set({
        courseMaterials: [...materials, ...added],
        studyingMaterialIds: [...studying, ...added.map(m => m.id)]
      });
    }

    fileInput.value = '';
    await render();
    const summary = added.length
      ? `Added ${added.map(m => m.title).join(', ')}. They're selected in the side panel.`
      : '';
    if (problems.length) {
      setStatus([summary, ...problems].filter(Boolean).join(' '), 'error');
    } else {
      setStatus(summary, 'success');
    }
  } finally {
    btnAdd.disabled = false;
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.courseMaterials && !listEl.contains(document.activeElement)) render();
});

render();
