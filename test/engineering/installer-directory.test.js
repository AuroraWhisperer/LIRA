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
      .replace(/ReadRegStr[^\r\n]+/, 'ReadEnvStr $liraPreviousInstallDir FIXTURE_PREVIOUS')
      .replace('!insertmacro GetDParameter $R0', 'ReadEnvStr $R0 FIXTURE_EXPLICIT')
      .replace('IfFileExists "D:\\*.*"', 'IfFileExists "$fixtureDrive"');
    assert.doesNotMatch(choose, /ReadReg|WriteReg|DeleteReg/);
    try {
      const executable = path.join(root, 'defaults.exe');
      const script = path.join(root, 'defaults.nsi');
      fs.writeFileSync(script, [
        'Unicode true',
        'Name "LIRA directory fixture"',
        'RequestExecutionLevel user',
        `OutFile "${executable.replaceAll('$', () => '$$')}"`,
        'Var liraPreviousInstallDir',
        'Var fixtureDrive',
        choose,
        'Function .onInit',
        'ReadEnvStr $INSTDIR FIXTURE_SELECTED',
        'ReadEnvStr $fixtureDrive FIXTURE_DRIVE',
        'Call liraSelectDefaultDirectory',
        'ReadEnvStr $1 FIXTURE_OUTPUT',
        'FileOpen $0 "$1" w',
        'FileWriteUTF16LE /BOM $0 "$INSTDIR$\\r$\\n$liraPreviousInstallDir"',
        'FileClose $0',
        'SetErrorLevel 0',
        'Quit',
        'FunctionEnd',
        'Section',
        'SectionEnd',
      ].join('\n'));
      const build = spawnSync(compiler, ['/V2', '-INPUTCHARSET', 'UTF8', script], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 30000,
      });
      assert.equal(build.status, 0, build.stdout + build.stderr);

      for (const [name, previous, selected, explicit, hasD, expected] of [
        ['fresh-with-d', '', 'C:\\Default\\LIRA', '', true, 'D:\\LIRA'],
        ['fresh-without-d', '', 'C:\\Default\\LIRA', '', false, 'C:\\Default\\LIRA'],
        ['existing-d', 'D:\\0点歌\\LIRA', 'D:\\0点歌\\LIRA', '', true, 'D:\\0点歌\\LIRA'],
        ['existing-c', 'C:\\Apps\\LIRA', 'C:\\Apps\\LIRA', '', true, 'C:\\Apps\\LIRA'],
        ['explicit-other-drive', 'D:\\Apps\\LIRA', 'E:\\软件\\LIRA', 'E:\\软件\\LIRA', true, 'E:\\软件\\LIRA'],
      ]) {
        const output = path.join(root, name + '.txt');
        const run = spawnSync(executable, ['/S'], {
          windowsHide: true,
          timeout: 10000,
          env: {
            ...process.env,
            FIXTURE_PREVIOUS: previous,
            FIXTURE_SELECTED: selected,
            FIXTURE_EXPLICIT: explicit,
            FIXTURE_DRIVE: hasD ? root : path.join(root, 'absent-drive'),
            FIXTURE_OUTPUT: output,
          },
        });
        assert.equal(run.status, 0, name);
        const actual = fs
          .readFileSync(output, 'utf16le')
          .replace(/^\uFEFF/, '')
          .split('\r\n');
        assert.deepEqual(actual, [expected, previous], name);
      }
    } finally {
      const resolved = fs.realpathSync(root);
      assert.equal(path.dirname(resolved), fs.realpathSync(os.tmpdir()));
      assert.ok(path.basename(resolved).startsWith('lira-directory-test-'));
      fs.rmSync(resolved, { recursive: true, force: true });
    }
  },
);

test('the final directory is compared to a registered installation, not the fresh page default', {
  skip: process.platform !== 'win32' || !compiler,
}, t => {
  const { createScratchDirectory } = require('../helpers/scratch-directory');
  const root = createScratchDirectory('install-final-directory-', t);
  const installer = fs.readFileSync(path.join(__dirname, '../../build/installer.nsh'), 'utf8');
  const data = fs.readFileSync(path.join(__dirname, '../../build/installer-data.nsh'), 'utf8');
  const choose = installer.match(/Function liraSelectDefaultDirectory\b[\s\S]*?FunctionEnd/)[0]
    .replace(/ReadRegStr[^\r\n]+/, 'ReadEnvStr $liraPreviousInstallDir FIXTURE_PREVIOUS')
    .replace('!insertmacro GetDParameter $R0', 'StrCpy $R0 ""')
    .replace('"D:\\*.*"', '"$disk\\*.*"').replace('"D:\\LIRA"', '"$disk\\LIRA"');
  const sectionEntry = installer.match(/Section "-LIRA Preserve Data"([\s\S]*?)\$\{If\} \$installMode/)[1]
    .replace('Call liraRequireWritableInstallDirectory', '; all fixture targets are writable');
  const freshCheck = data.match(/Function liraPreserveInstallData\b[\s\S]*?\n  Return\b/)[0]
    .replace('$APPDATA', '$disk\\fake-appdata');
  assert.doesNotMatch(choose + sectionEntry + freshCheck, /ReadReg|WriteReg|DeleteReg|ExecWait|RMDir|D:\\LIRA/);
  const script = path.join(root, 'paths.nsi');
  const exe = path.join(root, 'paths.exe');
  fs.writeFileSync(script, [
    'Unicode true', 'SilentInstall silent', 'Name "Directory decision"', 'RequestExecutionLevel user',
    `OutFile "${exe.replaceAll('$', () => '$$')}"`,
    'Var disk', 'Var liraPreviousInstallDir', 'Var liraDataStage', 'Var liraDataBackup', 'Var liraDataSource',
    choose, freshCheck, '  liraPrepareFailed:', '    SetErrorLevel 2', '    Quit',
    '  liraCheckDestination:', '  liraCheckBackup:', '  liraRecoverBackup:', '  liraAudioOnlyBackup:',
    '    SetErrorLevel 91', '    Quit', 'FunctionEnd', 'Section', 'ReadEnvStr $disk FIXTURE_DISK',
    'StrCpy $INSTDIR "$disk\\LIRA"', 'Call liraSelectDefaultDirectory', 'ReadEnvStr $INSTDIR FIXTURE_SELECTED',
    sectionEntry, 'Call liraPreserveInstallData', 'SetErrorLevel 0', 'SectionEnd',
  ].join('\n'));
  const build = spawnSync(compiler, ['/NOCONFIG', '/V2', '-INPUTCHARSET', 'UTF8', script], { cwd: root, encoding: 'utf8', windowsHide: true });
  assert.equal(build.status, 0, build.stdout + build.stderr);
  const codes = [];
  for (const [name, target, registered] of [['original', 'LIRA'], ['neighbor', 'LIRA2'],
    ['nested', 'LIRA/Studio/LIRA'], ['registered-nested', 'LIRA/Studio/LIRA', true]]) {
    const disk = path.join(root, name);
    fs.mkdirSync(disk);
    const previous = path.join(disk, 'LIRA');
    if (registered) fs.mkdirSync(previous);
    const run = spawnSync(exe, [], { cwd: disk, timeout: 10000, windowsHide: true,
      env: { ...process.env, FIXTURE_DISK: disk, FIXTURE_SELECTED: path.join(disk, target), FIXTURE_PREVIOUS: registered ? previous : '' } });
    codes.push(run.status);
  }
  t.diagnostic(`NSIS exits (default, neighbor, fresh nested, registered nested): ${codes.join(', ')}`);
  assert.deepEqual(codes, [0, 0, 0, 2]);
});

test('installer accepts current-user installs and validates targets before touching an old installation', {
  skip: process.platform !== 'win32' || !compiler || !plugins,
}, () => {
  const scratch = path.resolve(__dirname, '../../tmp');
  fs.mkdirSync(scratch, { recursive: true });
  const root = fs.mkdtempSync(path.join(scratch, 'lira-install-permissions-'));
  const source = fs.readFileSync(path.join(__dirname, '../../build/installer-per-user.nsh'), 'utf8')
    .replace('ReadRegStr $R3 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" "InstallLocation"', 'ReadEnvStr $R3 FIXTURE_REGISTERED');
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
    // The elevated-update fixture overrides UAC_IsAdmin at compile time.
    for (const variant of ['current-user', 'elevated-update']) {
      const executable = path.join(root, variant + '.exe');
      const script = path.join(root, variant + '.nsi');
      fs.writeFileSync(script, [
        'Unicode true', 'Name "LIRA permission fixture"', 'RequestExecutionLevel user',
        `OutFile "${quote(executable)}"`,
        `!addplugindir /x86-unicode "${quote(plugins)}"`,
        `!addincludedir "${quote(path.join(templates, 'include'))}"`,
        '!include LogicLib.nsh', '!include UAC.nsh', 'Var installMode',
        'Var hasPerMachineInstallation', 'Var hasPerUserInstallation',
        ...(variant === 'elevated-update' ? ['!undef UAC_IsAdmin', '!define UAC_IsAdmin "1 = 1"'] : []),
        source,
        'Function .onInit',
        'ReadEnvStr $installMode FIXTURE_MODE',
        'ReadEnvStr $hasPerMachineInstallation FIXTURE_PER_MACHINE',
        'StrCpy $hasPerUserInstallation "1"',
        'Call liraRequireUserInstall',
        'FunctionEnd',
        'Section',
        // /S and /D use the same final validation as the production preservation section.
        'Call liraRequireWritableInstallDirectory',
        'ReadEnvStr $1 FIXTURE_PASSED',
        'FileOpen $0 "$1" w',
        'FileWrite $0 "$installMode|$hasPerMachineInstallation|$hasPerUserInstallation"', 'FileClose $0',
        'SectionEnd',
      ].join('\n'));
      const build = spawnSync(compiler, ['/V2', '-INPUTCHARSET', 'UTF8', script], {
        encoding: 'utf8', windowsHide: true, timeout: 30000,
      });
      assert.equal(build.status, 0, build.stdout + build.stderr);
    }

    for (const scenario of ['fresh', 'unknown-directory', 'data-only-directory', 'retained-data', 'update', 'mixed-context-update', 'junction-target', 'junction-resources-update', 'junction-unpacked-update', 'protected-target', 'protected-data', 'protected-list', 'protected-resources', 'all-users', 'elevated-update']) {
      const target = path.join(root, scenario, 'LIRA');
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
      const executable = path.join(root, scenario === 'elevated-update' ? 'elevated-update.exe' : 'current-user.exe');
      const isUpdate = scenario.endsWith('update');
      const updateArgs = isUpdate ? ['--updated', '--force-run'] : [];
      const run = spawnSync(executable, [...updateArgs, '/S', `/D=${target}`], {
        windowsHide: true, timeout: 10000,
        env: {
          ...process.env,
          FIXTURE_MODE: scenario === 'all-users' ? 'all' : 'CurrentUser',
          FIXTURE_PER_MACHINE: scenario === 'mixed-context-update' || scenario === 'all-users' ? '1' : '0',
          FIXTURE_REGISTERED: isUpdate || scenario === 'protected-resources' ? target : '',
          FIXTURE_PASSED: passed,
        },
      });
      const allowed = scenario === 'fresh' || scenario === 'retained-data' || (isUpdate && !scenario.startsWith('junction-'));
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
