import { api, copyText, localOverlayOrigin, showError } from '../shared/utils.js';
import { eventBus } from '../shared/event-bus.js';
import { inspectInteractionText, validateInteractionConfig, pollPageDuration, POLL_RULE, RATING_RULE } from '../shared/interaction-rules.js';
import { createInteractionClient } from '../shared/interaction-client.js';
import { renderPollRows, interactionStatus } from '../shared/interaction-view.js';

export function initInteractions({ onCollecting = () => {} } = {}) {
  const root = document.getElementById('interactionsAdmin');
  if (!root) return;
  const get = (id) => document.getElementById(id);
  let session = null;
  let host = null;
  let busy = false;
  let polling = null;
  let disposed = false;
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
  get('pollRule').textContent = POLL_RULE;
  get('ratingRule').textContent = RATING_RULE;

  function inputs() { return [...get('pollOptions').querySelectorAll('input')]; }
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
      ? `推荐尺寸下约 ${pages} 屏，每 8 秒翻页，一轮至少 ${seconds} 秒。${Number(get('pollDuration').value) < seconds ? '当前时长较短，后面的选项可能来不及完整展示。' : ''}`
      : '推荐尺寸下单屏展示。';
    for (const button of get('pollOptions').querySelectorAll('button')) button.disabled = Boolean(session) || busy || inputs().length <= 2;
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
    remove.className = 'secondary';
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
  get('pollAddOption').addEventListener('click', () => addOption());
  get('pollDuration').addEventListener('input', validateOptions);
  root.querySelectorAll('[data-poll-seconds]').forEach((button) => button.addEventListener('click', () => {
    get('pollDuration').value = button.dataset.pollSeconds;
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
      if (kind === 'poll') Object.assign(input, { options: inputs().map((item) => item.value), durationSeconds: Number(get('pollDuration').value) });
      try { validateInteractionConfig(input); } catch (error) { showError(error); return; }
      mutate('/api/interactions/session', input).catch(showError);
    });
  }
  get('interactionFinish').addEventListener('click', () => mutate('/api/interactions/session/finish', { sessionId: session?.sessionId }).catch(showError));
  get('interactionClear').addEventListener('click', () => mutate('/api/interactions/session/clear', { sessionId: session?.sessionId }).catch(showError));

  function render() {
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
