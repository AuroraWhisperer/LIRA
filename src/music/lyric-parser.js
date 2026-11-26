'use strict';

const MAX_LYRIC_LINES = 4096;
const MAX_LYRIC_TEXT = 512 * 1024;

function assertLyricBudget(lineCount, textLength) {
  if (lineCount > MAX_LYRIC_LINES || textLength > MAX_LYRIC_TEXT) {
    throw Object.assign(new Error('这份歌词太大，无法读取。'), {
      code: 'LYRIC_EXPANSION_LIMIT', statusCode: 400,
    });
  }
}

// 判断字符是否为汉字（CJK Unified Ideographs + Extension A + Compatibility）
function isCJK(c) {
  const cp = c.codePointAt(0);
  return (
    (cp >= 0x4e00 && cp <= 0x9fff) || // CJK Unified Ideographs
    (cp >= 0x3400 && cp <= 0x4dbf) || // CJK Extension A
    (cp >= 0xf900 && cp <= 0xfaff)
  ); // CJK Compatibility Ideographs
}

function extractKanaReadings(rawLyric) {
  const text = String(rawLyric || '');
  const kanaMatch = text.match(/\[kana:([^\]]+)\]/);
  if (!kanaMatch) return null;
  // 格式：1<読み1>1<読み2>... 分隔符为数字
  return kanaMatch[1].split(/\d+/).filter(Boolean);
}

function mapKanaToLines(lines, kanaReadings) {
  const result = new Map();
  let readingIdx = 0;

  for (const line of lines) {
    const chars = [...line.text];
    const lineKana = [];

    for (const ch of chars) {
      if (!isCJK(ch) || readingIdx >= kanaReadings.length) continue;
      lineKana.push(kanaReadings[readingIdx]);
      readingIdx++;
    }

    if (lineKana.length > 0) {
      // 将汉字读音用空格连接，方便阅读
      result.set(line.startMs, lineKana.join(' '));
    }
  }

  return result;
}

function parseLyricResult(rawLyric, rawTranslation, rawWordLyric, rawRoma) {
  const wordLines = parseWordLyric(rawWordLyric);
  const lrcLines = parseLrc(rawLyric);
  const lines = lrcLines.length ? lrcLines : wordLines;
  const translations = parseTimedText(rawTranslation);
  const resolveTranslation = createTimedLineResolver(translations);
  const resolveWordLine = wordLines.length && lrcLines.length ? createWordLineResolver(wordLines) : null;
  const resolveBaseLine = resolveWordLine ? createWordLineResolver(lrcLines) : null;
  const romaLines = parseTimedText(rawRoma);
  const resolveRoma = createTimedLineResolver(romaLines);

  // 提取 QQ 音乐 [kana:...] 标签中的假名注音
  const kanaReadings = extractKanaReadings(rawLyric);
  let kanaByLineStart = null;
  if (kanaReadings && kanaReadings.length > 0) {
    kanaByLineStart = mapKanaToLines(lines, kanaReadings);
  }

  let textLength = 0;
  return lines.map((line, index) => {
    const romaFromApi = resolveRoma(line.startMs)?.text;
    const kanaFromTag = kanaByLineStart ? kanaByLineStart.get(line.startMs) || '' : '';
    let words = line.words || [];
    if (resolveWordLine) {
      const candidate = resolveWordLine(line);
      if (candidate && (candidate.startMs === line.startMs || candidate.text === line.text) &&
          resolveBaseLine(candidate) === line) words = candidate.words;
    }
    const roma = romaFromApi || kanaFromTag;
    const translation = resolveTranslation(line.startMs)?.text || '';
    textLength += line.text.length + translation.length + roma.length +
      words.reduce((sum, word) => sum + word.text.length, 0);
    assertLyricBudget(index + 1, textLength);
    return {
      ...line,
      endMs: line.endMs ?? (lines[index + 1] ? lines[index + 1].startMs : undefined),
      translation,
      roma,
      words,
    };
  });
}

function parseTimedText(rawText) {
  const lrcLines = parseLrc(rawText);
  return lrcLines.length > 0 ? lrcLines : parseWordLyric(rawText);
}

// Duet parts can start at the same millisecond. Time alone cannot identify the part.
function createWordLineResolver(lines) {
  const nearest = createTimedLineResolver(lines, { rejectTies: true });
  const simultaneous = new Map();
  for (const [time, rows] of Map.groupBy(lines, line => line.startMs)) {
    if (rows.length < 2) continue;
    const parts = new Map();
    for (const row of rows) parts.set(row.text, parts.has(row.text) ? null : row);
    simultaneous.set(time, parts);
  }
  return (line) => {
    const candidate = nearest(line.startMs);
    const parts = simultaneous.get(candidate?.startMs);
    return parts ? parts.get(line.text) : candidate;
  };
}

/**
 * Resolve a timed lyric row. QQ may use different precision for LRC, QRC and alternates.
 */
function createTimedLineResolver(lines, { toleranceMs = 100, rejectTies = false } = {}) {
  const sorted = Array.isArray(lines)
    ? lines.filter((line) => Number.isFinite(line.startMs)).sort((a, b) => a.startMs - b.startMs)
    : [];
  const exact = new Map(sorted.map((line) => [line.startMs, line]));

  return (startMs) => {
    if (exact.has(startMs)) return exact.get(startMs);

    let low = 0;
    let high = sorted.length - 1;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (sorted[mid].startMs < startMs) low = mid + 1;
      else high = mid - 1;
    }

    const next = sorted[low];
    const previous = sorted[low - 1];
    const ahead = next ? next.startMs - startMs : Infinity;
    const behind = previous ? startMs - previous.startMs : Infinity;
    if (Math.min(ahead, behind) > toleranceMs || (rejectTies && ahead === behind)) return undefined;
    return ahead <= behind ? next : previous;
  };
}

function parseLrc(rawText) {
  const result = [];
  let textLength = 0;
  const text = String(rawText || '');
  const linePattern = /\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;

  for (const row of text.split(/\r?\n/)) {
    const timestamps = [];
    let match;
    linePattern.lastIndex = 0;
    while ((match = linePattern.exec(row)) !== null) {
      timestamps.push(toStartMs(match[1], match[2], match[3]));
    }
    if (!timestamps.length) continue;

    const lyricText = row.replace(linePattern, '').trim();
    if (!lyricText) continue;
    textLength += lyricText.length * timestamps.length;
    assertLyricBudget(result.length + timestamps.length, textLength);
    for (const startMs of timestamps) {
      result.push({ startMs, text: lyricText });
    }
  }

  return result
    .filter((line) => Number.isFinite(line.startMs) && line.startMs >= 0)
    .sort((a, b) => a.startMs - b.startMs || a.text.localeCompare(b.text));
}

function toStartMs(minutes, seconds, fraction) {
  const minuteNumber = Number(minutes);
  const secondNumber = Number(seconds);
  const fractionText = String(fraction || '0');
  const fractionMs = fractionText.length === 3 ? Number(fractionText) : Number(fractionText.padEnd(3, '0'));
  return (minuteNumber * 60 + secondNumber) * 1000 + fractionMs;
}

function parseWordLyric(rawText) {
  const result = [];
  let textLength = 0;
  const text = String(rawText || '');
  const linePattern = /\[(\d+),(\d+)\]([\s\S]*)/;
  const prefixWordPattern = /\((\d+),(\d+),\d*\)/g;
  const suffixWordPattern = /\((\d+),(\d+)\)/g;

  for (const row of text.split(/\r?\n/)) {
    const lineMatch = row.match(linePattern);
    if (!lineMatch) continue;
    const lineStartMs = Number(lineMatch[1]);
    const lineDurationMs = Number(lineMatch[2]);
    const body = lineMatch[3] || '';
    const words = [];
    prefixWordPattern.lastIndex = 0;
    let match = prefixWordPattern.exec(body);
    while (match) {
      const startMs = Number(match[1]);
      const durationMs = Number(match[2]);
      const textStart = prefixWordPattern.lastIndex;
      match = prefixWordPattern.exec(body);
      const textValue = body.slice(textStart, match?.index ?? body.length);
      if (!textValue.trim()) continue;
      textLength += textValue.length;
      assertLyricBudget(result.length + 1, textLength);
      words.push({
        startMs,
        endMs: startMs + Math.max(0, durationMs),
        text: textValue,
      });
    }
    if (!words.length) {
      let textStart = 0;
      suffixWordPattern.lastIndex = 0;
      while ((match = suffixWordPattern.exec(body)) !== null) {
        const textValue = body.slice(textStart, match.index);
        textStart = suffixWordPattern.lastIndex;
        if (!textValue.trim()) continue;
        textLength += textValue.length;
        assertLyricBudget(result.length + 1, textLength);
        const startMs = Number(match[1]);
        const durationMs = Number(match[2]);
        words.push({
          startMs,
          endMs: startMs + Math.max(0, durationMs),
          text: textValue,
        });
      }
    }
    if (!words.length) continue;
    result.push({
      startMs: lineStartMs,
      endMs: lineStartMs + Math.max(0, lineDurationMs),
      text: words
        .map((word) => word.text)
        .join('')
        .trim(),
      words,
    });
  }

  return result
    .filter((line) => Number.isFinite(line.startMs) && line.startMs >= 0)
    .sort((a, b) => a.startMs - b.startMs);
}

function findCurrentLyricLine(lines, currentMs) {
  if (!Array.isArray(lines) || !lines.length) return null;
  const target = Math.max(0, Number(currentMs) || 0);
  let low = 0;
  let high = lines.length - 1;
  let result = null;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const line = lines[mid];
    if (line.startMs <= target) {
      result = line;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return result;
}

// LRC has only line anchors. Keep supplied word timing, otherwise distribute the
// line interval across characters / Latin words so both highlight modes can run.
function estimateWordTimings(lines, durationMs = 0, deferFinalTiming = false) {
  const segmenter = new Intl.Segmenter('und', { granularity: 'grapheme' });
  return lines.map((line, index) => {
    if (line.words?.length) return line;
    // A shared cache can fill this one unbounded LRC row once playback supplies its duration.
    if (deferFinalTiming && index === lines.length - 1 && line.endMs == null) return line;
    const tokens = [];
    let prefix = '';
    let latin = false;
    for (const { segment } of segmenter.segment(line.text)) {
      const isLatin = /^[\p{Script=Latin}\p{N}\p{M}]+$/u.test(segment);
      if (/^[\p{P}\p{Z}\p{M}\s]+$/u.test(segment)) {
        if (tokens.length) tokens.at(-1).text += segment;
        else prefix += segment;
        latin = false;
      } else if (isLatin && latin) {
        tokens.at(-1).text += segment;
        tokens.at(-1).weight += 1 / 3;
      } else {
        tokens.push({ text: prefix + segment, weight: isLatin ? 1 / 3 : 1 });
        prefix = '';
        latin = isLatin;
      }
    }
    if (!tokens.length) return line;
    const totalWeight = tokens.reduce((sum, token) => sum + Math.max(1, token.weight), 0);
    const nextStart = lines[index + 1]?.startMs;
    // Only the final unbounded line needs a nominal duration (300 ms per unit,
    // 1–8 seconds). Do not stretch it indefinitely when track duration is absent.
    const endMs = line.endMs ?? nextStart ?? (durationMs > line.startMs
      ? durationMs : line.startMs + Math.min(8000, Math.max(1000, totalWeight * 300)));
    if (endMs <= line.startMs) return line;
    let weight = 0;
    let startMs = line.startMs;
    const words = tokens.map((token) => {
      weight += Math.max(1, token.weight);
      const wordEndMs = Math.round(line.startMs + (endMs - line.startMs) * weight / totalWeight);
      const word = { text: token.text, startMs, endMs: wordEndMs };
      startMs = wordEndMs;
      return word;
    });
    return { ...line, endMs, words };
  });
}

module.exports = {
  estimateWordTimings,
  findCurrentLyricLine,
  parseLrc,
  parseLyricResult,
  parseWordLyric,
};
