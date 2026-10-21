using System.Text.Json;
using System.Runtime.InteropServices;
using NAudio.Wave;

internal sealed class PlaybackOutputContext : ApplicationContext
{
  readonly Control dispatcher = new();
  readonly System.Windows.Forms.Timer timer = new() { Interval = 1000 };
  IWavePlayer? output;
  BufferedWaveProvider? buffer;
  string endpointId = "";
  string backend = "";
  long stream, sequence;
  bool playing, closing;

  public PlaybackOutputContext(WaitHandle installationExit)
  {
    _ = dispatcher.Handle;
    timer.Tick += (_, _) => {
      if (installationExit.WaitOne(0)) { Close(); return; }
      if (output == null || backend == "asio") return;
      try { using var device = AudioDevices.OpenInput(endpointId, true); }
      catch { Fault("输出设备已断开，请重新选择。"); }
    };
    timer.Start();
    Write(new { type = "ready" });
    _ = Task.Run(async () => {
      string? line;
      while ((line = await Console.In.ReadLineAsync()) != null)
      {
        if (line.Length > 65536) break;
        if (closing) return;
        var command = line;
        dispatcher.BeginInvoke(() => Handle(command));
      }
      if (!closing) dispatcher.BeginInvoke(Close);
    });
  }

  void Write(object value) => Console.WriteLine(JsonSerializer.Serialize(value, AssistantSettings.Json));

  async void Handle(string line)
  {
    int id = 0;
    string op = "";
    try
    {
      using var document = JsonDocument.Parse(line);
      var request = document.RootElement;
      id = request.GetProperty("id").GetInt32();
      op = request.GetProperty("op").GetString()!;
      var value = request.TryGetProperty("value", out var argument) ? argument : default;
      object? data = null;
      switch (op)
      {
        case "list": data = PlaybackOutputs.Enumerate(); break;
        case "open":
          var route = PlaybackOutputs.Resolve(value.GetProperty("deviceId").GetString()!);
          Stop();
          stream = value.GetProperty("stream").GetInt64();
          sequence = 0;
          endpointId = route.EndpointId;
          backend = route.Backend;
          buffer = new BufferedWaveProvider(WaveFormat.CreateIeeeFloatWaveFormat(48000, 2)) {
            BufferDuration = TimeSpan.FromMilliseconds(500), ReadFully = true, DiscardOnBufferOverflow = false,
          };
          var ready = new ReadyProvider(buffer);
          output = PlaybackOutputs.Create(route.Backend, endpointId, ready);
          var current = output;
          output.PlaybackStopped += (_, args) => {
            if (args.Exception != null && !closing) dispatcher.BeginInvoke(() => {
              if (output == current) Fault("输出设备不可用，请检查连接后重试。");
            });
          };
          output.Play();
          playing = true;
          await ready.Started.Task.WaitAsync(TimeSpan.FromSeconds(3));
          if (closing || output != current) throw new InvalidOperationException("输出设备启动已取消。");
          data = new { stream, endpointId, backend = route.Backend };
          break;
        case "write":
          if (output == null || value.GetProperty("stream").GetInt64() != stream)
          {
            Write(new { id, ok = true, stale = true });
            return;
          }
          long next = value.GetProperty("sequence").GetInt64();
          if (next != sequence + 1) throw new InvalidOperationException("音频数据顺序错误，请重新播放。");
          string encoded = value.GetProperty("pcm").GetString()!;
          if (encoded.Length > 21848) throw new ArgumentException("音频数据过大。");
          byte[] pcm = Convert.FromBase64String(encoded);
          if (pcm.Length == 0 || pcm.Length > 16384 || pcm.Length % 8 != 0) throw new ArgumentException("音频数据格式无效。");
          ValidateSamples(pcm);
          if (playing && output.PlaybackState == PlaybackState.Stopped) throw new InvalidOperationException("输出设备已停止。");
          buffer!.AddSamples(pcm, 0, pcm.Length);
          sequence = next;
          data = new { bufferedFrames = buffer.BufferedBytes / 8 };
          break;
        case "stop": Stop(); break;
        default: throw new ArgumentException("未知播放输出操作。");
      }
      Write(new { id, ok = true, data });
    }
    catch (Exception error)
    {
      if (op is "open" or "write") Stop();
      Write(new { id, ok = false, error = error.Message });
    }
  }

  static void ValidateSamples(byte[] pcm)
  {
    var samples = MemoryMarshal.Cast<byte, float>(pcm.AsSpan());
    for (int index = 0; index < samples.Length; index++)
    {
      if (!float.IsFinite(samples[index])) throw new ArgumentException("音频采样无效。");
      samples[index] = Math.Clamp(samples[index], -1f, 1f);
    }
  }

  sealed class ReadyProvider(IWaveProvider source) : IWaveProvider
  {
    public readonly TaskCompletionSource Started = new(TaskCreationOptions.RunContinuationsAsynchronously);
    public WaveFormat WaveFormat => source.WaveFormat;
    public int Read(byte[] data, int offset, int count)
    {
      int read = source.Read(data, offset, count);
      Started.TrySetResult();
      return read;
    }
  }

  void Fault(string error)
  {
    long failedStream = stream;
    Stop();
    Write(new { type = "fault", stream = failedStream, error });
  }

  void Stop()
  {
    var previous = output;
    output = null;
    playing = false;
    stream = 0;
    previous?.Dispose();
    buffer = null;
  }

  void Close()
  {
    if (closing) return;
    closing = true;
    timer.Stop();
    Stop();
    ExitThread();
  }

  protected override void Dispose(bool disposing)
  {
    if (disposing) { Stop(); timer.Dispose(); dispatcher.Dispose(); }
    base.Dispose(disposing);
  }
}
