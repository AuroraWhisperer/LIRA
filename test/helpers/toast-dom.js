'use strict';

function createDom() {
  const windowListeners = new Map();
  const documentRef = { activeElement: null };
  function createNode(tagName) {
    const attributes = new Map();
    const listeners = new Map();
    let text = '';
    let html = '';
    const node = {
      tagName,
      children: [],
      attributes,
      listeners,
      style: {},
      className: '',
      hidden: false,
      parentNode: null,
      ownerDocument: documentRef,
      get isConnected() {
        return this === documentRef.body || Boolean(this.parentNode?.isConnected);
      },
      get parentElement() {
        return this.parentNode;
      },
      get textContent() {
        return text + this.children.map((child) => child.textContent).join('');
      },
      set textContent(value) {
        text = String(value);
        html = '';
        this.replaceChildren();
      },
      get innerHTML() {
        return html || text;
      },
      set innerHTML(value) {
        html = String(value);
        text = html.replace(/<[^>]*>/g, '');
        this.replaceChildren();
      },
      setAttribute(name, value) {
        attributes.set(name, String(value));
      },
      getAttribute(name) {
        return attributes.get(name) ?? null;
      },
      removeAttribute(name) {
        attributes.delete(name);
      },
      append(...children) {
        children.forEach((child) => {
          child.remove();
          child.parentNode = this;
          this.children.push(child);
        });
      },
      appendChild(child) {
        this.append(child);
        return child;
      },
      prepend(child) {
        child.remove();
        child.parentNode = this;
        this.children.unshift(child);
      },
      after(child) {
        child.remove();
        child.parentNode = this.parentNode;
        this.parentNode.children.splice(this.parentNode.children.indexOf(this) + 1, 0, child);
      },
      replaceChildren(...children) {
        this.children.forEach((child) => {
          child.parentNode = null;
        });
        this.children = [];
        this.append(...children);
      },
      remove() {
        if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
        this.parentNode = null;
      },
      contains(child) {
        return child === this || this.children.some((item) => item.contains(child));
      },
      addEventListener(type, listener) {
        listeners.set(type, listener);
      },
      fire(type, event = {}) {
        return listeners.get(type)?.(event);
      },
      focus() {
        const old = documentRef.activeElement;
        documentRef.activeElement = this;
        for (let node = old; node; node = node.parentNode) node.fire('focusout', { relatedTarget: this });
        for (let node = this; node; node = node.parentNode) node.fire('focusin', {});
      },
      blur() {
        documentRef.activeElement = null;
      },
      getBoundingClientRect() {
        const siblings = [...(this.parentNode?.children || [])].sort(
          (a, b) => Number(a.style.order || 0) - Number(b.style.order || 0),
        );
        const before = siblings.slice(0, siblings.indexOf(this)).filter((node) => !node.hidden && !node.style.position);
        const top = this === container ? 70 : 70 + before.reduce((sum, node) => sum + (node.height || 76) + 10, 0);
        return { top, height: this.height || 76, bottom: top + (this.height || 76) };
      },
    };
    node.classList = {
      add(...names) {
        node.className = [...new Set([...node.className.split(' '), ...names])].join(' ');
      },
      remove(...names) {
        node.className = node.className
          .split(' ')
          .filter((name) => !names.includes(name))
          .join(' ');
      },
      contains(name) {
        return node.className.split(' ').includes(name);
      },
    };
    return node;
  }
  documentRef.body = createNode('body');
  const container = createNode('div');
  documentRef.body.append(container);
  documentRef.createElement = createNode;
  documentRef.getElementById = (id) => (id === 'toast' ? container : null);
  const windowRef = {
    innerHeight: 900,
    matchMedia: () => ({ matches: false }),
    addEventListener(type, listener) {
      if (!windowListeners.has(type)) windowListeners.set(type, new Set());
      windowListeners.get(type).add(listener);
    },
    removeEventListener(type, listener) {
      windowListeners.get(type)?.delete(listener);
      if (!windowListeners.get(type)?.size) windowListeners.delete(type);
    },
  };
  return { container, documentRef, windowRef, windowListeners };
}

function createClock() {
  let time = 0;
  let nextId = 0;
  const timers = new Map();
  return {
    now: () => time,
    setTimeout(callback, delay) {
      const id = ++nextId;
      timers.set(id, { callback, at: time + delay });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    tick(ms) {
      const target = time + ms;
      for (;;) {
        const next = [...timers.entries()]
          .filter(([, timer]) => timer.at <= target)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        time = next[1].at;
        timers.delete(next[0]);
        next[1].callback();
      }
      time = target;
    },
  };
}

module.exports = { createDom, createClock };
