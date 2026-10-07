'use strict';

// Minimal element tree for renderer tests that build DOM through
// document.createElement. It records what the renderer set (text, dataset,
// attributes, style properties and listeners) without layout or HTML parsing,
// so textContent never interprets markup.
class FakeNode {
  constructor(tag = '') {
    this.tag = tag;
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.listeners = {};
    this.className = '';
    this.textContent = '';
    this.parent = null;
    this.style = {
      setProperty(name, value) {
        this[name] = value;
      },
    };
  }

  detach() {
    if (this.parent) this.parent.children = this.parent.children.filter((node) => node !== this);
    this.parent = null;
  }

  append(...nodes) {
    for (const node of nodes) {
      if (node.isFragment) {
        this.append(...node.children);
        continue;
      }
      node.detach();
      node.parent = this;
      this.children.push(node);
    }
  }

  replaceChildren(...nodes) {
    for (const node of this.children) node.parent = null;
    this.children = [];
    this.append(...nodes);
  }

  replaceWith(node) {
    const parent = this.parent;
    if (!parent) return;
    const index = parent.children.indexOf(this);
    node.detach();
    node.parent = parent;
    parent.children.splice(index, 1, node);
    this.parent = null;
  }

  remove() {
    this.detach();
    this.removed = true;
  }

  removeChild(node) {
    if (node.parent !== this) throw new Error('Not a child of this node');
    node.detach();
    return node;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
    this[name] = value;
  }

  addEventListener(name, listener) {
    this.listeners[name] = listener;
  }

  querySelector(selector) {
    if (!selector.startsWith('.')) throw new Error(`Unsupported selector ${selector}`);
    return findByClass(this, selector.slice(1));
  }
}

function allNodes(root) {
  return [root, ...root.children.flatMap(allNodes)];
}

function hasClass(node, className) {
  return String(node.className || '')
    .split(' ')
    .includes(className);
}

function findByClass(root, className) {
  return allNodes(root).find((node) => hasClass(node, className));
}

function findAllByClass(root, className) {
  return allNodes(root).filter((node) => hasClass(node, className));
}

function createFakeDocument() {
  return {
    createElement: (tag) => new FakeNode(tag),
    createDocumentFragment: () => Object.assign(new FakeNode(), { isFragment: true }),
  };
}

module.exports = { FakeNode, allNodes, createFakeDocument, findAllByClass, findByClass };
