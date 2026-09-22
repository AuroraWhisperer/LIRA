'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { NsisScriptGenerator } = require('app-builder-lib/out/targets/nsis/nsisScriptGenerator');

const compiler = process.env.LIRA_TEST_MAKENSIS;
const plugins = process.env.LIRA_TEST_NSIS_PLUGINS;
const quote = (value) => value.replaceAll('$', () => '$$');
const installerPath = path.join(__dirname, '../build/installer.nsh');

test('uninstall data removal requires an unchecked option and a default-no confirmation', () => {
  const installer = fs.readFileSync(installerPath, 'utf8');
  assert.match(installer, /!include "installer-uninstall\.nsh"/);
  const source = fs.readFileSync(path.join(__dirname, '../build/installer-uninstall.nsh'), 'utf8');
  assert.match(source, /\$\{NSD_Uncheck\} \$liraDeleteDataCheckbox/);
  assert.match(
    source,
    /MessageBox MB_YESNO\|MB_ICONEXCLAMATION\|MB_DEFBUTTON2[^\n]+\/SD IDNO IDYES liraDataDeletionConfirmed/,
  );
  assert.match(source, /StrCpy \$liraDeleteDataConfirmed "0"/);
  assert.equal(require('../package.json').build.nsis.oneClick, false);
});

test(
  'NSIS uninstall distinguishes retained data, confirmed deletion and upgrades',
  {
    skip:
      process.platform !== 'win32' || !compiler || !plugins
        ? 'Requires Windows, LIRA_TEST_MAKENSIS and LIRA_TEST_NSIS_PLUGINS'
        : false,
  },
  async (t) => {
    const removal = fs.readFileSync(path.join(__dirname, '../build/installer-uninstall.nsh'), 'utf8');
    const flags = new NsisScriptGenerator();
    flags.flags(['updated']);
    for (const [name, approved, silent, updated] of [
      ['default-retention', false, false, false],
      ['confirmed-deletion', true, false, false],
      ['silent-retention', false, true, false],
      ['silent-rejects-deletion', true, true, false],
      ['interactive-upgrade', true, false, true],
      ['silent-upgrade', true, true, true],
      ['linked-data', true, false, false],
      ['linked-data-root', true, false, false],
      ['linked-legacy-data', true, false, false],
      ['locked-logs', false, true, false],
      ['empty-install-root', false, true, false],
      ['drive-install-root', false, true, false],
      ['linked-install-root', false, true, false],
    ]) {
      await t.test(name, () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-uninstall-test-'));
        const installDir = path.join(root, '安装目录 LIRA');
        const appData = path.join(root, 'roaming');
        const legacyData = path.join(appData, 'com.aurorawhisperer.lira', 'data');
        const legacyBrowser = path.join(appData, 'lira');
        const outside = path.join(root, 'other-application');
        const backup = installDir + '.lira-data-backup';
        const tempDir = path.join(root, 'temp');
        const directories = ['data', 'logs', 'updates', 'resources'].map((name) => path.join(installDir, name));
        try {
          for (const directory of [...directories, legacyData, legacyBrowser, outside, backup, tempDir]) {
            assert.ok(path.resolve(directory).startsWith(root + path.sep));
            fs.mkdirSync(directory, { recursive: true });
            fs.writeFileSync(path.join(directory, 'fixture.txt'), directory);
          }
          fs.writeFileSync(path.join(installDir, 'LIRA.exe'), 'program fixture');
          fs.writeFileSync(path.join(installDir, 'Uninstall LIRA.exe'), 'uninstaller fixture');
          if (name === 'linked-data') {
            fs.symlinkSync(outside, path.join(installDir, 'data', 'external'), 'junction');
          }
          if (name === 'linked-data-root' || name === 'linked-legacy-data') {
            const link = name === 'linked-data-root' ? directories[0] : path.dirname(legacyData);
            fs.renameSync(link, path.join(root, 'original-data'));
            fs.symlinkSync(outside, link, 'junction');
          }
          const invalidRoot = name.endsWith('install-root');
          let selectedDir = installDir;
          if (name === 'empty-install-root') selectedDir = '';
          if (name === 'drive-install-root') selectedDir = path.parse(root).root;
          if (name === 'linked-install-root') {
            selectedDir = path.join(root, 'installation-link');
            fs.symlinkSync(outside, selectedDir, 'junction');
          }
          const source = removal
            .replaceAll('$APPDATA', '${FIXTURE_APPDATA}')
            .replaceAll('$TEMP', '${FIXTURE_TEMP}')
            // Preserve failure exit codes without ever showing fixture error dialogs.
            .replace(/MessageBox MB_OK\|MB_ICONSTOP ("[^\n]+") \/SD IDOK/g, 'DetailPrint $1');
          assert.doesNotMatch(source, /\$(?:APPDATA|LOCALAPPDATA|TEMP)\b|ReadReg|WriteReg|DeleteReg/);
          const script = path.join(root, 'fixture.nsi');
          const executable = path.join(root, 'fixture.exe');
          const uninstaller = path.join(root, 'fixture-uninstaller.exe');
          fs.writeFileSync(
            script,
            [
              'Unicode true',
              'Name "LIRA isolated uninstall test"',
              'RequestExecutionLevel user',
              '!include MUI2.nsh',
              '!define BUILD_UNINSTALLER',
              `!addincludedir "${quote(path.resolve(__dirname, '../node_modules/app-builder-lib/templates/nsis/include'))}"`,
              '!include StdUtils.nsh',
              `!addplugindir /x86-unicode "${quote(plugins)}"`,
              `OutFile "${quote(executable)}"`,
              `!define FIXTURE_APPDATA "${quote(appData)}"`,
              `!define FIXTURE_TEMP "${quote(tempDir)}"`,
              '!define APP_PACKAGE_NAME "lira"',
              '!define UNINSTALL_FILENAME "Uninstall LIRA.exe"',
              'Var installMode',
              flags.build(),
              source,
              '!insertmacro customUnWelcomePage',
              '!insertmacro MUI_UNPAGE_INSTFILES',
              '!insertmacro MUI_UNPAGE_FINISH',
              '!insertmacro MUI_LANGUAGE "SimpChinese"',
              'Function .onInit',
              `WriteUninstaller "${quote(uninstaller)}"`,
              'SetErrorLevel 0',
              'Quit',
              'FunctionEnd',
              'Function un.onInit',
              '!insertmacro customUnInit',
              `StrCpy $INSTDIR "${quote(selectedDir)}"`,
              'StrCpy $installMode "current"',
              `StrCpy $liraDeleteDataConfirmed "${approved ? '1' : '0'}"`,
              `SetSilent ${silent ? 'silent' : 'normal'}`,
              name === 'locked-logs'
                ? `System::Call 'kernel32::CreateFileW(w "${quote(path.join(directories[1], 'fixture.txt'))}", i 0x80000000, i 0, p 0, i 3, i 0, p 0) p .R2'`
                : '',
              // Invalid-root fixtures execute only validation, never the removal macro.
              `!insertmacro ${invalidRoot ? 'liraValidateUninstallDirectory' : 'customRemoveFiles'}`,
              'SetErrorLevel 0',
              'Quit',
              'FunctionEnd',
              'Section',
              'SectionEnd',
              'Section "Uninstall"',
              '!insertmacro customUnInstall',
              'SectionEnd',
            ].join('\n'),
          );
          const build = spawnSync(compiler, ['/V2', '-INPUTCHARSET', 'UTF8', script], {
            encoding: 'utf8',
            windowsHide: true,
            timeout: 30000,
          });
          assert.equal(build.error, undefined);
          assert.equal(build.status, 0, build.stdout + build.stderr);
          const writeUninstaller = spawnSync(executable, ['/S'], {
            windowsHide: true,
            timeout: 10000,
          });
          assert.equal(writeUninstaller.error, undefined);
          assert.equal(writeUninstaller.status, 0);
          const run = spawnSync(uninstaller, ['/S', ...(updated ? ['--updated'] : []), `_?=${installDir}`], {
            // NSIS requires the final _?= path unquoted, including embedded spaces.
            windowsVerbatimArguments: true,
            windowsHide: true,
            timeout: 10000,
          });
          assert.equal(run.error, undefined);
          const failed = invalidRoot || name === 'locked-logs';
          assert.equal(run.status, failed ? 2 : 0, name);
          const retainsData = !approved || silent || updated;
          for (const directory of [directories[0], legacyData, legacyBrowser]) {
            assert.equal(fs.existsSync(directory), retainsData, directory);
            if (retainsData) assert.equal(fs.readFileSync(path.join(directory, 'fixture.txt'), 'utf8'), directory);
          }
          if (!failed) {
            for (const directory of directories.slice(1, 3)) {
              assert.equal(fs.existsSync(directory), updated, directory);
            }
            assert.equal(fs.existsSync(directories[3]), false);
            assert.equal(fs.existsSync(path.join(installDir, 'LIRA.exe')), false);
            assert.equal(fs.existsSync(installDir), retainsData);
          } else {
            assert.equal(fs.readFileSync(path.join(directories[1], 'fixture.txt'), 'utf8'), directories[1]);
          }
          assert.equal(fs.existsSync(path.join(installDir, 'Uninstall LIRA.exe')), failed);
          for (const directory of [outside, backup]) {
            assert.equal(fs.readFileSync(path.join(directory, 'fixture.txt'), 'utf8'), directory);
          }
        } finally {
          const resolved = fs.realpathSync(root);
          assert.equal(path.dirname(resolved), fs.realpathSync(os.tmpdir()));
          assert.ok(path.basename(resolved).startsWith('lira-uninstall-test-'));
          fs.rmSync(resolved, { recursive: true, force: true });
        }
      });
    }
  },
);
