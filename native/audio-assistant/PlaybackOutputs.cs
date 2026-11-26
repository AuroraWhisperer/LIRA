using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using NAudio.CoreAudioApi;
using NAudio.Wave;
using NAudio.Wave.Asio;
using NAudio.Wave.SampleProviders;

internal sealed record PlaybackOutput(string DeviceId, string Name, string Backend, string EndpointId);

internal static class PlaybackOutputs
{
  const string SteinbergBuiltInDriver = "Steinberg built-in ASIO Driver";
  static readonly string[] Backends = { "wasapi", "directsound", "waveout" };
  static readonly Dictionary<string, List<PlaybackOutput>> AsioPorts = new();
  static string Label(string backend) => backend switch { "wasapi" => "WASAPI", "directsound" => "DirectSound", _ => "WaveOut" };

  public static List<PlaybackOutput> Enumerate(List<(string Id, string Name)>? endpoints = null, string savedOutput = "")
  {
    endpoints ??= AudioDevices.Outputs();
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
      result.AddRange(AsioChoices(driver, savedOutput));
    return result;
  }

  internal static IEnumerable<PlaybackOutput> AsioChoices(string driver, string savedOutput)
  {
    if (AsioPorts.TryGetValue(driver, out var ports)) return ports;
    string id = $"asio:{Uri.EscapeDataString(driver)}";
    var choices = new List<PlaybackOutput> { new(id, $"ASIO：{driver}（驱动，连接待检查）", "asio", "") };
    if (savedOutput.StartsWith(id + "|", StringComparison.Ordinal)
      && int.TryParse(savedOutput.AsSpan(id.Length + 1), out int offset) && offset is > 0 and < 128 && offset % 2 == 0)
      choices.Add(new(savedOutput, $"ASIO：{driver} · 声道 {offset + 1} / {offset + 2}（连接待检查）", "asio", ""));
    return choices;
  }

  internal static void CheckAsioChannels(string driver, int offset, int count, Func<int, string> channelName)
  {
    if (count == 0) AsioPorts.Remove(driver);
    else AsioPorts[driver] = Enumerable.Range(0, count).Where(channel => channel % 2 == 0).Select(channel =>
      new PlaybackOutput($"asio:{Uri.EscapeDataString(driver)}{(channel == 0 ? "" : $"|{channel}")}",
        $"ASIO：{driver} · {channelName(channel)}{(channel + 1 < count ? $" / {channelName(channel + 1)}" : "")}",
        "asio", "")).ToList();
    if (offset >= count) throw new InvalidOperationException("所选 ASIO 输出声道不可用，请重新选择。");
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

  public static IWavePlayer Create(string backend, string endpointId, IWaveProvider source) =>
    Create(backend, endpointId, source, false, out _);

  public static IWavePlayer Create(string backend, string endpointId, IWaveProvider source, bool finiteFile, out AsioFileTail? tail)
  {
    tail = null;
    IWavePlayer? player = null;
    try
    {
      if (backend == "asio")
      {
        var (driver, offset) = ParseAsio(endpointId);
        var asio = new AsioOut(driver);
        player = asio;
        SelectAsioBufferCallback(asio);
        int count = asio.DriverOutputChannelCount;
        CheckAsioChannels(driver, offset, count, asio.AsioOutputChannelName);
        asio.ChannelOffset = offset;
        ISampleProvider samples = source.ToSampleProvider();
        if (offset + 1 == count) samples = new StereoToMonoSampleProvider(samples);
        if (!asio.IsSampleRateSupported(samples.WaveFormat.SampleRate))
        {
          int rate = new[] { 48000, 44100, 96000, 88200, 192000 }.FirstOrDefault(asio.IsSampleRateSupported);
          if (rate == 0) throw new InvalidOperationException("ASIO 驱动不支持可用的播放格式，请选择其他输出方式。");
          samples = new WdlResamplingSampleProvider(samples, rate);
        }
        var pcm = samples.ToWaveProvider();
        if (finiteFile)
        {
          // The built-in driver's reported latency excludes part of its Windows output queue.
          int downstreamFrames = IsSteinbergBuiltIn(asio) ? pcm.WaveFormat.SampleRate / 10 : 0;
          tail = new AsioFileTail(pcm, () => asio.PlaybackLatency, downstreamFrames);
        }
        asio.Init(tail ?? pcm);
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

  static bool IsSteinbergBuiltIn(AsioOut player) =>
    string.Equals(player.DriverName, SteinbergBuiltInDriver, StringComparison.OrdinalIgnoreCase);

  // Locked NAudio 2.2.1 declines ASIO time info, yet registers an empty handler.
  // Steinberg's built-in driver selects it by pointer. Leave it null before Init
  // so the driver delivers PCM through NAudio's working buffer-switch callback.
  internal static void SelectAsioBufferCallback(AsioOut player)
  {
    if (IsSteinbergBuiltIn(player))
      DriverCallbacks(DriverOf(player)).pbufferSwitchTimeInfo = null;
  }

  [UnsafeAccessor(UnsafeAccessorKind.Field, Name = "driver")]
  static extern ref AsioDriverExt DriverOf(AsioOut player);
  [UnsafeAccessor(UnsafeAccessorKind.Field, Name = "callbacks")]
  static extern ref AsioCallbacks DriverCallbacks(AsioDriverExt driver);

  internal sealed class AsioFileTail(IWaveProvider source, Func<int> outputLatencyFrames, int downstreamFrames = 0) : IWaveProvider
  {
    readonly object readGate = new();
    // Allow one control-poll interval of output for drivers without a known downstream allowance.
    readonly int unknownLatencyFloorFrames = downstreamFrames == 0 ? source.WaveFormat.SampleRate / 2 : 0;
    long elapsedFrames = -1;
    int framesPerBuffer, lastReadBytes;
    public WaveFormat WaveFormat => source.WaveFormat;

    // The control thread asks for the running driver's latency only after source EOF.
    public bool HasDrained
    {
      get
      {
        long elapsed = Volatile.Read(ref elapsedFrames);
        if (elapsed < 0) return false;
        if (lastReadBytes == 0) return true;
        int latency = outputLatencyFrames();
        long driverFrames = latency > 0 ? Math.Max(framesPerBuffer, latency)
          : Math.Max(2L * framesPerBuffer, unknownLatencyFloorFrames);
        return elapsed >= driverFrames + downstreamFrames;
      }
    }

    public int Read(byte[] buffer, int offset, int count)
    {
      // A driver can reenter a buffer switch while the previous source read is returning.
      lock (readGate)
      {
        if (elapsedFrames < 0)
        {
          int read = source.Read(buffer, offset, count);
          if (read != 0) { lastReadBytes = read; return read; }
          framesPerBuffer = count / WaveFormat.BlockAlign;
          // NAudio already padded the last short block with silence.
          Volatile.Write(ref elapsedFrames, (count - lastReadBytes) / WaveFormat.BlockAlign);
        }
        else Volatile.Write(ref elapsedFrames, elapsedFrames + framesPerBuffer);
        return 0; // NAudio zero-fills this block and continues requesting buffers until stopped.
      }
    }
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
