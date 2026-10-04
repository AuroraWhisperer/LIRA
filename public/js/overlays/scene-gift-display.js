const TYPES = ['gift-frame', 'guard-thanks'];
const MAX_EVENTS = 200;

// Keep cursors in the parent so replacing child renderers cannot replay events.
export function createSceneGiftDisplay() {
  const cursors = new Map();
  const pending = new Map();
  return {
    update(data, activeTypes) {
      const result = { ...data };
      for (const type of TYPES) {
        if (!Object.hasOwn(data, type)) {
          cursors.delete(type); pending.delete(type);
          continue;
        }
        const snapshot = data[type];
        if (!snapshot) {
          cursors.delete(type); pending.delete(type);
          continue;
        }
        const previous = cursors.get(type);
        const reset = !previous || previous.epoch !== snapshot.epoch;
        const events = reset ? [] : snapshot.events.filter((event) => event.sequence > previous.sequence).map((event) => event.payload);
        cursors.set(type, { epoch: snapshot.epoch, sequence: snapshot.sequence });
        result[type] = { reset, events };
        if (activeTypes.includes(type)) pending.delete(type);
        else pending.set(type, { reset, events: [...(reset ? [] : pending.get(type)?.events || []), ...events].slice(-MAX_EVENTS) });
      }
      return result;
    },
    withoutEvents(data) {
      return Object.fromEntries(Object.entries(data).map(([type, value]) =>
        [type, TYPES.includes(type) && value ? { reset: false, events: [] } : value]));
    },
    takePending() {
      const result = Object.fromEntries(pending);
      pending.clear();
      return result;
    },
    clear() { cursors.clear(); pending.clear(); },
  };
}
