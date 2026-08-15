// Queue overlay shared viewport-resize state.
// Kept separate from queue.js so scroll mechanics never depend on the entry
// module, and separate from queue-scroll.js so the entry can set it while the
// scroll module reads it without a circular import.
'use strict';

let queueViewportResized = false;

export function isQueueViewportResized() {
  return queueViewportResized;
}

export function markQueueViewportResized() {
  queueViewportResized = true;
}
