'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('./helpers/frontend-modules');

test('broadcast pages reach the tail, survive updates, pause for interaction and dispose', async () => {
  let tick;
  let now = 0;
  let cleared = false;
  const events = new Map();
  const document = { hidden: false, activeElement: null };
  const element = {
    clientHeight: 200, scrollHeight: 550, scrollTop: 0,
    contains: (target) => target === element,
    addEventListener: (type, listener) => events.set(type, listener),
    removeEventListener: (type) => events.delete(type),
  };
  const { startOverlayPages } = await loadModuleExports(
    path.resolve(__dirname, '../public/js/overlays/auto-pages.js'),
    { document, Date: { now: () => now }, setInterval: (fn) => { tick = fn; return 1; }, clearInterval: () => { cleared = true; } },
  );
  const stop = startOverlayPages(element);
  tick();
  assert.equal(element.scrollTop, 168);
  element.scrollHeight = 600;
  tick(); tick();
  assert.equal(element.scrollTop, 400, 'updated tail remains reachable');
  events.get('wheel')();
  tick();
  assert.equal(element.scrollTop, 400);
  now = 16001;
  document.activeElement = element;
  tick();
  assert.equal(element.scrollTop, 400, 'keyboard browsing is not interrupted');
  document.activeElement = null;
  tick();
  assert.equal(element.scrollTop, 0);
  document.hidden = true;
  tick();
  assert.equal(element.scrollTop, 0);
  stop();
  assert.equal(cleared, true);
  assert.equal(events.size, 0);
});
