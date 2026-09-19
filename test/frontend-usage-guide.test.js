'use strict';

const { readAdminHtml } = require('./helpers/admin-html');

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { readCssBundle } = require('./helpers/css-bundle');
const { loadModuleExports } = require('./helpers/frontend-modules');

const ROOT_DIR = path.join(__dirname, '..');

test('usage guide main-flow steps keep body text out of the number gutter', () => {
  const source = readCssBundle('public', 'css', 'admin', 'other-features.css');
  const stepRule = source.match(/\.usage-guide-steps li\s*\{[\s\S]*?\n\}/)?.[0];
  const markerRule = source.match(
    /\.usage-guide-steps li::before\s*\{[\s\S]*?\n\}/,
  )?.[0];

  assert.ok(stepRule, 'usage guide step layout should remain defined');
  assert.ok(markerRule, 'usage guide step marker should remain defined');
  assert.match(stepRule, /position:\s*relative/);
  assert.match(stepRule, /padding:\s*11px 2px 11px 40px/);
  assert.doesNotMatch(stepRule, /grid-template-columns/);
  assert.match(markerRule, /position:\s*absolute/);
  assert.match(markerRule, /left:\s*2px/);
});

test('usage guide keeps expanded sidebar content in one column without the removed introduction', () => {
  const source = readCssBundle('public', 'css', 'admin', 'other-features.css');
  const panelRule = source.match(/\.usage-guide-panel\s*\{[\s\S]*?\n\}/)?.[0];
  assert.ok(panelRule, 'usage guide panel sizing should remain defined');
  assert.doesNotMatch(readAdminHtml(), /class="usage-guide-lead"/);
  assert.match(panelRule, /max-width:\s*none/);
  const collapsedRule = source.match(
    /\.other-page\.sidebar-collapsed \.usage-guide-panel\s*\{[^}]*\}/,
  )?.[0];
  assert.ok(
    collapsedRule,
    'only the collapsed sidebar should enable two columns',
  );
  assert.doesNotMatch(panelRule, /grid-template-columns/);
  assert.match(
    collapsedRule,
    /grid-template-columns:\s*176px minmax\(0, 1fr\)/,
  );
});

test('usage guide presents overlays for both live companion and OBS users', () => {
  const html = readAdminHtml();

  assert.match(html, />\s*直播姬 \/ OBS 投屏\s*<\/a>/);
  assert.match(html, />\s*直播姬 \/ OBS 投屏设置\s*<\/h3>/);
  assert.match(html, /添加到直播姬的「浏览器」或\s*OBS\s*的「浏览器源」/);
  assert.match(html, />直播姬 \/ OBS 投屏画面不显示或尺寸不对<\/strong>/);
});

test('usage guide defers image loading and avoids sticky backdrop blur', () => {
  const html = readAdminHtml();
  const styles = readCssBundle('public', 'css', 'admin', 'other-features.css');
  const images =
    html.match(/<img\b[^>]*class="usage-guide-image"[^>]*>/g) || [];
  const tocRule = styles.match(/\.usage-guide-toc\s*\{[\s\S]*?\n\}/)?.[0];

  assert.equal(images.length, 10);
  assert.equal(
    images.every((image) => /loading="lazy"/.test(image)),
    true,
  );
  assert.equal(
    images.every((image) => /decoding="async"/.test(image)),
    true,
  );
  assert.equal(
    images.every(
      (image) => /\bwidth="\d+"/.test(image) && /\bheight="\d+"/.test(image),
    ),
    true,
  );
  assert.ok(tocRule, 'usage guide table of contents should remain defined');
  assert.match(tocRule, /background:\s*var\(--usage-guide-accent-soft\)/);
  assert.match(tocRule, /display:\s*grid/);
  assert.doesNotMatch(
    tocRule,
    /white-space:\s*nowrap|overflow-x:\s*(?:auto|scroll)/,
  );
  assert.doesNotMatch(tocRule, /backdrop-filter/);
});

test('usage guide names the AI assistant section without removing the DeepSeek anchor', () => {
  const html = readAdminHtml();

  assert.match(html, /href="#ug-deepseek"[^>]*>配置 AI 助手<\/a>/);
  assert.match(html, /id="ug-deepseek"[^>]*>[\s\S]*?>\s*配置 AI 助手\s*<\/h3>/);
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
} = {}) {
  const observers = [];
  const windowListeners = new Map();
  const timers = new Map();
  let nextTimerId = 1;
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
  const sections = sectionTops.map((_, index) => ({
    id: `usage-section-${index + 1}`,
    scrollCalls: 0,
    scrollIntoView() {
      this.scrollCalls += 1;
    },
    getBoundingClientRect: () => ({ top: sectionTops[index] }),
  }));
  const links = sections.map((section) => ({
    hash: `#${section.id}`,
    classList: createClassList(),
    addEventListener(name, listener) {
      this[name] = listener;
    },
  }));
  const backToTopButton = {
    hidden: true,
    addEventListener(name, listener) {
      this[name] = listener;
    },
  };
  const toc = {
    height: tocHeight,
    reads: 0,
    getBoundingClientRect() {
      this.reads += 1;
      return { height: this.height };
    },
  };
  const scrollerListeners = new Map();
  const scroller = {
    clientHeight: scrollerHeight,
    scrollHeight: scrollerScrollHeight,
    scrollTop: 0,
    scrollTo({ top }) {
      this.scrollTop = top;
    },
    addEventListener: (name, listener) => scrollerListeners.set(name, listener),
    getBoundingClientRect: () => ({ top: scrollerTop }),
  };
  const panel = {
    hidden: false,
    classList: createClassList(),
    style: {
      setProperty(name, value) {
        this[name] = value;
      },
    },
    querySelector(selector) {
      if (selector === '.other-feature-panel-body') return scroller;
      if (selector === '.usage-guide-toc') return toc;
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
    documentElement: { scrollHeight: 2000 },
    getElementById: (id) =>
      id === 'otherUsageGuideFeature'
        ? panel
        : sections.find((section) => section.id === id) || null,
  };
  const window = {
    innerHeight: 600,
    scrollY: 0,
    matchMedia: () => ({ matches: false }),
    getComputedStyle: (element) =>
      element === toc
        ? { flexDirection, top: tocTop }
        : { paddingTop: scrollerPaddingTop, overflowY: scrollerOverflowY },
    requestAnimationFrame: (callback) => callback(),
    setTimeout(callback) {
      const timerId = nextTimerId++;
      timers.set(timerId, callback);
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

  return {
    document,
    panel,
    scroller,
    sections,
    backToTopButton,
    sectionTops,
    links,
    toc,
    window,
    ResizeObserver,
    flushTimers() {
      for (const callback of timers.values()) callback();
      timers.clear();
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
    assert.equal(
      fixture.links[1].classList.contains('active'),
      scrollerOverflowY === 'auto',
    );
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
