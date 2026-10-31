using System.Diagnostics;
using System.Collections.Concurrent;
using System.Runtime.InteropServices;
using NAudio.CoreAudioApi;
using NAudio.CoreAudioApi.Interfaces;

internal record AudioApp(int Pid, string Name, string Title, bool Playing, string Device, string DeviceId, bool Active)
{
  public string[] ActiveEndpoints { get; init; } = Array.Empty<string>();
  public override string ToString() => $"{Name} · {Title}";
}

internal record AudioInputDevice(string Id, string Name, int Channels, int SampleRate, int BitsPerSample);

internal static class AudioDevices
{
  public static List<AudioApp> Apps(AudioDeviceNames? names = null, int? playbackProcessId = null)
  {
    var result = new List<AudioApp>();
    using var enumerator = new MMDeviceEnumerator();
    foreach (var device in enumerator.EnumerateAudioEndPoints(DataFlow.Render, DeviceState.Active))
    {
      using (device)
      {
        string deviceId = device.ID;
        string? deviceName = null;
        var sessions = device.AudioSessionManager.Sessions;
        for (int i = 0; i < sessions.Count; i++)
        {
          using var session = sessions[i];
          int pid = (int)session.GetProcessID;
          if (pid <= 0 || pid == Environment.ProcessId) continue;
          try
          {
            AudioApp? previous = null;
            foreach (var app in result)
              if (app.Pid == pid) { previous = app; break; }
            using var process = previous == null ? Process.GetProcessById(pid) : null;
            var name = previous?.Name ?? process!.ProcessName;
            if (pid == playbackProcessId) name = "LIRA";
            else if (name is "LiraAudioDemo" or "LiraAudioAssistant") continue;
            var title = previous?.Title ?? process!.MainWindowTitle;
            bool playing = session.AudioMeterInformation.MasterPeakValue > 0.0001f;
            deviceName ??= names?.Get(deviceId, () => device.FriendlyName) ?? device.FriendlyName;
            result.Add(new AudioApp(pid, name, string.IsNullOrWhiteSpace(title) ? $"PID {pid}" : title, playing, deviceName, deviceId,
              session.State == AudioSessionState.AudioSessionStateActive));
          }
          catch (ArgumentException) { }
        }
      }
    }
    return result.GroupBy(a => a.Pid).Select(g => g.OrderByDescending(a => a.Playing).First() with {
      ActiveEndpoints = g.Where(a => a.Active).Select(a => a.DeviceId).Distinct().ToArray(),
    }).OrderByDescending(a => a.Playing).ToList();
  }

  public static bool IsMusicPlayer(AudioApp app) => IsMusicPlayer(app.Name);
  public static bool IsMusicPlayer(string name) => name.Equals("QQMusic", StringComparison.OrdinalIgnoreCase)
    || name.Equals("cloudmusic", StringComparison.OrdinalIgnoreCase)
    || name.Contains("WeSing", StringComparison.OrdinalIgnoreCase)
    || name.Equals("LIRA", StringComparison.OrdinalIgnoreCase);

  public static List<(string Id, string Name)> Outputs(AudioDeviceNames? names = null)
    => Endpoints(DataFlow.Render, names);

  public static List<(string Id, string Name)> Inputs(AudioDeviceNames? names = null)
    => Endpoints(DataFlow.Capture, names);

  static List<(string Id, string Name)> Endpoints(DataFlow flow, AudioDeviceNames? names)
  {
    using var enumerator = new MMDeviceEnumerator();
    return enumerator.EnumerateAudioEndPoints(flow, DeviceState.Active).Select(device => {
      using (device)
      {
        string id = device.ID;
        return (id, names?.Get(id, () => device.FriendlyName) ?? device.FriendlyName);
      }
    }).ToList();
  }

  public static MMDevice OpenEndpoint(string id, DataFlow flow)
  {
    using var enumerator = new MMDeviceEnumerator();
    var device = id.Length == 0 ? enumerator.GetDefaultAudioEndpoint(flow, Role.Multimedia) : enumerator.GetDevice(id);
    if (device.State == DeviceState.Active && device.DataFlow == flow) return device;
    device.Dispose();
    throw new InvalidOperationException(flow == DataFlow.Render
      ? "输出设备不可用，请检查连接后重新选择。" : "输入设备不可用，请检查连接后重新选择。");
  }

  public static AudioInputDevice DescribeInput(string id, bool loopback)
  {
    using var device = OpenEndpoint(id, loopback ? DataFlow.Render : DataFlow.Capture);
    var format = device.AudioClient.MixFormat;
    return new(device.ID, device.FriendlyName, format.Channels, format.SampleRate, format.BitsPerSample);
  }

  public static bool IsIsolationDevice(string name) => name.Contains("VB-Audio", StringComparison.OrdinalIgnoreCase)
    && name.Contains("CABLE", StringComparison.OrdinalIgnoreCase)
    || name.Contains("OMEN Cam & Voice", StringComparison.OrdinalIgnoreCase);

  public static string DefaultOutputId()
  {
    using var enumerator = new MMDeviceEnumerator();
    using var device = enumerator.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia);
    return device.ID;
  }

  public static async Task<string> ResolveOutput(string selectedId, int? pid, CancellationToken cancellation)
  {
    cancellation.ThrowIfCancellationRequested();
    if (selectedId.Length > 0) return selectedId;
    if (!pid.HasValue) return DefaultOutputId();
    using var process = Process.GetProcessById(pid.Value);
    while (!process.HasExited)
    {
      cancellation.ThrowIfCancellationRequested();
      // Read the live stream before isolation changes the player's endpoint.
      // Windows preferences alone miss devices selected inside the player.
      string[] endpoints = SessionEndpoints(pid.Value);
      if (endpoints.Length == 1) return endpoints[0];
      if (endpoints.Length > 1) throw new InvalidOperationException("播放器同时向多个设备输出，请手动选择最终输出后再开始。");
      await Task.Delay(400, cancellation);
    }
    throw new InvalidOperationException("播放器已退出，无法确认原来的输出设备。");
  }

  public static bool IsMuted(string endpointId)
  {
    using var enumerator = new MMDeviceEnumerator();
    using var device = enumerator.GetDevice(endpointId);
    return device.AudioEndpointVolume.Mute;
  }

  public static string[] SessionEndpoints(int pid)
  {
    var found = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
    using var enumerator = new MMDeviceEnumerator();
    foreach (var device in enumerator.EnumerateAudioEndPoints(DataFlow.Render, DeviceState.Active))
    {
      using (device)
      {
        var sessions = device.AudioSessionManager.Sessions;
        for (int i = 0; i < sessions.Count; i++)
        {
          using var session = sessions[i];
          if (session.GetProcessID == pid && session.State == AudioSessionState.AudioSessionStateActive)
          {
            found.Add(device.ID);
            break;
          }
        }
      }
    }
    return found.ToArray();
  }

  public static async Task<bool> WaitForIsolation(int pid, string endpointId, CancellationToken cancellation)
  {
    using var process = Process.GetProcessById(pid);
    for (int attempt = 0; attempt < 12;)
    {
      await Task.Delay(400, cancellation);
      if (process.HasExited) return false;
      string[] endpoints = SessionEndpoints(pid);
      // A paused player can release every stream. Wait for playback without
      // spending the device-migration timeout; Stop still cancels and restores.
      if (endpoints.Length == 0) continue;
      if (endpoints.All(id => id == endpointId)) return true;
      attempt++;
    }
    return false;
  }

}

internal sealed class AudioDeviceNames : IMMNotificationClient, IDisposable
{
  readonly ConcurrentDictionary<string, Lazy<string>> names = new(StringComparer.OrdinalIgnoreCase);
  readonly MMDeviceEnumerator enumerator = new();
  bool disposed;

  public AudioDeviceNames()
  {
    try { Marshal.ThrowExceptionForHR(enumerator.RegisterEndpointNotificationCallback(this)); }
    catch { enumerator.Dispose(); throw; }
  }

  public string Get(string id, Func<string> readName)
  {
    // Publish the entry before reading a slow property so a notification during
    // that read can invalidate it instead of leaving a stale value in the cache.
    var name = names.GetOrAdd(id, _ => new Lazy<string>(readName));
    try { return name.Value; }
    catch { names.TryRemove(id, out _); throw; }
  }

  public void Clear() => names.Clear();
  public void OnDeviceStateChanged(string id, DeviceState state) => names.TryRemove(id, out _);
  public void OnDeviceAdded(string id) => names.TryRemove(id, out _);
  public void OnDeviceRemoved(string id) => names.TryRemove(id, out _);
  public void OnPropertyValueChanged(string id, PropertyKey key) => names.TryRemove(id, out _);
  public void OnDefaultDeviceChanged(DataFlow flow, Role role, string id) { }

  public void Dispose()
  {
    if (disposed) return;
    disposed = true;
    try { Marshal.ThrowExceptionForHR(enumerator.UnregisterEndpointNotificationCallback(this)); }
    finally { enumerator.Dispose(); names.Clear(); }
  }
}
