'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test(
  'Windows installer diagnostics collect relevant evidence without application data',
  {
    skip: process.platform !== 'win32',
  },
  async (t) => {
    for (const withEvidence of [true, false]) {
      await t.test(
        withEvidence
          ? 'installer and matching crash'
          : 'no installer or migration report',
        () => {
          const root = fs.mkdtempSync(
            path.join(os.tmpdir(), 'lira-diagnostics-test-'),
          );
          const tempDir = path.join(root, 'temp');
          fs.mkdirSync(tempDir);
          fs.mkdirSync(path.join(root, 'data'));
          fs.writeFileSync(
            path.join(root, 'data', 'private.txt'),
            'NEVER_READ_APPLICATION_DATA',
          );
          const helper = path.join(root, 'collect-install-diagnostics.ps1');
          fs.copyFileSync(
            path.join(__dirname, '../scripts/collect-install-diagnostics.ps1'),
            helper,
          );
          if (withEvidence) {
            fs.writeFileSync(
              path.join(root, 'lira-setup-fixture.exe'),
              'fixture, never executed',
            );
            fs.writeFileSync(
              path.join(tempDir, 'LIRA-install-error.txt'),
              '\ufeff复制旧版数据\r\nfixture migration error',
              'utf16le',
            );
          }
          const quote = (value) => "'" + value.replaceAll("'", "''") + "'";
          const driver = `
$ErrorActionPreference = 'Stop'
function Get-ItemProperty { [pscustomobject]@{CurrentBuildNumber='19045'; UBR=1; DisplayVersion='22H2'} }
function Get-Process { param($Name, $ErrorAction) @() }
function Get-AuthenticodeSignature { param($LiteralPath) [pscustomobject]@{Status='NotSigned'} }
function Get-WinEvent {
  param($FilterHashtable, $MaxEvents, $ErrorAction)
  if ($FilterHashtable.LogName -eq 'Application') {
    [pscustomobject]@{TimeCreated=(Get-Date); Id=1000; Message='other.exe DO_NOT_COLLECT_THIS_EVENT'}
    ${withEvidence ? "[pscustomobject]@{TimeCreated=(Get-Date); Id=1000; Message='lira-setup-fixture.exe; module System.dll; code 0xc0000005'}" : ''}
  }
}
& ${quote(helper)}
`;
          try {
            const script = path.join(root, 'verify.ps1');
            fs.writeFileSync(script, '\ufeff' + driver);
            const powershell = path.join(
              process.env.SystemRoot,
              'System32',
              'WindowsPowerShell',
              'v1.0',
              'powershell.exe',
            );
            const result = spawnSync(
              powershell,
              [
                '-NoLogo',
                '-NoProfile',
                '-ExecutionPolicy',
                'Bypass',
                '-File',
                script,
              ],
              {
                windowsHide: true,
                timeout: 30000,
                encoding: 'utf8',
                env: {
                  ...process.env,
                  TEMP: tempDir,
                  TMP: tempDir,
                  PSModulePath: '',
                },
              },
            );
            assert.equal(result.error, undefined);
            assert.equal(result.status, 0, result.stdout + result.stderr);
            const reports = fs
              .readdirSync(root)
              .filter(
                (name) =>
                  name.startsWith('LIRA安装诊断-') && name.endsWith('.txt'),
              );
            assert.equal(reports.length, 1);
            const report = fs.readFileSync(path.join(root, reports[0]), 'utf8');
            assert.ok(report.includes('19045.1'));
            assert.doesNotMatch(
              report,
              /DO_NOT_COLLECT_THIS_EVENT|NEVER_READ_APPLICATION_DATA/,
            );
            if (withEvidence) {
              assert.ok(report.includes('0xc0000005'));
              assert.ok(report.includes('System.dll'));
              assert.ok(report.includes('fixture migration error'));
              assert.ok(report.includes('SHA256：'), report);
              assert.ok(report.includes('NotSigned'));
            } else {
              assert.ok(report.includes('未找到安装包'));
              assert.ok(report.includes('未发现迁移报错文件'));
              assert.doesNotMatch(report, /0xc0000005/);
            }
          } finally {
            const resolved = fs.realpathSync(root);
            assert.equal(path.dirname(resolved), fs.realpathSync(os.tmpdir()));
            assert.ok(
              path.basename(resolved).startsWith('lira-diagnostics-test-'),
            );
            fs.rmSync(resolved, { recursive: true, force: true });
          }
        },
      );
    }
  },
);
