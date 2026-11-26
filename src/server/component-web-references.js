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
  const references = [];
  // Remove comments outside quoted strings so they may also separate @import and its path.
  const text = source.replace(/"(?:\\[\s\S]|[^"\\])*(?:"|$)|'(?:\\[\s\S]|[^'\\])*(?:'|$)|\/\*[\s\S]*?(?:\*\/|$)/g,
    token => token.startsWith('/*') ? ' ' : token);
  const tokens = /\burl\(\s*(?:"([^"]*)"|'([^']*)'|([^\s()"']+))\s*\)|@import\s*(?:"([^"]*)"|'([^']*)')|"(?:\\[\s\S]|[^"\\])*(?:"|$)|'(?:\\[\s\S]|[^'\\])*(?:'|$)/gi;
  for (const match of text.matchAll(tokens)) {
    const reference = match.slice(1).find(value => value !== undefined);
    if (reference !== undefined) references.push(reference);
  }
  return references;
}

function javascriptRegexpEnd(source, index) {
  let inClass = false;
  for (; index < source.length; index++) {
    const character = source[index];
    if (/[\r\n\u2028\u2029]/.test(character)) break;
    if (character === '\\') index++;
    else if (character === '[') inClass = true;
    else if (character === ']') inClass = false;
    else if (character === '/' && !inClass) {
      while (/[a-z]/i.test(source.charAt(index + 1))) index++;
      return index + 1;
    }
  }
  return index;
}

function javascriptCodeAndStrings(source) {
  const parts = [];
  const strings = [];
  const tokens = /[\w$]+|\+\+|--|\S/g;
  const controlGroups = [];
  let position = 0;
  let operandExpected = true;
  let controlKeyword = false;
  let token;
  while ((token = tokens.exec(source))) {
    const character = token[0];
    let index = token.index;
    if (character === '"' || character === "'" || character === '`') {
      const start = index++;
      while (index < source.length) {
        if (source[index] === '\\') index += 2;
        else if (source[index++] === character) break;
      }
      const value = source.slice(start + 1, index - 1);
      parts.push(source.slice(position, start));
      if (source[index - 1] === character && !(character === '`' && value.includes('${'))) {
        // Keep literal contents out of code matches, including examples of resource assignments.
        parts.push(`"${strings.length}"`);
        strings.push(value.replace(/\\(['"`/\\])/g, '$1'));
      } else parts.push('`dynamic`');
      tokens.lastIndex = position = index;
      operandExpected = false;
    } else if (character === '/' && (source[index + 1] === '*' || source[index + 1] === '/')) {
      parts.push(source.slice(position, index), ' ');
      if (source[index + 1] === '*') {
        const end = source.indexOf('*/', index + 2);
        index = end === -1 ? source.length : end + 2;
      } else {
        while (index < source.length && !/[\r\n]/.test(source[index])) index++;
      }
      tokens.lastIndex = position = index;
      continue;
    } else if (character === '/' && operandExpected) {
      // Quotes inside a regexp belong to its pattern. A slash after an operand is division.
      parts.push(source.slice(position, index), '0');
      tokens.lastIndex = position = javascriptRegexpEnd(source, index + 1);
      operandExpected = false;
    } else {
      if (character === '(') controlGroups.push(controlKeyword);
      operandExpected = character === ')' ? controlGroups.pop() === true
        : /^(?:[([{,;:?~!=&|^<>*%+/-]|return|throw|case|yield|await|typeof|void|delete|in|instanceof|of|else|do)$/.test(character);
    }
    controlKeyword = /^(?:if|for|while|with|switch|catch)$/.test(character);
  }
  parts.push(source.slice(position));
  return { code: parts.join(''), strings };
}

function* javascriptScopeParts(code) {
  const root = { parent: null, names: new Set(), images: new Set() };
  let scope = root;
  root.functionScope = root;
  const groups = [];
  let group = {};
  let parameters;
  let start = 0;
  // A declarator list resumes after an initializer's nested calls, objects or arrays.
  const structure = /\b(if|for|while|switch|with|catch)\s*\(|\b(const|let|var)\s+([\w$]+)|,\s*([\w$]+)(?=\s*(?:=(?!=|>)|[,;]))|[()[\]{};]/g;
  for (const match of code.matchAll(structure)) {
    const [token, control, kind, firstName, nextName] = match;
    if (firstName) {
      group.declarations = (kind === 'var' ? scope.functionScope : scope).names;
      group.declarations.add(firstName);
      continue;
    }
    if (nextName) { group.declarations?.add(nextName); continue; }
    if (token === ';') { group.declarations = null; continue; }
    if (token.endsWith('(') || token === '[') {
      groups.push(group);
      group = { start: match.index + token.length, control };
      continue;
    }
    if (token === ')' || token === ']') {
      if (token === ')') parameters = { ...group, end: match.index };
      group = groups.pop() ?? {};
      continue;
    }
    const part = code.slice(start, match.index);
    yield { part, scope };
    start = match.index + 1;
    if (token === '}') {
      scope = scope.parent ?? root;
      group = groups.pop() ?? {};
      continue;
    }
    groups.push(group);
    group = {};
    const tail = part.trimEnd();
    const arrow = tail.endsWith('=>');
    const head = arrow ? tail.slice(0, -2).trimEnd() : tail;
    const args = head.endsWith(')') ? parameters : null;
    const isFunction = arrow || (args && !args.control);
    scope = { parent: scope, names: new Set(), images: new Set(), functionScope: scope.functionScope };
    if (isFunction) scope.functionScope = scope;
    if (isFunction || args?.control === 'catch') {
      const params = args ? code.slice(args.start, args.end) : head.match(/[\w$]+$/)?.[0] ?? '';
      for (const param of params.split(',')) {
        const name = param.trim().match(/^(?:\.\.\.)?([\w$]+)(?:\s*=|$)/)?.[1];
        if (name) scope.names.add(name);
      }
    }
  }
  yield { part: code.slice(start), scope };
}

function* javascriptImageSources(code, strings) {
  const imageCode = code.replace(/\bdocument\.createElement\s*\(\s*"(\d+)"\s*\)/g,
    (call, tag) => strings[tag].toLowerCase() === 'img' ? 'new Image()' : call);
  if (!imageCode.includes('Image')) return;
  const constructors = [];
  const writes = [];
  for (const { part, scope } of javascriptScopeParts(imageCode)) {
    for (const [, name] of part.matchAll(/(?<![\w$.])([\w$]+(?:\s*\.\s*[\w$]+)*)\s*=\s*new\s+(?:window\.)?Image\b/g)) {
      constructors.push({ scope, name: name.replace(/\s/g, '') });
    }
    for (const [, name, literal] of part.matchAll(/(?<![\w$.])([\w$]+(?:\s*\.\s*[\w$]+)*|new\s+(?:window\.)?Image\s*\([^()]*\))\s*\.\s*src\s*=\s*"(\d+)"(?!\s*(?:\+|\.|\[))/g)) {
      writes.push({ scope, name: name.replace(/\s/g, ''), literal });
    }
  }
  function bindingScope(scope, name) {
    const receiver = name.split('.', 1)[0];
    while (scope.parent && !scope.names.has(receiver)) scope = scope.parent;
    return scope;
  }
  // Resolve after collecting declarations so a callback can capture an image declared later.
  for (const { scope, name } of constructors) bindingScope(scope, name).images.add(name);
  for (const { scope, name, literal } of writes) {
    if (name.endsWith(')') || bindingScope(scope, name).images.has(name)) yield strings[literal];
  }
}

function javascriptReferences(source, entry, documentEntry) {
  const { code, strings } = javascriptCodeAndStrings(source);
  const references = [...code.matchAll(/(?:\bimport\s*\(?|\bfrom\s*)\s*"(\d+)"/g)].map(match => strings[match[1]]);
  for (const match of code.matchAll(/\bfetch\s*\(\s*"(\d+)"/g)) references.push(rebase(strings[match[1]], documentEntry, entry));
  for (const match of code.matchAll(/\bnew\s+URL\s*\(\s*"(\d+)"\s*,\s*(import\.meta\.url|document\.baseURI|(?:window\.)?location\.href)/g)) {
    references.push(rebase(strings[match[1]], match[2] === 'import.meta.url' ? entry : documentEntry, entry));
  }
  for (const value of javascriptImageSources(code, strings)) references.push(rebase(value, documentEntry, entry));
  return references;
}

function* htmlElements(source) {
  const text = stripWebComments(source, '<!--', '-->');
  const opening = /<([a-z][\w:-]*)/gi;
  let match;
  while ((match = opening.exec(text))) {
    const name = match[1].toLowerCase();
    const start = opening.lastIndex;
    let end = start;
    while (end < text.length && text[end] !== '>' && text[end] !== '<') {
      if (text[end] === '"' || text[end] === "'") {
        end = text.indexOf(text[end], end + 1);
        if (end === -1) return;
      }
      end++;
    }
    if (text[end] !== '>') { opening.lastIndex = end; continue; }
    opening.lastIndex = end + 1;
    let body = '';
    if (['style', 'script', 'title', 'textarea'].includes(name)) {
      const closing = new RegExp(`</${name}\\s*>`, 'gi');
      closing.lastIndex = opening.lastIndex;
      const close = closing.exec(text);
      body = text.slice(opening.lastIndex, close?.index);
      opening.lastIndex = close ? closing.lastIndex : text.length;
    }
    yield { name, attributes: text.slice(start, end), body };
  }
}

function* htmlAttributes(text) {
  const pairs = /([^\s/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  for (const match of text.matchAll(pairs)) {
    yield [match[1].toLowerCase(), htmlValue(match[2] ?? match[3] ?? match[4] ?? '')];
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
  for (const tag of htmlElements(source)) if (tag.name === 'base') {
    for (const [key, value] of htmlAttributes(tag.attributes)) if (key === 'href') {
      if (!value) return entry;
      if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(value)) return value;
      if (isUrlBase(entry)) return new URL(value, entry.startsWith('//') ? `https:${entry}` : entry).href;
      const base = path.posix.join(path.posix.dirname(entry.replaceAll('\\', '/')), value);
      return value.endsWith('/') ? `${base}/_` : base;
    }
  }
  return entry;
}

function isUrlBase(base) {
  return !/^[a-z]:[\\/]/i.test(base) && /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(base);
}

function rebase(reference, base, entry) {
  if (/^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(reference)) return reference;
  if (isUrlBase(base)) return new URL(reference, base.startsWith('//') ? `https:${base}` : base).href;
  return path.posix.join(path.posix.relative(path.posix.dirname(entry.replaceAll('\\', '/')), path.posix.dirname(base.replaceAll('\\', '/'))), reference);
}

function* webFileReferences(source, entry, documentEntry = entry) {
  if (!/\.html?$/i.test(entry)) {
    if (!/\.(?:css|m?js)$/i.test(entry)) return;
    const references = /\.css$/i.test(entry) ? cssReferences(source) : javascriptReferences(source, entry, documentEntry);
    for (const reference of references) yield { reference, documentEntry };
    return;
  }
  const documents = [{ html: source, inheritedBase: entry }];
  while (documents.length) {
    const { html, inheritedBase } = documents.pop();
    const base = webDocumentBase(html, inheritedBase);
    const references = [];
    for (const tag of htmlElements(html)) {
      if (tag.name === 'base') continue;
      const attributes = new Map(htmlAttributes(tag.attributes));
      const embedded = tag.name === 'iframe' && attributes.has('srcdoc');
      if (embedded) documents.push({ html: attributes.get('srcdoc'), inheritedBase: base });
      for (const [name, value] of attributes) {
        if (embedded && name === 'src') continue;
        if (name === 'style') references.push(...cssReferences(value));
        else if (name === 'srcset') {
          for (const candidate of value.matchAll(/(?:^|,)\s*(data:[^\s]+|[^\s,]+)(?:\s+[^,]*)?/g)) references.push(candidate[1]);
        } else if (['src', 'href', 'xlink:href', 'poster'].includes(name)) references.push(value);
      }
      if (tag.name === 'style') references.push(...cssReferences(tag.body));
      if (tag.name === 'script') references.push(...javascriptReferences(tag.body, entry, entry));
    }
    for (const value of references) yield { reference: rebase(value, base, entry), documentEntry: base };
  }
}

function localWebReference(reference) {
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(reference)) return null;
  const value = reference.split(/[?#]/)[0];
  return /\.(?:html?|css|js|mjs|json|png|jpe?g|gif|webp|avif|svg|ico|mp4|webm|mp3|wav|ogg|woff2?|ttf|otf)$/i.test(value) ? value : null;
}

module.exports = { webFileReferences, localWebReference, stripWebComments };
