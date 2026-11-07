// 桌面歌词管理页预览适配器。
'use strict';

import { desktopLyricRenderer } from '../lyrics/desktop-lyric-renderer.js';
import { DESKTOP_LYRIC_DEFAULTS } from '../lyrics/desktop-lyric-defaults.js';
import { copyText, localOverlayOrigin, toast } from '../shared/utils.js';
import { stateService } from './state.js';
import { readDesktopLyricFormSettings, setDesktopLyricBackground, syncDesktopLyricKaraokeColorControls } from './desktop-lyric-controls.js';
import { sceneExtraPreviewData } from './scene-extra-preview-data.js';

let initialized = false;
let readSettings = () => readDesktopLyricFormSettings(DESKTOP_LYRIC_DEFAULTS);

function createSampleTimeline() {
  const source = sceneExtraPreviewData('lyrics').lyricTimeline;
  const lines = [...source.lines, { text: '让每一句都有自己的颜色' }, { text: '今晚的旋律为你停留' }].map((line, index) => {
    const startMs = index * 4500;
    const glyphs = Array.from(line.text);
    return { ...line, startMs, endMs: startMs + 4500,
      words: glyphs.map((text, word) => ({ text, startMs: startMs + word * 4000 / glyphs.length,
        endMs: startMs + (word + 1) * 4000 / glyphs.length })) };
  });
  return { ...source, status: 'ready', durationMs: lines.length * 4500, lines };
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
  document.getElementById('desktopLyricCopyLayerUrlBtn')?.addEventListener('click', () => {
    const layer = document.getElementById('desktopLyricOutputLayer')?.value === 'advanced' ? 'advanced' : 'basic';
    void copyDesktopLyricUrl(layer);
  });
  const appState = stateService.getAppState();
  let liveTimeline = appState?.lyricTimeline;
  let liveState = appState?.lyricState;
  let liveReceivedAt = performance.now();
  let sample = null;
  let sampleActive = false;
  let samplePlaying = false;
  let sampleSuspended = false;
  let samplePosition = 0;
  let sampleStartedAt = 0;
  let sampleTimer;
  let stageVisible = true;
  const sampleButton = document.getElementById('desktopLyricPreviewSample');
  const liveButton = document.getElementById('desktopLyricPreviewLive');
  const sourceStatus = document.getElementById('desktopLyricPreviewSourceStatus');
  const events = new AbortController();
  const { signal } = events;

  function sampleState(playing) {
    desktopLyricRenderer.updatePreviewState({ currentMs: samplePosition, playing, playbackRate: 1, discontinuity: true });
  }

  function pauseSample() {
    if (!samplePlaying) return;
    samplePosition = Math.min(sample.durationMs, samplePosition + performance.now() - sampleStartedAt);
    samplePlaying = false;
    clearTimeout(sampleTimer);
    sampleState(false);
  }

  function playSample() {
    samplePlaying = true;
    sampleStartedAt = performance.now();
    sampleState(true);
    clearTimeout(sampleTimer);
    sampleTimer = setTimeout(() => {
      pauseSample();
      if (sourceStatus) sourceStatus.textContent = '示例播放结束；点击“示例试播”可重新播放。';
    }, sample.durationMs - samplePosition);
  }

  function syncSampleVisibility() {
    const visible = stageVisible && !document.hidden;
    if (!sampleActive) return;
    if (!visible && samplePlaying) { sampleSuspended = true; pauseSample(); }
    else if (visible && sampleSuspended) { sampleSuspended = false; playSample(); }
  }

  function setSourceControls() {
    sampleButton?.setAttribute('aria-pressed', String(sampleActive));
    liveButton?.setAttribute('aria-pressed', String(!sampleActive));
    if (sourceStatus) sourceStatus.hidden = !sampleActive;
  }

  sampleButton?.addEventListener('click', () => {
    sample ||= createSampleTimeline();
    sampleActive = true;
    sampleSuspended = false;
    samplePosition = 0;
    if (sourceStatus) sourceStatus.textContent = '示例仅用于预览；点击“示例试播”可重新播放。';
    setSourceControls();
    desktopLyricRenderer.updateLyricTimeline(sample);
    desktopLyricRenderer.updatePreviewState({ trackTitle: sample.trackTitle, lineText: sample.lines[0].text,
      words: sample.lines[0].words, durationMs: sample.durationMs, currentMs: 0, playing: true,
      status: 'ready', discontinuity: true });
    playSample();
    syncSampleVisibility();
  }, { signal });

  liveButton?.addEventListener('click', () => {
    pauseSample();
    sampleActive = false;
    sampleSuspended = false;
    setSourceControls();
    desktopLyricRenderer.updateLyricTimeline(liveTimeline || { status: 'idle', lines: [] });
    const elapsed = liveState?.playing ? (performance.now() - liveReceivedAt) * (liveState.playbackRate || 1) : 0;
    desktopLyricRenderer.updatePreviewState({ trackTitle: '', lineText: '', words: [], status: 'idle', playing: false, durationMs: 0,
      ...liveState, currentMs: (liveState?.currentMs || 0) + elapsed,
      discontinuity: true });
  }, { signal });

  window.addEventListener('app:lyric-state', event => {
    if (!desktopLyricRenderer.updateLyricState(event.detail, { render: !sampleActive })) return;
    liveState = { ...liveState, ...event.detail };
    liveReceivedAt = performance.now();
  }, { signal });
  window.addEventListener('app:lyric-timeline', event => {
    liveTimeline = event.detail;
    if (!sampleActive) desktopLyricRenderer.updateLyricTimeline(event.detail);
  }, { signal });
  document.addEventListener('visibilitychange', syncSampleVisibility, { signal });
  const observer = new IntersectionObserver(([entry]) => {
    stageVisible = entry.isIntersecting;
    syncSampleVisibility();
  });
  observer.observe(document.getElementById('desktopLyricPreviewStage'));
  window.addEventListener('pagehide', () => {
    clearTimeout(sampleTimer);
    observer.disconnect();
    events.abort();
    desktopLyricRenderer.dispose();
  }, { once: true });
  if (liveTimeline) desktopLyricRenderer.updateLyricTimeline(liveTimeline);
  if (liveState) desktopLyricRenderer.updateLyricState(liveState);
  applyStylesFromForm();
}

function applyStylesFromForm() {
  const settings = readSettings();
  syncDesktopLyricKaraokeColorControls(settings);
  desktopLyricRenderer.applySettings(settings);
}

async function copyDesktopLyricUrl(layer) {
  const suffix = layer === 'basic' || layer === 'advanced' ? `?layer=${layer}` : '';
  const desktopLyricUrl = `${localOverlayOrigin(location)}/lyrics${suffix}`;
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
