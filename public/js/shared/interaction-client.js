// Each socket epoch establishes its runtime from a fresh HTTP snapshot.
export function createInteractionClient({ onState, fetchState, countdown }) {
  let epoch = 0;
  let request = 0;
  let runtimeId = null;
  let revision = -1;
  let queued = null;
  let queuedAt;
  const readClock = () => countdown && { atMs: performance.now(), wallMs: Date.now() };
  function accept(next, received, requested, previous) {
    if (!next || next.runtimeId !== runtimeId || !Number.isInteger(next.revision) || next.revision < revision)
      return false;
    revision = next.revision;
    countdown?.sync(next.session, received?.atMs, received?.wallMs, requested, previous);
    return true;
  }
  function receive(next) {
    if (!runtimeId) {
      if (!queued || queued.runtimeId !== next?.runtimeId || next.revision > queued.revision) {
        queued = next;
        queuedAt = readClock();
      }
      return;
    }
    if (accept(next)) onState(next);
  }
  async function load(host = false) {
    const generation = epoch;
    const ticket = ++request;
    const requested = readClock();
    const next = await fetchState(host);
    if (generation !== epoch || ticket !== request) return false;
    if (!runtimeId) {
      runtimeId = next.runtimeId;
      revision = -1;
    }
    const accepted = accept(next, readClock(), requested);
    let state = accepted ? next : null;
    if (accept(queued, queuedAt, undefined, requested)) state = queued;
    queued = null;
    if (!state) return false;
    const hostState = host && accepted && next.revision === revision ? next : null;
    onState(state, hostState);
    return true;
  }
  function reset() {
    epoch += 1;
    request += 1;
    runtimeId = null;
    revision = -1;
    queued = null;
  }
  return { receive, load, reset, dispose: reset };
}
