'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  sanitizeSource,
  auditPublicEsModules,
} = require('./helpers/esm-scope-audit');

function assertLocations(source, sanitized, names) {
  assert.equal(sanitized.length, source.length);
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '\n' || source[index] === '\r')
      assert.equal(sanitized[index], source[index]);
  }
  for (const name of names)
    assert.equal(sanitized.indexOf(name), source.indexOf(name), name);
}

test('source sanitizer keeps UTF-16 offsets and line endings through nested template interpolations', () => {
  const source = [
    'const value = `😀 escaped \\` and \\${literal}',
    '${first + `nested ${second({ key: third })}`}',
    '\\',
    'continued ${fourth}`; finalReference();',
  ].join('\r\n');
  const sanitized = sanitizeSource(source);
  assertLocations(source, sanitized, [
    'first',
    'second',
    'third',
    'fourth',
    'finalReference',
  ]);
  assert.doesNotMatch(sanitized, /escaped|literal|nested|continued|😀/);
});

test('source sanitizer masks strings, comments, and regex classes without masking division operands', () => {
  const source = [
    String.raw`const pattern = /[/\]a-z]+\/regexText/gi; // commentName`,
    String.raw`const text = 'escaped\'stringName'; /* blockName`,
    'nextCommentLine */ const ratio = numerator / denominator / divisor;',
    'function match(value) { return /returnRegex/.test(value); }',
    'const a = "text" / stringDivisor; const b = `text` / templateDivisor;',
    'const c = /pattern/ / regexDivisor; const d = numerator / /* comment */ otherDivisor;',
  ].join('\n');
  const sanitized = sanitizeSource(source);
  assertLocations(source, sanitized, [
    'numerator',
    'denominator',
    'divisor',
    'stringDivisor',
    'templateDivisor',
    'regexDivisor',
    'otherDivisor',
  ]);
  assert.doesNotMatch(
    sanitized,
    /regexText|stringName|commentName|blockName|nextCommentLine|returnRegex/,
  );
  assert.match(sanitized, /numerator \/ denominator \/ divisor/);
});

test('source sanitizer retains references in interpolations containing braces, regex, and division', () => {
  const source =
    'export const result = `outer ${format({ value: /[}]/.test(input) ? `nested ${inner}` : total / divisor })} end`; after();';
  const sanitized = sanitizeSource(source);
  assertLocations(source, sanitized, [
    'format',
    'input',
    'inner',
    'total',
    'divisor',
    'after',
  ]);
});

test('scope audit ignores numeric literal suffixes and reports unresolved interpolation references at original lines', (t) => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'lira-esm-sanitizer-'),
  );
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'sample.js');
  fs.writeFileSync(
    file,
    [
      'export const number = 0x8000 + 0b10 + 0o10 + 1e3 + 10n;',
      'export const text = `escaped \\',
      '${missing}`;',
    ].join('\n'),
  );
  assert.deepEqual(auditPublicEsModules(directory), [
    {
      file,
      unresolved: [{ name: 'missing', line: 3 }],
    },
  ]);
});
