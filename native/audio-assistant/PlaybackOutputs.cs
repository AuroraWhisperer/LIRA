using System.Runtime.InteropServices;
using NAudio.CoreAudioApi;
using NAudio.Wave;
using NAudio.Wave.SampleProviders;

internal sealed record PlaybackOutput(string DeviceId, string Name, string Backend, string EndpointId);

internal static class PlaybackOutputs
{
  static readonly string[] Backends = { "wasapi", "directsound", "waveout" };
  static readonly Dictionary<string, List<PlaybackOutput>> AsioPorts = new();
  static string Label(string backend) => backend switch { "wasapi" => "WASAPI", "directsound" => "DirectSound", _ => "WaveOut" };

  public static List<PlaybackOutput> Enumerate()
  {
    var endpoints = AudioDevices.Outputs();
    var directSound = DirectSoundOut.Devices.Select(device => device.ModuleName).ToHashSet(StringComparer.OrdinalIgnoreCase);
    var waveOut = WaveOutEndpoints();
    var result = new List<PlaybackOutput>();
    foreach (string backend in Backends)
    {
      var available = new List<PlaybackOutput>();
      foreach (var endpoint in endpoints)
      {
        if (backend == "directsound" && !directSound.Contains(endpoint.Id)) continue;
        if (backend == "waveout" && !waveOut.ContainsKey(endpoint.Id)) continue;
        available.Add(new($"{backend}:{endpoint.Id}", $"{Label(backend)}：{endpoint.Name}", backend, endpoint.Id));
      }
      if (available.Count == 0) continue;
      result.Add(new($"{backend}:default", $"{Label(backend)}：系统默认输出", backend, ""));
      result.AddRange(available);
    }
    foreach (string driver in AsioOut.GetDriverNames())
    {
      if (AsioPorts.TryGetValue(driver, out var ports)) result.AddRange(ports);
      else result.Add(new($"asio:{Uri.EscapeDataString(driver)}", $"ASIO：{driver}（驱动，连接待检查）", "asio", ""));
    }
    return result;
  }

  public static (string Backend, string EndpointId) Resolve(string id)
  {
    int separator = id.IndexOf(':');
    if (separator < 0 || !Backends.Append("asio").Contains(id[..separator]))
      throw new ArgumentException("输出方式无效，请重新选择输出设备。");
    string endpoint = id[(separator + 1)..];
    if (id[..separator] == "asio")
    {
      var (driver, _) = ParseAsio(endpoint);
      if (!AsioOut.GetDriverNames().Contains(driver)) throw new InvalidOperationException("ASIO 驱动不可用，请安装声卡厂商驱动。");
      return ("asio", endpoint);
    }
    if (endpoint == "default") endpoint = AudioDevices.DefaultOutputId();
    using var device = AudioDevices.OpenEndpoint(endpoint, DataFlow.Render);
    return (id[..separator], device.ID);
  }

  public static IWavePlayer Create(string backend, string endpointId, IWaveProvider source)
  {
    IWavePlayer? player = null;
    try
    {
      if (backend == "asio")
      {
        var (driver, offset) = ParseAsio(endpointId);
        var asio = new AsioOut(driver);
        player = asio;
        int count = asio.DriverOutputChannelCount;
        if (offset >= count) throw new InvalidOperationException("所选 ASIO 输出声道不可用，请重新选择。");
        var ports = Enumerable.Range(0, count).Where(channel => channel % 2 == 0).Select(channel =>
          new PlaybackOutput($"asio:{Uri.EscapeDataString(driver)}{(channel == 0 ? "" : $"|{channel}")}",
            $"ASIO：{driver} · {asio.AsioOutputChannelName(channel)}{(channel + 1 < count ? $" / {asio.AsioOutputChannelName(channel + 1)}" : "")}",
            "asio", "")).ToList();
        asio.ChannelOffset = offset;
        ISampleProvider samples = source.ToSampleProvider();
        if (offset + 1 == count) samples = new StereoToMonoSampleProvider(samples);
        if (!asio.IsSampleRateSupported(samples.WaveFormat.SampleRate))
        {
          int rate = new[] { 48000, 44100, 96000, 88200, 192000 }.FirstOrDefault(asio.IsSampleRateSupported);
          if (rate == 0) throw new InvalidOperationException("ASIO 驱动不支持可用的播放格式，请选择其他输出方式。");
          samples = new WdlResamplingSampleProvider(samples, rate);
        }
        player.Init(samples.ToWaveProvider());
        AsioPorts[driver] = ports;
        return player;
      }
      using var device = AudioDevices.OpenEndpoint(endpointId, DataFlow.Render);
      player = backend switch {
        "wasapi" => new WasapiOut(device, AudioClientShareMode.Shared, true, 80),
        "directsound" => new DirectSoundPlayer(Guid.Parse(device.Properties[PropertyKeys.PKEY_AudioEndpoint_GUID].Value.ToString()!)),
        "waveout" => new WaveOutEvent { DeviceNumber = WaveOutEndpoints().TryGetValue(device.ID, out int index)
          ? index : throw new InvalidOperationException("所选 WaveOut 设备已断开，请刷新设备。"), DesiredLatency = 100 },
        _ => throw new ArgumentException("输出方式无效，请重新选择输出设备。"),
      };
      player.Init(source);
      return player;
    }
    catch { player?.Dispose(); throw; }
  }

  // NAudio DirectSound stops on its playback thread. Detach its source before the
  // caller disposes DSP/file resources, including a read already in progress.
  sealed class DirectSoundPlayer(Guid device) : IWavePlayer, IWaveProvider
  {
    readonly DirectSoundOut player = new(device, 100);
    readonly object gate = new();
    IWaveProvider? source;
    public WaveFormat WaveFormat { get; private set; } = null!;
    public WaveFormat OutputWaveFormat => WaveFormat;
    public PlaybackState PlaybackState => player.PlaybackState;
    public float Volume { get => player.Volume; set => player.Volume = value; }
    public event EventHandler<StoppedEventArgs> PlaybackStopped {
      add => player.PlaybackStopped += value;
      remove => player.PlaybackStopped -= value;
    }
    public void Init(IWaveProvider provider) { source = provider; WaveFormat = provider.WaveFormat; player.Init(this); }
    public int Read(byte[] data, int offset, int count) { lock (gate) return source?.Read(data, offset, count) ?? 0; }
    public void Play() => player.Play();
    public void Pause() => player.Pause();
    public void Stop() => player.Stop();
    public void Dispose() { lock (gate) source = null; player.Dispose(); }
  }

  internal static (string Driver, int Offset) ParseAsio(string value)
  {
    var parts = value.Split('|');
    int offset = 0;
    if (parts.Length > 2 || parts.Length == 2 && (!int.TryParse(parts[1], out offset) || offset < 0 || offset >= 128 || offset % 2 != 0))
      throw new ArgumentException("ASIO 声道无效。");
    return (Uri.UnescapeDataString(parts[0]), offset);
  }

  static Dictionary<string, int> WaveOutEndpoints()
  {
    var result = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
    for (int index = 0; index < WaveOut.DeviceCount; index++)
    {
      // DRV_RESERVED + 17; Windows returns the stable MMDevice endpoint ID.
      IntPtr memory = Marshal.AllocHGlobal(4096);
      try
      {
        if (waveOutMessage((IntPtr)index, 0x811, memory, (IntPtr)4096) != 0) continue;
        string? id = Marshal.PtrToStringUni(memory);
        if (!string.IsNullOrEmpty(id)) result[id] = index;
      }
      finally { Marshal.FreeHGlobal(memory); }
    }
    return result;
  }

  [DllImport("winmm.dll")] static extern uint waveOutMessage(IntPtr device, uint message, IntPtr value, IntPtr size);
}
