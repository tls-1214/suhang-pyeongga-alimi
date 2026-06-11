// ═══════════════════════════════════════════
//  수행 평가 알리미 — Web App (ES Module)
// ═══════════════════════════════════════════

// ──────────────────────────────────────────
//  Constants
// ──────────────────────────────────────────
const PASTELS = [
  { name: '빨강', hex: '#FFB3B3', text: '#7A0010' },
  { name: '주황', hex: '#FFCCA8', text: '#7B3400' },
  { name: '노랑', hex: '#FFEDA0', text: '#635000' },
  { name: '초록', hex: '#B3F0C8', text: '#005A28' },
  { name: '파랑', hex: '#B3D9FF', text: '#1460A0' },
  { name: '남색', hex: '#C3C8FF', text: '#1A0080' },
  { name: '보라', hex: '#DDB3FF', text: '#4B0082' },
];

const ALARM_HOURS = [0, 6, 12];
const ALARM_MESSAGES = (subject, title) => [
  `내일 ${subject} 수행 평가가 있어요`,
  `오늘 ${subject} 수행 평가 준비하세요`,
  `${title} — 오늘 마지막 준비 시간이에요`,
];

// ──────────────────────────────────────────
//  State
// ──────────────────────────────────────────
let evaluations  = [];
let themeState   = { dark: false, pastel: 4 };
let notifTimers  = new Map(); // key: evalId * 10 + alarmIndex → timeoutId
let editingId    = null;
let deleteId     = null;

// ──────────────────────────────────────────
//  Storage
// ──────────────────────────────────────────
function loadState() {
  try {
    evaluations = JSON.parse(localStorage.getItem('evals')  ?? '[]');
    themeState  = JSON.parse(localStorage.getItem('theme')  ?? '{"dark":false,"pastel":4}');
  } catch { /* corrupted — start fresh */ }
}

function saveEvals()  { localStorage.setItem('evals',  JSON.stringify(evaluations)); }
function saveTheme()  { localStorage.setItem('theme',  JSON.stringify(themeState)); }

function nextId() {
  return evaluations.length > 0 ? Math.max(...evaluations.map(e => e.id)) + 1 : 1;
}

// ──────────────────────────────────────────
//  Theme
// ──────────────────────────────────────────
function applyTheme() {
  const root   = document.documentElement;
  const isDark = themeState.dark;
  root.dataset.dark = isDark;

  if (!isDark) {
    const p = PASTELS[themeState.pastel];
    root.style.setProperty('--primary',      p.hex);
    root.style.setProperty('--primary-dark', darken(p.hex, .62));
    root.style.setProperty('--card-bg',      hexAlpha(p.hex, .20));
    root.style.setProperty('--surface-2',    hexAlpha(p.hex, .10));
    root.style.setProperty('--dday-bg',      hexAlpha(p.hex, .30));
    root.style.setProperty('--dday-color',   p.text);
    document.getElementById('meta-theme')?.setAttribute('content', p.hex);
  } else {
    root.style.removeProperty('--primary');
    root.style.removeProperty('--primary-dark');
    root.style.removeProperty('--card-bg');
    root.style.removeProperty('--surface-2');
    root.style.removeProperty('--dday-bg');
    root.style.removeProperty('--dday-color');
    document.getElementById('meta-theme')?.setAttribute('content', '#1E1E1E');
  }

  // Palette button only visible in light mode
  el('btn-palette').style.display = isDark ? 'none' : '';
  el('btn-dark').textContent = isDark ? '☀️' : '🌙';
  el('btn-dark').title = isDark ? '라이트 모드로 전환' : '다크 모드로 전환';
}

function hexAlpha(hex, a) {
  const [r, g, b] = parseHex(hex);
  return `rgba(${r},${g},${b},${a})`;
}

function darken(hex, f) {
  const [r, g, b] = parseHex(hex).map(v => Math.round(v * f));
  return `rgb(${r},${g},${b})`;
}

function parseHex(hex) {
  return [
    parseInt(hex.slice(1,3), 16),
    parseInt(hex.slice(3,5), 16),
    parseInt(hex.slice(5,7), 16),
  ];
}

// ──────────────────────────────────────────
//  Notifications
// ──────────────────────────────────────────
async function requestNotifPermission() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'granted') return;
  if (Notification.permission === 'denied')  return;
  el('notif-banner').classList.remove('hidden');
}

async function grantNotifPermission() {
  const result = await Notification.requestPermission();
  el('notif-banner').classList.add('hidden');
  if (result === 'granted') {
    showToast('🔔 알림이 허용됐어요');
    rescheduleAll();
  }
}

function cancelNotifs(evalId) {
  for (let i = 0; i < 3; i++) {
    const key = evalId * 10 + i;
    const tid = notifTimers.get(key);
    if (tid !== undefined) { clearTimeout(tid); notifTimers.delete(key); }
  }
}

function scheduleNotifs(evaluation) {
  cancelNotifs(evaluation.id);
  if (evaluation.isCompleted) return;
  if (Notification.permission !== 'granted') return;

  const [y, m, d] = evaluation.date.split('-').map(Number);
  // Alarm fires on the day BEFORE the evaluation
  const prevDay = new Date(y, m - 1, d - 1);

  const msgs = ALARM_MESSAGES(evaluation.subject, evaluation.title);
  ALARM_HOURS.forEach((hour, idx) => {
    const fire = new Date(prevDay.getFullYear(), prevDay.getMonth(), prevDay.getDate(), hour, 0, 0);
    const delay = fire.getTime() - Date.now();
    // setTimeout max is ~24.8 days; skip past alarms; skip alarms more than 20 days out
    if (delay <= 0 || delay > 20 * 86400 * 1000) return;

    const tid = setTimeout(() => {
      new Notification(`수행 평가 알림 · ${evaluation.subject}`, {
        body:    msgs[idx],
        icon:    'icon.svg',
        tag:     `eval-${evaluation.id}-${idx}`,
        silent:  false,
      });
    }, delay);

    notifTimers.set(evaluation.id * 10 + idx, tid);
  });
}

function rescheduleAll() {
  notifTimers.forEach(tid => clearTimeout(tid));
  notifTimers.clear();
  evaluations.filter(e => !e.isCompleted).forEach(scheduleNotifs);
}

// ──────────────────────────────────────────
//  Date Utilities
// ──────────────────────────────────────────
function parseDateLocal(str) {
  // Avoid UTC-shift: parse YYYY-MM-DD as local time
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function getDDay(dateStr) {
  const evalDate = parseDateLocal(dateStr);
  const today    = todayMidnight();
  const diff     = Math.round((evalDate - today) / 86400000);
  if (diff === 0) return 'D-Day';
  return diff > 0 ? `D-${diff}` : `D+${Math.abs(diff)}`;
}

function getDDayClass(dateStr) {
  const diff = Math.round((parseDateLocal(dateStr) - todayMidnight()) / 86400000);
  if (diff <= 0) return 'dday-red';
  if (diff <= 3) return 'dday-orange';
  return 'dday-normal';
}

function formatDate(dateStr) {
  return parseDateLocal(dateStr).toLocaleDateString('ko-KR', {
    month: 'long', day: 'numeric', weekday: 'short',
  });
}

function todayMidnight() {
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  return t;
}

function todayISO() {
  return todayMidnight().toISOString().slice(0, 10);
}

// ──────────────────────────────────────────
//  CRUD
// ──────────────────────────────────────────
function addEval(data) {
  const evaluation = { id: nextId(), ...data, isCompleted: false };
  evaluations.push(evaluation);
  saveEvals();
  scheduleNotifs(evaluation);
  render();
  showToast('✅ 수행 평가가 추가됐어요');
}

function updateEval(id, data) {
  const idx = evaluations.findIndex(e => e.id === id);
  if (idx < 0) return;
  evaluations[idx] = { ...evaluations[idx], ...data };
  saveEvals();
  scheduleNotifs(evaluations[idx]);
  render();
  showToast('✏️ 수정됐어요');
}

function deleteEval(id) {
  cancelNotifs(id);
  evaluations = evaluations.filter(e => e.id !== id);
  saveEvals();
  render();
  showToast('🗑️ 삭제됐어요');
}

function toggleComplete(id) {
  const idx = evaluations.findIndex(e => e.id === id);
  if (idx < 0) return;
  evaluations[idx] = { ...evaluations[idx], isCompleted: !evaluations[idx].isCompleted };
  saveEvals();
  if (evaluations[idx].isCompleted) cancelNotifs(id);
  else scheduleNotifs(evaluations[idx]);
  render();
}

// ──────────────────────────────────────────
//  Rendering
// ──────────────────────────────────────────
function render() {
  const list    = el('eval-list');
  const pending = evaluations.filter(e => !e.isCompleted).sort(byDate);
  const done    = evaluations.filter(e =>  e.isCompleted).sort(byDate);

  if (evaluations.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📝</div>
        <p class="empty-title">등록된 수행 평가가 없어요</p>
        <p class="empty-sub">+ 버튼으로 추가해 보세요 (단축키: N)</p>
      </div>`;
    return;
  }

  let html = '';
  if (pending.length) {
    html += `<div class="section-header">예정 (${pending.length})</div>`;
    html += pending.map(renderCard).join('');
  }
  if (done.length) {
    html += `<div class="section-header">완료 (${done.length})</div>`;
    html += done.map(renderCard).join('');
  }
  list.innerHTML = html;

  // Attach event listeners to dynamically-created buttons
  list.querySelectorAll('.btn-complete').forEach(btn => {
    btn.addEventListener('click', () => toggleComplete(+btn.dataset.id));
  });
  list.querySelectorAll('.btn-edit').forEach(btn => {
    btn.addEventListener('click', () => openEditModal(+btn.dataset.id));
  });
  list.querySelectorAll('.btn-delete').forEach(btn => {
    btn.addEventListener('click', () => openDeleteConfirm(+btn.dataset.id));
  });
}

function renderCard(e) {
  const dday    = getDDay(e.date);
  const dclass  = getDDayClass(e.date);
  const label   = formatDate(e.date);
  const ddayHtml = e.isCompleted ? '' :
    `<span class="dday-badge ${dclass}">${h(dday)}</span>`;
  const noteHtml = e.note ? `<span class="card-note">${h(e.note)}</span>` : '';

  return `
    <div class="eval-card ${e.isCompleted ? 'completed' : ''}" data-id="${e.id}">
      <button class="btn-complete" data-id="${e.id}"
              title="${e.isCompleted ? '완료 취소' : '완료 처리'}">
        ${e.isCompleted ? '✅' : '⭕'}
      </button>
      <div class="card-content">
        <span class="card-subject">${h(e.subject)}</span>
        <span class="card-title">${h(e.title)}</span>
        <span class="card-date">${label}</span>
        ${noteHtml}
      </div>
      <div class="card-right">
        ${ddayHtml}
        <div class="card-actions">
          <button class="btn-edit"   data-id="${e.id}" title="수정">✏️</button>
          <button class="btn-delete" data-id="${e.id}" title="삭제">🗑️</button>
        </div>
      </div>
    </div>`;
}

// ──────────────────────────────────────────
//  Theme Picker
// ──────────────────────────────────────────
function openThemePicker() {
  renderSwatches();
  show('theme-overlay');
}

function renderSwatches() {
  el('theme-swatches').innerHTML = PASTELS.map((p, i) => `
    <button class="swatch ${themeState.pastel === i ? 'selected' : ''}"
            data-i="${i}" style="background:${p.hex};" title="${p.name}">
      ${themeState.pastel === i ? '✓' : ''}
    </button>`).join('');

  el('theme-swatches').querySelectorAll('.swatch').forEach(btn => {
    btn.addEventListener('click', () => {
      themeState.pastel = +btn.dataset.i;
      saveTheme();
      applyTheme();
      renderSwatches();
    });
  });
}

// ──────────────────────────────────────────
//  Add / Edit Modal
// ──────────────────────────────────────────
function openAddModal() {
  editingId = null;
  el('modal-title').textContent = '수행 평가 추가';
  el('f-subject').value = '';
  el('f-title').value   = '';
  el('f-date').value    = todayISO();
  el('f-note').value    = '';
  show('modal-overlay');
  el('f-subject').focus();
}

function openEditModal(id) {
  const e = evaluations.find(ev => ev.id === id);
  if (!e) return;
  editingId = id;
  el('modal-title').textContent = '수행 평가 수정';
  el('f-subject').value = e.subject;
  el('f-title').value   = e.title;
  el('f-date').value    = e.date;
  el('f-note').value    = e.note ?? '';
  show('modal-overlay');
  el('f-subject').focus();
}

function closeModal() {
  hide('modal-overlay');
  editingId = null;
}

// ──────────────────────────────────────────
//  Delete Confirm
// ──────────────────────────────────────────
function openDeleteConfirm(id) {
  const e = evaluations.find(ev => ev.id === id);
  if (!e) return;
  deleteId = id;
  el('delete-msg').textContent =
    `'${e.subject} — ${e.title}'을(를) 삭제할까요?\n알림도 함께 취소됩니다.`;
  show('delete-overlay');
}

function closeDeleteConfirm() { hide('delete-overlay'); deleteId = null; }

// ──────────────────────────────────────────
//  Toast
// ──────────────────────────────────────────
let toastTimer;
function showToast(msg) {
  clearTimeout(toastTimer);
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = msg;
  document.body.appendChild(toast);
  toastTimer = setTimeout(() => toast.remove(), 2200);
}

// ──────────────────────────────────────────
//  Event Listeners
// ──────────────────────────────────────────
function setupListeners() {
  // FAB
  el('btn-add').addEventListener('click', openAddModal);

  // Dark mode
  el('btn-dark').addEventListener('click', () => {
    themeState.dark = !themeState.dark;
    saveTheme();
    applyTheme();
  });

  // Palette
  el('btn-palette').addEventListener('click', openThemePicker);

  // Notification allow
  el('btn-allow-notif').addEventListener('click', grantNotifPermission);

  // Add/Edit form submit
  el('eval-form').addEventListener('submit', e => {
    e.preventDefault();
    const data = {
      subject: el('f-subject').value.trim(),
      title:   el('f-title').value.trim(),
      date:    el('f-date').value,
      note:    el('f-note').value.trim() || null,
    };
    if (!data.subject || !data.title || !data.date) return;
    if (editingId !== null) updateEval(editingId, data);
    else addEval(data);
    closeModal();
  });

  el('modal-close').addEventListener('click', closeModal);
  el('modal-cancel').addEventListener('click', closeModal);
  el('modal-overlay').addEventListener('click', e => {
    if (e.target === el('modal-overlay')) closeModal();
  });

  // Delete confirm
  el('delete-cancel').addEventListener('click', closeDeleteConfirm);
  el('delete-confirm').addEventListener('click', () => {
    if (deleteId !== null) deleteEval(deleteId);
    closeDeleteConfirm();
  });
  el('delete-overlay').addEventListener('click', e => {
    if (e.target === el('delete-overlay')) closeDeleteConfirm();
  });

  // Theme picker
  el('theme-close').addEventListener('click', () => hide('theme-overlay'));
  el('theme-overlay').addEventListener('click', e => {
    if (e.target === el('theme-overlay')) hide('theme-overlay');
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      closeModal();
      closeDeleteConfirm();
      hide('theme-overlay');
      return;
    }
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === 'n' || e.key === 'N') openAddModal();
  });
}

// ──────────────────────────────────────────
//  Service Worker (PWA)
// ──────────────────────────────────────────
function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {/* silent */});
  }
}

// ──────────────────────────────────────────
//  Helpers
// ──────────────────────────────────────────
const el   = id => document.getElementById(id);
const show = id => el(id).classList.remove('hidden');
const hide = id => el(id).classList.add('hidden');
const byDate = (a, b) => a.date.localeCompare(b.date);

function h(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ──────────────────────────────────────────
//  Init
// ──────────────────────────────────────────
loadState();
applyTheme();
setupListeners();
registerSW();
requestNotifPermission();
render();

// Re-check notification banner after permission changes
if ('Notification' in window && Notification.permission === 'granted') {
  rescheduleAll();
}
