import { createOverlaySocket } from './socket-client.js';
import { startOverlayPages } from './auto-pages.js';
import { createInteractionClient } from '../shared/interaction-client.js';
import { renderPollRows, interactionStatus } from '../shared/interaction-view.js';
import { readInteractionAppearance, applyInteractionAppearance } from '../shared/interaction-appearance.js';

const byId = (id) => document.getElementById(id);
let session = null;
let stopPages = null;
let retry = null;
let disposed = false;
let appearance = readInteractionAppearance();
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
  onMessage(payload) {
    if (payload.type === 'interaction:update') client.receive(payload.state);
    if (payload.type === 'snapshot' && payload.state?.settings) {
      appearance = applyInteractionAppearance(byId('interactionStage'), payload.state.settings);
      if (session) render({ session });
    }
  },
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
  byId('interactionStage').dataset.kind = session.kind;
  const title = appearance.interactionOverlayTitle;
  byId('interactionTitle').textContent = title;
  byId('interactionTitle').hidden = !title;
  byId('interactionTitle').classList.toggle('is-long', Array.from(title).length > 35);
  byId('interactionHint').textContent = appearance.interactionOverlayHint;
  byId('interactionStatus').textContent = interactionStatus(session);
  byId('interactionStatus').hidden = appearance.interactionShowStatus !== 'true';
  byId('interactionTitle').parentElement.hidden = !title && byId('interactionStatus').hidden;
  byId('interactionWarning').textContent = session.receptionInterrupted ? '接收曾中断，结果可能不完整' : '';
  byId('interactionRows').hidden = session.kind !== 'poll';
  byId('interactionRatingRules').hidden = session.kind !== 'rating';
  byId('interactionRatingRules').textContent = appearance.interactionRatingRules;
  byId('interactionScore').hidden = session.kind !== 'rating';
  byId('interactionScore').classList.toggle('is-revealed', session.phase === 'finished');
  if (session.kind === 'poll') {
    renderPollRows(byId('interactionRows'), session);
    if (!stopPages) stopPages = startOverlayPages(byId('interactionRows'));
    byId('interactionParticipants').textContent = session.phase === 'finished' && !session.participants ? '暂无有效投票' : `${session.participants} 人参与`;
  } else {
    const finished = session.phase === 'finished';
    byId('interactionAverage').textContent = finished && session.average !== null ? session.average.toFixed(2) : '—';
    byId('interactionScoreLabel').textContent = finished && session.average === null ? '暂无评分' : '最终均分';
    byId('interactionScoreScale').hidden = finished && session.average === null;
    byId('interactionParticipants').textContent = finished && session.participants ? `${session.participants} 人评分` : '';
  }
  byId('interactionParticipants').hidden = appearance.interactionShowParticipants !== 'true' || !byId('interactionParticipants').textContent;
  byId('interactionParticipants').parentElement.hidden = byId('interactionParticipants').hidden && !byId('interactionWarning').textContent;
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
