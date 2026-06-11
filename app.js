// ═══════════════════════════════════════════
//  수행 평가 알리미 — Supabase 연동 버전
// ═══════════════════════════════════════════

// ──────────────────────────────────────────
//  Supabase 초기화
// ──────────────────────────────────────────
const SUPABASE_URL  = 'https://aztersewhilaufwoccie.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF6dGVyc2V3aGlsYXVmd29jY2llIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODExNTQxNDUsImV4cCI6MjA5NjczMDE0NX0.4zDByBNx0HtNFMrx9nCbnHIhHpwzyflIkTQmPKjLocw';

// Web Push VAPID 공개키
const VAPID_PUBLIC_KEY = 'BJgAZCbkMIQ63tgE5T_9b6Tdq_IxQ-BJxQi8nxp8GiuzNaYC1ZlPG_HqdRwdVMKDZ9jxQH6lXfQLP4qNn34XGDg';

const { createClient } = supabase;   // loaded from CDN UMD bundle
const db = createClient(SUPABASE_URL, SUPABASE_ANON);

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

// ──────────────────────────────────────────
//  State
// ──────────────────────────────────────────
let evaluations = [];
let themeState  = { dark: false, pastel: 4 };
let notifTimers = new Map();
let editingId   = null;
let deleteId    = null;

// ──────────────────────────────────────────
//  Supabase CRUD
// ──────────────────────────────────────────

/** DB에서 전체 목록 불러오기 */
async function fetchEvals() {
  const { data, error } = await db
    .from('evaluations')
    .select('*')
    .order('date', { ascending: true });
  if (error) { console.error('fetch error:', error); return; }
  // DB 컬럼명(snake_case) → 앱 내부 camelCase 매핑
  evaluations = data.map(dbToApp);
  rescheduleAll();
  render();
}

/** 추가 */
async function addEval(data) {
  const { data: rows, error } = await db
    .from('evaluations')
    .insert([appToDb(data)])
    .select();
  if (error) { showToast('❌ 저장 실패: ' + error.message); return; }
  evaluations.push(dbToApp(rows[0]));
  scheduleNotifs(dbToApp(rows[0]));
  render();
  showToast('✅ 수행 평가가 추가됐어요');
}

/** 수정 */
async function updateEval(id, data) {
  const { error } = await db
    .from('evaluations')
    .update(appToDb(data))
    .eq('id', id);
  if (error) { showToast('❌ 수정 실패: ' + error.message); return; }
  const idx = evaluations.findIndex(e => e.id === id);
  if (idx >= 0) {
    evaluations[idx] = { ...evaluations[idx], ...data };
    scheduleNotifs(evaluations[idx]);
  }
  render();
  showToast('✏️ 수정됐어요');
}

/** 삭제 */
async function deleteEval(id) {
  const { error } = await db
    .from('evaluations')
    .delete()
    .eq('id', id);
  if (error) { showToast('❌ 삭제 실패: ' + error.message); return; }
  cancelNotifs(id);
  evaluations = evaluations.filter(e => e.id !== id);
  render();
  showToast('🗑️ 삭제됐어요');
}

/** 완료 토글 */
async function toggleComplete(id) {
  const eval_ = evaluations.find(e => e.id === id);
  if (!eval_) return;
  const newVal = !eval_.isCompleted;
  const { error } = await db
    .from('evaluations')
    .update({ is_completed: newVal })
    .eq('id', id);
  if (error) { showToast('❌ 오류: ' + error.message); return; }
  eval_.isCompleted = newVal;
  if (newVal) cancelNotifs(id);
  else scheduleNotifs(eval_);
  render();
}

// DB 컬럼 ↔ 앱 객체 변환
function dbToApp(row) {
  return {
    id:          row.id,
    subject:     row.subject,
    title:       row.title,
    date:        row.date,
    note:        row.note,
    isCompleted: row.is_completed,
  };
}
function appToDb(obj) {
  const row = {};
  if (obj.subject     !== undefined) row.subject      = obj.subject;
  if (obj.title       !== undefined) row.title        = obj.title;
  if (obj.date        !== undefined) row.date         = obj.date;
  if (obj.note        !== undefined) row.note         = obj.note ?? null;
  if (obj.isCompleted !== undefined) row.is_completed = obj.isCompleted;
  return row;
}

// ──────────────────────────────────────────
//  실시간 동기화 (Realtime)
// ──────────────────────────────────────────
function subscribeRealtime() {
  db.channel('evaluations-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'evaluations' }, payload => {
      if (payload.eventType === 'INSERT') {
        const item = dbToApp(payload.new);
        if (!evaluations.find(e => e.id === item.id)) {
          evaluations.push(item);
          evaluations.sort((a, b) => a.date.localeCompare(b.date));
          scheduleNotifs(item);
          render();
        }
      } else if (payload.eventType === 'UPDATE') {
        const idx = evaluations.findIndex(e => e.id === payload.new.id);
        if (idx >= 0) {
          evaluations[idx] = dbToApp(payload.new);
          scheduleNotifs(evaluations[idx]);
          render();
        }
      } else if (payload.eventType === 'DELETE') {
        cancelNotifs(payload.old.id);
        evaluations = evaluations.filter(e => e.id !== payload.old.id);
        render();
      }
    })
    .subscribe();
}

// ──────────────────────────────────────────
//  오프라인 fallback (localStorage 캐시)
// ──────────────────────────────────────────
function cacheToLocal() {
  localStorage.setItem('evals_cache', JSON.stringify(evaluations));
}
function loadFromCache() {
  try {
    const raw = localStorage.getItem('evals_cache');
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

// ──────────────────────────────────────────
//  Theme
// ──────────────────────────────────────────
function loadTheme() {
  try { return JSON.parse(localStorage.getItem('theme') ?? '{"dark":false,"pastel":4}'); }
  catch { return { dark: false, pastel: 4 }; }
}
function saveTheme() { localStorage.setItem('theme', JSON.stringify(themeState)); }

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
    ['--primary','--primary-dark','--card-bg','--surface-2','--dday-bg','--dday-color']
      .forEach(v => root.style.removeProperty(v));
    document.getElementById('meta-theme')?.setAttribute('content', '#1E1E1E');
  }
  el('btn-palette').style.display = isDark ? 'none' : '';
  el('btn-dark').textContent = isDark ? '☀️' : '🌙';
}

function hexAlpha(hex, a) {
  const [r,g,b] = parseHex(hex);
  return `rgba(${r},${g},${b},${a})`;
}
function darken(hex, f) {
  return `rgb(${parseHex(hex).map(v => Math.round(v*f)).join(',')})`;
}
function parseHex(hex) {
  return [1,3,5].map(i => parseInt(hex.slice(i, i+2), 16));
}

// ──────────────────────────────────────────
//  Notifications
// ──────────────────────────────────────────
async function requestNotifPermission() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default')
    el('notif-banner').classList.remove('hidden');
  if (Notification.permission === 'granted') {
    el('notif-banner').classList.add('hidden');
    subscribePush();  // 이미 허용된 경우 바로 구독
  }
}

async function grantNotifPermission() {
  const r = await Notification.requestPermission();
  el('notif-banner').classList.add('hidden');
  if (r === 'granted') {
    showToast('🔔 알림이 허용됐어요');
    rescheduleAll();
    await subscribePush();  // 서버 푸시 구독 등록
  }
}

// ──────────────────────────────────────────
//  Web Push 구독 등록 (서버 → 기기 알림)
// ──────────────────────────────────────────
function urlBase64ToUint8Array(b64) {
  const pad = '='.repeat((4 - b64.length % 4) % 4);
  const str = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...str].map(c => c.charCodeAt(0)));
}

async function subscribePush() {
  if (!('PushManager' in window)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }
    const j = sub.toJSON();
    // Supabase push_subscriptions 테이블에 저장 (중복 시 무시)
    await db.from('push_subscriptions').upsert([{
      endpoint: j.endpoint,
      p256dh:   j.keys.p256dh,
      auth:     j.keys.auth,
    }], { onConflict: 'endpoint', ignoreDuplicates: true });
  } catch (e) {
    console.warn('Push subscription failed:', e);
  }
}

function cancelNotifs(evalId) {
  for (let i = 0; i < 3; i++) {
    const tid = notifTimers.get(evalId * 10 + i);
    if (tid !== undefined) { clearTimeout(tid); notifTimers.delete(evalId * 10 + i); }
  }
}

function scheduleNotifs(evaluation) {
  cancelNotifs(evaluation.id);
  if (evaluation.isCompleted || Notification.permission !== 'granted') return;
  const [y, m, d] = evaluation.date.split('-').map(Number);
  const prevDay = new Date(y, m - 1, d - 1);
  const msgs = [
    `내일 ${evaluation.subject} 수행 평가가 있어요`,
    `오늘 ${evaluation.subject} 수행 평가 준비하세요`,
    `${evaluation.title} — 오늘 마지막 준비 시간이에요`,
  ];
  [0, 6, 12].forEach((hour, idx) => {
    const fire  = new Date(prevDay.getFullYear(), prevDay.getMonth(), prevDay.getDate(), hour);
    const delay = fire.getTime() - Date.now();
    if (delay <= 0 || delay > 20 * 86400_000) return;
    const tid = setTimeout(() => {
      new Notification(`수행 평가 알림 · ${evaluation.subject}`, {
        body: msgs[idx], icon: './icon.svg', tag: `eval-${evaluation.id}-${idx}`,
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
//  Date utils
// ──────────────────────────────────────────
function parseDateLocal(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function getDDay(dateStr) {
  const diff = Math.round((parseDateLocal(dateStr) - todayMidnight()) / 86400000);
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
  const t = new Date(); t.setHours(0,0,0,0); return t;
}
function todayISO() {
  return todayMidnight().toISOString().slice(0,10);
}

// ──────────────────────────────────────────
//  Rendering
// ──────────────────────────────────────────
function render() {
  cacheToLocal();
  const list    = el('eval-list');
  const pending = evaluations.filter(e => !e.isCompleted);
  const done    = evaluations.filter(e =>  e.isCompleted);

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

  list.querySelectorAll('.btn-complete').forEach(btn =>
    btn.addEventListener('click', () => toggleComplete(+btn.dataset.id))
  );
  list.querySelectorAll('.btn-edit').forEach(btn =>
    btn.addEventListener('click', () => openEditModal(+btn.dataset.id))
  );
  list.querySelectorAll('.btn-delete').forEach(btn =>
    btn.addEventListener('click', () => openDeleteConfirm(+btn.dataset.id))
  );
}

function renderCard(e) {
  const dday   = getDDay(e.date);
  const dclass = getDDayClass(e.date);
  const label  = formatDate(e.date);
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
//  Modals
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

function closeModal() { hide('modal-overlay'); editingId = null; }

function openDeleteConfirm(id) {
  const e = evaluations.find(ev => ev.id === id);
  if (!e) return;
  deleteId = id;
  el('delete-msg').textContent =
    `'${e.subject} — ${e.title}'을(를) 삭제할까요? 알림도 함께 취소됩니다.`;
  show('delete-overlay');
}
function closeDeleteConfirm() { hide('delete-overlay'); deleteId = null; }

function openThemePicker() { renderSwatches(); show('theme-overlay'); }

function renderSwatches() {
  el('theme-swatches').innerHTML = PASTELS.map((p, i) => `
    <button class="swatch ${themeState.pastel === i ? 'selected' : ''}"
            data-i="${i}" style="background:${p.hex};" title="${p.name}">
      ${themeState.pastel === i ? '✓' : ''}
    </button>`).join('');
  el('theme-swatches').querySelectorAll('.swatch').forEach(btn =>
    btn.addEventListener('click', () => {
      themeState.pastel = +btn.dataset.i;
      saveTheme(); applyTheme(); renderSwatches();
    })
  );
}

// ──────────────────────────────────────────
//  Toast
// ──────────────────────────────────────────
let toastTimer;
function showToast(msg) {
  clearTimeout(toastTimer);
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t);
  toastTimer = setTimeout(() => t.remove(), 2400);
}

// ──────────────────────────────────────────
//  로딩 스피너
// ──────────────────────────────────────────
function showLoading() {
  el('eval-list').innerHTML = `
    <div class="empty-state">
      <div class="spinner"></div>
      <p class="empty-title" style="margin-top:16px">데이터 불러오는 중…</p>
    </div>`;
}

// ──────────────────────────────────────────
//  Event Listeners
// ──────────────────────────────────────────
function setupListeners() {
  el('btn-add').addEventListener('click', openAddModal);
  el('btn-dark').addEventListener('click', () => {
    themeState.dark = !themeState.dark; saveTheme(); applyTheme();
  });
  el('btn-palette').addEventListener('click', openThemePicker);
  el('btn-allow-notif').addEventListener('click', grantNotifPermission);

  el('eval-form').addEventListener('submit', async e => {
    e.preventDefault();
    const data = {
      subject: el('f-subject').value.trim(),
      title:   el('f-title').value.trim(),
      date:    el('f-date').value,
      note:    el('f-note').value.trim() || null,
    };
    if (!data.subject || !data.title || !data.date) return;
    closeModal();
    if (editingId !== null) await updateEval(editingId, data);
    else await addEval(data);
  });

  el('modal-close').addEventListener('click', closeModal);
  el('modal-cancel').addEventListener('click', closeModal);
  el('modal-overlay').addEventListener('click', e => {
    if (e.target === el('modal-overlay')) closeModal();
  });

  el('delete-cancel').addEventListener('click', closeDeleteConfirm);
  el('delete-confirm').addEventListener('click', async () => {
    if (deleteId !== null) await deleteEval(deleteId);
    closeDeleteConfirm();
  });
  el('delete-overlay').addEventListener('click', e => {
    if (e.target === el('delete-overlay')) closeDeleteConfirm();
  });

  el('theme-close').addEventListener('click', () => hide('theme-overlay'));
  el('theme-overlay').addEventListener('click', e => {
    if (e.target === el('theme-overlay')) hide('theme-overlay');
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      closeModal(); closeDeleteConfirm(); hide('theme-overlay'); return;
    }
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === 'n' || e.key === 'N') openAddModal();
  });

  // 오프라인 ↔ 온라인 감지
  window.addEventListener('online',  () => { showToast('🌐 온라인 연결됨 — 데이터 동기화 중'); fetchEvals(); });
  window.addEventListener('offline', () => showToast('⚠️ 오프라인 — 로컬 캐시로 표시 중'));
}

// ──────────────────────────────────────────
//  PWA
// ──────────────────────────────────────────
async function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  try {
    await navigator.serviceWorker.register('./sw.js');
  } catch (e) {
    console.warn('SW registration failed:', e);
  }
}

// ──────────────────────────────────────────
//  Helpers
// ──────────────────────────────────────────
const el   = id => document.getElementById(id);
const show = id => el(id).classList.remove('hidden');
const hide = id => el(id).classList.add('hidden');
function h(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ──────────────────────────────────────────
//  Init
// ──────────────────────────────────────────
themeState = loadTheme();
applyTheme();
setupListeners();
registerSW();
requestNotifPermission();

// 오프라인이면 캐시로 먼저 보여주고, 온라인이면 DB에서 불러오기
if (!navigator.onLine) {
  evaluations = loadFromCache();
  render();
  showToast('⚠️ 오프라인 — 로컬 캐시로 표시 중');
} else {
  showLoading();
  fetchEvals().then(() => subscribeRealtime());
}
