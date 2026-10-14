// Playback line changes keep their visual positions while the visible window moves.
export function createLyricLineTransition(viewport, timeline) {
  const running = new Set();

  function clear() {
    for (const entry of running) {
      entry.animation.onfinish = null;
      entry.animation.cancel();
      entry.ghost?.remove();
    }
    running.clear();
  }

  function animate(element, frames, duration, ghost = null) {
    const animation = element.animate(frames, {
      duration,
      easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
    });
    const entry = { animation, ghost };
    running.add(entry);
    animation.onfinish = () => {
      ghost?.remove();
      running.delete(entry);
    };
  }

  function capture(rows, nextRange) {
    const positions = new Map();
    for (const [index, row] of rows.entries()) {
      if (!row.offsetHeight) continue;
      const style = getComputedStyle(row);
      const translateY = Number.parseFloat(style.translate.split(' ')[1]) || 0;
      const top = row.offsetTop - viewport.scrollTop + translateY;
      if (top + row.offsetHeight < 0 || top > viewport.clientHeight) continue;
      const position = { top, opacity: style.opacity };
      if (index < nextRange.first || index > nextRange.last) {
        const ghost = row.cloneNode(true);
        const sourceWords = row.querySelectorAll('.desktop-lyric-preview-word, .desktop-lyric-preview-word-highlight');
        const ghostWords = ghost.querySelectorAll('.desktop-lyric-preview-word, .desktop-lyric-preview-word-highlight');
        // Cloning a node does not copy its live karaoke animations.
        sourceWords.forEach((word, wordIndex) => {
          const wordStyle = getComputedStyle(word);
          Object.assign(ghostWords[wordIndex].style, {
            transform: wordStyle.transform, clipPath: wordStyle.clipPath, opacity: wordStyle.opacity,
          });
        });
        ghost.classList.add('is-line-exiting');
        ghost.removeAttribute('data-lyric-index');
        ghost.setAttribute('aria-hidden', 'true');
        Object.assign(ghost.style, {
          left: `${row.offsetLeft}px`, width: `${row.offsetWidth}px`, opacity: style.opacity,
          transform: style.transform, filter: style.filter, background: style.background, boxShadow: style.boxShadow,
        });
        position.ghost = ghost;
      }
      positions.set(row, position);
    }
    // Read the interrupted frame before releasing the previous transitions.
    clear();
    return positions;
  }

  function play(rows, positions) {
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    for (const row of rows) {
      if (!row.offsetHeight) continue;
      const top = row.offsetTop - viewport.scrollTop;
      if (top + row.offsetHeight < 0 || top > viewport.clientHeight) continue;
      const previous = positions.get(row);
      const distance = reducedMotion ? 0 : previous ? previous.top - top : Math.min(24, row.offsetHeight / 3);
      if (previous && Math.abs(distance) < 0.5) continue;
      const from = { translate: `0 ${distance}px` };
      const to = { translate: '0 0' };
      if (!previous) {
        from.opacity = 0;
        to.opacity = getComputedStyle(row).opacity;
      }
      animate(row, [from, to], reducedMotion ? 140 : 360);
    }
    for (const { top, opacity, ghost } of positions.values()) {
      if (!ghost) continue;
      ghost.style.top = `${top + viewport.scrollTop}px`;
      timeline.appendChild(ghost);
      animate(ghost, [
        { translate: '0 0', opacity },
        { translate: reducedMotion ? '0 0' : '0 -18px', opacity: 0 },
      ], reducedMotion ? 140 : 180, ghost);
    }
  }

  return { capture, play, clear };
}
