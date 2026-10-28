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

test('the installer agreement page starts declined and owns the builder license slot', () => {
  const root = path.join(__dirname, '../..');
  const installer = fs.readFileSync(path.join(root, 'build', 'installer.nsh'), 'utf8');
  const page = installer.match(/!macro licensePage\b[\s\S]*?!macroend/)?.[0] ?? '';
  const agreement = fs.readFileSync(path.join(root, 'build', 'user-agreement.txt'));
  const { build } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

  assert.match(page, /!define MUI_LICENSEPAGE_RADIOBUTTONS\s/);
  assert.match(page, /!insertmacro MUI_PAGE_LICENSE "\$\{BUILD_RESOURCES_DIR\}\\user-agreement\.txt"/);
  // makensis reads a BOM-less UTF-8 text file with the system code page.
  assert.deepEqual([...agreement.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  // A builder license option or file would generate a second licensePage macro.
  assert.equal(build.nsis.license, undefined);
  assert.deepEqual(fs.readdirSync(path.join(root, 'build')).filter(name => /^(license|eula)/i.test(name)), []);
});
