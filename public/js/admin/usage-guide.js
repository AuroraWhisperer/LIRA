// 编写人：Aurora
// 使用文档：目录与快捷链接平滑滚动，随滚动高亮当前章节。
'use strict';

let initialized = false;
let navigationCorrectionTimer = null;

export function initUsageGuide() {
  if (initialized) return;
  const panel = document.getElementById('otherUsageGuideFeature');
  if (!panel) return;
  const scroller = panel.querySelector('.other-feature-panel-body');
  const links = Array.from(panel.querySelectorAll('[data-usage-guide-link]'));
  if (!scroller || !links.length) return;

  const reduceMotionQuery = window.matchMedia?.(
    '(prefers-reduced-motion: reduce)',
  );
  const sections = Array.from(
    panel.querySelectorAll('.usage-guide-section[id]'),
  );
  if (!sections.length) return;

  function setActiveLink(id) {
    links.forEach((link) => {
      link.classList.toggle('active', link.hash.slice(1) === id);
    });
  }

  function updateActiveOnScroll() {
    if (panel.hidden) return;
    // 吸顶目录下方的判定线：越过该线的最近一个章节视为当前章节
    const marker = Math.min(window.innerHeight * 0.3, 220);
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
      doc.scrollHeight > window.innerHeight + 4 &&
      window.innerHeight + window.scrollY >= doc.scrollHeight - 4;
    if (scrollerAtBottom || windowAtBottom)
      current = sections[sections.length - 1];
    setActiveLink(current.id);
  }

  let scrollTicking = false;
  function onScroll() {
    if (scrollTicking) return;
    scrollTicking = true;
    window.requestAnimationFrame(() => {
      scrollTicking = false;
      updateActiveOnScroll();
    });
  }

  links.forEach((link) => {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      const target = document.getElementById(link.hash.slice(1));
      if (!target) return;
      setActiveLink(target.id);
      panel.classList.add('usage-guide-render-all');
      window.requestAnimationFrame(() => {
        const behavior = reduceMotionQuery?.matches ? 'auto' : 'smooth';
        target.scrollIntoView({
          behavior,
          block: 'start',
        });
        window.clearTimeout(navigationCorrectionTimer);
        navigationCorrectionTimer = window.setTimeout(
          () => {
            target.scrollIntoView({ behavior: 'auto', block: 'start' });
            panel.classList.remove('usage-guide-render-all');
            navigationCorrectionTimer = null;
          },
          behavior === 'smooth' ? 700 : 0,
        );
      });
    });
  });

  scroller.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('scroll', onScroll, { passive: true });
  setActiveLink(sections[0].id);

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
