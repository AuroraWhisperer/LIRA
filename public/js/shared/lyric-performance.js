'use strict';

const LONG_FRAME_MS = 45;
const DEGRADE_AFTER = 4;
const RECOVER_AFTER = 30;

export function createLyricPerformanceProfile(options = {}) {
  const onChange = options.onChange || (() => {});
  const reducedMotion =
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const profile = {
    targetFps: 30,
    wordAnimation: reducedMotion ? 'static' : 'waapi',
    effects: reducedMotion ? 'low' : 'full',
  };
  let longFrames = 0;
  let healthyFrames = 0;
  let visible = true;

  function publish(next) {
    longFrames = 0;
    healthyFrames = 0;
    Object.assign(profile, next);
    onChange({ ...profile });
  }

  return {
    profile,
    recordFrame(duration) {
      const frameMs = Number(duration);
      // Immediate state redraws have no measured frame interval.
      if (!visible || !(frameMs > 0)) return { ...profile };
      if (frameMs > LONG_FRAME_MS) {
        longFrames += 1;
        healthyFrames = 0;
        if (longFrames >= DEGRADE_AFTER && profile.effects === 'full') {
          // Keep continuous fill on the browser timeline when JS frames are slow.
          publish({ effects: 'low' });
        }
      } else {
        longFrames = 0;
        healthyFrames += 1;
        if (healthyFrames >= RECOVER_AFTER && profile.effects === 'low' && !reducedMotion) {
          publish({ effects: 'full' });
        }
      }
      return { ...profile };
    },
    setVisible(nextVisible) {
      visible = nextVisible !== false;
      if (!visible)
        publish({
          wordAnimation: reducedMotion ? 'static' : 'waapi',
          effects: reducedMotion ? 'low' : 'full',
        });
    },
    dispose() {
      visible = false;
    },
  };
}
