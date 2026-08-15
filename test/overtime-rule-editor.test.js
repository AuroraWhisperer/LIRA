'use strict';

// Real ES module test for the overtime rule editor. Guards the createRule
// surface that admin/overtime.js uses to add a rule from the gift picker, so a
// regression that drops it (or calls the editor-closure createRuleRow from the
// admin page) fails instead of only breaking in the browser.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadModuleExports } = require('./helpers/frontend-modules');

const EDITOR_ENTRY = path.join(__dirname, '..', 'public', 'js', 'admin', 'overtime-rule-editor.js');

function createFakeElement() {
  const element = {
    className: '',
    textContent: '',
    title: '',
    value: '',
    checked: false,
    disabled: false,
    hidden: false,
    type: '',
    name: '',
    src: '',
    alt: '',
    min: '',
    max: '',
    step: '',
    inputMode: '',
    dataset: {},
    classList: {
      add() {},
      remove() {},
      toggle() {},
      contains() { return false; }
    },
    children: [],
    listeners: {},
    append(...nodes) { this.children.push(...nodes); return this; },
    appendChild(node) { this.children.push(node); return node; },
    replaceChildren(...nodes) { this.children = [...nodes]; },
    addEventListener(type, handler) { this.listeners[type] = handler; },
    setAttribute() {},
    querySelector() { return createFakeElement(); },
    querySelectorAll() { return []; },
    closest() { return null; },
    insertBefore() {},
    remove() {}
  };
  return element;
}

function createFakeDocument() {
  return {
    createElement() { return createFakeElement(); },
    createTextNode(text) { return { text }; }
  };
}

test('rule editor exposes createRule and appends a fixed-mode rule row', async () => {
  const namespace = await loadModuleExports(EDITOR_ENTRY, { document: createFakeDocument() });
  const dirtyCalls = [];
  const root = createFakeElement();
  const editor = namespace.createOvertimeRuleEditor(root, () => dirtyCalls.push(true));

  assert.equal(typeof editor.createRule, 'function');
  assert.equal(typeof editor.readRules, 'function');
  assert.equal(typeof editor.renderRules, 'function');

  const row = editor.createRule({ id: 'guard-1', name: '总督', imagePath: 'guard.png' });
  assert.ok(row);
  assert.equal(row.dataset.giftId, 'guard-1');
  assert.equal(row.dataset.giftName, '总督');
  assert.equal(row.dataset.overtimeRule, 'true');
  assert.equal(dirtyCalls.length, 1);
  assert.equal(root.children.length, 1);
});
