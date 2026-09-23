import { icon, mountIcons } from './icons.js';
import { samples } from './samples.js';

const $ = id => document.getElementById(id);
const draftKey = 'workshop-story-draft-v1';
const state = { stories: [], samples: samples.map(s => ({ ...s })), preview: false, loaded: false, connected: false, pendingHearts: new Set(), selected: null, submitted: null, submitting: false, requestId: null, fingerprint: null, joinUrl: '', revision: 0 };
let renderedSignature = '';
let refreshing = false;
let toastTimer;
let pollTimer;
const fields = ['nickname', 'intended', 'actual'];
state.isAdmin = false;
state.managing = false;
state.editing = null;
state.deleting = null;
mountIcons();

const escape = text => String(text).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const uid = () => globalThis.crypto?.randomUUID?.() || `request_${Date.now()}_${Math.random().toString(36).slice(2)}`;
const sourceStories = () => state.preview ? state.samples : state.stories;
const canManage = story => story && !story.sample && (story.isOwner || state.isAdmin);

function toast(message) {
  clearTimeout(toastTimer);
  $('toast').textContent = message;
  $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3600);
}

function connection(connected) {
  state.connected = connected;
  $('connection').classList.toggle('offline', !connected);
  $('connection-label').textContent = connected ? '실시간으로 함께하는 중' : '연결을 확인해 주세요';
  $('load-error').hidden = connected;
  $('refresh-note').textContent = connected ? '사연과 공감이 자동으로 업데이트됩니다.' : '연결되면 자동으로 다시 업데이트됩니다.';
  $('submit-story').disabled = state.submitting || !connected;
}

async function api(path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(path, { ...options, credentials: 'same-origin', signal: controller.signal, headers: { ...options.headers, ...(options.body ? { 'Content-Type': 'application/json' } : {}) } });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '요청을 처리하지 못했어요. 다시 시도해 주세요.');
    return result;
  } catch (error) {
    if (error.name === 'AbortError' || error instanceof TypeError) throw new Error('연결이 원활하지 않아요. 내용은 그대로 있으니 잠시 후 다시 시도해 주세요.');
    throw error;
  } finally { clearTimeout(timeout); }
}

function visibleStories() {
  const search = $('search').value.trim().toLocaleLowerCase();
  return sourceStories().filter(s => !search || `${s.nickname} ${s.intended} ${s.actual}`.toLocaleLowerCase().includes(search)).slice().sort((a, b) => $('sort').value === 'hearts' ? b.hearts - a.hearts || b.createdAt.localeCompare(a.createdAt) : b.createdAt.localeCompare(a.createdAt));
}

function heartContents(story) { return `${icon('heart')}<span>${story.hearts}</span><span class="sr-only">${story.liked ? '공감 취소' : '공감하기'}</span>`; }

function render() {
  const list = visibleStories();
  $('story-total').textContent = state.stories.length;
  $('heart-total').textContent = state.stories.reduce((sum, s) => sum + s.hearts, 0);
  $('visible-count').textContent = list.length;
  $('sample-notice').hidden = !state.preview;
  $('story-grid').setAttribute('aria-busy', 'false');
  $('empty-state').hidden = list.length > 0;
  const searching = !!$('search').value.trim();
  $('empty-title').textContent = searching ? '아직 일치하는 이야기가 없어요.' : '첫 번째 이야기를 기다리고 있어요.';
  $('empty-description').textContent = searching ? '다른 단어나 닉네임으로 찾아보세요.' : '거창한 이야기가 아니어도 괜찮아요. 예상 밖으로 흘러간 수업 하나를 들려주세요.';
  $('show-samples').hidden = searching || state.preview;
  $('empty-write').hidden = searching;
  $('admin-toggle').textContent = state.isAdmin ? '관리자 로그아웃' : '관리자';
  $('admin-toggle').classList.toggle('admin-active', state.isAdmin);
  const signature = JSON.stringify([list, state.isAdmin]);
  if (signature !== renderedSignature) {
    const focused = document.activeElement?.dataset;
    const focusId = focused?.storyId;
    const focusAction = focused?.action;
    $('story-grid').innerHTML = list.map((story, index) => `<article class="story-card" data-id="${escape(story.id)}">
      <header class="card-header"><span class="avatar" aria-hidden="true">${escape([...story.nickname][0])}</span><h3 class="nickname" title="${escape(story.nickname)}">${escape(story.nickname)}</h3><span class="card-meta">${story.sample ? '<span class="sample-badge">예시</span>' : story.isOwner ? '<span class="owner-badge">내 사연</span>' : ''}<span class="card-number">${String(index + 1).padStart(2, '0')}</span></span></header>
      <section class="story-block"><h3>${icon('pen')}내가 의도한 수업</h3><p>${escape(story.intended)}</p></section>
      <section class="story-block actual"><h3>${icon('message')}실제로 이루어진 수업</h3><p>${escape(story.actual)}</p></section>
      <footer class="card-bottom"><button class="heart-button" data-action="heart" data-story-id="${escape(story.id)}" aria-label="${escape(story.nickname)} 사연 ${story.liked ? '공감 취소' : '공감하기'}, ${story.hearts}개" aria-pressed="${story.liked}" ${state.pendingHearts.has(story.id) ? 'disabled' : ''}>${heartContents(story)}</button><div class="card-tools">${canManage(story) ? `<div class="manage-actions"><button class="text-button" data-action="edit" data-story-id="${escape(story.id)}">수정</button><button class="text-button danger-text" data-action="delete" data-story-id="${escape(story.id)}">삭제</button></div>` : ''}<button class="card-expand" data-action="expand" data-story-id="${escape(story.id)}" aria-label="${escape(story.nickname)} 사연 크게 보기">${icon('expand')}</button></div></footer>
    </article>`).join('');
    renderedSignature = signature;
    if (focusId && focusAction) Array.from($('story-grid').querySelectorAll('button')).find(b => b.dataset.storyId === focusId && b.dataset.action === focusAction)?.focus({ preventScroll: true });
  }
  renderDetail();
}

async function refresh() {
  if (refreshing || state.submitting || state.managing || state.pendingHearts.size) return;
  refreshing = true;
  const revision = state.revision;
  try {
    const result = await api('/api/stories');
    if (revision !== state.revision) return;
    const firstLoad = !state.loaded;
    const wasEmpty = state.stories.length === 0;
    state.stories = result.stories;
    state.isAdmin = result.isAdmin === true;
    if (firstLoad && !result.stories.length) state.preview = true;
    if (wasEmpty && result.stories.length) state.preview = false;
    state.loaded = true;
    connection(true);
    render();
  } catch { connection(false); if (!state.loaded) { $('story-grid').innerHTML = ''; $('story-grid').setAttribute('aria-busy', 'false'); } }
  finally { refreshing = false; }
}

function showTab(tab, { push = true, focus = false } = {}) {
  for (const name of ['board', 'collect']) {
    const active = name === tab;
    $(`panel-${name}`).hidden = !active;
    $(`tab-${name}`).classList.toggle('active', active);
    $(`tab-${name}`).setAttribute('aria-selected', String(active));
    $(`tab-${name}`).tabIndex = active ? 0 : -1;
  }
  if (push) history.pushState({ tab }, '', tab === 'collect' ? '/join' : '/');
  if (focus) $(`tab-${tab}`).focus();
}

function collect() { showTab('collect'); window.scrollTo({ top: 0, behavior: 'instant' }); }
document.querySelectorAll('[data-tab]').forEach(button => {
  button.addEventListener('click', () => showTab(button.dataset.tab));
  button.addEventListener('keydown', event => {
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const tab = event.key === 'Home' ? 'collect' : event.key === 'End' ? 'board' : button.dataset.tab === 'collect' ? 'board' : 'collect';
      showTab(tab, { focus: true });
    }
  });
});
window.addEventListener('popstate', () => showTab(location.pathname === '/join' ? 'collect' : 'board', { push: false }));
for (const id of ['aside-write', 'empty-write']) $(id).addEventListener('click', collect);
for (const id of ['search', 'sort']) $(id).addEventListener('input', render);
$('hide-samples').addEventListener('click', () => { state.preview = false; render(); });
function showSamples() { state.preview = true; $('search').value = ''; showTab('board'); render(); }
$('show-samples').addEventListener('click', showSamples);
$('footer-samples').addEventListener('click', () => { showSamples(); window.scrollTo({ top: 0, behavior: 'instant' }); });
$('retry').addEventListener('click', refresh);

async function toggleHeart(id) {
  const story = sourceStories().find(s => s.id === id);
  if (!story || state.pendingHearts.has(id)) return;
  if (story.sample) {
    story.liked = !story.liked;
    story.hearts += story.liked ? 1 : -1;
    render();
    toast('예시 사연에 공감해 봤어요. 실제 집계에는 포함되지 않아요.');
    return;
  }
  state.pendingHearts.add(id);
  state.revision++;
  document.querySelectorAll('[data-action="heart"]').forEach(button => { if (button.dataset.storyId === id) button.disabled = true; });
  if (state.selected === id) $('detail-heart').disabled = true;
  try {
    const result = await api(`/api/stories/${encodeURIComponent(id)}/heart`, { method: 'PUT', body: JSON.stringify({ liked: !story.liked }) });
    state.stories = state.stories.map(s => s.id === id ? result : s);
    connection(true);
  } catch (error) { toast(error.message); }
  finally {
    state.pendingHearts.delete(id);
    renderedSignature = '';
    render();
  }
}

$('story-grid').addEventListener('click', event => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  if (button.dataset.action === 'heart') toggleHeart(button.dataset.storyId);
  else if (button.dataset.action === 'edit') openEdit(button.dataset.storyId);
  else if (button.dataset.action === 'delete') openDelete(button.dataset.storyId);
  else { state.selected = button.dataset.storyId; renderDetail(); $('story-dialog').showModal(); }
});

function renderDetail() {
  if (!state.selected) return;
  const list = visibleStories();
  const index = list.findIndex(s => s.id === state.selected);
  const story = list[index] || sourceStories().find(s => s.id === state.selected);
  if (!story) { $('story-dialog').close(); state.selected = null; return; }
  $('detail-position').textContent = index >= 0 ? `STORY ${String(index + 1).padStart(2, '0')} / ${String(list.length).padStart(2, '0')}` : 'YOUR STORY';
  $('detail-name').textContent = story.nickname;
  $('detail-avatar').textContent = [...story.nickname][0];
  $('detail-intended').textContent = story.intended;
  $('detail-actual').textContent = story.actual;
  $('detail-sample').hidden = !story.sample;
  $('detail-manage').hidden = !canManage(story);
  $('detail-heart').innerHTML = heartContents(story);
  $('detail-heart').setAttribute('aria-pressed', String(story.liked));
  $('detail-heart').setAttribute('aria-label', `${story.liked ? '공감 취소' : '공감하기'}, ${story.hearts}개`);
  $('detail-heart').disabled = state.pendingHearts.has(story.id);
  $('previous-story').disabled = index <= 0;
  $('next-story').disabled = index < 0 || index >= list.length - 1;
}
$('detail-heart').addEventListener('click', () => toggleHeart(state.selected));
for (const [id, direction] of [['previous-story', -1], ['next-story', 1]]) $(id).addEventListener('click', () => {
  const list = visibleStories();
  const next = list[list.findIndex(s => s.id === state.selected) + direction];
  if (next) { state.selected = next.id; renderDetail(); }
});
document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => $(button.dataset.close).close()));
document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('click', event => {
  if (event.target !== dialog) return;
  if (state.managing && ['edit-dialog', 'delete-dialog', 'admin-dialog'].includes(dialog.id)) return;
  const box = dialog.getBoundingClientRect();
  if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close();
}));
$('story-dialog').addEventListener('close', () => { state.selected = null; });

function saveDraft() {
  try { localStorage.setItem(draftKey, JSON.stringify({ ...Object.fromEntries(fields.map(name => [name, $(name).value])), requestId: state.requestId, fingerprint: state.fingerprint })); }
  catch { document.querySelector('.form-footnote').textContent = '이 브라우저에서는 자동 저장이 제한됩니다. 화면을 닫기 전에 제출해 주세요.'; }
}
function updateCounter(name) {
  const max = name.endsWith('nickname') ? 20 : 200;
  const length = [...$(name).value].length;
  $(`${name}-count`).textContent = `${length} / ${max}`;
  $(`${name}-count`).classList.toggle('over', length > max);
  $(name).setCustomValidity(length > max ? `${max}자 이내로 작성해 주세요.` : '');
}
try {
  const draft = JSON.parse(localStorage.getItem(draftKey) || '{}');
  for (const name of fields) if (typeof draft[name] === 'string') $(name).value = draft[name];
  state.requestId = typeof draft.requestId === 'string' ? draft.requestId : null;
  state.fingerprint = typeof draft.fingerprint === 'string' ? draft.fingerprint : null;
} catch { /* A broken or unavailable draft does not prevent submission. */ }
for (const name of fields) {
  updateCounter(name);
  $(name).addEventListener('input', () => { updateCounter(name); saveDraft(); $('form-error').hidden = true; });
}

$('story-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (state.submitting) return;
  const payload = Object.fromEntries(fields.map(name => [name, $(name).value.trim()]));
  for (const name of fields) {
    if (!payload[name]) { $(name).setCustomValidity('내용을 입력해 주세요.'); $(name).reportValidity(); return; }
  }
  const fingerprint = JSON.stringify(payload);
  if (state.fingerprint !== fingerprint || !state.requestId) { state.requestId = uid(); state.fingerprint = fingerprint; }
  saveDraft();
  state.submitting = true;
  state.revision++;
  $('submit-story').disabled = true;
  $('submit-story').textContent = '이야기 보내는 중…';
  $('form-error').hidden = true;
  for (const name of fields) $(name).readOnly = true;
  try {
    const result = await api('/api/stories', { method: 'POST', body: JSON.stringify({ ...payload, requestId: state.requestId }) });
    state.stories = [result, ...state.stories.filter(s => s.id !== result.id)];
    state.submitted = result.id;
    state.preview = false;
    state.loaded = true;
    state.requestId = null;
    state.fingerprint = null;
    $('intended').value = ''; $('actual').value = '';
    fields.forEach(updateCounter);
    saveDraft();
    $('story-form').hidden = true;
    $('submit-success').hidden = false;
    $('view-submitted').focus();
    render();
    connection(true);
  } catch (error) { $('form-error').textContent = error.message; $('form-error').hidden = false; }
  finally {
    state.submitting = false;
    for (const name of fields) $(name).readOnly = false;
    $('submit-story').disabled = !state.connected;
    $('submit-story').innerHTML = `이야기 나누기 ${icon('arrow-right')}`;
  }
});
$('view-submitted').addEventListener('click', () => {
  state.preview = false; $('search').value = ''; $('sort').value = 'latest';
  showTab('board'); render();
  const card = Array.from($('story-grid').children).find(el => el.dataset.id === state.submitted);
  if (card) { card.scrollIntoView({ block: 'center', behavior: 'instant' }); card.classList.add('highlighted'); setTimeout(() => card.classList.remove('highlighted'), 3500); }
});
$('write-another').addEventListener('click', () => { $('story-form').hidden = false; $('submit-success').hidden = true; $('intended').focus(); });

async function loadConfig() {
  try {
    const config = await api('/api/config');
    state.joinUrl = config.joinUrl;
    $('join-url').textContent = config.joinUrl;
    $('network-note').textContent = config.isLocal ? '같은 네트워크에서 접속해 주세요.' : '가입 없이, 닉네임으로 참여할 수 있어요.';
  } catch { $('network-note').textContent = '참여 주소를 불러오지 못했어요.'; }
}
$('open-qr').addEventListener('click', async () => { if (!state.joinUrl) await loadConfig(); $('qr-dialog').showModal(); });
async function copyLink() {
  if (!state.joinUrl) await loadConfig();
  if (!state.joinUrl) return toast('참여 주소를 불러오지 못했어요. 연결을 확인해 주세요.');
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(state.joinUrl);
    else throw new Error('Clipboard unavailable');
    toast('참여 링크를 복사했어요. 선생님들께 공유해 주세요.');
  } catch {
    if (!$('qr-dialog').open) $('qr-dialog').showModal();
    const range = document.createRange(); range.selectNodeContents($('join-url'));
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    toast('선택된 참여 주소를 길게 누르거나 Ctrl+C로 복사해 주세요.');
  }
}
for (const id of ['copy-link', 'qr-copy']) $(id).addEventListener('click', copyLink);

function openEdit(id) {
  if (state.managing) return;
  const story = state.stories.find(s => s.id === id);
  if (!canManage(story)) return;
  state.editing = id;
  for (const name of fields) { $(`edit-${name}`).value = story[name]; updateCounter(`edit-${name}`); }
  $('edit-error').hidden = true;
  $('edit-dialog').showModal();
}
function openDelete(id) {
  if (state.managing) return;
  if (!canManage(state.stories.find(s => s.id === id))) return;
  state.deleting = id;
  $('delete-error').hidden = true;
  $('delete-dialog').showModal();
}
$('detail-edit').addEventListener('click', () => openEdit(state.selected));
$('detail-delete').addEventListener('click', () => openDelete(state.selected));
for (const name of fields) $(`edit-${name}`).addEventListener('input', () => { updateCounter(`edit-${name}`); $('edit-error').hidden = true; });
function managementBusy(dialog, busy) {
  state.managing = busy;
  $(dialog).querySelectorAll('button,input,textarea').forEach(el => { el.disabled = busy; });
}
for (const id of ['edit-dialog', 'delete-dialog', 'admin-dialog']) $(id).addEventListener('cancel', event => { if (state.managing) event.preventDefault(); });
$('edit-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (state.managing) return;
  const payload = Object.fromEntries(fields.map(name => [name, $(`edit-${name}`).value.trim()]));
  for (const name of fields) if (!payload[name]) { $(`edit-${name}`).setCustomValidity('내용을 입력해 주세요.'); $(`edit-${name}`).reportValidity(); return; }
  managementBusy('edit-dialog', true);
  state.revision++;
  $('save-edit').textContent = '저장 중…';
  $('edit-error').hidden = true;
  try {
    const saved = await api(`/api/stories/${encodeURIComponent(state.editing)}`, { method: 'PUT', body: JSON.stringify(payload) });
    state.stories = state.stories.map(s => s.id === saved.id ? saved : s);
    $('edit-dialog').close(); render(); toast('사연을 수정했어요.');
  } catch (error) { $('edit-error').textContent = error.message; $('edit-error').hidden = false; }
  finally { managementBusy('edit-dialog', false); $('save-edit').textContent = '수정 저장'; }
});
$('confirm-delete').addEventListener('click', async () => {
  if (state.managing) return;
  const id = state.deleting;
  managementBusy('delete-dialog', true);
  state.revision++;
  $('confirm-delete').textContent = '삭제 중…';
  $('delete-error').hidden = true;
  try {
    await api(`/api/stories/${encodeURIComponent(id)}`, { method: 'DELETE' });
    state.stories = state.stories.filter(s => s.id !== id);
    $('delete-dialog').close(); render(); toast('사연을 삭제했어요.');
    if (state.submitted === id) { state.submitted = null; $('story-form').hidden = false; $('submit-success').hidden = true; }
  } catch (error) { $('delete-error').textContent = error.message; $('delete-error').hidden = false; }
  finally { managementBusy('delete-dialog', false); $('confirm-delete').textContent = '삭제하기'; }
});
$('admin-toggle').addEventListener('click', async () => {
  if (state.managing) return;
  if (!state.isAdmin) { $('admin-password').value = ''; $('admin-error').hidden = true; $('admin-dialog').showModal(); return; }
  state.managing = true;
  state.revision++;
  try {
    await api('/api/admin/login', { method: 'DELETE' });
    state.isAdmin = false; render(); toast('관리자에서 로그아웃했어요.');
  } catch (error) { toast(error.message); }
  finally { state.managing = false; }
});
$('admin-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (state.managing) return;
  managementBusy('admin-dialog', true);
  state.revision++;
  $('admin-error').hidden = true;
  try {
    await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ password: $('admin-password').value }) });
    state.isAdmin = true; $('admin-password').value = ''; $('admin-dialog').close(); render(); toast('관리자로 로그인했어요. 모든 사연을 관리할 수 있어요.');
  } catch (error) { $('admin-error').textContent = error.message; $('admin-error').hidden = false; }
  finally { managementBusy('admin-dialog', false); }
});

showTab(location.pathname === '/join' ? 'collect' : 'board', { push: false });
$('submit-story').disabled = true;
$('story-grid').innerHTML = '<div class="loading-placeholder"></div>'.repeat(3);
await refresh();
await loadConfig();
pollTimer = setInterval(() => { if (!document.hidden) refresh(); }, 3000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
window.addEventListener('online', refresh);
window.addEventListener('offline', () => connection(false));
window.addEventListener('pagehide', () => clearInterval(pollTimer));
window.addEventListener('pageshow', event => { if (event.persisted) { refresh(); pollTimer = setInterval(() => { if (!document.hidden) refresh(); }, 3000); } });
