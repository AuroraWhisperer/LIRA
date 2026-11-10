const TREATMENTS = new Set(['paper-fold', 'ink-trace', 'echo-trail', 'block-handoff', 'ribbon-arc', 'prism-scatter']);
const REST = 'translate(0, 0) rotate(0deg) scale(1)';

function span(document, className, text) {
  const node = document.createElement('span');
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// Extra marks live inside the existing reveal layer. They share its visibility,
// font metrics and playback clock, and disappear with the line's owned tracks.
export function addAdvancedLyricTreatment({ layout, reveal, glyph, ink, unit, index, ordinal, count,
  startMs, endMs, lineEndMs, duration, amount, profile, hideUnsung, reducedMotion, add }) {
  if (!TREATMENTS.has(layout) || !unit.text.trim()) return;
  const document = glyph.ownerDocument;
  const face = span(document, 'advanced-lyric-face');
  reveal.append(face);
  face.append(glyph);
  const strength = amount * profile.pace * (profile.compact ? 0.45 : 1);
  const direction = profile.direction;
  const attack = Math.max(1, Math.min(duration, 420, (endMs - startMs) * 0.6));
  const timing = { startMs, endMs: Math.min(lineEndMs, startMs + attack) };

  if (layout === 'ink-trace') {
    const outline = span(document, 'advanced-lyric-outline', unit.text);
    glyph.prepend(outline);
    // A contour reveal, not simulated Chinese stroke-order handwriting. The
    // solid face fills over the supplied vocal interval; LRC uses phrase time.
    add(ink, [{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)' }],
      { startMs, endMs, easing: 'linear' });
    if (hideUnsung && !reducedMotion) add(outline,
      [{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)' }], timing);
    return;
  }
  if (reducedMotion) return;

  if (layout === 'paper-fold') {
    face.style.transformOrigin = index % 2 ? '50% 100%' : '50% 0%';
    const fold = `perspective(500px) rotateX(${(index % 2 ? -1 : 1) * 66 * strength}deg)`;
    const shade = span(document, 'advanced-lyric-fold-shade');
    face.append(shade);
    add(face, [{ transform: hideUnsung ? fold : 'perspective(500px) rotateX(0deg)' },
      { transform: 'perspective(500px) rotateX(0deg)' }], timing);
    add(shade, [{ opacity: 0.24 * strength }, { opacity: 0 }], timing);
  } else if (layout === 'echo-trail') {
    const echoes = profile.compact ? 1 : 2;
    for (let depth = echoes; depth > 0; depth--) {
      const echo = span(document, 'advanced-lyric-echo', unit.text);
      echo.dataset.depth = String(depth);
      face.prepend(echo);
      const drift = `translate(${direction * depth * 0.24 * strength}em, ${depth * -0.1 * strength}em) scale(${1 + depth * 0.04 * strength})`;
      add(echo, [{ opacity: 0, transform: drift }, { opacity: (depth === 1 ? 0.32 : 0.17), transform: drift, offset: 0.12 },
        { opacity: 0, transform: REST }], timing);
    }
    if (hideUnsung) add(face, [{ transform: `translate(${-direction * 0.12 * strength}em, 0) scale(.96)` },
      { transform: REST }], timing);
  } else if (layout === 'block-handoff') {
    if (hideUnsung) add(face, [{ clipPath: `inset(0 ${direction > 0 ? '100%' : '0'} 0 ${direction > 0 ? '0' : '100%'})`,
      transform: `translate(${direction * -0.18 * strength}em, 0)` },
    { clipPath: 'inset(0 0 0 0)', transform: REST }], timing);
  } else if (layout === 'ribbon-arc') {
    const phase = count <= 1 ? 0 : index / (count - 1) * 2 - 1;
    const bend = profile.compact ? 0 : Math.min(1, count / 6) * strength;
    const rest = `translate(0, ${phase * phase * 0.16 * bend}em) rotate(${phase * 7 * bend * direction}deg)`;
    add(face, [{ transform: hideUnsung
      ? `translate(${direction * 0.14 * strength}em, ${0.24 * strength}em) rotate(${-direction * 12 * strength}deg)` : rest },
    { transform: rest }], timing);
  } else if (layout === 'prism-scatter') {
    const angle = (index + profile.variant * 3) * 2.399963;
    if (hideUnsung) add(face, [{ transform: `translate(${Math.cos(angle) * 0.35 * strength}em, ${Math.sin(angle) * 0.28 * strength}em) rotate(${Math.sin(angle) * 15 * strength}deg) scale(.94)` },
      { transform: REST }], timing);
    // Bound decorative work even for the 96-unit long-line fallback.
    if (!profile.compact && ordinal < 24) for (let point = 0; point < 2; point++) {
      const particle = span(document, 'advanced-lyric-particle');
      face.prepend(particle);
      const theta = angle + point * Math.PI;
      const from = `translate(${Math.cos(theta) * 0.8 * strength}em, ${Math.sin(theta) * 0.65 * strength}em) rotate(45deg) scale(.6)`;
      add(particle, [{ opacity: 0, transform: from }, { opacity: 0.75, transform: from, offset: 0.12 },
        { opacity: 0, transform: 'translate(0, 0) rotate(0deg) scale(0)' }], timing);
    }
  }
}
