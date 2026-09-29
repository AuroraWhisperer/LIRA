import { localOverlayOrigin } from '../shared/utils.js';
import { normalizeLayout } from '../shared/danmaku-layout.js';
import { DANMAKU_STYLE_OPTIONS, normalizeStyleOptions } from '../shared/danmaku-style-options.js';

export function openDanmakuCanvas({ draft, canApply, fonts = [], onChange, onApply }) {
  const dialog = document.createElement('dialog');
  dialog.className = 'danmaku-canvas-dialog';
  dialog.setAttribute('aria-label', '弹幕画布编辑器');
  const frame = document.createElement('iframe');
  frame.title = '弹幕画布编辑器';
  // Keep the overlay opaque: it must never inherit the desktop parent's authority.
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.src = new URL('/danmaku?preview=1', localOverlayOrigin()).href;
  dialog.append(frame);
  document.body.append(dialog);
  let closed = false;
  const send = (type, data) => frame.contentWindow?.postMessage({ type, ...data }, '*');
  function close() {
    if (closed) return;
    closed = true;
    window.removeEventListener('message', receive);
    window.removeEventListener('pagehide', close);
    dialog.close();
    dialog.remove();
  }
  function receive(event) {
    if (event.source !== frame.contentWindow || event.origin !== 'null') return;
    const data = event.data;
    if (data?.type === 'danmaku-editor:ready') {
      send('danmaku-editor:init', { draft, canApply, fonts,
        message: Object.hasOwn(draft, 'layout') ? '登录并读取设置后可应用画布。' : '当前服务器尚不支持画布，请更新服务器后再应用。' });
      return;
    }
    if (data?.type === 'danmaku-editor:close') { close(); return; }
    if (!canApply || !['danmaku-editor:change', 'danmaku-editor:apply'].includes(data?.type)) return;
    const value = data.draft;
    if (!Object.hasOwn(DANMAKU_STYLE_OPTIONS, value?.style)
      || !Number.isInteger(value.fullscreenDurationSeconds) || value.fullscreenDurationSeconds < 2
      || value.fullscreenDurationSeconds > 30) return;
    try {
      const next = { style: value.style, fullscreenDurationSeconds: value.fullscreenDurationSeconds,
        styleOptions: normalizeStyleOptions(value.styleOptions), layout: normalizeLayout(value.layout) };
      draft = next;
      onChange(next);
      if (data.type === 'danmaku-editor:apply') void onApply();
    } catch { status(false, '草稿数值无效，请检查后重试。'); }
  }
  function status(saving, message) { send('danmaku-editor:status', { saving, message }); }
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); close(); });
  window.addEventListener('message', receive);
  window.addEventListener('pagehide', close, { once: true });
  dialog.showModal();
  return { close, status };
}
