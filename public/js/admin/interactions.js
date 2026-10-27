import { api, copyText, localOverlayOrigin, showError, toast } from '../shared/utils.js';
import { eventBus } from '../shared/event-bus.js';
import {
  inspectInteractionText,
  validateInteractionConfig,
  POLL_MIN_OPTIONS,
  POLL_MAX_OPTIONS,
  POLL_RULE,
  RATING_RULE,
} from '../shared/interaction-rules.js';
import { createInteractionClient } from '../shared/interaction-client.js';
import { renderPollRows, interactionStatus } from '../shared/interaction-view.js';
import { initInteractionAppearance } from './interaction-appearance.js';
import { showConfirmationDialog } from '../shared/confirmation-dialog.js';

let initialized = false;

export function initInteractions() {
  const root = document.getElementById('interactionsAdmin');
  if (initialized || !root) return;
  initialized = true;
  const get = (id) => document.getElementById(id);
  const page = get('liveComponentsPage');
  const panels = [get('livePollFeature'), get('liveRatingFeature')];
  let session = null;
  let host = null;
  let busy = false;
  let polling = null;
  let pollingRevision = 0;
  let disposed = false;
  let selectedKind = 'poll';
  let appearanceOpen = false;
  const client = createInteractionClient({
    onState(state) {
      session = state.session;
      render();
    },
    onHost(state) {
      host = state;
      render();
    },
    async fetchState(isHost) {
      const response = await fetch(`/api/interactions/${isHost ? 'host-state' : 'session'}`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || '读取互动失败');
      return payload.data;
    },
  });
  const url = `${localOverlayOrigin()}/interactions`;
  get('interactionsSourceUrl').textContent = url;
  get('interactionsUrl').addEventListener('click', () =>
    copyText(url).then(() => toast('互动浏览器源地址已复制')).catch(showError),
  );
  get('interactionsOpen').addEventListener('click', () => window.open(url, '_blank', 'noopener'));
  get('pollRule').textContent = POLL_RULE;
  get('ratingRule').textContent = RATING_RULE;

  function inputs() {
    return [...get('pollOptions').querySelectorAll('input')];
  }
  function durationSeconds() {
    return get('pollDurationMinutes').valueAsNumber * 60 + get('pollDurationSeconds').valueAsNumber;
  }
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
    get('pollAddOption').disabled = inputs().length >= POLL_MAX_OPTIONS;
    root.querySelectorAll('[data-poll-seconds]').forEach((button) => {
      button.setAttribute('aria-pressed', String(Number(button.dataset.pollSeconds) === durationSeconds()));
    });
    for (const [index, button] of [...get('pollOptions').querySelectorAll('button')].entries()) {
      button.disabled = Boolean(session) || busy || inputs().length <= POLL_MIN_OPTIONS;
      button.setAttribute('aria-label', `删除选项 ${index + 1}`);
    }
  }
  function addOption(value = '') {
    if (inputs().length >= POLL_MAX_OPTIONS) return;
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
    remove.addEventListener('click', () => {
      row.remove();
      validateOptions();
    });
    input.addEventListener('input', (event) => {
      if (!event.isComposing) validateOptions();
    });
    input.addEventListener('compositionend', validateOptions);
    row.append(input, hint, remove);
    get('pollOptions').append(row);
    validateOptions();
  }
  addOption('1');
  addOption('2');
  const appearance = initInteractionAppearance();
  function renderWorkspace() {
    const ownSession = session?.kind === selectedKind;
    get('interactionActivityView').hidden = appearanceOpen;
    get('interactionAppearanceView').hidden = !appearanceOpen;
    get('interactionAppearanceToggle').setAttribute('aria-expanded', String(appearanceOpen));
    get('pollForm').hidden = ownSession || selectedKind !== 'poll';
    get('ratingForm').hidden = ownSession || selectedKind !== 'rating';
    get('interactionActivityTitle').textContent = ownSession ? '本场结果' : '本场设置';
    get('interactionRatingRulesField').hidden = selectedKind !== 'rating';
    appearance.setKind(selectedKind);
  }
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
  root.querySelectorAll('[data-poll-seconds]').forEach((button) =>
    button.addEventListener('click', () => {
      const seconds = Number(button.dataset.pollSeconds);
      get('pollDurationMinutes').value = Math.floor(seconds / 60);
      get('pollDurationSeconds').value = seconds % 60;
      validateOptions();
    }),
  );
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
      if (kind === 'poll')
        Object.assign(input, { options: inputs().map((item) => item.value), durationSeconds: durationSeconds() });
      try {
        validateInteractionConfig(input);
      } catch (error) {
        showError(error);
        return;
      }
      mutate('/api/interactions/session', input).catch(showError);
    });
  }
  get('interactionFinish').addEventListener('click', () =>
    mutate('/api/interactions/session/finish', { sessionId: session?.sessionId }).catch(showError),
  );
  get('interactionClear').addEventListener('click', async () => {
    if (!session || busy) return;
    const sessionId = session.sessionId;
    const participants = host?.session?.sessionId === sessionId ? host.participants : session.participants || 0;
    if (session.phase !== 'finished' && participants > 0) {
      const confirmed = await showConfirmationDialog({
        title: '取消本场互动？', description: `已收到 ${participants} 人参与，取消后本场${session.kind === 'poll' ? '票数' : '评分'}将被清除。`,
        confirmLabel: '取消本场', cancelLabel: '继续互动', variant: 'destructive',
      });
      if (!confirmed || session?.sessionId !== sessionId) return;
    }
    mutate('/api/interactions/session/clear', { sessionId }).catch(showError);
  });

  function render() {
    renderWorkspace();
    const ownSession = session?.kind === selectedKind;
    for (const kind of ['poll', 'rating']) {
      get(`${kind}Fields`).disabled = Boolean(session) || busy;
      get(`${kind}Start`).disabled = Boolean(session) || busy || !host?.ready || Boolean(host?.blockedReason);
    }
    get('interactionHostStatus').textContent = session && !ownSession
      ? `请先到「${session.kind === 'poll' ? '弹幕投票' : '观众评分'}」${session.phase === 'finished' ? '关闭结果' : '结束或取消本场'}，再开始${selectedKind === 'poll' ? '投票' : '评分'}。`
      : session
      ? `${interactionStatus(session)} · 已收到 ${host?.session?.sessionId === session.sessionId ? host.participants : session.participants || 0} 人${session.receptionInterrupted ? ' · 接收曾中断，可能漏收' : ''}`
      : host?.blockedReason || '准备开始';
    get('interactionResults').hidden = !ownSession;
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
    if (session?.kind === 'rating' && session.phase === 'finished')
      get('interactionHostAverage').textContent =
        session.average === null ? '暂无有效评分' : `平均分 ${session.average.toFixed(2)} / 10`;
  }
  function visible() {
    return !document.hidden && page.classList.contains('active') && !root.closest('[hidden]');
  }
  function syncPolling() {
    const revision = ++pollingRevision;
    clearTimeout(polling);
    polling = null;
    if (disposed || !visible()) return;
    client
      .load(true)
      .catch(showError)
      .finally(() => {
        if (!disposed && revision === pollingRevision && visible()) polling = setTimeout(syncPolling, 1000);
      });
  }
  function syncPanel() {
    const panel = panels.find((item) => !item.hidden);
    if (panel) {
      selectedKind = panel.dataset.interactionKind;
      // Keep one editor and subscription while each component retains its form draft.
      if (root.parentElement !== panel) {
        panel.append(root);
        appearanceOpen = false;
      }
      render();
    }
    syncPolling();
  }
  const observer = new MutationObserver(syncPanel);
  for (const panel of panels) observer.observe(panel, { attributes: true, attributeFilter: ['hidden'] });
  observer.observe(page, { attributes: true, attributeFilter: ['class'] });
  document.addEventListener('visibilitychange', syncPolling);
  const update = (event) => client.receive(event.detail);
  window.addEventListener('app:interaction-update', update);
  const offConnected = eventBus.on('ws:connected', () => {
    client.reset();
    syncPolling();
  });
  const offGame = () => {
    if (visible()) client.load(true).catch(showError);
  };
  window.addEventListener('app:game-update', offGame);
  syncPanel();
  window.addEventListener(
    'app:shutdown',
    () => {
      disposed = true;
      clearTimeout(polling);
      observer.disconnect();
      client.dispose();
      offConnected?.();
      document.removeEventListener('visibilitychange', syncPolling);
      window.removeEventListener('app:interaction-update', update);
      window.removeEventListener('app:game-update', offGame);
    },
    { once: true },
  );
}
