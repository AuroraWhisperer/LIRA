'use strict';

const RESULT_MESSAGES = {
  ready: '采样期间歌词时钟正常推进。若直播画面仍不同步，请导出诊断继续排查。',
  intro: '歌词已加载，播放进度正在推进，当前尚未到第一句歌词。',
  'playback-stalled': '歌词已加载，但采样期间歌词时钟没有推进。请保持全民 K 歌有声播放，并导出诊断。',
  'lyrics-missing': '已检测到歌曲，但歌词尚未就绪。请核对缓存状态，并导出诊断。',
  'client-missing': '采样期间未检测到全民 K 歌客户端，请打开电脑版并播放伴奏后重试。',
  'track-missing': '已检测到客户端，但未识别到正在播放的歌曲。请在全民 K 歌播放伴奏后重试。',
  'track-changed': '采样期间发生了切歌，请保持同一首歌播放，再做一次诊断。',
  'no-samples': '未收到播放采样。请点“重新检测”后重试；仍失败时导出诊断。',
  'monitor-error': '播放采集发生异常，请点“重新检测”后重试，并保留诊断文件。',
  interrupted: '播放采集已停止，本次诊断中断。请重新打开全民 K 歌歌词页面后重试。',
};

export function createWeSingDiagnostics({ request }) {
  let initialized = false;
  let pending = null;
  let report = null;
  let exporting = false;
  const element = (suffix) => document.getElementById(`weSingDiagnostic${suffix}`);
  const setText = (suffix, text) => { const target = element(suffix); if (target) target.textContent = text; };

  async function start() {
    element('Panel').hidden = false;
    if (pending) return pending;
    report = null;
    element('Results').hidden = true;
    element('Export').disabled = true;
    element('Btn').disabled = true;
    setText('Btn', '诊断中…');
    setText('Message', '正在采样约 20 秒。请保持同一首歌有声播放，不要暂停或切歌。');
    try {
      pending = request('/api/music/wesing/diagnose', { method: 'POST', body: {} });
      report = await pending;
      const { summary, final, samples } = report;
      setText('Message', RESULT_MESSAGES[summary.result] || '诊断已结束，可导出记录继续排查。');
      setText('Track', final.trackTitle || '未识别到歌曲');
      setText('Lyrics', final.lyricsReady ? `已读取 ${final.lyricLineCount} 行${final.hasCurrentLine ? '，已有当前歌词' : '，尚无当前歌词'}` : '尚未读到歌词');
      const firstMs = samples[0]?.playback.currentMs ?? report.initial.currentMs;
      setText('Progress', `${formatTime(firstMs)} → ${formatTime(final.currentMs)} · ${summary.clockAdvanced ? '已推进' : '未推进'}`);
      setText('Audio', `${summary.outputDeviceCount} 个输出设备，${summary.audioSessionCount} 个全民 K 歌会话 · ${summary.audible ? '检测到声音' : '未检测到声音'}`);
      element('Results').hidden = false;
      element('Export').disabled = exporting;
    } catch (error) {
      setText('Message', `诊断未完成：${error.message || '请求失败'}。可以再次点击“播放诊断”重试。`);
    } finally {
      pending = null;
      element('Btn').disabled = false;
      setText('Btn', '播放诊断');
    }
  }

  async function exportReport() {
    if (!report || exporting) return;
    const current = report;
    exporting = true;
    element('Export').disabled = true;
    setText('Export', '保存中…');
    try {
      const saved = await request('/api/music/wesing/diagnose/export', { method: 'POST', body: { startedAt: current.startedAt } });
      if (report === current) setText('Message', `已保存到日志文件夹：${saved.path}`);
    } catch (error) {
      if (report === current) setText('Message', `导出失败：${error.message || '保存失败'}。可以再次点击“导出诊断”重试。`);
    } finally {
      exporting = false;
      element('Export').disabled = !report;
      setText('Export', '导出诊断');
    }
  }

  function init() {
    if (initialized) return;
    initialized = true;
    element('Btn')?.addEventListener('click', () => { void start(); });
    element('Close')?.addEventListener('click', () => { element('Panel').hidden = true; });
    element('Export')?.addEventListener('click', exportReport);
  }

  return { init, start };
}

function formatTime(value) {
  const seconds = Math.max(0, Math.floor(Number(value || 0) / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
