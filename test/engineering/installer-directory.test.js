'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { resolveInstallerTools } = require('../helpers/installer-tools');

const { compiler, plugins } = resolveInstallerTools();

test(
  'installer defaults respect existing paths, explicit paths and computers without D',
  {
    skip: process.platform !== 'win32' || !compiler,
  },
  () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-directory-test-'));
    const installer = fs.readFileSync(path.join(__dirname, '../../build/installer.nsh'), 'utf8');
    const choose = installer
      .match(/Function liraSelectDefaultDirectory\b[\s\S]*?FunctionEnd/)[0]
      .replace(/ReadRegStr[^\r\n]+/, 'StrCpy $liraPreviousInstallDir "${FIXTURE_PREVIOUS}"')
      .replace('!insertmacro GetDParameter $R0', 'StrCpy $R0 "${FIXTURE_EXPLICIT}"')
      .replace('IfFileExists "D:\\*.*"', 'IfFileExists "${FIXTURE_DRIVE}"');
    assert.doesNotMatch(choose, /ReadReg|WriteReg|DeleteReg/);
    try {
      for (const [name, previous, selected, explicit, hasD, expected] of [
        ['fresh-with-d', '', 'C:\\Default\\LIRA', '', true, 'D:\\LIRA'],
        ['fresh-without-d', '', 'C:\\Default\\LIRA', '', false, 'C:\\Default\\LIRA'],
        ['existing-d', 'D:\\0点歌\\LIRA', 'D:\\0点歌\\LIRA', '', true, 'D:\\0点歌\\LIRA'],
        ['existing-c', 'C:\\Apps\\LIRA', 'C:\\Apps\\LIRA', '', true, 'C:\\Apps\\LIRA'],
        ['explicit-other-drive', 'D:\\Apps\\LIRA', 'E:\\软件\\LIRA', 'E:\\软件\\LIRA', true, 'E:\\软件\\LIRA'],
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
        const build = spawnSync(compiler, ['/V2', '-INPUTCHARSET', 'UTF8', script], {
          encoding: 'utf8',
          windowsHide: true,
          timeout: 30000,
        });
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

test('installer accepts only ordinary-user writable targets before touching an old installation', {
  skip: process.platform !== 'win32' || !compiler || !plugins,
}, () => {
  const scratch = path.resolve(__dirname, '../../tmp');
  fs.mkdirSync(scratch, { recursive: true });
  const root = fs.mkdtempSync(path.join(scratch, 'lira-install-permissions-'));
  const source = fs.readFileSync(path.join(__dirname, '../../build/installer-per-user.nsh'), 'utf8')
    .replace('ReadRegStr $R3 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" "InstallLocation"', 'StrCpy $R3 "${FIXTURE_REGISTERED}"');
  assert.doesNotMatch(source, /ReadReg|WriteReg|DeleteReg/);
  const templates = path.join(path.dirname(require.resolve('app-builder-lib/package.json')), 'templates/nsis');
  const quote = (value) => value.replaceAll('$', () => '$$');
  const identity = spawnSync('whoami', ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8', windowsHide: true });
  assert.equal(identity.status, 0, identity.stderr);
  const sid = identity.stdout.match(/S-1-5-[\d-]+/)?.[0];
  assert.ok(sid);
  let denied;
  const junctions = [];
  try {
    for (const scenario of ['fresh', 'unknown-directory', 'data-only-directory', 'retained-data', 'update', 'mixed-context-update', 'junction-target', 'junction-resources-update', 'junction-unpacked-update', 'protected-target', 'protected-data', 'protected-list', 'protected-resources', 'all-users', 'elevated']) {
      const target = path.join(root, scenario, 'LIRA');
      const executable = path.join(root, scenario + '.exe');
      const script = path.join(root, scenario + '.nsi');
      const passed = path.join(root, scenario + '-passed.txt');
      if (scenario === 'junction-target') {
        const linkedDirectory = path.join(root, scenario, 'actual-LIRA');
        fs.mkdirSync(linkedDirectory, { recursive: true });
        fs.symlinkSync(linkedDirectory, target, 'junction');
        junctions.push(target);
      } else if (scenario !== 'fresh') {
        fs.mkdirSync(target, { recursive: true });
      }
      if (scenario !== 'fresh') {
        if (scenario !== 'data-only-directory') fs.writeFileSync(path.join(target, 'old-program.txt'), 'old program');
        fs.mkdirSync(path.join(target, 'data'));
      }
      if (scenario === 'retained-data') fs.writeFileSync(path.join(target, 'lira-installation.ini'), '[installation]\r\nappId=com.aurorawhisperer.lira\r\n');
      if (scenario === 'update') fs.mkdirSync(path.join(target, 'resources'));
      let outside;
      if (scenario === 'junction-resources-update' || scenario === 'junction-unpacked-update') {
        outside = path.join(root, scenario, 'outside');
        fs.mkdirSync(outside);
        fs.writeFileSync(path.join(outside, 'app.asar'), 'unrelated external file');
        const link = path.join(target, scenario === 'junction-resources-update' ? 'resources' : 'resources/app.asar.unpacked/node_modules/linked');
        fs.mkdirSync(path.dirname(link), { recursive: true });
        fs.symlinkSync(outside, link, 'junction');
        junctions.push(link);
      }
      if (scenario.startsWith('protected-')) {
        denied = scenario === 'protected-resources' ? path.join(target, 'resources') : scenario === 'protected-data' ? path.join(target, 'data') : target;
        if (scenario === 'protected-resources') fs.mkdirSync(denied);
        const acl = spawnSync('icacls', [denied, '/deny', `*${sid}:(${scenario === 'protected-resources' || scenario === 'protected-list' ? 'RD' : 'W'})`], { encoding: 'utf8', windowsHide: true });
        assert.equal(acl.status, 0, acl.stdout + acl.stderr);
      }
      fs.writeFileSync(script, [
        'Unicode true', 'Name "LIRA permission fixture"', 'RequestExecutionLevel user',
        `OutFile "${quote(executable)}"`,
        `!define FIXTURE_REGISTERED "${scenario.endsWith('update') || scenario === 'protected-resources' ? quote(target) : ''}"`,
        `!addplugindir /x86-unicode "${quote(plugins)}"`,
        `!addincludedir "${quote(path.join(templates, 'include'))}"`,
        '!include LogicLib.nsh', '!include UAC.nsh', 'Var installMode',
        'Var hasPerMachineInstallation', 'Var hasPerUserInstallation',
        ...(scenario === 'elevated' ? ['!undef UAC_IsAdmin', '!define UAC_IsAdmin "1 = 1"'] : []),
        source,
        'Function .onInit',
        `StrCpy $installMode "${scenario === 'all-users' ? 'all' : 'CurrentUser'}"`,
        `StrCpy $hasPerMachineInstallation "${scenario === 'mixed-context-update' || scenario === 'all-users' ? '1' : '0'}"`,
        'StrCpy $hasPerUserInstallation "1"',
        'Call liraRequireUserInstall',
        'FunctionEnd',
        'Section',
        // /S and /D use the same final validation as the production preservation section.
        'Call liraRequireWritableInstallDirectory',
        `FileOpen $0 "${quote(passed)}" w`,
        'FileWrite $0 "$installMode|$hasPerMachineInstallation|$hasPerUserInstallation"', 'FileClose $0',
        'SectionEnd',
      ].join('\n'));
      const build = spawnSync(compiler, ['/V2', '-INPUTCHARSET', 'UTF8', script], {
        encoding: 'utf8', windowsHide: true, timeout: 30000,
      });
      assert.equal(build.status, 0, build.stdout + build.stderr);
      const updateArgs = scenario.endsWith('update') ? ['--updated', '--force-run'] : [];
      const run = spawnSync(executable, [...updateArgs, '/S', `/D=${target}`], { windowsHide: true, timeout: 10000 });
      const allowed = scenario === 'fresh' || scenario === 'retained-data' || (scenario.endsWith('update') && !scenario.startsWith('junction-'));
      assert.equal(run.status, allowed ? 0 : 2, scenario);
      assert.equal(fs.existsSync(passed), allowed, scenario);
      if (allowed) assert.equal(fs.readFileSync(passed, 'utf8'), 'CurrentUser|0|1', 'silent updates must not request machine elevation');
      if (scenario !== 'fresh' && scenario !== 'data-only-directory') assert.equal(fs.readFileSync(path.join(target, 'old-program.txt'), 'utf8'), 'old program');
      if (denied) {
        const restored = spawnSync('icacls', [denied, '/remove:d', `*${sid}`], { windowsHide: true });
        assert.equal(restored.status, 0);
        denied = null;
      }
      const expected = scenario === 'fresh' ? [] : ['data', ...(scenario === 'data-only-directory' ? [] : ['old-program.txt'])];
      if (scenario === 'retained-data') expected.push('lira-installation.ini');
      if (scenario === 'protected-resources' || scenario === 'update') expected.push('resources');
      if (outside) {
        expected.push('resources');
        assert.equal(fs.readFileSync(path.join(outside, 'app.asar'), 'utf8'), 'unrelated external file');
      }
      assert.deepEqual(fs.readdirSync(target).sort(), expected.sort());
    }
  } finally {
    if (denied) spawnSync('icacls', [denied, '/remove:d', `*${sid}`], { windowsHide: true });
    assert.equal(path.dirname(fs.realpathSync(root)), fs.realpathSync(scratch));
    for (const junction of junctions) fs.unlinkSync(junction);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
