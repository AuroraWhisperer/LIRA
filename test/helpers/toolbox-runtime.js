'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT_DIR = path.resolve(__dirname, '..', '..');

function createToolboxRuntime({ initialStorage = {} } = {}) {
  function createNode({ dataset = {}, id = '', textContent = '' } = {}) {
    const attributes = new Map();
    const listeners = new Map();
    const classes = new Set();
    const node = {
      dataset,
      id,
      textContent,
      hidden: false,
      disabled: false,
      tabIndex: 0,
      nextElementSibling: null,
      classList: {
        contains(name) {
          return classes.has(name);
        },
        toggle(name, enabled) {
          if (enabled) classes.add(name);
          else classes.delete(name);
        },
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
      querySelector(selector) {
        if (selector === 'strong' && textContent) return { textContent };
        if (
          selector === '.other-feature-label strong' &&
          dataset.otherFeature
        ) {
          return { textContent: dataset.otherFeature };
        }
        return null;
      },
      addEventListener(type, handler) {
        const handlers = listeners.get(type) || [];
        handlers.push(handler);
        listeners.set(type, handlers);
      },
      dispatch(type, event = {}) {
        (listeners.get(type) || []).forEach((handler) => handler(event));
      },
      focus() {},
    };
    return node;
  }

  const groups = [
    [
      'live-interaction',
      ['otherDanmakuFeature', 'otherGiftFeature', 'otherGamesFeature'],
    ],
    [
      'live-scene',
      [
        'otherOvertimeMachineFeature',
        'otherGiftEffectsFeature',
        'otherStartAnimationFeature',
        'otherClockFeature',
      ],
    ],
    ['streamer-work', ['otherDailyTodoFeature']],
    [
      'software-help',
      [
        'otherPerformanceFeature',
        'otherUsageGuideFeature',
        'otherDesktopUpdateFeature',
      ],
    ],
  ];
  const headings = [];
  const buttons = [];
  const panels = [];
  const orderedNodes = [];

  groups.forEach(([groupId, featureIds]) => {
    const heading = createNode({
      dataset: { otherFeatureGroup: groupId },
      textContent: groupId,
    });
    heading.setAttribute('aria-expanded', 'true');
    heading.querySelector = (selector) =>
      selector === 'strong' ? { textContent: groupId } : null;
    headings.push(heading);
    orderedNodes.push(heading);
    featureIds.forEach((featureId) => {
      const button = createNode({ dataset: { otherFeature: featureId } });
      button.querySelector = (selector) =>
        selector === '.other-feature-label strong'
          ? { textContent: featureId }
          : null;
      button.setAttribute(
        'aria-selected',
        featureId === 'otherPerformanceFeature' ? 'true' : 'false',
      );
      if (featureId === 'otherDesktopUpdateFeature') button.hidden = true;
      buttons.push(button);
      panels.push(createNode({ id: featureId }));
      orderedNodes.push(button);
    });
  });
  orderedNodes.forEach((node, index) => {
    node.nextElementSibling = orderedNodes[index + 1] || null;
  });

  const sidebarToggle = createNode();
  const rootClasses = new Set();
  const root = {
    classList: {
      contains(name) {
        return rootClasses.has(name);
      },
      toggle(name, enabled) {
        if (enabled) rootClasses.add(name);
        else rootClasses.delete(name);
      },
    },
    querySelector(selector) {
      return selector === '[data-other-sidebar-toggle]' ? sidebarToggle : null;
    },
    querySelectorAll(selector) {
      if (selector === '[data-other-feature]') return buttons;
      if (selector === '[data-other-feature-panel]') return panels;
      if (selector === '[data-other-feature-group]') return headings;
      if (selector === '[data-main-page-link]') return [];
      return [];
    },
  };
  const stored = new Map(Object.entries(initialStorage));
  const windowListeners = new Map();
  const sandbox = {
    console,
    document: {
      getElementById() {
        return root;
      },
    },
    window: {
      AdminApp: {},
      addEventListener(type, handler) {
        const handlers = windowListeners.get(type) || [];
        handlers.push(handler);
        windowListeners.set(type, handlers);
      },
      localStorage: {
        getItem(key) {
          return stored.get(key) || null;
        },
        setItem(key, value) {
          stored.set(key, value);
        },
      },
    },
  };
  vm.runInNewContext(
    fs.readFileSync(
      path.join(ROOT_DIR, 'public', 'js', 'admin', 'other.js'),
      'utf8',
    ),
    sandbox,
  );
  return {
    sandbox,
    root,
    headings,
    buttons,
    panels,
    sidebarToggle,
    stored,
    dispatchWindowEvent(type, detail) {
      (windowListeners.get(type) || []).forEach((handler) =>
        handler({ detail }),
      );
    },
  };
}

module.exports = { createToolboxRuntime };
