'use strict';

// Each half clips the same full-height glyph, so it stays aligned at the hinge.
function createFlipCell(host) {
  host.classList.add('clock-flip-cell');
  host.setAttribute('role', 'img');
  const halves = ['top', 'bottom', 'outgoing', 'incoming'].map((name) => {
    const half = document.createElement('span');
    half.className = `clock-flip-half is-${name}`;
    half.setAttribute('aria-hidden', 'true');
    const text = document.createElement('span');
    half.append(text);
    return { half, text };
  });
  host.replaceChildren(...halves.map(({ half }) => half));
  const [top, bottom, outgoing, incoming] = halves;
  let current = null;
  let animations = [];

  function settle() {
    for (const animation of animations) {
      animation.onfinish = null;
      animation.cancel();
    }
    animations = [];
    top.text.textContent = current;
    bottom.text.textContent = current;
  }

  return {
    update(value, animate) {
      if (value === current) {
        if (!animate) settle();
        return;
      }
      const previous = current;
      current = value;
      settle();
      host.setAttribute('aria-label', value);
      if (previous === null || !animate) return;
      bottom.text.textContent = previous;
      outgoing.text.textContent = previous;
      incoming.text.textContent = value;
      animations = [
        outgoing.half.animate(
          [{ transform: 'rotateX(0deg)', visibility: 'visible' }, { transform: 'rotateX(-90deg)', visibility: 'visible' }],
          { duration: 240, easing: 'ease-in', fill: 'forwards' },
        ),
        incoming.half.animate(
          [{ transform: 'rotateX(90deg)', visibility: 'visible' }, { transform: 'rotateX(0deg)', visibility: 'visible' }],
          { duration: 300, delay: 240, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', fill: 'both' },
        ),
      ];
      animations[1].onfinish = settle;
    },
    dispose() {
      settle();
      host.classList.remove('clock-flip-cell');
      host.removeAttribute('role');
      host.removeAttribute('aria-label');
      host.replaceChildren();
    },
  };
}

export { createFlipCell };
