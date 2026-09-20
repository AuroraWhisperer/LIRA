import { createOverlaySocket } from './socket-client.js';
import { startOverlayPages } from './auto-pages.js';
import { createInteractionClient } from '../shared/interaction-client.js';
import { renderPollRows, interactionStatus } from '../shared/interaction-view.js';

const byId = (id) => document.getElementById(id);
let session = null;
let stopPages = null;
let retry = null;
let disposed = false;
const client = createInteractionClient({
  onState: render,
  async fetchState() {
    const token = window.__API_TOKEN__;
    const response = await fetch('/api/interactions/session', { cache: 'no-store', headers: token ? { Authorization: `Bearer ${token}` } : {} });
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw new Error(payload.error || '读取失败');
    return payload.data;
  },
});
async function refresh() {
  clearTimeout(retry);
  try { await client.load(); } catch (_) {
    if (!disposed) retry = setTimeout(refresh, 1500);
  }
}
const socket = createOverlaySocket({
  onOpen() { client.reset(); refresh(); },
  onClose() { client.reset(); },
  onMessage(payload) { if (payload.type === 'interaction:update') client.receive(payload.state); },
});

function render(state) {
  const next = state.session;
  if (next?.sessionId !== session?.sessionId) {
    stopPages?.();
    stopPages = null;
    byId('interactionRows').replaceChildren();
    delete byId('interactionRows').dataset.sessionId;
    byId('interactionAverage').textContent = '';
  }
  session = next;
  byId('interactionStage').hidden = !session;
  if (!session) return;
  byId('interactionTitle').textContent = session.title;
  byId('interactionTitle').classList.toggle('is-long', Array.from(session.title).length > 35);
  byId('interactionRule').textContent = session.rule;
  byId('interactionStatus').textContent = interactionStatus(session);
  byId('interactionWarning').textContent = session.receptionInterrupted ? '接收曾中断，结果可能不完整' : '';
  byId('interactionRows').hidden = session.kind !== 'poll';
  byId('interactionScore').hidden = session.kind !== 'rating';
  byId('interactionScore').classList.toggle('is-revealed', session.phase === 'finished');
  if (session.kind === 'poll') {
    renderPollRows(byId('interactionRows'), session);
    if (!stopPages) stopPages = startOverlayPages(byId('interactionRows'));
    byId('interactionParticipants').textContent = session.phase === 'finished' && !session.participants ? '本场暂无有效投票' : `已参与 ${session.participants} 人`;
  } else {
    const finished = session.phase === 'finished';
    byId('interactionAverage').textContent = finished && session.average !== null ? session.average.toFixed(2) : '';
    byId('interactionScoreLabel').textContent = finished ? session.average === null ? '暂无有效评分' : '平均分 / 10' : '';
    byId('interactionParticipants').textContent = finished ? `有效评分 ${session.participants} 人` : '';
  }
}

const clock = setInterval(() => {
  if (session) byId('interactionStatus').textContent = interactionStatus(session);
}, 250);
refresh();
socket.start();
window.addEventListener('beforeunload', () => {
  disposed = true;
  stopPages?.();
  clearInterval(clock);
  clearTimeout(retry);
  client.dispose();
  socket.dispose();
}, { once: true });
