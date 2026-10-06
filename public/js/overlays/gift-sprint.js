import { renderGiftSprintText } from '../shared/gift-sprint-text.js';
import { createOverlaySocket } from './socket-client.js';
import { mountSceneExtraClient } from './scene-extra-client.js';

const preview = new URLSearchParams(location.search).get('preview') === '1';
const text = document.getElementById('giftSprintText');
const status = document.getElementById('giftSprintStatus');
document.body.classList.toggle('sprint-preview', preview);

function setStatus(message) {
  status.textContent = message;
  status.hidden = !preview || !message;
}

setStatus('正在读取月底冲刺进度…');
const socket = createOverlaySocket({
  onMessage(message) {
    if (message.type !== 'snapshot') return;
    renderGiftSprintText(text, message.state?.giftSprint);
    setStatus(text.hidden ? '请在「礼物 → 月底冲刺」设置冲刺目标。' : '');
  },
  onClose() {
    renderGiftSprintText(text, null);
    setStatus('连接已断开，正在重新连接…');
  },
});
const component = mountSceneExtraClient('gift-sprint', {
  onConfig() {},
  onData(data) { renderGiftSprintText(text, data); status.hidden = true; },
});
if (!component) socket.start();
window.addEventListener('pagehide', () => socket.dispose());
