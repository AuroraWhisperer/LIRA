// Private reminders are a transient calendar projection, never planner localStorage data.
export function createFanCalendar({ windowRef = window, isVisible, onChange }) {
  let disposed = false;
  let generation = 0;
  let pending = null;
  let events = [];

  function publish(next) {
    if (JSON.stringify(next) === JSON.stringify(events)) return;
    events = next;
    onChange(events);
  }

  async function refresh() {
    if (disposed || !isVisible() || !windowRef.fanProfiles) return;
    if (pending) return pending;
    const captured = generation;
    const request = (async () => {
      try {
        const result = await windowRef.fanProfiles.invoke({ action: 'calendar' });
        if (!disposed && captured === generation) publish(result.ok ? result.data : []);
      } catch {
        if (!disposed && captured === generation) publish([]);
      }
    })();
    pending = request;
    try { await request; } finally { if (pending === request) pending = null; }
  }

  function invalidate() {
    generation++;
    pending = null;
    publish([]);
    void refresh();
  }

  const unsubscribe = windowRef.liraLicense?.onStateChanged?.(invalidate);
  windowRef.addEventListener('fan-profiles-changed', invalidate);
  const timer = windowRef.setInterval(() => void refresh(), 30000);
  function dispose() {
    if (disposed) return;
    disposed = true;
    generation++;
    events = [];
    windowRef.clearInterval(timer);
    unsubscribe?.();
    windowRef.removeEventListener('fan-profiles-changed', invalidate);
    windowRef.removeEventListener('pagehide', dispose);
  }
  windowRef.addEventListener('pagehide', dispose, { once: true });
  return { refresh, dispose, getEvents: () => events };
}
