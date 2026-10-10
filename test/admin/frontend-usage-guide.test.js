'use strict';

const { readAdminHtml } = require('../helpers/admin-html');

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { readCssBundle } = require('../helpers/css-bundle');
const { loadModuleExports } = require('../helpers/frontend-modules');
const { createDom } = require('../helpers/toast-dom');

const ROOT_DIR = path.join(__dirname, '../..');

test('archive recovery instructions are indexed in the fan chapter by the existing guide search', async () => {
  const html = readAdminHtml();
  const faq = html.match(/<article\b(?=[^>]*\sid="ug-fan-archive")[^>]*>[\s\S]*?<\/article>/)?.[0];
  assert.ok(faq);
  assert.match(faq, /清空搜索和筛选/);
  assert.match(faq, /不适用于永久删除的档案/);
  assert.match(html, /归档期间不显示该档案的提醒/);
  assert.match(html, /归档与永久删除不同，不需要通过备份恢复/);
  const { documentRef } = createDom();
  const create = documentRef.createElement;
  documentRef.createElement = (tag) => {
    const node = create(tag);
    const append = node.append.bind(node);
    node.append = (...children) =>
      append(
        ...children.map((child) => {
          if (typeof child !== 'string') return child;
          const text = create('span');
          text.textContent = child;
          return text;
        }),
      );
    return node;
  };
  const target = {
    textContent: faq.replace(/<[^>]*>/g, ' '),
    matches: () => false,
    querySelector: () => ({ textContent: '6.1.2 归档与找回' }),
  };
  const section = {
    id: 'ug-work',
    children: [],
    querySelector: () => ({ textContent: '粉丝档案与工作台' }),
    querySelectorAll: () => [target],
  };
  const nodes = new Map(
    [
      '#usageGuideSearchInput',
      '.usage-guide-search-results',
      '.usage-guide-search-status',
      '.usage-guide-search-list',
      '.usage-guide-search-clear',
    ].map((selector) => [selector, documentRef.createElement('div')]),
  );
  const panel = { querySelector: (selector) => nodes.get(selector), querySelectorAll: () => [section] };
  const { initUsageGuideSearch } = await loadModuleExports(
    path.join(ROOT_DIR, 'public/js/admin/usage-guide-search.js'),
    { document: documentRef },
  );
  initUsageGuideSearch(panel, () => {});
  for (const query of ['收起', '归档', '恢复档案']) {
    const input = nodes.get('#usageGuideSearchInput');
    input.value = query;
    input.fire('input', {});
    assert.match(nodes.get('.usage-guide-search-status').textContent, /找到 1 处/);
    assert.match(nodes.get('.usage-guide-search-list').textContent, /归档与找回/);
  }
});

test('usage guide presents overlays for both live companion and OBS users', () => {
  const html = readAdminHtml();
  const guide = html.match(/<section\b(?=[^>]*\sid=["']ug-scene-guide["'])[^>]*>[\s\S]*?<\/section>/)?.[0];
  assert.ok(guide);
  for (const term of ['直播姬', 'OBS', '浏览器源']) assert.ok(guide.includes(term));
});

test('usage guide defers image loading and avoids sticky backdrop blur', () => {
  const html = readAdminHtml();
  const styles = readCssBundle('public', 'css', 'admin', 'toolbox.css');
  const images = html.match(/<img\b[^>]*class="usage-guide-image"[^>]*>/g) || [];
  const tocRule = styles.match(/\.usage-guide-toc\s*\{[\s\S]*?\n\}/)?.[0];

  assert.ok(images.length > 0, 'the guide should include illustrated instructions');
  assert.equal(
    images.every((image) => /loading="lazy"/.test(image)),
    true,
  );
  assert.equal(
    images.every((image) => /decoding="async"/.test(image)),
    true,
  );
  assert.equal(
    images.every((image) => /\bwidth="\d+"/.test(image) && /\bheight="\d+"/.test(image)),
    true,
  );
  assert.ok(tocRule, 'usage guide table of contents should remain defined');
  assert.doesNotMatch(tocRule, /white-space:\s*nowrap|overflow-x:\s*(?:auto|scroll)/);
  assert.doesNotMatch(tocRule, /backdrop-filter/);
});

test('usage guide names the AI assistant section without removing the DeepSeek anchor', () => {
  const html = readAdminHtml();

  assert.match(html, /<a\b(?=[^>]*\shref=["']#ug-deepseek["'])[^>]*>[^<]*AI[^<]*<\/a>/);
  assert.match(html, /<h4\b(?=[^>]*\sid=["']ug-deepseek["'])[^>]*>3\.3 AI 互动助手<\/h4>/);
});

function createUsageGuideFixture({
  flexDirection = 'row',
  tocTop = '8px',
  tocHeight = 72,
  scrollerTop = 0,
  scrollerPaddingTop = '0px',
  scrollerOverflowY = 'auto',
  sectionTops = [0, 200],
  scrollerHeight = 400,
  scrollerScrollHeight = 1000,
  scrollerScrollTop = 0,
} = {}) {
  const observers = [];
  const windowListeners = new Map();
  const timers = new Map();
  let nextTimerId = 1;
  let now = 0;
  const createClassList = () => {
    const names = new Set();
    return {
      add: (name) => names.add(name),
      remove: (name) => names.delete(name),
      contains: (name) => names.has(name),
      toggle(name, enabled) {
        if (enabled) names.add(name);
        else names.delete(name);
      },
    };
  };
  const createNode = () => {
    const attributes = new Map();
    return {
      classList: createClassList(),
      style: {
        setProperty(name, value) {
          this[name] = value;
        },
      },
      setAttribute: (name, value) => attributes.set(name, value),
      getAttribute: (name) => attributes.get(name),
      removeAttribute: (name) => attributes.delete(name),
      addEventListener(name, listener) {
        this[name] = listener;
      },
      focus() {
        document.activeElement = this;
      },
    };
  };
  const sections = sectionTops.map((_, index) => ({
    id: `usage-section-${index + 1}`,
    scrollCalls: 0,
    scrollIntoView() {
      this.scrollCalls += 1;
    },
    getBoundingClientRect: () => ({ top: sectionTops[index] }),
  }));
  const links = sections.map((section, index) => ({
    ...createNode(),
    hash: `#${section.id}`,
    textContent: ['快速上手', '账号与设备'][index],
  }));
  const backToTopButton = {
    hidden: true,
    addEventListener(name, listener) {
      this[name] = listener;
    },
  };
  const toc = {
    ...createNode(),
    flexDirection,
    height: tocHeight,
    reads: 0,
    getBoundingClientRect() {
      this.reads += 1;
      return { height: this.height, bottom: scrollerTop + this.height };
    },
    contains: (target) => target === toc || target === tocToggle || tocMenu.contains(target),
  };
  const tocToggle = createNode();
  const tocCurrent = createNode();
  const tocMenu = {
    ...createNode(),
    contains: (target) => target === tocMenu || links.includes(target),
    getBoundingClientRect: () => ({ height: 200 }),
  };
  const scrollerListeners = new Map();
  const scroller = {
    clientHeight: scrollerHeight,
    scrollHeight: scrollerScrollHeight,
    scrollTop: scrollerScrollTop,
    scrollTo({ top }) {
      this.scrollTop = top;
    },
    addEventListener: (name, listener) => scrollerListeners.set(name, listener),
    getBoundingClientRect: () => ({ top: scrollerTop, bottom: scrollerTop + scrollerHeight }),
  };
  const panel = {
    hidden: false,
    closest: () => ({}),
    classList: createClassList(),
    style: {
      setProperty(name, value) {
        this[name] = value;
      },
    },
    querySelector(selector) {
      if (selector === '.other-feature-panel-body') return scroller;
      if (selector === '.usage-guide-toc') return toc;
      if (selector === '.usage-guide-toc-toggle') return tocToggle;
      if (selector === '.usage-guide-toc-links') return tocMenu;
      if (selector === '.usage-guide-toc-current') return tocCurrent;
      if (selector === '.usage-guide-back-to-top') return backToTopButton;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === '[data-usage-guide-link]') return links;
      if (selector === '.usage-guide-section[id]') return sections;
      return [];
    },
  };
  const document = {
    activeElement: null,
    addEventListener(name, listener) {
      this[name] = listener;
    },
    documentElement: { scrollHeight: 2000 },
    getElementById: (id) =>
      id === 'otherUsageGuideFeature' ? panel : sections.find((section) => section.id === id) || null,
  };
  const window = {
    innerHeight: 600,
    scrollY: 0,
    matchMedia: () => ({ matches: false }),
    getComputedStyle: (element) =>
      element === toc
        ? { flexDirection: toc.flexDirection, top: tocTop }
        : { paddingTop: scrollerPaddingTop, overflowY: scrollerOverflowY },
    requestAnimationFrame: (callback) => callback(),
    setTimeout(callback, delay = 0) {
      const timerId = nextTimerId++;
      timers.set(timerId, { callback, at: now + delay });
      return timerId;
    },
    clearTimeout: (timerId) => timers.delete(timerId),
    addEventListener(name, listener) {
      windowListeners.set(name, listener);
    },
  };
  const ResizeObserver = class {
    constructor(callback) {
      observers.push(callback);
    }

    observe() {}
  };

  function advanceTime(milliseconds) {
    const until = now + milliseconds;
    while (timers.size) {
      const [id, timer] = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (timer.at > until) break;
      timers.delete(id);
      now = timer.at;
      timer.callback();
    }
    now = until;
  }

  return {
    document,
    panel,
    scroller,
    sections,
    backToTopButton,
    sectionTops,
    links,
    toc,
    tocToggle,
    tocMenu,
    tocCurrent,
    window,
    ResizeObserver,
    advanceTime,
    flushTimers() {
      advanceTime(Math.max(now, ...[...timers.values()].map((timer) => timer.at)) - now);
    },
    triggerResize: () => observers.at(-1)?.(),
    get scrollOffset() {
      return panel.style['--usage-guide-scroll-offset'];
    },
    triggerScrollerScroll() {
      scrollerListeners.get('scroll')?.();
    },
    triggerWindowScroll() {
      windowListeners.get('scroll')?.();
    },
  };
}

async function loadUsageGuide(fixture) {
  const { initUsageGuide } = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'usage-guide.js'),
    fixture,
  );
  initUsageGuide();
}

test('guide directory stays expanded at the top and collapses only after scrolling down', async () => {
  const fixture = createUsageGuideFixture();
  await loadUsageGuide(fixture);
  assert.equal(fixture.tocToggle.getAttribute('aria-expanded'), 'true');
  assert.equal(fixture.tocMenu.inert, false);
  assert.equal(fixture.panel.style['--usage-guide-toc-space'], '206px');

  fixture.toc.pointerleave({ pointerType: 'mouse' });
  fixture.document.pointerdown({ target: {} });
  fixture.advanceTime(1000);
  assert.equal(fixture.tocMenu.inert, false);

  fixture.links[1].click({ preventDefault() {} });
  assert.equal(fixture.sections[1].scrollCalls, 1);
  fixture.scroller.scrollTop = 24;
  fixture.triggerScrollerScroll();
  assert.equal(fixture.tocToggle.getAttribute('aria-expanded'), 'false');
  assert.equal(fixture.tocMenu.inert, true);
  assert.equal(fixture.toc.classList.contains('is-at-top'), false);

  fixture.backToTopButton.click();
  fixture.triggerScrollerScroll();
  assert.equal(fixture.tocToggle.getAttribute('aria-expanded'), 'true');
  assert.equal(fixture.tocMenu.inert, false);
  assert.equal(fixture.toc.classList.contains('is-at-top'), true);
});

test('compact guide directory ignores brief hover and opens after 200ms without changing the scroll offset', async () => {
  const fixture = createUsageGuideFixture({ tocHeight: 48, scrollerScrollTop: 24 });
  await loadUsageGuide(fixture);
  fixture.triggerResize();
  const mouse = { pointerType: 'mouse' };

  fixture.toc.pointerenter(mouse);
  fixture.advanceTime(199);
  assert.equal(fixture.tocToggle.getAttribute('aria-expanded'), 'false');
  fixture.toc.pointerleave(mouse);
  fixture.advanceTime(1000);
  assert.equal(fixture.tocMenu.inert, true);

  fixture.toc.pointerenter(mouse);
  fixture.advanceTime(200);
  assert.equal(fixture.tocToggle.getAttribute('aria-expanded'), 'true');
  assert.equal(fixture.tocMenu.inert, false);
  assert.equal(fixture.toc.style['--usage-guide-toc-max-height'], '340px');
  assert.equal(fixture.scrollOffset, '68px');
});

test('compact guide directory waits 300ms to close and cancels closure when the pointer returns', async () => {
  const fixture = createUsageGuideFixture({ scrollerScrollTop: 24 });
  await loadUsageGuide(fixture);
  const mouse = { pointerType: 'mouse' };
  fixture.toc.pointerenter(mouse);
  fixture.advanceTime(200);
  fixture.toc.pointerleave(mouse);
  fixture.advanceTime(299);
  assert.equal(fixture.tocMenu.inert, false);
  fixture.toc.pointerenter(mouse);
  fixture.advanceTime(1000);
  assert.equal(fixture.tocMenu.inert, false);
  fixture.toc.pointerleave(mouse);
  fixture.advanceTime(299);
  assert.equal(fixture.tocMenu.inert, false);
  fixture.advanceTime(1);
  assert.equal(fixture.tocMenu.inert, true);
  assert.equal(fixture.tocToggle.getAttribute('aria-expanded'), 'false');
});

test('compact guide directory supports touch and keyboard, keeps focused links open, and closes after selection', async () => {
  const fixture = createUsageGuideFixture({ scrollerScrollTop: 24 });
  await loadUsageGuide(fixture);
  fixture.toc.pointerenter({ pointerType: 'touch' });
  fixture.advanceTime(1000);
  assert.equal(fixture.tocMenu.inert, true);
  fixture.tocToggle.click();
  fixture.links[0].focus();
  fixture.toc.pointerleave({ pointerType: 'mouse' });
  fixture.advanceTime(1000);
  assert.equal(fixture.tocMenu.inert, false);
  fixture.toc.keydown({ key: 'Escape', preventDefault() {} });
  assert.equal(fixture.document.activeElement, fixture.tocToggle);
  assert.equal(fixture.tocMenu.inert, true);

  fixture.tocToggle.click();
  fixture.links[1].click({ preventDefault() {} });
  assert.equal(fixture.tocCurrent.textContent, '账号与设备');
  assert.equal(fixture.links[1].getAttribute('aria-current'), 'location');
  assert.equal(fixture.sections[1].scrollCalls, 1);
  assert.equal(fixture.tocMenu.inert, true);
});

test('switching to the existing sidebar directory exposes its links and resets the compact popup', async () => {
  const fixture = createUsageGuideFixture({ scrollerScrollTop: 24 });
  await loadUsageGuide(fixture);
  fixture.tocToggle.click();
  fixture.toc.flexDirection = 'column';
  fixture.triggerResize();
  assert.equal(fixture.tocMenu.inert, false);
  assert.equal(fixture.toc.classList.contains('is-open'), false);
  fixture.toc.pointerenter({ pointerType: 'mouse' });
  fixture.advanceTime(1000);
  assert.equal(fixture.toc.classList.contains('is-open'), false);

  fixture.toc.flexDirection = 'row';
  fixture.triggerResize();
  assert.equal(fixture.tocMenu.inert, true);
  fixture.tocToggle.click();
  fixture.document.pointerdown({ target: fixture.links[0] });
  assert.equal(fixture.tocMenu.inert, false);
  fixture.document.pointerdown({ target: {} });
  assert.equal(fixture.tocMenu.inert, true);
});

test('usage guide recalculates visible toc offset and skips hidden layout updates', async () => {
  const fixture = createUsageGuideFixture({ tocHeight: 72, tocTop: '8px' });
  await loadUsageGuide(fixture);

  fixture.triggerResize();
  assert.equal(fixture.scrollOffset, '92px');

  fixture.toc.height = 108;
  fixture.triggerResize();
  assert.equal(fixture.scrollOffset, '128px');

  const visibleReads = fixture.toc.reads;
  fixture.panel.hidden = true;
  fixture.toc.height = 180;
  fixture.triggerResize();
  assert.equal(fixture.scrollOffset, '128px');
  assert.equal(fixture.toc.reads, visibleReads);
});

test('usage guide horizontal toc includes padding only for its internal scroller', async () => {
  for (const [scrollerOverflowY, expectedOffset] of [
    ['auto', '110px'],
    ['visible', '92px'],
  ]) {
    const fixture = createUsageGuideFixture({
      scrollerPaddingTop: '18px',
      scrollerOverflowY,
      sectionTops: [0, 105],
    });
    await loadUsageGuide(fixture);

    fixture.triggerResize();
    assert.equal(fixture.scrollOffset, expectedOffset);
    assert.equal(fixture.links[1].classList.contains('active'), scrollerOverflowY === 'auto');
  }
});

test('usage guide keeps a compact offset for the vertical toc regardless of its height', async () => {
  const fixture = createUsageGuideFixture({
    flexDirection: 'column',
    tocHeight: 320,
    tocTop: '18px',
    scrollerPaddingTop: '18px',
  });
  await loadUsageGuide(fixture);

  fixture.triggerResize();
  assert.equal(fixture.scrollOffset, '24px');

  fixture.toc.height = 640;
  fixture.triggerResize();
  assert.equal(fixture.scrollOffset, '24px');
});

test('usage guide desktop active section follows a resized toc in the internal scroller', async () => {
  const fixture = createUsageGuideFixture({
    tocHeight: 40,
    tocTop: '8px',
    scrollerTop: 100,
    sectionTops: [120, 210, 340],
    scrollerHeight: 400,
    scrollerScrollHeight: 1600,
  });
  await loadUsageGuide(fixture);

  fixture.triggerResize();
  assert.equal(fixture.links[0].classList.contains('active'), true);
  assert.equal(fixture.links[1].classList.contains('active'), false);

  fixture.toc.height = 100;
  fixture.triggerResize();
  assert.equal(fixture.links[0].classList.contains('active'), false);
  assert.equal(fixture.links[1].classList.contains('active'), true);
  fixture.sectionTops[1] = 300;
  fixture.triggerScrollerScroll();
  assert.equal(fixture.links[0].classList.contains('active'), true);
});

test('usage guide narrow-window active section follows a resized toc', async () => {
  const fixture = createUsageGuideFixture({
    tocHeight: 40,
    tocTop: '4px',
    scrollerTop: -200,
    sectionTops: [55, 100, 180],
    scrollerHeight: 600,
    scrollerScrollHeight: 600,
  });
  await loadUsageGuide(fixture);

  fixture.triggerResize();
  assert.equal(fixture.links[0].classList.contains('active'), true);
  assert.equal(fixture.links[1].classList.contains('active'), false);

  fixture.toc.height = 90;
  fixture.triggerResize();
  assert.equal(fixture.links[0].classList.contains('active'), false);
  assert.equal(fixture.links[1].classList.contains('active'), true);
  fixture.sectionTops[1] = 140;
  fixture.triggerWindowScroll();
  assert.equal(fixture.links[0].classList.contains('active'), true);
});

test('usage guide return to top cancels pending chapter navigation', async () => {
  const fixture = createUsageGuideFixture();
  await loadUsageGuide(fixture);

  fixture.triggerResize();
  assert.equal(fixture.backToTopButton.hidden, true);

  fixture.links[1].click({ preventDefault() {} });
  fixture.scroller.scrollTop = 600;
  fixture.triggerScrollerScroll();
  assert.equal(fixture.backToTopButton.hidden, false);
  assert.equal(fixture.sections[1].scrollCalls, 1);

  fixture.backToTopButton.click();
  fixture.flushTimers();
  fixture.triggerScrollerScroll();
  assert.equal(fixture.scroller.scrollTop, 0);
  assert.equal(fixture.backToTopButton.hidden, true);
  assert.equal(fixture.sections[1].scrollCalls, 1);
  assert.equal(fixture.panel.classList.contains('usage-guide-render-all'), false);
});
