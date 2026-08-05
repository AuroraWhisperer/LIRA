'use strict';

const MAX_FRAME_GAP_MS = 64;

export function wrapIndex(index, length) {
  if (length <= 0) return 0;
  return ((index % length) + length) % length;
}

export function pixelsPerSecond(viewportHeight, secondsPerViewport) {
  const height = Math.max(1, Number(viewportHeight) || 1);
  const seconds = Math.max(0.01, Number(secondsPerViewport) || 0.01);
  return height / seconds;
}

export function bufferPixels(viewportHeight, beforeViewports, afterViewports) {
  const height = Math.max(1, Number(viewportHeight) || 1);
  return [
    height * Math.max(0, Number(beforeViewports) || 0),
    height * Math.max(0, Number(afterViewports) || 0)
  ];
}

/**
 * Maintains a circular DOM window for variable-height records.
 * Domain data and DOM construction are supplied by the caller.
 */
export class SongVirtualScroller {
  constructor({
    viewport,
    content,
    createNode,
    keyOf = (record) => record.key,
    beforeViewports = 2,
    afterViewports = 3,
    requestFrame = (callback) => globalThis.requestAnimationFrame(callback),
    cancelFrame = (frameId) => globalThis.cancelAnimationFrame(frameId)
  }) {
    if (!viewport || !content || typeof createNode !== 'function') {
      throw new TypeError('SongVirtualScroller requires viewport, content, and createNode.');
    }

    this.viewport = viewport;
    this.content = content;
    this.createNode = createNode;
    this.keyOf = keyOf;
    this.beforeViewports = beforeViewports;
    this.afterViewports = afterViewports;
    this.requestFrame = requestFrame;
    this.cancelFrame = cancelFrame;
    this.records = [];
    this.secondsPerViewport = 45;
    this.isScrollable = false;
    this.running = false;
    this.frameId = null;
    this.lastFrameTime = null;
    this.tick = this.tick.bind(this);
  }

  setRecords(records, anchor = this.captureAnchor()) {
    const wasRunning = this.running;
    this.pause();
    this.records = Array.isArray(records) ? [...records] : [];
    this.renderWindow(anchor);
    if (wasRunning) this.start();
  }

  setSecondsPerViewport(seconds) {
    this.secondsPerViewport = Math.max(0.01, Number(seconds) || 0.01);
  }

  captureAnchor() {
    const children = Array.from(this.content.children ?? []);
    if (children.length === 0) return null;

    const scrollTop = Number(this.viewport.scrollTop) || 0;
    const node = children.find((child) => this.recordTop(child) + child.offsetHeight > scrollTop)
      ?? children.at(-1);
    return {
      key: node.dataset?.recordKey ?? '',
      index: Number(node.dataset?.recordIndex) || 0,
      offset: scrollTop - this.recordTop(node)
    };
  }

  relayout(anchor = this.captureAnchor()) {
    const wasRunning = this.running;
    this.pause();
    this.renderWindow(anchor);
    if (wasRunning) this.start();
  }

  start() {
    this.running = true;
    this.lastFrameTime = null;
    if (!this.isScrollable || this.frameId !== null) return;
    this.frameId = this.requestFrame(this.tick);
  }

  pause() {
    this.running = false;
    this.lastFrameTime = null;
    if (this.frameId === null) return;
    this.cancelFrame(this.frameId);
    this.frameId = null;
  }

  destroy() {
    this.pause();
    this.records = [];
    this.isScrollable = false;
    this.content.replaceChildren();
    this.viewport.scrollTop = 0;
  }

  tick(timestamp) {
    this.frameId = null;
    if (!this.running || !this.isScrollable) return;

    if (this.lastFrameTime !== null) {
      const elapsed = Math.min(MAX_FRAME_GAP_MS, Math.max(0, timestamp - this.lastFrameTime));
      const distance = pixelsPerSecond(
        this.viewport.clientHeight,
        this.secondsPerViewport
      ) * elapsed / 1000;
      this.advanceBy(distance);
    }
    this.lastFrameTime = timestamp;
    this.frameId = this.requestFrame(this.tick);
  }

  advanceBy(distance) {
    if (!this.isScrollable || !(distance > 0)) return;
    this.viewport.scrollTop += distance;
    this.recycleTopRecords();
    this.fillAfterBuffer();
  }

  renderWindow(anchor) {
    this.content.replaceChildren();
    this.viewport.scrollTop = 0;
    this.isScrollable = false;
    if (this.records.length === 0) return;

    const anchorIndex = this.resolveAnchorIndex(anchor);
    if (!this.probeOverflow(anchorIndex)) {
      this.content.replaceChildren();
      for (let index = 0; index < this.records.length; index += 1) {
        this.content.append(this.createRecordNode(index));
      }
      return;
    }

    this.content.replaceChildren(this.createRecordNode(anchorIndex));
    const viewportHeight = Math.max(1, this.viewport.clientHeight);
    const [beforeBuffer] = bufferPixels(
      viewportHeight,
      this.beforeViewports,
      this.afterViewports
    );
    const beforeLimit = Math.max(1, this.records.length * (this.beforeViewports + 1));
    let beforeHeight = 0;
    let previousIndex = wrapIndex(anchorIndex - 1, this.records.length);
    let additions = 0;

    while (beforeHeight < beforeBuffer && additions < beforeLimit) {
      const oldHeight = this.content.scrollHeight;
      this.content.prepend(this.createRecordNode(previousIndex));
      beforeHeight += Math.max(1, this.content.scrollHeight - oldHeight);
      previousIndex = wrapIndex(previousIndex - 1, this.records.length);
      additions += 1;
    }

    const targetScrollTop = Math.max(0, beforeHeight + Number(anchor?.offset ?? 0));
    this.fillAfterBuffer(targetScrollTop);
    this.viewport.scrollTop = targetScrollTop;
    this.isScrollable = true;
  }

  probeOverflow(startIndex) {
    const viewportHeight = Math.max(1, this.viewport.clientHeight);
    for (let offset = 0; offset < this.records.length; offset += 1) {
      const index = wrapIndex(startIndex + offset, this.records.length);
      this.content.append(this.createRecordNode(index));
      if (this.content.scrollHeight > viewportHeight + 1) return true;
    }
    return false;
  }

  fillAfterBuffer(scrollTop = this.viewport.scrollTop) {
    if (this.records.length === 0) return;
    const viewportHeight = Math.max(1, this.viewport.clientHeight);
    const [, afterBuffer] = bufferPixels(
      viewportHeight,
      this.beforeViewports,
      this.afterViewports
    );
    const requiredBelow = viewportHeight + afterBuffer;
    const limit = Math.max(1, this.records.length * (this.afterViewports + 2));
    let additions = 0;

    while (this.content.scrollHeight - scrollTop < requiredBelow && additions < limit) {
      const lastIndex = Number(this.content.lastElementChild?.dataset?.recordIndex) || 0;
      this.content.append(this.createRecordNode(wrapIndex(lastIndex + 1, this.records.length)));
      additions += 1;
    }
  }

  recycleTopRecords() {
    const viewportHeight = Math.max(1, this.viewport.clientHeight);
    const [beforeBuffer] = bufferPixels(
      viewportHeight,
      this.beforeViewports,
      this.afterViewports
    );

    while ((this.content.children?.length ?? 0) > 1) {
      const first = this.content.firstElementChild;
      const firstBottom = this.recordTop(first) + first.offsetHeight;
      if (firstBottom > this.viewport.scrollTop - beforeBuffer) break;

      const next = this.content.children[1];
      const removedHeight = Math.max(1, this.recordTop(next) - this.recordTop(first));
      const lastIndex = Number(this.content.lastElementChild?.dataset?.recordIndex) || 0;
      first.remove();
      this.viewport.scrollTop = Math.max(0, this.viewport.scrollTop - removedHeight);
      this.content.append(this.createRecordNode(wrapIndex(lastIndex + 1, this.records.length)));
    }
  }

  resolveAnchorIndex(anchor) {
    if (anchor?.key !== undefined && anchor?.key !== null) {
      const key = String(anchor.key);
      const index = this.records.findIndex((record) => String(this.keyOf(record)) === key);
      if (index >= 0) return index;
    }
    return wrapIndex(Number(anchor?.index) || 0, this.records.length);
  }

  createRecordNode(index) {
    const record = this.records[index];
    const node = this.createNode(record);
    if (!node?.dataset) {
      throw new TypeError('createNode must return an element with a dataset.');
    }
    node.dataset.recordIndex = String(index);
    node.dataset.recordKey = String(this.keyOf(record));
    return node;
  }

  recordTop(node) {
    if (typeof node.getBoundingClientRect === 'function'
        && typeof this.content.getBoundingClientRect === 'function') {
      return node.getBoundingClientRect().top - this.content.getBoundingClientRect().top;
    }
    return node.offsetTop - (Number(this.content.offsetTop) || 0);
  }
}
