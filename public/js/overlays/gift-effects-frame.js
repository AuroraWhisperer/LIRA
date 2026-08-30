'use strict';

export function createFrameController({ frameRoot, formatAmount }) {
  const artwork = document.getElementById('giftFrameArtworkImage');
  const accents = Array.from(document.querySelectorAll('[data-frame-accent]'));
  const info = {
    root: frameRoot,
    plate: document.getElementById('giftInfo'),
    name: document.getElementById('giftInfoName'),
    amount: document.getElementById('giftInfoAmount'),
    user: document.getElementById('giftInfoUser'),
    num: document.getElementById('giftInfoNum'),
  };

  return {
    prepare(payload, motionMode) {
      info.name.textContent = payload.giftName;
      info.amount.textContent = formatAmount(payload.totalPriceCents);
      info.user.textContent = payload.userName;
      info.num.textContent = String(payload.num);
      info.root.dataset.motion = motionMode;
      info.root.classList.add('is-playing');
      info.root.style.opacity = '1';
      artwork.style.opacity = '0';
      artwork.style.transform = '';
      artwork.style.clipPath = '';
      accents.forEach((accent) => {
        accent.style.opacity = '0';
        accent.style.transform = '';
      });
      info.plate.style.opacity = '0';
      info.plate.style.transform = 'translate(-50%, -50%)';
    },
    async playEnterTimeline(session, motionMode) {
      const reduced = motionMode === 'reduced';
      const animations = [
        animateNode(
          artwork,
          frameEnterKeyframes(artwork, reduced),
          reduced ? 180 : 620,
          0,
          session,
        ),
      ];
      accents
        .filter((accent) => !accent.hidden)
        .forEach((accent) =>
          animations.push(
            animateNode(
              accent,
              accentEnterKeyframes(accent, reduced),
              reduced ? 180 : accentEnterDuration(accent),
              reduced ? 0 : accentEnterDelay(accent),
              session,
            ),
          ),
        );
      animations.push(
        animateNode(
          info.plate,
          [{ opacity: 0 }, { opacity: 1 }],
          reduced ? 180 : 250,
          reduced ? 0 : 558,
          session,
        ),
        animateNode(
          info.name,
          [{ opacity: 0 }, { opacity: 1 }],
          180,
          reduced ? 0 : 738,
          session,
        ),
        animateNode(
          info.amount,
          [{ opacity: 0 }, { opacity: 1 }],
          180,
          reduced ? 0 : 738,
          session,
        ),
        animateNode(
          info.user,
          [{ opacity: 0 }, { opacity: 1 }],
          reduced ? 180 : 160,
          reduced ? 0 : 810,
          session,
        ),
        animateNode(
          info.num,
          [{ opacity: 0 }, { opacity: 1 }],
          reduced ? 180 : 160,
          reduced ? 0 : 810,
          session,
        ),
      );
      await Promise.all(animations);
      session.throwIfAborted();
    },
    playHoldingAccents(session, motionMode) {
      if (motionMode === 'reduced') return;
      accents
        .filter((accent) => !accent.hidden)
        .forEach((accent) => {
          const motion = accentHoldingMotion(accent);
          void animateNode(
            accent,
            motion.keyframes,
            motion.duration,
            motion.delay,
            session,
          );
        });
      session.throwIfAborted();
    },
    async playExitTimeline(session, motionMode) {
      const reduced = motionMode === 'reduced';
      const animations = [
        animateNode(
          info.plate,
          [{ opacity: 1 }, { opacity: 0 }],
          reduced ? 180 : 260,
          0,
          session,
        ),
        animateNode(
          artwork,
          frameExitKeyframes(artwork, reduced),
          reduced ? 180 : 440,
          0,
          session,
        ),
      ];
      accents
        .filter((accent) => !accent.hidden)
        .forEach((accent) =>
          animations.push(
            animateNode(
              accent,
              [
                { opacity: 1, transform: 'translate(0, 0) rotate(0)' },
                {
                  opacity: 0,
                  transform: accentExitTransform(accent, reduced),
                },
              ],
              reduced ? 180 : 320,
              reduced ? 0 : accentExitDelay(accent),
              session,
            ),
          ),
        );
      await Promise.all(animations);
      session.throwIfAborted();
    },
    reset() {
      info.root.classList.remove('is-playing');
      info.root.removeAttribute('data-motion');
      info.root.style.opacity = '';
      artwork.style.opacity = '';
      artwork.style.transform = '';
      artwork.style.clipPath = '';
      accents.forEach((accent) => {
        accent.style.opacity = '';
        accent.style.transform = '';
      });
      info.plate.style.opacity = '';
      info.plate.style.transform = '';
      info.name.textContent = '';
      info.amount.textContent = '';
      info.user.textContent = '';
      info.num.textContent = '';
    },
  };
}

function animateNode(node, keyframes, duration, delay, session) {
  if (!node?.animate) return delayFor(duration + delay);
  const animation = node.animate(keyframes, {
    duration,
    delay,
    easing: 'cubic-bezier(.22,.75,.25,1)',
    fill: 'both',
  });
  session?.animations.push(animation);
  return animation.finished.catch(() => {});
}

function edgeOffset(part) {
  const name = part.dataset.framePart || '';
  if (name.includes('top')) return 'translate(0, -36px)';
  if (name.includes('bottom')) return 'translate(0, 36px)';
  if (name.includes('right')) return 'translate(36px, 0)';
  if (name.includes('left')) return 'translate(-36px, 0)';
  return 'translate(0, 0)';
}

function frameHiddenClip(part) {
  const name = part.dataset.framePart || '';
  if (name === 'top') return 'inset(0 0 74% 0)';
  if (name === 'bottom') return 'inset(74% 0 0 0)';
  if (name === 'right') return 'inset(0 0 0 68%)';
  if (name === 'left') return 'inset(0 68% 0 0)';
  return 'inset(0)';
}

function frameEnterKeyframes(part, reduced) {
  if (reduced) return [{ opacity: 0 }, { opacity: 1 }];
  return [
    {
      opacity: 0,
      transform: edgeOffset(part),
      clipPath: frameHiddenClip(part),
    },
    { opacity: 1, transform: 'translate(0, 0)', clipPath: 'inset(0)' },
  ];
}

function frameExitKeyframes(part, reduced) {
  if (reduced) return [{ opacity: 1 }, { opacity: 0 }];
  return [
    { opacity: 1, transform: 'translate(0, 0)', clipPath: 'inset(0)' },
    {
      opacity: 0,
      transform: edgeOffset(part),
      clipPath: frameHiddenClip(part),
    },
  ];
}

function accentEnterKeyframes(accent, reduced) {
  if (reduced) return [{ opacity: 0 }, { opacity: 1 }];
  const name = accent.dataset.frameAccent || '';
  if (name === 'branch') {
    return [
      { opacity: 0, transform: 'translate(0, -7px) rotate(-1.8deg)' },
      { opacity: 1, transform: 'translate(0, 0) rotate(0)' },
    ];
  }
  if (name === 'crystal') {
    return [
      { opacity: 0, transform: 'translate(0, -6px) rotate(2.4deg)' },
      { opacity: 1, transform: 'translate(0, 0) rotate(0)' },
    ];
  }
  return [
    { opacity: 0, transform: 'translate(-4px, 5px) rotate(-2deg)' },
    { opacity: 1, transform: 'translate(0, 0) rotate(0)' },
  ];
}

function accentEnterDuration(accent) {
  return accent.dataset.frameAccent === 'branch' ? 480 : 400;
}

function accentEnterDelay(accent) {
  const delays = { branch: 260, crystal: 350, floral: 430 };
  return delays[accent.dataset.frameAccent] || 0;
}

function accentHoldingMotion(accent) {
  const name = accent.dataset.frameAccent || '';
  if (name === 'branch') {
    return {
      duration: 1040,
      delay: 120,
      keyframes: [
        { transform: 'translate(0, 0) rotate(0)' },
        { transform: 'translate(2px, 1px) rotate(.9deg)', offset: 0.34 },
        { transform: 'translate(-1px, 0) rotate(-.65deg)', offset: 0.7 },
        { transform: 'translate(0, 0) rotate(0)' },
      ],
    };
  }
  if (name === 'crystal') {
    return {
      duration: 1080,
      delay: 360,
      keyframes: [
        { transform: 'translate(0, 0) rotate(0)' },
        { transform: 'translate(1px, 1px) rotate(2.6deg)', offset: 0.3 },
        { transform: 'translate(-1px, 1px) rotate(-1.8deg)', offset: 0.66 },
        { transform: 'translate(0, 0) rotate(0)' },
      ],
    };
  }
  return {
    duration: 820,
    delay: 660,
    keyframes: [
      { transform: 'translate(0, 0) rotate(0)' },
      { transform: 'translate(2px, -1px) rotate(1.2deg)', offset: 0.42 },
      { transform: 'translate(-1px, 0) rotate(-.7deg)', offset: 0.74 },
      { transform: 'translate(0, 0) rotate(0)' },
    ],
  };
}

function accentExitTransform(accent, reduced) {
  if (reduced) return 'translate(0, 0) rotate(0)';
  const name = accent.dataset.frameAccent || '';
  if (name === 'branch') return 'translate(0, -6px) rotate(-1deg)';
  if (name === 'crystal') return 'translate(0, -5px) rotate(1.8deg)';
  return 'translate(-3px, 4px) rotate(-1deg)';
}

function accentExitDelay(accent) {
  const delays = { floral: 20, crystal: 70, branch: 120 };
  return delays[accent.dataset.frameAccent] || 0;
}

function delayFor(duration) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, duration)));
}
