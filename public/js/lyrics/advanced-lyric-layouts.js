import { advancedLyricComposition } from './advanced-lyric-choreography.js';

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const wordSegmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
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
  if (JOINING_TEXT.test(text)) return [{ text, startMs, endMs, fillStart: 0, fillEnd: 1, revealAsRun: true }];
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
    const wordStart = Math.max(startMs, Number(word.startMs));
    const wordEnd = Math.min(endMs, Number(word.endMs));
    cursor = limit;
    if (word.startMs == null || word.endMs == null || !Number.isFinite(wordStart) || !Number.isFinite(wordEnd) || wordEnd <= wordStart) continue;
    matches.forEach((unit, index) => Object.assign(unit, {
      startMs: wordStart, endMs: wordEnd, timed: true, token: offset,
      fillStart: index / matches.length, fillEnd: (index + 1) / matches.length,
    }));
  }
  // Untimed punctuation belongs to its neighbour, not an unrelated point in the
  // line-wide estimate. This also preserves a real pause after a closing mark.
  units.forEach((unit, index) => {
    if (unit.timed || /[\p{L}\p{N}\p{S}]/u.test(unit.text)) return;
    const neighbour = units[index - 1]?.timed ? units[index - 1] : units[index + 1];
    if (neighbour?.timed) Object.assign(unit, { startMs: neighbour.startMs, endMs: neighbour.endMs,
      fillStart: neighbour.fillStart, fillEnd: neighbour.fillEnd, timed: true });
  });
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
      fillStart: 0, fillEnd: 1, revealAsRun: true, timed: chunk.every(unit => unit.timed) });
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

function unitStart(unit) {
  return unit.startMs + (unit.endMs - unit.startMs) * unit.fillStart;
}

function unitEnd(unit) {
  return unit.startMs + (unit.endMs - unit.startMs) * unit.fillEnd;
}

export function partitionAdvancedLyricText(units, requested, byCharacter = false, minDurationMs = 0) {
  if (!units.length) return [];
  const text = units.map(unit => unit.text).join('');
  const wordEnds = new Set([...wordSegmenter.segment(text)].map(({ index, segment }) => index + segment.length));
  const boundaries = [0], widths = [0];
  let offset = 0;
  units.forEach((unit, index) => {
    offset += unit.text.length;
    widths.push(widths.at(-1) + widthOf(unit.text));
    const right = units[index + 1]?.text;
    // Spaces and closing punctuation stay with the preceding phrase. A phrase
    // boundary never cuts a dictionary word; letter-by-letter art opts out.
    const insideToken = minDurationMs && unit.token !== undefined && unit.token === units[index + 1]?.token;
    if (right && !insideToken && (byCharacter || wordEnds.has(offset) && !/^[\s\p{Pe}\p{Pf}，。！？、,!.?;：:]/u.test(right))) boundaries.push(index + 1);
  });
  boundaries.push(units.length);
  const total = widths.at(-1);
  let adaptive = null;
  for (let count = Math.min(Math.max(1, requested), boundaries.length - 1); count >= 1; count--) {
    const target = total / count;
    const paths = Array.from({ length: count + 1 }, () => new Map());
    paths[0].set(0, { score: 0, ranges: [] });
    for (let part = 1; part <= count; part++) {
      for (let end = 1; end < boundaries.length; end++) {
        const to = boundaries[end], left = units[to - 1], right = units[to];
        const gap = right ? unitStart(right) - unitEnd(left) : 0;
        const breakWeight = !byCharacter && right ? (/[，。！？、,!.?;：:]\s*$/u.test(left.text) ? 0.8 : 0) + Math.min(0.8, Math.max(0, gap) / 500) : 0;
        const prefix = minDurationMs ? units.slice(0, to).map(unit => unit.text).join('').trimEnd() : '';
        const dangling = right && /(?:\b(?:a|an|the|to|of|and|or|my|your|our|with|for|in|through|until)|[的地得和与把被])$/iu.test(prefix);
        for (const [start, previous] of paths[part - 1]) {
          if (start >= end) continue;
          const from = boundaries[start];
          const width = widths[to] - widths[from];
          if (!byCharacter && count > 1 && width < 1.8) continue;
          const span = (right ? unitStart(right) : unitEnd(left)) - unitStart(units[from]);
          if (count > 1 && span < minDurationMs) continue;
          const score = previous.score + (minDurationMs
            ? ((width - target) / target) ** 2 - breakWeight + (dangling ? 0.6 : 0)
            : (width - target) ** 2 - breakWeight * target);
          if (score < (paths[part].get(end)?.score ?? Infinity)) {
            paths[part].set(end, { score, ranges: [...previous.ranges, { start: from, end: to }] });
          }
        }
      }
    }
    const best = paths[count].get(boundaries.length - 1);
    if (!best) continue;
    if (!minDurationMs) return best.ranges;
    const score = best.score + (requested - count) * 0.15;
    if (!adaptive || score < adaptive.score) adaptive = { score, ranges: best.ranges };
  }
  return adaptive?.ranges || [{ start: 0, end: units.length }];
}

function adaptivePhrases(units) {
  const letters = units.filter(unit => /[\p{L}\p{N}\p{S}]/u.test(unit.text));
  const timed = letters.length > 0 && letters.every((unit, index) => unit.timed
    && (!index || unitStart(unit) >= unitStart(letters[index - 1])));
  const startMs = Math.min(...units.map(unit => unit.startMs));
  const endMs = Math.max(...units.map(unit => unit.endMs));
  // Incomplete timings cannot support syllable choreography. Use one consistent
  // line-wide estimate for phrase entrances, keeping the original units intact.
  const timeline = timed ? units : units.map((unit, index) => ({ ...unit, startMs, endMs,
    fillStart: index / units.length, fillEnd: (index + 1) / units.length }));
  const text = units.map(unit => unit.text).join('');
  const width = widthOf(text);
  const breaks = timeline.slice(0, -1).filter((unit, index) => /[，。！？、,!.?;：:]\s*$/u.test(unit.text)
    || timed && unitStart(timeline[index + 1]) - unitEnd(unit) >= 180).length;
  const count = Math.max(1, Math.min(timed ? 5 : 4, Math.ceil(width / 6), Math.floor((endMs - startMs) / 900)));
  const wordCount = [...wordSegmenter.segment(text)].filter(segment => segment.isWordLike).length;
  const languageLimit = /[\u3040-\u30ff]/u.test(text) && !timed ? Math.max(1, breaks + 1)
    : /\p{Script=Han}/u.test(text) ? 5 : Math.max(1, Math.floor(wordCount / 3));
  const requested = Math.min(timed ? 5 : 4, languageLimit, Math.max(count, Math.min(count + 1, breaks + 1)));
  const ranges = partitionAdvancedLyricText(timeline, requested, false, timed ? 700 : 1100);
  const lengths = letters.map(unit => (unitEnd(unit) - unitStart(unit)) / Math.max(1, [...unit.text].length)).sort((a, b) => a - b);
  const median = lengths[Math.floor(lengths.length / 2)] || 1;
  const prominence = ranges.map(({ start, end }) => timed ? Math.max(0, ...units.slice(start, end)
    .filter(unit => /[\p{L}\p{N}]/u.test(unit.text)).map(unit => unitEnd(unit) - unitStart(unit))) : 0);
  const peak = Math.max(...prominence);
  const emphasis = peak >= 600 && peak >= median * 1.65 ? prominence.indexOf(peak) : -1;
  return ranges.map((range, index) => ({ ...range,
    startMs: unitStart(timeline[range.start]),
    endMs: index + 1 < ranges.length ? unitStart(timeline[ranges[index + 1].start]) : endMs,
    phraseReveal: !timed, emphasis: index === emphasis,
  }));
}

function group(range, x, y, width, size = 1, extra = {}) {
  return { ...range, x, y, width, size, rotation: 0, source: 'current', ...extra };
}

export function buildAdvancedLyricLayout(layout, units) {
  if (!units.length) return [];
  const all = { start: 0, end: units.length };
  const split = (count, byCharacter = false) => partitionAdvancedLyricText(units, count, byCharacter);
  let items;
  switch (layout) {
    case 'phrase-flow':
    case 'corner-relay':
    case 'type-impact':
      items = adaptivePhrases(units).map((range, index, parts) => {
        const final = advancedLyricComposition(layout, index, parts.length - 1, parts.length);
        return group(range, final.x, final.y, 82, layout === 'type-impact' ? 2.1 : 1.7,
          { choreography: layout, fitScale: final.scale, maxHeight: parts.length > 3 ? 24 : 30, tone: range.emphasis ? 'accent' : '' });
      });
      break;
    case 'duet':
      items = split(2).map((range, index) => group(range, 50, 32 + index * 35, 88, index ? 1.05 : 1.4));
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
      const parts = split(Math.min(18, units.length), true);
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
      const parts = split(Math.min(22, units.length), true);
      items = parts.map((range, index) => {
        const phase = parts.length === 1 ? 0.5 : index / (parts.length - 1);
        return group(range, 10 + phase * 80, 67 - Math.sin(phase * Math.PI) * 37, Math.max(4.5, 85 / parts.length), 1,
          { rotation: (phase - 0.5) * 68 });
      });
      break;
    }
    case 'wave': {
      const parts = split(Math.min(22, units.length), true);
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
      const parts = split(Math.min(24, units.length), true);
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
      items = [group(all, 50, 50, 90, 1.4)];
  }
  return items;
}
