'use strict';

const REGEX_PREFIX_KEYWORDS = new Set([
  'return',
  'typeof',
  'instanceof',
  'in',
  'of',
  'new',
  'void',
  'delete',
  'do',
  'else',
  'case',
  'yield',
  'await',
  'throw',
  'extends',
]);

// Mask literal/comment text in place: UTF-16 offsets and line endings must
// remain identical so the scope audit reports locations in the original file.
function sanitizeSource(source) {
  const output = source.split('');
  let cursor = 0;

  function blankTo(end) {
    while (cursor < end) {
      if (source[cursor] !== '\n' && source[cursor] !== '\r') output[cursor] = ' ';
      cursor += 1;
    }
  }

  function scanComment() {
    if (source[cursor + 1] === '/') {
      const end = source.indexOf('\n', cursor + 2);
      blankTo(end < 0 ? source.length : end);
      return true;
    }
    if (source[cursor + 1] === '*') {
      const end = source.indexOf('*/', cursor + 2);
      blankTo(end < 0 ? source.length : end + 2);
      return true;
    }
    return false;
  }

  function scanString() {
    const quote = source[cursor];
    let end = cursor + 1;
    while (end < source.length && source[end] !== quote && source[end] !== '\n') {
      if (source[end] === '\\') end += 1;
      end += 1;
    }
    blankTo(Math.min(end + 1, source.length));
  }

  function scanTemplate() {
    blankTo(cursor + 1);
    while (cursor < source.length) {
      const character = source[cursor];
      if (character === '`') {
        blankTo(cursor + 1);
        return;
      }
      if (character === '\\') {
        blankTo(Math.min(cursor + 2, source.length));
      } else if (character === '$' && source[cursor + 1] === '{') {
        blankTo(cursor + 2);
        scanExpression(true);
      } else {
        blankTo(cursor + 1);
      }
    }
  }

  function scanRegex() {
    let end = cursor + 1;
    let inClass = false;
    while (end < source.length) {
      const character = source[end];
      if (character === '\\') {
        end += 2;
        continue;
      }
      if (character === '\n' || character === '\r') return false;
      if (character === '[') inClass = true;
      else if (character === ']') inClass = false;
      else if (character === '/' && !inClass) {
        end += 1;
        while (end < source.length && /[A-Za-z]/.test(source[end])) end += 1;
        blankTo(end);
        return true;
      }
      end += 1;
    }
    return false;
  }

  function scanExpression(interpolation) {
    let depth = 0;
    let regexAllowed = true;
    while (cursor < source.length) {
      const character = source[cursor];
      if (interpolation && character === '}' && depth === 0) {
        blankTo(cursor + 1);
        return;
      }
      if (character === '/' && scanComment()) continue;
      if (character === "'" || character === '"' || character === '`') {
        if (character === '`') scanTemplate();
        else scanString();
        regexAllowed = false;
        continue;
      }
      if (character === '/' && regexAllowed && scanRegex()) {
        regexAllowed = false;
        continue;
      }
      if (/[A-Za-z_$]/.test(character)) {
        const start = cursor;
        do {
          cursor += 1;
        } while (cursor < source.length && /[\w$]/.test(source[cursor]));
        regexAllowed = REGEX_PREFIX_KEYWORDS.has(source.slice(start, cursor));
        continue;
      }
      if ('([{'.includes(character)) depth += 1;
      else if (')]}'.includes(character)) depth = Math.max(0, depth - 1);
      if (!/\s/.test(character)) regexAllowed = '([{:;,=!&|?+-*%/^~<>'.includes(character);
      cursor += 1;
    }
  }

  scanExpression(false);
  return output.join('');
}

module.exports = { sanitizeSource };
