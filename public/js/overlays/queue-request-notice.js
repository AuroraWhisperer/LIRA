// Point-song feedback owns its reading time independently of snapshot delivery.
'use strict';

const MIN_READING_MS = 3600;
const SCROLL_START_MS = 600;
const SCROLL_END_MS = 900;

export function createQueueRequestNotice(element) {
  const ownerDocument = element.ownerDocument;
  const view = ownerDocument.defaultView;
  const reducedMotion = view.matchMedia('(prefers-reduced-motion: reduce)');
  const viewport = ownerDocument.createElement('div');
  viewport.className = 'queue-request-viewport';
  const message = ownerDocument.createElement('div');
  message.className = 'queue-request-message';
  const outcome = ownerDocument.createElement('span');
  outcome.className = 'queue-request-outcome';
  viewport.append(message);
  element.replaceChildren(viewport, outcome);
  const pending = [];
  const seen = new Map();
  let initialized = false;
  let disposed = false;
  let active = null;
  let phase = 'idle';
  let readingTimer = null;
  let panelMotion = null;
  let textMotion = null;
  let layoutKey = '';

  function update(queue) {
    if (disposed) return;
    const timestamp = Date.now();
    for (const [id, expiresAt] of seen) {
      if (expiresAt <= timestamp) seen.delete(id);
    }
    const results = queue?.requestResults || (queue?.requestResult ? [queue.requestResult] : []);
    for (const result of results) {
      if (seen.has(result.id) || result.expiresAt <= timestamp) continue;
      seen.set(result.id, result.expiresAt);
      if (initialized) pending.push(result);
    }
    initialized = true;
    void playNext();
  }

  async function playNext() {
    if (disposed || active || pending.length === 0) return;
    active = pending.shift();
    phase = 'entering';
    layoutKey = '';
    const requester = ownerDocument.createElement('strong');
    requester.textContent = active.requesterName;
    const reason = !active.accepted && active.reason ? `：${active.reason}` : '';
    message.replaceChildren(requester, ownerDocument.createTextNode(` 点歌 ${active.songName}${reason}`));
    outcome.textContent = active.accepted ? '成功' : '失败';
    element.dataset.result = active.accepted ? 'success' : 'failure';
    element.hidden = false;
    panelMotion = element.animate([
      { opacity: 0.35, transform: reducedMotion.matches ? 'none' : 'translateY(-0.3em)' },
      { opacity: 1, transform: 'none' },
    ], { duration: reducedMotion.matches ? 120 : 240, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
    await panelMotion.finished.then(() => true, () => false);
    if (disposed) return;
    panelMotion = null;
    phase = 'reading';
    relayout();
  }

  function relayout() {
    if (disposed || phase !== 'reading') return;
    const fontSize = Number.parseFloat(view.getComputedStyle(element).fontSize);
    const width = viewport.clientWidth;
    if (width <= 0) return;
    const textWidth = message.scrollWidth;
    const key = `${width}:${textWidth}:${fontSize}:${reducedMotion.matches}`;
    if (layoutKey === key) return;
    layoutKey = key;
    clearTimeout(readingTimer);
    textMotion?.cancel();
    textMotion = null;

    const distance = Math.max(0, textWidth - width);
    let readingMs = MIN_READING_MS;
    if (distance > 1) {
      // Very narrow windows slow down further so each word stays visible.
      const pixelsPerSecond = Math.min(fontSize * (reducedMotion.matches ? 1 : 2.5), width * 0.65);
      const travelMs = Math.round(distance / pixelsPerSecond * 10) * 100;
      readingMs = Math.max(readingMs, SCROLL_START_MS + travelMs + SCROLL_END_MS);
      const end = `translateX(-${distance}px)`;
      textMotion = message.animate([
        { transform: 'translateX(0)', offset: 0 },
        { transform: 'translateX(0)', offset: SCROLL_START_MS / readingMs },
        { transform: end, offset: (SCROLL_START_MS + travelMs) / readingMs },
        { transform: end, offset: 1 },
      ], { duration: readingMs, easing: 'linear', fill: 'forwards' });
    }
    readingTimer = setTimeout(finishReading, readingMs);
  }

  async function finishReading() {
    if (disposed || phase !== 'reading') return;
    phase = 'leaving';
    panelMotion = element.animate([
      { opacity: 1, transform: 'none' },
      { opacity: 0, transform: reducedMotion.matches ? 'none' : 'translateY(-0.15em)' },
    ], { duration: reducedMotion.matches ? 100 : 180, easing: 'ease-in', fill: 'forwards' });
    await panelMotion.finished.then(() => true, () => false);
    if (disposed) return;
    element.hidden = true;
    panelMotion.cancel();
    panelMotion = null;
    textMotion?.cancel();
    textMotion = null;
    active = null;
    phase = 'idle';
    void playNext();
  }

  const observer = new view.ResizeObserver(relayout);
  observer.observe(viewport);
  ownerDocument.fonts?.addEventListener('loadingdone', relayout);
  return { update, relayout,
    dispose() {
      if (disposed) return;
      disposed = true;
      clearTimeout(readingTimer);
      panelMotion?.cancel();
      textMotion?.cancel();
      observer.disconnect();
      ownerDocument.fonts?.removeEventListener('loadingdone', relayout);
      pending.length = 0;
      seen.clear();
      active = null;
      element.hidden = true;
    },
  };
}
