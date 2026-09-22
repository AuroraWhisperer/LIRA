// Each socket epoch establishes its runtime from a fresh HTTP snapshot.
export function createInteractionClient({ onState, onHost = () => {}, fetchState }) {
  let epoch = 0;
  let request = 0;
  let runtimeId = null;
  let revision = -1;
  let queued = null;
  function apply(next) {
    if (!next || next.runtimeId !== runtimeId || !Number.isInteger(next.revision) || next.revision < revision)
      return false;
    revision = next.revision;
    onState(next);
    return true;
  }
  function receive(next) {
    if (!runtimeId) {
      if (!queued || queued.runtimeId !== next?.runtimeId || next.revision > queued.revision) queued = next;
      return;
    }
    apply(next);
  }
  async function load(host = false) {
    const generation = epoch;
    const ticket = ++request;
    const next = await fetchState(host);
    if (generation !== epoch || ticket !== request) return;
    if (!runtimeId) {
      runtimeId = next.runtimeId;
      revision = -1;
    }
    const accepted = apply(next);
    if (queued) {
      apply(queued);
      queued = null;
    }
    if (host && accepted && next.revision === revision) onHost(next);
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
