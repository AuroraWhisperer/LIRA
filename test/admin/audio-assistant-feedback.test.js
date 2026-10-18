'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');
const entry = path.resolve('public/js/admin/audio-assistant-feedback.js');
const missingChannel = '请先选择已有的独立原声通道；没有可用通道时可使用本地歌曲。';

test('audio failures explain known native and desktop problems in Chinese with a recovery step', async () => {
  const { formatAudioFailure } = await loadModuleExports(entry);
  const cases = [
    [missingChannel, /空闲的虚拟音频通道.*本地文件/],
    ['原声通道与最终输出不能相同，请选择空闲的独立通道。', /同一设备.*扬声器或耳机/],
    ['原声通道正被 OtherPlayer 使用，请选择一个空闲的独立通道。', /其他程序.*其他空闲/],
    ['请先关闭当前歌曲的处理，再切换音乐来源或设备。', /先关闭「当前歌曲」/],
    ['另一个窗口正在处理或恢复此播放器，请等待它完成。', /另一个窗口.*等待原声恢复/],
    ['本地歌曲不存在，请重新选择。', /「选择歌曲」.*重新打开/],
    ['电音助手只支持单声道或双声道歌曲。', /请选择单声道或双声道/],
    ['没有检测到播放器，请先播放歌曲。', /先播放歌曲.*音乐来源/],
    ['播放器已退出或音频通道发生变化。', /先播放歌曲.*重新选择/],
    ['尚未识别当前歌曲，未接管音频。', /系统媒体信息或歌曲窗口标题/],
    ['无法识别播放器。', /普通权限启动/],
    ['播放器同时向多个设备输出，请手动选择最终输出后再开始。', /「最终输出」.*扬声器或耳机/],
    ['Windows 未应用播放器隔离路由。', /系统默认.*独占模式/],
    ['原声通道被解除静音，已停止处理，避免重复播放。', /避免原声和处理后的声音同时播放/],
    ['歌曲已切换，请重新开启当前歌曲处理。', /重新开启「当前歌曲」/],
    ['外部实时处理需要 Windows 11 或 Build 20348 以上系统。', /升级系统.*本地文件/],
    ['音频组件未就绪，请重新安装完整客户端；开发环境请先运行 npm run build:audio-assistant。', /重新安装完整的 LIRA/],
    ['人声分离模型校验失败，请重新安装完整客户端。', /组件缺失或损坏/],
    ['变速变调引擎初始化失败。', /重新安装完整/],
    ['音频组件启动超时，请重试。', /启动超时.*重启客户端/],
    ['音频操作超时，可关闭当前歌曲处理后重试。', /等待超时.*恢复原声/],
    ['打开播放器音频超时。', /歌曲正在播放.*独占模式/],
    ['音频组件已退出；如有原声路由，恢复助手会继续还原。', /已断开.*恢复原声/],
    ['无法打开 Windows 音量混合器，请从系统设置打开。', /设置 → 系统 → 声音/],
    ['IPC_ARGUMENTS_INVALID', /重新选择设置/],
    ['无法启动原声恢复助手。', /恢复组件未能启动.*重启客户端/],
    ['原声恢复未完成：Device exception 0x8000', /原声尚未完全恢复.*「恢复原声」/],
  ];
  for (const [error, expected] of cases) {
    const notice = formatAudioFailure(error);
    assert.match(notice.message, expected, error);
    assert.doesNotMatch(notice.message, /npm|Exception|0x8000|IPC_ARGUMENTS_INVALID|OtherPlayer/);
  }
  assert.equal(formatAudioFailure('歌曲或播放器已切换，需要处理时请重新开启。').type, 'info');
  assert.equal(formatAudioFailure('原声通道被解除静音，已停止处理，避免重复播放。').type, 'warning');
});

test('unknown audio errors use operation-specific Chinese copy and do not mistake successful recovery for failure', async () => {
  const { formatAudioFailure } = await loadModuleExports(entry);
  const expectations = { get: /连接音频组件/, configure: /音频参数/, start: /未能开始处理/,
    stop: /未能确认.*停止/, refresh: /列表未能更新/, recover: /原声恢复失败/,
    file: /无法打开所选歌曲/, mixer: /系统音量混合器/, state: /音频处理出现异常/ };
  for (const [op, expected] of Object.entries(expectations)) {
    const notice = formatAudioFailure('Unhandled COMException 0x88890004\n当前歌曲处理已关闭，播放器输出已还原', op);
    assert.match(notice.message, expected, op);
    assert.doesNotMatch(notice.message, /COMException|0x88890004|原声尚未完全恢复/);
    assert.match(formatAudioFailure(undefined, op).message, expected, `Missing error: ${op}`);
  }
  assert.match(formatAudioFailure(missingChannel, 'start', { pendingRecovery: true }).message, /虚拟音频通道.*原声仍待恢复/);
});

test('inline audio status stays short and never includes failure details', async () => {
  const { formatAudioStatus } = await loadModuleExports(entry);
  const state = { ready: true, status: `${missingChannel}\n已停止；后台将在播放器下次启动时恢复原声。` };
  assert.equal(formatAudioStatus(state), '当前歌曲处理已关闭');
  assert.equal(formatAudioStatus({ ...state, pendingRecovery: true }), '等待恢复原声');
  assert.equal(formatAudioStatus({ ...state, ready: false }), '音频组件未就绪');
  assert.equal(formatAudioStatus({ ...state, starting: true }), '正在开启处理…');
  assert.equal(formatAudioStatus({ ...state, running: true }), '正在处理当前歌曲');
  assert.equal(formatAudioStatus({ ...state, running: true, original: true }), '正在试听原声');
  assert.equal(formatAudioStatus({ ...state, running: true, source: 'file' }), '正在处理本地歌曲');
  assert.equal(formatAudioStatus({ ...state, running: true, status: '原声已隔离 · 等待播放器声音' }), '正在等待播放器声音');
});

test('command failures and repeated background states produce one toast, while an explicit retry can notify again', async () => {
  const { createAudioFeedback } = await loadModuleExports(entry);
  const notices = [];
  const feedback = createAudioFeedback((message, options) => notices.push({ message, options }));
  const state = { ready: true, pendingRecovery: true,
    status: `${missingChannel}\n已停止；后台将在播放器下次启动时恢复原声。` };
  feedback.begin();
  feedback.receive(state);
  feedback.receive(state);
  assert.equal(notices.length, 0, 'Wait for the pending operation result instead of announcing its state twice');
  feedback.finish('start', { ok: false, error: missingChannel });
  for (let i = 0; i < 30; i++) feedback.receive(state);
  feedback.receive({ ...state, status: '后台将在播放器下次启动时恢复原声。' });
  assert.equal(notices.length, 1, 'Recovery polling must not replace the failure toast or restart its timer');
  assert.match(notices[0].message, /虚拟音频通道.*原声仍待恢复/);
  assert.equal(notices[0].options.type, 'error');
  assert.equal(notices[0].options.key, 'audio-assistant-feedback');
  assert.equal(notices[0].options.update, true);
  feedback.begin();
  feedback.receive(state);
  feedback.finish('start', { ok: false, error: missingChannel });
  assert.equal(notices.length, 2, 'A fresh attempt must give feedback even after the old toast expires');
});

test('asynchronous failures, safe automatic stops and deferred recovery notify without a failed command', async () => {
  const { createAudioFeedback } = await loadModuleExports(entry);
  const notices = [];
  let closed = 0;
  const feedback = createAudioFeedback((message, options) => {
    notices.push({ message, options });
    return { close: () => closed++ };
  });
  feedback.receive({ ready: false, status: '电音助手尚未启动。' });
  feedback.receive({ ready: true, status: '音乐来源和设备已刷新。' });
  feedback.receive({ ready: true, running: true, status: '原声已隔离 · 等待播放器声音' });
  assert.equal(notices.length, 0, 'Normal playback and successful refresh stay quiet');
  const disconnected = { ready: false, status: 'Worker exited unexpectedly' };
  feedback.receive(disconnected);
  feedback.receive(disconnected);
  assert.equal(notices.length, 1);
  assert.doesNotMatch(notices[0].message, /Worker/);
  feedback.receive({ ready: true, status: '当前歌曲处理已关闭' });
  feedback.receive({ ready: true, status: '歌曲或播放器已切换，需要处理时请重新开启。\n当前歌曲处理已关闭' });
  assert.equal(notices.at(-1).options.type, 'info');
  feedback.begin();
  feedback.receive({ ready: true, pendingRecovery: true, status: '原声恢复未完成：native error' });
  feedback.finish('recover', { ok: true });
  assert.equal(notices.at(-1).options.type, 'error', 'The native recovery command can succeed while its state reports a failure');
  feedback.begin();
  feedback.receive({ ready: true, pendingRecovery: true, status: '后台将在播放器下次启动时恢复原声。' });
  feedback.finish('recover', { ok: true });
  assert.equal(notices.at(-1).options.type, 'warning');
  const count = notices.length;
  feedback.dispose();
  feedback.receive(disconnected);
  feedback.fail('file');
  assert.equal(notices.length, count);
  assert.equal(closed, 1);
});
