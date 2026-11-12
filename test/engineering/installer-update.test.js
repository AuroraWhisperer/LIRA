'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { NsisScriptGenerator } = require('app-builder-lib/out/targets/nsis/nsisScriptGenerator');
const { resolveInstallerTools } = require('../helpers/installer-tools');
const { createScratchDirectory } = require('../helpers/scratch-directory');

const { compiler, plugins } = resolveInstallerTools();
const quote = (value) => value.replaceAll('$', () => '$$');

test('NSIS configured include graph preprocesses without macro collisions', {
  skip: process.platform !== 'win32' || !compiler ? 'Requires Windows and cached NSIS compiler' : false,
}, (t) => {
  const scratch = createScratchDirectory('installer-includes-', t);
  const root = path.resolve(__dirname, '../..');
  const { build } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const include = path.join(root, build.nsis.include);
  for (const name of fs.readdirSync(path.dirname(include)).filter(name => name.endsWith('.nsh'))) {
    const source = fs.readFileSync(path.join(path.dirname(include), name), 'utf8').replace(/^\uFEFF/, '');
    fs.writeFileSync(path.join(scratch, name), '\uFEFF' + source);
  }
  const result = spawnSync(compiler, ['/PPO', '-INPUTCHARSET', 'UTF8', path.join(scratch, path.basename(include))], {
    cwd: scratch, encoding: 'utf8', windowsHide: true, timeout: 10000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('NSIS updates show progress and close automatically while preserving restart intent', {
  skip: process.platform !== 'win32' || !compiler || !plugins
    ? 'Requires Windows and cached NSIS compiler/plugins'
    : false,
}, async (t) => {
  const root = createScratchDirectory('installer-update-', t);
  const executable = path.join(root, 'fixture.exe');
  const progress = path.join(root, 'progress.txt');
  const finish = path.join(root, 'finish.txt');
  const mode = path.join(root, 'mode.txt');
  const selection = path.join(root, 'selection.txt');
  const launch = path.join(root, 'launch.txt');
  const templates = path.dirname(require.resolve('app-builder-lib/templates/nsis/installer.nsi'));
  const flags = new NsisScriptGenerator();
  flags.flags(['updated', 'force-run', 'fail', 'machine', 'allusers', 'currentuser']);
  const record = (file, value) => [
    `FileOpen $9 "${quote(file)}" a`,
    'FileSeek $9 0 END',
    `FileWrite $9 "${value}$\\r$\\n"`,
    'FileClose $9',
  ].join('\n');
  const script = path.join(root, 'fixture.nsi');
  const source = [
    'Unicode true',
    'Name "LIRA isolated update fixture"',
    'RequestExecutionLevel user',
    `OutFile "${quote(executable)}"`,
    `!addplugindir /x86-unicode "${quote(plugins)}"`,
    `!addincludedir "${quote(path.join(templates, 'include'))}"`,
    `!addincludedir "${quote(templates)}"`,
    '!include MUI2.nsh',
    '!include UAC.nsh',
    // Elevation and install-context writes are outside this fixture. The real
    // builder mode page still decides which existing scope to select and skip.
    '!undef UAC_IsAdmin',
    '!define UAC_IsAdmin "1 = 1"',
    '!include multiUserUi.nsh',
    '!include StdUtils.nsh',
    flags.build(),
    // Only launching the real app is replaced; the production finish-page
    // callbacks, flag parsing and native NSIS page transitions run unchanged.
    '!undef StdUtils.ExecShellAsUser',
    '!define StdUtils.ExecShellAsUser "!insertmacro fixtureLaunch"',
    '!macro fixtureLaunch RESULT TARGET VERB PARAMETERS',
    record(launch, 'launch|${PARAMETERS}'),
    '!macroend',
    '!macro StartApp',
    'Var /GLOBAL startAppArgs',
    '${If} ${isUpdated}',
    'StrCpy $startAppArgs "--updated"',
    '${Else}',
    'StrCpy $startAppArgs ""',
    '${EndIf}',
    '${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$startAppArgs"',
    '!macroend',
    'Function fixtureBuilderStartApp',
    '!insertmacro StartApp',
    'FunctionEnd',
    'Var launchLink',
    'Var installMode',
    'Var hasPerUserInstallation',
    'Var hasPerMachineInstallation',
    'Var perUserInstallationFolder',
    'Var perMachineInstallationFolder',
    '!macro setInstallModePerUser',
    'StrCpy $installMode CurrentUser',
    record(selection, 'user'),
    '!macroend',
    '!macro setInstallModePerAllUsers',
    'StrCpy $installMode all',
    record(selection, 'machine'),
    '!macroend',
    `!include "${quote(path.resolve(__dirname, '../../build/installer-ui.nsh'))}"`,
    '!insertmacro PAGE_INSTALL_MODE',
    '!insertmacro customPageAfterChangeDir',
    '!insertmacro MUI_PAGE_INSTFILES',
    '!insertmacro customFinishPage',
    '!insertmacro MUI_LANGUAGE "SimpChinese"',
    'Function .onInit',
    'StrCpy $installMode CurrentUser',
    '${If} ${isMachine}',
    'StrCpy $installMode all',
    '${EndIf}',
    '!insertmacro liraInitUpdateProgress',
    'FunctionEnd',
    'Function liraInitInstallerUi',
    'FunctionEnd',
    'Function liraShowInstallProgress',
    'FunctionEnd',
    'Function liraShowInstallMode',
    record(mode, 'mode'),
    "System::Call 'user32::PostMessageW(p $HWNDPARENT, i ${WM_COMMAND}, p 1, p 0)'",
    'FunctionEnd',
    'Function liraSkipUpdateFinish',
    '!insertmacro liraFinishUpdate',
    'FunctionEnd',
    'Function liraShowInstallFinish',
    record(finish, 'finish'),
    "System::Call 'user32::PostMessageW(p $HWNDPARENT, i ${WM_COMMAND}, p 1, p 0)'",
    'FunctionEnd',
    'Section',
    "System::Call 'user32::IsWindowVisible(p $HWNDPARENT) i.r0'",
    record(progress, '$0'),
    '${If} ${isFail}',
    'SetErrorLevel 2',
    'Quit',
    '${EndIf}',
    '${IfNot} ${isUpdated}',
    "System::Call 'user32::PostMessageW(p $HWNDPARENT, i ${WM_COMMAND}, p 1, p 0)'",
    '${EndIf}',
    'SectionEnd',
  ].join('\n');
  fs.writeFileSync(script, source);
  const build = spawnSync(compiler, ['/V2', '-INPUTCHARSET', 'UTF8', script], {
    encoding: 'utf8', windowsHide: true, timeout: 30000,
  });
  assert.equal(build.error, undefined);
  assert.equal(build.status, 0, build.stdout + build.stderr);

  for (const [name, args, visible, showFinish, launches, status] of [
    ['restart update', ['/S', '--updated', '--force-run'], true, false, ['launch|--updated'], 0],
    ['update on quit', ['/S', '--updated'], true, false, [], 0],
    ['all-users update', ['/S', '--updated', '--machine'], true, false, [], 0],
    ['manual install', [], true, true, ['launch|'], 0],
    ['standalone silent install', ['/S'], false, false, [], 0],
    ['failed update', ['/S', '--updated', '--force-run', '--fail'], true, false, [], 2],
  ]) {
    await t.test(name, () => {
      for (const file of [progress, finish, launch, mode, selection]) fs.rmSync(file, { force: true });
      const run = spawnSync(executable, args, { windowsHide: true, timeout: 10000 });
      assert.equal(run.error, undefined, 'installer must finish without user interaction');
      assert.equal(run.status, status);
      assert.equal(fs.readFileSync(progress, 'utf8').trim(), visible ? '1' : '0');
      assert.equal(fs.existsSync(finish), showFinish);
      assert.equal(fs.existsSync(mode), false, 'current-user installs and updates skip install-scope selection');
      if (visible) assert.equal(fs.readFileSync(selection, 'utf8').trim(), args.includes('--machine') ? 'machine' : 'user');
      assert.deepEqual(fs.existsSync(launch) ? fs.readFileSync(launch, 'utf8').trim().split('\r\n') : [], launches);
    });
  }

  await t.test('production progress layout compiles and completes an update', () => {
    const license = path.join(root, 'license.txt');
    fs.writeFileSync(license, 'Isolated fixture');
    // Instantiate the production DPI/layout callbacks with all MUI controls.
    // Manual page clicks are covered above; this run needs no simulated clicks.
    const layout = source
      .replace('!insertmacro PAGE_INSTALL_MODE', [
        '!define MUI_PAGE_CUSTOMFUNCTION_PRE fixtureSkipUpdatePage',
        `!insertmacro MUI_PAGE_LICENSE "${quote(license)}"`,
        '!insertmacro PAGE_INSTALL_MODE',
        '!define MUI_PAGE_CUSTOMFUNCTION_PRE fixtureSkipUpdatePage',
        '!insertmacro MUI_PAGE_DIRECTORY',
      ].join('\n'))
      .replace(/Function (?:liraInitInstallerUi|liraShowInstallProgress|liraShowInstallMode|liraSkipUpdateFinish|liraShowInstallFinish)\b[\s\S]*?FunctionEnd\n/g, '') + [
        '',
        'Function fixtureSkipUpdatePage',
        '${If} ${isUpdated}',
        'Abort',
        '${EndIf}',
        'FunctionEnd',
        '!insertmacro liraInstallerUi',
      ].join('\n');
    fs.writeFileSync(script, layout);
    const build = spawnSync(compiler, ['/V2', '-INPUTCHARSET', 'UTF8', script], {
      encoding: 'utf8', windowsHide: true, timeout: 30000,
    });
    assert.equal(build.error, undefined);
    assert.equal(build.status, 0, build.stdout + build.stderr);
    for (const file of [progress, finish, launch]) fs.rmSync(file, { force: true });
    const run = spawnSync(executable, ['/S', '--updated', '--force-run'], {
      windowsHide: true, timeout: 10000,
    });
    assert.equal(run.error, undefined);
    assert.equal(run.status, 0);
    assert.equal(fs.readFileSync(progress, 'utf8').trim(), '1');
    assert.equal(fs.existsSync(finish), false);
    assert.deepEqual(fs.readFileSync(launch, 'utf8').trim().split('\r\n'), ['launch|--updated']);
  });
});
