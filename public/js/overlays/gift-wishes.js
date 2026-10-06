import { renderGiftWishCards, WISH_PERIODS } from '../shared/gift-wish-card.js';
import { createGiftWishFeed } from '../shared/gift-wish-client.js';
import { createOverlaySocket } from './socket-client.js';
import { mountSceneExtraClient } from './scene-extra-client.js';

const query = new URLSearchParams(location.search);
const period = Object.hasOwn(WISH_PERIODS, query.get('period')) ? query.get('period') : null;
const periodName = WISH_PERIODS[period] || '礼物许愿';
const preview = query.get('preview') === '1';
const stage = document.getElementById('giftWishStage');
const status = document.getElementById('giftWishOverlayStatus');
document.body.classList.toggle('wish-preview', preview);
document.title = `${periodName} · LIRA`;
let revision = null;
let signature = '';
const feed = createGiftWishFeed({
  onData(data) {
    revision = data.viewRevision;
    const items = period ? data.items.filter((wish) => wish.period === period) : data.items;
    const next = JSON.stringify(items);
    if (signature !== next) {
      renderGiftWishCards(stage, items);
      signature = next;
    }
    const messages = [];
    if (!items.length) messages.push(`还没有${periodName}，请在礼物姬中添加。`);
    if (data.partial) messages.push('正在同步已捕获的礼物，进度可能尚未完整。');
    const showSessionStatus = period === 'session' || items.some((wish) => wish.period === 'session');
    if (showSessionStatus && data.session.stale) messages.push('开播状态暂未确认，已暂停本场计数。');
    if (showSessionStatus && data.session.state === 'offline') messages.push('还未开播，等待本场心愿开始。');
    status.textContent = messages.join(' ');
    status.hidden = !preview || !messages.length;
  },
  onError(error) {
    if (['GIFT_SOURCE_UNAVAILABLE', 'GIFT_VIEW_STALE'].includes(error.code)) clear();
    status.textContent = error.message;
    status.hidden = !preview;
  },
});
function clear() {
  stage.replaceChildren();
  signature = '';
  revision = null;
}
const socket = createOverlaySocket({
  onMessage(message) {
    if (message.type !== 'snapshot') return;
    if (message.state?.gifts?.viewRevision !== revision) {
      clear();
      revision = message.state?.gifts?.viewRevision;
      feed.refresh();
    } else if (message.reason === 'gift:wishes') feed.refresh();
  },
});
let componentConfig;
let componentData;
function renderComponent() {
  if (!componentConfig) return;
  const items = (componentData?.items || []).filter((wish) =>
    (componentConfig.period === 'all' || wish.period === componentConfig.period)
    && (componentConfig.showCompleted || !wish.completed)).slice(0, componentConfig.limit);
  const next = JSON.stringify([items, componentConfig]);
  if (signature === next) return;
  signature = next;
  stage.style.gap = `${componentConfig.gap}px`;
  renderGiftWishCards(stage, items.map((wish) => ({ ...wish,
    ...(componentConfig.displayStyle !== 'original' ? { displayStyle: componentConfig.displayStyle } : {}),
    textPendingColor: componentConfig.textPendingColor, textReceivedColor: componentConfig.textReceivedColor,
  })));
  status.hidden = true;
}
const component = mountSceneExtraClient('gift-wishes', {
  onConfig(config) { componentConfig = config; renderComponent(); },
  onData(data) { componentData = data; renderComponent(); },
});
if (!component) { feed.start(); socket.start(); }
window.addEventListener('pagehide', () => {
  feed.stop();
  socket.dispose();
});
