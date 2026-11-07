const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const JOINING_TEXT = /[\u0590-\u11ff\u1780-\u17ff\uA960-\uA97f\uA9E0-\uA9ff\uAA60-\uAA7f\uD7B0-\uD7ff]/u;
const MAX_TEXT_UNITS = 96;

function finite(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

// Timing remains attached to the supplied word. Fractions describe a geometric
// sweep through that word, not newly inferred syllable timestamps.
export function createAdvancedLyricText(line) {
  const text = String(line?.text || '');
  if (!text) return [];
  const startMs = finite(line.startMs, 0);
  const endMs = Math.max(startMs + 1, finite(line.endMs, startMs + 4000));
  if (JOINING_TEXT.test(text)) return [{ text, startMs, endMs, fillStart: 0, fillEnd: 1 }];
  const segments = [...graphemeSegmenter.segment(text)];
  const units = segments.map(({ segment, index }, ordinal) => ({
    text: segment, offset: index, startMs, endMs,
    fillStart: ordinal / segments.length, fillEnd: (ordinal + 1) / segments.length,
  }));
  let cursor = 0;
  for (const word of Array.isArray(line.words) ? line.words : []) {
    const value = String(word.text || '');
    if (!value) continue;
    const offset = text.indexOf(value, cursor);
    if (offset < 0) continue;
    const limit = offset + value.length;
    const matches = units.filter(unit => unit.offset >= offset && unit.offset < limit);
    const wordStart = finite(word.startMs, startMs);
    const wordEnd = Math.max(wordStart + 1, finite(word.endMs, endMs));
    matches.forEach((unit, index) => Object.assign(unit, {
      startMs: wordStart, endMs: wordEnd,
      fillStart: index / matches.length, fillEnd: (index + 1) / matches.length,
    }));
    cursor = limit;
  }
  if (units.length <= MAX_TEXT_UNITS) return units;
  // Extremely long lines retain every character without creating thousands of
  // independently composited glyphs. Ordinary song lines remain per-grapheme.
  const chunkSize = Math.ceil(units.length / MAX_TEXT_UNITS);
  const grouped = [];
  for (let index = 0; index < units.length; index += chunkSize) {
    const chunk = units.slice(index, index + chunkSize);
    const first = chunk[0], last = chunk.at(-1);
    grouped.push({ text: chunk.map(unit => unit.text).join(''), offset: first.offset,
      startMs: first.startMs + (first.endMs - first.startMs) * first.fillStart,
      endMs: last.startMs + (last.endMs - last.startMs) * last.fillEnd,
      fillStart: 0, fillEnd: 1 });
  }
  return grouped;
}

export function advancedLyricUnitProgress(unit, currentMs) {
  const elapsed = (currentMs - unit.startMs) / Math.max(1, unit.endMs - unit.startMs);
  return Math.max(0, Math.min(1, (elapsed - unit.fillStart) / Math.max(0.0001, unit.fillEnd - unit.fillStart)));
}

function widthOf(text) {
  let width = 0;
  for (const character of text) width += /\s/u.test(character) ? 0.32 : /[\x20-\x7e]/u.test(character) ? 0.58 : 1;
  return width;
}

export function partitionAdvancedLyricText(units, requested) {
  const count = Math.max(1, Math.min(units.length, requested));
  if (!units.length) return [];
  const widths = units.map(unit => widthOf(unit.text));
  const total = widths.reduce((sum, width) => sum + width, 0);
  const result = [];
  let start = 0, consumed = 0;
  for (let part = 1; part < count; part++) {
    const target = total * part / count;
    let best = start + 1, bestScore = Infinity, width = consumed;
    for (let boundary = start + 1; boundary <= units.length - (count - part); boundary++) {
      width += widths[boundary - 1];
      const left = units[boundary - 1].text, right = units[boundary].text;
      const insideWord = /[A-Za-z0-9]$/u.test(left) && /^[A-Za-z0-9]/u.test(right);
      const score = Math.abs(width - target) + (insideWord ? 4 : 0) - (/[\s，。！？、,!.?;：:]$/u.test(left) ? 0.8 : 0);
      if (score < bestScore) { bestScore = score; best = boundary; }
    }
    result.push({ start, end: best });
    consumed += widths.slice(start, best).reduce((sum, width) => sum + width, 0);
    start = best;
  }
  result.push({ start, end: units.length });
  return result;
}

function group(range, x, y, width, size = 1, extra = {}) {
  return { ...range, x, y, width, size, rotation: 0, source: 'current', ...extra };
}

export function buildAdvancedLyricLayout(layout, units, nextUnits = [], options = {}) {
  if (!units.length) return [];
  const all = { start: 0, end: units.length };
  const split = count => partitionAdvancedLyricText(units, count);
  const hasNext = options.showNext !== false && nextUnits.length > 0;
  const next = (x = 50, y = 88, width = 78, size = 0.46) => group({ start: 0, end: nextUnits.length }, x, y, width, size, { source: 'next', tone: 'secondary' });
  let items;
  switch (layout) {
    case 'duet':
      items = hasNext ? [group(all, 50, 33, 90, 1.35), next(50, 70, 86, 0.82)]
        : split(2).map((range, index) => group(range, 50, 32 + index * 35, 88, index ? 1.05 : 1.4));
      break;
    case 'offset':
      items = split(2).map((range, index) => group(range, index ? 61 : 39, 30 + index * 35, 70, index ? 1.5 : 1.05, { align: index ? 'right' : 'left' }));
      break;
    case 'split':
      items = split(2).map((range, index) => group(range, index ? 75 : 25, 47, 43, index ? 1.5 : 1.05, { tone: index ? 'accent' : '' }));
      break;
    case 'corners':
      items = split(4).map((range, index) => group(range, index % 2 ? 75 : 25, index < 2 ? 29 : 65, 43, [1.35, 0.95, 1, 1.45][index], { rotation: [-4, 3, 2, -3][index] }));
      break;
    case 'staircase':
      items = split(3).map((range, index) => group(range, 27 + index * 23, 24 + index * 24, 48, 1.2, { tone: index === 1 ? 'accent' : '' }));
      break;
    case 'diagonal':
      items = split(3).map((range, index) => group(range, 23 + index * 27, 22 + index * 22, 46, 1.3, { rotation: -12 }));
      break;
    case 'vertical':
      items = split(units.length > 14 ? 3 : 2).map((range, index, parts) => group(range, 50 + (index - (parts.length - 1) / 2) * 18, 46, 16, 1.05, { vertical: true, maxHeight: 69 }));
      break;
    case 'split-vertical':
      items = split(2).map((range, index) => group(range, index ? 66 : 34, 46, 25, index ? 1.1 : 1.5, { vertical: true, maxHeight: 69, plate: 'strip', tone: index ? 'secondary' : 'accent' }));
      break;
    case 'emphasis':
      items = split(3).map((range, index, parts) => group(range, 50, parts.length === 1 ? 47 : 24 + index * 24, 90, index === 1 ? 2.1 : 0.72,
        { tone: index === 1 ? 'accent' : '', maxHeight: index === 1 ? 30 : 18 }));
      break;
    case 'initials':
      items = units.length === 1 ? [group(all, 50, 46, 80, 3)] : [
        group({ start: 0, end: 1 }, 23, 46, 32, 3.6, { tone: 'accent' }),
        group({ start: 1, end: units.length }, 65, 48, 61, 1),
      ];
      break;
    case 'outline-echo':
      items = [group(all, 50, 35, 96, 2.05, { decorative: true, treatment: 'echo' }), group(all, 50, 59, 87, 1.2)];
      break;
    case 'tiles': {
      const parts = split(Math.min(18, units.length));
      const columns = Math.min(6, Math.ceil(Math.sqrt(parts.length * 1.7)));
      const rows = Math.ceil(parts.length / columns);
      items = parts.map((range, index) => group(range, 50 + (index % columns - (columns - 1) / 2) * (86 / columns),
        46 + (Math.floor(index / columns) - (rows - 1) / 2) * (58 / rows), 78 / columns, 1.05,
        { plate: 'tile', tone: index % 3 ? 'accent' : 'secondary', rotation: index % 2 ? 3 : -3 }));
      break;
    }
    case 'ribbons':
      items = split(3).map((range, index) => group(range, index % 2 ? 54 : 46, 24 + index * 24, 83, 1, { plate: 'ribbon', tone: index % 2 ? 'secondary' : 'accent', rotation: index % 2 ? 3 : -3 }));
      break;
    case 'speech':
      items = split(2).map((range, index) => group(range, index ? 64 : 36, index ? 64 : 29, 65, 1.05, { plate: index ? 'speech-right' : 'speech-left', tone: index ? 'secondary' : 'accent' }));
      break;
    case 'postcard':
      items = [group(all, 50, 44, 83, 1.15, { plate: 'postcard', rotation: -3 })];
      break;
    case 'arc': {
      const parts = split(Math.min(22, units.length));
      items = parts.map((range, index) => {
        const phase = parts.length === 1 ? 0.5 : index / (parts.length - 1);
        return group(range, 10 + phase * 80, 67 - Math.sin(phase * Math.PI) * 37, Math.max(4.5, 85 / parts.length), 1,
          { rotation: (phase - 0.5) * 68 });
      });
      break;
    }
    case 'wave': {
      const parts = split(Math.min(22, units.length));
      items = parts.map((range, index) => {
        const phase = parts.length === 1 ? 0.5 : index / (parts.length - 1);
        return group(range, 9 + phase * 82, 47 + Math.sin(phase * Math.PI * 2) * 16, Math.max(4.5, 85 / parts.length), 1,
          { rotation: Math.cos(phase * Math.PI * 2) * 12, tone: index % 3 === 0 ? 'accent' : '' });
      });
      break;
    }
    case 'fan':
      items = split(4).map((range, index, parts) => group(range, 50 + Math.abs(index - (parts.length - 1) / 2) * 6,
        18 + index * (42 / Math.max(1, parts.length - 1)), 72, 1.05, { rotation: (index - (parts.length - 1) / 2) * 9, plate: 'fan' }));
      break;
    case 'orbit': {
      const parts = split(Math.min(24, units.length));
      items = parts.map((range, index) => {
        const angle = -Math.PI / 2 + index / parts.length * Math.PI * 2;
        return group(range, 50 + Math.cos(angle) * 37, 46 + Math.sin(angle) * 30,
          Math.max(7, 96 / parts.length), 0.9, { rotation: angle * 180 / Math.PI + 90 });
      });
      break;
    }
    case 'bracket':
      items = split(2).map((range, index) => group(range, 50, 31 + index * 31, 74, index ? 1.05 : 1.5, { treatment: 'bracket' }));
      break;
    case 'magazine':
      items = split(3).map((range, index) => group(range, [40, 67, 39][index], [24, 49, 71][index], [70, 58, 63][index], [1.65, 0.72, 1.05][index],
        { align: index === 1 ? 'right' : 'left', tone: index === 1 ? 'accent' : '', plate: index === 2 ? 'label' : '' }));
      break;
    default:
      items = [group(all, 50, hasNext ? 43 : 50, 90, 1.4)];
  }
  if (hasNext && layout !== 'duet') items.push(next());
  return items;
}
