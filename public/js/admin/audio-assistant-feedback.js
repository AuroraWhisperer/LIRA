'use strict';

import { toast } from '../shared/toast.js';

// The existing desktop snapshot reports normal states and failures in the same status field.
const NORMAL_STATUSES = new Set([
  '', '电音助手尚未启动。', '选择音乐来源，开启当前歌曲的处理。', '音乐来源和设备已刷新。',
  '本地歌曲已就绪，开启当前歌曲即可处理。', '设置已保存。',
  '正在确认最终输出；若播放器暂停，请继续播放。', '正在检查播放器通道；可随时关闭当前歌曲处理。',
  '正在启动音频处理…', '正在处理当前歌曲', '当前歌曲处理已关闭', '当前歌曲处理已关闭，播放器输出已还原',
  '已停止；后台将在播放器下次启动时恢复原声。', '后台将在播放器下次启动时恢复原声。', '原声恢复完成。',
  '正在试听原声', '正在处理本地歌曲', '原声已隔离 · 原声对比',
  '原声已隔离 · 正在输出处理后的音乐', '原声已隔离 · 等待播放器声音',
]);

const FAILURE_MESSAGES = [
  [/请从 Windows 桌面客户端/, '请在 Windows 版 LIRA 客户端中打开电音助手。'],
  [/请先选择已有的独立原声通道/, '尚未选择可用的原声通道。请选择空闲的虚拟音频通道（如 OMEN 或 VB-CABLE），或将音乐来源改为「本地文件」。'],
  [/原声通道与最终输出不能相同/, '原声通道与最终输出选中了同一设备。请把原声通道改为空闲的虚拟音频通道，把最终输出设为实际听歌的扬声器或耳机。'],
  [/原声通道正被|其他程序开始使用原声通道/, '原声通道正在被其他程序使用。请停止该程序的播放，或选择其他空闲的虚拟音频通道。'],
  [/请先关闭当前歌曲的处理/, '当前歌曲还在处理中。请先关闭「当前歌曲」，再切换音乐来源或设备。'],
  [/仍在处理或恢复中|另一个窗口正在处理或恢复|此前的恢复助手仍在运行/, '播放器或原声通道正在被另一个窗口使用或恢复。请先停止那个窗口的处理，等待原声恢复后再试。'],
  [/请先选择一首本地歌曲|本地歌曲不存在|请通过选择歌曲按钮/, '尚未选择歌曲，或之前的文件已不存在。请点击「选择歌曲」，重新打开本地音频文件。'],
  [/只支持单声道或双声道歌曲/, '这首歌曲的声道格式暂不支持。请选择单声道或双声道的音频文件。'],
  [/没有检测到播放器|播放器已退出/, '没有找到正在播放的音乐，或播放器已经退出。请先播放歌曲，再展开「音乐来源」重新选择后开启处理。'],
  [/尚未识别当前歌曲/, '尚未识别到当前歌曲。请先播放歌曲，并在播放器中开启系统媒体信息或歌曲窗口标题；仍无法识别时，可改用「本地文件」。'],
  [/无法识别播放器/, '无法读取播放器信息。请以普通权限启动播放器和 LIRA，播放歌曲后重试。'],
  [/播放器同时向多个设备输出/, '播放器正在向多个设备输出声音。请在「最终输出」中明确选择实际听歌的扬声器或耳机，再开启处理。'],
  [/播放器未切入原声通道|Windows 未应用播放器隔离路由|无法关闭原声通道直通/, '未能隔离播放器原声，处理已取消。请将播放器输出设为系统默认，关闭独占模式或 ASIO 输出后重试。'],
  [/原声通道被解除静音/, '原声通道被取消了静音，处理已自动停止，避免原声和处理后的声音同时播放。请检查其他音频软件的设置后重新开启。', 'warning'],
  [/歌曲已切换|歌曲或播放器已切换|已切换播放器/, '歌曲或播放器已切换，处理已自动关闭。需要继续处理时，请重新开启「当前歌曲」。', 'info'],
  [/外部实时处理需要 Windows/, '当前 Windows 版本不支持实时处理。请升级系统，或将音乐来源改为「本地文件」。'],
  [/音频组件未就绪|人声分离模型校验失败|缺少电音助手数据目录|未知电音助手启动方式|变速变调引擎初始化失败/, '音频处理组件缺失或损坏。请重新安装完整的 LIRA 客户端后再试。'],
  [/音频组件启动超时/, '音频组件启动超时。请重新打开电音助手；仍无法启动时，请重启客户端。'],
  [/音频操作超时/, '本次音频操作等待超时。请关闭「当前歌曲」，点击「恢复原声」后重试。'],
  [/打开播放器音频超时|没有获取到播放器音频/, '未能获取播放器的声音。请确认歌曲正在播放，关闭播放器的独占模式后重试。'],
  [/音频组件已退出|音频组件连接中断|电音助手正在关闭/, '音频组件已断开，暂时无法处理。请重新打开电音助手；若原声未恢复，请点击「恢复原声」。'],
  [/无法打开 Windows 音量混合器/, '无法打开系统音量混合器。请在 Windows 的「设置 → 系统 → 声音」中打开音量混合器。'],
  [/IPC_ARGUMENTS_INVALID|未知电音助手操作/, '本次音频设置未被接受。请重新选择设置后重试；仍失败时，请重启客户端。'],
  [/无法启动.*恢复助手|恢复助手尚未就绪|隔离助手未就绪/, '原声恢复组件未能启动。请重启客户端；仍失败时，请重新安装完整客户端。'],
  [/恢复|还原|音频停止异常/, '原声尚未完全恢复。请先停止其他窗口的音频处理，再点击「恢复原声」；仍无声音时，请检查系统音量混合器中的播放器输出。'],
];

const OPERATION_FAILURES = {
  get: '无法启动或连接音频组件。请重新打开电音助手；仍失败时，请重启客户端。若原声未恢复，请点击「恢复原声」。',
  configure: '未能保存本次音频参数。请重新调整后重试。',
  start: '当前歌曲未能开始处理。请检查音乐来源、原声通道和最终输出后重试；仍失败时，可换一首本地歌曲再试。',
  stop: '未能确认当前歌曲已经停止处理。请再次关闭「当前歌曲」，并点击「恢复原声」检查输出。',
  refresh: '音乐来源和设备列表未能更新。请检查设备连接，再点击「刷新设备」。',
  recover: '原声恢复失败。请停止其他窗口的音频处理，再点击「恢复原声」；仍无声音时，请检查系统音量混合器中的播放器输出。',
  file: '无法打开所选歌曲。请确认文件仍存在、可以正常播放，再点击「选择歌曲」重新选择。',
  mixer: '无法打开系统音量混合器。请在 Windows 的「设置 → 系统 → 声音」中打开音量混合器。',
  state: '音频处理出现异常。请检查播放器和音频设备后重新开启；若原声未恢复，请点击「恢复原声」。',
};

export function formatAudioFailure(error, op = 'state', state = {}) {
  const detail = String(error || '').split(/\r?\n/).filter((line) => !NORMAL_STATUSES.has(line)).join('\n');
  const match = FAILURE_MESSAGES.find(([pattern]) => pattern.test(detail));
  let message = match?.[1] || OPERATION_FAILURES[op] || OPERATION_FAILURES.state;
  if (state.pendingRecovery && !message.includes('恢复原声')) {
    message += ' 原声仍待恢复，可点击「恢复原声」重试。';
  }
  return { message, type: match?.[2] || 'error' };
}

export function formatAudioStatus(state = {}) {
  if (!state.ready) return '音频组件未就绪';
  if (state.starting) return state.status?.startsWith('正在确认最终输出') ? '正在等待播放器声音' : '正在开启处理…';
  if (state.running) {
    if (state.status?.includes('等待播放器声音')) return '正在等待播放器声音';
    if (state.original) return '正在试听原声';
    return state.source === 'file' ? '正在处理本地歌曲' : '正在处理当前歌曲';
  }
  return state.pendingRecovery ? '等待恢复原声' : '当前歌曲处理已关闭';
}

function stateNotice(state) {
  if (!NORMAL_STATUSES.has(state.status || '')) {
    return formatAudioFailure(state.status, state.ready === false ? 'get' : 'state', state);
  }
  if (state.pendingRecovery) {
    return { type: 'warning', message: '原声尚待恢复，后台会继续尝试。若播放器已退出，会在它下次启动时恢复；也可点击「恢复原声」重试。' };
  }
  return null;
}

export function createAudioFeedback(notify = toast) {
  let state = {};
  let pending = 0;
  let lastNotice = '';
  let handle;
  let disposed = false;

  function show(notice) {
    handle = notify(notice.message, { key: 'audio-assistant-feedback', title: '电音助手',
      type: notice.type, update: true, duration: 10000, urgent: notice.type === 'error', topLayer: true });
  }

  function reportState() {
    const notice = stateNotice(state);
    if (notice && state.pendingRecovery && NORMAL_STATUSES.has(state.status || '') && lastNotice) return;
    if (notice && notice.message !== lastNotice) show(notice);
    lastNotice = notice?.message || '';
  }

  function fail(op, error) {
    if (disposed) return;
    show(formatAudioFailure(error, op, state));
    lastNotice = stateNotice(state)?.message || '';
  }

  return {
    receive(next) {
      state = next;
      if (!disposed && !pending) reportState();
    },
    begin() { pending += 1; },
    finish(op, result) {
      pending -= 1;
      if (disposed) return;
      // Native state arrives before the command reply; present that failure only once.
      if (!result?.ok) fail(op, result?.error);
      else if (op === 'recover' && state.pendingRecovery) {
        const notice = stateNotice(state);
        show(notice);
        lastNotice = notice.message;
      } else if (!pending) reportState();
    },
    fail,
    dispose() { disposed = true; handle?.close(true); },
  };
}
