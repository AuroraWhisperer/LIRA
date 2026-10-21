'use strict';

const { createMainWindowIpcRegistrar } = require('./main-window-ipc');

const RANGES = { strength: [-100, 100], semitones: [-12, 12], speedPercent: [50, 200], volume: [0, 200] };

function validConfiguration(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  return entries.length > 0 && entries.every(([key, item]) => {
    if (Object.hasOwn(RANGES, key)) return Number.isInteger(item) && item >= RANGES[key][0] && item <= RANGES[key][1];
    if (key === 'original' || key === 'inputMusic') return typeof item === 'boolean';
    if (key === 'source') return typeof item === 'string' && /^(auto|file|input|loopback|pid:[1-9]\d{0,9})$/.test(item);
    if (key === 'inputChannels') return typeof item === 'string' && (item === 'auto'
      || /^(mono|stereo):(0|[1-9]\d{0,2})$/.test(item) && Number(item.split(':')[1]) < 128);
    if (['outputId', 'cableId', 'inputId', 'loopbackId'].includes(key)) return typeof item === 'string' && item.length <= 1024 && !item.includes('\0');
    return false;
  });
}

function registerAudioAssistantIpc({ ipcMain, assistant, getMainWindow, getDesktopBaseUrl, isPathAllowedForLocalMedia, shell }) {
  const register = createMainWindowIpcRegistrar({ ipcMain, getMainWindow, getDesktopBaseUrl });
  const channel = 'audio-assistant:invoke';
  register(channel, async (_event, ...args) => {
    if (args.length !== 1 || !args[0] || typeof args[0] !== 'object' || Array.isArray(args[0]))
      return { ok: false, error: 'IPC_ARGUMENTS_INVALID' };
    const { op, value } = args[0];
    if (Object.keys(args[0]).some((key) => key !== 'op' && key !== 'value')) return { ok: false, error: 'IPC_ARGUMENTS_INVALID' };
    if (op === 'configure') {
      if (!validConfiguration(value)) return { ok: false, error: 'IPC_ARGUMENTS_INVALID' };
    } else if (op === 'file') {
      if (typeof value !== 'string' || value.length > 32768 || !isPathAllowedForLocalMedia(value))
        return { ok: false, error: '请通过选择歌曲按钮打开本地音频。' };
    } else if (!['get', 'start', 'stop', 'refresh', 'recover', 'mixer'].includes(op) || value !== undefined) {
      return { ok: false, error: 'IPC_ARGUMENTS_INVALID' };
    }
    if (op === 'mixer') {
      try { await shell.openExternal('ms-settings:apps-volume'); return { ok: true }; }
      catch { return { ok: false, error: '无法打开 Windows 音量混合器，请从系统设置打开。' }; }
    }
    return assistant.invoke(op, value);
  });
  return () => ipcMain.removeHandler(channel);
}

module.exports = { registerAudioAssistantIpc, validConfiguration };
