import { copyText } from '../shared/utils.js';
import { observeServerOverlayUrl } from './server-overlay-url.js';

const STYLES = {
  bubble: '聊天气泡', signal: '直播信号带', minimal: '蝴蝶结',
  ranked: '直播气泡', transparent: '透明简约', identity: '身份横卡', outline: '全屏随机',
  cream: '奶油气泡',
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
    elements.overlayUrl.placeholder = '连接已授权账号后显示服务器地址';
    elements.styleButtons.forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.danmakuStyle === draft.style));
      button.disabled = !loaded;
    });
    elements.styleChip.textContent = loaded
      ? `${dirty ? '待应用' : '服务器样式'} · ${STYLES[draft.style]}`
      : loading ? '正在读取服务器配置' : '服务器配置未读取';
    elements.fullscreenDurationField.hidden = !['outline', 'cream'].includes(draft.style);
    elements.fullscreenDuration.value = String(draft.fullscreenDurationSeconds);
    elements.fullscreenDuration.disabled = !loaded;
    for (const button of [elements.copyOverlayUrlButton, elements.openOverlayButton]) {
      button.disabled = !overlayUrl;
    }
    elements.previewOverlayButton.disabled = !overlayUrl || !loaded;
    applyButton.disabled = !loaded || !dirty || saving;
    applyButton.textContent = saving ? '正在应用…' : '应用到服务器';
    reloadButton.disabled = !overlayUrl || loading || saving || dirty;
  }

  function settingsFrom(response) {
    if (!response?.ok) throw new Error(response?.error === 'NETWORK_UNAVAILABLE'
      ? '无法连接服务器，请稍后重试。' : '服务器弹幕姬设置暂不可用，请确认服务器已更新后重试。');
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
    elements.styleSaveState.textContent = '正在读取服务器配置…';
    render();
    try {
      const response = await bridge.getOverlaySettings();
      if (requestedGeneration !== generation) return;
      const settings = settingsFrom(response);
      if (requestedRevision === revision) {
        draft = settings;
        loaded = true;
        elements.styleSaveState.textContent = '先调整并预览，确认后应用到服务器。';
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
    elements.styleSaveState.textContent = '有未应用的参数；预览不会改变直播画面。';
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
        ? '本次参数已应用，仍有新修改尚未应用。'
        : '已应用到服务器，在线弹幕姬将自动更新。';
      toast('弹幕姬参数已应用到服务器');
    } catch (error) {
      if (submittedGeneration === generation) elements.styleSaveState.textContent = `应用失败，草稿已保留：${error.message}`;
    } finally {
      if (submittedGeneration === generation) { saving = false; render(); }
    }
  });
  reloadButton.addEventListener('click', reload);
  elements.copyOverlayUrlButton.addEventListener('click', async () => {
    if (!overlayUrl) return;
    try { await copyText(overlayUrl); toast('服务器弹幕姬链接已复制'); }
    catch (error) { toast(error.message || '复制链接失败'); }
  });
  elements.openOverlayButton.addEventListener('click', () => {
    if (overlayUrl) window.open(overlayUrl, '_blank', 'noopener');
  });
  elements.previewOverlayButton.addEventListener('click', () => {
    if (!overlayUrl || !loaded) return;
    const url = new URL(overlayUrl);
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
