export function renderPollRows(container, session) {
  const changed = container.dataset.sessionId !== session.sessionId;
  if (changed) {
    container.replaceChildren();
    container.dataset.sessionId = session.sessionId;
    for (const option of session.options) {
      const row = document.createElement('div');
      row.className = 'interaction-row';
      const label = document.createElement('div');
      label.className = 'interaction-option';
      label.textContent = option.text;
      const track = document.createElement('div');
      track.className = 'interaction-track';
      const bar = document.createElement('span');
      bar.className = 'interaction-fill';
      const value = document.createElement('div');
      value.className = 'interaction-value';
      const votes = document.createElement('span');
      votes.className = 'interaction-votes';
      const percentage = document.createElement('strong');
      percentage.className = 'interaction-percentage';
      value.append(votes, percentage);
      track.append(bar, label, value);
      row.append(track);
      container.append(row);
    }
    container.scrollTop = 0;
  }
  const maximum = Math.max(0, ...session.options.map((item) => item.votes));
  const tied = session.options.filter((item) => item.votes === maximum).length > 1;
  session.options.forEach((option, index) => {
    const row = container.children[index];
    const winner = session.phase === 'finished' && maximum > 0 && option.votes === maximum;
    const [bar, label, value] = row.children[0].children;
    label.textContent = option.text + (winner ? (tied ? ' · 并列最高' : ' · 最高票') : '');
    bar.style.width = `${option.percentage}%`;
    value.children[0].textContent = `${option.votes} 票`;
    value.children[1].textContent = `${option.percentage.toFixed(1)}%`;
  });
  return changed;
}

function pollSnapshotAge(serverNowMs, receivedAtMs, receivedWallMs, requested, previous) {
  if (!Number.isFinite(serverNowMs)) return 0;
  const age = receivedWallMs - serverNowMs;
  if (!requested) {
    // A push has no request timestamp. Compare both wall-clock samples on the same monotonic timeline.
    const priorWallEstimate = previous.wallMs + receivedAtMs - previous.atMs;
    return Math.max(0, Math.min(age, priorWallEstimate - serverNowMs));
  }
  const roundTrip = receivedAtMs - requested.atMs;
  if (age >= 0 && age <= roundTrip) return age;
  // A clock adjustment during this local HTTP read cannot make the snapshot older than the read.
  return Math.min(roundTrip, Math.max(0, requested.wallMs + roundTrip - serverNowMs));
}

export function createPollCountdown() {
  let sessionId = null;
  let deadlineMs = 0;
  let lastClock = { atMs: performance.now(), wallMs: Date.now() };
  return {
    sync(session, receivedAtMs = performance.now(), receivedWallMs = Date.now(), requested, previous = lastClock) {
      if (receivedAtMs >= lastClock.atMs) lastClock = { atMs: receivedAtMs, wallMs: receivedWallMs };
      if (session?.kind !== 'poll') {
        sessionId = null;
        return;
      }
      if (session.sessionId !== sessionId || requested) {
        sessionId = session.sessionId;
        const remaining = Number.isFinite(session.remainingMs)
          ? session.remainingMs - pollSnapshotAge(session.serverNowMs, receivedAtMs, receivedWallMs, requested, previous)
          : (session.endsAt ?? 0) - receivedWallMs;
        deadlineMs = receivedAtMs + Math.max(0, remaining);
      } else if (Number.isFinite(session.remainingMs)) {
        // A delayed snapshot from this poll cannot extend its deadline.
        deadlineMs = Math.min(deadlineMs, receivedAtMs + session.remainingMs);
      }
    },
    remainingMs: () => Math.max(0, deadlineMs - performance.now()),
  };
}

export function interactionStatus(session, remainingMs = session.remainingMs) {
  if (session.phase === 'finished') return session.kind === 'poll' ? '投票已结束' : '评分已结束';
  if (session.phase === 'interrupted') return '接收已中断';
  if (!session.connected) return '连接中断，可能漏收';
  if (session.kind === 'rating') return '正在收集评分';
  const seconds = Math.max(0, Math.ceil(remainingMs / 1000));
  return `剩余 ${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
