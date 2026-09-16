'use strict';

(function initLicenseMotion() {
  const art = document.getElementById('licenseArt');
  const toggle = document.getElementById('licenseMotionToggle');
  if (!art || !toggle) return;

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let userPaused = false;
  let visible = false;

  function syncMotion() {
    const paused =
      userPaused || reducedMotion.matches || document.hidden || !visible;
    art.style.setProperty(
      '--license-motion-play-state',
      paused ? 'paused' : 'running',
    );
    toggle.hidden = reducedMotion.matches;
    toggle.dataset.paused = String(userPaused);
    toggle.title = userPaused ? '播放动画' : '暂停动画';
    toggle.setAttribute('aria-label', toggle.title);
  }

  function toggleMotion() {
    userPaused = !userPaused;
    syncMotion();
  }

  const observer = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    syncMotion();
  });
  observer.observe(art);
  toggle.addEventListener('click', toggleMotion);
  document.addEventListener('visibilitychange', syncMotion);
  reducedMotion.addEventListener('change', syncMotion);
  window.addEventListener('pagehide', () => {
    observer.disconnect();
    toggle.removeEventListener('click', toggleMotion);
    document.removeEventListener('visibilitychange', syncMotion);
    reducedMotion.removeEventListener('change', syncMotion);
    art.style.setProperty('--license-motion-play-state', 'paused');
  });
  syncMotion();
})();
