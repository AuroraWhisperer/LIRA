'use strict';

import { getEventReminderTimestamp } from './streamer-planner-model.js';

export function createPlannerReminderSync({ getBridge, onStatusChange }) {
  let status = getBridge() ? 'loading' : 'unsupported';
  let signature = null;
  let revision = 0;

  async function sync(events, editedEvents) {
    const bridge = getBridge();
    if (!bridge) return;
    const capturedAt = Date.now();
    const agenda = events.filter(event => event.reminderTime).map(event => {
      const remindAt = getEventReminderTimestamp(event);
      const entry = { id: event.id, localAt: `${event.date}T${event.reminderTime}`, remindAt };
      // Keep the body if a zone change in transit could still put this local minute in the future.
      // Older entries need only their identity, except for edits to an outstanding wake-up notification.
      if (Date.parse(`${entry.localAt}Z`) + 86400000 > capturedAt || editedEvents?.has(event)) {
        entry.title = event.title;
        entry.detail = event.detail;
      }
      return JSON.stringify(entry);
    }).join('\n');
    if (agenda === signature) return;
    signature = agenda;
    const currentRevision = ++revision;
    const previousStatus = status;
    try {
      const result = await bridge.sync({ capturedAt, agenda });
      if (currentRevision !== revision) return;
      if (result?.ok) status = result.supported ? 'ready' : 'unsupported';
      else status = result?.error === 'PLANNER_REMINDERS_LIMIT' ? 'limit' : 'error';
    } catch {
      if (currentRevision !== revision) return;
      status = 'error';
    }
    if (status === 'error' || status === 'limit') signature = null;
    onStatusChange(status, previousStatus);
  }

  return { sync, getStatus: () => status };
}
