'use strict';

const path = require('node:path');

function cssReferences(source) {
  const text = source.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...text.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)]+))\s*\)|@import\s*(?:"([^"]*)"|'([^']*)')/gi)]
    .map(match => match.slice(1).find(value => value !== undefined));
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
  const tag = source.replace(/<!--[\s\S]*?-->/g, '').match(/<base\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
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
    const text = source.replace(/("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g, (match, quoted) => quoted || '');
    const references = [...text.matchAll(/(?:\bimport\s*\(?|\bfrom\s*)\s*["']([^"']+)["']/g)].map(match => match[1]);
    for (const match of text.matchAll(/\bfetch\s*\(\s*["']([^"']+)["']/g)) references.push(rebase(match[1], documentEntry, entry));
    for (const match of text.matchAll(/\bnew\s+URL\s*\(\s*["']([^"']+)["']\s*,\s*(import\.meta\.url|document\.baseURI|(?:window\.)?location\.href)/g)) {
      references.push(rebase(match[1], match[2] === 'import.meta.url' ? entry : documentEntry, entry));
    }
    return references;
  }
  if (!/\.html?$/i.test(entry)) return [];
  const text = source.replace(/<!--[\s\S]*?-->/g, '').replace(/<base\b[^>]*>/gi, '');
  const references = [];
  for (const match of text.matchAll(/\b(src|href|poster|srcset|style)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
    const value = htmlValue(match[2] ?? match[3] ?? match[4]);
    const name = match[1].toLowerCase();
    if (name === 'style') references.push(...cssReferences(value));
    else if (name === 'srcset') {
      for (const candidate of value.matchAll(/(?:^|,)\s*(data:[^\s]+|[^\s,]+)(?:\s+[^,]*)?/g)) references.push(candidate[1]);
    } else references.push(value);
  }
  for (const match of text.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)) references.push(...cssReferences(match[1]));
  for (const match of text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)) references.push(...webFileReferences(match[1], 'inline.js'));
  const base = webDocumentBase(source, entry);
  return references.map(reference => rebase(reference, base, entry));
}

function localWebReference(reference) {
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(reference)) return null;
  const value = reference.split(/[?#]/)[0];
  return /\.(?:html?|css|js|mjs|json|png|jpe?g|gif|webp|avif|svg|ico|mp4|webm|mp3|wav|ogg|woff2?|ttf|otf)$/i.test(value) ? value : null;
}

module.exports = { webFileReferences, localWebReference, webDocumentBase };
