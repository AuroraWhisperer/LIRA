import { copyText, localOverlayOrigin } from '../shared/utils.js';
import { observeServerOverlayUrl } from './server-overlay-url.js';

const STYLES = {
  bubble: '聊天气泡', signal: '深色面板', minimal: '蝴蝶结',
  ranked: '经典样式', transparent: '透明文字', identity: '头像横卡', outline: '简洁白卡',
  cream: '奶油气泡',
  glow: '流光气泡',
};

export function initDanmakuOverlaySettings(elements, toast) {
  let overlayUrl = '';
  let draft = { style: 'signal', fullscreenDurationSeconds: 6 };
  let revision = 0;
  let generation = 0;
  let dirty = false;
  let loaded = false;
  let loading = false;
  let saving = false;
  const bridge = window.liraLicense;
  const applyButton = document.getElementById('danmakuApplyOverlayBtn');
  const reloadButton = document.getElementById('danmakuReloadOverlayBtn');

  function render() {
    elements.overlayUrl.value = overlayUrl;
    elements.overlayUrl.placeholder = '登录 LIRA 后显示直播画面链接';
    elements.styleButtons.forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.danmakuStyle === draft.style));
      button.disabled = !loaded;
    });
    elements.styleChip.textContent = loaded
      ? `${dirty ? '待应用' : '已应用样式'} · ${STYLES[draft.style]}`
      : loading ? '正在读取样式' : '尚未读取样式';
    elements.fullscreenDurationField.hidden = !['outline', 'cream', 'glow'].includes(draft.style);
    elements.fullscreenDuration.value = String(draft.fullscreenDurationSeconds);
    elements.fullscreenDuration.disabled = !loaded;
    for (const button of [elements.copyOverlayUrlButton, elements.openOverlayButton]) {
      button.disabled = !overlayUrl;
    }
    elements.previewOverlayButton.disabled = false;
    applyButton.disabled = !loaded || !dirty || saving;
    applyButton.textContent = saving ? '正在应用…' : '应用到直播画面';
    reloadButton.disabled = !overlayUrl || loading || saving || dirty;
  }

  function settingsFrom(response) {
    if (!response?.ok) throw new Error(response?.error === 'NETWORK_UNAVAILABLE'
      ? '无法连接服务器，请稍后重试。' : '暂时无法读取弹幕姬设置，请稍后重试；仍有问题时联系管理员。');
    if (!Object.hasOwn(STYLES, response.style) ||
        !Number.isInteger(response.fullscreenDurationSeconds) ||
        response.fullscreenDurationSeconds < 2 || response.fullscreenDurationSeconds > 30 ||
        response.overlayUrl !== overlayUrl) throw new Error('服务器返回的弹幕姬配置无效。');
    return { style: response.style, fullscreenDurationSeconds: response.fullscreenDurationSeconds };
  }

  async function reload() {
    if (!overlayUrl || loading || saving || dirty) return;
    const requestedGeneration = generation;
    const requestedRevision = revision;
    loading = true;
    elements.styleSaveState.textContent = '正在读取样式…';
    render();
    try {
      const response = await bridge.getOverlaySettings();
      if (requestedGeneration !== generation) return;
      const settings = settingsFrom(response);
      if (requestedRevision === revision) {
        draft = settings;
        loaded = true;
        elements.styleSaveState.textContent = '先调整并预览，确认后应用到直播画面。';
      }
    } catch (error) {
      if (requestedGeneration === generation) elements.styleSaveState.textContent = error.message;
    } finally {
      if (requestedGeneration === generation) { loading = false; render(); }
    }
  }

  function edit(nextDraft) {
    draft = nextDraft;
    revision += 1;
    dirty = true;
    elements.styleSaveState.textContent = '有修改尚未应用，预览不会改变直播画面。';
    render();
  }

  elements.styleButtons.forEach((button) => button.addEventListener('click', () => {
    if (loaded && Object.hasOwn(STYLES, button.dataset.danmakuStyle)) {
      edit({ ...draft, style: button.dataset.danmakuStyle });
    }
  }));
  elements.fullscreenDuration.addEventListener('change', () => {
    if (!loaded) return;
    const duration = Number(elements.fullscreenDuration.value);
    if (!Number.isInteger(duration) || duration < 2 || duration > 30) {
      elements.styleSaveState.textContent = '停留时间请输入 2～30 秒的整数。';
      elements.fullscreenDuration.value = String(draft.fullscreenDurationSeconds);
      return;
    }
    edit({ ...draft, fullscreenDurationSeconds: duration });
  });
  applyButton.addEventListener('click', async () => {
    if (!loaded || !dirty || saving) return;
    const submittedRevision = revision;
    const submittedGeneration = generation;
    saving = true;
    render();
    try {
      const response = await bridge.updateOverlaySettings({ ...draft });
      if (submittedGeneration !== generation) return;
      const saved = settingsFrom(response);
      if (submittedRevision === revision) { draft = saved; dirty = false; }
      elements.styleSaveState.textContent = dirty
        ? '已应用刚才的修改，还有新的修改尚未应用。'
        : '已应用到直播画面，在线弹幕姬将自动更新。';
      toast('弹幕姬样式已应用到直播画面');
    } catch (error) {
      if (submittedGeneration === generation) elements.styleSaveState.textContent = `应用失败，草稿已保留：${error.message}`;
    } finally {
      if (submittedGeneration === generation) { saving = false; render(); }
    }
  });
  reloadButton.addEventListener('click', reload);
  elements.copyOverlayUrlButton.addEventListener('click', async () => {
    if (!overlayUrl) return;
    try { await copyText(overlayUrl); toast('弹幕姬直播画面链接已复制'); }
    catch (error) { toast(error.message || '复制链接失败'); }
  });
  elements.openOverlayButton.addEventListener('click', () => {
    if (overlayUrl) window.open(overlayUrl, '_blank', 'noopener');
  });
  elements.previewOverlayButton.addEventListener('click', () => {
    const url = new URL('/danmaku', localOverlayOrigin());
    url.search = new URLSearchParams({ preview: '1', ...draft }).toString();
    window.open(url.href, '_blank', 'noopener');
  });
  observeServerOverlayUrl((url) => {
    if (url === overlayUrl) return;
    generation += 1;
    overlayUrl = url;
    draft = { style: 'signal', fullscreenDurationSeconds: 6 };
    loaded = dirty = loading = saving = false;
    elements.styleSaveState.textContent = url ? '' : '请先连接已授权的 LIRA 账号。';
    render();
    void reload();
  });
  render();
}
