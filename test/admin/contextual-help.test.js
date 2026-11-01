'use strict';

const assert = require('node:assert/strict');

const path = require('node:path');
const test = require('node:test');

const { loadModuleExports } = require('../helpers/frontend-modules');

const ROOT_DIR = path.resolve(__dirname, '../..');
const COMPONENT_PATH = path.join(ROOT_DIR, 'public', 'js', 'admin', 'contextual-help.js');

test('contextual help placement keeps the tooltip inside the viewport near an edge', async () => {
  class FakeHTMLElement {}
  const registry = new Map();
  const module = await loadModuleExports(COMPONENT_PATH, {
    HTMLElement: FakeHTMLElement,
    customElements: {
      define(name, constructor) {
        registry.set(name, constructor);
      },
      get(name) {
        return registry.get(name);
      },
    },
  });

  const edge = module.calculateContextualHelpPosition(
    { left: 780, right: 796, top: 20, bottom: 36 },
    { width: 240, height: 80 },
    { width: 800, height: 600 },
  );
  assert.ok(edge.left >= 0 && edge.left + 240 <= 800);
  assert.ok(edge.top >= 36 && edge.top + 80 <= 600);
});
