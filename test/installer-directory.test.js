'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test(
  'installer defaults respect existing paths, explicit paths and computers without D',
  {
    skip: process.platform !== 'win32' || !process.env.LIRA_TEST_MAKENSIS,
  },
  () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-directory-test-'));
    const installer = fs.readFileSync(
      path.join(__dirname, '../build/installer.nsh'),
      'utf8',
    );
    const choose = installer
      .match(/Function liraSelectDefaultDirectory\b[\s\S]*?FunctionEnd/)[0]
      .replace(
        /ReadRegStr[^\r\n]+/,
        'StrCpy $liraPreviousInstallDir "${FIXTURE_PREVIOUS}"',
      )
      .replace(
        '!insertmacro GetDParameter $R0',
        'StrCpy $R0 "${FIXTURE_EXPLICIT}"',
      )
      .replace('IfFileExists "D:\\*.*"', 'IfFileExists "${FIXTURE_DRIVE}"');
    assert.doesNotMatch(choose, /ReadReg|WriteReg|DeleteReg/);
    try {
      for (const [name, previous, selected, explicit, hasD, expected] of [
        ['fresh-with-d', '', 'C:\\Default\\LIRA', '', true, 'D:\\LIRA'],
        [
          'fresh-without-d',
          '',
          'C:\\Default\\LIRA',
          '',
          false,
          'C:\\Default\\LIRA',
        ],
        [
          'existing-d',
          'D:\\0点歌\\LIRA',
          'D:\\0点歌\\LIRA',
          '',
          true,
          'D:\\0点歌\\LIRA',
        ],
        [
          'existing-c',
          'C:\\Apps\\LIRA',
          'C:\\Apps\\LIRA',
          '',
          true,
          'C:\\Apps\\LIRA',
        ],
        [
          'explicit-other-drive',
          'D:\\Apps\\LIRA',
          'E:\\软件\\LIRA',
          'E:\\软件\\LIRA',
          true,
          'E:\\软件\\LIRA',
        ],
      ]) {
        const output = path.join(root, name + '.txt');
        const executable = path.join(root, name + '.exe');
        const script = path.join(root, name + '.nsi');
        const quote = (text) => text.replaceAll('$', () => '$$');
        fs.writeFileSync(
          script,
          [
            'Unicode true',
            'Name "LIRA directory fixture"',
            'RequestExecutionLevel user',
            `OutFile "${quote(executable)}"`,
            'Var liraPreviousInstallDir',
            `!define FIXTURE_PREVIOUS "${quote(previous)}"`,
            `!define FIXTURE_EXPLICIT "${quote(explicit)}"`,
            `!define FIXTURE_DRIVE "${quote(hasD ? root : path.join(root, 'absent-drive'))}"`,
            choose,
            'Function .onInit',
            `StrCpy $INSTDIR "${quote(selected)}"`,
            'Call liraSelectDefaultDirectory',
            `FileOpen $0 "${quote(output)}" w`,
            'FileWriteUTF16LE /BOM $0 "$INSTDIR$\\r$\\n$liraPreviousInstallDir"',
            'FileClose $0',
            'SetErrorLevel 0',
            'Quit',
            'FunctionEnd',
            'Section',
            'SectionEnd',
          ].join('\n'),
        );
        const build = spawnSync(
          process.env.LIRA_TEST_MAKENSIS,
          ['/V2', '-INPUTCHARSET', 'UTF8', script],
          { encoding: 'utf8', windowsHide: true, timeout: 30000 },
        );
        assert.equal(build.status, 0, build.stdout + build.stderr);
        const run = spawnSync(executable, ['/S'], {
          windowsHide: true,
          timeout: 10000,
        });
        assert.equal(run.status, 0, name);
        const actual = fs
          .readFileSync(output, 'utf16le')
          .replace(/^\uFEFF/, '')
          .split('\r\n');
        assert.deepEqual(actual, [expected, previous || expected], name);
      }
    } finally {
      const resolved = fs.realpathSync(root);
      assert.equal(path.dirname(resolved), fs.realpathSync(os.tmpdir()));
      assert.ok(path.basename(resolved).startsWith('lira-directory-test-'));
      fs.rmSync(resolved, { recursive: true, force: true });
    }
  },
);
