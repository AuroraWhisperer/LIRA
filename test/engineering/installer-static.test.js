'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('installer stale-entry cleanup uses the builder app key, context, and quoted executable parser', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../build/installer.nsh'), 'utf8');
  assert.doesNotMatch(source, /EnumRegKey/);
  assert.match(source, /ReadRegStr \$R3 SHELL_CONTEXT "\$\{UNINSTALL_REGISTRY_KEY\}" "UninstallString"/);
  assert.match(source, /Push "\$R3"\s+Call GetInQuotes\s+Pop \$R4/);
  assert.doesNotMatch(source, /!insertmacro GetInQuotes/);
  assert.match(
    source,
    /StrCmp \$R4 "" customInitDone\s+IfFileExists "\$R4" customInitDone\s+DeleteRegKey SHELL_CONTEXT "\$\{UNINSTALL_REGISTRY_KEY\}"/,
  );
  assert.doesNotMatch(source, /IfFileExists "\$R3"/);
});

test('the Windows installer preserves legacy data before uninstalling an update', () => {
  const installer = fs.readFileSync(path.join(__dirname, '../..', 'build', 'installer.nsh'), 'utf8');
  const preservation = fs.readFileSync(path.join(__dirname, '../..', 'build', 'installer-data.nsh'), 'utf8');
  const removal = fs.readFileSync(path.join(__dirname, '../..', 'build', 'installer-uninstall.nsh'), 'utf8');

  assert.match(preservation, /\$INSTDIR\\data/);
  assert.match(preservation, /\$APPDATA\\com\.aurorawhisperer\.lira\\data/);
  assert.match(preservation, /robocopy\.exe/);
  assert.match(installer, /Section "-LIRA Preserve Data"/);
  assert.match(installer, /!include "installer-uninstall\.nsh"/);
  assert.match(removal, /!macro customRemoveFiles/);
  assert.match(preservation, /lira-data-backup/);
  assert.ok(installer.indexOf('Call liraWaitForAppExit') < installer.indexOf('Call liraPreserveInstallData'));
  assert.match(installer, /SetShellVarContext current\s+Call liraPreserveInstallData/);
  assert.doesNotMatch(installer, /RMDir \/r "\$APPDATA\\LIRA"/);
});
