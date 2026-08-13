# WeSing Lyric Clock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the Electron lyric clock aligned with the current WeSing song across loading, playback, pause/recording stop, replay, and delayed QRC availability.

**Architecture:** Keep WeSing QRC as the lyric-content authority and UI Automation progress as the preferred clock authority. Locate WeSing's hidden playback window with Win32 enumeration, add the WeSing render-session state as the playback gate when current WeSing no longer exposes progress text, and watch QRC changes so late lyrics are applied at the already-running authoritative position.

**Tech Stack:** Node.js 24 CommonJS, PowerShell 5.1, Windows UI Automation, Windows Core Audio/WASAPI COM, `node:test`.

## Global Constraints

- Do not add npm dependencies or ship the reference project's .NET runtime.
- Preserve current online-lyrics fallback and the `-1500ms` to `1500ms` lyric offset.
- Treat audio-session `Active`/`Inactive` as a playback gate, not as a source of lyric content.
- Prefer sampled `MM:SS | MM:SS` progress whenever current or older WeSing versions expose it.
- Stop all child processes, file watchers, and debounce timers when capture is disabled or the server shuts down.
- Run `npm run check` and `npm test` before completion.

---

### Task 1: Capture all three playback signals

**Files:**
- Modify: `src/music/wesing-capture.js`
- Test: `test/wesing-capture.test.js`

**Interfaces:**
- Consumes: the existing `createPowerShellWeSingMonitor(onSample)` callback.
- Produces: samples shaped as `{ detected, title, currentSec, totalSec, loading, audioActive }`, where `audioActive` is `true`, `false`, or absent when Core Audio cannot be queried.

- [ ] **Step 1: Write failing monitor-script assertions**

```js
test('WeSing monitor finds hidden playback windows and reports audio activity', () => {
  const script = buildPowerShellMonitorScript();
  assert.match(script, /EnumWindows/);
  assert.match(script, /IAudioSessionManager2/);
  assert.match(script, /audioActive/);
  assert.match(script, /AutomationElement\]::FromHandle/);
});
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run: `node --test test/wesing-capture.test.js`

Expected: FAIL because the current script only searches UI Automation desktop children and has no audio-session field.

- [ ] **Step 3: Implement native window and Core Audio sampling**

Embed minimal C# interop in the generated PowerShell monitor:

```powershell
$window = [WeSingNativeMonitor]::FindPlaybackWindow($processIds)
$sample.title = $window.Title
$sample.audioActive = [WeSingNativeMonitor]::IsAudioSessionActive($processIds)
$playWindow = [System.Windows.Automation.AutomationElement]::FromHandle($window.Handle)
```

The native helper must enumerate hidden top-level windows, activate `IAudioSessionManager2` on the default multimedia render endpoint, enumerate sessions, select a WeSing PID through `IAudioSessionControl2.GetProcessId`, and return whether any matching session has `AudioSessionStateActive`.

- [ ] **Step 4: Run the focused monitor test**

Run: `node --test test/wesing-capture.test.js`

Expected: PASS.

### Task 2: Make one state machine own the lyric clock

**Files:**
- Modify: `src/music/wesing-capture.js`
- Test: `test/wesing-capture-recording-mode.test.js`

**Interfaces:**
- Consumes: `{ loading, audioActive, currentSec }` monitor samples from Task 1.
- Produces: `state.playing`, `state.waitingForPlayback`, `state.currentMs`, and `state.lyricState` with no independent timer path.

- [ ] **Step 1: Add failing regression cases**

```js
onSample({ detected: true, title, currentSec: -1, totalSec: -1, audioActive: false });
assert.equal(capture.getStatus().playing, false);
assert.equal(capture.getStatus().currentMs, 0);

currentTime = 1500;
onSample({ detected: true, title, currentSec: -1, totalSec: -1, audioActive: true });
assert.equal(capture.getStatus().playing, true);

currentTime = 2500;
onSample({ detected: true, title, currentSec: -1, totalSec: -1, audioActive: false });
const stoppedAt = capture.getStatus().currentMs;
currentTime = 5000;
onSample({ detected: true, title, currentSec: -1, totalSec: -1, audioActive: false });
assert.equal(capture.getStatus().currentMs, stoppedAt);
```

- [ ] **Step 2: Run and confirm the new cases fail**

Run: `node --test test/wesing-capture-recording-mode.test.js`

Expected: FAIL because unavailable progress currently always pauses and cannot start from audio activity.

- [ ] **Step 3: Implement the precedence rules**

Apply one ordered decision table in `handleMonitorSample()`:

```text
no client/title      -> pause
loading              -> reset to 0 and pause
audioActive=false    -> pause immediately
valid progress       -> calibrate to sampled progress and use progress changes
audioActive=true     -> start/resume the local clock when progress is unavailable
no usable authority  -> pause conservatively
```

On a new title, keep time at zero until either valid progress or `audioActive=true`. A valid backward progress correction must reset the clock to the sampled value. When audio changes to inactive, freeze the interpolated position once and publish `playing=false` immediately.

- [ ] **Step 4: Run recording-mode and capture tests**

Run: `node --test test/wesing-capture-recording-mode.test.js test/wesing-capture.test.js`

Expected: PASS.

### Task 3: Refresh lyrics after QRC becomes stable

**Files:**
- Modify: `src/music/wesing-capture.js`
- Test: `test/wesing-capture.test.js`

**Interfaces:**
- Consumes: the configured `WeSingCache` directory and current track title.
- Produces: a debounced refresh after `.qrc` create/modify events without resetting the playback clock.

- [ ] **Step 1: Add a failing watcher lifecycle test**

Inject a fake `watchFactory`, emit a `.qrc` event, advance the injected debounce timer, and assert that the current track is reloaded. Assert watcher close on `setActive(false)`, cache-path change, and `stop()`.

- [ ] **Step 2: Run and confirm it fails**

Run: `node --test test/wesing-capture.test.js`

Expected: FAIL because no QRC watcher exists.

- [ ] **Step 3: Add a scoped recursive watcher**

Watch only the selected `WeSingCache` root. Debounce `.qrc` create/modify events for 2000 ms, then call `refreshLyrics(state.trackTitle)` without resetting `state.currentMs`. If the file is still unreadable, leave it unmarked so a later modify event retries. Close and replace the watcher when the configured path changes.

- [ ] **Step 4: Run the focused test**

Run: `node --test test/wesing-capture.test.js`

Expected: PASS.

### Task 4: Verify runtime behavior and repository health

**Files:**
- Modify only files already listed if verification exposes a regression.

**Interfaces:**
- Consumes: completed Tasks 1-3.
- Produces: a verified implementation with no lingering monitor/watcher process.

- [ ] **Step 1: Run syntax validation**

Run: `npm run check`

Expected: PASS.

- [ ] **Step 2: Run the full test suite**

Run: `npm test`

Expected: PASS.

- [ ] **Step 3: Perform a live read-only monitor check**

With WeSing open, confirm samples have the hidden window title. During loading expect `audioActive=false`; during playback expect `audioActive=true`; after stop expect `audioActive=false`. If UI Automation exposes progress on another WeSing version, confirm `currentSec` remains present and takes precedence.

- [ ] **Step 4: Review the final diff**

Run: `git diff --check` and `git diff -- src/music/wesing-capture.js test/wesing-capture.test.js test/wesing-capture-recording-mode.test.js docs/superpowers/plans/2026-08-13-wesing-lyric-clock.md`

Expected: no whitespace errors and every changed line maps to the WeSing synchronization requirements.
