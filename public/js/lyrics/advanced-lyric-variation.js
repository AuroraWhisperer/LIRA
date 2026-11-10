function textSeed(text) {
  let seed = 2166136261;
  for (let index = 0; index < text.length; index++) seed = Math.imul(seed ^ text.charCodeAt(index), 16777619);
  return seed >>> 0;
}

// Text determines the visual identity; timing only adjusts its energy. Repeated
// lines therefore keep their treatment even when sung faster or reached by seek.
export function describeAdvancedLyricLine(units, trackTitle = '') {
  const text = units.map(unit => unit.text).join('').normalize('NFKC');
  const identity = text.replace(/[\s\p{P}]/gu, '').toLowerCase();
  const seed = textSeed(`${trackTitle}\n${identity}`);
  let length = 0;
  for (const character of identity) length += /[\x20-\x7e]/u.test(character) ? 0.55 : 1;
  const starts = units.map(unit => unit.startMs + (unit.endMs - unit.startMs) * unit.fillStart);
  const ends = units.map(unit => unit.startMs + (unit.endMs - unit.startMs) * unit.fillEnd);
  const span = units.length ? Math.max(...ends) - Math.min(...starts) : 0;
  const density = length / Math.max(0.25, span / 1000);
  return { seed, direction: seed % 2 ? 1 : -1, variant: (seed >>> 1) % 3,
    length, density, compact: length > 28 || density > 6.5 || units.some(unit => unit.revealAsRun),
    pace: Math.max(0.3, Math.min(1, 4.2 / Math.max(2, density))) };
}

export function resolveAdvancedLyricLayout(layout, profile) {
  if (layout !== 'adaptive') return layout;
  const choices = profile.length <= 6
    ? ['paper-fold', 'echo-trail', 'prism-scatter', 'ink-trace']
    : profile.length > 24
      ? ['ink-trace', 'block-handoff', 'page-turn', 'phrase-flow']
      : ['paper-fold', 'ink-trace', 'echo-trail', 'block-handoff', 'ribbon-arc', 'prism-scatter', 'depth-stack', 'flow-drift'];
  return choices[profile.seed % choices.length];
}
