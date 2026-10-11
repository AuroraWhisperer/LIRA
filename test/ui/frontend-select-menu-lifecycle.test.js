'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');

async function createFixture() {
  class Element {
    constructor(tag = 'div') {
      this.tagName = tag.toUpperCase();
      this.nodeType = 1;
      this.children = [];
      this.dataset = {};
      this.style = {};
      if (tag === 'input') this.value = '';
      this.attributes = new Map();
      this.listeners = new Map();
      this.classList = { add() {}, remove() {}, toggle() {} };
    }
    get isConnected() { return this === document.body || !!this.parentNode?.isConnected; }
    get elements() { return this.querySelectorAll('select'); }
    append(...nodes) {
      for (const node of nodes) {
        node.remove();
        this.children.push(node);
        node.parentNode = this;
      }
    }
    insertBefore(node, reference) {
      node.remove();
      this.children.splice(this.children.indexOf(reference), 0, node);
      node.parentNode = this;
    }
    remove() {
      if (this.parentNode) this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1);
      this.parentNode = null;
    }
    replaceChildren() { for (const node of [...this.children]) node.remove(); }
    querySelectorAll(selector) {
      const matches = (child) => {
        if (selector === 'select') return child.tagName === 'SELECT';
        if (selector.startsWith('[role="option"]')) return child.getAttribute('role') === 'option'
          && (!selector.includes(':not') || child.getAttribute('aria-disabled') !== 'true');
        if (selector === '[role="group"]') return child.getAttribute('role') === 'group';
        return false;
      };
      return this.children.flatMap((child) => [
        ...(matches(child) ? [child] : []),
        ...child.querySelectorAll(selector),
      ]);
    }
    setAttribute(name, value) { this.attributes.set(name, value); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    hasAttribute(name) { return this.attributes.has(name); }
    removeAttribute(name) { this.attributes.delete(name); }
    contains(node) { return this === node || this.children.some(child => child.contains(node)); }
    focus() { document.activeElement = this; }
    getBoundingClientRect() { return { top: 0, bottom: 20, height: 20 }; }
    closest() { return null; }
    addEventListener(type, callback) {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set());
      this.listeners.get(type).add(callback);
    }
    removeEventListener(type, callback) { this.listeners.get(type)?.delete(callback); }
    dispatchEvent(event) { this.listeners.get(event.type)?.forEach((callback) => callback(event)); }
  }
  class Select extends Element {
    constructor() {
      super('select');
      this.options = [];
      this.labels = [];
      this._selectedIndex = -1;
    }
    get form() {
      for (let node = this.parentNode; node; node = node.parentNode) {
        if (node.tagName === 'FORM') return node;
      }
      return null;
    }
    get value() { return this.options[this._selectedIndex]?.value || ''; }
    set value(value) { this._selectedIndex = this.options.findIndex((option) => option.value === value); }
    get selectedIndex() { return this._selectedIndex; }
    set selectedIndex(value) { this._selectedIndex = value; }
  }
  const observers = [];
  class Observer {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe(target) { this.target = target; }
    disconnect() { this.target = null; }
  }
  const document = new Element('document');
  document.body = new Element('body');
  document.createElement = (tag) => new Element(tag);
  const form = new Element('form');
  document.body.append(form);
  const timers = [];
  const { enhanceSelects } = await loadModuleExports(path.resolve('public/js/shared/select-menu.js'), {
    document, window: { innerHeight: 600 }, HTMLSelectElement: Select, MutationObserver: Observer,
    Node: { ELEMENT_NODE: 1 }, setTimeout(callback) { timers.push(callback); },
    Event: class { constructor(type) { this.type = type; } },
  });
  const deliver = (removedNodes = [], addedNodes = []) => observers[0].callback([{ removedNodes, addedNodes }]);
  const flushTimers = () => { while (timers.length) timers.shift()(); };
  return { document, form, Select, observers, enhanceSelects, deliver, flushTimers };
}

test('select blur waits for the next focused element and closes only outside its wrapper', async () => {
  const f = await createFixture();
  const select = new f.Select();
  f.form.append(select);
  f.enhanceSelects(select);
  const [, trigger, menu] = select.parentNode.children;
  const fire = (node, type) => node.listeners.get(type).forEach(callback => callback());
  fire(trigger, 'click');
  assert.equal(menu.hidden, false);
  f.document.body.focus();
  fire(menu, 'focusout');
  assert.equal(menu.hidden, false, 'blur must wait for the next focus target');
  trigger.focus();
  f.flushTimers();
  assert.equal(menu.hidden, false, 'focus inside the wrapper keeps the menu open');
  assert.equal(trigger.getAttribute('aria-expanded'), 'true');
  const outside = f.document.createElement('button');
  f.document.body.append(outside);
  outside.focus();
  fire(menu, 'focusout');
  f.flushTimers();
  assert.equal(menu.hidden, true);
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  assert.equal(f.document.activeElement, outside, 'closing must not steal focus back');
});

test('searchable font selects filter groups without changing selection and support text editing and keyboard choice', async () => {
  const f = await createFixture();
  const select = new f.Select();
  select.setAttribute('data-select-search', '');
  select.setAttribute('data-select-font-preview', '');
  const group = f.document.createElement('optgroup');
  group.label = '内置字体';
  for (const [value, name] of [['maiyuan', '荆南麦圆'], ['smiley', '得意黑']]) {
    const option = f.document.createElement('option');
    option.value = value;
    option.textContent = name;
    option.dataset.fontFamily = `"${name}"`;
    group.append(option);
    select.options.push(option);
  }
  select.append(group);
  select.selectedIndex = 0;
  f.form.append(select);
  f.enhanceSelects(select);
  const [, trigger, menu] = select.parentNode.children;
  const [search, list, empty] = menu.children;
  const fire = (node, type, extra = {}) => node.dispatchEvent({ type, target: node, preventDefault() {}, ...extra });
  fire(trigger, 'click');
  assert.equal(f.document.activeElement, search);
  assert.equal(list.getAttribute('role'), 'listbox');
  assert.equal(menu.getAttribute('role'), null, 'search input stays outside the listbox');
  search.value = '得意';
  fire(search, 'input');
  const options = list.querySelectorAll('[role="option"]');
  assert.equal(options[0].hidden, true);
  assert.equal(options[1].hidden, false);
  assert.equal(options[1].style.fontFamily, '"得意黑"');
  assert.equal(select.value, 'maiyuan', 'filtering preserves the saved selection');
  fire(menu, 'keydown', { target: search, key: ' ' });
  fire(menu, 'keydown', { target: search, key: 'Home' });
  assert.equal(f.document.activeElement, search, 'space and caret keys stay in the input');
  search.value = 'missing';
  fire(search, 'input');
  assert.equal(empty.hidden, false);
  assert.equal(list.children[0].hidden, true);
  search.value = '得意';
  fire(search, 'input');
  fire(menu, 'keydown', { target: search, key: 'ArrowDown' });
  assert.equal(f.document.activeElement, options[1]);
  fire(menu, 'keydown', { target: options[1], key: 'Enter' });
  assert.equal(select.value, 'smiley');
  assert.equal(menu.hidden, true);
  assert.equal(f.document.activeElement, trigger);
});

test('removing repeated dynamic selects releases observers and does not accumulate external listeners', async () => {
  const f = await createFixture();
  for (let index = 0; index < 100; index += 1) {
    const select = new f.Select();
    f.form.append(select);
    f.enhanceSelects(select);
    const wrapper = select.parentNode;
    wrapper.remove();
    f.deliver([wrapper]);
  }
  assert.equal(f.form.children.length, 0);
  assert.ok((f.document.listeners.get('pointerdown')?.size || 0) <= 1);
  assert.ok((f.form.listeners.get('reset')?.size || 0) <= 1);
  assert.equal(f.observers.filter((observer) => observer.target).length, 1);
});

test('moving or reinserting a select preserves one wrapper and restores option observation', async () => {
  const f = await createFixture();
  const select = new f.Select();
  f.form.append(select);
  f.enhanceSelects(select);
  const wrapper = select.parentNode;
  const observer = f.observers.find((item) => item.target === select);
  f.deliver([select], [wrapper]);
  assert.equal(observer.target, select, 'wrapping is a connected move');
  f.document.body.append(wrapper);
  f.deliver([wrapper], [wrapper]);
  assert.equal(observer.target, select);
  wrapper.remove();
  f.deliver([wrapper]);
  assert.equal(observer.target, null);
  f.form.append(wrapper);
  f.deliver([], [wrapper]);
  f.enhanceSelects(select);
  assert.equal(observer.target, select);
  assert.equal(select.parentNode, wrapper);
  assert.equal(wrapper.children.length, 3);
  assert.equal(f.observers.length, 2);
});
