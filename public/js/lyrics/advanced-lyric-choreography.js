import { describeAdvancedLyricLine } from './advanced-lyric-variation.js';

const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';

// Positions are percentages of the composition, scales relative to the fitted
// phrase. Every scene keeps earlier phrases readable while the new one arrives.
export function advancedLyricComposition(layout, index, phase, count, profile = {}) {
  const direction = profile.direction === -1 ? -1 : 1;
  const tilt = profile.compact ? 0.35 : 1;
  const active = index === phase;
  const mirror = state => ({ ...state, x: 50 + (state.x - 50) * direction, rotation: state.rotation * direction * tilt });
  if (layout === 'paper-fold') {
    if (count === 1) return { x: 50, y: 51, scale: 1, rotation: 0, tilt: 0 };
    return mirror(active ? { x: phase % 2 ? 53 : 47, y: phase > 1 ? 71 : 63, scale: 1, rotation: 0, tilt: 0 }
      : { x: index % 2 ? 55 : 45, y: phase === 1 ? 29 : 18 + index * 18,
        scale: phase > 2 ? 0.5 : 0.6, rotation: index % 2 ? 2 : -2, tilt: 34 });
  }
  if (layout === 'ink-trace') return {
    x: 50, y: count === 1 ? 48 : 19 + index * 59 / (count - 1), scale: active ? 1 : 0.9, rotation: 0,
  };
  if (layout === 'echo-trail') return mirror(active
    ? { x: phase ? 46 : 50, y: phase ? 32 : 47, scale: 1, rotation: 0 }
    : { x: 62 + index * 3, y: 56 + index * 13, scale: 0.5, rotation: -2 });
  if (layout === 'block-handoff') return mirror(active
    ? { x: phase ? (phase % 2 ? 65 : 35) : 50, y: phase ? 68 : 48, scale: 1, rotation: 0 }
    : { x: index % 2 ? 73 : 27, y: phase === 1 ? 25 : 16 + Math.floor(index / 2) * 23,
      scale: 0.6, rotation: 0 });
  if (layout === 'ribbon-arc') {
    if (count === 1 || phase === 0) return { x: 50, y: 49, scale: 1, rotation: 0 };
    const along = phase === 1 ? 0.5 : index / (phase - 1);
    return mirror(active ? { x: 50, y: 68, scale: 1, rotation: 0 }
      : { x: 22 + along * 56, y: 37 - Math.sin(along * Math.PI) * 18,
        scale: phase > 2 ? 0.44 : 0.52, rotation: (along - 0.5) * 12 });
  }
  if (layout === 'prism-scatter') return mirror(active
    ? { x: 50, y: 48, scale: 1, rotation: 0 }
    : { x: index % 2 ? 78 : 22, y: index < 2 ? 19 : 78, scale: 0.46,
      rotation: index % 2 ? 3 : -3 });
  if (layout === 'focus-lens') return index === phase || count === 1
    ? { x: 50, y: 55, scale: 1, rotation: 0 }
    : { x: index % 2 ? 74 : 26, y: 14 + Math.floor(index / 2) * 15, scale: 0.52, rotation: index % 2 ? 2 : -2 };
  if (layout === 'page-turn') {
    const age = phase - index;
    return age === 0 || count === 1 ? { x: 50, y: 65, scale: 1, rotation: 0, tilt: 0 }
      : { x: 50, y: 43 - (age - 1) * 13, scale: Math.max(0.38, 0.5 - (age - 1) * 0.04), rotation: 0, tilt: 0 };
  }
  if (layout === 'depth-stack') {
    // Older phrases recede along one diagonal into the distance and defocus.
    const age = phase - index;
    if (age === 0 || count === 1) return { x: 50, y: count === 1 ? 50 : 60, scale: 1, rotation: 0, blur: 0 };
    return mirror({ x: 50 + 9 + (age - 1) * 8, y: 42 - (age - 1) * 10,
      scale: 0.74 * 0.82 ** (age - 1), rotation: 0, blur: 0.075 + (age - 1) * 0.045 });
  }
  if (layout === 'flow-drift') {
    // One shared axis: every phrase enters low on the flow and is pushed up it.
    const age = Math.min(3, phase - index);
    const lead = Math.min(2, phase) * 7;
    return mirror({ x: 46 + lead - age * 20, y: 54 + lead * 0.75 - age * 18,
      scale: age ? Math.max(0.4, 0.74 - (age - 1) * 0.15) : 1, rotation: -9 });
  }
  if (layout === 'color-block') {
    const age = phase - index;
    if (count === 1) return { x: 50, y: 50, scale: 1, rotation: -2 * direction };
    if (age === 0) return mirror({ x: 53, y: 64, scale: 1, rotation: -2 });
    return mirror({ x: 50 + (age % 2 ? -9 : 9), y: 34 - (age - 1) * 15, scale: Math.max(0.46, 0.62 - (age - 1) * 0.06),
      rotation: age % 2 ? 3 : -3 });
  }
  if (layout === 'vertical-relay') {
    // Columns are written right to left, so read lines are folded to the right.
    const age = phase - index;
    const active = 50 - Math.min(3, phase) * 6;
    return { x: active + age * 13 + (age ? 2 : 0), y: age ? 46 : 50, scale: age ? Math.max(0.62, 0.82 - (age - 1) * 0.07) : 1,
      rotation: 0 };
  }
  if (phase === 0 || count === 1) return { x: 50, y: 48, scale: 1, rotation: 0 };
  if (layout === 'corner-relay') {
    if (phase === 1) return active ? { x: 56, y: 63, scale: 0.9, rotation: 3 }
      : { x: 30, y: 29, scale: 0.64, rotation: -4 };
    return active ? { x: 50, y: phase > 2 ? 73 : 69, scale: 1, rotation: 0 }
      : { x: index % 2 ? 74 : 26, y: 22 + Math.floor(index / 2) * 23,
        scale: 0.52, rotation: index % 2 ? 3 : -3 };
  }
  if (layout === 'type-impact') {
    if (phase === 1) return active ? { x: 50, y: 61, scale: 1, rotation: 0 }
      : { x: 50, y: 24, scale: 0.52, rotation: 0 };
    return active ? { x: 50, y: phase > 2 ? 72 : 62, scale: 1, rotation: -2 }
      : { x: index % 2 ? 74 : 26, y: 21 + Math.floor(index / 2) * 22, scale: 0.5, rotation: 0 };
  }
  if (phase > 2) return active ? { x: 50, y: 77, scale: 1, rotation: 0 }
    : { x: 50, y: 14 + index * 14, scale: 0.55, rotation: 0 };
  return active ? { x: 50, y: phase === 1 ? 57 : 70, scale: 1, rotation: 0 }
    : { x: 50, y: phase === 1 ? 27 : 19 + index * 23, scale: phase === 1 ? 0.68 : 0.6, rotation: 0 };
}

const DEFOCUSED = new Set(['depth-stack']);

function blur(state) {
  return `blur(${Number((state.blur || 0).toFixed(4))}em)`;
}

function transform(state, final, amount) {
  const fold = state.tilt === undefined ? '' : ` perspective(900px) rotateX(${state.tilt * amount}deg)`;
  return `translate(calc(var(--advanced-stage-width) * ${(state.x - final.x) / 100}), calc(var(--advanced-stage-height) * ${(state.y - final.y) / 100})) rotate(${state.rotation * amount}deg)${fold} scale(${state.scale})`;
}

// One spatial track per phrase prevents overlapping animations from writing the
// same transform. The supplied clock remains authoritative even after a seek.
export function buildAdvancedLyricChoreography(layout, items, units, { startMs, endMs, duration, amount, hideUnsung, profile = describeAdvancedLyricLine(units) }) {
  layout = items[0]?.choreography || layout;
  const starts = [];
  for (const item of items) starts.push(Math.min(endMs, Math.max(starts.at(-1) ?? startMs,
    item.startMs ?? Math.min(...units.slice(item.start, item.end).map(unit => unit.startMs + (unit.endMs - unit.startMs) * unit.fillStart)))));
  return items.map((item, index) => {
    const final = advancedLyricComposition(layout, index, items.length - 1, items.length, profile);
    const pace = Math.max(0.3, Math.min(1, ((starts[index + 1] ?? endMs) - starts[index]) / 1600));
    const strength = amount * pace * (item.phraseReveal ? 0.7 : 1) * (profile.compact ? 0.65 : 1);
    // A fully visible line shows every phrase at its resting place; none is
    // defocused while it may still be the one being sung.
    if (!hideUnsung) return { frames: [{ transform: transform(final, final, strength), opacity: 1 }],
      poses: [{ ...final, rotation: final.rotation * strength }], startMs, endMs };
    const first = advancedLyricComposition(layout, index, index, items.length, profile);
    const enter = { ...first };
    const direction = profile.direction === -1 ? -1 : 1;
    if (layout === 'paper-fold') {
      enter.y += 6 * strength;
      enter.tilt = -24;
      enter.scale *= 0.96;
    } else if (layout === 'ink-trace') {
      enter.x -= 3 * strength * direction;
    } else if (layout === 'echo-trail') {
      enter.x -= 10 * strength * direction;
      enter.y += 4 * strength;
    } else if (layout === 'block-handoff') {
      enter.x += (index % 2 ? 1 : -1) * 10 * strength * direction;
      enter.scale *= 0.96;
    } else if (layout === 'ribbon-arc') {
      enter.x -= 7 * strength * direction;
      enter.y += 8 * strength;
      enter.rotation -= 7 * direction;
    } else if (layout === 'prism-scatter') {
      enter.scale *= 1.08;
      enter.y += 3 * strength;
    } else if (layout === 'focus-lens') {
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
    } else if (layout === 'depth-stack') {
      // Arrives from in front of the lens: larger and soft, then settles sharp.
      enter.scale *= 1 + 0.28 * strength;
      enter.y += 4 * strength;
      enter.blur = 0.12;
    } else if (layout === 'flow-drift') {
      enter.x += 16 * strength * direction;
      enter.y += 13 * strength;
      enter.scale *= 0.92;
    } else if (layout === 'color-block') {
      enter.x -= 12 * strength * direction;
      enter.rotation -= 4 * direction;
    } else if (layout === 'vertical-relay') {
      enter.y -= 8 * strength;
    } else if (layout === 'type-impact') {
      enter.scale *= 1 + 0.12 * strength;
      enter.y += 3 * strength;
    } else {
      enter.y += 7 * strength;
      enter.scale *= 1 - 0.04 * strength;
    }
    const defocus = DEFOCUSED.has(layout) && amount > 0;
    const trackStart = Math.max(startMs, starts[index]);
    const sungEnd = Math.max(...units.slice(item.start, item.end).map(unit => unit.startMs + (unit.endMs - unit.startMs) * unit.fillEnd));
    const points = [];
    const add = (time, state, opacity, easing = EASE) => points.push({ time, transform: transform(state, final, strength),
      pose: { ...state, rotation: state.rotation * strength }, opacity, easing, filter: defocus ? blur(state) : null });
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
      settled = advancedLyricComposition(layout, index, phase, items.length, profile);
      const age = phase - index;
      opacity = age === 0 ? 1 : layout === 'ink-trace' ? 0.8
        : layout === 'depth-stack' ? Math.max(0.28, 0.62 - (age - 1) * 0.14)
          : Math.max(item.emphasis ? 0.68 : 0.5, (item.emphasis ? 0.88 : 0.76) - (age - 1) * 0.08);
      add(moveStart + span, settled, opacity);
    }
    add(endMs, settled, opacity, 'linear');
    // Degenerate/overlapping source timestamps still produce ordered offsets.
    const frames = points.map(point => ({ transform: point.transform, opacity: point.opacity, easing: point.easing,
      ...(point.filter ? { filter: point.filter } : {}),
      offset: Math.max(0, Math.min(1, (point.time - trackStart) / Math.max(1, endMs - trackStart))) }));
    return { frames, poses: points.map(point => point.pose), startMs: trackStart, endMs, easing: 'linear' };
  });
}
