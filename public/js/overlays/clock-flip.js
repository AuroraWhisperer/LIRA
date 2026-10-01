'use strict';

// Paint the settled glyph once to avoid seams between scaled, animated halves.
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
  const valueText = document.createElement('span');
  valueText.className = 'clock-flip-value';
  valueText.setAttribute('aria-hidden', 'true');
  host.replaceChildren(...halves.map(({ half }) => half), valueText);
  const [top, bottom, outgoing, incoming] = halves;
  let current = null;
  let animations = [];

  function settle() {
    for (const animation of animations) {
      animation.onfinish = null;
      animation.cancel();
    }
    animations = [];
    host.classList.remove('is-flipping');
    top.text.textContent = current;
    bottom.text.textContent = current;
    valueText.textContent = current;
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
      host.classList.add('is-flipping');
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
