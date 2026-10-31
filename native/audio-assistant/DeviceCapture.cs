using NAudio.CoreAudioApi;
using NAudio.Wave;
using NAudio.Wave.SampleProviders;

internal sealed class DeviceCapture : IDisposable
{
  MMDevice? device;
  IWaveIn? capture;
  BufferedWaveProvider? buffer;
  volatile bool disposed;
  public ISampleProvider Input { get; private set; } = null!;
  public event Action<Exception>? Failed;

  public DeviceCapture(string deviceId, bool loopback, string channels)
  {
    try
    {
      device = AudioDevices.OpenEndpoint(deviceId, loopback ? DataFlow.Render : DataFlow.Capture);
      Initialize(loopback ? new WasapiLoopbackCapture(device) : new WasapiCapture(device, true, 30), channels);
    }
    catch { Dispose(); throw; }
  }

  internal DeviceCapture(IWaveIn source, string channels)
  {
    try { Initialize(source, channels); }
    catch { Dispose(); throw; }
  }

  void Initialize(IWaveIn source, string channels)
  {
    capture = source;
    buffer = new BufferedWaveProvider(capture.WaveFormat) {
      BufferDuration = TimeSpan.FromMilliseconds(500), ReadFully = true, DiscardOnBufferOverflow = false,
    };
    Input = ConvertInput(buffer.ToSampleProvider(), channels);
    capture.DataAvailable += OnData;
    capture.RecordingStopped += OnStopped;
  }

  internal static ISampleProvider ConvertInput(ISampleProvider source, string channels)
  {
    ISampleProvider input = new InputChannelProvider(source, channels);
    return input.WaveFormat.SampleRate == 48000 ? input : new WdlResamplingSampleProvider(input, 48000);
  }

  void OnData(object? sender, WaveInEventArgs args)
  {
    if (disposed) return;
    try { buffer!.AddSamples(args.Buffer, 0, args.BytesRecorded); }
    catch (Exception error) { Failed?.Invoke(error); }
  }

  void OnStopped(object? sender, StoppedEventArgs args)
  {
    if (!disposed) Failed?.Invoke(args.Exception ?? new InvalidOperationException("输入设备已停止，请检查连接后重新开启处理。"));
  }

  public void Start() => capture!.StartRecording();

  public void Dispose()
  {
    if (disposed) return;
    disposed = true;
    if (capture != null)
    {
      capture.DataAvailable -= OnData;
      capture.RecordingStopped -= OnStopped;
      try { capture.Dispose(); }
      finally { device?.Dispose(); }
    }
    else device?.Dispose();
  }
}

internal sealed class InputChannelProvider : ISampleProvider
{
  readonly ISampleProvider source;
  readonly int left, right, channels;
  float[] incoming = Array.Empty<float>();
  public WaveFormat WaveFormat { get; }

  public InputChannelProvider(ISampleProvider source, string selection)
  {
    this.source = source;
    channels = source.WaveFormat.Channels;
    if (!IsValidSelection(selection)) throw new ArgumentException("输入声道无效，请重新选择。");
    left = selection == "auto" ? 0 : int.Parse(selection[(selection.IndexOf(':') + 1)..]);
    right = selection.StartsWith("mono:") || selection == "auto" && channels == 1 ? left : left + 1;
    if (channels < 1 || right >= channels)
      throw new InvalidOperationException("所选输入声道不可用，请刷新设备并重新选择声道。");
    WaveFormat = WaveFormat.CreateIeeeFloatWaveFormat(source.WaveFormat.SampleRate, 2);
  }

  internal static bool IsValidSelection(string value)
  {
    if (value == "auto") return true;
    var parts = value.Split(':');
    return parts.Length == 2 && parts[0] is "mono" or "stereo"
      && int.TryParse(parts[1], out int channel) && channel >= 0 && channel < 128
      && parts[1] == channel.ToString();
  }

  public int Read(float[] buffer, int offset, int count)
  {
    int needed = count / 2 * channels;
    if (incoming.Length < needed) incoming = new float[needed];
    int frames = source.Read(incoming, 0, needed) / channels;
    for (int frame = 0; frame < frames; frame++)
    {
      buffer[offset + frame * 2] = incoming[frame * channels + left];
      buffer[offset + frame * 2 + 1] = incoming[frame * channels + right];
    }
    return frames * 2;
  }
}
