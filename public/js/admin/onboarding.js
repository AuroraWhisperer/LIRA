'use strict';

import { api as defaultApi, readJsonResponse, showError as defaultShowError, toast as defaultToast, showConfirmationDialog } from '../shared/utils.js';

export const ONBOARDING_VERSION = 1;
export const ONBOARDING_STEPS = Object.freeze(['welcome', 'bilibili', 'import', 'music', 'ai', 'docs', 'complete']);

const STEP_LABELS = Object.freeze({
  welcome: '欢迎', bilibili: '直播基础', import: '歌单', music: '音乐登录', ai: 'AI', docs: '使用文档', complete: '完成'
});

export function normalizeOnboardingState(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const settings = source.settings && typeof source.settings === 'object' ? source.settings : source;
  const liveStatus = source.liveStatus && typeof source.liveStatus === 'object' ? source.liveStatus : {};
  const musicPlatform = String(source.musicPlatform || 'qq');
  return {
    settings,
    liveStatus,
    roomId: String(source.roomId ?? settings.roomId ?? '').trim(),
    bilibiliLoggedIn: Boolean(source.bilibiliLoggedIn),
    bilibiliAvailable: source.bilibiliAvailable !== false,
    importAcknowledged: Boolean(source.importAcknowledged),
    musicPlatform: ['qq', 'netease', 'wesing'].includes(musicPlatform) ? musicPlatform : 'qq',
    musicAcknowledged: Boolean(source.musicAcknowledged),
    aiEnabled: Boolean(source.aiEnabled),
    aiTested: Boolean(source.aiTested),
    hasDeepSeekApiKey: Boolean(source.hasDeepSeekApiKey),
    docsAcknowledged: Boolean(source.docsAcknowledged),
    skippedOptional: Array.isArray(source.skippedOptional) ? [...new Set(source.skippedOptional.map(String))] : []
  };
}

export function getStepGate(stepId, stateInput) {
  const state = normalizeOnboardingState(stateInput);
  switch (stepId) {
    case 'welcome': return true;
    case 'bilibili': return state.bilibiliAvailable && state.bilibiliLoggedIn && Boolean(state.roomId) && state.liveStatus.connected === true;
    case 'import': return state.importAcknowledged;
    case 'music': return state.musicAcknowledged;
    case 'ai': return !state.aiEnabled || (state.hasDeepSeekApiKey && state.aiTested);
    case 'docs': return state.docsAcknowledged;
    case 'complete': return true;
    default: return false;
  }
}

export function getNextStep(stepId, stateInput) {
  const index = ONBOARDING_STEPS.indexOf(stepId);
  if (index < 0 || !getStepGate(stepId, stateInput)) return stepId;
  return ONBOARDING_STEPS[Math.min(index + 1, ONBOARDING_STEPS.length - 1)];
}

export function isOnboardingComplete(settings = {}, version = ONBOARDING_VERSION) {
  return String(settings.onboardingVersion || '') === String(version)
    && Boolean(String(settings.onboardingCompletedAt || '').trim());
}

export function getIncompleteOptionalSteps(stateInput) {
  const state = normalizeOnboardingState(stateInput);
  return state.aiEnabled || state.skippedOptional.includes('ai') ? [] : ['ai'];
}

function getById(document, id) { return document.getElementById(id); }

export function createOnboardingController(deps = {}) {
  const document = deps.document || globalThis.document;
  const window = deps.window || globalThis.window || {};
  const api = deps.api || defaultApi;
  const toast = deps.toast || defaultToast;
  const showError = deps.showError || defaultShowError;
  const getAppState = deps.getAppState || (() => ({}));
  const reconnectBilibili = deps.reconnectBilibili;
  const openUsageGuide = deps.openUsageGuide;
  const root = getById(document, 'liraOnboarding');
  if (!root) return { open() {}, close() {}, reset() {}, next() { return false; }, previous() {}, refresh() {}, getState: () => ({}) };

  const elements = {
    content: getById(document, 'onboardingStepContent'), progress: getById(document, 'onboardingProgress'), status: getById(document, 'onboardingStatus'),
    back: getById(document, 'onboardingBackBtn'), next: getById(document, 'onboardingNextBtn'), skip: getById(document, 'onboardingSkipBtn'), close: getById(document, 'onboardingCloseBtn'),
    room: getById(document, 'onboardingRoomId'), bilibiliState: getById(document, 'onboardingBilibiliState'), musicPlatform: getById(document, 'onboardingMusicPlatform'), musicDescription: getById(document, 'onboardingMusicDescription'), musicStatus: getById(document, 'onboardingMusicStatus'),
    importAck: getById(document, 'onboardingImportAcknowledged'), musicAck: getById(document, 'onboardingMusicAcknowledged'), aiEnable: getById(document, 'onboardingAiEnable'), aiFields: getById(document, 'onboardingAiFields'), aiUrl: getById(document, 'onboardingAiUrl'), aiModel: getById(document, 'onboardingAiModel'), aiKey: getById(document, 'onboardingAiKey'), docsAck: getById(document, 'onboardingDocsAcknowledged'), summary: getById(document, 'onboardingSummary')
  };
  const sections = Array.from(elements.content?.querySelectorAll('[data-onboarding-step]') || []);
  let state = normalizeOnboardingState({});
  let stepId = 'welcome';
  let openState = false;
  let busy = false;
  let previousFocus = null;
  let initialized = false;

  function setStatus(message = '', tone = '') {
    elements.status.textContent = message;
    elements.status.className = `lira-onboarding-status${tone ? ` ${tone}` : ''}`;
  }

  function render() {
    sections.forEach((section) => { section.hidden = section.dataset.onboardingStep !== stepId; });
    elements.progress.replaceChildren(...ONBOARDING_STEPS.map((id, index) => {
      const marker = document.createElement('span');
      marker.className = index <= ONBOARDING_STEPS.indexOf(stepId) ? 'active' : '';
      marker.title = STEP_LABELS[id];
      return marker;
    }));
    elements.back.disabled = busy || ONBOARDING_STEPS.indexOf(stepId) === 0;
    elements.next.hidden = stepId === 'complete';
    elements.next.disabled = busy || !getStepGate(stepId, state);
    elements.skip.hidden = stepId !== 'ai';
    elements.skip.disabled = busy;
    elements.finish = getById(document, 'onboardingFinishBtn');
    if (elements.finish) elements.finish.disabled = busy;
    if (elements.room && stepId === 'bilibili' && document.activeElement !== elements.room) elements.room.value = state.roomId;
    if (elements.importAck) elements.importAck.checked = state.importAcknowledged;
    if (elements.musicAck) elements.musicAck.checked = state.musicAcknowledged;
    if (elements.aiEnable) elements.aiEnable.checked = state.aiEnabled;
    if (elements.aiFields) elements.aiFields.hidden = !state.aiEnabled;
    if (elements.docsAck) elements.docsAck.checked = state.docsAcknowledged;
    renderMusicCopy();
    renderSummary();
  }

  function renderMusicCopy() {
    const platform = state.musicPlatform;
    if (elements.musicPlatform) elements.musicPlatform.value = platform;
    if (elements.musicDescription) elements.musicDescription.textContent = platform === 'wesing'
      ? '全民 K 歌必须在全民 K 歌宿主客户端登录；LIRA 只读取本机播放状态。'
      : `${platform === 'qq' ? 'QQ 音乐' : '网易云音乐'}在 LIRA「播放」页顶部登录，向导不会复制登录窗口。`;
    const qq = getById(document, 'onboardingMusicQqLogin');
    const netease = getById(document, 'onboardingMusicNeteaseLogin');
    if (qq) qq.hidden = platform !== 'qq';
    if (netease) netease.hidden = platform !== 'netease';
  }

  function renderSummary() {
    if (!elements.summary) return;
    elements.summary.replaceChildren(...getIncompleteOptionalSteps(state).map((id) => {
      const item = document.createElement('li'); item.textContent = `${STEP_LABELS[id]}：稍后可在百宝箱中补充`; return item;
    }));
  }

  async function refresh() {
    const settings = getAppState()?.settings || {};
    state = normalizeOnboardingState({ ...state, settings, roomId: settings.roomId || state.roomId, liveStatus: getAppState()?.liveStatus || state.liveStatus });
    if (window.bilibiliAuth?.getAuthState) {
      state.bilibiliAvailable = true;
      try { state.bilibiliLoggedIn = Boolean((await window.bilibiliAuth.getAuthState()).loggedIn); } catch (_) { state.bilibiliLoggedIn = false; }
    } else state.bilibiliAvailable = false;
    if (elements.bilibiliState) {
      elements.bilibiliState.textContent = state.bilibiliAvailable
        ? (state.bilibiliLoggedIn ? 'Bilibili 已登录。保存房间号后刷新直播即可。' : '尚未登录 Bilibili。')
        : '当前是 Web 模式，扫码登录需要桌面版。';
      elements.bilibiliState.className = `lira-onboarding-inline-status ${state.bilibiliLoggedIn ? 'good' : ''}`;
    }
    if (stepId === 'ai') {
      try {
        const response = await fetch('/api/ai/config');
        const payload = await response.json();
        if (payload.ok) state = normalizeOnboardingState({ ...state, hasDeepSeekApiKey: payload.data?.hasDeepSeekApiKey, aiEnabled: payload.data?.enabled === true || state.aiEnabled });
      } catch (_) { state.aiTested = false; }
    }
    render();
    return state;
  }

  async function persistAndReconnect() {
    const roomId = elements.room?.value.trim() || '';
    if (!roomId) throw new Error('请填写直播间号或链接。');
    await api('/api/settings', { roomId });
    if (!reconnectBilibili) throw new Error('直播刷新能力不可用，请在桌面版或设置页完成。');
    await reconnectBilibili();
    await refresh();
    state.roomId = roomId;
    render();
  }

  async function next() {
    if (busy) return false;
    if (stepId === 'bilibili') {
      busy = true; render(); setStatus('正在保存房间并刷新直播连接…');
      try { await persistAndReconnect(); } catch (error) { setStatus(error.message || '保存失败。', 'error'); showError(error); busy = false; render(); return false; }
      busy = false;
    }
    if (!getStepGate(stepId, state)) { setStatus('请先完成当前步骤后再继续。', 'error'); render(); return false; }
    stepId = getNextStep(stepId, state); setStatus(''); render(); return true;
  }

  function previous() { if (busy) return; const index = ONBOARDING_STEPS.indexOf(stepId); stepId = ONBOARDING_STEPS[Math.max(0, index - 1)]; setStatus(''); render(); }

  async function finish() {
    if (busy) return;
    busy = true; render(); setStatus('正在保存引导完成状态…');
    try { await api('/api/settings', { onboardingVersion: String(ONBOARDING_VERSION), onboardingCompletedAt: new Date().toISOString(), onboardingSkippedOptional: state.skippedOptional.join(',') }); close({ confirmed: true }); toast('首次启动引导已完成'); }
    catch (error) { setStatus(error.message || '保存失败，请重试。', 'error'); showError(error); }
    finally { busy = false; render(); }
  }

  function skipAi() { state.skippedOptional = [...new Set([...state.skippedOptional, 'ai'])]; state.aiEnabled = false; stepId = getNextStep('ai', state); setStatus('AI 已标记为稍后设置。', 'good'); render(); }

  async function testAi() {
    if (busy) return;
    busy = true; render(); setStatus('正在保存并测试 DeepSeek…');
    try {
      const config = { enabled: true, modelProvider: 'deepseek', deepseekResponsesUrl: elements.aiUrl.value.trim(), model: elements.aiModel.value.trim(), deepseekApiKey: elements.aiKey.value };
      const saved = await fetch('/api/ai/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config) });
      const savedPayload = await readJsonResponse(saved, '保存 AI 配置失败');
      if (!saved.ok || !savedPayload.ok) throw new Error(savedPayload.error || '保存 AI 配置失败');
      const tested = await fetch('/api/ai/test/deepseek', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const testedPayload = await readJsonResponse(tested, 'DeepSeek 测试失败');
      if (!tested.ok || !testedPayload.ok) throw new Error(testedPayload.error || 'DeepSeek 测试失败');
      state.aiEnabled = true; state.aiTested = true; state.hasDeepSeekApiKey = true; setStatus('DeepSeek 测试成功。', 'good');
    } catch (error) { state.aiTested = false; setStatus(error.message || 'DeepSeek 测试失败。', 'error'); showError(error); }
    finally { busy = false; render(); }
  }

  function open(options = {}) { if (options.reset) { state = normalizeOnboardingState({}); stepId = 'welcome'; } previousFocus = document.activeElement; openState = true; root.hidden = false; document.body.classList.add('onboarding-open'); void refresh(); requestAnimationFrame(() => elements.close.focus()); }
  async function close(options = {}) {
    if (!openState) return;
    if (!options.confirmed) {
      const confirmed = await showConfirmationDialog({
        variant: 'caution',
        title: '退出首次使用引导？',
        description: '退出后可以从「百宝箱 → 使用文档」重新打开，尚未完成的设置不会保存。',
        confirmLabel: '退出引导',
        cancelLabel: '继续设置',
        initialFocus: 'cancel'
      });
      if (!confirmed) return;
    }
    openState = false; root.hidden = true; document.body.classList.remove('onboarding-open'); previousFocus?.focus?.();
  }
  async function reset() { await api('/api/settings', { onboardingVersion: '', onboardingCompletedAt: '', onboardingSkippedOptional: '' }); open({ reset: true }); }
  function maybeAutoOpen() { const settings = getAppState()?.settings || {}; if (!isOnboardingComplete(settings)) open(); }

  if (!initialized) {
    initialized = true;
    getById(document, 'onboardingBilibiliLogin')?.addEventListener('click', async () => { if (!window.bilibiliAuth?.login || busy) return; busy = true; render(); setStatus('请在弹出窗口中扫码登录…'); try { await window.bilibiliAuth.login(); await refresh(); } catch (error) { setStatus(error.message || '登录失败。', 'error'); } finally { busy = false; render(); } });
    getById(document, 'onboardingBilibiliRefresh')?.addEventListener('click', () => refresh());
    elements.room?.addEventListener('input', () => { state.roomId = elements.room.value.trim(); render(); });
    elements.importAck?.addEventListener('change', () => { state.importAcknowledged = elements.importAck.checked; render(); });
    elements.musicPlatform?.addEventListener('change', () => { state.musicPlatform = elements.musicPlatform.value; state.musicAcknowledged = false; render(); });
    elements.musicAck?.addEventListener('change', () => { state.musicAcknowledged = elements.musicAck.checked; render(); });
    elements.aiEnable?.addEventListener('change', () => { state.aiEnabled = elements.aiEnable.checked; state.aiTested = false; render(); });
    elements.docsAck?.addEventListener('change', () => { state.docsAcknowledged = elements.docsAck.checked; render(); });
    getById(document, 'onboardingImportOpen')?.addEventListener('click', () => { document.querySelector('[data-tab="importPage"]')?.click(); toast('已打开导入导出标签页'); });
    getById(document, 'onboardingDocsOpen')?.addEventListener('click', () => openUsageGuide?.());
    getById(document, 'onboardingMusicQqLogin')?.addEventListener('click', () => window.musicAPI?.login?.('qq').then(() => { state.musicAcknowledged = true; render(); }).catch(showError));
    getById(document, 'onboardingMusicNeteaseLogin')?.addEventListener('click', () => window.musicAPI?.login?.('netease').then(() => { state.musicAcknowledged = true; render(); }).catch(showError));
    elements.aiFields?.querySelector('#onboardingAiTest')?.addEventListener('click', testAi);
    elements.back?.addEventListener('click', previous); elements.next?.addEventListener('click', next); elements.skip?.addEventListener('click', skipAi); getById(document, 'onboardingFinishBtn')?.addEventListener('click', finish); elements.close?.addEventListener('click', () => close()); root.querySelector('[data-onboarding-close]')?.addEventListener('click', () => close());
    getById(document, 'reopenOnboardingBtn')?.addEventListener('click', () => open({ reset: false }));
    document.addEventListener('keydown', (event) => { if (!openState) return; if (event.key === 'Escape') { event.preventDefault(); close(); } if (event.key === 'Tab') { const focusable = Array.from(root.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]):not(.lira-select-native)')); const first = focusable[0], last = focusable[focusable.length - 1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } } });
  }
  render();
  return { open, close, reset, next, previous, refresh, getState: () => ({ stepId, state: { ...state }, open: openState }), maybeAutoOpen };
}

let controller = null;
export function initOnboarding(deps = {}) {
  if (controller) return controller;
  controller = createOnboardingController({ document, window, api: defaultApi, toast: defaultToast, showError: defaultShowError, ...deps });
  return controller;
}
