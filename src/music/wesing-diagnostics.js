'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const DURATION_MS = 20000;
const SAMPLE_INTERVAL_MS = 250;
const MAX_SAMPLES = 80;

function playbackSnapshot(state) {
  return {
    trackTitle: String(state.trackTitle || '').slice(0, 120),
    cacheReady: state.cacheReady === true,
    lyricsReady: state.qrcReady === true,
    lyricSource: ['wesing', 'qq', 'netease'].includes(state.lyricSource) ? state.lyricSource : '',
    lyricLineCount: number(state.lyricLineCount, 0),
    firstLineStartMs: number(state.firstLineStartMs),
    hasCurrentLine: state.hasCurrentLine === true,
    currentMs: number(state.currentMs, 0),
    durationMs: number(state.durationMs, 0),
    playing: state.playing === true,
  };
}

function number(value, fallback = null) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function summarize(samples, final, reason) {
  const max = (key) => Math.max(0, ...samples.map((sample) => sample[key] ?? 0));
  const titles = new Set(samples.map((sample) => sample.playback.trackTitle).filter(Boolean));
  const first = samples[0];
  const last = samples.at(-1);
  const positions = samples.map((sample) => sample.currentSec).filter((value) => value !== null && value >= 0);
  const progressAdvanced = positions.length > 1 && positions.at(-1) - positions[0] >= 1;
  const clockAdvanced = Boolean(first && last && last.playback.currentMs - first.playback.currentMs >= 1000);
  const clientDetected = samples.some((sample) => sample.detected);
  let result = 'ready';
  if (reason !== 'completed') result = 'interrupted';
  else if (!samples.length) result = 'no-samples';
  else if (samples.every((sample) => sample.error)) result = 'monitor-error';
  else if (!clientDetected) result = 'client-missing';
  else if (!final.trackTitle) result = 'track-missing';
  else if (titles.size > 1) result = 'track-changed';
  else if (!final.lyricsReady) result = 'lyrics-missing';
  else if (!clockAdvanced) result = 'playback-stalled';
  else if (!final.hasCurrentLine && final.firstLineStartMs > final.currentMs) result = 'intro';
  return {
    result, clientDetected, progressAdvanced, clockAdvanced,
    audible: samples.some((sample) => sample.audible),
    outputDeviceCount: max('outputDeviceCount'),
    audioSessionCount: max('audioSessionCount'),
    activeAudioSessionCount: max('activeAudioSessionCount'),
    audioPeak: max('audioPeak'),
    errorSampleCount: samples.filter((sample) => sample.error).length,
  };
}

function createWeSingDiagnostics({ now, setTimer, clearTimer, getSnapshot, logDir }) {
  let run = null;
  let lastReport = null;

  function finish(reason) {
    if (!run) return;
    const current = run;
    run = null;
    clearTimer(current.timer);
    const final = playbackSnapshot(getSnapshot());
    lastReport = {
      version: 1,
      startedAt: current.startedAt,
      durationMs: Math.max(0, now() - current.started),
      reason,
      initial: current.initial,
      final,
      summary: summarize(current.samples, final, reason),
      samples: current.samples,
    };
    current.resolve(lastReport);
  }

  function start() {
    if (run) return run.promise;
    const { promise, resolve } = Promise.withResolvers();
    run = {
      promise, resolve, started: now(), startedAt: new Date().toISOString(),
      initial: playbackSnapshot(getSnapshot()), samples: [], timer: null,
    };
    run.timer = setTimer(() => finish('completed'), DURATION_MS);
    run.timer?.unref?.();
    return promise;
  }

  function record(sample, audible) {
    if (!run || run.samples.length >= MAX_SAMPLES) return;
    const elapsedMs = Math.max(0, now() - run.started);
    if (elapsedMs >= DURATION_MS || elapsedMs - (run.samples.at(-1)?.elapsedMs ?? -Infinity) < SAMPLE_INTERVAL_MS) return;
    run.samples.push({
      elapsedMs,
      detected: sample.detected === true,
      currentSec: number(sample.currentSec),
      totalSec: number(sample.totalSec),
      loading: sample.loading === true,
      progressSource: ['msaa', 'uia'].includes(sample.progressSource) ? sample.progressSource : '',
      audioActive: typeof sample.audioActive === 'boolean' ? sample.audioActive : null,
      audioPeak: number(sample.audioPeak),
      outputDeviceCount: number(sample.outputDeviceCount),
      audioSessionCount: number(sample.audioSessionCount),
      activeAudioSessionCount: number(sample.activeAudioSessionCount),
      audible: audible === true,
      error: Boolean(sample.error),
      playback: playbackSnapshot(getSnapshot()),
    });
  }

  async function exportReport(startedAt) {
    const report = lastReport;
    if (!report || startedAt !== report.startedAt) throw new Error('诊断记录已失效，请重新运行播放诊断后导出。');
    if (!logDir) throw new Error('日志文件夹尚未就绪，请稍后重试。');
    const date = new Date();
    const pad = (value, width = 2) => String(value).padStart(width, '0');
    const timestamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}-${pad(date.getMilliseconds(), 3)}`;
    const filePath = path.join(logDir, `wesing-playback-diagnostic-${timestamp}.json`);
    try {
      await fs.mkdir(logDir, { recursive: true });
      await fs.writeFile(filePath, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    } catch (error) {
      if (error.code === 'EEXIST' && error.path === filePath) throw new Error('同名诊断文件已存在，请稍后重试。');
      throw new Error('诊断保存失败，请检查日志文件夹权限后重试。');
    }
    return { path: filePath };
  }

  return { start, record, exportReport, stop: () => finish('stopped') };
}

module.exports = { createWeSingDiagnostics };
