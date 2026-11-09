const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';

// Positions are percentages of the composition, scales relative to the fitted
// phrase. Every scene keeps earlier phrases readable while the new one arrives.
export function advancedLyricComposition(layout, index, phase, count) {
  if (layout === 'focus-lens') return index === phase || count === 1
    ? { x: 50, y: 55, scale: 1, rotation: 0 }
    : { x: index % 2 ? 74 : 26, y: 14 + Math.floor(index / 2) * 15, scale: 0.44, rotation: index % 2 ? 2 : -2 };
  if (layout === 'page-turn') {
    const age = phase - index;
    return age === 0 || count === 1 ? { x: 50, y: 65, scale: 1, rotation: 0, tilt: 0 }
      : { x: 50, y: 43 - (age - 1) * 13, scale: Math.max(0.32, 0.43 - (age - 1) * 0.035), rotation: 0, tilt: 0 };
  }
  if (phase === 0 || count === 1) return { x: 50, y: 48, scale: 1, rotation: 0 };
  const active = index === phase;
  if (layout === 'corner-relay') {
    if (phase === 1) return active ? { x: 56, y: 63, scale: 0.9, rotation: 3 }
      : { x: 30, y: 29, scale: 0.64, rotation: -4 };
    return active ? { x: 50, y: phase > 2 ? 73 : 69, scale: 1, rotation: 0 }
      : { x: index % 2 ? 74 : 26, y: 22 + Math.floor(index / 2) * 23,
        scale: 0.46, rotation: index % 2 ? 3 : -3 };
  }
  if (layout === 'type-impact') {
    if (phase === 1) return active ? { x: 50, y: 61, scale: 1, rotation: 0 }
      : { x: 50, y: 24, scale: 0.52, rotation: 0 };
    return active ? { x: 50, y: phase > 2 ? 72 : 62, scale: 1, rotation: -2 }
      : { x: index % 2 ? 74 : 26, y: 21 + Math.floor(index / 2) * 22, scale: 0.46, rotation: 0 };
  }
  if (phase > 2) return active ? { x: 50, y: 77, scale: 1, rotation: 0 }
    : { x: 50, y: 14 + index * 14, scale: 0.55, rotation: 0 };
  return active ? { x: 50, y: phase === 1 ? 57 : 70, scale: 1, rotation: 0 }
    : { x: 50, y: phase === 1 ? 27 : 19 + index * 23, scale: phase === 1 ? 0.68 : 0.6, rotation: 0 };
}

function transform(state, final, amount) {
  const fold = state.tilt === undefined ? '' : ` perspective(900px) rotateX(${state.tilt * amount}deg)`;
  return `translate(calc(var(--advanced-stage-width) * ${(state.x - final.x) / 100}), calc(var(--advanced-stage-height) * ${(state.y - final.y) / 100})) rotate(${state.rotation * amount}deg)${fold} scale(${state.scale})`;
}

// One spatial track per phrase prevents overlapping animations from writing the
// same transform. The supplied clock remains authoritative even after a seek.
export function buildAdvancedLyricChoreography(layout, items, units, { startMs, endMs, duration, amount, hideUnsung }) {
  const starts = [];
  for (const item of items) starts.push(Math.min(endMs, Math.max(starts.at(-1) ?? startMs,
    item.startMs ?? Math.min(...units.slice(item.start, item.end).map(unit => unit.startMs + (unit.endMs - unit.startMs) * unit.fillStart)))));
  return items.map((item, index) => {
    const final = advancedLyricComposition(layout, index, items.length - 1, items.length);
    const pace = Math.max(0.3, Math.min(1, ((starts[index + 1] ?? endMs) - starts[index]) / 1600));
    const strength = amount * pace * (item.phraseReveal ? 0.7 : 1);
    if (!hideUnsung) return { frames: [{ transform: transform(final, final, strength), opacity: 1 }],
      poses: [{ ...final, rotation: final.rotation * strength }], startMs, endMs };
    const first = advancedLyricComposition(layout, index, index, items.length);
    const enter = { ...first };
    if (layout === 'focus-lens') {
      enter.y += 19 * strength;
      enter.scale *= 0.9;
    } else if (layout === 'page-turn') {
      enter.y += 13 * strength;
      enter.scale *= 0.92;
      enter.tilt = -28;
    } else if (layout === 'corner-relay') {
      enter.x += (index % 2 ? 1 : -1) * 7 * strength;
      if (index) enter.y += 4 * strength;
      if (!index) enter.rotation -= 8;
      enter.scale *= 0.9;
    } else if (layout === 'type-impact') {
      enter.scale *= 1 + 0.12 * strength;
      enter.y += 3 * strength;
    } else {
      enter.y += 7 * strength;
      enter.scale *= 1 - 0.04 * strength;
    }
    const trackStart = Math.max(startMs, starts[index]);
    const sungEnd = Math.max(...units.slice(item.start, item.end).map(unit => unit.startMs + (unit.endMs - unit.startMs) * unit.fillEnd));
    const points = [];
    const add = (time, state, opacity, easing = EASE) => points.push({ time, transform: transform(state, final, strength),
      pose: { ...state, rotation: state.rotation * strength }, opacity, easing });
    add(trackStart, enter, 1);
    let settled = first;
    let opacity = 1;
    for (let phase = index; phase < items.length; phase++) {
      const begin = Math.max(trackStart, starts[phase]);
      const next = Math.max(begin, Math.min(endMs, starts[phase + 1] ?? endMs));
      // Reserve most of each phrase for reading; fast arrivals also travel less.
      const span = phase === index ? Math.min(duration, (next - begin) * 0.32)
        : Math.min(duration * 0.45, (next - begin) * 0.18, (begin - starts[phase - 1]) * 0.35);
      // Use a known pause to clear the incoming phrase's space. Estimated LRC
      // phrases can yield after their reading hold; supplied vocals keep their
      // position until their sung interval ends.
      const moveStart = phase === index ? begin : Math.min(begin,
        Math.max(points.at(-1).time, begin - span, item.phraseReveal ? starts[phase - 1] : sungEnd));
      if (phase > index) add(moveStart, settled, opacity);
      settled = advancedLyricComposition(layout, index, phase, items.length);
      const age = phase - index;
      opacity = age === 0 ? 1 : Math.max(item.emphasis ? 0.68 : 0.5, (item.emphasis ? 0.88 : 0.76) - (age - 1) * 0.08);
      add(moveStart + span, settled, opacity);
    }
    add(endMs, settled, opacity, 'linear');
    // Degenerate/overlapping source timestamps still produce ordered offsets.
    const frames = points.map(point => ({ transform: point.transform, opacity: point.opacity, easing: point.easing,
      offset: Math.max(0, Math.min(1, (point.time - trackStart) / Math.max(1, endMs - trackStart))) }));
    return { frames, poses: points.map(point => point.pose), startMs: trackStart, endMs, easing: 'linear' };
  });
}
