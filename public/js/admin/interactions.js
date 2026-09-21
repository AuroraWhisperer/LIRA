import { api, copyText, localOverlayOrigin, showError } from '../shared/utils.js';
import { eventBus } from '../shared/event-bus.js';
import { inspectInteractionText, validateInteractionConfig, pollPageDuration, POLL_RULE, RATING_RULE } from '../shared/interaction-rules.js';
import { createInteractionClient } from '../shared/interaction-client.js';
import { renderPollRows, interactionStatus } from '../shared/interaction-view.js';
import { initInteractionAppearance } from './interaction-appearance.js';

export function initInteractions({ onCollecting = () => {} } = {}) {
  const root = document.getElementById('interactionsAdmin');
  if (!root) return;
  const get = (id) => document.getElementById(id);
  let session = null;
  let host = null;
  let busy = false;
  let polling = null;
  let disposed = false;
  let selectedKind = 'poll';
  let appearanceOpen = false;
  const tabs = [...root.querySelectorAll('[data-interaction-kind]')];
  const client = createInteractionClient({
    onState(state) { session = state.session; render(); },
    onHost(state) { host = state; render(); },
    async fetchState(isHost) {
      const response = await fetch(`/api/interactions/${isHost ? 'host-state' : 'session'}`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || '读取互动失败');
      return payload.data;
    },
  });
  const url = `${localOverlayOrigin()}/interactions`;
  get('interactionsUrl').value = url;
  get('interactionsCopy').addEventListener('click', () => copyText(url));
  get('interactionsOpen').addEventListener('click', () => window.open(url, '_blank', 'noopener'));
  get('interactionsSourceToggle').addEventListener('click', () => {
    const source = get('interactionsSource');
    source.hidden = !source.hidden;
    get('interactionsSourceToggle').setAttribute('aria-expanded', String(!source.hidden));
  });
  get('pollRule').textContent = POLL_RULE;
  get('ratingRule').textContent = RATING_RULE;

  function inputs() { return [...get('pollOptions').querySelectorAll('input')]; }
  function durationSeconds() { return get('pollDurationMinutes').valueAsNumber * 60 + get('pollDurationSeconds').valueAsNumber; }
  function validateOptions() {
    const seen = new Set();
    for (const [index, input] of inputs().entries()) {
      const result = inspectInteractionText(input.value);
      const error = result.error || (seen.has(result.text) ? '内容重复' : '');
      seen.add(result.text);
      input.setAttribute('aria-label', `选项 ${index + 1}`);
      input.setAttribute('aria-invalid', String(Boolean(error)));
      input.setCustomValidity(error);
      input.nextElementSibling.textContent = `${result.length} / 10${error ? ` · ${error}` : ''}`;
    }
    const { pages, seconds } = pollPageDuration(inputs().length);
    get('pollPageHint').textContent = pages > 1
      ? `推荐尺寸下约 ${pages} 屏，每 8 秒翻页，一轮至少 ${seconds} 秒。${durationSeconds() < seconds ? '当前时长较短，后面的选项可能来不及完整展示。' : ''}`
      : '推荐尺寸下单屏展示。';
    get('pollPageHint').hidden = pages <= 1;
    root.querySelectorAll('[data-poll-seconds]').forEach((button) => {
      button.setAttribute('aria-pressed', String(Number(button.dataset.pollSeconds) === durationSeconds()));
    });
    for (const [index, button] of [...get('pollOptions').querySelectorAll('button')].entries()) {
      button.disabled = Boolean(session) || busy || inputs().length <= 2;
      button.setAttribute('aria-label', `删除选项 ${index + 1}`);
    }
  }
  function addOption(value = '') {
    const row = document.createElement('div');
    row.className = 'interaction-input-row';
    const input = document.createElement('input');
    input.type = 'text';
    input.value = value;
    const hint = document.createElement('small');
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'secondary interaction-quiet';
    remove.textContent = '删除';
    remove.addEventListener('click', () => { row.remove(); validateOptions(); });
    input.addEventListener('input', (event) => { if (!event.isComposing) validateOptions(); });
    input.addEventListener('compositionend', validateOptions);
    row.append(input, hint, remove);
    get('pollOptions').append(row);
    validateOptions();
  }
  addOption('1');
  addOption('2');
  const appearance = initInteractionAppearance();
  function renderWorkspace() {
    if (session) selectedKind = session.kind;
    for (const tab of tabs) {
      const active = tab.dataset.interactionKind === selectedKind;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      tab.disabled = busy || Boolean(session && !active);
      if (active) get('interactionWorkspace').setAttribute('aria-labelledby', tab.id);
    }
    get('interactionActivityView').hidden = appearanceOpen;
    get('interactionAppearanceView').hidden = !appearanceOpen;
    get('interactionAppearanceToggle').setAttribute('aria-expanded', String(appearanceOpen));
    get('pollForm').hidden = Boolean(session) || selectedKind !== 'poll';
    get('ratingForm').hidden = Boolean(session) || selectedKind !== 'rating';
    get('interactionActivityTitle').textContent = session ? '本场互动' : '本场设置';
    get('interactionModeNote').textContent = selectedKind === 'rating' ? '手动公布均分' : '限时收票';
    get('interactionRatingRulesField').hidden = selectedKind !== 'rating';
    appearance.setKind(selectedKind);
  }
  tabs.forEach((tab) => tab.addEventListener('click', () => {
    selectedKind = tab.dataset.interactionKind;
    renderWorkspace();
  }));
  root.querySelector('.interaction-tabs').addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const available = tabs.filter((tab) => !tab.disabled);
    if (!available.length) return;
    event.preventDefault();
    const current = available.indexOf(document.activeElement);
    const direction = event.key === 'ArrowLeft' ? -1 : 1;
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? available.length - 1 : (current + direction + available.length) % available.length;
    available[index].focus();
    available[index].click();
  });
  get('interactionAppearanceToggle').addEventListener('click', () => {
    appearanceOpen = !appearanceOpen;
    renderWorkspace();
  });
  get('interactionAppearanceBack').addEventListener('click', () => {
    appearanceOpen = false;
    renderWorkspace();
    get('interactionAppearanceToggle').focus();
  });
  get('pollAddOption').addEventListener('click', () => addOption());
  get('pollDurationMinutes').addEventListener('input', validateOptions);
  get('pollDurationSeconds').addEventListener('input', validateOptions);
  root.querySelectorAll('[data-poll-seconds]').forEach((button) => button.addEventListener('click', () => {
    const seconds = Number(button.dataset.pollSeconds);
    get('pollDurationMinutes').value = Math.floor(seconds / 60);
    get('pollDurationSeconds').value = seconds % 60;
    validateOptions();
  }));
  async function mutate(path, input) {
    if (busy) return;
    busy = true;
    render();
    try {
      const result = await api(path, input);
      client.receive(result.data);
    } finally {
      busy = false;
      await client.load(true).catch(showError);
      render();
    }
  }
  for (const kind of ['poll', 'rating']) {
    get(`${kind}Form`).addEventListener('submit', (event) => {
      event.preventDefault();
      const input = { kind, title: get(`${kind}Title`).value };
      if (kind === 'poll') Object.assign(input, { options: inputs().map((item) => item.value), durationSeconds: durationSeconds() });
      try { validateInteractionConfig(input); } catch (error) { showError(error); return; }
      mutate('/api/interactions/session', input).catch(showError);
    });
  }
  get('interactionFinish').addEventListener('click', () => mutate('/api/interactions/session/finish', { sessionId: session?.sessionId }).catch(showError));
  get('interactionClear').addEventListener('click', () => mutate('/api/interactions/session/clear', { sessionId: session?.sessionId }).catch(showError));

  function render() {
    renderWorkspace();
    const collecting = session?.phase === 'collecting';
    onCollecting(collecting);
    for (const kind of ['poll', 'rating']) {
      get(`${kind}Fields`).disabled = Boolean(session) || busy;
      get(`${kind}Start`).disabled = Boolean(session) || busy || !host?.ready || Boolean(host?.blockedReason);
    }
    get('interactionHostStatus').textContent = session
      ? `${interactionStatus(session)} · 已收到 ${host?.session?.sessionId === session.sessionId ? host.participants : session.participants || 0} 人${session.receptionInterrupted ? ' · 接收曾中断，可能漏收' : ''}`
      : host?.blockedReason || '准备开始';
    get('interactionResults').hidden = !session;
    get('interactionSessionTitle').textContent = session?.title || '';
    get('interactionSessionTitle').hidden = !session?.title;
    get('interactionRatingPending').hidden = session?.kind !== 'rating' || session.phase === 'finished';
    get('interactionFinish').hidden = !session || session.phase === 'finished';
    get('interactionFinish').textContent = session?.kind === 'rating' ? '停止并公布平均分' : '提前结束投票';
    get('interactionFinish').disabled = busy;
    get('interactionClear').hidden = !session;
    get('interactionClear').textContent = session?.phase === 'finished' ? '关闭结果' : '取消本场';
    get('interactionClear').disabled = busy;
    get('interactionHostRows').hidden = session?.kind !== 'poll';
    get('interactionHostAverage').textContent = '';
    if (session?.kind === 'poll') renderPollRows(get('interactionHostRows'), session);
    if (session?.kind === 'rating' && session.phase === 'finished') get('interactionHostAverage').textContent = session.average === null ? '暂无有效评分' : `平均分 ${session.average.toFixed(2)} / 10`;
  }
  function visible() { return !document.hidden && !root.closest('[hidden]'); }
  function syncPolling() {
    clearTimeout(polling);
    polling = null;
    if (disposed || !visible()) return;
    client.load(true).catch(showError).finally(() => {
      if (!disposed && visible()) polling = setTimeout(syncPolling, 1000);
    });
  }
  const observer = new MutationObserver(syncPolling);
  for (let node = root; node; node = node.parentElement) observer.observe(node, { attributes: true, attributeFilter: ['hidden'] });
  document.addEventListener('visibilitychange', syncPolling);
  const update = (event) => client.receive(event.detail);
  window.addEventListener('app:interaction-update', update);
  const offConnected = eventBus.on('ws:connected', () => { client.reset(); client.load(true).catch(showError); });
  const offGame = () => { if (visible()) client.load(true).catch(showError); };
  window.addEventListener('app:game-update', offGame);
  client.load(true).catch(showError);
  syncPolling();
  window.addEventListener('app:shutdown', () => {
    disposed = true;
    clearTimeout(polling);
    observer.disconnect();
    client.dispose();
    offConnected?.();
    document.removeEventListener('visibilitychange', syncPolling);
    window.removeEventListener('app:interaction-update', update);
    window.removeEventListener('app:game-update', offGame);
  }, { once: true });
}
