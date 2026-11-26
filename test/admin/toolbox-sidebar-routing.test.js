'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createToolboxRuntime } = require('../helpers/toolbox-runtime');
const { loadModuleExports } = require('../helpers/frontend-modules');

const SELECTION_MOTION_PATH = path.join(__dirname, '../../public/js/admin/toolbox-selection-motion.js');

test('toolbox navigation and feature capabilities work without the legacy registry', async () => {
  const runtime = await createToolboxRuntime();
  runtime.sandbox.window.AdminApp = {};
  const navigation = [];
  const reconnects = [];
  let aiInits = 0;
  let aiRefreshes = 0;
  let navigate;
  const querySelectorAll = runtime.root.querySelectorAll;
  runtime.root.querySelectorAll = (selector) =>
    selector === '[data-main-page-link]'
      ? [
          {
            dataset: { mainPageLink: 'songAssistantPage', songTabTarget: 'settingsPage' },
            addEventListener: (_type, handler) => {
              navigate = handler;
            },
          },
        ]
      : querySelectorAll(selector);
  const reconnectBilibili = () => {};
  runtime.sandbox.document.querySelector = (selector) => {
    assert.equal(selector, '[data-tab="settingsPage"]');
    return { click: () => navigation.push('settingsPage') };
  };
  runtime.other.initOtherPage({
    reconnectBilibili,
    onNavigate: (page) => navigation.push(page),
    danmakuTool: {
      init: (options) => assert.equal(options.reconnectBilibili, reconnectBilibili),
      refresh: (options) => reconnects.push(options.reconnectIfDisconnected),
    },
    aiAssistantSettings: {
      init: () => aiInits++,
      refresh: () => aiRefreshes++,
    },
  });
  navigate();
  runtime.other.selectFeatureById('otherDanmakuFeature');
  assert.deepEqual(navigation, ['songAssistantPage', 'settingsPage']);
  assert.deepEqual(reconnects, [true]);
  assert.equal(aiInits, 1);
  assert.equal(aiRefreshes, 1);
});

test('explicit toolbox feature selection reopens and persists its collapsed group', async () => {
  const persisted = [];
  const runtime = await createToolboxRuntime({
    initialStorage: { 'admin.toolboxCollapsedFeatureGroups': '["live-scene"]' },
  });
  runtime.other.initOtherPage({
    persistCollapsedFeatureGroups: (groupIds) => persisted.push([...groupIds]),
  });
  runtime.dispatchWindowEvent('app:settings-state', {
    toolboxCollapsedFeatureGroups: '["live-scene"]',
  });

  runtime.other.selectFeature(runtime.root, 'otherClockFeature');

  assert.deepEqual(persisted, [[]]);
});

test('selection motion cleans up transient SVG sweep overlays on completion, retargeting, and reduced motion', async () => {
  let reducedMotion = false;
  let tourActive = false;
  const scheduled = [];

  function makeAnim() {
    let resolveFinished;
    const finished = new Promise((resolve) => {
      resolveFinished = resolve;
    });
    const animation = {
      cancelled: false,
      onfinish: null,
      oncancel: null,
      finished,
      cancel() {
        if (this.cancelled) return;
        this.cancelled = true;
        resolveFinished();
        this.oncancel?.();
      },
      finish() {
        resolveFinished();
        this.onfinish?.();
      },
    };
    scheduled.push(animation);
    return animation;
  }

  function makeButton(id, top, colorRef) {
    const classes = new Set();
    const iconClasses = new Set();
    const children = [];
    const svg = {
      style: {},
      classList: { add() {}, remove() {} },
      setAttribute() {},
      querySelectorAll: () => [],
      animate: () => makeAnim(),
      cloneNode() {
        const clone = {
          style: {},
          removed: false,
          classList: { add() {}, remove() {} },
          setAttribute() {},
          querySelectorAll: () => [],
          animate: () => makeAnim(),
          remove() {
            this.removed = true;
            const index = children.indexOf(clone);
            if (index >= 0) children.splice(index, 1);
          },
        };
        return clone;
      },
    };
    children.push(svg);
    const icon = {
      style: {},
      children,
      classList: {
        add: (name) => iconClasses.add(name),
        remove: (name) => iconClasses.delete(name),
        contains: (name) => iconClasses.has(name),
      },
      querySelector: () => svg,
      appendChild: (node) => children.push(node),
      animate: () => makeAnim(),
    };
    return {
      id,
      icon,
      svg,
      colorRef,
      classList: {
        add: (name) => classes.add(name),
        remove: (name) => classes.delete(name),
        contains: (name) => classes.has(name),
        toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)),
      },
      getAttribute: (name) => (name === 'aria-selected' ? String(classes.has('active')) : null),
      getBoundingClientRect: () => ({ top, height: 56 }),
      querySelector: (sel) => (sel === '.other-feature-icon' ? icon : null),
    };
  }

  const buttonA = makeButton('a', 100, { active: 'rgb(133, 46, 82)', idle: 'rgb(96, 70, 80)' });
  const buttonB = makeButton('b', 220, { active: 'rgb(133, 46, 82)', idle: 'rgb(96, 70, 80)' });
  const buttonC = makeButton('c', 340, { active: 'rgb(133, 46, 82)', idle: 'rgb(96, 70, 80)' });
  const buttons = [buttonA, buttonB, buttonC];
  buttonA.classList.add('active');

  let indicatorTop = 100;
  const indicator = {
    getBoundingClientRect: () => ({ top: indicatorTop, height: 56 }),
    getAnimations: () => [],
    animate: () => makeAnim(),
  };
  const root = {
    querySelector(selector) {
      if (selector === '.other-feature-indicator') return indicator;
      if (selector === '.other-feature-button.active') return buttons.find((b) => b.classList.contains('active')) || null;
      return null;
    },
  };

  const { createSelectionMotion } = await loadModuleExports(SELECTION_MOTION_PATH, {
    document: { documentElement: { classList: { contains: (name) => name === 'lira-tour-active' && tourActive } } },
    window: {
      matchMedia: () => ({ matches: reducedMotion }),
      getComputedStyle(element) {
        const owner = buttons.find((b) => b.icon === element);
        return { color: owner.classList.contains('active') ? owner.colorRef.active : owner.colorRef.idle };
      },
    },
  });

  const motion = createSelectionMotion();
  const apply = (target) => {
    buttons.forEach((b) => b.classList.toggle('active', b === target));
    indicatorTop = target.getBoundingClientRect().top;
  };

  // Switch A -> B: both icons receive transient overlays during the sweep.
  assert.equal(motion.transition(root, buttonB, () => apply(buttonB)), true);
  assert.equal(buttonA.icon.children.length, 2);
  assert.equal(buttonB.icon.children.length, 2);
  assert.equal(buttonB.icon.classList.contains('is-color-sweeping'), true);

  // Mid-flight retarget B -> C cleans up B's transient sweep without leaving stale overlays.
  indicatorTop = 160;
  assert.equal(motion.transition(root, buttonC, () => apply(buttonC)), true);
  assert.equal(buttonB.icon.children.length, 1);
  assert.equal(buttonB.icon.classList.contains('is-color-sweeping'), false);
  assert.equal(buttonC.icon.children.length, 2);

  // Completing all scheduled animations restores clean resting DOM state.
  scheduled.forEach((anim) => anim.finish());
  await new Promise((resolve) => setImmediate(resolve));
  for (const button of buttons) {
    assert.equal(button.icon.children.length, 1);
    assert.equal(button.icon.classList.contains('is-color-sweeping'), false);
    assert.equal(button.svg.style.maskImage, '');
  }

  // Reduced motion and interactive tour apply selection immediately without creating overlays.
  const countBefore = scheduled.length;
  reducedMotion = true;
  assert.equal(motion.transition(root, buttonA, () => apply(buttonA)), false);
  assert.equal(scheduled.length, countBefore);
  assert.equal(buttonA.classList.contains('active'), true);

  reducedMotion = false;
  tourActive = true;
  assert.equal(motion.transition(root, buttonB, () => apply(buttonB)), false);
  assert.equal(scheduled.length, countBefore);
  assert.equal(buttonB.classList.contains('active'), true);
});

test('interactive toolbox click defers panel mount by one frame when animated while programmatic selection stays synchronous', async () => {
  const runtime = await createToolboxRuntime();
  const frames = new Map();
  let nextFrameId = 1;
  runtime.sandbox.window.requestAnimationFrame = (cb) => {
    const id = nextFrameId++;
    frames.set(id, cb);
    return id;
  };
  runtime.sandbox.window.cancelAnimationFrame = (id) => {
    frames.delete(id);
  };
  let indicatorTop = 580;
  const indicator = {
    getBoundingClientRect: () => ({ top: indicatorTop, height: 56 }),
    getAnimations: () => [],
    animate: () => ({ cancel() {}, onfinish: null, oncancel: null }),
  };
  const buttons = runtime.root.querySelectorAll('[data-other-feature]');
  buttons.forEach((button, index) => {
    button.getBoundingClientRect = () => ({ top: 100 + index * 60, height: 56 });
  });
  const baseQuerySelector = runtime.root.querySelector;
  runtime.root.querySelector = (selector) => {
    if (selector === '.other-feature-indicator') return indicator;
    if (selector === '.other-feature-button.active') return buttons.find((b) => b.classList.contains('active')) || null;
    return baseQuerySelector(selector);
  };

  const selectedEvents = [];
  runtime.other.initOtherPage({
    onFeatureSelected: (featureId) => selectedEvents.push(featureId),
  });
  selectedEvents.length = 0;

  const danmakuBtn = buttons.find((b) => b.dataset.otherFeature === 'otherDanmakuFeature');
  const gamesBtn = buttons.find((b) => b.dataset.otherFeature === 'otherGamesFeature');
  const danmakuPanel = runtime.root.querySelectorAll('[data-other-feature-panel]').find((p) => p.id === 'otherDanmakuFeature');
  const gamesPanel = runtime.root.querySelectorAll('[data-other-feature-panel]').find((p) => p.id === 'otherGamesFeature');

  // Rapid clicks: first click defers panel mount; second click cancels the first before frame 1.
  danmakuBtn.dispatch('click');
  assert.equal(danmakuBtn.classList.contains('active'), true);
  assert.equal(danmakuPanel.hidden, true);
  assert.deepEqual(selectedEvents, []);

  gamesBtn.dispatch('click');
  assert.equal(frames.size, 1);
  [...frames.values()].forEach((cb) => cb());
  frames.clear();
  assert.equal(danmakuPanel.hidden, true);
  assert.equal(gamesPanel.hidden, false);
  assert.deepEqual(selectedEvents, ['otherGamesFeature']);

  // Programmatic selection applies immediately without deferring.
  runtime.other.selectFeatureById('otherDanmakuFeature');
  assert.equal(danmakuPanel.hidden, false);
  assert.equal(gamesPanel.hidden, true);
  assert.deepEqual(selectedEvents, ['otherGamesFeature', 'otherDanmakuFeature']);
});
