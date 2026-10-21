'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { readAdminFragmentHtml } = require('../helpers/admin-html');
const { readCssBundle } = require('../helpers/css-bundle');
const { readJsModuleBundle } = require('../helpers/js-module-bundle');
const { useSharedBrowser } = require('../helpers/shared-browser');

const openBrowserSession = useSharedBrowser();

async function setup(t, reducedMotion = 'no-preference') {
  const browser = openBrowserSession();
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion });
  page.setDefaultTimeout(5000);
  await page.route('**/*', (route) => route.abort());
  await page.setContent(`<div class="other-page"><div class="other-workspace">
    <aside class="other-feature-sidebar">功能导航</aside><div class="other-feature-content">
    ${readAdminFragmentHtml('pages/admin/toolbox/usage-guide.html')}
    </div></div></div>`);
  await page.addStyleTag({ content: readCssBundle('public', 'css', 'styles-base.css') });
  await page.addStyleTag({ content: readCssBundle('public', 'css', 'admin', 'toolbox.css') });
  await page.locator('#otherUsageGuideFeature').evaluate((panel) => {
    panel.hidden = false;
    panel.classList.add('active');
  });
  await page.addScriptTag({ content: readJsModuleBundle('public', 'js', 'admin', 'usage-guide.js') });
  await page.evaluate(() => {
    const transition = initUsageGuide();
    window.toggleGuideSidebar = () => transition(() => {
      document.querySelector('.other-page').classList.toggle('sidebar-collapsed');
    });
  });
  // Finish entry layout before Playwright's click retries can scroll and collapse the top directory.
  await page.locator('#otherUsageGuideFeature').evaluate((panel) =>
    Promise.all(panel.getAnimations({ subtree: true }).map((animation) => animation.finished)));
  return page;
}

async function readParagraph(page) {
  await page.locator('.usage-guide-toc-group > a[href="#ug-scene-guide"]').click();
  await page.waitForFunction(() => !document.querySelector('#otherUsageGuideFeature')
    .classList.contains('usage-guide-render-all'));
  await page.evaluate(async () => {
    const panel = document.querySelector('#otherUsageGuideFeature');
    const scroller = panel.querySelector('.other-feature-panel-body');
    const target = document.querySelector('#ug-scene-guide > p');
    const offset = parseFloat(panel.style.getPropertyValue('--usage-guide-scroll-offset'));
    scroller.scrollBy({ top: target.getBoundingClientRect().top - scroller.getBoundingClientRect().top - offset + 6 });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  const position = await paragraphPosition(page);
  assert.ok(position >= 0 && position <= 1, `target paragraph is at the reading marker: ${position}`);
}

async function paragraphPosition(page) {
  return page.evaluate(() => {
    const panel = document.querySelector('#otherUsageGuideFeature');
    const scroller = panel.querySelector('.other-feature-panel-body');
    const rect = document.querySelector('#ug-scene-guide > p').getBoundingClientRect();
    const marker = scroller.getBoundingClientRect().top
      + parseFloat(panel.style.getPropertyValue('--usage-guide-scroll-offset')) + 1;
    return (marker - rect.top) / rect.height;
  });
}

async function waitForNavigation(page) {
  await page.waitForFunction(() => !document.querySelector('#otherUsageGuideFeature')
    .classList.contains('usage-guide-render-all'));
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function assertBelowToolbar(page, selector) {
  const gap = await page.locator(selector).first().evaluate((target) => target.getBoundingClientRect().top
    - document.querySelector('.usage-guide-toc').getBoundingClientRect().bottom);
  assert.ok(gap >= 10 && gap <= 14, `the first line should sit just below the toolbar: ${selector}, gap=${gap}`);
}

for (const mode of ['no-preference', 'reduce']) {
  test(`guide jumps settle after closing the top directory (${mode})`, async (t) => {
    const page = await setup(t, mode);
    await page.locator('.usage-guide-toc-group > a[href="#ug-gifts"]').click();
    await waitForNavigation(page);
    await assertBelowToolbar(page, '#ug-gifts .usage-guide-section-title');

    await page.locator('.usage-guide-back-to-top').click();
    await page.waitForFunction(() => document.querySelector('.usage-guide-toc').classList.contains('is-at-top'));
    // The component page enters the guide and clicks its existing link in the same turn.
    await page.evaluate(() => {
      const panel = document.querySelector('#otherUsageGuideFeature');
      panel.hidden = true;
      panel.hidden = false;
      panel.querySelector('a[href="#ug-web-gift-analysis"]').click();
    });
    await waitForNavigation(page);
    await assertBelowToolbar(page, '#ug-web-gift-analysis .usage-guide-feature-head strong');
    assert.equal(await page.locator('.usage-guide-toc-detail').textContent(), '4.2.3 礼物构成与盲盒明细怎么读');
    assert.equal(await page.locator('.usage-guide-toc-toggle').getAttribute('aria-expanded'), 'false');
  });
}

test('search targets without ids and folded answers land below the toolbar', async (t) => {
  const page = await setup(t, 'reduce');
  for (const query of ['礼物构成', '用户名旁的说明']) {
    await page.locator('#usageGuideSearchInput').fill(query);
    await page.locator('.usage-guide-search-result').first().click();
    await waitForNavigation(page);
    await assertBelowToolbar(page, '.usage-guide-search-match.is-locating');
  }
});

for (const mode of ['no-preference', 'reduce']) {
  test(`guide back restores successive reading positions and cancels unfinished jumps (${mode})`, async (t) => {
    const page = await setup(t, mode);
    const back = page.getByRole('button', { name: '返回跳转前的位置', exact: true });
    assert.equal(await back.count(), 0, 'the empty history control is inert');
    await readParagraph(page);
    const before = await paragraphPosition(page);
    const source = page.locator('#ug-scene-guide > p a');
    await source.click();
    await waitForNavigation(page);
    await page.locator('.usage-guide-chapter-next').click();
    await waitForNavigation(page);
    await back.click();
    await waitForNavigation(page);
    await assertBelowToolbar(page, '#ug-web-share .usage-guide-feature-head strong');

    // Resize/reflow between leaving and returning; the paragraph, not old pixels, owns the bookmark.
    await page.evaluate(() => window.toggleGuideSidebar());
    await back.click();
    await waitForNavigation(page);
    assert.ok(Math.abs(await paragraphPosition(page) - before) < 0.03);
    assert.equal(await source.evaluate((node) => node === document.activeElement), true);

    await page.evaluate(() => {
      document.querySelector('#ug-scene-guide > p a').click();
      document.querySelector('.usage-guide-go-back').click();
    });
    await waitForNavigation(page);
    assert.ok(Math.abs(await paragraphPosition(page) - before) < 0.03, 'a queued forward jump must not override back');
    await back.click();
    await waitForNavigation(page);
    assert.equal(await page.locator('.usage-guide-panel').evaluate((node) => node.scrollTop), 0);
    assert.equal(await back.count(), 0, 'all stored jumps have been consumed');
  });
}

test('the split navigation expands to the left and folds after the last return', async (t) => {
  const page = await setup(t);
  await page.locator('#ug-scene-guide > p').first().evaluate((node) => node.scrollIntoView({ behavior: 'instant' }));
  await page.waitForFunction(() => !document.querySelector('.usage-guide-floating-actions').hidden);
  const actions = page.locator('.usage-guide-floating-actions');
  const initial = await actions.boundingBox();
  const top = page.locator('.usage-guide-back-to-top');
  const topBefore = await top.boundingBox();
  await top.click();
  await page.waitForFunction(() => document.querySelector('.usage-guide-toc').classList.contains('is-at-top'));
  await actions.evaluate((node) => Promise.all(node.getAnimations({ subtree: true }).map((animation) => animation.finished)));
  const expanded = await actions.boundingBox();
  assert.equal(Math.round(expanded.width - initial.width), 44);
  assert.equal(Math.round(expanded.x + expanded.width), Math.round(initial.x + initial.width));
  assert.equal(Math.round((await top.boundingBox()).x), Math.round(topBefore.x));
  assert.equal(await top.isDisabled(), true);

  await page.getByRole('button', { name: '返回跳转前的位置', exact: true }).press('Enter');
  await waitForNavigation(page);
  await actions.evaluate((node) => Promise.all(node.getAnimations({ subtree: true }).map((animation) => animation.finished)));
  assert.equal((await actions.boundingBox()).width, initial.width);
  assert.equal(await page.locator('.usage-guide-go-back').evaluate((node) => node.inert), true);
  assert.equal(await top.isDisabled(), false);
  assert.equal(await actions.isVisible(), true);
});

test('returning from a search restores the search entry and preserves its query', async (t) => {
  const page = await setup(t, 'reduce');
  await page.locator('#usageGuideSearchInput').fill('用户名旁的说明');
  const result = page.locator('.usage-guide-search-result').first();
  await result.click();
  await waitForNavigation(page);
  await page.getByRole('button', { name: '返回跳转前的位置', exact: true }).click();
  await waitForNavigation(page);
  assert.equal(await page.locator('.usage-guide-panel').evaluate((node) => node.scrollTop), 0);
  assert.equal(await page.locator('#usageGuideSearchInput').inputValue(), '用户名旁的说明');
  assert.equal(await result.evaluate((node) => node === document.activeElement), true);
});

for (const mode of ['no-preference', 'reduce']) {
  test(`distant jumps skip intermediate chapters and remain settled after arrival (${mode})`, async (t) => {
    const page = await setup(t, mode);
    const samples = await page.evaluate(() => new Promise((resolve) => {
      const panel = document.querySelector('#otherUsageGuideFeature');
      const scroller = panel.querySelector('.usage-guide-panel');
      const started = performance.now();
      const frames = [];
      const sample = () => {
        frames.push({
          top: scroller.scrollTop,
          opacity: Number(getComputedStyle(scroller).opacity),
          moving: panel.classList.contains('usage-guide-render-all'),
        });
        if (performance.now() - started < 1000) requestAnimationFrame(sample);
        else resolve(frames);
      };
      sample();
      panel.querySelector('.usage-guide-toc-group > a[href="#ug-faq"]').click();
    }));
    const moves = samples.slice(1).filter((frame, index) => Math.abs(frame.top - samples[index].top) > 2);
    assert.equal(moves.length, 1, 'a distant jump must not sweep through intermediate content or move again later');
    assert.equal(samples.at(-1).moving, false);
    assert.equal(samples.at(-1).opacity, 1);
    assert.equal(samples.some((frame) => frame.opacity < 1), mode === 'no-preference');
    await assertBelowToolbar(page, '#ug-faq .usage-guide-section-title');
  });
}

test('nearby jumps scroll progressively and wheel input takes over without a late snap', async (t) => {
  const page = await setup(t);
  await readParagraph(page);
  const scroller = page.locator('.usage-guide-panel');
  await scroller.hover({ position: { x: 500, y: 200 } });
  await page.locator('#ug-scenes').evaluate((node) => {
    const panel = document.querySelector('#otherUsageGuideFeature');
    const scroller = panel.querySelector('.usage-guide-panel');
    scroller.scrollTop += node.getBoundingClientRect().top - scroller.getBoundingClientRect().top
      - parseFloat(panel.style.getPropertyValue('--usage-guide-scroll-offset')) - 300;
  });
  const start = await scroller.evaluate((node) => node.scrollTop);
  await page.locator('.usage-guide-toc-links a[href="#ug-scenes"]').evaluate((node) => node.click());
  await page.waitForFunction((startTop) => {
    const panel = document.querySelector('#otherUsageGuideFeature');
    const scroller = panel.querySelector('.usage-guide-panel');
    const gap = document.querySelector('#ug-scenes').getBoundingClientRect().top
      - panel.querySelector('.usage-guide-toc').getBoundingClientRect().bottom;
    return panel.classList.contains('usage-guide-render-all') && scroller.scrollTop > startTop && gap > 20;
  }, start);
  assert.equal(await scroller.evaluate((node) => getComputedStyle(node).opacity), '1');
  await page.mouse.wheel(0, -160);
  await waitForNavigation(page);
  await page.waitForTimeout(800); // Outlive the old correction delay to catch a late forced scroll.
  const gap = await page.locator('#ug-scenes').evaluate((node) => node.getBoundingClientRect().top
    - document.querySelector('.usage-guide-toc').getBoundingClientRect().bottom);
  assert.ok(gap > 100, `manual scrolling must remain in control: ${gap}`);
  await page.locator('.usage-guide-toc-links a[href="#ug-scenes"]').evaluate((node) => node.click());
  await waitForNavigation(page);
  await assertBelowToolbar(page, '#ug-scenes');
});

test('a new jump during a chapter fade cancels the old destination and restores visibility', async (t) => {
  const page = await setup(t);
  await page.locator('.usage-guide-toc-group > a[href="#ug-faq"]').evaluate((node) => node.click());
  await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('.usage-guide-panel')).opacity) < 0.95);
  await page.locator('.usage-guide-toc-group > a[href="#ug-gifts"]').evaluate((node) => node.click());
  await waitForNavigation(page);
  await assertBelowToolbar(page, '#ug-gifts .usage-guide-section-title');
  assert.equal(await page.locator('.usage-guide-panel').evaluate((node) => getComputedStyle(node).opacity), '1');
});

test('entry from a hidden guide measures the current toolbar after resizing', async (t) => {
  const page = await setup(t, 'reduce');
  await page.locator('#otherUsageGuideFeature').evaluate((panel) => { panel.hidden = true; });
  await page.setViewportSize({ width: 1000, height: 900 });
  await page.evaluate(() => {
    const panel = document.querySelector('#otherUsageGuideFeature');
    panel.hidden = false;
    panel.querySelector('a[href="#ug-scene-guide"]').click();
  });
  await waitForNavigation(page);
  await assertBelowToolbar(page, '#ug-scene-guide .usage-guide-section-title');
});

test('both directory layouts expose subsections and the sticky sidebar scrolls without a visible scrollbar', async (t) => {
  const page = await setup(t, 'reduce');
  const directory = await page.evaluate(() => {
    initUsageGuide();
    return Array.from(document.querySelectorAll('.usage-guide-toc-group'), (group) => {
      const chapter = group.querySelector('a');
      const section = document.getElementById(chapter.hash.slice(1));
      return {
        headings: Array.from(section.querySelectorAll(':scope > h4'), (heading) => heading.textContent.trim()),
        links: Array.from(group.querySelectorAll('.usage-guide-toc-children a'), (link) => ({
          text: link.textContent,
          target: document.getElementById(link.hash.slice(1))?.textContent.trim(),
        })),
      };
    });
  });
  assert.equal(directory.length, 8);
  for (const chapter of directory) {
    assert.deepEqual(chapter.links.map((link) => link.text), chapter.headings);
    assert.deepEqual(chapter.links.map((link) => link.target), chapter.headings);
  }
  const subsection = page.locator('.usage-guide-toc-children a').filter({ hasText: '2.2 点歌管理' });
  await subsection.click();
  await page.waitForFunction(() => !document.querySelector('#otherUsageGuideFeature').classList.contains('usage-guide-render-all'));
  assert.equal(await page.locator('.usage-guide-toc-current').textContent(), '2 点歌与播放');
  assert.equal(await page.locator('.usage-guide-toc-group > a.active').getAttribute('href'), '#ug-song');
  const targetOffset = await page.evaluate(() => {
    const panel = document.querySelector('#otherUsageGuideFeature');
    const target = document.getElementById('ug-song-subsection-2');
    return target.getBoundingClientRect().top - panel.querySelector('.usage-guide-panel').getBoundingClientRect().top
      - parseFloat(panel.style.getPropertyValue('--usage-guide-scroll-offset'));
  });
  assert.ok(Math.abs(targetOffset) < 2, `the subsection should land below the toolbar: ${targetOffset}`);

  await page.evaluate(() => window.toggleGuideSidebar());
  const sidebar = await page.locator('.usage-guide-toc').evaluate((node) => ({
    overflow: getComputedStyle(node).overflowY,
    position: getComputedStyle(node).position,
    scrollbar: getComputedStyle(node).scrollbarWidth,
    top: node.getBoundingClientRect().top,
    height: node.clientHeight,
    scrollHeight: node.scrollHeight,
  }));
  assert.equal(sidebar.overflow, 'auto');
  assert.equal(sidebar.position, 'sticky');
  assert.equal(sidebar.scrollbar, 'none');
  assert.ok(sidebar.scrollHeight > sidebar.height, 'all subsections remain accessible in the bounded directory');
  const readingScroll = await page.locator('.usage-guide-panel').evaluate((node) => node.scrollTop);
  await page.locator('.usage-guide-toc').hover();
  await page.mouse.wheel(0, 480);
  await page.waitForFunction(() => document.querySelector('.usage-guide-toc').scrollTop > 0);
  assert.equal(await page.locator('.usage-guide-panel').evaluate((node) => node.scrollTop), readingScroll);
  const lastLink = page.locator('.usage-guide-toc-children a').last();
  await lastLink.scrollIntoViewIfNeeded();
  const lastLinkIsInView = await lastLink.evaluate((node) => {
    const link = node.getBoundingClientRect();
    const toc = node.closest('.usage-guide-toc').getBoundingClientRect();
    return link.top >= toc.top && link.bottom <= toc.bottom;
  });
  assert.ok(lastLinkIsInView, 'the final subsection can be brought into view');
  await page.locator('.usage-guide-panel').evaluate((node) => { node.scrollTop += 400; });
  const directoryTop = await page.locator('.usage-guide-toc').evaluate((node) => node.getBoundingClientRect().top);
  assert.ok(Math.abs(directoryTop - sidebar.top) < 1, 'the directory stays fixed while the article scrolls');
});

for (const mode of ['no-preference', 'reduce']) {
  test(`sidebar layout keeps the reading paragraph and top directory state (${mode})`, async (t) => {
    const page = await setup(t, mode);
    for (let i = 0; i < 2; i += 1) await page.evaluate(() => window.toggleGuideSidebar());
    assert.equal(await page.locator('.usage-guide-panel').evaluate((node) => node.scrollTop), 0);
    assert.equal(await page.locator('.usage-guide-toc-toggle').getAttribute('aria-expanded'), 'true');
    assert.equal(await page.locator('.usage-guide-toc-links').evaluate((node) => node.inert), false);
    assert.equal(await page.locator('#otherUsageGuideFeature').evaluate((node) =>
      node.getAnimations().some((animation) => animation.animationName === 'other-feature-panel-enter'
        && animation.playState === 'running')), false, 'the panel must not replay its entrance after a layout switch');

    await readParagraph(page);
    const before = await paragraphPosition(page);
    for (let i = 0; i < 2; i += 1) {
      await page.evaluate(() => window.toggleGuideSidebar());
      assert.ok(Math.abs(await paragraphPosition(page) - before) < 0.03, 'same paragraph stays at the reading marker');
    }
    assert.equal(await page.locator('.usage-guide-toc-toggle').getAttribute('aria-expanded'), 'false');
    await page.locator('.usage-guide-toc').hover();
    await page.waitForFunction(() => document.querySelector('.usage-guide-toc-toggle').getAttribute('aria-expanded') === 'true');
    await page.locator('.other-feature-sidebar').hover();
    await page.waitForFunction(() => document.querySelector('.usage-guide-toc-toggle').getAttribute('aria-expanded') === 'false');
  });
}

test('rapid sidebar reversals finish every update without leaving a transition running', async (t) => {
  const page = await setup(t);
  const state = await page.evaluate(async () => {
    await Promise.all([window.toggleGuideSidebar(), window.toggleGuideSidebar(), window.toggleGuideSidebar()]);
    const workspace = document.querySelector('.other-workspace');
    const first = window.toggleGuideSidebar();
    await Promise.resolve();
    await workspace.activeViewTransition?.ready;
    await Promise.all([first, window.toggleGuideSidebar(), window.toggleGuideSidebar()]);
    return {
      collapsed: document.querySelector('.other-page').classList.contains('sidebar-collapsed'),
      switching: workspace.classList.contains('usage-guide-switching'),
      active: Boolean(workspace.activeViewTransition),
    };
  });
  assert.deepEqual(state, { collapsed: false, switching: false, active: false });
});

test('the guide preserves reading position when scoped view transitions are unavailable', async (t) => {
  const page = await setup(t);
  await page.evaluate(() => { document.querySelector('.other-workspace').startViewTransition = undefined; });
  await readParagraph(page);
  const before = await paragraphPosition(page);
  await page.evaluate(() => window.toggleGuideSidebar());
  assert.ok(Math.abs(await paragraphPosition(page) - before) < 0.03);
});
