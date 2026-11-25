'use strict';

const { createMainWindowIpcRegistrar } = require('./main-window-ipc');

function registerPlannerReminderIpc({ ipcMain, controller, getMainWindow, getDesktopBaseUrl }) {
  const register = createMainWindowIpcRegistrar({ ipcMain, getMainWindow, getDesktopBaseUrl, allowedPaths: new Set(['/admin']) });
  const channels = ['planner-reminders:get-state', 'planner-reminders:sync'];
  register(channels[0], () => controller.getState(), { argumentCount: 0 });
  register(channels[1], (_event, reminders) => controller.sync(reminders), { argumentCount: 1 });
  return () => channels.forEach((channel) => ipcMain.removeHandler(channel));
}

module.exports = { registerPlannerReminderIpc };
