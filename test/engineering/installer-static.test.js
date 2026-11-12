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
  const removal = fs.readFileSync(path.join(__dirname, '../..', 'build', 'installer-uninstall.nsh'), 'utf8');

  assert.match(installer, /Section "-LIRA Preserve Data"/);
  assert.match(installer, /!include "installer-uninstall\.nsh"/);
  assert.match(removal, /!macro customRemoveFiles/);
  assert.ok(installer.indexOf('Call liraWaitForAppExit') < installer.indexOf('Call liraPreserveInstallData'));
  assert.match(installer, /SetShellVarContext current\s+Call liraPreserveInstallData/);
  assert.doesNotMatch(installer, /RMDir \/r "\$APPDATA\\LIRA"/);
});

test('installer mode and target checks precede process shutdown and data preservation', () => {
  const root = path.join(__dirname, '../..');
  const { build } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const installer = fs.readFileSync(path.join(root, 'build/installer.nsh'), 'utf8');
  const preservation = installer.match(/Section "-LIRA Preserve Data"[\s\S]*?SectionEnd/)[0];
  assert.equal(build.nsis.perMachine, false);
  assert.equal(build.nsis.allowElevation, false);
  assert.match(installer, /!macro customInit\s+Call liraRequireUserInstall/);
  assert.ok(preservation.indexOf('Call liraRequireWritableInstallDirectory') < preservation.indexOf('Call liraWaitForAppExit'));
});

test('the installer agreement requires explicit acceptance and owns the builder license slot', () => {
  const root = path.join(__dirname, '../..');
  const installer = fs.readFileSync(path.join(root, 'build', 'installer.nsh'), 'utf8');
  const page = installer.match(/!macro licensePage\b[\s\S]*?!macroend/)?.[0] ?? '';
  const agreement = fs.readFileSync(path.join(root, 'public', 'pages', 'admin', 'toolbox', 'user-agreement.txt'));
  const { build } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

  assert.match(page, /Page custom liraShowAgreement liraLeaveAgreement/);
  assert.match(page, /\$\{Else\}\s+\$\{NSD_Check\} \$liraAgreementDecline/);
  assert.match(page, /EnableWindow \$0 \$liraAgreementAccepted/);
  assert.match(page, /Function liraLeaveAgreement\s+\$\{NSD_GetState\} \$liraAgreementAccept \$liraAgreementAccepted\s+\$\{If\} \$liraAgreementAccepted != \$\{BST_CHECKED\}\s+Abort/);
  assert.match(page, /Function liraShowAgreement\s+\$\{If\} \$\{isUpdated\}\s+Abort/);
  const version = agreement.toString('utf8').match(/^协议版本：(\d{4}-\d{2}-\d{2})/m)?.[1];
  assert.ok(version);
  assert.ok(page.includes('!define LIRA_AGREEMENT_URL "https://lirahub.cn/legal/terms"'));
  assert.ok(page.includes('!define LIRA_PRIVACY_URL "https://lirahub.cn/legal/privacy"'));
  // A builder license option or file would generate a second licensePage macro.
  assert.equal(build.nsis.license, undefined);
  assert.deepEqual(fs.readdirSync(path.join(root, 'build')).filter(name => /^(license|eula)/i.test(name)), []);
});
