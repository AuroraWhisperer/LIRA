// A snapshot establishes the session/version; later domain events must be consecutive.
export function createGameSessionStream({ onSnapshot, onDelta, recover }) {
  let sessionId = null;
  let eventRevision = 0;
  let requestId = 0;
  let recovering = false;
  let queued = [];
  let overflow = false;

  function beginSnapshot() {
    recovering = true;
    queued = [];
    overflow = false;
    return ++requestId;
  }

  function setSnapshot(session) {
    sessionId = session?.sessionId || null;
    eventRevision = session?.eventRevision || 0;
    onSnapshot(session);
  }

  function acceptDelta(payload, replaying = false) {
    if (payload.sessionId === sessionId && payload.eventRevision <= eventRevision) return;
    if (!sessionId || payload.sessionId !== sessionId || payload.eventRevision !== eventRevision + 1) {
      recover();
      return;
    }
    eventRevision = payload.eventRevision;
    onDelta(payload, replaying);
  }

  function finishSnapshot(id, session) {
    if (id !== requestId) return false;
    const pending = queued;
    queued = [];
    recovering = false;
    if (overflow) {
      recover();
      return false;
    }
    setSnapshot(session);
    for (const payload of pending) {
      if (recovering) break;
      acceptDelta(payload, true);
    }
    return true;
  }

  function receive(payload) {
    if (payload.type === 'game:update') {
      if (
        !recovering && payload.session?.sessionId === sessionId &&
        payload.session?.eventRevision <= eventRevision
      ) return;
      requestId += 1;
      recovering = false;
      queued = [];
      setSnapshot(payload.session);
      return;
    }
    if (!['game:patch', 'game:draw'].includes(payload.type)) return;
    if (recovering) {
      if (queued.length < 512) queued.push(payload);
      else overflow = true;
      return;
    }
    acceptDelta(payload);
  }

  return {
    beginSnapshot,
    finishSnapshot,
    receive,
    isCurrent: (id) => id === requestId,
    isRecovering: () => recovering,
    dispose() {
      requestId += 1;
      recovering = false;
      queued = [];
    },
  };
}
