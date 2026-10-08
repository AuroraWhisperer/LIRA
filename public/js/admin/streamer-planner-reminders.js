'use strict';

import { getEventReminderTimestamp } from './streamer-planner-model.js';

export function createPlannerReminderSync({ getBridge, onStatusChange }) {
  let status = getBridge() ? 'loading' : 'unsupported';
  let signature = null;
  let revision = 0;

  async function sync(events) {
    const bridge = getBridge();
    if (!bridge) return;
    const reminders = events.filter((event) => event.reminderTime).map((event) => ({
      id: event.id, title: event.title, detail: event.detail, remindAt: getEventReminderTimestamp(event),
    }));
    const nextSignature = JSON.stringify(reminders);
    if (nextSignature === signature) return;
    signature = nextSignature;
    const currentRevision = ++revision;
    const previousStatus = status;
    try {
      const result = await bridge.sync(reminders);
      if (currentRevision !== revision) return;
      status = result?.ok ? (result.supported ? 'ready' : 'unsupported') : 'error';
    } catch {
      if (currentRevision !== revision) return;
      status = 'error';
    }
    if (status === 'error') signature = null;
    onStatusChange(status, previousStatus);
  }

  return { sync, getStatus: () => status };
}
