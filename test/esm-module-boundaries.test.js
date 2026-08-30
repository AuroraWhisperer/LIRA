'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { auditPublicEsModules } = require('./helpers/esm-scope-audit');

const PUBLIC_JS_DIR = path.join(__dirname, '..', 'public', 'js');

test('every public ES module only references identifiers it declares or imports', () => {
  const findings = auditPublicEsModules(PUBLIC_JS_DIR);
  const details = findings
    .map(({ file, unresolved }) => {
      const relative = path.relative(PUBLIC_JS_DIR, file);
      const names = unresolved
        .map(({ name, line }) => `${name} (line ${line})`)
        .join(', ');
      return `${relative}: ${names}`;
    })
    .join('\n');
  assert.deepEqual(findings, [], `unbound identifiers found:\n${details}`);
});
