// Keep the visible reading position when the toolbox changes the guide's layout.
export function createUsageGuideSidebarTransition({ panel, scroller, sections, updateLayout, getOffset, reduceMotion }) {
  const workspace = panel.closest('.other-workspace');
  let transition = null;
  let pending = Promise.resolve();
  let revision = 0;

  function readingMarker() {
    return scroller.getBoundingClientRect().top + getOffset() + 1;
  }

  function capturePosition() {
    if (scroller.scrollTop <= 8) return null;
    const marker = readingMarker();
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

  async function switchLayout(apply, request) {
    if (panel.hidden || !panel.getClientRects().length || window.getComputedStyle(scroller).overflowY !== 'auto') {
      apply();
      return;
    }
    for (const animation of panel.getAnimations()) {
      if (animation.animationName === 'other-feature-panel-enter') animation.finish();
    }
    const position = capturePosition();
    workspace.classList.add('usage-guide-switching');
    const update = () => {
      apply();
      updateLayout(false);
      if (position) {
        const rect = position.target.getBoundingClientRect();
        scroller.scrollTop += rect.top + rect.height * position.fraction - readingMarker();
      } else {
        scroller.scrollTop = 0;
      }
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
