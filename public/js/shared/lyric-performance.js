'use strict';

const LONG_FRAME_MS = 45;
const DEGRADE_AFTER = 4;
const RECOVER_AFTER = 30;
const STATIC_RECOVER_AFTER = 150;

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
        if (longFrames >= DEGRADE_AFTER && profile.wordAnimation === 'waapi') {
          publish({ wordAnimation: 'manual', effects: 'low' });
        } else if (longFrames >= DEGRADE_AFTER && profile.wordAnimation === 'manual') {
          publish({ wordAnimation: 'static', effects: 'low' });
        }
      } else {
        longFrames = 0;
        healthyFrames += 1;
        if (healthyFrames >= STATIC_RECOVER_AFTER && profile.wordAnimation === 'static' && !reducedMotion) {
          publish({ wordAnimation: 'manual', effects: 'low' });
        } else if (healthyFrames >= RECOVER_AFTER && profile.wordAnimation === 'manual' && !reducedMotion) {
          publish({ wordAnimation: 'waapi', effects: 'full' });
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
