'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { WESING_NATIVE_MONITOR_SOURCE } = require('../../src/music/wesing-native-monitor-source');
const { createScratchDirectory } = require('../helpers/scratch-directory');

test('WeSing native audio follows its sessions across output devices', { skip: process.platform !== 'win32' }, (t) => {
  const fixture = String.raw`
internal sealed class FakeAudioDevices : IMMDeviceEnumerator, IMMDeviceCollection {
  internal static FakeAudioDevice[] Devices;
  public int EnumAudioEndpoints(int flow, uint mask, out IMMDeviceCollection devices) {
    if (flow != 0 || mask != 1) throw new Exception("Only active render endpoints should be inspected");
    devices = this; return 0;
  }
  public int GetDefaultAudioEndpoint(int flow, int role, out IMMDevice device) { device = Devices[0]; return 0; }
  public int GetCount(out uint count) { count = (uint)Devices.Length; return 0; }
  public int Item(uint index, out IMMDevice device) { device = Devices[index]; return device == null ? -1 : 0; }
  public int GetDevice(string id, out IMMDevice device) { throw new NotSupportedException(); }
  public int RegisterEndpointNotificationCallback(IntPtr client) { throw new NotSupportedException(); }
  public int UnregisterEndpointNotificationCallback(IntPtr client) { throw new NotSupportedException(); }
}
internal sealed class FakeAudioDevice : IMMDevice {
  private readonly FakeAudioSessions sessions;
  internal bool Unavailable;
  internal FakeAudioDevice(params FakeAudioSession[] entries) { sessions = new FakeAudioSessions(entries); }
  public int Activate(ref Guid id, int context, IntPtr parameters, out object instance) {
    instance = sessions; return Unavailable ? -1 : 0;
  }
  public int OpenPropertyStore(int access, out IntPtr properties) { throw new NotSupportedException(); }
  public int GetId(out string id) { throw new NotSupportedException(); }
  public int GetState(out uint state) { throw new NotSupportedException(); }
}
internal sealed class FakeAudioSessions : IAudioSessionManager2, IAudioSessionEnumerator {
  private readonly FakeAudioSession[] entries;
  internal FakeAudioSessions(FakeAudioSession[] value) { entries = value; }
  public int GetSessionEnumerator(out IAudioSessionEnumerator sessions) { sessions = this; return 0; }
  public int GetCount(out int count) { count = entries.Length; return 0; }
  public int GetSession(int index, out IAudioSessionControl control) { control = entries[index]; return 0; }
  public int GetAudioSessionControl(ref Guid id, uint flags, out IAudioSessionControl control) { throw new NotSupportedException(); }
  public int GetSimpleAudioVolume(ref Guid id, uint flags, out IntPtr volume) { throw new NotSupportedException(); }
  public int RegisterSessionNotification(IntPtr notification) { throw new NotSupportedException(); }
  public int UnregisterSessionNotification(IntPtr notification) { throw new NotSupportedException(); }
  public int RegisterDuckNotification(string id, IntPtr notification) { throw new NotSupportedException(); }
  public int UnregisterDuckNotification(IntPtr notification) { throw new NotSupportedException(); }
}
internal sealed class FakeAudioSession : IAudioSessionControl, IAudioSessionControl2, IAudioMeterInformation {
  private readonly int processId;
  private readonly AudioSessionState state;
  private readonly float peak;
  internal bool MeterUnavailable;
  internal FakeAudioSession(int id, AudioSessionState value, float level) { processId = id; state = value; peak = level; }
  public int GetState(out AudioSessionState value) { value = state; return 0; }
  public int GetProcessId(out int value) { value = processId; return 0; }
  public int GetPeakValue(out float value) { value = peak; return MeterUnavailable ? -1 : 0; }
  public int GetDisplayName(out string name) { throw new NotSupportedException(); }
  public int SetDisplayName(string name, ref Guid context) { throw new NotSupportedException(); }
  public int GetIconPath(out string value) { throw new NotSupportedException(); }
  public int SetIconPath(string value, ref Guid context) { throw new NotSupportedException(); }
  public int GetGroupingParam(out Guid id) { throw new NotSupportedException(); }
  public int SetGroupingParam(ref Guid id, ref Guid context) { throw new NotSupportedException(); }
  public int RegisterAudioSessionNotification(IntPtr events) { throw new NotSupportedException(); }
  public int UnregisterAudioSessionNotification(IntPtr events) { throw new NotSupportedException(); }
  public int GetSessionIdentifier(out string id) { throw new NotSupportedException(); }
  public int GetSessionInstanceIdentifier(out string id) { throw new NotSupportedException(); }
  public int IsSystemSoundsSession() { throw new NotSupportedException(); }
  public int SetDuckingPreference(bool optOut) { throw new NotSupportedException(); }
  public int GetMeteringChannelCount(out int count) { throw new NotSupportedException(); }
  public int GetChannelsPeakValues(int count, float[] peaks) { throw new NotSupportedException(); }
  public int QueryHardwareSupport(out int mask) { throw new NotSupportedException(); }
}
public static class WeSingAudioFixture {
  private static void Check(int state, float peak, string message, params FakeAudioDevice[] devices) {
    FakeAudioDevices.Devices = devices;
    var sample = WeSingNativeMonitor.GetAudioSessionSnapshot(new[] { 42 });
    if (sample.State != state || Math.Abs(sample.Peak - peak) > 0.00001f) {
      throw new Exception(message + ": state=" + sample.State + ", peak=" + sample.Peak);
    }
  }
  public static void Run() {
    var stopped = new FakeAudioDevice(new FakeAudioSession(42, AudioSessionState.Inactive, 0f));
    var playing = new FakeAudioDevice(new FakeAudioSession(42, AudioSessionState.Active, 0.2f));
    var unrelated = new FakeAudioDevice(new FakeAudioSession(99, AudioSessionState.Active, 0.9f));
    Check(1, 0.2f, "Non-default playback must override an inactive default session", stopped, playing, unrelated);
    var sample = WeSingNativeMonitor.GetAudioSessionSnapshot(new[] { 42 });
    if (sample.OutputDeviceCount != 3 || sample.SessionCount != 2 || sample.ActiveSessionCount != 1) throw new Exception("Diagnostic counts must exclude other applications");
    Check(1, 0.2f, "A later inactive device must not clear active playback", playing, stopped);
    Check(0, 0f, "Other applications must not prevent a WeSing pause", stopped, unrelated);
    Check(-1, 0f, "No matching session must remain unknown", unrelated);
    Check(1, 0.2f, "An unplugged device must not hide later playback", null, new FakeAudioDevice { Unavailable = true }, playing);
    Check(1, 0.2f, "A later failed device must preserve playback", playing, new FakeAudioDevice { Unavailable = true });
    Check(1, 0.6f, "Matching devices must contribute their peak", playing, new FakeAudioDevice(new FakeAudioSession(42, AudioSessionState.Active, 0.6f)));
    Check(1, 0f, "A missing meter must not invent audible audio", new FakeAudioDevice(new FakeAudioSession(42, AudioSessionState.Active, 0.6f) { MeterUnavailable = true }));
    Check(-1, 0f, "No output devices must remain unknown");
    Console.WriteLine("native audio fixture passed");
  }
}
`;
  // Replace only COM activation; execute the production traversal and session filtering.
  assert.equal(WESING_NATIVE_MONITOR_SOURCE.split('new MMDeviceEnumeratorComObject()').length, 2);
  const source = WESING_NATIVE_MONITOR_SOURCE.replace('new MMDeviceEnumeratorComObject()', 'new FakeAudioDevices()') + fixture;
  const scriptPath = path.join(createScratchDirectory('wesing-native-audio-', t), 'audio.ps1');
  fs.writeFileSync(scriptPath, "\ufeff$ErrorActionPreference = 'Stop'\nAdd-Type -AssemblyName Accessibility\nAdd-Type -TypeDefinition @'\n" +
    source + "\n'@ -ReferencedAssemblies Accessibility\n[WeSingAudioFixture]::Run()\n");
  const result = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', scriptPath], {
    windowsHide: true, encoding: 'utf8', timeout: 15000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /native audio fixture passed/);
});
