// 歌词行按起始时间升序排列。同毫秒取末行，首行开始前返回 -1。
export function findLyricLineIndex(lines, targetMs, getStartMs) {
  let low = 0;
  let high = lines.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (getStartMs(lines[middle]) <= targetMs) {
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return low - 1;
}

const MAX_LINE_LEAD_MS = 500;
const GAP_FOR_NEXT_LINE = 0.9;
const SETTLED_BEFORE_ONSET_MS = 50;
const displayCues = new WeakMap();

function getSungEndMs(line, startMs) {
  let wordEndMs = 0;
  let lastWord = '';
  for (const word of line.words || []) {
    const text = String(word.text || '').trim();
    if (!text || !Number.isFinite(Number(word.endMs))) continue;
    wordEndMs = Math.max(wordEndMs, Number(word.endMs));
    lastWord = text;
  }
  const declaredEnd = Number(line.endMs);
  // A truncated word list can extend a known tail, but its last token cannot shorten the line.
  if (wordEndMs > startMs && (wordEndMs >= declaredEnd || line.text?.trimEnd().endsWith(lastWord))) return wordEndMs;
  return Number.isFinite(declaredEnd) && declaredEnd > startMs ? declaredEnd : null;
}

// A timeline's rows and word timings are replaced together when its source changes.
export function getLyricDisplayCues(lines) {
  if (displayCues.has(lines)) return displayCues.get(lines);
  const cues = [];
  for (const line of lines) {
    const startMs = Number(line.startMs);
    const previous = cues.at(-1);
    let displayMs = startMs;
    if (previous?.startMs === startMs) {
      displayMs = previous.displayMs;
    } else if (previous && previous.sungEndMs !== null && previous.sungEndMs < startMs) {
      displayMs -= Math.min(MAX_LINE_LEAD_MS, (startMs - previous.sungEndMs) * GAP_FOR_NEXT_LINE);
    }
    cues.push({ startMs, displayMs, sungEndMs: getSungEndMs(line, startMs) });
  }
  displayCues.set(lines, cues);
  return cues;
}

// Leave a few paint frames to read the stationary line before its first syllable.
export function getLyricMotionBudget(startMs, currentMs, playbackRate = 1) {
  const available = (startMs - currentMs) / (playbackRate || 1) - SETTLED_BEFORE_ONSET_MS;
  return available >= 1000 / 60 ? available : 0;
}
