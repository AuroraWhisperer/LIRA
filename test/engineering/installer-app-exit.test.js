'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const { resolveInstallerTools } = require('../helpers/installer-tools');
const { compiler, plugins } = resolveInstallerTools();
const quote = (value) => value.replaceAll('$', () => '$$');

test(
  'NSIS closes approved application windows before backing up data',
  {
    concurrency: 3,
    skip:
      process.platform !== 'win32' || !compiler || !plugins
        ? 'Requires Windows, LIRA_TEST_MAKENSIS and LIRA_TEST_NSIS_PLUGINS'
        : false,
  },
  async (t) => {
    const source = ['installer-uninstall.nsh', 'installer-process.nsh', 'installer-data.nsh']
      .map(name => fs.readFileSync(path.join(__dirname, '../../build', name), 'utf8')).join('\n');

    const scenarios = [];
    // Each scenario owns a unique executable name and isolated install paths.
    for (const scenario of [
      'approved',
      'selected-directory',
      'cancelled',
      'refused',
      'retry',
      'no-running-app',
      'other-directory',
      'other-directory-prefix',
      'windowless',
      'silent-exit',
      'silent-timeout',
      'failed-process-check',
    ]) {
      scenarios.push(t.test(scenario, async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-close-test-'));
        const installDir = path.join(root, '旧版 LIRA');
        const newInstallDir = path.join(root, '新版 LIRA');
        const otherDir = scenario === 'other-directory-prefix' ? newInstallDir + '-other' : path.join(root, 'other-application');
        const dataDir = path.join(installDir, 'data');
        const dataFile = path.join(dataDir, 'fixture.txt');
        const backup = newInstallDir + '.lira-data-backup';
        const ready = path.join(root, 'ready.txt');
        const requests = path.join(root, 'close-requests.txt');
        const prompts = path.join(root, 'prompts.txt');
        const preserved = path.join(root, 'preserved.txt');
        const appName = path.basename(root) + '.exe';
        const unrelated = scenario.startsWith('other-directory');
        const noApp = scenario === 'no-running-app';
        const windowless = scenario === 'windowless';
        const checkFails = scenario === 'failed-process-check';
        const appDirectory = unrelated ? otherDir : scenario === 'selected-directory' ? newInstallDir : installDir;
        const appFile = path.join(appDirectory, appName);
        const silent = scenario.startsWith('silent-');
        const exitsSilently = scenario === 'silent-exit';
        let holder;

        const compile = (name, lines) => {
          const script = path.join(root, name + '.nsi');
          fs.writeFileSync(script, lines.join('\n'));
          const result = spawnSync(compiler, ['/V2', '-INPUTCHARSET', 'UTF8', script], {
            encoding: 'utf8',
            windowsHide: true,
            timeout: 30000,
          });
          assert.equal(result.error, undefined);
          assert.equal(result.status, 0, result.stdout + result.stderr);
        };
        const record = (file, value) =>
          [
            `FileOpen $9 "${quote(file)}" a`,
            'FileSeek $9 0 END',
            `FileWrite $9 "${value}$\\r$\\n"`,
            'FileClose $9',
          ].join('\n');

        try {
          for (const directory of [dataDir, newInstallDir, otherDir]) fs.mkdirSync(directory, { recursive: true });
          fs.writeFileSync(dataFile, 'before close');

          // Only dialog responses are simulated; close requests, process checks,
          // delayed final writes and backup all execute through native Windows APIs.
          const functions = (checkFails
            ? source.replace("System::Call 'kernel32::CreateToolhelp32Snapshot(i 2, i 0) p.r0 ?e'", 'StrCpy $0 -1\nPush 5')
            : source)
            .replaceAll('$APPDATA', '${FIXTURE_APPDATA}')
            .replaceAll('$TEMP', '${FIXTURE_TEMP}')
            .replace(
              /MessageBox (\S+) ("[^\r\n]+") \/SD \w+(?: (\w+) (\w+))?/g,
              (_line, flags, message, response, label) => {
                if (flags.includes('MB_OKCANCEL')) {
                  assert.equal(response, 'IDOK');
                  return record(prompts, 'confirm') + (scenario === 'cancelled' ? '' : `\nGoto ${label}`);
                }
                if (flags.includes('MB_RETRYCANCEL')) {
                  assert.equal(response, 'IDRETRY');
                  return (
                    record(prompts, 'retry') +
                    (scenario === 'retry'
                      ? `\nIntOp $fixtureRetries $fixtureRetries + 1\nStrCmp $fixtureRetries 1 ${label}`
                      : '')
                  );
                }
                return `DetailPrint ${message}`;
              },
            );
          assert.doesNotMatch(functions, /\$(?:APPDATA|TEMP|LOCALAPPDATA)\b|ReadReg|WriteReg|DeleteReg/);
          compile('installer', [
            'Unicode true',
            'Name "LIRA isolated close test"',
            'RequestExecutionLevel user',
            `OutFile "${quote(path.join(root, 'installer.exe'))}"`,
            `!addplugindir /x86-unicode "${quote(plugins)}"`,
            '!define VERSION "fixture"',
            `!define APP_EXECUTABLE_FILENAME "${appName}"`,
            `!define FIXTURE_APPDATA "${quote(path.join(root, 'roaming'))}"`,
            `!define FIXTURE_TEMP "${quote(root)}"`,
            'Var fixtureRetries',
            functions,
            'Function .onInit',
            `StrCpy $INSTDIR "${quote(newInstallDir)}"`,
            `StrCpy $liraPreviousInstallDir "${quote(installDir)}"`,
            'StrCpy $fixtureRetries 0',
            `SetSilent ${silent ? 'silent' : 'normal'}`,
            'Call liraWaitForAppExit',
            // Do not show the unrelated preservation banner in fixtures.
            'SetSilent silent',
            'Call liraPreserveInstallData',
            `CopyFiles /SILENT "$liraDataBackup\\fixture.txt" "${quote(preserved)}"`,
            'SetErrorLevel 0',
            'Quit',
            'FunctionEnd',
            'Section',
            'SectionEnd',
          ]);

          // Two invisible top-level windows exercise normal close messages without
          // displaying fixture UI or depending on Electron or a C# compiler.
          compile('app', [
            'Unicode true',
            'Name "LIRA isolated application fixture"',
            'RequestExecutionLevel user',
            `OutFile "${quote(appFile)}"`,
            'Function .onInit',
            ...(windowless ? ['StrCpy $0 0', 'StrCpy $1 0'] : [
              'System::Call \'user32::CreateWindowExW(i 0, w "STATIC", w "fixture one", i 0, i 0, i 0, i 0, i 0, p 0, p 0, p 0, p 0) p.r0\'',
              'System::Call \'user32::CreateWindowExW(i 0, w "STATIC", w "fixture two", i 0, i 0, i 0, i 0, i 0, p 0, p 0, p 0, p 0) p.r1\'',
              'StrCmp $0 0 fixtureFailed',
              'StrCmp $1 0 fixtureFailed',
            ]),
            'System::Alloc 32',
            'Pop $2',
            'StrCpy $5 0',
            exitsSilently ? "System::Call 'user32::SetTimer(p r0, p 1, i 1500, p 0)'" : '',
            record(ready, 'ready'),
            'fixtureMessages:',
            "System::Call 'user32::GetMessageW(p r2, p 0, i 0, i 0) i.r3'",
            'IntCmp $3 0 fixtureFailed fixtureFailed',
            "System::Call '*$2(p.r4, i.r3)'",
            exitsSilently ? 'IntCmp $3 0x0113 fixtureExit' : '',
            'IntCmp $3 0x0010 0 fixtureMessages fixtureMessages',
            // NSIS also owns an internal window; count only our two fixture windows.
            'StrCmp $4 $0 fixtureClose',
            'StrCmp $4 $1 0 fixtureMessages',
            'fixtureClose:',
            record(requests, 'close'),
            'IntOp $5 $5 + 1',
            scenario === 'refused' || unrelated
              ? 'Goto fixtureMessages'
              : `IntCmp $5 ${scenario === 'retry' ? 4 : 2} fixtureExit fixtureMessages fixtureExit`,
            'fixtureExit:',
            'Sleep 600',
            `FileOpen $9 "${quote(dataFile)}" w`,
            'FileWrite $9 "saved before exit"',
            'FileClose $9',
            'System::Free $2',
            'SetErrorLevel 0',
            'Quit',
            'fixtureFailed:',
            'SetErrorLevel 3',
            'Quit',
            'FunctionEnd',
            'Section',
            'SectionEnd',
          ]);
          if (!noApp) {
            holder = spawn(appFile, ['/S'], { windowsHide: true, stdio: 'ignore' });
            const deadline = Date.now() + 10000;
            while (!fs.existsSync(ready) && Date.now() < deadline && holder.exitCode === null)
              await new Promise((resolve) => setTimeout(resolve, 25));
            assert.ok(fs.existsSync(ready), 'the isolated application process must be ready');
          }

          const status = await new Promise((resolve, reject) => {
            const installer = spawn(path.join(root, 'installer.exe'), ['/S'], {
              windowsHide: true,
              stdio: 'ignore',
              timeout: 30000,
            });
            installer.once('error', reject);
            installer.once('close', resolve);
          });
          const succeeds = noApp || unrelated || ['approved', 'selected-directory', 'retry', 'silent-exit'].includes(scenario);
          const report = path.join(root, 'LIRA-install-error.txt');
          assert.equal(
            status,
            succeeds ? 0 : 2,
            fs.existsSync(report) ? fs.readFileSync(report, 'utf16le') : scenario,
          );
          assert.equal(fs.existsSync(preserved), succeeds);
          if (succeeds) {
            assert.equal(fs.readFileSync(preserved, 'utf8'), noApp || unrelated ? 'before close' : 'saved before exit');
            if (unrelated) assert.equal(holder.exitCode, null, 'another installation must keep running');
          } else {
            assert.equal(fs.existsSync(backup), false);
            assert.equal(fs.readFileSync(dataFile, 'utf8'), 'before close');
          }
          const responses = fs.existsSync(prompts) ? fs.readFileSync(prompts, 'utf8').trim().split('\r\n') : [];
          assert.deepEqual(
            responses,
            silent || unrelated || noApp || checkFails
              ? []
              : ['approved', 'selected-directory', 'cancelled'].includes(scenario)
                ? ['confirm']
                : ['confirm', 'retry'],
          );
          if (scenario === 'cancelled' || unrelated || noApp || silent || windowless || checkFails) {
            assert.equal(fs.existsSync(requests), false, 'no close request should be sent');
          } else {
            const received = fs.readFileSync(requests, 'utf8').trim().split('\r\n');
            assert.equal(received.length, scenario === 'retry' ? 4 : 2);
          }
        } finally {
          if (holder && holder.exitCode === null) {
            const exited = new Promise((resolve) => holder.once('exit', resolve));
            holder.kill();
            await exited;
          }
          const resolved = fs.realpathSync(root);
          assert.equal(path.dirname(resolved), fs.realpathSync(os.tmpdir()));
          assert.ok(path.basename(resolved).startsWith('lira-close-test-'));
          fs.rmSync(resolved, { recursive: true, force: true });
        }
      }));
    }
    await Promise.all(scenarios);
  },
);
