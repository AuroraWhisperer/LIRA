'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { NsisScriptGenerator } = require('app-builder-lib/out/targets/nsis/nsisScriptGenerator');
const { LangConfigurator, addCustomMessageFileInclude } = require('app-builder-lib/out/targets/nsis/nsisLang');
const { resolveInstallerTools } = require('../helpers/installer-tools');
const { createScratchDirectory } = require('../helpers/scratch-directory');

const { compiler, plugins } = resolveInstallerTools();
const quote = (value) => value.replaceAll('$', () => '$$');

test('embedded installer seeds only the installation-drive baseline and retires mismatched manual block maps', {
  skip: process.platform !== 'win32' || !compiler || !plugins,
}, t => {
  const scratch = createScratchDirectory('installer-cache-', t);
  const templates = path.dirname(require.resolve('app-builder-lib/templates/nsis/installer.nsi'));
  const read = name => fs.readFileSync(path.resolve(__dirname, '../..', name), 'utf8');
  const util = read('build/nsis/installUtil.nsh');
  const copy = util.match(/!macro copyFile\b[\s\S]*?!macroend/)[0];
  const parent = util.match(/Function GetFileParent\b[\s\S]*?FunctionEnd/)[0];
  const custom = read('build/installer.nsh').match(/!macro customInstall\b[\s\S]*?!macroend/)[0];
  const builderCopy = fs.readFileSync(path.join(templates, 'include/installer.nsh'), 'utf8')
    .match(/!insertmacro copyFile "\$EXEPATH"[^\r\n]+/)[0];
  const flags = new NsisScriptGenerator();
  flags.flags(['updated', 'lock-map']);
  const exe = path.join(scratch, 'cache-fixture.exe');
  const script = path.join(scratch, 'cache-fixture.nsi');
  fs.writeFileSync(path.join(scratch, 'control.txt'), 'ordinary copy');
  // Only the production cache macros run. Every LOCALAPPDATA access maps into the scratch directory.
  const isolated = text => text.replaceAll('$LOCALAPPDATA', '$INSTDIR\\profile');
  fs.writeFileSync(script, [
    'Unicode true', 'Name "Cache fixture"', 'RequestExecutionLevel user', 'SilentInstall silent',
    `OutFile "${quote(exe)}"`, '!include LogicLib.nsh', '!include FileFunc.nsh',
    `!addplugindir /x86-unicode "${quote(plugins)}"`, `!addincludedir "${quote(path.join(templates, 'include'))}"`,
    '!include StdUtils.nsh', '!define APP_INSTALLER_STORE_FILE "lira-updater\\installer.exe"', 'Var installMode',
    flags.build(), parent, isolated(copy), isolated(custom),
    'Function liraRestoreInstallData', 'FunctionEnd', 'Function liraRecordDataPreservation', 'FunctionEnd',
    'Section', `StrCpy $INSTDIR "${quote(scratch)}"`, 'StrCpy $installMode "current"', isolated(builderCopy),
    '!insertmacro copyFile "$EXEDIR\\control.txt" "$INSTDIR\\control\\copied.txt"',
    'IfFileExists "$INSTDIR\\profile\\${APP_INSTALLER_STORE_FILE}" 0 +3',
    'FileOpen $0 "$INSTDIR\\staging-copy-observed" w', 'FileClose $0',
    '${If} ${isLockMap}', 'FileOpen $1 "$INSTDIR\\updates\\lira-updater\\current.blockmap" r', '${EndIf}',
    '!insertmacro customInstall',
    '${If} ${isLockMap}', 'FileClose $1', '${EndIf}', 'SectionEnd',
  ].join('\n'));
  const compiled = spawnSync(compiler, ['/V2', '/WX', '-INPUTCHARSET', 'UTF8', script],
    { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
  const cache = path.join(scratch, 'updates/lira-updater');
  fs.mkdirSync(cache, { recursive: true });
  const baseline = path.join(cache, 'installer.exe');
  const blockmap = path.join(cache, 'current.blockmap');
  const installer = fs.readFileSync(exe);
  const different = Buffer.from(installer);
  different[different.length - 1] ^= 1;
  const pending = path.join(cache, 'pending');
  fs.mkdirSync(pending);
  const downloaded = path.join(pending, 'cache-fixture.exe');
  fs.copyFileSync(exe, downloaded);
  fs.copyFileSync(path.join(scratch, 'control.txt'), path.join(pending, 'control.txt'));
  for (const [flags, previous, keepMap, pendingMap] of [
    // An interrupted download can leave identical pending/current maps from a different release.
    [['--updated'], different, false, 'map'],
    [['--updated'], installer, false, 'map'],
    [['--updated'], different, false, 'different map'],
    [['--updated'], different, false],
    [[], installer, true],
    [[], different, false],
  ]) {
    fs.writeFileSync(baseline, previous);
    fs.writeFileSync(blockmap, 'map');
    const candidate = path.join(pending, 'current.blockmap');
    if (pendingMap) fs.writeFileSync(candidate, pendingMap);
    else fs.rmSync(candidate, { force: true });
    const run = spawnSync(flags.length ? downloaded : exe, ['/S', ...flags], { windowsHide: true, timeout: 10000 });
    assert.equal(run.status, 0);
    assert.equal(fs.readFileSync(path.join(scratch, 'control/copied.txt'), 'utf8'), 'ordinary copy');
    assert.deepEqual(fs.readFileSync(baseline), installer);
    assert.deepEqual({ staged: fs.existsSync(path.join(scratch, 'staging-copy-observed')),
      hasMap: fs.existsSync(blockmap) }, { staged: false, hasMap: keepMap });
  }
  fs.writeFileSync(baseline, 'previous installer');
  fs.writeFileSync(blockmap, 'previous map');
  const locked = spawnSync(exe, ['/S', '--lock-map'], { windowsHide: true, timeout: 10000 });
  assert.equal(locked.status, 0);
  assert.equal(fs.readFileSync(blockmap, 'utf8'), 'previous map');
  assert.ok(fs.readFileSync(baseline).equals(Buffer.from('previous installer')),
    'a map still in use must stay paired with its original installer');
  const lockedUpdate = spawnSync(downloaded, ['/S', '--updated', '--lock-map'], { windowsHide: true, timeout: 10000 });
  assert.equal(lockedUpdate.status, 0);
  assert.equal(fs.existsSync(baseline), false, 'an unverified promoted map cannot identify a usable delta baseline');
});

test('builder upgrade runs the current safe uninstaller instead of a destructive legacy executable', {
  skip: process.platform !== 'win32' || !compiler || !plugins,
}, async (t) => {
  const root = createScratchDirectory('installer-safe-upgrade-', t);
  const templates = path.dirname(require.resolve('app-builder-lib/templates/nsis/installer.nsi'));
  const buildDir = path.resolve(__dirname, '../../build');
  const installDir = path.join(root, 'Old LIRA');
  const legacy = path.join(installDir, 'Uninstall LIRA.exe');
  const personal = path.join(installDir, 'personal.txt');
  const calledLegacy = path.join(root, 'legacy-called');
  const safe = path.join(root, 'safe-uninstaller.exe');
  const writer = path.join(root, 'writer.exe');
  const base = [
    'Unicode true', 'Name "LIRA isolated safe upgrade"', 'RequestExecutionLevel user',
    '!include LogicLib.nsh', '!include FileFunc.nsh',
    `!addincludedir "${quote(path.join(templates, 'include'))}"`,
    `!addplugindir /x86-unicode "${quote(plugins)}"`,
    '!include StdUtils.nsh',
  ];
  const compile = (name, lines) => {
    const script = path.join(root, name + '.nsi');
    fs.writeFileSync(script, [...base, ...lines].join('\n'));
    const result = spawnSync(compiler, ['/V2', '/WX', '-INPUTCHARSET', 'UTF8', script], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  };
  const flags = new NsisScriptGenerator();
  flags.flags(['updated', 'delete-app-data']);
  const removal = fs.readFileSync(path.join(buildDir, 'installer-uninstall.nsh'), 'utf8')
    .replaceAll('$APPDATA', '${FIXTURE_APPDATA}').replaceAll('$TEMP', '${FIXTURE_TEMP}')
    .replace(/MessageBox MB_OK\|MB_ICONSTOP ("[^\n]+") \/SD IDOK/g, 'DetailPrint $1');
  compile('safe', [
    `OutFile "${quote(writer)}"`, '!define BUILD_UNINSTALLER',
    '!define APP_EXECUTABLE_FILENAME "LIRA.exe"', '!define UNINSTALL_FILENAME "Uninstall LIRA.exe"',
    '!define APP_PACKAGE_NAME "lira"', `!define FIXTURE_APPDATA "${quote(path.join(root, 'roaming'))}"`,
    `!define FIXTURE_TEMP "${quote(root)}"`, 'Var installMode', flags.build(), removal,
    '!insertmacro liraDeclareApplicationFileRemoval',
    'Function .onInit', `WriteUninstaller "${quote(safe)}"`, 'SetErrorLevel 0', 'Quit', 'FunctionEnd',
    'Section', 'SectionEnd', 'Section "Uninstall"',
    'StrCpy $installMode CurrentUser', '!insertmacro customUnInit', '!insertmacro customRemoveFiles', 'SectionEnd',
  ]);
  assert.equal(spawnSync(writer, ['/S'], { windowsHide: true, timeout: 10000 }).status, 0);
  const installer = fs.readFileSync(path.join(buildDir, 'installer.nsh'), 'utf8');
  const customCheck = installer.match(/!macro customCheckAppRunning\b[\s\S]*?!macroend/)[0];
  const check = fs.readFileSync(path.join(templates, 'include/allowOnlyOneInstallerInstance.nsh'), 'utf8')
    .match(/!macro CHECK_APP_RUNNING\b[\s\S]*?!macroend/)[0];
  // Keep the builder's actual call order. Only registry reads, app waiting and
  // error dialogs use fixture boundaries; neither real registration nor apps run.
  const section = fs.readFileSync(path.join(templates, 'installSection.nsh'), 'utf8');
  const upgradeCalls = section.slice(section.indexOf('!ifdef ONE_CLICK'), section.indexOf('SetOutPath $INSTDIR'))
    .replace('ReadRegStr $R1 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" KeepShortcuts', 'StrCpy $R1 ""');
  const util = fs.readFileSync(path.join(buildDir, 'nsis/installUtil.nsh'), 'utf8')
    .replace(/!macro readReg\b[\s\S]*?!macroend/, [
      '!macro readReg VAR ROOT_KEY SUB_KEY NAME',
      '${If} "${NAME}" == "UninstallString"', `StrCpy "${'${VAR}'}" '\"${quote(legacy)}\" /currentuser'`,
      '${ElseIf} "${NAME}" == "InstallLocation"', 'StrCpy "${VAR}" "${FIXTURE_REGISTERED}"',
      '${Else}', 'StrCpy "${VAR}" ""', '${EndIf}', '!macroend',
    ].join('\n'));
  assert.doesNotMatch(util, /ReadRegStr|WriteReg|DeleteReg/);
  const fixtureBuildDir = path.join(root, 'build');
  const fixtureUtil = path.join(fixtureBuildDir, 'nsis/installUtil.nsh');
  fs.mkdirSync(path.dirname(fixtureUtil), { recursive: true });
  fs.writeFileSync(fixtureUtil, util);
  const legacyFixture = path.join(root, 'legacy.exe');
  compile('legacy', [
    `OutFile "${quote(legacyFixture)}"`, 'Section',
    `FileOpen $0 "${quote(calledLegacy)}" w`, 'FileClose $0',
    `Delete "${quote(personal)}"`, 'SectionEnd',
  ]);
  const original = fs.readFileSync(legacyFixture);
  for (const scenario of ['same-directory', 'change-directory', 'changed-registration', 'failed-launch']) {
    await t.test(scenario, () => {
      fs.mkdirSync(installDir, { recursive: true });
      fs.writeFileSync(personal, 'unrelated user file');
      fs.writeFileSync(path.join(installDir, 'LIRA.exe'), 'old app');
      fs.writeFileSync(legacy, original);
      const bad = path.join(root, 'invalid-uninstaller.exe');
      fs.writeFileSync(bad, 'not executable');
      const executable = path.join(root, scenario + '.exe');
      const selected = scenario === 'change-directory' ? path.join(root, 'New LIRA') : installDir;
      fs.mkdirSync(selected, { recursive: true });
      compile(scenario, [
        `OutFile "${quote(executable)}"`,
        `!define PROJECT_DIR "${quote(path.dirname(buildDir))}"`, `!define BUILD_RESOURCES_DIR "${quote(fixtureBuildDir)}"`,
        `!define FIXTURE_REGISTERED "${quote(scenario === 'changed-registration' ? selected + '-changed' : installDir)}"`,
        `!define UNINSTALLER_OUT_FILE "${quote(scenario === 'failed-launch' ? bad : safe)}"`,
        '!define UNINSTALL_REGISTRY_KEY "fixture"', '!define INSTALL_REGISTRY_KEY "fixture"',
        'LangString uninstallFailed 1033 "Uninstall failed"',
        '!define UAC_IsInnerInstance "0 = 1"', '!define allowToChangeInstallationDirectory',
        'Var installMode', 'Var liraPreviousInstallDir', 'Var appExe',
        flags.build(),
        '!macro customUnInstallCheck', '${If} $R0 != 0', 'SetErrorLevel 2', 'Quit', '${EndIf}', '!macroend',
        installer.match(/!cd[^\r\n]+/)[0],
        '!include installUtil.nsh', customCheck,
        check,
        'Function liraWaitForAppExit', 'FunctionEnd',
        'Section', 'StrCpy $installMode CurrentUser',
        // Exercise the path helpers used by production initialization and caching.
        `Push '"${quote(legacy)}" /currentuser'`, 'Call GetInQuotes', 'Call GetFileParent', 'Pop $liraPreviousInstallDir',
        `StrCpy $INSTDIR "${quote(selected)}"`,
        `StrCpy $appExe "${quote(path.join(selected, 'LIRA.exe'))}"`, upgradeCalls, 'SectionEnd',
      ]);
      const result = spawnSync(executable, ['/S', '--updated'], { windowsHide: true, timeout: 15000 });
      const fails = scenario === 'changed-registration' || scenario === 'failed-launch';
      assert.equal(result.status, fails ? 2 : 0, String(result.error || scenario));
      assert.equal(fs.existsSync(calledLegacy), false, 'the destructive old uninstaller must never execute');
      assert.equal(fs.readFileSync(personal, 'utf8'), 'unrelated user file');
      assert.equal(fs.existsSync(path.join(installDir, 'LIRA.exe')), fails);
      if (fails) assert.deepEqual(fs.readFileSync(legacy), original, 'a failed launch must leave the old uninstaller intact');
    });
  }
});

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
  // Native NSIS plugins unpack beside each isolated fixture, not in shared TEMP.
  const nativeTemp = path.join(root, 'native-temp');
  fs.mkdirSync(nativeTemp);
  const nativeEnv = { ...process.env, TEMP: nativeTemp, TMP: nativeTemp };
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
    `StrCpy $perUserInstallationFolder "${quote(path.join(root, 'user'))}"`,
    `StrCpy $perMachineInstallationFolder "${quote(path.join(root, 'machine'))}"`,
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
      const run = spawnSync(executable, args, { windowsHide: true, timeout: 10000, env: nativeEnv });
      assert.equal(run.error, undefined, 'installer must finish without user interaction');
      assert.equal(run.status, status);
      assert.equal(fs.readFileSync(progress, 'utf8').trim(), visible ? '1' : '0');
      assert.equal(fs.existsSync(finish), showFinish);
      assert.equal(fs.existsSync(mode), false, 'current-user installs and updates skip install-scope selection');
      if (visible) assert.equal(fs.readFileSync(selection, 'utf8').trim(), args.includes('--machine') ? 'machine' : 'user');
      assert.deepEqual(fs.existsSync(launch) ? fs.readFileSync(launch, 'utf8').trim().split('\r\n') : [], launches);
    });
  }

  await t.test('production progress layout compiles and completes an update', async () => {
    const buildResources = path.resolve(__dirname, '../../build');
    const installer = fs.readFileSync(path.join(buildResources, 'installer.nsh'), 'utf8');
    const agreementPage = installer.match(/!macro licensePage\b[\s\S]*?!macroend/)[0];
    const messages = new NsisScriptGenerator();
    for (const file of ['messages.yml', 'assistedMessages.yml']) {
      await addCustomMessageFileInclude(file, { getTempFile: () => path.join(root, `${file}.nsh`) },
        messages, new LangConfigurator({ installerLanguages: ['zh_CN'] }));
    }
    // Use the actual custom agreement and directory hook: an MUI license fixture
    // would hide dependencies on symbols that the production page never defines.
    const layout = source
      .replace('Var launchLink\n', '')
      .replace('!insertmacro MUI_LANGUAGE "SimpChinese"', '!insertmacro MUI_LANGUAGE "SimpChinese"\n' + messages.build())
      .replace('!insertmacro PAGE_INSTALL_MODE', [
        `!define BUILD_RESOURCES_DIR "${quote(buildResources)}"`,
        '!define VERSION "test"',
        agreementPage,
        '!macro skipPageIfUpdated',
        '!macroend',
        `!include "${quote(path.join(buildResources, 'installer-directory.nsh'))}"`,
        '!insertmacro skipPageIfUpdated',
        '!insertmacro licensePage',
        '!insertmacro PAGE_INSTALL_MODE',
        '!insertmacro skipPageIfUpdated',
        '!insertmacro MUI_PAGE_DIRECTORY',
      ].join('\n'))
      .replace(/Function (?:fixtureBuilderStartApp|liraInitInstallerUi|liraShowInstallProgress|liraShowInstallMode|liraSkipUpdateFinish|liraShowInstallFinish)\b[\s\S]*?FunctionEnd\n/g, '') + [
        '',
        'Function liraSelectDefaultDirectory',
        'FunctionEnd',
        '!insertmacro liraInstallerUi',
      ].join('\n');
    fs.writeFileSync(script, layout);
    const build = spawnSync(compiler, ['/V2', '/WX', '-INPUTCHARSET', 'UTF8', script], {
      encoding: 'utf8', windowsHide: true, timeout: 30000,
    });
    assert.equal(build.error, undefined);
    assert.equal(build.status, 0, build.stdout + build.stderr);
    for (const file of [progress, finish, launch]) fs.rmSync(file, { force: true });
    const run = spawnSync(executable, ['/S', '--updated', '--force-run'], {
      windowsHide: true, timeout: 10000, env: nativeEnv,
    });
    assert.equal(run.error, undefined);
    assert.equal(run.status, 0);
    assert.equal(fs.readFileSync(progress, 'utf8').trim(), '1');
    assert.equal(fs.existsSync(finish), false);
    assert.deepEqual(fs.readFileSync(launch, 'utf8').trim().split('\r\n'), ['launch|--updated']);
  });
});
