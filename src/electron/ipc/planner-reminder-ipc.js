'use strict';

const { createMainWindowIpcRegistrar } = require('./main-window-ipc');

function registerPlannerReminderIpc({ ipcMain, controller, getMainWindow, getDesktopBaseUrl }) {
  const register = createMainWindowIpcRegistrar({ ipcMain, getMainWindow, getDesktopBaseUrl });
  const channels = ['planner-reminders:get-state', 'planner-reminders:sync'];
  function handle(channel, argumentCount, action) {
    register(channel, (event, ...args) => {
      if (new URL(event.senderFrame.url).pathname !== '/admin') return { ok: false, error: 'IPC_SOURCE_INVALID' };
      if (args.length !== argumentCount) return { ok: false, error: 'IPC_ARGUMENTS_INVALID' };
      return action(...args);
    });
  }
  handle(channels[0], 0, () => controller.getState());
  handle(channels[1], 1, (reminders) => controller.sync(reminders));
  return () => channels.forEach((channel) => ipcMain.removeHandler(channel));
}

module.exports = { registerPlannerReminderIpc };
