'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const test = require('node:test');
const { createNeteaseClientMonitor, buildNeteaseClientMonitorScript } = require('../../src/music/netease-client-monitor');
const { createScratchDirectory } = require('../helpers/scratch-directory');

function fixture(t, options = {}) {
  const samples = [];
  const children = [];
  const monitor = createNeteaseClientMonitor((sample) => samples.push(sample), {
    readTrack: () => null,
    spawn(command, args, settings) {
      assert.equal(command, 'powershell.exe');
      assert.equal(settings.windowsHide, true);
      assert.ok(args.includes('-NonInteractive'));
      assert.ok(args.join(' ').length < 32700, 'Encoded helper must fit the Windows command-line limit');
      assert.match(Buffer.from(args.at(-1), 'base64').toString('utf16le'), /ScriptBlock.*ReadToEnd/);
      assert.deepEqual(settings.stdio, ['pipe', 'pipe', 'pipe']);
      const child = Object.assign(new EventEmitter(), {
        stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), killed: false,
        kill() { this.killed = true; },
      });
      children.push(child);
      return child;
    },
    ...options,
  });
  t.after(() => monitor.stop());
  return { monitor, children, samples };
}

test('NetEase monitor parses split rows, enriches matched IDs and ignores retired helpers', async (t) => {
  let reads = 0;
  const { monitor, children, samples } = fixture(t, { readTrack(sample) {
    reads++;
    assert.equal(sample.title, 'Song');
    return { title: 'Song', artists: ['Artist'], sourceTrackId: '123' };
  } });
  monitor.start(); monitor.start();
  assert.equal(children.length, 1);
  assert.equal(children[0].stdin.read().toString('utf8'), buildNeteaseClientMonitorScript());
  children[0].stdout.write('{"detected":');
  children[0].stdout.write('true,"windowTitle":"Song - Artist"}\n');
  await new Promise(setImmediate);
  children[0].stdout.write('{"detected":true,"windowTitle":"Song - Artist"}\n');
  await new Promise(setImmediate);
  children[0].stdout.write('invalid\n');
  assert.equal(samples[0].sourceTrackId, '123');
  assert.deepEqual(samples[0].artists, ['Artist']);
  assert.equal(reads, 1);
  assert.deepEqual(samples.at(-1), { error: true });
  monitor.stop(); monitor.start();
  children[0].stdout.write('{"detected":false}\n'); children[0].emit('exit');
  assert.equal(samples.length, 3);
  assert.equal(children[0].killed, true);
  monitor.stop();
  assert.equal(children[1].killed, true);
});

test('NetEase rejects a native clock paired with the previous local song identity', async (t) => {
  let time = 1000, reads = 0;
  const { monitor, children, samples } = fixture(t, { now: () => time,
    readTrack: () => ({ title: 'Previous', artists: ['Artist'], sourceTrackId: ++reads === 1 ? '123' : '456' }) });
  monitor.start();
  const row = JSON.stringify({ detected: true, windowTitle: 'Previous - Artist',
    clockSource: 'native', playbackStatus: 'Playing', sourceTrackId: '456', positionMs: 1500 }) + '\n';
  children[0].stdout.write(row);
  await new Promise(setImmediate);
  assert.deepEqual(samples.at(-1), { detected: true, playbackStatus: 'Changing', clockSource: 'native' });
  time += 1000;
  children[0].stdout.write(row);
  await new Promise(setImmediate);
  assert.equal(samples.at(-1).sourceTrackId, '456');
  assert.equal(samples.at(-1).positionMs, 1500);
});

test('NetEase drops history reads completed after a track change or helper shutdown', async (t) => {
  const pending = new Map();
  const { monitor, children, samples } = fixture(t, { readTrack({ title }) {
    const request = Promise.withResolvers();
    pending.set(title, request);
    return request.promise;
  } });
  monitor.start();
  const send = title => children[0].stdout.write(JSON.stringify({ detected: true, windowTitle: `${title} - Artist` }) + '\n');
  send('Old');
  send('Active');
  await new Promise(setImmediate);
  pending.get('Active').resolve(null);
  pending.get('Old').resolve(null);
  await new Promise(setImmediate);
  assert.deepEqual(samples.map(s => s.title), ['Active']);
  send('Last');
  await new Promise(setImmediate);
  monitor.stop();
  pending.get('Last').resolve(null);
  await new Promise(setImmediate);
  assert.equal(samples.length, 1);
});

test('NetEase helper input failures retire the child and cannot restart after stop', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { monitor, children, samples } = fixture(t);
  monitor.start();
  children[0].stdin.emit('error', new Error('EPIPE'));
  assert.equal(children[0].killed, true);
  assert.deepEqual(samples.at(-1), { error: true });
  monitor.stop(); t.mock.timers.tick(100000);
  assert.equal(children.length, 1);
});

test('NetEase UIA hangs are bounded and failed helper restarts have a finite budget', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { monitor, children, samples } = fixture(t);
  monitor.start();
  t.mock.timers.tick(15000);
  assert.equal(children[0].killed, true);
  assert.deepEqual(samples.at(-1), { error: true });
  t.mock.timers.tick(500);
  assert.equal(children.length, 2);
  children[1].emit('exit'); t.mock.timers.tick(1000);
  children[2].emit('exit'); t.mock.timers.tick(2000);
  children[3].emit('exit'); t.mock.timers.tick(100000);
  assert.equal(children.length, 4);
  monitor.stop(); monitor.start();
  assert.equal(children.length, 5, 'manual refresh resets the exhausted restart budget');
  monitor.stop(); t.mock.timers.tick(100000);
  assert.equal(children.length, 5);
});

test('NetEase monitor handles a synchronous launch failure and cancels queued retries on stop', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let launches = 0;
  const { monitor, samples } = fixture(t, { spawn() { launches++; throw new Error('unavailable'); } });
  monitor.start();
  assert.deepEqual(samples, [{ error: true }]);
  t.mock.timers.tick(500);
  assert.equal(launches, 2);
  monitor.stop(); t.mock.timers.tick(100000);
  assert.equal(launches, 2);
});

test('NetEase Windows helper reads and refreshes synthetic MSAA controls without a real player', { skip: process.platform !== 'win32' }, (t) => {
  const script = buildNeteaseClientMonitorScript().replace('while ($true)', 'while ($false)') + String.raw`
Add-Type -AssemblyName System.Windows.Forms
$form = [System.Windows.Forms.Form]::new()
$form.ShowInTaskbar = $false
$form.Opacity = 0
$time = [System.Windows.Forms.Label]::new()
$time.Text = '01:02 / 03:20'
$time.Top = 20
$button = [System.Windows.Forms.Button]::new()
$button.Text = 'play'
$button.Top = 50
$form.Controls.Add($time)
$form.Controls.Add($button)
try {
  $form.Show()
  [System.Windows.Forms.Application]::DoEvents()
  $reader = [NeteaseAccessiblePlayer]::new()
  $reader.Scan($form.Handle)
  if ($reader.Progress.Name -ne '01:02 / 03:20' -or $reader.State.Name -ne 'play') { throw 'Missing player controls' }
  $time.Text = '01:03 / 03:20'
  $button.Text = 'pause'
  if ($reader.Progress.Name -ne '01:03 / 03:20' -or $reader.State.Name -ne 'pause') { throw 'Cached controls did not update' }
  $reader.Scan($form.Handle)
  if ($reader.Progress.Name -ne '01:03 / 03:20') { throw 'Rescan lost the clock' }
  $reader.Reset()
  if ($null -ne $reader.Progress -or $null -ne $reader.State) { throw 'Track reset retained old controls' }
} finally { $form.Dispose() }
`;
  const scriptPath = path.join(createScratchDirectory('netease-accessibility-', t), 'synthetic-player.ps1');
  fs.writeFileSync(scriptPath, '\ufeff' + script);
  const result = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', scriptPath], {
    windowsHide: true, encoding: 'utf8', timeout: 15000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
});

test('NetEase keeps a progress-only window on the slow rescan and picks up a late playback button', { skip: process.platform !== 'win32' }, (t) => {
  const script = buildNeteaseClientMonitorScript()
    .replace('while ($true)', String.raw`
$manager = $null
$fixtureWindow = @{ Handle = [IntPtr]::Zero; ProcessId = 0; Title = 'fixture' }
$progress = [pscustomobject]@{ Current = @{ Name = ''; BoundingRectangle = @{ Top = 20 } } }
$button = [pscustomobject]@{ Current = @{ Name = 'Pause'; BoundingRectangle = @{ Top = 20 }; ControlType = [System.Windows.Automation.ControlType]::Button } }
$scans = 0
for ($i = 0; $i -le 68; $i++)`)
    .replace('$sampledAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()', "$sampledAt = 1000 + 500 * $i\n$progress.Current.Name = '00:{0:00} / 03:20' -f [Math]::Floor($i / 2)")
    .replace('Get-Process -Name cloudmusic -ErrorAction SilentlyContinue', '[Diagnostics.Process]::GetCurrentProcess()')
    .replace('[NeteasePlaybackWindows]::Find([int[]]@($processes | ForEach-Object { [int]$_.Id }))', '$fixtureWindow')
    .replace('$nativePlayer.Read($window.ProcessId)', '$null')
    .replace('$root = [System.Windows.Automation.AutomationElement]::FromHandle($window.Handle)', '$scans++')
    .replace('$controls = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $controlCondition)',
      '$controls = [System.Collections.ArrayList]::new(); [void]$controls.Add($progress); if ($i -gt 16) { [void]$controls.Add($button) }')
    .replace('[NeteasePlaybackWindows]::ReadTitle($window.Handle)', '$window.Title')
    .replace('Start-Sleep -Milliseconds 500', '');
  const file = path.join(createScratchDirectory('netease-rescan-', t), 'sample.ps1');
  fs.writeFileSync(file, '\ufeff' + script + '\nWrite-Output $scans\n');
  const result = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', file],
    { windowsHide: true, encoding: 'utf8', timeout: 15000 });
  assert.equal(result.status, 0, result.stderr);
  const rows = result.stdout.trim().split(/\r?\n/);
  assert.equal(Number(rows.pop()), 2);
  const samples = rows.map(row => JSON.parse(row));
  assert.ok(samples[50].positionMs > samples[6].positionMs);
  assert.equal(samples[50].playbackStatus, 'Unknown');
  assert.equal(samples.at(-1).playbackStatus, 'Playing');
});
