import { api, copyText, localOverlayOrigin, toast } from '../shared/utils.js';
import { readApiResponse } from '../shared/json-response.js';
import { NOW_PLAYING_DEFAULTS } from '../shared/now-playing-appearance.js';
import { parseHexColor } from '../shared/color-value.js';
import { createNowPlayingRenderer } from '../shared/now-playing-renderer.js';
import { stateService } from './state.js';
import { observeAuthorizedAccount } from './authorized-account.js';
import { createComponentConfigController, componentSaveMessage } from './component-config-controller.js';
import { createSceneExtraPreview } from './scene-extra-preview.js';
import { addStyleToCanvas } from './component-style-client.js';
import { saveComponentWithFeedback } from './component-save-feedback.js';
import { readComponentOutputSize } from './scene-api.js';

const SOURCE_LABELS = { internal: '内置播放器', 'qq-client': 'QQ 音乐', 'netease-client': '网易云音乐', wesing: '全民 K 歌' };
const SAMPLE = { source: 'internal', trackTitle: '把此刻唱成一首歌', artists: ['示例歌手'], coverUrl: '', playing: true };
let initialized = false;

export function initNowPlaying() {
  const root = document.getElementById('nowPlayingPage');
  if (!root || initialized) return;
  initialized = true;
  const requests = new AbortController();
  const signal = requests.signal;
  const elements = Object.fromEntries(['Parameters', 'Preview', 'PreviewMode', 'PreviewEmpty', 'PreviewStatus',
    'SourceStatus', 'SourceSettings', 'OpenCanvas', 'CopyUrl', 'Save', 'Reload', 'Discard', 'SaveState']
    .map(name => [name, document.getElementById(`nowPlaying${name}`)]));
  let account = '';
  let canvasEditor;
  let current = stateService.getAppState()?.nowPlaying || null;
  let source = stateService.getAppState()?.lyricSource?.source || current?.source;
  const renderer = createNowPlayingRenderer(elements.Preview);
  const controller = createComponentConfigController({
    initial: NOW_PLAYING_DEFAULTS,
    read: async () => {
      const response = await fetch('/api/now-playing/config', { cache: 'no-store', signal });
      const payload = await readApiResponse(response, '歌曲信息外观读取失败，请重试。');
      return payload.data;
    },
    persist: async config => {
      const { data } = await api('/api/now-playing/config', config, { notifyError: false, signal });
      return data;
    },
  });
  const component = createSceneExtraPreview('now-playing', { controller, embedded: true, hideStyleControl: true });
  const panel = component.createPanel(elements.Parameters, controller);
  const styleButtons = [...root.querySelectorAll('[data-now-playing-style]')];
  const thumbnails = styleButtons.map(button => {
    const thumbnail = createNowPlayingRenderer(button.querySelector('.now-playing-style-art'));
    thumbnail.updateConfig({ ...NOW_PLAYING_DEFAULTS, style: button.dataset.nowPlayingStyle,
      nowPlayingRecordSize: 80, nowPlayingShowTitle: false, nowPlayingShowArtist: false, nowPlayingRotation: false });
    thumbnail.updateState(SAMPLE);
    button.addEventListener('click', () => controller.edit({ style: button.dataset.nowPlayingStyle }), { signal });
    return thumbnail;
  });

  function renderPreview() {
    const sample = elements.PreviewMode.value === 'sample';
    const track = sample ? SAMPLE : current;
    const config = controller.getState().draft;
    const previewColor = parseHexColor(config.nowPlayingShowTitle ? config.nowPlayingTitleColor : config.nowPlayingArtistColor);
    const channels = previewColor ? [previewColor.r, previewColor.g, previewColor.b].map(value => {
      const channel = value / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    }) : [0, 0, 0];
    elements.Preview.parentElement.classList.toggle('is-light-text',
      channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722 > 0.179);
    const hidden = (!track?.trackTitle && config.nowPlayingHideWhenEmpty)
      || (track?.trackTitle && !track.playing && config.nowPlayingHideOnPause)
      || (!config.nowPlayingShowRecord && !config.nowPlayingShowTitle && !config.nowPlayingShowArtist);
    renderer.updateConfig(config);
    renderer.updateState(track);
    elements.PreviewEmpty.hidden = !hidden;
    elements.PreviewEmpty.textContent = !track?.trackTitle
      ? '等待播放，也可以切换到示例歌曲调试样式。'
      : !track.playing && config.nowPlayingHideOnPause ? '歌曲已暂停，组件按设置隐藏。' : '显示内容均已关闭。';
    elements.PreviewStatus.textContent = sample ? '示例歌曲，仅用于调试样式。'
      : !track?.trackTitle ? '尚未捕捉到歌曲。' : track.playing ? '正在播放 · 已跟随当前歌曲' : '歌曲已暂停';
    elements.SourceStatus.textContent = `当前跟随：${SOURCE_LABELS[source] || '正在检测'}`;
  }

  const stopController = controller.subscribe(state => {
    elements.Parameters.disabled = !state.loaded || state.saving;
    for (const button of styleButtons) {
      button.disabled = !state.loaded || state.saving;
      button.setAttribute('aria-pressed', String(button.dataset.nowPlayingStyle === state.draft.style));
    }
    elements.Save.disabled = !state.loaded || !state.dirty || state.saving;
    elements.Save.textContent = state.saving ? '正在保存…' : '保存外观';
    elements.Reload.disabled = !account || state.loading || state.saving;
    elements.Discard.disabled = !state.dirty || state.saving;
    elements.OpenCanvas.disabled = !state.loaded || state.saving;
    elements.CopyUrl.disabled = !state.loaded || state.saving;
    elements.SaveState.textContent = account ? componentSaveMessage(state) : '请先连接已授权的 LIRA 账号。';
    renderPreview();
  });
  elements.PreviewMode.addEventListener('change', renderPreview, { signal });
  elements.SourceSettings.addEventListener('click', () => {
    document.getElementById('desktopLyricFeatureTab')?.click();
    const sourceControls = document.getElementById('desktopLyricSourceControls');
    const sourceSection = sourceControls?.closest('details');
    if (sourceSection) sourceSection.open = true;
    sourceControls?.scrollIntoView({ block: 'start' });
  }, { signal });
  elements.Save.addEventListener('click', () => saveComponentWithFeedback(controller, '歌曲信息外观'), { signal });
  elements.Reload.addEventListener('click', () => { void controller.reload(); }, { signal });
  elements.Discard.addEventListener('click', () => controller.discard(), { signal });
  async function saveDraft() {
    if (!controller.getState().dirty || await controller.save()) return true;
    toast(controller.getState().error || '外观保存失败，请重试。');
    return false;
  }
  elements.OpenCanvas.addEventListener('click', async () => {
    if (!await saveDraft()) return;
    elements.OpenCanvas.disabled = true;
    try {
      canvasEditor = await addStyleToCanvas({ type: 'now-playing', name: '歌曲信息', config: controller.getState().saved });
    } catch (error) { toast(error.message || '无法添加到画布，请重试。'); }
    finally { elements.OpenCanvas.disabled = !controller.getState().loaded; }
  }, { signal });
  elements.CopyUrl.addEventListener('click', async () => {
    if (!await saveDraft()) return;
    try {
      const size = await readComponentOutputSize('now-playing', signal).catch(() => null);
      await copyText(`${localOverlayOrigin(location)}/now-playing`);
      toast(size ? `歌曲信息浏览器源地址已复制；尺寸设为 ${size.width} × ${size.height}` : '歌曲信息浏览器源地址已复制');
    } catch (error) { toast(error.message || '复制失败，请重试。'); }
  }, { signal });
  window.addEventListener('app:now-playing', event => {
    current = event.detail;
    source = current?.source || source;
    renderPreview();
  }, { signal });
  window.addEventListener('app:lyric-source', event => {
    source = event.detail?.source;
    renderPreview();
  }, { signal });
  window.addEventListener('app:now-playing-config', event => {
    if (account && controller.getState().loaded && event.detail) controller.receive(event.detail);
  }, { signal });
  const stopAccount = observeAuthorizedAccount(next => {
    if (next === account) return;
    account = next;
    canvasEditor?.close();
    canvasEditor = null;
    controller.reset();
    if (account) void controller.reload();
  });
  window.addEventListener('pagehide', () => {
    requests.abort();
    stopAccount();
    stopController();
    panel.dispose();
    renderer.dispose();
    thumbnails.forEach(thumbnail => thumbnail.dispose());
    canvasEditor?.close();
  }, { once: true });
  return controller;
}
