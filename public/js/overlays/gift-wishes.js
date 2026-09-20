import { createGiftWishCard, WISH_PERIODS } from '../shared/gift-wish-card.js';
import { createGiftWishFeed } from '../shared/gift-wish-client.js';
import { createOverlaySocket } from './socket-client.js';

const query = new URLSearchParams(location.search);
const period = Object.hasOwn(WISH_PERIODS, query.get('period'))
  ? query.get('period')
  : 'long';
const preview = query.get('preview') === '1';
const stage = document.getElementById('giftWishStage');
const status = document.getElementById('giftWishOverlayStatus');
document.body.classList.toggle('wish-preview', preview);
document.title = `${WISH_PERIODS[period]} · LIRA`;
let revision = null;
let signature = '';
const feed = createGiftWishFeed({
  onData(data) {
    revision = data.viewRevision;
    const items = data.items.filter((wish) => wish.period === period);
    const next = JSON.stringify(items);
    if (signature !== next) {
      stage.replaceChildren(...items.map((wish) => createGiftWishCard(wish)));
      signature = next;
    }
    const messages = [];
    if (!items.length)
      messages.push(`还没有${WISH_PERIODS[period]}，请在礼物姬中添加。`);
    if (data.partial) messages.push('正在同步已捕获的礼物，进度可能尚未完整。');
    if (period === 'session' && data.session.stale)
      messages.push('开播状态暂未确认，已暂停本场计数。');
    if (period === 'session' && data.session.state === 'offline')
      messages.push('还未开播，等待本场心愿开始。');
    status.textContent = messages.join(' ');
    status.hidden = !preview || !messages.length;
  },
  onError(error) {
    if (['GIFT_SOURCE_UNAVAILABLE', 'GIFT_VIEW_STALE'].includes(error.code))
      clear();
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
feed.start();
socket.start();
window.addEventListener('pagehide', () => {
  feed.stop();
  socket.dispose();
});
