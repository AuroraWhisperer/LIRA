'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('installer stale-entry cleanup uses the builder app key, context, and quoted executable parser', () => {
  const source = fs.readFileSync(path.join(__dirname, '../build/installer.nsh'), 'utf8');
  assert.doesNotMatch(source, /EnumRegKey/);
  assert.match(source, /ReadRegStr \$R3 SHELL_CONTEXT "\$\{UNINSTALL_REGISTRY_KEY\}" "UninstallString"/);
  assert.match(source, /!insertmacro GetInQuotes \$R4 "\$R3"/);
  assert.match(source, /StrCmp \$R4 "" customInitDone\s+IfFileExists "\$R4" customInitDone\s+DeleteRegKey SHELL_CONTEXT "\$\{UNINSTALL_REGISTRY_KEY\}"/);
  assert.doesNotMatch(source, /IfFileExists "\$R3"/);
});
