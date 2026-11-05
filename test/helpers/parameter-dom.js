'use strict';

const { FakeNode } = require('./fake-dom');

// Event/value tree for parameter integration tests. Real controls, focus, layout and
// color widgets are covered by danmaku-panel-edit-state in a browser.
function createParameterDocument() {
  const nodes = new Map();
  const document = { activeElement: null, querySelector: () => null, querySelectorAll: () => [] };
  document.createElement = (tag) => {
    const node = new FakeNode(tag);
    node.ownerDocument = document;
    node.events = node.listeners;
    node.value = '';
    node.disabled = false;
    node.hidden = false;
    node.clientWidth = 1000;
    node.clientHeight = 800;
    node.querySelector = selector => {
      const key = { 'optgroup[data-shared-fonts]': 'sharedFonts', 'optgroup[data-local-fonts="true"]': 'localFonts',
        'optgroup[data-saved-fonts]': 'savedFonts' }[selector];
      return key ? node.children.find(child => child.tagName === 'OPTGROUP' && child.dataset[key] === 'true') || null : null;
    };
    node.querySelectorAll = () => [];
    node.closest = () => null;
    node.matches = () => false;
    node.removeEventListener = (name, handler) => { if (node.events[name] === handler) delete node.events[name]; };
    node.checkValidity = node.reportValidity = () => true;
    node.appendChild = child => { node.append(child); return child; };
    node.insertBefore = (child, reference) => {
      child.detach();
      child.parent = node;
      node.children.splice(reference ? node.children.indexOf(reference) : node.children.length, 0, child);
      return child;
    };
    node.classList.toggle = (name, force) => { node.classList[force ? 'add' : 'remove'](name); };
    let id = '';
    Object.defineProperty(node, 'id', { get: () => id, set(value) { if (id) nodes.delete(id); id = value; if (id) nodes.set(id, node); } });
    Object.defineProperty(node, 'options', { get: () => node.children.flatMap(child => child.tagName === 'OPTGROUP' ? child.children : [child]) });
    return node;
  };
  document.createTextNode = text => { const node = document.createElement('#text'); node.textContent = text; return node; };
  document.getElementById = id => {
    if (!nodes.has(id)) { const node = document.createElement('div'); node.id = id; }
    return nodes.get(id);
  };
  document.head = document.createElement('head');
  document.body = document.createElement('body');
  document.documentElement = document.createElement('html');
  return document;
}

module.exports = { createParameterDocument };
