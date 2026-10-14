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

test('NetEase monitor parses split rows, enriches matched IDs and ignores retired helpers', (t) => {
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
  children[0].stdout.write('{"detected":true,"windowTitle":"Song - Artist"}\ninvalid\n');
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

test('NetEase rejects a native clock paired with the previous local song identity', (t) => {
  const { monitor, children, samples } = fixture(t, { readTrack: () => ({ title: 'Previous', artists: ['Artist'], sourceTrackId: '123' }) });
  monitor.start();
  children[0].stdout.write(JSON.stringify({ detected: true, windowTitle: 'Previous - Artist',
    clockSource: 'native', playbackStatus: 'Playing', sourceTrackId: '456', positionMs: 1500 }) + '\n');
  assert.deepEqual(samples.at(-1), { detected: true, playbackStatus: 'Changing', clockSource: 'native' });
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
