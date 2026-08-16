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

function findByClass(root, className) {
  if (String(root.className || '').split(/\s+/).includes(className)) return root;
  for (const child of root.children || []) {
    const match = findByClass(child, className);
    if (match) return match;
  }
  return null;
}

function findAllByDataset(root, key) {
  const matches = root.dataset?.[key] === 'true' ? [root] : [];
  for (const child of root.children || []) matches.push(...findAllByDataset(child, key));
  return matches;
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

  const newRuleBody = findByClass(row, 'overtime-rule-body');
  const toggle = findByClass(row, 'overtime-rule-toggle');
  assert.equal(newRuleBody.hidden, false);
  assert.equal(toggle.textContent, '收起设置');

  toggle.listeners.click();
  assert.equal(newRuleBody.hidden, true);
  assert.equal(toggle.textContent, '展开设置');
  const guardQuantityOptions = findAllByDataset(row, 'ruleQuantityMode');
  assert.equal(guardQuantityOptions.find(option => option.value === 'item').checked, true);
  assert.equal(guardQuantityOptions.find(option => option.value === 'group').checked, false);

  editor.renderRules([{
    giftId: '33988',
    giftName: '人气票',
    mode: 'fixed',
    enabled: true,
    fixedEffect: { operation: 'add', value: 300 }
  }]);
  const savedRuleBody = findByClass(root.children[0], 'overtime-rule-body');
  const summary = findByClass(root.children[0], 'overtime-rule-summary');
  assert.equal(savedRuleBody.hidden, true);
  assert.equal(summary.textContent, '增加 5 分钟 · 按连击组');
  const savedQuantityOptions = findAllByDataset(root.children[0], 'ruleQuantityMode');
  assert.equal(savedQuantityOptions.find(option => option.value === 'group').checked, true);
});
