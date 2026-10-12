// Reading snapshots survive changes in line wrapping and directory layout.
export function captureUsageGuidePosition(scroller, sections, offset) {
  if (scroller.scrollTop <= 8 && scroller.getBoundingClientRect().top >= -8) return null;
  const marker = Math.max(0, scroller.getBoundingClientRect().top) + offset + 1;
  const section = sections.findLast((item) => item.getBoundingClientRect().top <= marker) || sections[0];
  let target = section;
  let rect = section.getBoundingClientRect();
  // Only measure the current chapter, including an image when reading midway through it.
  for (const item of section.querySelectorAll('h3, h4, p, li, figure, summary, .usage-guide-feature-head')) {
    const candidate = item.getBoundingClientRect();
    if (candidate.height && candidate.top <= marker && candidate.top >= rect.top) {
      target = item;
      rect = candidate;
    }
  }
  return { target, fraction: (marker - rect.top) / Math.max(1, rect.height) };
}

export function getUsageGuideScrollTop(scroller, position, offset) {
  const internalScroll = window.getComputedStyle(scroller).overflowY === 'auto';
  if (!position) return internalScroll ? 0 : window.scrollY + scroller.getBoundingClientRect().top;
  const rect = position.target.getBoundingClientRect();
  const marker = Math.max(0, scroller.getBoundingClientRect().top) + offset + 1;
  const delta = rect.top + rect.height * position.fraction - marker;
  return (internalScroll ? scroller.scrollTop : window.scrollY) + delta;
}

export function restoreUsageGuidePosition(scroller, position, offset) {
  const scrollRoot = window.getComputedStyle(scroller).overflowY === 'auto' ? scroller : window;
  scrollRoot.scrollTo({ top: getUsageGuideScrollTop(scroller, position, offset), behavior: 'instant' });
}

// Keep the visible reading position when the toolbox changes the guide's layout.
export function createUsageGuideSidebarTransition({ panel, scroller, sections, updateLayout, getOffset, reduceMotion }) {
  const workspace = panel.closest('.other-workspace');
  let transition = null;
  let pending = Promise.resolve();
  let revision = 0;

  async function switchLayout(apply, request) {
    if (panel.hidden || !panel.getClientRects().length || window.getComputedStyle(scroller).overflowY !== 'auto') {
      apply();
      return;
    }
    for (const animation of panel.getAnimations()) {
      if (animation.animationName === 'other-feature-panel-enter') animation.finish();
    }
    const position = captureUsageGuidePosition(scroller, sections, getOffset());
    workspace.classList.add('usage-guide-switching');
    const update = () => {
      apply();
      updateLayout(false);
      restoreUsageGuidePosition(scroller, position, getOffset());
      updateLayout();
    };
    try {
      if (reduceMotion?.matches || !workspace.startViewTransition || request !== revision) {
        update();
        return;
      }
      // Snapshot the bounded workspace, never the full-length guide or the app's other panels.
      transition = workspace.startViewTransition(update);
      // A rapid reversal can skip the snapshot; its DOM update still runs exactly once.
      transition.ready.catch(() => {});
      await transition.finished;
    } finally {
      transition = null;
      workspace.classList.remove('usage-guide-switching');
    }
  }

  return function transitionSidebar(apply) {
    const request = ++revision;
    transition?.skipTransition();
    pending = pending.then(() => switchLayout(apply, request));
    return pending;
  };
}
