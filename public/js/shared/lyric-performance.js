'use strict';

const LONG_FRAME_MS = 45;
const DEGRADE_AFTER = 4;
const RECOVER_AFTER = 30;

export function createLyricPerformanceProfile(options = {}) {
  const onChange = options.onChange || (() => {});
  const reducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const profile = {
    targetFps: 30,
    wordAnimation: reducedMotion ? 'static' : 'waapi',
    effects: reducedMotion ? 'low' : 'full',
  };
  let longFrames = 0;
  let healthyFrames = 0;
  let visible = true;

  function publish(next) {
    Object.assign(profile, next);
    onChange({ ...profile });
  }

  return {
    profile,
    recordFrame(duration) {
      if (!visible) return { ...profile };
      if (Number(duration) > LONG_FRAME_MS) {
        longFrames += 1;
        healthyFrames = 0;
        if (longFrames >= DEGRADE_AFTER && profile.wordAnimation !== 'static') {
          publish({ wordAnimation: 'manual', effects: 'low' });
        } else if (
          longFrames >= DEGRADE_AFTER &&
          profile.wordAnimation === 'manual'
        ) {
          publish({ wordAnimation: 'static', effects: 'low' });
        }
      } else {
        longFrames = 0;
        healthyFrames += 1;
        if (
          healthyFrames >= RECOVER_AFTER &&
          profile.wordAnimation === 'manual' &&
          !reducedMotion
        ) {
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
