'use strict';

const COLOR_INPUT = 'input[type="color"]';
const enhancedColors = new WeakMap();
let observerInstalled = false;

function syncColorValue(input) {
  const value = enhancedColors.get(input);
  if (!value) return;
  const text = input.value.toUpperCase();
  if (value.textContent !== text) value.textContent = text;
}

function enhanceColor(input) {
  if (enhancedColors.has(input)) return;
  const document = input.ownerDocument;
  let wrapper = input.parentElement;
  if (!wrapper.classList.contains('lira-color-control')) {
    wrapper = document.createElement('span');
    wrapper.className = 'lira-color-control';
    input.before(wrapper);
    wrapper.append(input);
  }
  // A cloned settings panel already has the visual wrapper, but needs its own binding.
  let value = wrapper.querySelector('.lira-color-value');
  if (!value) {
    value = document.createElement('span');
    value.className = 'lira-color-value';
    value.setAttribute('aria-hidden', 'true');
    wrapper.append(value);
  }
  enhancedColors.set(input, value);
  const nativeValue = Object.getOwnPropertyDescriptor(document.defaultView.HTMLInputElement.prototype, 'value');
  Object.defineProperty(input, 'value', {
    configurable: true,
    get() { return nativeValue.get.call(this); },
    set(nextValue) {
      nativeValue.set.call(this, nextValue);
      syncColorValue(this);
    },
  });
  input.addEventListener('input', () => syncColorValue(input));
  input.addEventListener('change', () => syncColorValue(input));
  syncColorValue(input);
}

function installColorObserver() {
  if (observerInstalled || !document.body || typeof MutationObserver === 'undefined') return;
  observerInstalled = true;
  document.addEventListener('reset', (event) => {
    const form = event.target;
    setTimeout(() => form.querySelectorAll(COLOR_INPUT).forEach(syncColorValue), 0);
  }, true);
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'attributes') {
        syncColorValue(record.target);
        continue;
      }
      for (const node of record.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE && node.isConnected) enhanceColorControls(node);
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['value'] });
}

/** Enhance native color inputs in place, including later additions and cloned panels. */
export function enhanceColorControls(root = document) {
  installColorObserver();
  const inputs = [];
  if (root.matches?.(COLOR_INPUT)) inputs.push(root);
  inputs.push(...root.querySelectorAll(COLOR_INPUT));
  inputs.forEach(enhanceColor);
  return inputs.length;
}
