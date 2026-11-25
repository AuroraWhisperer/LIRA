// The page owns the clock source. Wake only when its displayed second changes.
export function createVisibleCountdown(update) {
  let timer;
  let disposed = false;
  function sync() {
    clearTimeout(timer);
    if (disposed || document.hidden) return;
    const remaining = update();
    if (remaining > 0) timer = setTimeout(sync, Math.ceil(remaining % 1000 || 1000));
  }
  document.addEventListener('visibilitychange', sync);
  return { sync, dispose() {
    disposed = true;
    clearTimeout(timer);
    document.removeEventListener('visibilitychange', sync);
  } };
}
