/* Learnova — local-first AI study companion. Data lives in this browser (IndexedDB). */
'use strict';
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
// Same DB name as the old "Study Vault" build so existing subjects/notes carry over automatically.
const DB_NAME = 'study-vault-db', DB_VERSION = 3;
const STORES = ['subjects', 'tasks', 'materials', 'notes', 'mistakes', 'settings', 'cards', 'chats'];
const PALETTE = ['#4f46e5', '#db2777', '#0891b2', '#16a34a', '#ea580c', '#9333ea', '#0d9488', '#e11d48'];
const MAX_SOURCE = 380000;
const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs';
const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs';
const TESSERACT = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';

let db, activeSubject = null, editingNote = null, editingMaterial = null, pasteMode = false;
let cameraStream = null, toastTimer = null;
const busy = new Set(), liveStatus = {};
let reviewQueue = [], reviewIndex = 0, currentQuiz = null;
const state = { subjects: [], tasks: [], materials: [], notes: [], mistakes: [], cards: [], chats: [], settings: { id: 'main', workerUrl: '', activity: [], quizHistory: [] } };

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const now = () => new Date().toISOString();
const dayKey = (d = new Date()) => { const z = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`; };
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 3200); }
function escapeHTML(s = '') { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function setStatus(sel, msg, error = false, spin = false) { const el = $(sel); if (!el) return; el.innerHTML = (spin ? '<span class="spin"></span>' : '') + escapeHTML(msg); el.classList.toggle('error', !!error); }
function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

/* ---------- IndexedDB ---------- */
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => { const d = req.result; for (const s of STORES) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: 'id' }); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Close other Learnova tabs and reload.'));
  });
}
const store = (name, mode = 'readonly') => db.transaction(name, mode).objectStore(name);
const getAll = name => new Promise((res, rej) => { const r = store(name).getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const put = (name, obj) => new Promise((res, rej) => { const r = store(name, 'readwrite').put(obj); r.onsuccess = () => res(obj); r.onerror = () => rej(r.error); });
const del = (name, id) => new Promise((res, rej) => { const r = store(name, 'readwrite').delete(id); r.onsuccess = () => res(); r.onerror = () => rej(r.error); });

async function refresh() {
  for (const k of ['subjects', 'tasks', 'materials', 'notes', 'mistakes', 'cards', 'chats']) state[k] = await getAll(k);
  const s = (await getAll('settings')).find(x => x.id === 'main') || {};
  state.settings = { id: 'main', workerUrl: '', activity: [], quizHistory: [], ...s };
  renderHome();
}
async function saveSettings() { state.settings.id = 'main'; await put('settings', state.settings); }
async function markActivity() { const k = dayKey(); if (!state.settings.activity.includes(k)) { state.settings.activity.push(k); state.settings.activity = state.settings.activity.slice(-400); await saveSettings(); renderHome(); } }

/* ---------- helpers ---------- */
const hash = s => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
const subjectColor = s => s.color || PALETTE[hash(s.name || '') % PALETTE.length];
const subjectMaterials = id => state.materials.filter(m => m.subjectId === id).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
const subjectNotes = id => state.notes.filter(n => n.subjectId === id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
const subjectCards = id => state.cards.filter(c => c.subjectId === id);
const dueCards = id => state.cards.filter(c => (!id || c.subjectId === id) && new Date(c.due) <= new Date());
const readable = list => list.filter(m => m.text && m.text.trim() && !m.text.startsWith('DOCX text extraction'));
function streak() {
  const set = new Set(state.settings.activity || []); let n = 0; const d = new Date();
  if (!set.has(dayKey(d))) d.setDate(d.getDate() - 1);
  while (set.has(dayKey(d))) { n++; d.setDate(d.getDate() - 1); }
  return n;
}
let workerOutdated = false; const WORKER_NEEDED = 4;
const OUTDATED_MSG = 'Your Cloudflare Worker still has OLD code, so it does not know this feature yet. Fix (2 minutes): Cloudflare → Workers & Pages → your worker → Edit code → select all and delete → paste the whole worker/index.js from the newest zip → press Deploy. Then try again.';
async function checkWorkerVersion() {
  const url = normUrl(state.settings.workerUrl); if (!url) { workerOutdated = false; return renderHome(); }
  try { const info = await (await fetch(url)).json(); workerOutdated = !!(info && info.app === 'Learnova AI Worker' && (info.version || 0) < WORKER_NEEDED); } catch { /* offline or blocked: say nothing here, the Settings test explains it */ }
  renderHome();
}
const hasWorker = () => !!(state.settings.workerUrl || '').trim();

/* ---------- Home ---------- */
function renderHome() {
  const h = new Date().getHours();
  $('#greeting').textContent = (h < 5 ? 'Late-night learning 🌙' : h < 12 ? 'Good morning ☀️' : h < 17 ? 'Good afternoon 🌤' : h < 21 ? 'Good evening 🌆' : 'Good night 🌙');
  $('#statStreak').textContent = streak();
  $('#statNotes').textContent = state.notes.length;
  $('#statDue').textContent = dueCards().length;
  const qh = (state.settings.quizHistory || []).slice(-10);
  $('#statQuiz').textContent = qh.length ? Math.round(qh.reduce((a, q) => a + q.score / q.total, 0) / qh.length * 100) + '%' : '–';
  $('#setupBanner').classList.toggle('hidden', hasWorker());
  $('#workerBanner').classList.toggle('hidden', !(hasWorker() && workerOutdated));
  const daysSince = state.settings.lastBackupAt ? (Date.now() - new Date(state.settings.lastBackupAt)) / 864e5 : Infinity;
  $('#backupBanner').classList.toggle('hidden', !((state.notes.length || state.materials.length) && daysSince > 14));
  const open = state.tasks.filter(t => !t.done).sort((a, b) => (Number(!!b.pinned) - Number(!!a.pinned)) || a.createdAt.localeCompare(b.createdAt));
  $('#taskList').innerHTML = open.length ? open.map(t => `<div class="task-item"><input type="checkbox" data-task-done="${t.id}" aria-label="Complete task"><span class="task-text">${escapeHTML(t.text)}</span><button class="smallbtn" data-act="task-pin" data-id="${t.id}">${t.pinned ? '📌' : 'Pin'}</button><button class="smallbtn" data-act="task-edit" data-id="${t.id}">Edit</button><button class="smallbtn" data-act="task-delete" data-id="${t.id}" aria-label="Delete">×</button></div>`).join('') : '<p>No open tasks. Add a reminder above.</p>';
  const subs = state.subjects.slice().sort((a, b) => a.name.localeCompare(b.name));
  $('#subjectList').innerHTML = subs.length ? subs.map(s => `<div class="subject-card" role="button" tabindex="0" style="--accent:${subjectColor(s)}" data-act="open-subject" data-id="${s.id}"><strong>📚 ${escapeHTML(s.name)}</strong><span class="subject-stats">${subjectMaterials(s.id).length} materials · ${subjectNotes(s.id).length} notes · ${subjectCards(s.id).length} cards</span><button class="subject-del" data-act="subject-delete" data-id="${s.id}" aria-label="Delete subject">Delete</button></div>`).join('') : '<div class="panel"><p>No subjects yet. Create your first subject above.</p></div>';
}

/* ---------- Markdown → coloured HTML (safe: everything is escaped first) ---------- */
function inlineMd(s) {
  s = escapeHTML(s);
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/==([^=]+?)==/g, '<mark>$1</mark>');
  return s;
}
const CALLOUTS = {
  definition: ['definition', '📘', 'Definition'], def: ['definition', '📘', 'Definition'],
  formula: ['formula', '🧮', 'Formula'], equation: ['formula', '🧮', 'Formula'], rule: ['formula', '🧮', 'Rule'],
  example: ['example', '🧪', 'Example'], key: ['key', '⭐', 'Key points'], important: ['key', '⭐', 'Important'], note: ['key', '⭐', 'Note'], summary: ['key', '⭐', 'Summary'],
  tip: ['tip', '🎯', 'Exam tip'], exam: ['tip', '🎯', 'Exam tip'], warning: ['warning', '⚠️', 'Common mistake'], mistake: ['warning', '⚠️', 'Common mistake'], caution: ['warning', '⚠️', 'Careful'],
  process: ['process', '🔀', 'Process'], flow: ['process', '🔀', 'Process'], flowchart: ['process', '🔀', 'Process'],
  extra: ['extra', '💡', 'Simple explanation (added to help you; not from your material)'], explain: ['extra', '💡', 'Simple explanation (added to help you; not from your material)']
};
function splitRow(r) { return r.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim()); }
const isTableSep = l => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l || '');
const listRe = /^(\s*)([-*•]|\d+[.)])\s+(.*)$/;
const blockStart = l => /^(#{1,4}\s|\s*>|```|\s*([-*_])\2{2,}\s*$)/.test(l) || listRe.test(l);
function renderList(items) {
  let html = '', stack = [];
  for (const it of items) {
    const tag = it.ordered ? 'ol' : 'ul';
    if (!stack.length || it.indent > stack[stack.length - 1].indent) { html += `<${tag}><li>${inlineMd(it.text)}`; stack.push({ indent: it.indent, tag }); }
    else { while (stack.length > 1 && it.indent < stack[stack.length - 1].indent) html += `</li></${stack.pop().tag}>`; html += `</li><li>${inlineMd(it.text)}`; }
  }
  while (stack.length) html += `</li></${stack.pop().tag}>`;
  return html;
}
function renderMarkdown(src) {
  const lines = String(src || '').replace(/\r/g, '').split('\n'); let html = '', i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (/^```/.test(line)) { const buf = []; i++; while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]); i++; html += `<pre><code>${escapeHTML(buf.join('\n'))}</code></pre>`; continue; }
    let m = line.match(/^(#{1,4})\s+(.*)$/);
    if (m) { const lv = Math.min(m[1].length, 3); html += `<h${lv}>${inlineMd(m[2])}</h${lv}>`; i++; continue; }
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) { html += '<hr>'; i++; continue; }
    if (/^\s*>/.test(line)) {
      const inner = []; while (i < lines.length && /^\s*>/.test(lines[i])) { const t = lines[i].replace(/^\s*>\s?/, ''); if (inner.length && /^\[!\w+\]/.test(t)) break; inner.push(t); i++; }
      const cm = (inner[0] || '').match(/^\[!(\w+)\]\s*(.*)$/);
      if (cm) { const def = CALLOUTS[cm[1].toLowerCase()] || CALLOUTS.key; html += `<div class="callout ${def[0]}"><div class="ctitle"><span>${def[1]}</span><span>${inlineMd(cm[2] || def[2])}</span></div>${renderMarkdown(inner.slice(1).join('\n'))}</div>`; }
      else html += `<div class="callout key">${renderMarkdown(inner.join('\n'))}</div>`;
      continue;
    }
    if (line.includes('|') && isTableSep(lines[i + 1])) {
      const head = splitRow(line); i += 2; const rows = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(splitRow(lines[i++]));
      html += `<div class="tablewrap"><table><thead><tr>${head.map(c => `<th>${inlineMd(c)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${head.map((_, k) => `<td>${inlineMd(r[k] || '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
      continue;
    }
    if (listRe.test(line)) {
      const items = []; while (i < lines.length && listRe.test(lines[i])) { const lm = lines[i].match(listRe); items.push({ indent: lm[1].replace(/\t/g, '  ').length, ordered: /\d/.test(lm[2]), text: lm[3] }); i++; }
      html += renderList(items); continue;
    }
    const para = [line]; i++;
    while (i < lines.length && lines[i].trim() && !blockStart(lines[i]) && !(lines[i].includes('|') && isTableSep(lines[i + 1]))) para.push(lines[i++]);
    html += `<p>${inlineMd(para.join(' '))}</p>`;
  }
  return html;
}
const plainPreview = md => String(md || '').replace(/^>\s*\[!\w+\]\s*/gm, '').replace(/[#>*=`|]/g, '').replace(/\s+/g, ' ').trim().slice(0, 220);

/* ---------- Subjects & dialog ---------- */
function renderSubjectViews() { if (!activeSubject) return; $('#subjectMeta').textContent = `${subjectMaterials(activeSubject).length} materials · ${subjectNotes(activeSubject).length} notes · ${subjectCards(activeSubject).length} cards`; renderMaterials(); renderSourcePicker(); renderNotes(); renderMistakes(); renderCardSummary(); }
function openSubject(id) {
  const s = state.subjects.find(x => x.id === id); if (!s) return;
  activeSubject = id; $('#subjectTitle').textContent = s.name;
  const c = subjectColor(s); $('#subjectDialog').style.setProperty('--accent', c); $('#noteDialog').style.setProperty('--accent', c);
  $('#quizArea').innerHTML = ''; $('#cardArea').innerHTML = ''; ['#quizStatus', '#cardStatus', '#aiStatus'].forEach(x => setStatus(x, ''));
  pickerSel = new Set(); pickerSeen = new Set(); $('#matSearch').value = ''; $('#noteSearch').value = '';
  renderSubjectViews(); $('#matGroup').open = subjectMaterials(id).length <= 5; $('#srcPicker').open = false; switchTab('materials'); $('#subjectDialog').showModal();
}
function switchTab(tab) { $$('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab)); ['materials', 'notes', 'cards', 'practice'].forEach(t => $('#' + t + 'Tab').classList.toggle('hidden', t !== tab)); }
/* ---------- Names, source picker, search ---------- */
const fmtDate = iso => new Date(iso).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
function titleFromText(text, fallback) { const line = String(text || '').split('\n').map(l => l.replace(/^[#>*\-\s\[\]0-9.|]+/, '').trim()).find(l => l.length >= 3); return line ? line.slice(0, 60) : fallback; }
function uniqueName(subjectId, name, exceptId) {
  const taken = new Set(state.materials.filter(m => m.subjectId === subjectId && m.id !== exceptId).map(m => m.name.toLowerCase())); const base = String(name || 'Untitled').slice(0, 70); let n = base, i = 2;
  while (taken.has(n.toLowerCase())) n = `${base} (${i++})`; return n;
}
let pickerSel = new Set(), pickerSeen = new Set();
function renderSourcePicker() {
  const list = subjectMaterials(activeSubject), ids = new Set(list.map(m => m.id));
  for (const id of [...pickerSel]) if (!ids.has(id)) pickerSel.delete(id);
  for (const m of list) { const can = readable([m]).length > 0; if (can && !pickerSeen.has(m.id)) { pickerSeen.add(m.id); pickerSel.add(m.id); } if (!can) pickerSel.delete(m.id); }
  const rd = list.filter(m => readable([m]).length > 0), n = rd.length, k = rd.filter(m => pickerSel.has(m.id)).length;
  $('#srcSummary').textContent = !list.length ? 'No materials yet' : k === n && n > 0 ? `All materials (${n})` : k === 0 ? 'Nothing selected' : `${k} of ${n} pages selected`;
  $('#srcList').innerHTML = list.length ? `<label class="pick-row all"><input type="checkbox" id="srcAll" ${k === n && n > 0 ? 'checked' : ''}><span>Include all (${n})</span></label>` + list.map(m => { const can = readable([m]).length > 0; return `<label class="pick-row ${can ? '' : 'off'}"><input type="checkbox" class="msel" data-id="${m.id}" ${can && pickerSel.has(m.id) ? 'checked' : ''} ${can ? '' : 'disabled'}><span>${m.url ? '🔗 ' : ''}${escapeHTML(m.name)}<small>${can ? fmtDate(m.createdAt) : (m.url ? 'link · paste its text to use it' : 'no readable text yet')}</small></span></label>`; }).join('') : '<p>Add a page first.</p>';
}
document.addEventListener('change', e => {
  if (e.target.matches('.msel')) { e.target.checked ? pickerSel.add(e.target.dataset.id) : pickerSel.delete(e.target.dataset.id); renderSourcePicker(); }
  else if (e.target.id === 'srcAll') { const rd = subjectMaterials(activeSubject).filter(m => readable([m]).length > 0); pickerSel = new Set(e.target.checked ? rd.map(m => m.id) : []); renderSourcePicker(); }
});
const kindIcon = m => m.url ? '🔗' : (m.mime || '').startsWith('image/') || /scan/i.test(m.kind || '') ? '🖼' : /pdf/i.test(m.mime || m.name) ? '📄' : '✎';
function renderMaterials() {
  const all = subjectMaterials(activeSubject), q = ($('#matSearch').value || '').trim().toLowerCase();
  const list = q ? all.filter(m => (m.name + ' ' + (m.text || '')).toLowerCase().includes(q)) : all;
  $('#matSummary').textContent = `📂 Pages & files (${all.length})`;
  $('#materialList').innerHTML = list.length ? list.map(m => {
    const isBusy = busy.has(m.id), chars = m.text && m.text.trim() ? m.text.trim().length : 0;
    const meta = isBusy ? `<span class="spin"></span>${escapeHTML(liveStatus[m.id] || 'Working…')}` : `${fmtDate(m.createdAt)} · ${chars ? chars.toLocaleString() + ' characters' : 'no readable text'}${m.ocrStatus ? ' · ' + escapeHTML(m.ocrStatus) : ''}`;
    return `<div class="material-item"><div class="material-main"><div class="material-name">${kindIcon(m)} ${escapeHTML(m.name)}</div><div class="material-meta">${meta}</div>${m.url ? `<a href="${escapeHTML(m.url)}" target="_blank" rel="noopener">Open link</a>` : ''}</div><div class="material-btns">${m.url ? '' : `<button class="smallbtn" data-act="material-review" data-id="${m.id}">Review</button>`}<button class="smallbtn" data-act="material-rename" data-id="${m.id}">Rename</button><button class="smallbtn" data-act="material-delete" data-id="${m.id}">Delete</button></div></div>`;
  }).join('') : `<p>${all.length ? 'No page matches your search.' : 'No material yet. Add a PDF, photo, scan, or paste text.'}</p>`;
}
function renderNotes() {
  const q = ($('#noteSearch').value || '').trim().toLowerCase(), all = subjectNotes(activeSubject);
  const list = q ? all.filter(n => (n.title + ' ' + n.content).toLowerCase().includes(q)) : all;
  $('#notesList').innerHTML = list.length ? list.map(n => `<div class="note-card"><h3>${escapeHTML(n.title)} <span class="pill">${n.isCopy ? 'MY COPY' : 'AI ORIGINAL'}</span></h3><div class="note-preview">${escapeHTML(plainPreview(n.content))}</div><div class="note-actions"><button class="primary" data-act="note-open" data-id="${n.id}">Open</button><button class="smallbtn" data-act="note-delete" data-id="${n.id}">Delete</button></div></div>`).join('') : `<p>${all.length ? 'No note matches your search.' : 'Notes you create will appear here, colour-coded and ready to revise.'}</p>`;
}
document.addEventListener('input', e => { if (e.target.id === 'matSearch') renderMaterials(); else if (e.target.id === 'noteSearch') renderNotes(); });
function renderMistakes() {
  const list = state.mistakes.filter(m => m.subjectId === activeSubject);
  $('#mistakesList').innerHTML = list.length ? list.map(m => `<div class="mistake-item"><strong>${escapeHTML(m.question)}</strong><p>Your answer: ${escapeHTML(m.chosen || 'Not answered')} · Correct: ${escapeHTML(m.answer)}</p></div>`).join('') : '<p>No mistakes saved yet. Great!</p>';
}

/* ---------- Forms & delegated events ---------- */
$('#subjectForm').addEventListener('submit', async e => {
  e.preventDefault(); const name = $('#subjectInput').value.trim(); if (!name) return;
  if (state.subjects.some(s => s.name.toLowerCase() === name.toLowerCase())) return toast('That subject already exists.');
  await put('subjects', { id: uid(), name, color: PALETTE[state.subjects.length % PALETTE.length], createdAt: now() }); $('#subjectInput').value = ''; await refresh();
});
$('#taskForm').addEventListener('submit', async e => { e.preventDefault(); const text = $('#taskInput').value.trim(); if (!text) return; await put('tasks', { id: uid(), text, done: false, pinned: false, createdAt: now() }); $('#taskInput').value = ''; await refresh(); });
document.addEventListener('change', async e => {
  const cb = e.target.closest('[data-task-done]'); if (!cb) return;
  const t = state.tasks.find(x => x.id === cb.dataset.taskDone); if (t) { t.done = true; t.completedAt = now(); await put('tasks', t); await refresh(); }
});
document.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('.subject-card')) { e.preventDefault(); openSubject(e.target.dataset.id); } });
document.addEventListener('click', async e => {
  const closeBtn = e.target.closest('[data-close]'); if (closeBtn) { $('#' + closeBtn.dataset.close).close(); return; }
  const tabBtn = e.target.closest('[data-tab]'); if (tabBtn) return switchTab(tabBtn.dataset.tab);
  const el = e.target.closest('[data-act]'); if (!el) return;
  const act = el.dataset.act, id = el.dataset.id;
  if (act === 'subject-delete') { e.stopPropagation(); const s = state.subjects.find(x => x.id === id); if (s && confirm(`Delete "${s.name}" with all its materials, notes and cards?`)) { for (const k of ['materials', 'notes', 'cards', 'mistakes']) for (const x of state[k].filter(y => y.subjectId === id)) await del(k, x.id); await del('subjects', id); await refresh(); } return; }
  if (act === 'open-subject') return openSubject(id);
  if (act === 'task-pin') { const t = state.tasks.find(x => x.id === id); t.pinned = !t.pinned; await put('tasks', t); return refresh(); }
  if (act === 'task-edit') { const t = state.tasks.find(x => x.id === id); const v = prompt('Edit task', t.text); if (v !== null && v.trim()) { t.text = v.trim(); await put('tasks', t); await refresh(); } return; }
  if (act === 'task-delete') { if (confirm('Delete this task?')) { await del('tasks', id); await refresh(); } return; }
  if (act === 'material-delete') { if (confirm('Delete this material and its extracted text?')) { await del('materials', id); await refresh(); renderSubjectViews(); } return; }
  if (act === 'material-review') return openMaterialText(id);
  if (act === 'material-rename') { const m = state.materials.find(x => x.id === id); const v = prompt('Rename this page', m.name); if (v && v.trim()) { m.name = uniqueName(m.subjectId, v.trim(), m.id); m.userNamed = true; await put('materials', m); await refresh(); renderSubjectViews(); } return; }
  if (act === 'note-open') return openNote(id);
  if (act === 'note-delete') { if (confirm('Delete this note?')) { await del('notes', id); await refresh(); renderSubjectViews(); } return; }
  if (act === 'card-flip') { const fc = $('#flipcard'); const c = reviewQueue[reviewIndex]; const showBack = !fc.classList.contains('back'); fc.classList.toggle('back', showBack); fc.textContent = showBack ? c.back : c.front; $('#rateRow').classList.toggle('hidden', !showBack); return; }
  if (act === 'card-rate') return rateCard(el.dataset.rate);
});
$('#bannerSettings').addEventListener('click', () => $('#settingsBtn').click());
$('#backupNowBtn').addEventListener('click', () => $('#exportBtn').click());

/* ---------- Extraction: text, DOCX, PDF, images (Gemini Vision OCR) ---------- */
function loadScript(src) { return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load ' + src)); document.head.appendChild(s); }); }
function blobToBase64(blob) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = () => rej(r.error); r.readAsDataURL(blob); }); }
async function prepImage(blob, maxDim = 2000) {
  let bmp; try { bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' }); } catch { bmp = await createImageBitmap(blob); }
  const srcW = bmp.width, srcH = bmp.height;
  const sc = Math.min(1, maxDim / Math.max(bmp.width, bmp.height)); const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * sc)); c.height = Math.max(1, Math.round(bmp.height * sc));
  const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(bmp, 0, 0, c.width, c.height);
  if (bmp.close) bmp.close();
  const out = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9)); c.width = c.height = 0;
  return { data: await blobToBase64(out), mime: 'image/jpeg', blob: out, srcW, srcH };
}
const NO_TEXT = /^\s*\[no readable text\]\s*$/i;
async function geminiOCR(images) {
  const r = await callAI('ocr', { images: images.map(i => ({ data: i.data, mime: i.mime })) });
  const titles = [];
  const pages = r.text.split(/\n?\s*---PAGE---\s*\n?/).map(t => t.trim()).map(t => {
    const mm = t.match(/^TITLE:[ \t]*(.*)\r?\n?/i); titles.push(mm ? mm[1].trim().replace(/^["'`*]+|["'`*]+$/g, '').slice(0, 70) : ''); if (mm) t = t.slice(mm[0].length).trim();
    return NO_TEXT.test(t) ? '' : t;
  });
  return { pages, titles, truncated: r.truncated };
}
async function tesseractOCR(blob) {
  if (!window.Tesseract) await loadScript(TESSERACT);
  const r = await Tesseract.recognize(blob, 'eng'); return { text: (r.data.text || '').trim(), conf: Math.round(r.data.confidence || 0) };
}
// Both [unclear] and [?] are markers the OCR prompt uses for text it could not read with certainty.
const uncertainCount = t => (String(t || '').match(/\[unclear\]|\[\?\]/gi) || []).length;
function engineNote(text, engines, conf) {
  const u = uncertainCount(text), parts = [];
  if (engines.has('gemini')) parts.push('Gemini Vision OCR');
  if (engines.has('tesseract')) parts.push(`backup OCR${conf != null ? ` (confidence ~${conf}%)` : ''}, lower accuracy`);
  if (!parts.length) parts.push('no OCR engine produced text');
  return `${parts.join(' + ')} · NOT verified${u ? ` · ${u} uncertain spot${u > 1 ? 's' : ''} marked [?] or [unclear]` : ''} · please tap Review text`;
}
const NO_TEXT_MSG = 'No readable text found. Retake it flat, in focus and in good light, or type the text with Paste text.';
async function ocrImage(file, progress) {
  progress('Preparing image…'); const prep = await prepImage(file);
  const lowRes = Math.max(prep.srcW, prep.srcH) < 900 ? ' · low-resolution photo: retake closer if anything looks wrong' : '';
  let reason = '';
  if (hasWorker()) {
    try {
      progress('Reading with Gemini Vision…'); const r = await geminiOCR([prep]); const text = r.pages.filter(Boolean).join('\n\n').trim();
      if (!text) return { text: '', status: NO_TEXT_MSG, ocr: true };
      return { text, status: engineNote(text, new Set(['gemini'])) + lowRes, ocr: true, title: (r.titles || []).find(Boolean) || '' };
    } catch (e) { reason = e.message; progress('Gemini unavailable (' + reason + '). Using backup OCR…'); }
  }
  progress('Reading with backup OCR…'); const t = await tesseractOCR(prep.blob);
  if (!t.text) return { text: '', status: NO_TEXT_MSG + (reason ? ' · Gemini unavailable: ' + reason : ''), ocr: true };
  return { text: t.text, status: engineNote(t.text, new Set(['tesseract']), t.conf) + lowRes + (reason ? ' · Gemini unavailable: ' + reason : ''), ocr: true, lowAccuracy: true };
}
async function loadPdfJs() {
  if (window.__pdfjs) return window.__pdfjs;
  let mod; try { mod = await import(PDFJS); } catch { throw new Error('PDF reader could not load. Check your internet and retry.'); }
  const code = await (await fetch(PDFJS_WORKER)).text();
  mod.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
  window.__pdfjs = mod; return mod;
}
const MAX_SCANNED_PAGES = 40; // each batch of 3 pages = 1 Gemini request, so 40 pages = 14 requests
const rangeText = a => { const o = []; let i = 0; a = a.slice().sort((x, y) => x - y); while (i < a.length) { let j = i; while (j + 1 < a.length && a[j + 1] === a[j] + 1) j++; o.push(i === j ? `${a[i]}` : `${a[i]}–${a[j]}`); i = j + 1; } return o.join(', '); };
function streamText(content) { return content.items.map(i => i.str + (i.hasEOL ? '\n' : ' ')).join('').replace(/[ \t]+/g, ' ').trim(); }
// Rebuilds visual rows so table columns survive as "cell | cell". Falls back to stream order for multi-column prose.
async function pdfPageText(page) {
  const content = await page.getTextContent(); const plain = streamText(content);
  const items = content.items.filter(i => i.transform && i.str.trim() !== ''); if (!items.length) return plain;
  const rows = [];
  for (const it of items) {
    const y = it.transform[5], h = Math.abs(it.transform[3]) || it.height || 10;
    let row = rows.find(r => Math.abs(r.y - y) <= h * 0.45); if (!row) { row = { y, h, items: [] }; rows.push(row); } row.items.push(it);
  }
  rows.sort((a, b) => b.y - a.y); let colLines = 0, longSeg = 0;
  const lines = rows.map(row => {
    row.items.sort((a, b) => a.transform[4] - b.transform[4]); let line = '', prev = null, segs = [''];
    for (const it of row.items) {
      if (prev) { const gap = it.transform[4] - (prev.transform[4] + (prev.width || 0)); if (gap > row.h * 1.5) { line += ' | '; segs.push(''); } else if (gap > row.h * 0.15) line += ' '; }
      line += it.str; segs[segs.length - 1] += it.str; prev = it;
    }
    if (segs.length > 1) { colLines++; if (segs.reduce((a, x) => a + x.length, 0) / segs.length > 35) longSeg++; }
    return line.replace(/[ \t]+/g, ' ').trim();
  }).filter(Boolean);
  if (colLines && longSeg / colLines > 0.4) return plain; // long segments side by side = text columns, not a table
  return lines.join('\n');
}
async function renderPageJpeg(pdf, p) {
  const page = await pdf.getPage(p); const v1 = page.getViewport({ scale: 1 });
  const vp = page.getViewport({ scale: Math.min(3, 2000 / Math.max(v1.width, v1.height)) }); const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
  const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); await page.render({ canvasContext: ctx, viewport: vp }).promise;
  const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.88)); c.width = c.height = 0; page.cleanup();
  return { p, blob, data: await blobToBase64(blob), mime: 'image/jpeg' };
}
async function extractPdf(file, progress) {
  const pdfjs = await loadPdfJs(); const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages = {}, scanned = [], failed = [], engines = new Set(); let conf = null, reason = '', skipped = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    progress(`Reading page ${p} of ${pdf.numPages}…`);
    const page = await pdf.getPage(p); const txt = await pdfPageText(page);
    if (txt.length >= 40) pages[p] = txt; else scanned.push(p);
  }
  if (scanned.length) {
    const todo = scanned.slice(0, MAX_SCANNED_PAGES); skipped = scanned.slice(MAX_SCANNED_PAGES); let geminiOK = hasWorker();
    // Process 3 pages at a time and release them, so memory stays small even for 40 pages.
    for (let i = 0; i < todo.length; i += 3) {
      const nums = todo.slice(i, i + 3), batch = [];
      progress(`Scanned pages ${rangeText(nums)}: rendering…`);
      for (const p of nums) { try { batch.push(await renderPageJpeg(pdf, p)); } catch { failed.push(p); } }
      if (!batch.length) continue;
      progress(`Scanned pages ${rangeText(nums)}: reading text…`); let done = false;
      if (geminiOK) {
        try {
          const r = await geminiOCR(batch);
          if (batch.length === 1) pages[batch[0].p] = r.pages.filter(Boolean).join('\n\n');
          else if (r.pages.length === batch.length) batch.forEach((b, k) => { pages[b.p] = r.pages[k]; });
          else for (const b of batch) pages[b.p] = (await geminiOCR([b])).pages.filter(Boolean).join('\n\n'); // page split mismatch: re-read singly so text never lands on the wrong page
          engines.add('gemini'); done = true;
        } catch (e) { geminiOK = false; reason = e.message; progress('Gemini unavailable, using backup OCR…'); }
      }
      if (!done) for (const b of batch) { try { const t = await tesseractOCR(b.blob); pages[b.p] = t.text; conf = conf == null ? t.conf : Math.min(conf, t.conf); engines.add('tesseract'); } catch { failed.push(b.p); } }
    }
  }
  let out = Object.keys(pages).map(Number).sort((a, b) => a - b).filter(p => (pages[p] || '').trim()).map(p => `[Page ${p}]\n${pages[p]}`).join('\n\n');
  const bits = [];
  if (scanned.length) bits.push(engineNote(out, engines, conf));
  if (skipped.length) { bits.push(`NOT READ: scanned pages ${rangeText(skipped)} (limit ${MAX_SCANNED_PAGES} scanned pages per file; split the PDF to read the rest)`); out += `\n\n[Note: scanned pages ${rangeText(skipped)} were not read because of the page limit]`; }
  if (failed.length) { bits.push(`could not read pages ${rangeText(failed)}`); out += `\n\n[Note: pages ${rangeText(failed)} could not be read]`; }
  if (reason) bits.push('Gemini unavailable: ' + reason);
  const emptyScanned = scanned.filter(p => !(pages[p] || '').trim() && !failed.includes(p) && !skipped.includes(p));
  if (emptyScanned.length) bits.push(`no text found on pages ${rangeText(emptyScanned)} (blank or unreadable)`);
  const status = bits.length ? bits.join(' · ') : (out.includes(' | ') ? 'Text extracted from PDF · table-like rows use " | " between columns' : 'Text extracted from PDF');
  return { text: out, status, ocr: scanned.length > 0, lowAccuracy: engines.has('tesseract') };
}
async function inflateRaw(bytes) { const s = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')); return await new Response(s).text(); }
async function extractDocx(file) {
  const buf = new Uint8Array(await file.arrayBuffer()), dv = new DataView(buf.buffer); let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('This is not a valid DOCX file.');
  const count = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true), xml = null; const dec = new TextDecoder();
  for (let k = 0; k < count; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), lho = dv.getUint32(p + 42, true);
    const name = dec.decode(buf.subarray(p + 46, p + 46 + nlen)); p += 46 + nlen + elen + clen;
    if (name === 'word/document.xml') { const start = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true); const data = buf.subarray(start, start + csize); xml = method === 0 ? dec.decode(data) : await inflateRaw(data); break; }
  }
  if (!xml) throw new Error('Could not find text inside this DOCX.');
  const doc = new DOMParser().parseFromString(xml, 'application/xml'); const lines = [];
  for (const para of doc.getElementsByTagName('w:p')) {
    let t = ''; const walk = n => { for (const c of n.childNodes) { if (c.nodeName === 'w:t') t += c.textContent; else if (c.nodeName === 'w:tab') t += '\t'; else if (c.nodeName === 'w:br') t += '\n'; else if (c.childNodes && c.childNodes.length) walk(c); } }; walk(para);
    const st = para.getElementsByTagName('w:pStyle')[0]; const style = st ? (st.getAttribute('w:val') || '') : ''; if (t.trim()) lines.push((/^Heading\d/i.test(style) ? '# ' : '') + t.trim());
  }
  return { text: lines.join('\n'), status: 'Text extracted from DOCX' };
}
async function extractFile(file, name, progress) {
  const type = (file.type || '').toLowerCase(), n = (name || '').toLowerCase();
  if (type.startsWith('image/')) return ocrImage(file, progress);
  if (type === 'application/pdf' || n.endsWith('.pdf')) return extractPdf(file, progress);
  if (n.endsWith('.docx')) return extractDocx(file);
  if (type.startsWith('text/') || /\.(txt|md|csv|html?)$/.test(n)) return { text: await file.text(), status: 'Text file read' };
  throw new Error('Unsupported file type. Use PDF, image, DOCX, TXT or Markdown.');
}
async function processMaterial(m) {
  busy.add(m.id); renderMaterials();
  const progress = msg => { liveStatus[m.id] = msg; if (activeSubject === m.subjectId) renderMaterials(); };
  try {
    const r = await extractFile(m.blob, m.name, progress); m.text = r.text || ''; m.ocrStatus = m.text.trim() ? r.status : (r.status || 'No readable text detected'); m.ocr = !!r.ocr; m.lowAccuracy = !!r.lowAccuracy; m.reviewed = false; delete m.error;
    if (r.title && (m.mime || '').startsWith('image/') && !m.userNamed) { m.origName = m.origName || m.name; m.name = uniqueName(m.subjectId, r.title, m.id); m.autoTitled = true; }
  } catch (err) { m.ocrStatus = 'Could not read: ' + (err.message || err); m.error = String(err.message || err); }
  busy.delete(m.id); delete liveStatus[m.id]; await put('materials', m); await refresh(); renderSubjectViews();
  const cap = document.querySelector(`.cap[data-id="${m.id}"]`); if (cap) { const good = !m.error && m.text.trim(); cap.classList.add(good ? 'done' : 'fail'); cap.querySelector('i').textContent = good ? '✓' : '⚠'; }
}
$('#fileInput').addEventListener('change', async e => {
  const files = [...e.target.files]; e.target.value = '';
  for (const f of files) {
    const m = { id: uid(), subjectId: activeSubject, name: f.name, kind: f.type || 'file', mime: f.type, size: f.size, createdAt: now(), text: '', blob: f, ocrStatus: 'Queued' };
    await put('materials', m); await refresh(); renderSubjectViews(); await processMaterial(m);
  }
  if (files.length) toast('Files read and saved in Learnova');
});
$('#linkBtn').addEventListener('click', async () => {
  const url = prompt('Paste a website link'); if (!url) return; let v; try { v = new URL(url); } catch { return toast('Please enter a full valid URL.'); }
  if (!['http:', 'https:'].includes(v.protocol)) return toast('Only http/https links are supported.');
  await put('materials', { id: uid(), subjectId: activeSubject, name: v.hostname + v.pathname, kind: 'Website link', url: v.href, text: '', createdAt: now(), ocrStatus: 'Link saved; open it and use “Paste text” to add its content' });
  await refresh(); renderSubjectViews(); toast('Link saved. Use Paste text to add the page content for AI.');
});

/* ---------- Review / paste text ---------- */
function openMaterialText(id) {
  const m = state.materials.find(x => x.id === id); if (!m) return; editingMaterial = m; pasteMode = false;
  $('#textDialogTitle').textContent = 'Review text · ' + m.name; $('#textEditor').value = m.text || ''; $('#rereadBtn').classList.toggle('hidden', !(m.blob && (m.mime || '').startsWith('image/') && hasWorker())); $('#textDialog').showModal();
}
$('#pasteBtn').addEventListener('click', () => { editingMaterial = null; pasteMode = true; $('#textDialogTitle').textContent = 'Paste text'; $('#textEditor').value = ''; $('#rereadBtn').classList.add('hidden'); $('#textDialog').showModal(); });
$('#saveTextBtn').addEventListener('click', async () => {
  const text = $('#textEditor').value;
  if (pasteMode) { if (!text.trim()) return toast('Nothing to save.'); await put('materials', { id: uid(), subjectId: activeSubject, name: uniqueName(activeSubject, titleFromText(text, 'Pasted text')), kind: 'Pasted text', text, createdAt: now(), ocrStatus: 'Added by you' }); }
  else if (editingMaterial) { editingMaterial.text = text; editingMaterial.ocrStatus = 'Reviewed by you'; editingMaterial.reviewed = true; await put('materials', editingMaterial); }
  $('#textDialog').close(); await refresh(); renderSubjectViews(); toast('Text saved');
});
$('#rereadBtn').addEventListener('click', async () => { const m = editingMaterial; if (!m) return; $('#textDialog').close(); await processMaterial(m); });

/* ---------- Camera ---------- */
$('#cameraBtn').addEventListener('click', async () => {
  try { cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 2560 }, height: { ideal: 1440 } }, audio: false }); $('#cameraVideo').srcObject = cameraStream; setStatus('#cameraStatus', 'Camera ready. Capture one page at a time.'); $('#cameraDialog').showModal(); }
  catch { toast('Camera not available. Allow camera permission (needs HTTPS).'); }
});
let capN = 0;
$('#cameraBtn').addEventListener('click', () => { capN = 0; $('#capStrip').innerHTML = ''; $('#capCount').textContent = '0 pages captured'; });
$('#captureBtn').addEventListener('click', async () => {
  const v = $('#cameraVideo'), c = $('#cameraCanvas'); if (!v.videoWidth) return toast('Camera is still starting, wait a second…');
  c.width = v.videoWidth; c.height = v.videoHeight; c.getContext('2d').drawImage(v, 0, 0);
  const sh = $('#shutter'); sh.classList.remove('go'); void sh.offsetWidth; sh.classList.add('go');
  const badge = $('#capBadge'); badge.classList.add('show'); setTimeout(() => badge.classList.remove('show'), 1500); if (navigator.vibrate) navigator.vibrate(60);
  const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.92)); const label = 'Scanned page · ' + new Date().toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  const file = new File([blob], label + '.jpg', { type: 'image/jpeg' });
  const m = { id: uid(), subjectId: activeSubject, name: uniqueName(activeSubject, label), kind: 'Camera scan', mime: file.type, size: file.size, createdAt: now(), blob: file, text: '', ocrStatus: 'Queued' };
  capN++; $('#capCount').textContent = `${capN} page${capN > 1 ? 's' : ''} captured`; toast(`📸 Photo clicked ✓ (page ${capN})`);
  $('#capStrip').insertAdjacentHTML('beforeend', `<div class="cap" data-id="${m.id}"><img alt="page ${capN}" src="${URL.createObjectURL(blob)}"><i>⏳</i></div>`);
  await put('materials', m); await refresh(); renderSubjectViews(); setStatus('#cameraStatus', 'Saved. Reading it in the background; you can capture the next page.'); processMaterial(m);
});
function stopCamera() { if (cameraStream) cameraStream.getTracks().forEach(t => t.stop()); cameraStream = null; $('#cameraVideo').srcObject = null; }
$('#stopCameraBtn').addEventListener('click', () => { stopCamera(); $('#cameraDialog').close(); });
$('#cameraDialog').addEventListener('close', stopCamera);

/* ---------- AI calls ---------- */
function normUrl(u) { u = (u || '').trim().replace(/\/+$/, ''); if (u && !/^https?:\/\//i.test(u)) u = 'https://' + u; return u; }
async function callAI(task, payload) {
  const url = normUrl(state.settings.workerUrl); if (!url) throw new Error('Add your Cloudflare Worker URL in ⚙ Settings first.');
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 150000); let res;
  try { res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(state.settings.accessCode ? { 'X-Learnova-Key': state.settings.accessCode } : {}) }, body: JSON.stringify({ task, ...payload }), signal: ctl.signal }); }
  catch (e) { throw new Error(e.name === 'AbortError' ? 'The AI took too long. Try fewer sources.' : `Cannot reach your Worker. Check the URL in Settings and your internet. If both are fine, the Worker's ALLOWED_ORIGINS variable must include this site (${location.origin}).`); }
  finally { clearTimeout(timer); }
  let data; try { data = await res.json(); } catch { throw new Error('The Worker returned an unexpected reply. Check the Worker URL.'); }
  if (!res.ok && /unknown task/i.test(data.error || '')) { workerOutdated = true; renderHome(); throw new Error(OUTDATED_MSG); }
  if (!res.ok) throw new Error(data.error || `AI request failed (${res.status}).`);
  if (!data.text) throw new Error('AI returned no text.'); return data;
}
function buildSource(list, limit = MAX_SOURCE, keepMarkers = false) {
  let total = 0, trimmed = false; const parts = [];
  for (const m of list) { let t = (keepMarkers ? m.text : m.text.replace(/[ \t]*\[unclear\]/gi, '').replace(/\[\?\]/g, '')).trim(); const room = limit - total; if (room <= 500) { trimmed = true; break; } if (t.length > room) { t = t.slice(0, room); trimmed = true; } total += t.length; parts.push(`SOURCE: ${m.name}\n${t}`); }
  return { text: parts.join('\n\n---\n\n'), trimmed };
}
function parseJSON(raw) {
  let t = String(raw).trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try { return JSON.parse(t); } catch { const a = t.indexOf('{'), b = t.lastIndexOf('}'); if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1)); throw new Error('bad json'); }
}

/* ---------- Notes ---------- */
$('#createNotesBtn').addEventListener('click', async () => {
  const chosen = subjectMaterials(activeSubject).filter(m => pickerSel.has(m.id));
  if (!chosen.length) return setStatus('#aiStatus', 'Pick at least one page in the list above (or tick “Include all”).', true);
  const ok = readable(chosen); if (!ok.length) return setStatus('#aiStatus', 'The chosen pages have no readable text yet. Wait for reading to finish, or open Review.', true);
  // A few unreadable words are silently dropped. Only when MANY are unreadable do we warn and mark the notes.
  const words = ok.reduce((a, m) => a + m.text.split(/\s+/).length, 0), marks = ok.reduce((a, m) => a + uncertainCount(m.text), 0), low = marks / Math.max(1, words) * 100 >= 3;
  if (low && !confirm(`A lot of the text on these pages could not be read clearly (${marks} unclear spots). The notes may have gaps and will carry a warning. Continue?`)) return;
  const weak = ok.filter(m => m.lowAccuracy && !m.reviewed);
  if (weak.length && !confirm(`${weak.length} page(s) were read by the lower-accuracy backup reader and have not been reviewed. Tap Cancel to open Review first, or OK to continue.`)) return;
  const src = buildSource(ok, MAX_SOURCE, low); if (src.trimmed) return setStatus('#aiStatus', 'That is a lot of text. Please select fewer pages.', true);
  const btn = $('#createNotesBtn'); btn.disabled = true; setStatus('#aiStatus', 'Writing your notes…', false, true);
  try {
    const r = await callAI('notes', { subject: (state.subjects.find(x => x.id === activeSubject) || {}).name || '', lowReadability: low, sourceText: src.text });
    const h = (r.text.match(/^#\s+(.+)$/m) || [])[1]; const title = `${h ? h.replace(/[*=`]/g, '').trim().slice(0, 70) : 'Notes'} · ${fmtDate(now())}`;
    const note = { id: uid(), subjectId: activeSubject, title, content: r.text, original: true, isCopy: false, createdAt: now(), sourceIds: ok.map(m => m.id) };
    await put('notes', note); await markActivity(); await refresh(); renderSubjectViews();
    setStatus('#aiStatus', `Notes created from ${ok.length} page(s).${low ? ' Some text was hard to read, so the notes carry a warning.' : ''}${r.truncated ? ' The note hit the length limit; choose fewer pages for a complete version.' : ''}`); toast('Notes saved'); switchTab('notes'); openNote(note.id);
  } catch (e) { setStatus('#aiStatus', e.message, true); } finally { btn.disabled = false; }
});
function openNote(id) {
  const n = state.notes.find(x => x.id === id); if (!n) return; editingNote = n;
  $('#noteDialogTitle').textContent = n.title; $('#noteEditor').value = n.content; $('#noteRendered').innerHTML = renderMarkdown(n.content);
  $('#noteRendered').classList.remove('hidden'); $('#noteEditWrap').classList.add('hidden'); if (!$('#noteDialog').open) $('#noteDialog').showModal();
}
$('#noteViewBtn').addEventListener('click', () => { $('#noteRendered').innerHTML = renderMarkdown($('#noteEditor').value); $('#noteRendered').classList.remove('hidden'); $('#noteEditWrap').classList.add('hidden'); });
$('#noteEditBtn').addEventListener('click', () => { $('#noteRendered').classList.add('hidden'); $('#noteEditWrap').classList.remove('hidden'); });
$('#noteCopyBtn').addEventListener('click', async () => { try { await navigator.clipboard.writeText($('#noteEditor').value); toast('Note copied'); } catch { toast('Copy not allowed here. Select the text in Edit mode.'); } });
$('#notePrintBtn').addEventListener('click', () => {
  let root = $('#printRoot'); if (!root) { root = document.createElement('div'); root.id = 'printRoot'; document.body.appendChild(root); }
  root.innerHTML = `<div class="note-render" style="--accent:${getComputedStyle($('#noteDialog')).getPropertyValue('--accent') || '#4f46e5'}">${renderMarkdown($('#noteEditor').value)}</div>`; window.print();
});
$('#saveCopyBtn').addEventListener('click', async () => {
  if (!editingNote) return; const copy = { id: uid(), subjectId: editingNote.subjectId, title: editingNote.title.replace(/ · My copy$/, '') + ' · My copy', content: $('#noteEditor').value, original: false, isCopy: true, createdAt: now(), sourceIds: editingNote.sourceIds || [], parentId: editingNote.id };
  await put('notes', copy); await refresh(); renderSubjectViews(); $('#noteDialog').close(); toast('Saved as your copy; original unchanged');
});

/* ---------- Flashcards (spaced repetition) ---------- */
const BOX_DAYS = [0, 1, 3, 7, 16, 35];
function renderCardSummary() { const n = subjectCards(activeSubject).length, d = dueCards(activeSubject).length; $('#reviewCardsBtn').textContent = `Review due cards (${d})`; $('#reviewCardsBtn').disabled = !d; if (!$('#cardArea').innerHTML) setStatus('#cardStatus', n ? `${n} cards in this subject · ${d} due now.` : 'No cards yet. Generate some from your material.'); }
$('#makeCardsBtn').addEventListener('click', async () => {
  const ok = readable(subjectMaterials(activeSubject)); if (!ok.length) return setStatus('#cardStatus', 'Add readable material first.', true);
  let cardNote = ''; const btn = $('#makeCardsBtn'); btn.disabled = true; setStatus('#cardStatus', 'Creating flashcards…', false, true);
  try {
    const src = buildSource(ok), grams = trigramSet(src.text);
    const r = await callAI('flashcards', { count: 16, sourceText: src.text }); let parsed; try { parsed = parseJSON(r.text); } catch { throw new Error('AI output was not valid. Please retry.'); }
    const have = new Set(subjectCards(activeSubject).map(c => normTxt(c.front))); let added = 0, rejected = 0;
    for (const c of (parsed.cards || [])) {
      if (added >= 12) break; // we ask for 16 candidates, keep the usual 12 good ones
      const front = String((c && c.front) || '').trim(), back = String((c && c.back) || '').trim(), nf = normTxt(front);
      const bad = front.split(/\s+/).length < 3 || front.length > 300 || back.length < 2 || back.length > 500 || normTxt(back) === nf || [...have].some(h => h === nf || similar(h, nf)) || !evidenceOK(c && c.evidence, grams);
      if (bad) { rejected++; continue; }
      have.add(nf); await put('cards', { id: uid(), subjectId: activeSubject, front, back, box: 0, due: now(), createdAt: now() }); added++;
    }
    if (!added) throw new Error('No new cards passed the quality checks. Try again or add more material.');
    cardNote = ` ${rejected} candidate(s) rejected (duplicate, trivial, or quote not found in your material).`;
    await markActivity(); await refresh(); renderSubjectViews(); setStatus('#cardStatus', `${added} new cards added.${cardNote}`); startReview();
  } catch (e) { setStatus('#cardStatus', e.message, true); } finally { btn.disabled = false; }
});
$('#reviewCardsBtn').addEventListener('click', startReview);
function startReview() { reviewQueue = shuffle(dueCards(activeSubject)); reviewIndex = 0; showCard(); }
function showCard() {
  const area = $('#cardArea'); if (!reviewQueue.length || reviewIndex >= reviewQueue.length) { area.innerHTML = reviewQueue.length ? '<div class="quiz-result"><strong>🎉 Session complete!</strong><p>Come back tomorrow for the next cards.</p></div>' : ''; renderCardSummary(); return; }
  const c = reviewQueue[reviewIndex], pct = Math.round(reviewIndex / reviewQueue.length * 100);
  area.innerHTML = `<div class="progress"><i style="width:${pct}%"></i></div><p>Card ${reviewIndex + 1} of ${reviewQueue.length} · tap the card to flip</p><div class="flip"><div id="flipcard" class="flipcard" data-act="card-flip">${escapeHTML(c.front)}</div></div><div id="rateRow" class="rate-row hidden"><button class="r-again" data-act="card-rate" data-rate="again">Again</button><button class="r-good" data-act="card-rate" data-rate="good">Good</button><button class="r-easy" data-act="card-rate" data-rate="easy">Easy</button></div>`;
}
async function rateCard(rate) {
  const c = reviewQueue[reviewIndex]; if (!c) return;
  c.box = rate === 'again' ? 0 : Math.min(BOX_DAYS.length - 1, c.box + (rate === 'easy' ? 2 : 1));
  const d = new Date(); if (rate === 'again') d.setMinutes(d.getMinutes() + 10); else d.setDate(d.getDate() + BOX_DAYS[c.box]); c.due = d.toISOString();
  await put('cards', c); await markActivity(); reviewIndex++;
  const fresh = await getAll('cards'); state.cards = fresh; renderHome(); showCard();
}

/* ---------- Quiz ---------- */
// Lenient shape check, used for retrying saved mistakes (they were validated when first created).
function normaliseQuestions(arr) {
  return (arr || []).map(q => {
    const opts = (q.options || []).map(String); const ai = Number(q.answerIndex); if (opts.length < 2 || !Number.isInteger(ai) || ai < 0 || ai >= opts.length || !String(q.question || '').trim()) return null;
    const order = shuffle(opts.map((_, i) => i)); return { question: String(q.question), options: order.map(i => opts[i]), answerIndex: order.indexOf(ai), explanation: String(q.explanation || ''), fromMistakeId: q.fromMistakeId };
  }).filter(Boolean);
}
// ---- strict checks for freshly generated questions/cards ----
const normTxt = s => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
function trigramSet(txt) { const w = normTxt(txt).split(' '), set = new Set(); for (let i = 0; i + 2 < w.length; i++) set.add(w[i] + ' ' + w[i + 1] + ' ' + w[i + 2]); return set; }
// The "evidence" quote the AI must supply has to really exist in the student's material (>=80% of its word triples).
function evidenceOK(ev, grams) { const w = normTxt(ev).split(' ').filter(Boolean); if (w.length < 4) return false; let tot = 0, hit = 0; for (let i = 0; i + 2 < w.length; i++) { tot++; if (grams.has(w[i] + ' ' + w[i + 1] + ' ' + w[i + 2])) hit++; } return tot > 0 && hit / tot >= 0.8; }
function similar(a, b) { const x = new Set(a.split(' ')), y = new Set(b.split(' ')); let i = 0; for (const t of x) if (y.has(t)) i++; return i / Math.max(1, x.size + y.size - i) > 0.8; }
const BAD_OPTION = /^(all|none) of (the|these) (above|options)|^both\b.*\band\b|^(a|b|c|d)\s+(and|&)\s+(a|b|c|d)\b/i;
function strictQuestions(raw, grams) {
  const out = [], seen = []; let rejected = 0;
  for (const q of (Array.isArray(raw) ? raw : [])) {
    const text = String((q && q.question) || '').trim(), opts = Array.isArray(q && q.options) ? q.options.map(o => String(o).trim()) : [], ai = Number(q && q.answerIndex), nq = normTxt(text);
    const bad = text.length < 10 || text.length > 400 || opts.length !== 4 || opts.some(o => !o || o.length > 300) || new Set(opts.map(normTxt)).size !== 4 || opts.some(o => BAD_OPTION.test(o))
      || !Number.isInteger(ai) || ai < 0 || ai > 3 || String((q && q.explanation) || '').trim().length < 5 || /according to the (passage|text|source|material)/i.test(text)
      || seen.some(x => x === nq || similar(x, nq)) || !evidenceOK(q && q.evidence, grams);
    if (bad) { rejected++; continue; }
    seen.push(nq); const order = shuffle([0, 1, 2, 3]);
    out.push({ question: text, options: order.map(i => opts[i]), answerIndex: order.indexOf(ai), explanation: String(q.explanation).trim() });
  }
  return { qs: out, rejected };
}
$('#createQuizBtn').addEventListener('click', async () => {
  const ok = readable(subjectMaterials(activeSubject)); if (!ok.length) return setStatus('#quizStatus', 'Add readable material first.', true);
  const btn = $('#createQuizBtn'); btn.disabled = true; setStatus('#quizStatus', 'Writing questions…', false, true); $('#quizArea').innerHTML = '';
  try {
    const src = buildSource(ok), grams = trigramSet(src.text);
    // Ask for extra candidates (8) so that after quality checks we can still show the usual 5.
    const r = await callAI('mcq', { count: 8, sourceText: src.text }); let parsed; try { parsed = parseJSON(r.text); } catch { throw new Error('AI output was not valid quiz data. Please retry.'); }
    let { qs, rejected } = strictQuestions(parsed.questions, grams); if (!qs.length) throw new Error('No question passed the quality checks. Add clearer or longer material, or retry.');
    let note = '';
    try {
      setStatus('#quizStatus', 'Double-checking the answers…', false, true);
      const c = await callAI('mcq_check', { questions: qs.map(({ question, options }) => ({ question, options })), sourceText: src.text }); const res = (parseJSON(c.text).results) || [];
      const good = new Set(res.filter(x => x && x.ambiguous !== true && qs[Number(x.i)] && Number(x.choice) === qs[Number(x.i)].answerIndex).map(x => Number(x.i)));
      const before = qs.length; qs = qs.filter((_, i) => good.has(i)); rejected += before - qs.length;
    } catch (e) { note = ' The independent answer check could not run (' + e.message + '), so only the other checks were applied.'; }
    qs = qs.slice(0, 5); if (!qs.length) throw new Error('No question survived the answer check. Retry, or add clearer material.');
    renderQuiz(qs, ` ${qs.length} question(s) passed the automatic checks (quote found in your material${note ? '' : ' + independent answer check'}); ${rejected} candidate(s) were rejected. Automatic checks reduce errors but cannot guarantee them.${note}`);
  } catch (e) { setStatus('#quizStatus', e.message, true); } finally { btn.disabled = false; }
});
$('#retryMistakesBtn').addEventListener('click', () => {
  const list = state.mistakes.filter(m => m.subjectId === activeSubject && m.options && m.options.length).slice(-5);
  if (!list.length) return setStatus('#quizStatus', 'No retryable mistakes yet.', true);
  renderQuiz(normaliseQuestions(list.map(m => ({ question: m.question, options: m.options, answerIndex: m.answerIndex, explanation: m.explanation, fromMistakeId: m.id }))));
});
function renderQuiz(qs, extra = '') {
  currentQuiz = qs; setStatus('#quizStatus', 'Pick one answer per question, then tap Check answers.' + extra);
  $('#quizArea').innerHTML = qs.map((q, i) => `<div class="quiz-question" data-q="${i}"><h3>${i + 1}. ${escapeHTML(q.question)}</h3>${q.options.map((o, j) => `<label class="quiz-option" data-o="${j}"><input type="radio" name="q${i}" value="${j}"><span>${String.fromCharCode(65 + j)}. ${escapeHTML(o)}</span></label>`).join('')}</div>`).join('') + '<button id="checkQuizBtn" class="primary full">Check answers</button><div id="quizResults"></div>';
  $('#checkQuizBtn').addEventListener('click', checkQuiz);
}
async function checkQuiz() {
  const qs = currentQuiz; let score = 0; $('#checkQuizBtn').disabled = true;
  for (let i = 0; i < qs.length; i++) {
    const q = qs[i], sel = $(`input[name="q${i}"]:checked`), idx = sel ? Number(sel.value) : -1, card = $(`[data-q="${i}"]`);
    card.querySelectorAll('input').forEach(x => x.disabled = true);
    card.querySelector(`[data-o="${q.answerIndex}"]`).classList.add('correct'); if (idx >= 0 && idx !== q.answerIndex) card.querySelector(`[data-o="${idx}"]`).classList.add('wrong');
    if (q.explanation) card.insertAdjacentHTML('beforeend', `<div class="quiz-explain">💡 ${escapeHTML(q.explanation)}</div>`);
    if (idx === q.answerIndex) { score++; if (q.fromMistakeId) await del('mistakes', q.fromMistakeId); }
    else if (!q.fromMistakeId) await put('mistakes', { id: uid(), subjectId: activeSubject, question: q.question, chosen: idx >= 0 ? q.options[idx] : 'Not answered', answer: q.options[q.answerIndex], options: q.options, answerIndex: q.answerIndex, explanation: q.explanation, createdAt: now() });
  }
  state.settings.quizHistory = [...(state.settings.quizHistory || []), { date: now(), score, total: qs.length }].slice(-50); await saveSettings(); await markActivity();
  const msg = score === qs.length ? '🏆 Perfect!' : score >= qs.length * 0.6 ? '👍 Good work!' : '💪 Keep practising!';
  $('#quizResults').innerHTML = `<div class="quiz-result"><strong>${msg} Score: ${score}/${qs.length}</strong><p>Wrong or unanswered questions were saved to your Mistakes Notebook. Use “Retry my mistakes” to master them.</p></div>`;
  await refresh(); renderMistakes();
}

/* ---------- Settings, notifications, backup ---------- */
$('#settingsBtn').addEventListener('click', () => { setTimeout(showNotifState, 0); $('#workerUrl').value = state.settings.workerUrl || ''; $('#accessCode').value = state.settings.accessCode || ''; setStatus('#settingsStatus', ''); $('#settingsDialog').showModal(); });
$('#saveSettingsBtn').addEventListener('click', async () => {
  const url = normUrl($('#workerUrl').value); state.settings.workerUrl = url; state.settings.accessCode = $('#accessCode').value.trim(); await saveSettings(); renderHome();
  if (!url) return setStatus('#settingsStatus', 'Saved. Add your Worker URL to enable AI.', true);
  setStatus('#settingsStatus', 'Testing connection…', false, true);
  try {
    let info; try { info = await (await fetch(url)).json(); } catch { throw new Error(`Cannot reach that URL. Check it and your internet. If both are fine, add this site (${location.origin}) to the Worker's ALLOWED_ORIGINS variable and deploy.`); }
    if (!info || info.app !== 'Learnova AI Worker') throw new Error('The Worker is running OLD code. Paste the new worker/index.js into Cloudflare → Edit code → Deploy, then test again.');
    if ((info.version || 0) < WORKER_NEEDED) { workerOutdated = true; renderHome(); throw new Error(OUTDATED_MSG); }
    workerOutdated = false; renderHome();
    if (info.accessRequired && !state.settings.accessCode) throw new Error('This Worker requires an access code. Enter it in the Access code box and test again.');
    if (!info.keyConfigured) throw new Error('Worker is live but the GEMINI_API_KEY secret is missing in Cloudflare.');
    const r = await callAI('ask', { question: 'What colour is the sky?', sourceText: 'Learnova test: the sky is blue.' });
    setStatus('#settingsStatus', `✅ Connected. Gemini (${info.model}) replied: ${r.text.slice(0, 80)}`);
  } catch (e) { setStatus('#settingsStatus', '❌ ' + e.message, true); }
});
function notifHelp(perm) {
  const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (!('Notification' in window)) return { ok: false, text: ios ? 'iPhone only allows notifications for apps added to the Home Screen (iOS 16.4+). Tap Share → Add to Home Screen, then open Learnova from that icon.' : 'This browser does not support notifications. Try Chrome, or use the calendar option below.' };
  if (perm === 'granted') return { ok: true, text: '✅ Notifications are ALLOWED for this site. Tap “Send test notification”. If nothing appears: phone Settings → Apps → Chrome → Notifications → turn ON (also the “Site notifications” switch), and turn Do Not Disturb OFF.' };
  if (perm === 'denied') return { ok: false, text: '⛔ Chrome is BLOCKING notifications for this site and will not ask again. Fix: tap the ⓘ / 🔒 icon at the left of the address bar → Permissions (or Site settings) → Notifications → Allow. Or: Chrome ⋮ → Settings → Site settings → Notifications → find this site under “Blocked” → Allow. Then return here and tap Send test notification.' };
  return { ok: false, text: '🔔 Not allowed yet. Chrome did not show the popup (it may be collapsing the request). Look for a 🔔 icon at the right end of the address bar and tap it → Allow. Or: Chrome ⋮ → Settings → Site settings → Notifications → choose “Expand all requests”, reload this page, open Settings and tap Enable notifications again.' };
}
function showNotifState() { const h = notifHelp('Notification' in window ? Notification.permission : 'none'); setStatus('#notificationStatus', h.text, !h.ok); return h; }
$('#enableNotificationsBtn').addEventListener('click', async () => {
  if ('Notification' in window && Notification.permission === 'default') { try { await Notification.requestPermission(); } catch { /* handled by the state check below */ } }
  const h = showNotifState(); if (h.ok) { localStorage.setItem('ln-notifications', 'yes'); checkReminders(); toast('Notifications enabled'); }
});
$('#testNotificationBtn').addEventListener('click', async () => {
  if ('Notification' in window && Notification.permission === 'default') { try { await Notification.requestPermission(); } catch { /* see state check */ } }
  const h = showNotifState(); if (!h.ok) return;
  localStorage.setItem('ln-notifications', 'yes');
  try { const reg = await navigator.serviceWorker.ready; await reg.showNotification('Learnova ✓', { body: 'Notifications work. Reminders come at 10:00 AM and 8:00 PM while Learnova is open.', icon: './icon.svg' }); setStatus('#notificationStatus', '✅ Test notification sent. Pull down your notification bar to see it.'); }
  catch (e) { try { new Notification('Learnova ✓', { body: 'Notifications work.' }); setStatus('#notificationStatus', '✅ Test notification sent.'); } catch (e2) { setStatus('#notificationStatus', 'Allowed, but this browser could not show it: ' + e2.message + '. Use the calendar option below instead.', true); } }
});
$('#icsBtn').addEventListener('click', () => {
  const z = n => String(n).padStart(2, '0'), d = new Date(), ymd = `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}`, stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const ev = (id, hh, title, desc) => ['BEGIN:VEVENT', `UID:${id}@learnova`, `DTSTAMP:${stamp}`, `DTSTART:${ymd}T${hh}0000`, `DTEND:${ymd}T${hh}1500`, 'RRULE:FREQ=DAILY', `SUMMARY:${title}`, `DESCRIPTION:${desc}`, 'BEGIN:VALARM', 'TRIGGER:PT0M', 'ACTION:DISPLAY', `DESCRIPTION:${title}`, 'END:VALARM', 'END:VEVENT'];
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Learnova//Reminders//EN', 'CALSCALE:GREGORIAN', ...ev('morning', '10', 'Learnova: study time', 'Review your tasks and flashcards.'), ...ev('night', '20', 'Learnova: evening revision', 'Revise your notes and try a quick quiz.'), 'END:VCALENDAR'];
  downloadBlob(new Blob([lines.join('\r\n')], { type: 'text/calendar' }), 'learnova-reminders.ics'); setStatus('#notificationStatus', 'Reminder file downloaded. Open it (from your downloads or the notification) and tap Add in your Calendar app. They repeat every day, even when Learnova is closed.');
});
function checkReminders() {
  if (!('Notification' in window) || localStorage.getItem('ln-notifications') !== 'yes' || Notification.permission !== 'granted') return;
  const d = new Date(), h = d.getHours(), m = d.getMinutes(), slot = h === 10 ? 'morning' : h === 20 ? 'night' : ''; if (!slot || m > 2) return;
  const key = `ln-${d.toDateString()}-${slot}`; if (localStorage.getItem(key)) return;
  const text = slot === 'morning' ? 'Good morning! Review your tasks and flashcards in Learnova.' : 'Evening check-in: revise your notes and try a quick quiz.';
  if (navigator.serviceWorker && navigator.serviceWorker.controller) navigator.serviceWorker.ready.then(r => r.showNotification('Learnova', { body: text, icon: './icon.svg' })); else new Notification('Learnova', { body: text });
  localStorage.setItem(key, '1');
}
setInterval(checkReminders, 30000); document.addEventListener('visibilitychange', () => { if (!document.hidden) checkReminders(); });
function downloadBlob(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }
$('#exportBtn').addEventListener('click', () => {
  state.settings.lastBackupAt = now(); saveSettings().then(renderHome);
  const pack = { app: 'Learnova', version: 3, chats: state.chats, exportedAt: now(), subjects: state.subjects, tasks: state.tasks, materials: state.materials.map(m => ({ ...m, blob: undefined })), notes: state.notes, mistakes: state.mistakes, cards: state.cards, settings: (({ accessCode, ...safe }) => safe)(state.settings) };
  downloadBlob(new Blob([JSON.stringify(pack, null, 2)], { type: 'application/json' }), `learnova-backup-${dayKey()}.json`); toast('Backup exported (text, notes, cards, history).');
});
$('#importInput').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    const pack = JSON.parse(await f.text()); if (!['Learnova', 'Study Vault'].includes(pack.app)) throw new Error('Not a Learnova backup'); if (!confirm('Add the items from this backup that are not already in Learnova? Items that already exist are never overwritten or deleted.')) return;
    let added = 0, kept = 0, invalid = 0;
    for (const k of ['subjects', 'tasks', 'materials', 'notes', 'mistakes', 'cards', 'chats']) {
      const have = new Set((state[k] || []).map(x => x.id));
      for (const item of (Array.isArray(pack[k]) ? pack[k] : [])) {
        if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !item.id) { invalid++; continue; }
        if (have.has(item.id)) { kept++; continue; }
        await put(k, item); added++;
      }
    }
    if (pack.settings && Array.isArray(pack.settings.activity)) { state.settings.activity = [...new Set([...(state.settings.activity || []), ...pack.settings.activity])]; state.settings.quizHistory = [...(state.settings.quizHistory || []), ...(pack.settings.quizHistory || [])].slice(-50); await saveSettings(); }
    await refresh(); toast(`Backup imported: ${added} added, ${kept} already existed (kept as they were)${invalid ? `, ${invalid} invalid skipped` : ''}.`);
  } catch (err) { toast('Import failed: ' + err.message); }
});

/* ---------- Learnova AI: the single main tutor (chat, fresh practice questions, photo marking, verdict) ---------- */
const getChat = () => state.chats.find(c => c.id === 'main') || { id: 'main', messages: [], sets: [], results: [] };
async function saveChat(c) { await put('chats', c); state.chats = await getAll('chats'); }
let aiImages = [], aiBusy = false, aiError = '';
const openSetOf = c => [...c.sets].reverse().find(x => !x.answered);
const PRACTICE_RE = /(\b(give|make|create|generate|set|prepare|need|want|write)\b[^.?!]*\b(questions?|problems?|mcqs?|sums?|quiz|test|exercises?)\b)|\bpractice\b/i;
const VERDICT_RE = /\b(verdict|how am i doing|my progress|how is my study)\b/i;
function wantedCount(t) {
  const w = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 };
  const m = String(t).match(/\b(\d{1,2}|one|two|three|four|five|six|seven|eight)\b\s*(?:more\s+|new\s+|different\s+)?(?:practice\s+)?(?:questions?|problems?|mcqs?|sums?)/i);
  if (!m) return 3; const n = isNaN(m[1]) ? w[m[1].toLowerCase()] : parseInt(m[1], 10); return Math.min(Math.max(n, 1), 8);
}
function numsOf(t) { return (String(t).replace(/,/g, '').replace(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/g, (m, a, b) => String(Number(a) / Number(b))).match(/-?\d+(?:\.\d+)?/g) || []).map(Number); }
// Two independent solves must agree on every number of the reference answer (2% tolerance); non-numeric answers are not compared.
function answersAgree(ref, got) { if (/ambiguous/i.test(got)) return false; const a = numsOf(ref), b = numsOf(got); if (!a.length || !b.length) return true; return a.every(x => b.some(y => Math.abs(x - y) <= Math.max(0.02, Math.abs(x) * 0.02))); }
function renderScope() {
  const cur = $('#aiScope').value;
  $('#aiScope').innerHTML = '<option value="all">All my subjects</option>' + state.subjects.slice().sort((a, b) => a.name.localeCompare(b.name)).map(x => `<option value="${x.id}">${escapeHTML(x.name)}</option>`).join('') + '<option value="general">General (no material)</option>';
  if ([...$('#aiScope').options].some(o => o.value === cur)) $('#aiScope').value = cur;
}
function scopeSource(limit) {
  const v = $('#aiScope').value; if (v === 'general') return { text: '', name: '' };
  const list = readable(v === 'all' ? state.materials : subjectMaterials(v)); if (!list.length) return { text: '', name: '' };
  return { text: buildSource(list, limit).text, name: v === 'all' ? '' : ((state.subjects.find(x => x.id === v) || {}).name || '') };
}
const INTRO = '<div class="msg ai"><div class="note-render"><p><b>Hi! I am your one tutor for every subject.</b></p><ul><li>Ask any doubt, with or without a photo.</li><li>Say <i>“give me 3 questions on mean, median and SD”</i> and I will set <b>new</b> questions that are not in your notes.</li><li>Solve them on paper, tap 📷 and send a photo: I will read your working, mark it, show what is wrong and give a verdict.</li></ul></div></div>';
function renderChat() {
  const c = getChat();
  $('#aiLog').innerHTML = c.messages.length ? c.messages.map(m => `<div class="msg ${m.role}">${m.role === 'ai' ? `<div class="note-render">${renderMarkdown(m.text)}</div>` : `<p style="white-space:pre-wrap">${escapeHTML(m.text)}</p>`}${m.setId ? `<div class="msg-actions"><button class="smallbtn" data-reveal="${m.setId}">Show answers</button></div>` : ''}</div>`).join('') : INTRO;
  if (aiError) $('#aiLog').insertAdjacentHTML('beforeend', `<div class="msg ai"><div class="note-render"><div class="callout warning"><div class="ctitle"><span>⚠️</span><span>I could not do that</span></div><p>${escapeHTML(aiError)}</p></div></div></div>`);
  $('#aiLog').scrollTop = $('#aiLog').scrollHeight; updateAttach();
}
function updateAttach() {
  const c = getChat(), set = openSetOf(c); $('#aiAttach').classList.toggle('hidden', !aiImages.length);
  $('#aiThumbs').innerHTML = aiImages.map(i => `<img alt="photo" src="${i.url}">`).join('');
  $('#aiPhotoMode').innerHTML = (set ? `<option value="check">✅ Check my answer · ${escapeHTML(set.topic)}</option>` : '') + '<option value="doubt">💬 Explain this photo</option>';
}
function clearAttach() { aiImages.forEach(i => URL.revokeObjectURL(i.url)); aiImages = []; updateAttach(); }
async function addPhotos(files) {
  for (const f of files) {
    if (aiImages.length >= 4) { toast('Maximum 4 photos at a time.'); break; }
    try { const prep = await prepImage(f, 1800); aiImages.push({ data: prep.data, mime: prep.mime, url: URL.createObjectURL(prep.blob) }); toast(`📸 Photo added ✓ (${aiImages.length})`); } catch { toast('Could not read that photo. Try again.'); }
  }
  updateAttach();
}
$('#aiCam').addEventListener('change', e => { addPhotos([...e.target.files]); e.target.value = ''; });
$('#aiGal').addEventListener('change', e => { addPhotos([...e.target.files]); e.target.value = ''; });
$('#aiAttachClear').addEventListener('click', clearAttach);
$('#aiInput').addEventListener('input', e => { e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'; });
$('#aiInput').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('#aiForm').requestSubmit(); } });
$('#openAiBtn').addEventListener('click', () => { renderScope(); $('#aiDialog').showModal(); renderChat(); });
$('#aiClear').addEventListener('click', async () => { if (!confirm('Clear the chat and practice sets? Your scores and verdict history are kept.')) return; const c = getChat(); c.messages = []; c.sets = []; await saveChat(c); clearAttach(); renderChat(); });
document.addEventListener('click', e => {
  const chip = e.target.closest('[data-chip]');
  if (chip) { const k = chip.dataset.chip, inp = $('#aiInput'); if (k === 'verdict') { inp.value = 'Give me my study verdict'; $('#aiForm').requestSubmit(); } else { if (!inp.value.trim()) inp.value = k === 'practice' ? 'Give me 3 practice questions on ' : 'Explain '; inp.focus(); } return; }
  const rv = e.target.closest('[data-reveal]');
  if (rv) { const c = getChat(), set = c.sets.find(x => x.id === rv.dataset.reveal); if (!set) return toast('That set was cleared.'); c.messages.push({ id: uid(), role: 'ai', text: `## ✅ Answers — ${set.topic}\n` + set.questions.map((q, i) => `**Q${i + 1}.** ${q.answer}\n\n> [!example] Working\n${q.solution.split('\n').map(l => '> ' + l).join('\n')}`).join('\n\n'), ts: now() }); saveChat(c).then(renderChat); }
});
$('#aiForm').addEventListener('submit', async e => {
  e.preventDefault(); if (aiBusy) return; aiError = ''; const text = $('#aiInput').value.trim(); if (!text && !aiImages.length) return;
  aiBusy = true; $('#aiSend').disabled = true; const c = getChat(), imgs = aiImages.slice(), check = imgs.length && $('#aiPhotoMode').value === 'check' && !!openSetOf(c);
  c.messages.push({ id: uid(), role: 'user', text: (text || '(photo)') + (imgs.length ? `\n📷 ${imgs.length} photo${imgs.length > 1 ? 's' : ''}` : ''), ts: now() });
  $('#aiInput').value = ''; $('#aiInput').style.height = 'auto'; aiImages = []; await saveChat(c); renderChat();
  try {
    if (check) await doCheck(c, imgs, text); else if (imgs.length) await doChat(c, text, imgs); else if (PRACTICE_RE.test(text)) await doPractice(c, text); else if (VERDICT_RE.test(text)) await doVerdict(c); else await doChat(c, text, []);
  } catch (err) { aiError = String(err.message || err); }
  imgs.forEach(i => URL.revokeObjectURL(i.url)); await saveChat(c); aiBusy = false; $('#aiSend').disabled = false; setStatus('#chatStatus', ''); renderChat();
});
async function doChat(c, text, imgs) {
  setStatus('#chatStatus', 'Thinking…', false, true); const src = scopeSource(150000), history = c.messages.slice(-9, -1).map(m => ({ role: m.role, text: m.text }));
  const r = await callAI('chat', { question: text, history, sourceText: src.text, images: imgs.map(i => ({ data: i.data, mime: i.mime })) });
  c.messages.push({ id: uid(), role: 'ai', text: r.text, ts: now() });
}
async function doPractice(c, text) {
  const n = wantedCount(text); setStatus('#chatStatus', 'Writing fresh questions…', false, true); const src = scopeSource(60000);
  const r = await callAI('practice', { request: text, count: Math.min(n + 2, 10), subject: src.name, sourceText: src.text }); let parsed; try { parsed = parseJSON(r.text); } catch { throw new Error('The AI reply was not valid. Please try again.'); }
  let cands = (Array.isArray(parsed.questions) ? parsed.questions : []).map(q => ({ question: String(q.question || '').trim(), marks: Math.min(Math.max(parseInt(q.marks) || 2, 1), 6), answer: String(q.answer || '').trim(), solution: String(q.solution || '').trim() })).filter(q => q.question.length >= 10 && q.answer && q.solution);
  const seen = []; cands = cands.filter(q => { const k = normTxt(q.question); if (seen.some(x => x === k || similar(x, k))) return false; seen.push(k); return true; });
  if (!cands.length) throw new Error('No usable questions came back. Try again with a more specific topic.');
  let note = '', dropped = 0;
  try { setStatus('#chatStatus', 'Double-checking the answers…', false, true); const v = await callAI('practice_verify', { questions: cands.map(q => q.question) }); const ans = (parseJSON(v.text).answers) || []; const before = cands.length; cands = cands.filter((q, i) => { const a = ans.find(x => Number(x.i) === i); return !a || answersAgree(q.answer, String(a.finalAnswer || '')); }); dropped = before - cands.length; }
  catch { note = ' The independent answer check could not run this time.'; }
  const chosen = cands.slice(0, n); if (!chosen.length) throw new Error('The questions failed the answer double-check. Please ask again.');
  const set = { id: uid(), topic: String(parsed.topic || text).replace(/\s+/g, ' ').slice(0, 60), createdAt: now(), answered: false, questions: chosen }; c.sets.push(set); c.sets = c.sets.slice(-20);
  c.messages.push({ id: uid(), role: 'ai', setId: set.id, ts: now(), text: `## 📝 Practice set: ${set.topic}\n` + chosen.map((q, i) => `**Q${i + 1}.** (${q.marks} mark${q.marks > 1 ? 's' : ''}) ${q.question}`).join('\n\n') + `\n\n> [!tip] How to answer\n> Solve on paper, then tap 📷 and send a photo of your working. These questions are new and were not taken from your notes.${dropped ? ` ${dropped} weaker question(s) were replaced after a double-check.` : ''}${note}` });
}
async function doCheck(c, imgs, note) {
  const set = openSetOf(c); setStatus('#chatStatus', 'Reading your work and marking it…', false, true);
  const r = await callAI('check_answer', { images: imgs.map(i => ({ data: i.data, mime: i.mime })), questions: set.questions, recent: (c.results || []).slice(-8), note }); let p; try { p = parseJSON(r.text); } catch { throw new Error('I could not understand the marking result. Please send the photo again.'); }
  const per = Array.isArray(p.perQuestion) ? p.perQuestion : [], icon = { correct: '✅', partial: '🟡', wrong: '❌', not_attempted: '➖', unreadable: '❓' }, q1 = t => String(t || '').split('\n').map(l => '> ' + l).join('\n'), one = t => String(t || '').replace(/\s*\n\s*/g, ' ').trim();
  let awarded = 0, total = 0; const blocks = set.questions.map((q, i) => {
    const x = per.find(y => Number(y.n) === i + 1) || {}, st = icon[x.status] ? x.status : 'unreadable'; let mk = Math.min(Math.max(Number(x.marksAwarded) || 0, 0), q.marks); if (st === 'unreadable' || st === 'not_attempted') mk = 0; if (st === 'correct') mk = q.marks;
    if (st !== 'unreadable') total += q.marks; awarded += mk;
    let b = `### Q${i + 1} · ${icon[st]} ${st === 'unreadable' ? 'could not read' : `${mk}/${q.marks}`}\n`;
    if (x.studentWrote) b += `**You wrote:** ${one(x.studentWrote)}\n\n`;
    if (st === 'unreadable') b += '> [!warning] Could not read this answer\n> Please retake a clearer, well-lit photo of it. It was not marked.';
    else if (st === 'not_attempted') b += '> [!warning] Not attempted\n> I could not find an answer for this question.';
    if (st !== 'correct' && st !== 'unreadable' && st !== 'not_attempted') { b += `> [!warning] Where it went wrong\n${q1(x.whatWentWrong || 'The answer does not match the expected result.')}\n\n`; }
    if (st === 'wrong' || st === 'partial' || st === 'not_attempted') b += `\n> [!example] Correct working\n${q1(x.correctWorking || q.solution)}`;
    return b;
  });
  const v = p.verdict || {}, ratio = total ? awarded / total : 0, level = ['Excellent', 'Good', 'Needs practice', 'Weak'].includes(v.level) ? v.level : (ratio >= .85 ? 'Excellent' : ratio >= .6 ? 'Good' : ratio >= .35 ? 'Needs practice' : 'Weak'), list = a => (Array.isArray(a) ? a : []).map(t => `- ${one(t)}`).join('\n');
  let md = `## 📊 Result: ${total ? `${awarded}/${total}` : 'not marked'} · ${total ? level : 'photo unclear'}\n` + blocks.join('\n\n');
  if (total) md += `\n\n## 🧭 Verdict on your study\n${one(v.summary)}\n\n**Strengths**\n${list(v.strengths) || '- Keep going!'}\n\n**Needs work**\n${list(v.weaknesses) || '- Nothing major spotted.'}\n\n**Next steps**\n${(Array.isArray(v.nextSteps) ? v.nextSteps : []).slice(0, 4).map((t, i) => `${i + 1}. ${one(t)}`).join('\n')}\n\n> [!extra] About this marking\n> I read your handwriting from the photo, so double-check anything I transcribed wrongly under “You wrote”.`;
  else md += '\n\nNothing could be marked. Send a clearer photo.';
  c.messages.push({ id: uid(), role: 'ai', text: md, ts: now() });
  if (total) { c.results = [...(c.results || []), { setId: set.id, topic: set.topic, awarded, total, date: now() }].slice(-50); set.answered = true; state.settings.quizHistory = [...(state.settings.quizHistory || []), { date: now(), score: awarded, total }].slice(-50); await saveSettings(); await markActivity(); renderHome(); }
}
async function doVerdict(c) {
  const res = (c.results || []).slice(-10); if (!res.length) { c.messages.push({ id: uid(), role: 'ai', text: 'I have no marked work yet. Ask me for practice questions, solve them on paper and send me a photo. Then I can give you an honest verdict.', ts: now() }); return; }
  setStatus('#chatStatus', 'Thinking…', false, true);
  const r = await callAI('chat', { question: `Give me an honest, kind verdict on my study progress. My recent marked practice results (oldest first): ${res.map(x => `${x.topic}: ${x.awarded}/${x.total}`).join('; ')}. Mistakes saved in my notebook: ${state.mistakes.length}. Tell me my level, strengths, weak topics, and 3 concrete next steps. Keep it short.`, history: [], sourceText: '' });
  c.messages.push({ id: uid(), role: 'ai', text: r.text, ts: now() });
}

/* ---------- Boot ---------- */
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('./sw.js').catch(() => {});
(async () => {
  try { db = await openDB(); await refresh(); if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); checkReminders(); window.__learnovaReady = true; checkWorkerVersion(); }
  catch (e) { toast('Local storage could not start: ' + e.message); }
})();

$('#workerBannerBtn').addEventListener('click', () => { $('#settingsBtn').click(); });
