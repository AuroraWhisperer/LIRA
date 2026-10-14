// Shared positioning for the full player and its scaled appearance preview.
export function scrollActiveLyricIntoView(container, { center = false } = {}) {
  const line = container.querySelector('.player-fs-lyric-line.active');
  if (!line) return;
  const height = container.clientHeight;
  const anchor = height * (center ? 0.5 : 1 / 3);
  let target = Math.min(line.offsetTop, line.offsetTop - anchor + line.clientHeight / 2);
  const text = line.querySelector('.lyric-text');
  if (line.clientHeight > height && text?.firstChild) {
    // Large line-height adds leading before the glyphs. Start at the first glyph,
    // not that blank space; account for CSS zoom in the appearance preview.
    const range = container.ownerDocument.createRange();
    range.setStart(text.firstChild, 0);
    range.setEnd(text.firstChild, 1);
    const bounds = container.getBoundingClientRect();
    if (bounds.height > 0) {
      target = container.scrollTop + (range.getBoundingClientRect().top - bounds.top) * height / bounds.height;
      // Lyrics-only mode fades its edges; keep the first glyph below that fade.
      if (center) target -= height * 0.18;
    }
  }
  container.scrollTop = Math.max(0, target);
}
