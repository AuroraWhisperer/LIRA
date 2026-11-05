'use strict';

const path = require('node:path');

function stripWebComments(source, opening, closing) {
  const parts = [];
  let position = 0;
  let start;
  while ((start = source.indexOf(opening, position)) !== -1) {
    parts.push(source.slice(position, start));
    const end = source.indexOf(closing, start + opening.length);
    if (end === -1) return parts.join('');
    position = end + closing.length;
  }
  parts.push(source.slice(position));
  return parts.join('');
}

function cssReferences(source) {
  const text = stripWebComments(source, '/*', '*/');
  return [...text.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s()"']+))\s*\)|@import\s*(?:"([^"]*)"|'([^']*)')/gi)]
    .map(match => match.slice(1).find(value => value !== undefined));
}

function javascriptText(source) {
  const parts = [];
  let position = 0;
  for (let index = 0; index < source.length;) {
    const character = source[index];
    if (character === '"' || character === "'" || character === '`') {
      index++;
      while (index < source.length) {
        if (source[index] === '\\') index += 2;
        else if (source[index++] === character) break;
      }
    } else if (source.startsWith('/*', index) || source.startsWith('//', index)) {
      parts.push(source.slice(position, index), ' ');
      if (source[index + 1] === '*') {
        const end = source.indexOf('*/', index + 2);
        index = end === -1 ? source.length : end + 2;
      } else {
        while (index < source.length && !/[\r\n]/.test(source[index])) index++;
      }
      position = index;
    } else index++;
  }
  parts.push(source.slice(position));
  return parts.join('');
}

function* rawElements(text, name) {
  const opening = new RegExp(`<${name}\\b[^<>]*>`, 'gi');
  const closing = new RegExp(`</${name}\\s*>`, 'gi');
  while (opening.exec(text)) {
    closing.lastIndex = opening.lastIndex;
    const end = closing.exec(text);
    if (!end) return;
    yield text.slice(opening.lastIndex, end.index);
    opening.lastIndex = closing.lastIndex;
  }
}

function htmlValue(value) {
  return value.replace(/&(?:amp|quot|apos|lt|gt|#\d+|#x[a-f\d]+);/gi, entity => {
    const key = entity.slice(1, -1).toLowerCase();
    if (key.startsWith('#')) {
      const number = key.startsWith('#x') ? parseInt(key.slice(2), 16) : Number(key.slice(1));
      return number > 0 && number <= 0x10ffff ? String.fromCodePoint(number) : '';
    }
    return { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' }[key];
  });
}

function webDocumentBase(source, entry) {
  const tag = stripWebComments(source, '<!--', '-->').match(/<base\b[^<>]*\bhref\s*=\s*(?:"([^"<>]*)"|'([^'<>]*)'|([^\s<>]+))/i);
  if (!tag) return entry;
  const value = htmlValue(tag[1] ?? tag[2] ?? tag[3]);
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(value)) return value;
  const base = path.posix.join(path.posix.dirname(entry.replaceAll('\\', '/')), value);
  return value.endsWith('/') ? `${base}/_` : base;
}

function rebase(reference, base, entry) {
  if (/^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(reference)) return reference;
  if (!/^[a-z]:[\\/]/i.test(base) && /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(base)) return new URL(reference, base.startsWith('//') ? `https:${base}` : base).href;
  return path.posix.join(path.posix.relative(path.posix.dirname(entry.replaceAll('\\', '/')), path.posix.dirname(base.replaceAll('\\', '/'))), reference);
}

function webFileReferences(source, entry, documentEntry = entry) {
  if (/\.css$/i.test(entry)) return cssReferences(source);
  if (/\.(?:js|mjs)$/i.test(entry)) {
    const text = javascriptText(source);
    const references = [...text.matchAll(/(?:\bimport\s*\(?|\bfrom\s*)\s*["']([^"']+)["']/g)].map(match => match[1]);
    for (const match of text.matchAll(/\bfetch\s*\(\s*["']([^"']+)["']/g)) references.push(rebase(match[1], documentEntry, entry));
    for (const match of text.matchAll(/\bnew\s+URL\s*\(\s*["']([^"']+)["']\s*,\s*(import\.meta\.url|document\.baseURI|(?:window\.)?location\.href)/g)) {
      references.push(rebase(match[1], match[2] === 'import.meta.url' ? entry : documentEntry, entry));
    }
    return references;
  }
  if (!/\.html?$/i.test(entry)) return [];
  const text = stripWebComments(source, '<!--', '-->').replace(/<base\b[^<>]*>/gi, '');
  const references = [];
  for (const match of text.matchAll(/\b(src|href|poster|srcset|style)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
    const value = htmlValue(match[2] ?? match[3] ?? match[4]);
    const name = match[1].toLowerCase();
    if (name === 'style') references.push(...cssReferences(value));
    else if (name === 'srcset') {
      for (const candidate of value.matchAll(/(?:^|,)\s*(data:[^\s]+|[^\s,]+)(?:\s+[^,]*)?/g)) references.push(candidate[1]);
    } else references.push(value);
  }
  for (const source of rawElements(text, 'style')) references.push(...cssReferences(source));
  for (const source of rawElements(text, 'script')) references.push(...webFileReferences(source, 'inline.js'));
  const base = webDocumentBase(source, entry);
  return references.map(reference => rebase(reference, base, entry));
}

function localWebReference(reference) {
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(reference)) return null;
  const value = reference.split(/[?#]/)[0];
  return /\.(?:html?|css|js|mjs|json|png|jpe?g|gif|webp|avif|svg|ico|mp4|webm|mp3|wav|ogg|woff2?|ttf|otf)$/i.test(value) ? value : null;
}

module.exports = { webFileReferences, localWebReference, webDocumentBase, stripWebComments };
