'use strict';

// 判断字符是否为汉字（CJK Unified Ideographs + Extension A + Compatibility）
function isCJK(c) {
  const cp = c.codePointAt(0);
  return (cp >= 0x4E00 && cp <= 0x9FFF)      // CJK Unified Ideographs
      || (cp >= 0x3400 && cp <= 0x4DBF)      // CJK Extension A
      || (cp >= 0xF900 && cp <= 0xFAFF);     // CJK Compatibility Ideographs
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
      if (isCJK(ch)) {
        if (readingIdx < kanaReadings.length) {
          lineKana.push(kanaReadings[readingIdx]);
          readingIdx++;
        }
      }
    }

    if (lineKana.length > 0) {
      // 将汉字读音用空格连接，方便阅读
      result.set(line.startMs, lineKana.join(' '));
    }
  }

  return result;
}

function parseLyricResult(rawLyric, rawTranslation, rawWordLyric, rawRoma) {
  const lines = parseLrc(rawLyric);
  const translations = parseLrc(rawTranslation);
  const translationByStart = new Map(translations.map((line) => [line.startMs, line.text]));
  const wordLines = parseWordLyric(rawWordLyric);
  const wordLineByStart = new Map(wordLines.map((line) => [line.startMs, line]));
  const romaLines = parseLrc(rawRoma);
  const romaByStart = new Map(romaLines.map((line) => [line.startMs, line.text]));

  // 提取 QQ 音乐 [kana:...] 标签中的假名注音
  const kanaReadings = extractKanaReadings(rawLyric);
  let kanaByLineStart = null;
  if (kanaReadings && kanaReadings.length > 0) {
    kanaByLineStart = mapKanaToLines(lines, kanaReadings);
  }

  return lines.map((line, index) => {
    const romaFromApi = romaByStart.get(line.startMs) || '';
    const kanaFromTag = kanaByLineStart ? kanaByLineStart.get(line.startMs) || '' : '';
    return {
      ...line,
      endMs: lines[index + 1] ? lines[index + 1].startMs : undefined,
      translation: translationByStart.get(line.startMs) || '',
      roma: romaFromApi || kanaFromTag,
      words: wordLineByStart.get(line.startMs) ? wordLineByStart.get(line.startMs).words : []
    };
  });
}

function parseLrc(rawText) {
  const result = [];
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
  const fractionMs = fractionText.length === 3
    ? Number(fractionText)
    : Number(fractionText.padEnd(3, '0'));
  return (minuteNumber * 60 + secondNumber) * 1000 + fractionMs;
}

function parseWordLyric(rawText) {
  const result = [];
  const text = String(rawText || '');
  const linePattern = /\[(\d+),(\d+)\]([\s\S]*)/;
  const wordPattern = /\((\d+),(\d+),\d*\)([^()]+)/g;

  for (const row of text.split(/\r?\n/)) {
    const lineMatch = row.match(linePattern);
    if (!lineMatch) continue;
    const lineStartMs = Number(lineMatch[1]);
    const lineDurationMs = Number(lineMatch[2]);
    const body = lineMatch[3] || '';
    const words = [];
    let match;
    wordPattern.lastIndex = 0;
    while ((match = wordPattern.exec(body)) !== null) {
      const startMs = Number(match[1]);
      const durationMs = Number(match[2]);
      const textValue = String(match[3] || '').trim();
      if (!textValue) continue;
      words.push({
        startMs,
        endMs: startMs + Math.max(0, durationMs),
        text: textValue
      });
    }
    if (!words.length) continue;
    result.push({
      startMs: lineStartMs,
      endMs: lineStartMs + Math.max(0, lineDurationMs),
      text: words.map((word) => word.text).join(''),
      words
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

module.exports = {
  findCurrentLyricLine,
  parseLrc,
  parseLyricResult,
  parseWordLyric
};
