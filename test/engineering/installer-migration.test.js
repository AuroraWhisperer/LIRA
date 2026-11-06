'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const { resolveInstallerTools } = require('../helpers/installer-tools');
const { compiler, plugins } = resolveInstallerTools();
const definePath = (value) => value.replaceAll('$', () => '$$');

test(
  'NSIS preserves installation-local data and stops safely on failure',
  {
    skip:
      process.platform !== 'win32' || !compiler || !plugins
        ? 'Requires Windows, LIRA_TEST_MAKENSIS and LIRA_TEST_NSIS_PLUGINS'
        : false,
  },
  async (t) => {
    const source = ['installer-process.nsh', 'installer-data.nsh']
      .map(name => fs.readFileSync(path.join(__dirname, '../../build', name), 'utf8')).join('\n');
    const functions = source.replaceAll('$APPDATA', '${FIXTURE_APPDATA}').replaceAll('$TEMP', '${FIXTURE_TEMP}');
    const installer = fs.readFileSync(path.join(__dirname, '../../build/installer-uninstall.nsh'), 'utf8');
    const removal = installer.replaceAll('$APPDATA', '${FIXTURE_APPDATA}').replaceAll('$TEMP', '${FIXTURE_TEMP}');
    assert.doesNotMatch(functions + removal, /\$(?:APPDATA|TEMP|LOCALAPPDATA)\b|ReadReg|DeleteReg/);

    for (const scenario of [
      'legacy-update',
      'preserving-update',
      'verified-update',
      'changed-uninstaller',
      'different-uninstaller',
      'change-directory',
      'appdata-return',
      'existing-local',
      'recover-backup',
      'backup-conflict',
      'target-conflict',
      'copy-failure',
      'restore-failure',
      'report-failure',
      'locked-data',
      'linked-partial-backup',
      'installer-same-name',
      'upgrade-preserves-data-and-downloads',
      'bundled-audio-upgrade',
      'bundled-audio-publish-retry',
      'bundled-audio-publish-failure',
      'bundled-audio-change-directory',
      'bundled-audio-no-user-data',
      'preserved-audio-upgrade',
    ]) {
      await t.test(scenario, async (scenarioTest) => {
        const scratch = path.resolve(__dirname, '../../tmp');
        fs.mkdirSync(scratch, { recursive: true });
        const root = fs.mkdtempSync(path.join(scratch, 'lira-installer-test-'));
        const oldInstall = path.join(root, '旧版 LIRA');
        const newInstall = ['change-directory', 'target-conflict', 'bundled-audio-change-directory'].includes(scenario)
          ? path.join(root, '新版 LIRA')
          : oldInstall;
        const oldData = path.join(oldInstall, 'data');
        const destination = path.join(newInstall, 'data');
        const backup = newInstall + '.lira-data-backup';
        const appData = path.join(root, 'roaming');
        const legacyAppData = path.join(appData, 'com.aurorawhisperer.lira', 'data');
        const reportDir = path.join(root, 'reports');
        const prepared = path.join(root, 'prepared.txt');
        const completed = path.join(root, 'completed.txt');
        const copied = path.join(root, 'copied.txt');
        const uninstaller = path.join(oldInstall, 'Uninstall LIRA.exe');
        const publicationLock = scenario.startsWith('bundled-audio-publish-');
        const publishReady = path.join(root, 'publish-ready.txt');
        const lockReady = path.join(root, 'lock-ready.txt');
        let holder;
        const putData = (directory, value = 'legacy fixture') => {
          assert.ok(path.resolve(directory).startsWith(root + path.sep));
          fs.mkdirSync(path.join(directory, 'Network'), { recursive: true });
          fs.writeFileSync(path.join(directory, 'fixture.txt'), value);
          fs.writeFileSync(path.join(directory, 'Network', 'Cookies'), 'cookie fixture');
        };
        try {
          for (const directory of [appData, reportDir, oldInstall]) fs.mkdirSync(directory);
          fs.writeFileSync(path.join(oldInstall, 'old-program.txt'), 'program fixture');
          fs.writeFileSync(uninstaller, 'preserving uninstaller fixture');
          if (scenario === 'appdata-return') putData(legacyAppData);
          else if (scenario === 'recover-backup') putData(backup);
          else if (scenario !== 'bundled-audio-no-user-data') putData(oldData);
          if (scenario.startsWith('bundled-audio') || scenario === 'preserved-audio-upgrade') {
            const audio = path.join(oldInstall, scenario === 'preserved-audio-upgrade'
              ? 'data/components/audio/0123456789abcdef01234567' : 'resources/audio-assistant');
            fs.mkdirSync(path.join(audio, 'vendor'), { recursive: true });
            fs.writeFileSync(path.join(audio, 'LiraAudioAssistant.exe'), 'audio program fixture');
            fs.writeFileSync(path.join(audio, 'vendor/lira.onnx'), 'audio model fixture');
          }
          if (scenario === 'existing-local') putData(legacyAppData, 'stale AppData fixture');
          if (scenario === 'backup-conflict') putData(backup, 'previous recovery fixture');
          if (scenario === 'target-conflict') putData(destination, 'newer fixture');
          if (scenario === 'linked-partial-backup') {
            const outside = path.join(root, 'other-application');
            putData(outside, 'unrelated data');
            fs.symlinkSync(outside, backup + '.partial', 'junction');
          }
          if (['copy-failure', 'report-failure'].includes(scenario))
            fs.writeFileSync(backup + '.partial', 'obstructs staging directory');
          if (scenario === 'report-failure') {
            fs.rmdirSync(reportDir);
            fs.writeFileSync(reportDir, 'obstructs report creation');
          }
          if (scenario === 'upgrade-preserves-data-and-downloads') {
            for (const name of ['logs', 'updates', 'resources']) {
              fs.mkdirSync(path.join(oldInstall, name));
              fs.writeFileSync(path.join(oldInstall, name, 'fixture.txt'), name);
            }
          }
          if (scenario === 'locked-data') {
            const ready = path.join(root, 'lock-ready.txt');
            const literal = (value) => "'" + value.replaceAll("'", "''") + "'";
            const command =
              `$lock = [IO.File]::Open(${literal(path.join(oldData, 'Network', 'Cookies'))}, 'Open', 'ReadWrite', 'None'); ` +
              `[IO.File]::WriteAllText(${literal(ready)}, 'ready'); try { [Console]::ReadLine() } finally { $lock.Dispose() }`;
            holder = spawn(
              'powershell.exe',
              ['-NoLogo', '-NoProfile', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')],
              { windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] },
            );
            const deadline = Date.now() + 10000;
            while (!fs.existsSync(ready) && Date.now() < deadline)
              await new Promise((resolve) => setTimeout(resolve, 25));
            assert.ok(fs.existsSync(ready), 'fixture file lock must be acquired');
          }
          if (publicationLock) {
            const literal = value => "'" + value.replaceAll("'", "''") + "'";
            const audio = path.join(backup + '.partial', 'components/audio/legacy/LiraAudioAssistant.exe');
            const command =
              `$ErrorActionPreference = 'Stop'; $deadline = [DateTime]::UtcNow.AddSeconds(10); ` +
              `while (!(Test-Path -LiteralPath ${literal(publishReady)})) { ` +
              `if ([DateTime]::UtcNow -gt $deadline) { throw 'The installer did not reach backup publication' }; Start-Sleep -Milliseconds 10 }; ` +
              `$lock = [IO.File]::Open(${literal(audio)}, 'Open', 'Read', 'ReadWrite'); ` +
              `[IO.File]::WriteAllText(${literal(lockReady)}, 'ready'); try { ` +
              (scenario === 'bundled-audio-publish-retry' ? 'Start-Sleep -Milliseconds 200; $lock.Dispose(); $lock = $null; ' : '') +
              '[Console]::ReadLine() } finally { if ($lock) { $lock.Dispose() } }';
            holder = spawn('powershell.exe',
              ['-NoLogo', '-NoProfile', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')],
              { windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] });
          }
          const publishHook = [
            `FileOpen $R0 "${definePath(publishReady)}" w`,
            'FileWrite $R0 "ready"',
            'FileClose $R0',
            'StrCpy $R9 0',
            'liraFixtureWaitForLock:',
            `IfFileExists "${definePath(lockReady)}" liraFixtureLockReady`,
            'IntOp $R9 $R9 + 1',
            'IntCmp $R9 500 liraFixtureLockFailed',
            'Sleep 10',
            'Goto liraFixtureWaitForLock',
            'liraFixtureLockFailed:',
            'SetErrorLevel 3',
            'Quit',
            'liraFixtureLockReady:',
          ].join('\n');
          const fixture = [
            'Unicode true',
            'Name "LIRA isolated preservation test"',
            'RequestExecutionLevel user',
            '!include LogicLib.nsh',
            '!define isUpdated "1 = 1"',
            '!define APP_PACKAGE_NAME "lira"',
            '!define UNINSTALL_FILENAME "Uninstall LIRA.exe"',
            'Var liraDeleteDataConfirmed',
            'Var installMode',
            '!define VERSION "fixture"',
            `!addplugindir /x86-unicode "${definePath(plugins)}"`,
            `!define APP_EXECUTABLE_FILENAME "${scenario === 'installer-same-name' ? 'fixture.exe' : path.basename(root) + '-absent.exe'}"`,
            `OutFile "${definePath(path.join(root, 'fixture.exe'))}"`,
            `!define FIXTURE_APPDATA "${definePath(appData)}"`,
            `!define FIXTURE_TEMP "${definePath(reportDir)}"`,
            (publicationLock ? functions.replace('  liraPublishBackup:', `  liraPublishBackup:\n${publishHook}`) : functions)
              .replace(/Function liraCopyData\r?\n/, `Function liraCopyData\nFileOpen $R0 "${definePath(copied)}" a\nFileWrite $R0 "copy$\\r$\\n"\nFileClose $R0\n`),
            removal,
            'Function .onInit',
            `StrCpy $INSTDIR "${definePath(oldInstall)}"`,
            ['verified-update', 'changed-uninstaller', 'different-uninstaller', 'change-directory', 'backup-conflict', 'bundled-audio-upgrade'].includes(scenario)
              ? 'Call liraRecordDataPreservation' : '',
            scenario === 'changed-uninstaller'
              ? `FileOpen $0 "${definePath(uninstaller)}" w\nFileWrite $0 "older destructive uninstaller"\nFileClose $0` : '',
            `StrCpy $INSTDIR "${definePath(newInstall)}"`,
            `StrCpy $liraPreviousInstallDir "${definePath(oldInstall)}"`,
            `StrCpy $liraPreviousUninstaller "${definePath(scenario === 'different-uninstaller' ? path.join(root, 'other.exe') : uninstaller)}"`,
            'Call liraWaitForAppExit',
            'Call liraPreserveInstallData',
            `FileOpen $0 "${definePath(prepared)}" w`,
            'FileWrite $0 "$INSTDIR | $liraDataSource | $liraDataBackup"',
            'FileClose $0',
            ['legacy-update', 'change-directory', 'bundled-audio-change-directory', 'appdata-return', 'restore-failure'].includes(scenario)
              ? `RMDir /r "${definePath(oldInstall)}"`
              : '',
            ['verified-update', 'upgrade-preserves-data-and-downloads'].includes(scenario) || scenario.includes('audio') ? '!insertmacro customRemoveFiles' : '',
            'CreateDirectory "$INSTDIR"',
            scenario === 'restore-failure'
              ? 'FileOpen $0 "$INSTDIR\\data" w\nFileWrite $0 "obstruction"\nFileClose $0'
              : '',
            'Call liraRestoreInstallData',
            `FileOpen $0 "${definePath(completed)}" w`,
            'FileWrite $0 "completed"',
            'FileClose $0',
            'SetErrorLevel 0',
            'Quit',
            'FunctionEnd',
            'Section',
            'SectionEnd',
          ].join('\n');
          const script = path.join(root, 'fixture.nsi');
          fs.writeFileSync(script, fixture);
          const build = spawnSync(compiler, ['/V2', '-INPUTCHARSET', 'UTF8', script], {
            encoding: 'utf8',
            windowsHide: true,
            timeout: 30000,
          });
          assert.equal(build.error, undefined);
          assert.equal(build.status, 0, build.stdout + build.stderr);
          const run = spawnSync(path.join(root, 'fixture.exe'), ['/S'], {
            windowsHide: true,
            timeout: 30000,
          });
          assert.equal(run.error, undefined);
          if (publicationLock) assert.ok(fs.existsSync(lockReady), 'the copied audio must be locked before backup publication');
          const failed =
            scenario.includes('failure') ||
            scenario.includes('conflict') ||
            scenario === 'locked-data';
          const reportPath = path.join(reportDir, 'LIRA-install-error.txt');
          assert.equal(
            run.status,
            failed ? 2 : 0,
            fs.existsSync(reportPath) ? fs.readFileSync(reportPath, 'utf16le') : 'installer exit code',
          );
          assert.equal(fs.existsSync(completed), !failed);
          if (!failed && scenario !== 'recover-backup') {
            assert.equal(fs.existsSync(copied), scenario !== 'verified-update', 'only a verified same-directory upgrade may skip copying');
          }
          if (!failed) {
            if (scenario !== 'bundled-audio-no-user-data') {
            assert.ok(
              fs.existsSync(path.join(destination, 'fixture.txt')),
              fs.readFileSync(prepared, 'utf8') + '\n' + fs.readdirSync(root, { recursive: true }).join('\n'),
            );
            assert.equal(fs.readFileSync(path.join(destination, 'fixture.txt'), 'utf8'), 'legacy fixture');
            }
            assert.equal(fs.existsSync(backup), false);
            if (scenario.includes('audio')) {
              const component = path.join(destination, 'components/audio',
                scenario === 'preserved-audio-upgrade' ? '0123456789abcdef01234567' : 'legacy');
              assert.equal(fs.readFileSync(path.join(component, 'LiraAudioAssistant.exe'), 'utf8'), 'audio program fixture');
              assert.equal(fs.readFileSync(path.join(component, 'vendor/lira.onnx'), 'utf8'), 'audio model fixture');
              assert.equal(fs.existsSync(path.join(newInstall, 'resources/audio-assistant')), false);
            }
          } else if (scenario === 'restore-failure') {
            assert.equal(fs.readFileSync(path.join(backup, 'fixture.txt'), 'utf8'), 'legacy fixture');
          } else {
            assert.equal(fs.existsSync(prepared), false);
            assert.equal(fs.readFileSync(path.join(oldData, 'fixture.txt'), 'utf8'), 'legacy fixture');
          }
          if (failed && scenario !== 'report-failure') {
            const report = fs.readFileSync(path.join(reportDir, 'LIRA-install-error.txt'), 'utf16le');
            assert.ok(report.includes('fixture'));
            assert.ok(report.includes(destination));
            if (scenario === 'locked-data') assert.ok(report.includes('Cookies'), report);
            if (scenario === 'bundled-audio-publish-failure') {
              assert.match(report, /Win32 error=(5|32|33)\b/);
              assert.equal(fs.existsSync(backup), false);
              const partial = backup + '.partial';
              assert.equal(fs.readFileSync(path.join(partial, 'fixture.txt'), 'utf8'), 'legacy fixture');
              assert.equal(fs.readFileSync(path.join(partial, 'Network/Cookies'), 'utf8'), 'cookie fixture');
              for (const audio of [path.join(partial, 'components/audio/legacy'), path.join(oldInstall, 'resources/audio-assistant')]) {
                assert.equal(fs.readFileSync(path.join(audio, 'LiraAudioAssistant.exe'), 'utf8'), 'audio program fixture');
                assert.equal(fs.readFileSync(path.join(audio, 'vendor/lira.onnx'), 'utf8'), 'audio model fixture');
              }
              scenarioTest.diagnostic(report);
            }
          }
          if (scenario === 'backup-conflict')
            assert.equal(fs.readFileSync(path.join(backup, 'fixture.txt'), 'utf8'), 'previous recovery fixture');
          if (scenario === 'target-conflict')
            assert.equal(fs.readFileSync(path.join(destination, 'fixture.txt'), 'utf8'), 'newer fixture');
          if (scenario === 'existing-local')
            assert.equal(fs.readFileSync(path.join(legacyAppData, 'fixture.txt'), 'utf8'), 'stale AppData fixture');
          if (scenario === 'linked-partial-backup')
            assert.equal(fs.readFileSync(path.join(root, 'other-application', 'fixture.txt'), 'utf8'), 'unrelated data');
          if (scenario === 'appdata-return')
            assert.equal(fs.readFileSync(path.join(legacyAppData, 'fixture.txt'), 'utf8'), 'legacy fixture');
          if (scenario === 'upgrade-preserves-data-and-downloads') {
            for (const name of ['logs', 'updates'])
              assert.equal(fs.readFileSync(path.join(newInstall, name, 'fixture.txt'), 'utf8'), name);
            assert.equal(fs.existsSync(path.join(newInstall, 'resources')), false);
            assert.equal(fs.existsSync(path.join(newInstall, 'old-program.txt')), false);
          }
        } finally {
          if (holder && holder.exitCode === null) {
            const exited = new Promise((resolve) => holder.once('exit', resolve));
            holder.stdin.end('\n');
            await exited;
          }
          const resolved = fs.realpathSync(root);
          assert.equal(path.dirname(resolved), fs.realpathSync(scratch));
          assert.ok(path.basename(resolved).startsWith('lira-installer-test-'));
          fs.rmSync(resolved, { recursive: true, force: true });
        }
      });
    }
  },
);
