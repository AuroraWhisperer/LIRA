// Keep nearby jumps continuous and avoid scrolling past whole chapters for distant ones.
export function createUsageGuideMotion(scroller, reduceMotion) {
  let active = null;
  let frame = null;
  let animation = null;

  function cancel() {
    active = null;
    if (frame !== null) window.cancelAnimationFrame(frame);
    frame = null;
    animation?.cancel();
    animation = null;
  }

  function move(getDestination, onArrive) {
    cancel();
    const request = {};
    active = request;
    const internal = window.getComputedStyle(scroller).overflowY === 'auto';
    const scrollRoot = internal ? scroller : window;
    const start = internal ? scroller.scrollTop : window.scrollY;
    const viewport = internal ? scroller.clientHeight : window.innerHeight;
    const destination = () => Math.max(0, Math.min(getDestination(),
      (internal ? scroller.scrollHeight : document.documentElement.scrollHeight) - viewport));
    const end = destination();
    const distance = end - start;
    const scrollTo = (top) => scrollRoot.scrollTo({ top, behavior: 'instant' });
    const finish = () => {
      if (active !== request) return;
      cancel();
      onArrive();
    };

    if (reduceMotion?.matches || Math.abs(distance) < 1) {
      scrollTo(end);
      // Let content-visibility remember the laid-out chapter sizes before restoring lazy rendering.
      frame = window.requestAnimationFrame(() => {
        if (active !== request) return;
        scrollTo(destination());
        finish();
      });
      return;
    }

    if (Math.abs(distance) > viewport) {
      // Only fade the bounded reading viewport, never rasterize the full document.
      const exit = scroller.animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: 80, easing: 'ease-in', fill: 'forwards',
      });
      animation = exit;
      exit.finished.then(() => {
        if (active !== request) return;
        scrollTo(destination());
        animation = scroller.animate([{ opacity: 0 }, { opacity: 1 }], {
          duration: 160, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', fill: 'both',
        });
        exit.cancel();
        animation.finished.then(finish, () => {});
      }, () => {});
      return;
    }

    const duration = Math.min(300, 160 + Math.abs(distance) * 0.15);
    const started = window.performance.now();
    const step = (now) => {
      if (active !== request) return;
      const progress = Math.min(1, (now - started) / duration);
      scrollTo(start + distance * (1 - (1 - progress) ** 3));
      if (progress < 1) frame = window.requestAnimationFrame(step);
      else {
        scrollTo(destination());
        finish();
      }
    };
    frame = window.requestAnimationFrame(step);
  }

  return { move, cancel };
}
