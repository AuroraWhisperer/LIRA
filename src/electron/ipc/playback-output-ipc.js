'use strict';

const { createMainWindowIpcRegistrar } = require('./main-window-ipc');

function validPlaybackRequest(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)
    || Object.keys(request).some(key => !['op', 'value'].includes(key))) return false;
  const { op, value } = request;
  if (op === 'list' || op === 'stop') return value === undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (op === 'open') return Object.keys(value).length === 1 && typeof value.deviceId === 'string'
    && value.deviceId.length <= 2048 && !/[\0\r\n]/.test(value.deviceId) && /^(wasapi|directsound|waveout|asio):.+$/.test(value.deviceId);
  if (op === 'write') return Object.keys(value).length === 2 && Number.isSafeInteger(value.stream) && value.stream > 0
    && value.pcm instanceof ArrayBuffer && value.pcm.byteLength > 0 && value.pcm.byteLength <= 16384
    && value.pcm.byteLength % 8 === 0;
  return false;
}

function registerPlaybackOutputIpc({ ipcMain, output, getMainWindow, getDesktopBaseUrl }) {
  const register = createMainWindowIpcRegistrar({ ipcMain, getMainWindow, getDesktopBaseUrl });
  const channel = 'playback-output:invoke';
  let contents;
  const stop = () => { void output.invoke('stop'); };
  const navigation = (_event, _url, isInPlace, isMainFrame) => { if (isMainFrame && !isInPlace) stop(); };
  function unbind() {
    contents?.removeListener('did-start-navigation', navigation);
    contents?.removeListener('render-process-gone', stop);
    contents?.removeListener('destroyed', stop);
  }
  register(channel, (event, ...args) => {
    if (args.length !== 1 || !validPlaybackRequest(args[0])) return { ok: false, error: 'IPC_ARGUMENTS_INVALID' };
    if (contents !== event.sender) {
      unbind();
      contents = event.sender;
      contents.on('did-start-navigation', navigation);
      contents.on('render-process-gone', stop);
      contents.on('destroyed', stop);
    }
    return output.invoke(args[0].op, args[0].value);
  });
  return () => { unbind(); ipcMain.removeHandler(channel); };
}

module.exports = { registerPlaybackOutputIpc, validPlaybackRequest };
