'use strict';

// Static audit for public ES modules: flags identifiers that are referenced
// inside a module but are neither declared in it, imported by it, nor a known
// browser/JavaScript global. This is the class of bug the test bundler cannot
// see (js-module-bundle.js inlines every import into one shared scope), e.g.
// a name imported nowhere but expected from a sibling module, or a module-local
// `let` read from another module.
//
// This is a heuristic scope check, not a full parser: it flattens nested scopes
// (so a name declared anywhere in a file counts as declared) and therefore only
// produces false negatives, never false positives, for cross-module references.

const fs = require('node:fs');
const path = require('node:path');

const KEYWORDS = new Set(
  [
    'break',
    'case',
    'catch',
    'class',
    'const',
    'continue',
    'debugger',
    'default',
    'delete',
    'do',
    'else',
    'export',
    'extends',
    'finally',
    'for',
    'function',
    'if',
    'import',
    'in',
    'instanceof',
    'new',
    'return',
    'super',
    'switch',
    'this',
    'throw',
    'try',
    'typeof',
    'var',
    'void',
    'while',
    'with',
    'yield',
    'let',
    'static',
    'enum',
    'await',
    'implements',
    'interface',
    'package',
    'private',
    'protected',
    'public',
    'null',
    'true',
    'false',
    'undefined',
    'NaN',
    'Infinity',
    'arguments',
    'eval',
    'get',
    'set',
    'async',
    'of',
    'as',
    'from',
  ]
    .join(' ')
    .split(' '),
);

const BROWSER_GLOBALS = new Set(
  [
    'document',
    'window',
    'globalThis',
    'self',
    'location',
    'navigator',
    'history',
    'screen',
    'localStorage',
    'sessionStorage',
    'indexedDB',
    'performance',
    'console',
    'alert',
    'confirm',
    'prompt',
    'fetch',
    'WebSocket',
    'EventSource',
    'XMLHttpRequest',
    'FormData',
    'Blob',
    'File',
    'FileReader',
    'FileList',
    'URL',
    'URLSearchParams',
    'DOMParser',
    'Image',
    'Audio',
    'Worker',
    'SharedWorker',
    'Notification',
    'crypto',
    'atob',
    'btoa',
    'TextEncoder',
    'TextDecoder',
    'queueMicrotask',
    'structuredClone',
    'requestAnimationFrame',
    'cancelAnimationFrame',
    'requestIdleCallback',
    'cancelIdleCallback',
    'setTimeout',
    'clearTimeout',
    'setInterval',
    'clearInterval',
    'getComputedStyle',
    'matchMedia',
    'scrollTo',
    'scrollBy',
    'open',
    'close',
    'print',
    'postMessage',
    'addEventListener',
    'removeEventListener',
    'dispatchEvent',
    'Promise',
    'Symbol',
    'Proxy',
    'Reflect',
    'Map',
    'Set',
    'WeakMap',
    'WeakSet',
    'Array',
    'ArrayBuffer',
    'DataView',
    'Int8Array',
    'Uint8Array',
    'Uint8ClampedArray',
    'Int16Array',
    'Uint16Array',
    'Int32Array',
    'Uint32Array',
    'Float32Array',
    'Float64Array',
    'BigInt',
    'BigInt64Array',
    'BigUint64Array',
    'Object',
    'Function',
    'Boolean',
    'Number',
    'String',
    'Date',
    'RegExp',
    'Error',
    'TypeError',
    'RangeError',
    'ReferenceError',
    'SyntaxError',
    'EvalError',
    'URIError',
    'AggregateError',
    'JSON',
    'Math',
    'Intl',
    'parseFloat',
    'parseInt',
    'isFinite',
    'isNaN',
    'encodeURI',
    'decodeURI',
    'encodeURIComponent',
    'decodeURIComponent',
    'escape',
    'unescape',
    'HTMLElement',
    'HTMLDivElement',
    'HTMLSpanElement',
    'HTMLImageElement',
    'HTMLInputElement',
    'HTMLSelectElement',
    'HTMLButtonElement',
    'HTMLFormElement',
    'HTMLAnchorElement',
    'HTMLCanvasElement',
    'HTMLVideoElement',
    'HTMLAudioElement',
    'HTMLTextAreaElement',
    'HTMLTemplateElement',
    'Element',
    'Node',
    'NodeList',
    'Document',
    'Window',
    'Event',
    'CustomEvent',
    'MouseEvent',
    'KeyboardEvent',
    'InputEvent',
    'FocusEvent',
    'TouchEvent',
    'WheelEvent',
    'PointerEvent',
    'DragEvent',
    'ClipboardEvent',
    'MessageEvent',
    'CloseEvent',
    'ProgressEvent',
    'ErrorEvent',
    'StorageEvent',
    'PopStateEvent',
    'HashChangeEvent',
    'UIEvent',
    'AbortController',
    'AbortSignal',
    'MutationObserver',
    'IntersectionObserver',
    'ResizeObserver',
    'DOMException',
    'DOMTokenList',
    'CSSStyleDeclaration',
    'SpeechSynthesisUtterance',
    'speechSynthesis',
    'AudioContext',
    'MediaMetadata',
    'devicePixelRatio',
    'innerWidth',
    'innerHeight',
    'outerWidth',
    'outerHeight',
  ]
    .join(' ')
    .split(' '),
);

const IDENTIFIER_RE = /[A-Za-z_$][\w$]*/g;

// Keywords that can precede `(...)` and a following `{` in a non-definition
// position. `get`/`set`/`async`/`static` are deliberately absent so that a
// method literally named `get` or `set` (e.g. CacheManager#set) still counts
// as a declaration of its parameters.
const CONTROL_KEYWORDS = new Set(
  ['if', 'for', 'while', 'switch', 'catch', 'with', 'function']
    .join(' ')
    .split(' '),
);

// Replaces source[start, end) with spaces while preserving newlines so that
// reported line numbers match the original file.
function blank(source, start, end) {
  let out = '';
  for (let k = start; k < end; k += 1) {
    out += source[k] === '\n' ? '\n' : ' ';
  }
  return out;
}

// Strips comments, string literals, template literal text (keeping `${...}`
// interpolations), and regex literals, leaving the code tokens in place.
function sanitizeSource(source) {
  const n = source.length;
  let i = 0;

  function scanExpression(stopChar) {
    const seg = [];
    let parenDepth = 0;
    let bracketDepth = 0;
    let braceDepth = 0;

    const prevCharOf = (buffer) => {
      for (let k = buffer.length - 1; k >= 0; k -= 1) {
        if (!/\s/.test(buffer[k])) return buffer[k];
      }
      return '';
    };
    const lastWordOf = (buffer) => {
      let k = buffer.length - 1;
      while (k >= 0 && /\s/.test(buffer[k])) k -= 1;
      const end = k;
      while (k >= 0 && /[A-Za-z0-9_$]/.test(buffer[k])) k -= 1;
      return buffer.slice(k + 1, end + 1).join('');
    };
    const isRegexStart = (buffer) => {
      const prev = prevCharOf(buffer);
      if (!prev) return true;
      if ('([{:;,=!&|?+-*%^~<>'.includes(prev)) return true;
      return /^(return|typeof|instanceof|in|of|new|void|delete|do|else|case|yield|await|throw|extends)$/.test(
        lastWordOf(buffer),
      );
    };

    while (i < n) {
      const ch = source[i];
      if (
        stopChar &&
        ch === stopChar &&
        parenDepth === 0 &&
        bracketDepth === 0 &&
        braceDepth === 0
      ) {
        i += 1;
        break;
      }
      if (ch === '(') {
        parenDepth += 1;
        seg.push(ch);
        i += 1;
        continue;
      }
      if (ch === ')') {
        parenDepth = Math.max(0, parenDepth - 1);
        seg.push(ch);
        i += 1;
        continue;
      }
      if (ch === '[') {
        bracketDepth += 1;
        seg.push(ch);
        i += 1;
        continue;
      }
      if (ch === ']') {
        bracketDepth = Math.max(0, bracketDepth - 1);
        seg.push(ch);
        i += 1;
        continue;
      }
      if (ch === '{') {
        braceDepth += 1;
        seg.push(ch);
        i += 1;
        continue;
      }
      if (stopChar && ch === '}') {
        braceDepth = Math.max(0, braceDepth - 1);
        seg.push(ch);
        i += 1;
        continue;
      }
      if (ch === '/' && source[i + 1] === '/') {
        const end = source.indexOf('\n', i + 2);
        const stop = end === -1 ? n : end;
        seg.push(blank(source, i, stop));
        i = stop;
        continue;
      }
      if (ch === '/' && source[i + 1] === '*') {
        const end = source.indexOf('*/', i + 2);
        const stop = end === -1 ? n : end + 2;
        seg.push(blank(source, i, stop));
        i = stop;
        continue;
      }
      if (ch === "'" || ch === '"') {
        let j = i + 1;
        while (j < n && source[j] !== ch && source[j] !== '\n') {
          if (source[j] === '\\') j += 1;
          j += 1;
        }
        const stop = Math.min(j + 1, n);
        seg.push(blank(source, i, stop));
        i = stop;
        continue;
      }
      if (ch === '`') {
        seg.push(' ');
        i += 1;
        while (i < n) {
          const c = source[i];
          if (c === '`') {
            seg.push(' ');
            i += 1;
            break;
          }
          if (c === '\\') {
            seg.push(' ');
            i += 2;
            continue;
          }
          if (c === '$' && source[i + 1] === '{') {
            seg.push('  ');
            i += 2;
            seg.push(scanExpression('}'));
            continue;
          }
          seg.push(c === '\n' ? '\n' : ' ');
          i += 1;
        }
        continue;
      }
      if (ch === '/') {
        if (isRegexStart(seg)) {
          let j = i + 1;
          let inClass = false;
          let terminated = false;
          while (j < n) {
            const rc = source[j];
            if (rc === '\\') {
              j += 2;
              continue;
            }
            if (rc === '\n') break;
            if (rc === '[') inClass = true;
            else if (rc === ']') inClass = false;
            else if (rc === '/' && !inClass) {
              terminated = true;
              break;
            }
            j += 1;
          }
          if (terminated) {
            let k = j + 1;
            while (k < n && /[A-Za-z]/.test(source[k])) k += 1;
            seg.push(blank(source, i, k));
            i = k;
            continue;
          }
        }
        seg.push(ch);
        i += 1;
        continue;
      }
      seg.push(ch);
      i += 1;
    }
    return seg.join('');
  }

  return scanExpression('');
}

function balancedParens(text, openIdx) {
  let depth = 0;
  for (let k = openIdx; k < text.length; k += 1) {
    if (text[k] === '(') depth += 1;
    else if (text[k] === ')') {
      depth -= 1;
      if (depth === 0) return text.slice(openIdx + 1, k);
    }
  }
  return '';
}

function matchingOpenParenBackward(text, closeIdx) {
  let depth = 0;
  for (let k = closeIdx; k >= 0; k -= 1) {
    if (text[k] === ')') depth += 1;
    else if (text[k] === '(') {
      depth -= 1;
      if (depth === 0) return k;
    }
  }
  return -1;
}

function splitTopLevel(text, separator) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let k = 0; k < text.length; k += 1) {
    const ch = text[k];
    if (ch === '{' || ch === '[' || ch === '(') depth += 1;
    else if (ch === '}' || ch === ']' || ch === ')')
      depth = Math.max(0, depth - 1);
    else if (ch === separator && depth === 0) {
      parts.push(text.slice(start, k));
      start = k + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

function extractNames(text) {
  const names = [];
  let match;
  while ((match = IDENTIFIER_RE.exec(text))) {
    const idx = match.index;
    const prev = idx > 0 ? text[idx - 1] : '';
    const prev2 = idx > 1 ? text[idx - 2] : '';
    const after = text.slice(idx + match[0].length).trimStart();
    if (prev === '.' && prev2 !== '.') continue; // property access (…rest is kept)
    if (after.startsWith(':')) continue; // destructuring / object key
    names.push(match[0]);
  }
  return names;
}

function captureStatement(text, start) {
  let depth = 0;
  for (let k = start; k < text.length; k += 1) {
    const ch = text[k];
    if (ch === '{' || ch === '[' || ch === '(') depth += 1;
    else if (ch === '}' || ch === ']' || ch === ')')
      depth = Math.max(0, depth - 1);
    else if (ch === ';' && depth === 0) return text.slice(start, k);
  }
  return text.slice(start);
}

function collectImportedNames(sanitized) {
  const imported = new Set();
  const importRe =
    /import\s+(?:([A-Za-z_$][\w$]*)\s*,?\s*)?(?:\{([^}]*)\}|\*\s*as\s+([A-Za-z_$][\w$]*))?\s*from\s*/g;
  let match;
  while ((match = importRe.exec(sanitized))) {
    if (match[1]) imported.add(match[1]);
    if (match[2]) {
      for (const part of match[2].split(',')) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        const asMatch = trimmed.match(
          /^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/,
        );
        if (asMatch) imported.add(asMatch[2]);
        else imported.add(trimmed);
      }
    }
    if (match[3]) imported.add(match[3]);
  }
  return imported;
}

function collectDeclaredNames(sanitized) {
  const declared = new Set();
  let match;

  const functionDecl = /\bfunction\s*(?:\*\s*)?([A-Za-z_$][\w$]*)?\s*\(/g;
  while ((match = functionDecl.exec(sanitized))) {
    if (match[1]) declared.add(match[1]);
    const openIdx = match.index + match[0].length - 1;
    for (const name of extractNames(balancedParens(sanitized, openIdx)))
      declared.add(name);
  }

  const classDecl = /\bclass\s+([A-Za-z_$][\w$]*)/g;
  while ((match = classDecl.exec(sanitized))) declared.add(match[1]);

  const varDecl = /\b(?:var|let|const)\s+/g;
  while ((match = varDecl.exec(sanitized))) {
    const start = match.index + match[0].length;
    const stmt = captureStatement(sanitized, start);
    for (const part of splitTopLevel(stmt, ',')) {
      const beforeEquals = splitTopLevel(part, '=')[0];
      for (const name of extractNames(beforeEquals)) declared.add(name);
    }
  }

  // Methods, constructors, and getters/setters: name(...) { — the `{` after the
  // parameter list distinguishes a definition from a call.
  const nameParen = /[A-Za-z_$][\w$]*\s*\(/g;
  while ((match = nameParen.exec(sanitized))) {
    const name = match[0].slice(0, match[0].indexOf('('));
    if (CONTROL_KEYWORDS.has(name)) continue;
    const prev = previousChar(sanitized, match.index);
    if (prev === '.' || prev === '?') continue;
    const openIdx = match.index + match[0].length - 1;
    const params = balancedParens(sanitized, openIdx);
    const closeIdx = openIdx + params.length + 1;
    if (nextChar(sanitized, closeIdx + 1) !== '{') continue;
    declared.add(name);
    for (const n of extractNames(params)) declared.add(n);
  }

  // Arrow function parameters.
  let arrowIdx = sanitized.indexOf('=>');
  while (arrowIdx !== -1) {
    const before = sanitized.slice(0, arrowIdx).trimEnd();
    if (before.endsWith(')')) {
      const openIdx = matchingOpenParenBackward(sanitized, before.length - 1);
      if (openIdx !== -1) {
        for (const name of extractNames(
          sanitized.slice(openIdx + 1, before.length - 1),
        ))
          declared.add(name);
      }
    } else {
      const identMatch = /([A-Za-z_$][\w$]*)\s*$/.exec(before);
      if (identMatch && !KEYWORDS.has(identMatch[1]))
        declared.add(identMatch[1]);
    }
    arrowIdx = sanitized.indexOf('=>', arrowIdx + 2);
  }

  // Class fields and other function-valued assignments: name = (...) => ...
  const fieldArrow =
    /\b([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:[A-Za-z_$][\w$]*|\([^()]*\))\s*=>/g;
  while ((match = fieldArrow.exec(sanitized))) declared.add(match[1]);

  // catch parameters.
  const catchParams = /\bcatch\s*\(/g;
  while ((match = catchParams.exec(sanitized))) {
    const openIdx = match.index + match[0].length - 1;
    for (const name of extractNames(balancedParens(sanitized, openIdx)))
      declared.add(name);
  }

  return declared;
}

function previousWord(text, start) {
  let k = start - 1;
  while (k >= 0 && /\s/.test(text[k])) k -= 1;
  const end = k;
  while (k >= 0 && /[A-Za-z0-9_$]/.test(text[k])) k -= 1;
  return text.slice(k + 1, end + 1);
}

function previousChar(text, start) {
  for (let k = start - 1; k >= 0; k -= 1) {
    if (!/\s/.test(text[k])) return text[k];
  }
  return '';
}

function nextChar(text, end) {
  for (let k = end; k < text.length; k += 1) {
    if (!/\s/.test(text[k])) return text[k];
  }
  return '';
}

function collectUnresolvedUsages(sanitized, imported, declared) {
  const unresolved = new Map();
  let match;
  while ((match = IDENTIFIER_RE.exec(sanitized))) {
    const name = match[0];
    if (KEYWORDS.has(name)) continue;
    if (imported.has(name) || declared.has(name) || BROWSER_GLOBALS.has(name))
      continue;
    const prev = previousChar(sanitized, match.index);
    const next = nextChar(sanitized, match.index + name.length);
    if (prev === '.') continue;
    if (prev === '#') continue;
    if (next === ':') continue;
    if (prev === '{' && next === '(') continue;
    const word = previousWord(sanitized, match.index);
    if (
      (word === 'get' ||
        word === 'set' ||
        word === 'async' ||
        word === 'static') &&
      next === '('
    )
      continue;
    if (!unresolved.has(name)) {
      const line = sanitized.slice(0, match.index).split('\n').length;
      unresolved.set(name, line);
    }
  }
  return [...unresolved.entries()]
    .map(([name, line]) => ({ name, line }))
    .sort((a, b) => a.line - b.line || a.name.localeCompare(b.name));
}

function auditFile(filePath) {
  const source = fs.readFileSync(filePath, 'utf8');
  const sanitized = sanitizeSource(source);
  if (!/\b(import|export)\b/.test(sanitized)) return null;

  const imported = collectImportedNames(sanitized);
  const declared = collectDeclaredNames(sanitized);
  const unresolved = collectUnresolvedUsages(sanitized, imported, declared);
  return { file: filePath, unresolved };
}

function auditPublicEsModules(directory) {
  const findings = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      findings.push(...auditPublicEsModules(filePath));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      const result = auditFile(filePath);
      if (result && result.unresolved.length > 0) findings.push(result);
    }
  }
  return findings;
}

module.exports = { auditPublicEsModules, sanitizeSource };
