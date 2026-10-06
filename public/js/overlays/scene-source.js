const POLL_INTERVAL = 750;
const CHECK_INTERVAL = 5000;
const MIN_READ_INTERVAL = 100;
const REQUEST_TIMEOUT = 8000;
const HEARTBEAT_TIMEOUT = 5000;
const MAX_RECONNECT_DELAY = 15000;
const MAX_EVENT_SIZE = 4096;
const REVOKED_STATUSES = new Set([401, 403, 404, 423]);

async function readNotifications(reader, receive, heartbeat) {
  const decoder = new TextDecoder();
  let buffer = '';
  let data = '';
  let eventSize = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) throw new Error('Scene notification stream ended');
    heartbeat();
    buffer += decoder.decode(chunk.value, { stream: true });
    let end;
    while ((end = buffer.indexOf('\n')) !== -1) {
      if (end > MAX_EVENT_SIZE) throw new Error('Scene notification line is too large');
      const line = buffer.slice(0, end).replace(/\r$/, '');
      buffer = buffer.slice(end + 1);
      if (!line) {
        if (data) receive(data.slice(0, -1));
        data = ''; eventSize = 0;
      } else if (!line.startsWith(':')) {
        eventSize += line.length;
        if (eventSize > MAX_EVENT_SIZE) throw new Error('Scene notification event is too large');
        if (line === 'data' || line.startsWith('data:')) data += `${line.slice(5).replace(/^ /, '')}\n`;
      }
    }
    if (buffer.length > MAX_EVENT_SIZE) throw new Error('Scene notification buffer is too large');
  }
}

export function createSceneSource({ sceneId, itemId, token, renderer, onError = () => {} }) {
  let started = false;
  let stopped = false;
  let generation = 0;
  let epoch = '';
  let cursor = 0;
  let dirty = false;
  let outputFailed = false;
  let request = null;
  let readTimer = null;
  let readAt = 0;
  let lastReadAt = -Infinity;
  let stream = null;
  let subscription = '';
  let reconnectTimer = null;
  let reconnectDelay = POLL_INTERVAL;

  function query() {
    const values = new URLSearchParams({ id: sceneId, version: renderer.getVersion() });
    if (itemId) values.set('item', itemId);
    if (renderer.getProjection()) values.set('projection', renderer.getProjection());
    return values;
  }
  function options(controller) {
    return { headers: { Authorization: `Bearer ${token}` }, credentials: 'omit', cache: 'no-store', signal: controller.signal };
  }
  function scheduleRead(delay) {
    if (!started || stopped || request) return;
    const now = performance.now();
    const at = Math.max(now + delay, lastReadAt + MIN_READ_INTERVAL);
    if (readTimer !== null && readAt <= at) return;
    clearTimeout(readTimer);
    readAt = at;
    readTimer = setTimeout(() => { readTimer = null; void read(); }, Math.max(0, at - now));
  }
  function requestRead() {
    dirty = true;
    scheduleRead(outputFailed ? POLL_INTERVAL : 0);
  }
  function closeStream() {
    if (!stream) return;
    const previous = stream;
    stream = null;
    clearTimeout(previous.timer);
    previous.controller.abort();
    void previous.reader?.cancel().catch(() => {});
  }
  function reconnect() {
    if (!started || stopped || reconnectTimer !== null) return;
    reconnectTimer = setTimeout(() => { reconnectTimer = null; void connect(); }, reconnectDelay);
    reconnectDelay = Math.min(MAX_RECONNECT_DELAY, reconnectDelay * 2);
  }
  function streamFailed(current) {
    if (stream !== current) return;
    closeStream();
    scheduleRead(dirty && !outputFailed ? 0 : POLL_INTERVAL);
    reconnect();
  }
  function revoke() {
    generation += 1;
    dirty = false;
    outputFailed = true;
    clearTimeout(request?.timer);
    request?.controller.abort();
    closeStream();
    renderer.revoke();
    renderer.disconnect();
    subscription = query().toString();
    onError();
    scheduleRead(POLL_INTERVAL);
    reconnect();
  }
  async function read() {
    if (!started || stopped || request) return;
    dirty = false;
    lastReadAt = performance.now();
    const current = { controller: new AbortController(), generation };
    request = current;
    current.timer = setTimeout(() => current.controller.abort(), REQUEST_TIMEOUT);
    const isCurrent = () => !stopped && generation === current.generation;
    try {
      const values = query();
      values.set('epoch', epoch); values.set('cursor', cursor);
      const response = await fetch(`/api/scene/output?${values}`, options(current.controller));
      if (!isCurrent()) return;
      if (current.controller.signal.aborted) throw new Error('Scene output request timed out');
      if (REVOKED_STATUSES.has(response.status)) { revoke(); return; }
      const payload = await response.json();
      if (!isCurrent()) return;
      if (current.controller.signal.aborted || !response.ok || !payload.ok) throw new Error('Scene output unavailable');
      renderer.update(payload.data);
      const cloud = payload.data.data?.danmaku;
      if (cloud) { epoch = cloud.epoch; cursor = cloud.nextCursor; }
      outputFailed = false;
    } catch {
      if (isCurrent()) {
        outputFailed = true;
        renderer.disconnect();
        onError();
      }
    } finally {
      clearTimeout(current.timer);
      request = null;
      scheduleRead(dirty && !outputFailed ? 0 : stream?.ready && !outputFailed ? CHECK_INTERVAL : POLL_INTERVAL);
    }
  }
  async function connect() {
    if (!started || stopped || stream) return;
    const current = { controller: new AbortController(), reader: null, ready: false, timer: null };
    stream = current;
    const deadline = (delay) => {
      if (stream !== current) return;
      clearTimeout(current.timer);
      current.timer = setTimeout(() => streamFailed(current), delay);
    };
    deadline(REQUEST_TIMEOUT);
    try {
      const response = await fetch(`/api/scene/events?${subscription}`, options(current.controller));
      if (stream !== current) { void response.body?.cancel().catch(() => {}); return; }
      if (!response.ok || !response.body || !response.headers.get('content-type')?.startsWith('text/event-stream')) {
        void response.body?.cancel().catch(() => {});
        throw new Error('Scene notifications unavailable');
      }
      current.reader = response.body.getReader();
      deadline(HEARTBEAT_TIMEOUT);
      await readNotifications(current.reader, (notification) => {
        if (stream !== current) return;
        if (notification === 'revoked') revoke();
        else if (notification === 'ready') {
          current.ready = true;
          reconnectDelay = POLL_INTERVAL;
          requestRead();
        } else if (notification === 'change' && current.ready) requestRead();
      }, () => deadline(HEARTBEAT_TIMEOUT));
    } catch {
      // An absent or saturated events route must not revoke otherwise healthy output.
      streamFailed(current);
    }
  }
  return {
    start() {
      if (started || stopped) return;
      started = true;
      subscription = query().toString();
      void read();
      void connect();
    },
    refreshSubscription() {
      if (!started || stopped) return;
      const next = query().toString();
      if (next === subscription) return;
      subscription = next;
      closeStream();
      clearTimeout(reconnectTimer); reconnectTimer = null;
      reconnectDelay = POLL_INTERVAL;
      void connect();
    },
    dispose() {
      if (stopped) return;
      stopped = true;
      generation += 1;
      clearTimeout(readTimer); clearTimeout(reconnectTimer); clearTimeout(request?.timer);
      request?.controller.abort();
      closeStream();
    },
  };
}
