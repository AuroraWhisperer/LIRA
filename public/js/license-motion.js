'use strict';

(function initLicenseMotion() {
  const art = document.getElementById('licenseArt');
  if (!art) return;

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let visible = false;

  function syncMotion() {
    const paused = reducedMotion.matches || document.hidden || !visible;
    art.style.setProperty('--license-motion-play-state', paused ? 'paused' : 'running');
  }

  const observer = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    syncMotion();
  });
  observer.observe(art);
  document.addEventListener('visibilitychange', syncMotion);
  reducedMotion.addEventListener('change', syncMotion);
  window.addEventListener('pagehide', () => {
    observer.disconnect();
    document.removeEventListener('visibilitychange', syncMotion);
    reducedMotion.removeEventListener('change', syncMotion);
    art.style.setProperty('--license-motion-play-state', 'paused');
  });
  syncMotion();
})();
