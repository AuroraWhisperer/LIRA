'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const compiler = process.env.LIRA_TEST_MAKENSIS;
const plugins = process.env.LIRA_TEST_NSIS_PLUGINS;
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
    const source = fs.readFileSync(path.join(__dirname, '../build/installer-data.nsh'), 'utf8');
    const functions = source.replaceAll('$APPDATA', '${FIXTURE_APPDATA}').replaceAll('$TEMP', '${FIXTURE_TEMP}');
    const installer = fs.readFileSync(path.join(__dirname, '../build/installer-uninstall.nsh'), 'utf8');
    const removal = installer.replaceAll('$APPDATA', '${FIXTURE_APPDATA}').replaceAll('$TEMP', '${FIXTURE_TEMP}');
    assert.doesNotMatch(functions + removal, /\$(?:APPDATA|TEMP|LOCALAPPDATA)\b|ReadReg|DeleteReg/);

    for (const scenario of [
      'legacy-update',
      'preserving-update',
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
      'running-app',
      'upgrade-preserves-data-and-downloads',
    ]) {
      await t.test(scenario, async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-installer-test-'));
        const oldInstall = path.join(root, '旧版 LIRA');
        const newInstall = ['change-directory', 'target-conflict'].includes(scenario)
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
          if (scenario === 'appdata-return') putData(legacyAppData);
          else if (scenario === 'recover-backup') putData(backup);
          else putData(oldData);
          if (scenario === 'existing-local') putData(legacyAppData, 'stale AppData fixture');
          if (scenario === 'backup-conflict') putData(backup, 'previous recovery fixture');
          if (scenario === 'target-conflict') putData(destination, 'newer fixture');
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
            `!define APP_EXECUTABLE_FILENAME "${scenario === 'running-app' ? 'fixture.exe' : path.basename(root) + '-absent.exe'}"`,
            `OutFile "${definePath(path.join(root, 'fixture.exe'))}"`,
            `!define FIXTURE_APPDATA "${definePath(appData)}"`,
            `!define FIXTURE_TEMP "${definePath(reportDir)}"`,
            functions,
            removal,
            'Function .onInit',
            `StrCpy $INSTDIR "${definePath(newInstall)}"`,
            `StrCpy $liraPreviousInstallDir "${definePath(oldInstall)}"`,
            'Call liraWaitForAppExit',
            'Call liraPreserveInstallData',
            `FileOpen $0 "${definePath(prepared)}" w`,
            'FileWrite $0 "$INSTDIR | $liraDataSource | $liraDataBackup"',
            'FileClose $0',
            ['legacy-update', 'change-directory', 'appdata-return', 'restore-failure'].includes(scenario)
              ? `RMDir /r "${definePath(oldInstall)}"`
              : '',
            scenario === 'upgrade-preserves-data-and-downloads' ? '!insertmacro customRemoveFiles' : '',
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
          const failed =
            scenario.includes('failure') ||
            scenario.includes('conflict') ||
            ['locked-data', 'running-app'].includes(scenario);
          const reportPath = path.join(reportDir, 'LIRA-install-error.txt');
          assert.equal(
            run.status,
            failed ? 2 : 0,
            fs.existsSync(reportPath) ? fs.readFileSync(reportPath, 'utf16le') : 'installer exit code',
          );
          assert.equal(fs.existsSync(completed), !failed);
          if (!failed) {
            assert.ok(
              fs.existsSync(path.join(destination, 'fixture.txt')),
              fs.readFileSync(prepared, 'utf8') + '\n' + fs.readdirSync(root, { recursive: true }).join('\n'),
            );
            assert.equal(fs.readFileSync(path.join(destination, 'fixture.txt'), 'utf8'), 'legacy fixture');
            assert.equal(fs.existsSync(backup), false);
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
            if (scenario === 'running-app') assert.ok(report.includes('等待旧版 LIRA 退出'));
            if (scenario === 'locked-data') assert.ok(report.includes('Cookies'), report);
          }
          if (scenario === 'backup-conflict')
            assert.equal(fs.readFileSync(path.join(backup, 'fixture.txt'), 'utf8'), 'previous recovery fixture');
          if (scenario === 'target-conflict')
            assert.equal(fs.readFileSync(path.join(destination, 'fixture.txt'), 'utf8'), 'newer fixture');
          if (scenario === 'existing-local')
            assert.equal(fs.readFileSync(path.join(legacyAppData, 'fixture.txt'), 'utf8'), 'stale AppData fixture');
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
          assert.equal(path.dirname(resolved), fs.realpathSync(os.tmpdir()));
          assert.ok(path.basename(resolved).startsWith('lira-installer-test-'));
          fs.rmSync(resolved, { recursive: true, force: true });
        }
      });
    }
  },
);
