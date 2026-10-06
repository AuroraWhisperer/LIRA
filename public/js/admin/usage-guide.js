// 编写人：Aurora
// 使用文档：目录与快捷链接平滑滚动，随滚动高亮当前章节。
'use strict';

import { initUsageGuideLightbox } from './usage-guide-lightbox.js';
import { initUsageGuideSearch } from './usage-guide-search.js';

let initialized = false;
let navigationCorrectionTimer = null;

export function initUsageGuide() {
  if (initialized) return;
  const panel = document.getElementById('otherUsageGuideFeature');
  if (!panel) return;
  const scroller = panel.querySelector('.other-feature-panel-body');
  const toc = panel.querySelector('.usage-guide-toc');
  const tocToggle = panel.querySelector('.usage-guide-toc-toggle');
  const tocMenu = panel.querySelector('.usage-guide-toc-links');
  const tocCurrent = panel.querySelector('.usage-guide-toc-current');
  const backToTopButton = panel.querySelector('.usage-guide-back-to-top');
  const links = Array.from(panel.querySelectorAll('[data-usage-guide-link]'));
  if (!scroller || !toc || !tocToggle || !tocMenu || !tocCurrent || !links.length) return;

  const reduceMotionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const sections = Array.from(panel.querySelectorAll('.usage-guide-section[id]'));
  if (!sections.length) return;

  let sectionOffset = 110;
  let compactToc = true;
  let tocAtTop = null;
  let tocTimer = null;

  function updateTocAvailableHeight() {
    const scrollerBottom =
      window.getComputedStyle(scroller).overflowY === 'auto'
        ? scroller.getBoundingClientRect().bottom
        : window.innerHeight;
    const available = Math.min(scrollerBottom, window.innerHeight) - toc.getBoundingClientRect().bottom - 12;
    toc.style.setProperty('--usage-guide-toc-max-height', `${Math.max(0, available)}px`);
    if (tocAtTop) {
      panel.style.setProperty('--usage-guide-toc-space', `${tocMenu.getBoundingClientRect().height + 6}px`);
    }
  }

  function setTocOpen(open) {
    window.clearTimeout(tocTimer);
    const expanded = (open || tocAtTop) && compactToc && !panel.hidden;
    if (expanded) updateTocAvailableHeight();
    if (!expanded && compactToc && tocMenu.contains(document.activeElement)) {
      tocToggle.focus({ preventScroll: true });
    }
    toc.classList.toggle('is-open', expanded);
    tocToggle.setAttribute('aria-expanded', String(expanded));
    tocMenu.inert = compactToc && !expanded;
  }

  function scheduleToc(open) {
    window.clearTimeout(tocTimer);
    if (!compactToc || tocAtTop || (open && toc.classList.contains('is-open'))) return;
    tocTimer = window.setTimeout(() => setTocOpen(open), open ? 200 : 300);
  }

  function updateTocScrollState() {
    if (panel.hidden) return;
    const atTop = compactToc && scroller.scrollTop <= 8 && scroller.getBoundingClientRect().top >= -8;
    if (atTop === tocAtTop) return;
    tocAtTop = atTop;
    toc.classList.toggle('is-at-top', atTop);
    setTocOpen(false);
  }

  toc.addEventListener('pointerenter', (event) => {
    if (event.pointerType !== 'touch') scheduleToc(true);
  });
  toc.addEventListener('pointerleave', (event) => {
    if (event.pointerType !== 'touch' && !tocMenu.contains(document.activeElement)) scheduleToc(false);
  });
  toc.addEventListener('focusin', () => window.clearTimeout(tocTimer));
  toc.addEventListener('focusout', (event) => {
    if (!toc.contains(event.relatedTarget)) scheduleToc(false);
  });
  // 点击供键盘和触屏使用；鼠标悬停无需点击。
  tocToggle.addEventListener('click', () => setTocOpen(!toc.classList.contains('is-open')));
  toc.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && compactToc && toc.classList.contains('is-open')) {
      event.preventDefault();
      setTocOpen(false);
    }
  });
  document.addEventListener('pointerdown', (event) => {
    if (!toc.contains(event.target)) setTocOpen(false);
  });

  function updateTocLayout() {
    if (panel.hidden) return;
    const tocStyle = window.getComputedStyle(toc);
    const nextCompactToc = tocStyle.flexDirection !== 'column';
    if (nextCompactToc !== compactToc) {
      compactToc = nextCompactToc;
      setTocOpen(false);
    }
    updateTocScrollState();
    const scrollerStyle = window.getComputedStyle(scroller);
    const scrollerPadding = scrollerStyle.overflowY === 'auto' ? parseFloat(scrollerStyle.paddingTop) : 0;
    sectionOffset =
      tocStyle.flexDirection === 'column'
        ? 24
        : toc.getBoundingClientRect().height + parseFloat(tocStyle.top) + scrollerPadding + 12;
    panel.style.setProperty('--usage-guide-scroll-offset', `${sectionOffset}px`);
    if (toc.classList.contains('is-open')) updateTocAvailableHeight();
    updateActiveOnScroll();
  }

  function setActiveLink(id) {
    links.forEach((link) => {
      const active = link.hash.slice(1) === id;
      link.classList.toggle('active', active);
      if (toc.contains(link)) {
        if (active) {
          link.setAttribute('aria-current', 'location');
          tocCurrent.textContent = link.textContent.trim();
          tocCurrent.title = tocCurrent.textContent;
        } else {
          link.removeAttribute('aria-current');
        }
      }
    });
  }

  function updateActiveOnScroll() {
    if (panel.hidden) return;
    const scrollerTop = scroller.getBoundingClientRect().top;
    if (backToTopButton) {
      backToTopButton.hidden = scroller.scrollTop <= 160 && scrollerTop >= -160;
    }
    // 吸顶目录下方的判定线：越过该线的最近一个章节视为当前章节
    const marker = Math.max(0, scrollerTop) + sectionOffset + 1;
    let current = sections[0];
    for (const section of sections) {
      if (section.getBoundingClientRect().top <= marker) current = section;
      else break;
    }
    // 内部滚动到底（桌面布局）或窗口滚动到底（窄屏布局）时，直接标记最后一节
    const scrollerAtBottom =
      scroller.scrollHeight - scroller.clientHeight > 4 &&
      scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4;
    const doc = document.documentElement;
    // 桌面布局里窗口本身不可滚动（scrollHeight == innerHeight），此时跳过窗口判底，
    // 否则任何滚动都会被误判为「到底」，把高亮锁死在最后一节
    const windowAtBottom =
      doc.scrollHeight > window.innerHeight + 4 && window.innerHeight + window.scrollY >= doc.scrollHeight - 4;
    if (scrollerAtBottom || windowAtBottom) current = sections[sections.length - 1];
    setActiveLink(current.id);
  }

  let scrollTicking = false;
  function onScroll() {
    if (scrollTicking) return;
    scrollTicking = true;
    window.requestAnimationFrame(() => {
      scrollTicking = false;
      updateTocScrollState();
      if (toc.classList.contains('is-open')) updateTocAvailableHeight();
      updateActiveOnScroll();
    });
  }

  function navigateToTarget(target, sectionId, focusTarget = false, onArrive) {
    setTocOpen(false);
    setActiveLink(sectionId);
    panel.classList.add('usage-guide-render-all');
    window.requestAnimationFrame(() => {
      if (focusTarget) {
        target.classList.add('usage-guide-search-target');
        target.setAttribute('tabindex', '-1');
        target.focus({ preventScroll: true });
      }
      const behavior = reduceMotionQuery?.matches ? 'auto' : 'smooth';
      target.scrollIntoView({ behavior, block: 'start' });
      window.clearTimeout(navigationCorrectionTimer);
      navigationCorrectionTimer = window.setTimeout(
        () => {
          target.scrollIntoView({ behavior: 'auto', block: 'start' });
          panel.classList.remove('usage-guide-render-all');
          navigationCorrectionTimer = null;
          onArrive?.();
        },
        behavior === 'smooth' ? 700 : 0,
      );
    });
  }

  links.forEach((link) => {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      const target = document.getElementById(link.hash.slice(1));
      if (target) navigateToTarget(target, target.id);
    });
  });

  initUsageGuideSearch(panel, navigateToTarget);
  initUsageGuideLightbox(panel);

  backToTopButton?.addEventListener('click', () => {
    window.clearTimeout(navigationCorrectionTimer);
    navigationCorrectionTimer = null;
    panel.classList.remove('usage-guide-render-all');
    const behavior = reduceMotionQuery?.matches ? 'auto' : 'smooth';
    scroller.scrollTo({ top: 0, behavior });
    if (window.getComputedStyle(scroller).overflowY !== 'auto') {
      panel.scrollIntoView({ behavior, block: 'start' });
    }
  });

  scroller.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('scroll', onScroll, { passive: true });
  setActiveLink(sections[0].id);
  updateTocLayout();
  const tocObserver = new ResizeObserver(updateTocLayout);
  tocObserver.observe(toc);
  tocObserver.observe(tocMenu);

  // 绑定重新打开交互式引导按钮
  const reopenTourBtn = document.getElementById('reopenInteractiveTourBtn');
  if (reopenTourBtn) {
    reopenTourBtn.addEventListener('click', () => {
      if (window.liraTour) {
        window.liraTour.reset();
      }
    });
  }

  initialized = true;
}
