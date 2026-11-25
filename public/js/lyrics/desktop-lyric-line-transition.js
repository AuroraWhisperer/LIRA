function viewportIndexes(rows, range, scrollTop, clientHeight) {
  const first = range?.first ?? 0;
  const last = range?.last ?? rows.length - 1;
  const indexes = new Set();
  if (clientHeight <= 0) return indexes;

  // In-flow rows in the displayed range are ordered. The preceding row may be tall enough to overlap.
  let low = first, high = last + 1;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (rows[mid].offsetTop < scrollTop) low = mid + 1;
    else high = mid;
  }
  for (let index = Math.max(first, low - 1); index <= last; index++) {
    if (rows[index].offsetTop > scrollTop + clientHeight) break;
    indexes.add(index);
  }
  return indexes;
}

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

  function animate(element, frames, duration, { index, ghost }) {
    const animation = element.animate(frames, {
      duration,
      easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
    });
    const entry = { animation, index, ghost };
    running.add(entry);
    animation.onfinish = () => {
      ghost?.remove();
      running.delete(entry);
    };
  }

  function capture(rows, nextRange, visibleRange) {
    const positions = new Map();
    const { scrollTop, clientHeight } = viewport;
    const indexes = viewportIndexes(rows, visibleRange, scrollTop, clientHeight);
    // An unfinished translation can keep a row on screen after its layout box has scrolled out.
    for (const { index } of running) {
      if (index !== undefined) indexes.add(index);
    }
    for (const index of indexes) {
      const row = rows[index];
      const height = row.offsetHeight;
      if (!height) continue;
      const style = getComputedStyle(row);
      const translateY = Number.parseFloat(style.translate.split(' ')[1]) || 0;
      const top = row.offsetTop - scrollTop + translateY;
      if (top + height < 0 || top > clientHeight) continue;
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

  function play(rows, positions, visibleRange) {
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const { scrollTop, clientHeight } = viewport;
    const entering = [];
    for (const index of viewportIndexes(rows, visibleRange, scrollTop, clientHeight)) {
      const row = rows[index];
      const height = row.offsetHeight;
      if (!height) continue;
      const top = row.offsetTop - scrollTop;
      if (top + height < 0 || top > clientHeight) continue;
      const previous = positions.get(row);
      const distance = reducedMotion ? 0 : previous ? previous.top - top : Math.min(24, height / 3);
      if (previous && Math.abs(distance) < 0.5) continue;
      const from = { translate: `0 ${distance}px` };
      const to = { translate: '0 0' };
      if (!previous) {
        from.opacity = 0;
        to.opacity = getComputedStyle(row).opacity;
      }
      entering.push({ index, frames: [from, to] });
    }
    for (const { index, frames } of entering) animate(rows[index], frames, reducedMotion ? 140 : 360, { index });
    for (const { top, opacity, ghost } of positions.values()) {
      if (!ghost) continue;
      ghost.style.top = `${top + scrollTop}px`;
      timeline.appendChild(ghost);
      animate(ghost, [
        { translate: '0 0', opacity },
        { translate: reducedMotion ? '0 0' : '0 -18px', opacity: 0 },
      ], reducedMotion ? 140 : 180, { ghost });
    }
  }

  return { capture, play, clear };
}
