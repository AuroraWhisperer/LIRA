let initialized = false;
let current = '';
let generation = 0;
let initialization = Promise.resolve();
const listeners = new Set();

export function waitForAuthorizedAccountInitialization() {
  return initialization;
}

function publish(snapshot) {
  const next = snapshot?.state === 'authorized'
    ? JSON.stringify([snapshot.streamer?.accountName, snapshot.streamer?.songPageUrl || '']) : '';
  if (next === current) return;
  current = next;
  for (const listener of listeners) listener(current);
}

// This key only invalidates UI drafts. The local API resolves and checks the real owner.
export function observeAuthorizedAccount(listener) {
  listeners.add(listener);
  listener(current);
  if (!initialized) {
    initialized = true;
    const bridge = window.liraLicense;
    const stop = bridge?.onStateChanged?.(snapshot => { generation += 1; publish(snapshot); });
    const requested = generation;
    initialization = Promise.resolve(bridge?.getState?.()).then(snapshot => {
      if (requested === generation) publish(snapshot);
    }).catch(() => {});
    window.addEventListener('pagehide', () => { generation += 1; stop?.(); listeners.clear(); }, { once: true });
  }
  return () => listeners.delete(listener);
}
