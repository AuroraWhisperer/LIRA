using System.Text.Json;
using NAudio.Wave;
using NAudio.Wave.SampleProviders;

internal static class DeviceInputChecks
{
  public static async Task Run(string scratch)
  {
    CheckChannels();
    CheckFormats();
    CheckCaptureLifecycle();
    var asio = PlaybackOutputs.ParseAsio("Test%20Driver%7CPort|2");
    if (asio.Driver != "Test Driver|Port" || asio.Offset != 2) throw new Exception("ASIO IDs must preserve driver identity and channel offset.");
    foreach (string invalid in new[] { "driver|-1", "driver|1", "driver|128", "driver|2|4", "driver|invalid" })
    {
      try { PlaybackOutputs.ParseAsio(invalid); throw new Exception("Invalid ASIO channel must be rejected."); }
      catch (ArgumentException) { }
    }
    string root = Path.Combine(Path.GetFullPath(scratch), "audio-input-" + Guid.NewGuid().ToString("N"));
    string? previous = Environment.GetEnvironmentVariable("LIRA_AUDIO_DATA_DIR");
    Directory.CreateDirectory(root);
    Environment.SetEnvironmentVariable("LIRA_AUDIO_DATA_DIR", root);
    try
    {
      using (var session = new AudioSession(action => action()))
      {
        session.Configure(JsonSerializer.SerializeToElement(new { source = "input", inputChannels = "mono:0", inputMusic = true }));
        var state = JsonSerializer.SerializeToElement(session.Snapshot(), AssistantSettings.Json);
        if (state.GetProperty("sourceProcessId").ValueKind != JsonValueKind.Null || state.GetProperty("source").GetString() != "input")
          throw new Exception("Device input must not inherit a player process.");
        if (!state.TryGetProperty("inputs", out _)) throw new Exception("Capture endpoints must be available in the inventory.");
      }
      using (var session = new AudioSession(action => action()))
      {
        var state = JsonSerializer.SerializeToElement(session.Snapshot(), AssistantSettings.Json);
        if (state.GetProperty("running").GetBoolean() || state.GetProperty("source").GetString() != "input"
          || state.GetProperty("settings").GetProperty("inputChannels").GetString() != "mono:0")
          throw new Exception("Device preferences must survive reload without starting capture.");
        session.Configure(JsonSerializer.SerializeToElement(new { source = "loopback" }));
        state = JsonSerializer.SerializeToElement(session.Snapshot(), AssistantSettings.Json);
        if (state.GetProperty("settings").GetProperty("inputMusic").GetBoolean()
          || state.GetProperty("settings").GetProperty("inputChannels").GetString() != "auto")
          throw new Exception("Changing sources must reset music processing and channel selection.");
        var outputs = state.GetProperty("outputs");
        if (outputs.GetArrayLength() > 0)
        {
          string id = outputs[0].GetProperty("id").GetString()!;
          session.Configure(JsonSerializer.SerializeToElement(new { loopbackId = id, outputId = id.ToUpperInvariant() }));
          try { await session.Start(); throw new Exception("A same-endpoint loop must be rejected before capture starts."); }
          catch (InvalidOperationException error) when (error.Message.Contains("采集的播放设备与最终输出不能相同")) { }
          foreach (string backend in new[] { "wasapi", "directsound", "waveout" })
          {
            session.Configure(JsonSerializer.SerializeToElement(new { outputId = $"{backend}:{id}" }));
            try { await session.Start(); throw new Exception("Backend aliases must not bypass the same-endpoint guard."); }
            catch (InvalidOperationException error) when (error.Message.Contains("采集的播放设备与最终输出不能相同")) { }
          }
          if (Directory.Exists(Path.Combine(root, "routes"))) throw new Exception("Device capture must not create player routing journals.");
        }
        session.Configure(JsonSerializer.SerializeToElement(new { source = "file" }));
      }
      var settings = AssistantSettings.Load(Path.Combine(root, "settings.json"));
      if (settings.External || settings.DeviceSource != "") throw new Exception("Returning to files must clear the remembered device source.");
      File.WriteAllText(Path.Combine(root, "legacy.json"), "{\"external\":false,\"inputId\":null,\"loopbackId\":null,\"inputChannels\":\"stereo:999\"}");
      settings = AssistantSettings.Load(Path.Combine(root, "legacy.json"));
      if (settings.External || settings.DeviceSource != "" || settings.InputChannels != "auto" || settings.InputId != "" || settings.LoopbackId != "")
        throw new Exception("Legacy settings and invalid device preferences must remain readable.");
      Console.WriteLine("Device input checks passed: channels, formats, inventory, persistence, no auto-start and feedback-loop rejection.");
    }
    finally
    {
      Environment.SetEnvironmentVariable("LIRA_AUDIO_DATA_DIR", previous);
      if (Path.GetDirectoryName(root) != Path.GetFullPath(scratch)) throw new Exception("Unsafe fixture cleanup path.");
      Directory.Delete(root, true);
    }
  }

  static void CheckCaptureLifecycle()
  {
    var recording = new Recording();
    using (var capture = new DeviceCapture(recording, "stereo:2"))
    {
      int failures = 0;
      capture.Failed += _ => failures++;
      capture.Start();
      if (!recording.Started) throw new Exception("Starting device processing must start its capture stream.");
      float[] pcm = { 0.1f, 0.2f, 0.3f, 0.4f, 0.5f, 0.6f, 0.7f, 0.8f };
      var bytes = new byte[pcm.Length * sizeof(float)];
      Buffer.BlockCopy(pcm, 0, bytes, 0, bytes.Length);
      recording.Send(bytes);
      Array.Clear(bytes);
      var result = new float[4];
      if (capture.Input.Read(result, 0, 4) != 4 || !result.SequenceEqual(new float[] { 0.3f, 0.4f, 0.7f, 0.8f }))
        throw new Exception("Capture must own incoming PCM before the device reuses its packet.");
      recording.Fail();
      if (failures != 1) throw new Exception("A lost device must notify the owning audio engine.");
      capture.Dispose();
      capture.Dispose();
      if (failures != 1 || recording.Disposals != 1) throw new Exception("Shutdown must release capture once without reporting a new failure.");
    }
    var invalid = new Recording();
    try { using var capture = new DeviceCapture(invalid, "stereo:4"); }
    catch (InvalidOperationException) { }
    if (invalid.Disposals != 1) throw new Exception("Failed channel setup must release the capture device.");
  }

  sealed class Recording : IWaveIn
  {
    public WaveFormat WaveFormat { get; set; } = WaveFormat.CreateIeeeFloatWaveFormat(48000, 4);
    public event EventHandler<WaveInEventArgs>? DataAvailable;
    public event EventHandler<StoppedEventArgs>? RecordingStopped;
    public bool Started { get; private set; }
    public int Disposals { get; private set; }
    public void StartRecording() => Started = true;
    public void StopRecording() => RecordingStopped?.Invoke(this, new StoppedEventArgs());
    public void Send(byte[] bytes) => DataAvailable?.Invoke(this, new WaveInEventArgs(bytes, bytes.Length));
    public void Fail() => RecordingStopped?.Invoke(this, new StoppedEventArgs(new InvalidOperationException("Synthetic disconnected input.")));
    public void Dispose() { Disposals++; StopRecording(); }
  }

  static void CheckChannels()
  {
    foreach (var (selection, expected) in new[] {
      ("auto", new float[] { 1, 2, 5, 6 }),
      ("stereo:2", new float[] { 3, 4, 7, 8 }),
      ("mono:2", new float[] { 3, 3, 7, 7 }),
    })
    {
      var input = new InputChannelProvider(new Samples(48000, 4, new float[] { 1, 2, 3, 4, 5, 6, 7, 8 }), selection);
      var buffer = new float[6];
      if (input.Read(buffer, 1, 4) != 4 || !buffer.AsSpan(1, 4).SequenceEqual(expected) || buffer[0] != 0 || buffer[5] != 0)
        throw new Exception("Incorrect interleaved channel mapping: " + selection);
    }
    var mono = new InputChannelProvider(new Samples(48000, 1, new float[] { 0.25f, -0.5f }), "auto");
    var stereo = new float[4];
    if (mono.Read(stereo, 0, 4) != 4 || !stereo.SequenceEqual(new float[] { 0.25f, 0.25f, -0.5f, -0.5f }))
      throw new Exception("A mono microphone must play in both ears.");
    foreach (string selection in new[] { "stereo:3", "mono:4", "invalid", "mono:-1", "stereo:00" })
    {
      try { _ = new InputChannelProvider(new Samples(48000, 4, Array.Empty<float>()), selection); }
      catch (Exception error) when (error is InvalidOperationException or ArgumentException) { continue; }
      throw new Exception("Invalid input channels were accepted: " + selection);
    }
  }

  static void CheckFormats()
  {
    foreach (int bits in new[] { 16, 24, 32 })
    {
      var format = bits == 32 ? WaveFormat.CreateIeeeFloatWaveFormat(44100, 1) : new WaveFormat(44100, bits, 1);
      var buffer = new BufferedWaveProvider(format) { ReadFully = false };
      var bytes = new byte[44100 * format.BlockAlign];
      buffer.AddSamples(bytes, 0, bytes.Length);
      var input = DeviceCapture.ConvertInput(buffer.ToSampleProvider(), "auto");
      var samples = new float[2048];
      int total = 0, read;
      while ((read = input.Read(samples, 0, samples.Length)) > 0)
      {
        if (samples.Take(read).Any(sample => sample != 0)) throw new Exception("Format conversion corrupted silence.");
        total += read / 2;
      }
      if (input.WaveFormat.SampleRate != 48000 || input.WaveFormat.Channels != 2 || Math.Abs(total - 48000) > 4)
        throw new Exception($"Incorrect {bits}-bit input resampling: {total} frames.");
    }
  }

  sealed class Samples(int sampleRate, int channels, float[] values) : ISampleProvider
  {
    int position;
    public WaveFormat WaveFormat { get; } = WaveFormat.CreateIeeeFloatWaveFormat(sampleRate, channels);
    public int Read(float[] buffer, int offset, int count)
    {
      int read = Math.Min(count, values.Length - position);
      Array.Copy(values, position, buffer, offset, read);
      position += read;
      return read;
    }
  }
}
