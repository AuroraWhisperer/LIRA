import { renderHeartBoxCollection } from '../shared/heart-box-collection.js';
import { createGiftWishFeed } from '../shared/gift-wish-client.js';
import { createOverlaySocket } from './socket-client.js';
import { mountSceneExtraClient } from './scene-extra-client.js';

const stage = document.getElementById('heartBoxCollectionStage');
const status = document.getElementById('heartBoxOverlayStatus');
const query = new URLSearchParams(location.search);
let displayStyle = query.get('displayStyle') === 'compact' ? 'compact' : 'task';
let backgroundStyle = query.get('backgroundStyle') || 'white';
let showRewards = !['false', '0'].includes(query.get('showRewards'));
let data;
let revision;
let observer;
function render() {
  renderHeartBoxCollection(stage, data, { displayStyle, backgroundStyle, showRewards });
}
const feed = createGiftWishFeed({
  path: '/api/gifts/heart-box-collection',
  onData(value) { data = value; revision = value.viewRevision; render(); status.hidden = true; },
  onError(error) {
    if (['GIFT_SOURCE_UNAVAILABLE', 'GIFT_VIEW_STALE'].includes(error.code)) { data = null; render(); }
    status.textContent = error.message;
    status.hidden = query.get('preview') !== '1';
  },
});
const socket = createOverlaySocket({
  onMessage(message) {
    if (message.type !== 'snapshot') return;
    if (!query.has('showRewards')) {
      showRewards = message.state?.settings?.heartBoxCollectionShowRewards !== 'false';
    }
    if (!query.has('backgroundStyle')) backgroundStyle = message.state?.settings?.heartBoxCollectionBackgroundStyle || 'white';
    render();
    if (message.state?.gifts?.viewRevision === revision) return;
    data = null;
    revision = message.state?.gifts?.viewRevision;
    render();
    feed.refresh();
  },
});
const component = mountSceneExtraClient('heart-box-collection', {
  onConfig(config) {
    displayStyle = config.displayStyle;
    backgroundStyle = config.backgroundStyle;
    showRewards = config.showRewards !== false;
    render();
  },
  onData(value) { data = value; render(); },
  onDispose() { observer?.disconnect(); },
});
if (component) {
  observer = new ResizeObserver(() => {
    if (!stage.hidden) component.resize({ width: Math.round(innerWidth), height: Math.ceil(stage.getBoundingClientRect().height) });
  });
  observer.observe(stage);
} else {
  feed.start();
  socket.start();
}
window.addEventListener('pagehide', () => { feed.stop(); socket.dispose(); observer?.disconnect(); });
