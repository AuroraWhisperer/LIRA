'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');

async function createFixture({ reducedMotion = false } = {}) {
  const nodes = new Map();
  const navigations = [];
  function node() {
    return {
      textContent: '', style: {}, attributes: {}, animations: [], events: {},
      setAttribute(name, value) { this.attributes[name] = value; },
      addEventListener(name, handler) { this.events[name] = handler; },
      animate(frames, options) {
        const animation = { frames, options, cancelled: false, cancel() { this.cancelled = true; } };
        this.animations.push(animation);
        return animation;
      },
    };
  }
  const heading = (textContent, top, visible = true) => ({
    textContent, top, visible,
    getBoundingClientRect() { return { top: this.top }; },
    getClientRects() { return this.visible ? [{}] : []; },
  });
  const headings = [heading('1.1 安装', 100), heading('折叠内容', 200, false), heading('1.2 连接', 600)];
  const sections = [0, 1000, 2000].map((top, index) => ({
    id: `chapter-${index}`, top, bottom: top + 900,
    getBoundingClientRect() { return { top: this.top, bottom: this.bottom }; },
    querySelectorAll: () => index === 0 ? headings : [],
  }));
  const links = sections.map((section, index) => ({ hash: `#${section.id}`, textContent: ['安装', '点歌', '异常排查'][index] }));
  const panel = {
    querySelector(selector) {
      if (!nodes.has(selector)) nodes.set(selector, node());
      return nodes.get(selector);
    },
    querySelectorAll: () => links,
  };
  const { initUsageGuideProgress } = await loadModuleExports(
    path.resolve(__dirname, '../../public/js/admin/usage-guide-progress.js'),
  );
  const motionQuery = { matches: reducedMotion };
  const update = initUsageGuideProgress(panel, sections, (...args) => navigations.push(args), motionQuery);
  return { sections, headings, nodes, update, navigations, motionQuery };
}

test('reading progress follows the chapter marker, ignores folded headings and recalculates after reflow', async () => {
  const { sections, headings, nodes, update } = await createFixture();
  const progress = nodes.get('.usage-guide-reading-track');
  const detail = nodes.get('.usage-guide-toc-detail');
  update(sections[0], -20, false);
  assert.equal(progress.attributes['aria-valuenow'], '0');
  assert.equal(detail.textContent, '章节概览');
  update(sections[0], 500, false);
  assert.equal(progress.attributes['aria-valuenow'], '50');
  assert.equal(detail.textContent, '1.1 安装');
  assert.equal(nodes.get('.usage-guide-reading-remaining').textContent, '距下一章还剩 50%');

  sections[1].top = 1250;
  update(sections[0], 500, false);
  assert.equal(progress.attributes['aria-valuenow'], '40');
  headings[1].visible = true;
  update(sections[0], 500, false);
  assert.equal(detail.textContent, '折叠内容');
  update(sections[0], 700, false);
  assert.equal(detail.textContent, '1.2 连接');
});

test('previous and next controls reuse chapter navigation and the last chapter completes at scroll end', async () => {
  const { sections, nodes, update, navigations } = await createFixture();
  const previous = nodes.get('.usage-guide-chapter-prev');
  const next = nodes.get('.usage-guide-chapter-next');
  update(sections[0], 0, false);
  assert.equal(previous.disabled, true);
  assert.equal(next.attributes['aria-label'], '下一章：点歌');
  next.events.click();
  assert.deepEqual(navigations[0], [sections[1], 'chapter-1', true]);

  update(sections[1], 1000, false);
  assert.equal(nodes.get('.usage-guide-reading-track').attributes['aria-valuenow'], '0');
  assert.equal(previous.title, '上一章：安装');
  previous.events.click();
  assert.deepEqual(navigations[1], [sections[0], 'chapter-0', true]);

  update(sections[2], 2300, false);
  assert.equal(next.disabled, true);
  assert.equal(nodes.get('.usage-guide-reading-remaining').textContent, '距本章结束还剩 67%');
  update(sections[2], 2500, true);
  assert.equal(nodes.get('.usage-guide-reading-track').attributes['aria-valuenow'], '100');
  assert.equal(nodes.get('.usage-guide-reading-remaining').textContent, '已到文档末尾');
});

test('title motion only runs on heading changes and honors the current reduced-motion preference', async () => {
  const { sections, nodes, update, motionQuery } = await createFixture();
  const location = nodes.get('.usage-guide-toc-location');
  update(sections[0], 0, false);
  assert.equal(location.animations.length, 0);
  update(sections[0], 300, false);
  assert.equal(location.animations.length, 1);
  update(sections[0], 400, false);
  assert.equal(location.animations.length, 1);
  motionQuery.matches = true;
  update(sections[0], 700, false);
  assert.equal(location.animations.length, 1);
  assert.equal(location.animations[0].cancelled, true);
  assert.equal(nodes.get('.usage-guide-toc-detail').textContent, '1.2 连接');
});
