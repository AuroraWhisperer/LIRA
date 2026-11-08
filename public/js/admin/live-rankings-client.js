const listeners = new Set();
let request;
let timer;
let snapshot;

function publish(data) {
  snapshot = data;
  for (const listener of listeners) listener(data);
}
async function refresh() {
  if (!listeners.size || request) return;
  const current = new AbortController();
  request = current;
  const started = performance.now();
  try {
    const query = snapshot?.version ? `?version=${encodeURIComponent(snapshot.version)}` : '';
    const response = await fetch(`/api/bilibili/live-rankings${query}`, {
      cache: 'no-store', signal: AbortSignal.any([current.signal, AbortSignal.timeout(4000)]),
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw new Error('榜单读取失败');
    if (request !== current) return;
    if (!payload.data.unchanged) publish(payload.data);
  } catch {
    if (request !== current || current.signal.aborted) return;
    publish({ status: 'stale', message: '榜单连接中断，正在重试', room: null, boards: [] });
  } finally {
    if (request === current) {
      request = null;
      if (listeners.size) timer = setTimeout(refresh, Math.max(0, 500 - (performance.now() - started)));
    }
  }
}

export function subscribeLiveRankings(listener) {
  listeners.add(listener);
  if (snapshot) listener(snapshot);
  if (!timer) void refresh();
  return () => {
    listeners.delete(listener);
    if (listeners.size) return;
    clearTimeout(timer); timer = null;
    request?.abort(); request = null; snapshot = null;
  };
}

export function startLiveRankingsCanvasData(controller, emit) {
  let stop;
  let active = false;
  function sync({ draft }) {
    const needed = active && draft.document.items.some(item => item.type === 'live-rankings' && item.visible !== false);
    if (needed && !stop) stop = subscribeLiveRankings(data => emit({ previewData: { 'live-rankings': data } }));
    if (!needed && stop) { stop(); stop = null; emit({ previewData: { 'live-rankings': null } }); }
  }
  const unsubscribe = controller.subscribe(sync);
  return Object.assign(() => { unsubscribe(); stop?.(); }, {
    setActive(value) { active = value; sync(controller.getState()); },
  });
}
