// 桌面歌词管理页预览适配器。
'use strict';

import { desktopLyricRenderer } from '../lyrics/desktop-lyric-renderer.js';
import { DESKTOP_LYRIC_DEFAULTS } from '../lyrics/desktop-lyric-defaults.js';
import { copyText, localOverlayOrigin, toast } from '../shared/utils.js';
import { stateService } from './state.js';
import { readDesktopLyricFormSettings, setDesktopLyricBackground, syncDesktopLyricKaraokeColorControls } from './desktop-lyric-controls.js';

let initialized = false;
let readSettings = () => readDesktopLyricFormSettings(DESKTOP_LYRIC_DEFAULTS);

function sampleTimeline() {
  const phrases = [
    { parts: ['把此刻', '唱成', '一首歌'], start: 0, duration: 6000 },
    { parts: ['晚风穿过窗边，', '带来你的消息', '照亮了漫长的黑夜'], start: 6500, duration: 8000 },
    { parts: ['让心跳', '跟着节拍', '奔向远方'], start: 15000, duration: 3000 },
  ];
  const lines = phrases.map(({ parts, start, duration }) => {
    const length = parts.join('').length;
    let cursor = start;
    const words = parts.map(text => {
      const word = { text, startMs: cursor, endMs: cursor + duration * text.length / length };
      cursor = word.endMs;
      return word;
    });
    return { text: parts.join(''), startMs: start, endMs: start + duration + 500, words };
  });
  lines.push({ text: 'We keep moving through the night, until the morning comes', startMs: 18500, endMs: 25000, words: [] },
    { text: '把此刻唱成一首歌', startMs: 25000, endMs: 31000, words: [
      { text: '把此刻', startMs: 25000, endMs: 25900 }, { text: '唱成', startMs: 26100, endMs: 29100 },
      { text: '一首歌', startMs: 29300, endMs: 30200 },
    ] });
  return { status: 'ready', trackTitle: '编排试播', lines };
}

function init(form, options = {}) {
  if (initialized) return;
  if (!desktopLyricRenderer.init()) return;
  initialized = true;
  if (options.readSettings) readSettings = options.readSettings;

  form?.addEventListener('input', applyStylesFromForm);
  form?.addEventListener('change', applyStylesFromForm);
  document.querySelectorAll('[data-lyric-preview-background]').forEach((button) => {
    button.addEventListener('click', () => setDesktopLyricBackground(button.dataset.lyricPreviewBackground));
  });
  document.getElementById('desktopLyricCopyUrlBtn')?.addEventListener('click', copyDesktopLyricUrl);
  const appState = stateService.getAppState();
  const events = new AbortController();
  const { signal } = events;
  let liveState = appState?.lyricState;
  let liveTimeline = appState?.lyricTimeline;
  let liveReceivedAt = performance.now();
  let sample = null;
  let sampleTimer = null;
  let previewVisible = true;
  const play = document.getElementById('desktopLyricSampleBtn');
  const current = document.getElementById('desktopLyricCurrentBtn');
  const timeline = sampleTimeline();
  const sampleEnd = timeline.lines.at(-1).endMs;
  const samplePosition = () => Math.min(sampleEnd, sample.position + (sample.running ? performance.now() - sample.at : 0));
  const updateSample = (position, running) => {
    clearTimeout(sampleTimer);
    sample = { position, running, at: performance.now() };
    const line = timeline.lines.findLast(line => line.startMs <= position);
    desktopLyricRenderer.updatePreviewState({ status: 'ready', trackTitle: '编排试播', lineText: line.text, words: line.words,
      currentMs: position, durationMs: sampleEnd, playing: running, playbackRate: 1, discontinuity: true });
    if (play) { play.textContent = running ? '暂停试播' : position >= sampleEnd ? '重播示例' : '继续试播'; play.setAttribute('aria-pressed', 'true'); }
    if (current) current.hidden = false;
    if (running) sampleTimer = setTimeout(() => updateSample(sampleEnd, false), sampleEnd - position);
  };
  let resumeSample = false;
  play?.addEventListener('click', () => {
    resumeSample = false;
    if (!sample || sample.position >= sampleEnd) {
      desktopLyricRenderer.updateLyricTimeline(timeline);
      updateSample(0, true);
    } else updateSample(samplePosition(), !sample.running);
  }, { signal });
  current?.addEventListener('click', () => {
    clearTimeout(sampleTimer);
    sample = null;
    resumeSample = false;
    desktopLyricRenderer.updateLyricTimeline(liveTimeline || { status: 'idle', lines: [] });
    const currentMs = Number(liveState?.currentMs) || 0;
    const elapsed = liveState?.playing ? (performance.now() - liveReceivedAt) * (liveState.playbackRate || 1) : 0;
    desktopLyricRenderer.updatePreviewState({ ...(liveState || { status: 'idle', trackTitle: '', lineText: '', words: [], playing: false }),
      currentMs: Math.min(liveState?.durationMs || Infinity, currentMs + elapsed), discontinuity: true });
    play.textContent = '示例试播'; play.setAttribute('aria-pressed', 'false'); current.hidden = true;
  }, { signal });
  const updateVisibility = () => {
    const visible = previewVisible && !document.hidden;
    if (!visible && sample?.running) { resumeSample = true; updateSample(samplePosition(), false); }
    else if (visible && sample && resumeSample) { resumeSample = false; updateSample(sample.position, true); }
  };
  const observer = new IntersectionObserver(([entry]) => { previewVisible = entry.isIntersecting; updateVisibility(); });
  observer.observe(document.getElementById('desktopLyricPreviewStage'));
  document.addEventListener('visibilitychange', updateVisibility, { signal });

  window.addEventListener('app:lyric-state', event => {
    if (desktopLyricRenderer.updateLyricState(event.detail, { render: !sample })) {
      liveState = event.detail;
      liveReceivedAt = performance.now();
    }
  }, { signal });
  window.addEventListener('app:lyric-timeline', event => {
    liveTimeline = event.detail;
    if (!sample) desktopLyricRenderer.updateLyricTimeline(event.detail);
  }, { signal });
  window.addEventListener('pagehide', () => {
    clearTimeout(sampleTimer);
    observer.disconnect();
    events.abort();
    desktopLyricRenderer.dispose();
  }, { once: true });
  if (appState?.lyricTimeline) desktopLyricRenderer.updateLyricTimeline(appState.lyricTimeline);
  if (appState?.lyricState) desktopLyricRenderer.updateLyricState(appState.lyricState);
  applyStylesFromForm();
}

function applyStylesFromForm() {
  const settings = readSettings();
  syncDesktopLyricKaraokeColorControls(settings);
  desktopLyricRenderer.applySettings(settings);
}

async function copyDesktopLyricUrl() {
  const desktopLyricUrl = `${localOverlayOrigin(location)}/lyrics`;
  try {
    await copyText(desktopLyricUrl);
    toast('直播歌词浏览器源地址已复制');
  } catch (error) {
    prompt('复制以下直播歌词浏览器源地址：', desktopLyricUrl);
  }
}

export const desktopLyricPreview = {
  ...desktopLyricRenderer,
  init,
};
