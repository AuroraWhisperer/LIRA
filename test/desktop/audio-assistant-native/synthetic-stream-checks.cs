using System.Reflection;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Text.Json;
using NAudio.Wave;
using NAudio.Wave.Asio;
using NAudio.Wave.SampleProviders;

internal static class SyntheticStreamChecks
{
  const BindingFlags Private = BindingFlags.Instance | BindingFlags.NonPublic;
  static void Set(object target, string field, object value) => target.GetType().GetField(field, Private)!.SetValue(target, value);
  static T Bare<T>() where T : class => (T)RuntimeHelpers.GetUninitializedObject(typeof(T));
  static void Check(bool ok, string result) { Console.WriteLine(result); if (!ok) throw new Exception(result); }

  public static async Task Run(string scratch)
  {
    string tmp = Path.GetFullPath(scratch), root = Path.Combine(tmp, "audio-stream-" + Guid.NewGuid().ToString("N"));
    Directory.CreateDirectory(root);
    string? previous = Environment.GetEnvironmentVariable("LIRA_AUDIO_DATA_DIR");
    var errors = new List<Exception>();
    try
    {
      Environment.SetEnvironmentVariable("LIRA_AUDIO_DATA_DIR", root);
      foreach (Action run in new Action[] { CaptureDrift, WaveOutReads, OriginalImpulse, AsioChannels, AsioBufferCallback })
        try { run(); } catch (Exception error) { errors.Add(error); }
      try { await MeterWindows(root); } catch (Exception error) { errors.Add(error); }
      try { await AsioEnd(root); } catch (Exception error) { errors.Add(error); }
    }
    finally
    {
      Environment.SetEnvironmentVariable("LIRA_AUDIO_DATA_DIR", previous);
      if (Path.GetDirectoryName(root) != tmp) throw new Exception("Invalid fixture path.");
      Directory.Delete(root, true);
    }
    if (errors.Count > 0) throw new AggregateException(errors);
  }

  sealed class Recording : IWaveIn
  {
    public WaveFormat WaveFormat { get; set; } = WaveFormat.CreateIeeeFloatWaveFormat(48000, 2);
    public event EventHandler<WaveInEventArgs>? DataAvailable;
    public event EventHandler<StoppedEventArgs>? RecordingStopped;
    public void Send(byte[] pcm, int frames) => DataAvailable?.Invoke(this, new(pcm, frames * WaveFormat.BlockAlign));
    public void StartRecording() {}
    public void StopRecording() => RecordingStopped?.Invoke(this, new());
    public void Dispose() {}
  }

  static void CaptureDrift()
  {
    foreach (int extra in new[] { 0, 5 })
    {
      var recording = new Recording();
      using var capture = new DeviceCapture(recording, "auto");
      string? failure = null;
      capture.Failed += error => failure = error.Message;
      var packet = new byte[2880 * 8];
      var output = new float[960];
      recording.Send(packet, 2880); // 60 ms of device startup headroom
      int ticks = 0;
      for (; ticks < 500000 && failure == null; ticks++)
      {
        recording.Send(packet, 480 + (ticks % 100 == 0 ? extra : 0));
        capture.Input.Read(output, 0, output.Length);
      }
      Check(failure == null, $"capture +{extra} frames/s: {ticks * .01:F2} simulated seconds, failure={failure ?? "none"}");
      recording.StopRecording();
      Check(failure != null, "A real RecordingStopped notification still propagates.");
    }
  }

  static void WaveOutReads()
  {
    var tone = new SignalGenerator(48000, 2) { Type = SignalGeneratorType.Sin, Frequency = 440, Gain = .25 };
    using var dsp = new DspSource(tone.Take(TimeSpan.FromSeconds(1))) { SpeedPercent = 50, OutputVolume = 1 };
    var pcm = new float[2400 * 2];
    int count, previous = pcm.Length, padding = 0, frames = 0, reads = 0;
    while ((count = dsp.Read(pcm, 0, pcm.Length)) != 0)
    {
      padding += (pcm.Length - previous) / 2; // excludes the legitimate final short buffer
      previous = count; frames += count / 2; reads++;
    }
    Check(frames == 96000 && padding == 0, $"0.5x finite PCM: {frames} frames, {reads} nonempty reads, {padding} interior WaveOut padding frames");
  }

  sealed class Signal(Func<int, float> at) : ISampleProvider
  {
    int sample;
    public WaveFormat WaveFormat { get; } = WaveFormat.CreateIeeeFloatWaveFormat(48000, 2);
    public int Read(float[] buffer, int offset, int count)
    {
      for (int i = 0; i < count; i++) buffer[offset + i] = at(sample++ / 2);
      return count;
    }
  }

  static void OriginalImpulse()
  {
    int impulse = 144000;
    using var dsp = new DspSource(new Signal(i => i == impulse ? .8f : 0)) { Semitones = 7, OutputVolume = 1 };
    var pcm = new float[960]; int audible = 0; float peak = 0;
    for (int block = 0; block < 380; block++)
    {
      if (block == 100) dsp.Original = true;
      dsp.Read(pcm, 0, pcm.Length);
      for (int i = 0; i < pcm.Length; i += 2)
      {
        peak = Math.Max(peak, Math.Abs(pcm[i]));
        if (Math.Abs(pcm[i]) > .00001f) audible++;
      }
    }
    Check(audible == 1 && peak == .8f, $"bypass after +7: {audible} audible frames, peak={peak:R}");
    dsp.Original = false;
    impulse = (int)dsp.InputFrames + 4096;
    audible = 0;
    for (int block = 0; block < 80; block++)
    {
      dsp.Read(pcm, 0, pcm.Length);
      for (int i = 0; i < pcm.Length; i += 2) if (Math.Abs(pcm[i]) > .00001f) audible++;
    }
    Check(audible > 1, $"pitch resumed: {audible} audible frames");
  }

  static void AsioChannels()
  {
    var choices = PlaybackOutputs.AsioChoices("Studio", "asio:Studio|2").ToList();
    Check(choices.Count == 2 && choices[1].DeviceId == "asio:Studio|2" && choices[1].Name.Contains("连接待检查"),
      $"unprobed installed driver: {string.Join(", ", choices.Select(option => option.Name))}");
    Check(PlaybackOutputs.AsioChoices("Other", "asio:Studio|2").Count() == 1, "A missing driver gains no channel option.");
    string driver = $"Fixture-{Guid.NewGuid():N}", saved = $"asio:{driver}|2";
    try
    {
      PlaybackOutputs.CheckAsioChannels(driver, 2, 2, channel => channel == 0 ? "Left" : "Right");
      throw new Exception("A stereo-only driver accepted channels 3 / 4.");
    }
    catch (InvalidOperationException) {}
    Check(PlaybackOutputs.AsioChoices(driver, saved).Select(choice => choice.DeviceId).SequenceEqual([$"asio:{driver}"]),
      "After a rejected open on a probed stereo driver, only channels 1 / 2 remain available.");
    try
    {
      PlaybackOutputs.CheckAsioChannels(driver, 0, 0, _ => throw new Exception("No output channels to name."));
      throw new Exception("An offline ASIO interface accepted output.");
    }
    catch (InvalidOperationException) {}
    Check(PlaybackOutputs.AsioChoices(driver, "").Single().Name.Contains("连接待检查"),
      "An installed driver with no current outputs stays available to probe again.");
    PlaybackOutputs.CheckAsioChannels(driver, 2, 4, channel => $"Out {channel + 1}");
    Check(PlaybackOutputs.AsioChoices(driver, saved).Last().DeviceId == saved, "Reconnected outputs can be selected.");
  }

  static void AsioBufferCallback()
  {
    var asio = Bare<AsioOut>();
    GC.SuppressFinalize(asio); // This callback fixture owns no native driver to release.
    var driver = Bare<AsioDriverExt>();
    Set(asio, "driver", driver);
    bool read = false;
    Set(driver, "callbacks", new AsioCallbacks {
      pbufferSwitch = (_, _) => read = true, pbufferSwitchTimeInfo = (_, _, _) => IntPtr.Zero,
    });
    var callbacks = typeof(AsioDriverExt).GetField("callbacks", Private)!;
    Set(asio, "driverName", "Studio");
    PlaybackOutputs.SelectAsioBufferCallback(asio);
    Check(((AsioCallbacks)callbacks.GetValue(driver)!).pbufferSwitchTimeInfo != null, "Other ASIO drivers keep their registered callbacks.");
    Set(asio, "driverName", "Steinberg built-in ASIO Driver");
    PlaybackOutputs.SelectAsioBufferCallback(asio);
    var registered = (AsioCallbacks)callbacks.GetValue(driver)!;
    if (registered.pbufferSwitchTimeInfo != null) registered.pbufferSwitchTimeInfo(IntPtr.Zero, 0, false);
    else registered.pbufferSwitch(0, false);
    Check(read, "The Steinberg built-in driver selects the callback that pulls PCM.");
  }

  // Construct just the file/device session state in memory. The regular constructor enumerates real endpoints.
  static AudioSession Session(string source, string root, AudioEngine engine)
  {
    var session = Bare<AudioSession>();
    Set(session, "source", source); Set(session, "engine", engine); Set(session, "settings", new AssistantSettings());
    Set(session, "settingsPath", Path.Combine(root, "settings.json"));
    Set(session, "apps", new List<AudioApp> { new(17, "Test", "Track", true, "", "", true) });
    Set(session, "outputs", new List<(string, string)> { ("out", "Output") });
    Set(session, "inputs", new List<(string, string)> { ("in", "Input") });
    Set(session, "playbackOutputs", new List<PlaybackOutput> { new("asio:Studio", "ASIO：Studio", "asio", "") });
    return session;
  }

  static async Task MeterWindows(string root)
  {
    bool pulse = true;
    using var dsp = new DspSource(new Signal(i => pulse && i % 24000 is >= 12000 and < 12240 ? .75f : 0)) { OutputVolume = 1 };
    using var engine = Bare<AudioEngine>(); Set(engine, "dsp", dsp);
    var session = Session("input", root, engine);
    var pcm = new float[960];
    var windows = new List<(float, float)>();
    var lists = new List<string>();
    var statuses = new List<string>();
    session.Changed += () => {
      var state = JsonSerializer.SerializeToElement(session.Snapshot(), AssistantSettings.Json);
      windows.Add((state.GetProperty("inputLevel").GetSingle(), state.GetProperty("level").GetSingle()));
      statuses.Add(state.GetProperty("status").GetString()!);
      lists.Add(JsonSerializer.Serialize(new[] { "apps", "outputs", "inputs", "outputChoices" }.ToDictionary(k => k, k => state.GetProperty(k))));
    };
    for (int window = 0; window < 11; window++)
    {
      if (window == 10) pulse = false;
      for (int i = 0; i < 50; i++) dsp.Read(pcm, 0, pcm.Length);
      await session.Tick();
    }
    Console.WriteLine($"inventory: {lists.Count} full snapshots, {lists.Distinct().Count()} distinct inventories, {System.Text.Encoding.UTF8.GetByteCount(lists[0])} UTF-8 bytes in the four-list object");
    Check(windows.Take(10).All(pair => pair == (.75f, .75f)) && windows.Last() == (0, 0),
      $"500 ms meter windows: {string.Join(", ", windows)}");
    Check(statuses.Count == 11 && statuses.Take(10).All(status => status == "正在处理输入声音") && statuses.Last() == "正在等待输入声音",
      $"active pulse: {statuses[0]}, silent window: {statuses.Last()}");
  }

  static async Task AsioEnd(string root)
  {
    const int block = 2048, sampleRate = 48000, unknownReserve = sampleRate / 2;
    foreach (var (frames, latency, reported, downstream) in new[] {
      (block * 2, block, block, 0), (block + 73, block * 3 + 29, block * 3 + 29, 0),
      (block, block * 2, 0, 0), (block + 73, unknownReserve, 0, 0),
      (block, block + 4800, block, 4800), (block, block * 2 + 4800, 0, 4800), (0, block * 3, 0, 0),
    })
    {
      string path = Path.Combine(root, "first.wav"), next = Path.Combine(root, "next.wav");
      var format = WaveFormat.CreateIeeeFloatWaveFormat(sampleRate, 2);
      var song = Enumerable.Range(0, frames * 2).Select(i => (1 + i % 19) / 32f * (i % 2 == 0 ? 1 : -1)).ToArray();
      using (var wave = new WaveFileWriter(path, format)) wave.WriteSamples(song, 0, song.Length);
      File.Copy(path, next, true);
      using var engine = Bare<AudioEngine>();
      var file = new AudioFileReader(path); Set(engine, "file", file);
      var dsp = new DspSource(file) { OutputVolume = 1 }; Set(engine, "dsp", dsp);
      var asio = Bare<AsioOut>(); Set(engine, "output", asio);
      int activeLatency = block;
      var tail = new PlaybackOutputs.AsioFileTail(dsp.ToWaveProvider(), () => activeLatency, downstream);
      Set(engine, "asioFileTail", tail); Set(asio, "sourceStream", tail);
      Set(asio, "waveBuffer", new byte[block * format.BlockAlign]); Set(asio, "nbSamples", block);
      Set(asio, "<NumberOfOutputChannels>k__BackingField", 2); Set(asio, "playbackState", PlaybackState.Playing);
      // The driver accepts each block now, but its first frame reaches output only after the latency.
      var queued = new Queue<float>(new float[latency * 2]);
      var heard = new List<float>();
      var pcm = new float[block * 2];
      void QueueBlock(IntPtr source, IntPtr[] outputs, int channels, int samples)
      {
        Marshal.Copy(source, pcm, 0, channels * samples);
        foreach (float sample in pcm) queued.Enqueue(sample);
      }
      Action<IntPtr, IntPtr[], int, int> sink = QueueBlock;
      var convertor = typeof(AsioOut).GetField("convertor", Private)!;
      convertor.SetValue(asio, sink.Method.CreateDelegate(convertor.FieldType, sink.Target));
      var callback = typeof(AsioOut).GetMethod("driver_BufferUpdate", Private)!
        .CreateDelegate<Action<IntPtr[], IntPtr[]>>(asio);
      var session = Session("file", root, engine);
      int reserve = reported <= 0 && downstream == 0 ? unknownReserve : latency;
      int lastTurn = frames == 0 ? 0 : (frames + reserve + block - 1) / block;
      for (int turn = 0; turn <= lastTurn; turn++)
      {
        if (turn > 0) for (int i = 0; i < pcm.Length; i++) heard.Add(queued.Dequeue());
        callback([], []);
        if (turn == 1) activeLatency = reported; // The running driver may renegotiate its latency.
        await session.Tick(); // Poll at the earliest possible instant, before more frames can sound.
        if (!JsonSerializer.SerializeToElement(session.Snapshot()).GetProperty("running").GetBoolean()) break;
      }
      var audible = heard.Skip(latency * 2).Where(s => s != 0).ToArray();
      Check(heard.Skip(latency * 2).Take(song.Length).SequenceEqual(song) && audible.Length == song.Length,
        $"ASIO file {frames} frames, reported {reported}, actual {latency}: {audible.Length / 2}/{frames} audible frames through stop");
      session.SelectFile(next); // Requires an idle session by the first poll at or above the reserve.
      Check(JsonSerializer.SerializeToElement(session.Snapshot()).GetProperty("fileName").GetString() == "next.wav",
        "Selected next.wav after the final frame reached output.");
    }
  }
}
