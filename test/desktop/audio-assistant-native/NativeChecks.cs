using System.Text.Json;
using NAudio.Wave;
using NAudio.Wave.SampleProviders;

internal static class NativeChecks
{
  static async Task Main(string[] args)
  {
    PlaybackPcmChecks.Run();
    if (args is ["--playback-pcm"]) return;
    CheckWindowsCompatibility();
    await InstallationExitChecks.Run(args[0], args[1]);
    await CheckIdleSession(args[1]);
    await CheckSeparationFailure(args[1]);
    await DeviceInputChecks.Run(args[1]);
    // Construction verifies the packaged model hash and runs a warm-up inference.
    using (var model = new StemModel())
    {
      float[] ProcessTrack()
      {
        var tone = new SignalGenerator(48000, 2) { Frequency = 440, Gain = 0.25, Type = SignalGeneratorType.Sin };
        using var dsp = new DspSource(tone) { StrengthPercent = -100, OutputVolume = 1 };
        dsp.PrepareSeparation(model);
        var samples = new float[16384];
        if (dsp.Read(samples, 0, samples.Length) != samples.Length || samples.All(value => value == 0))
          throw new Exception("No separated audio.");
        return samples;
      }
      if (!ProcessTrack().SequenceEqual(ProcessTrack())) throw new Exception("The previous track affected the reused model.");
      Console.WriteLine("Two independent tracks produced identical audio with one verified model.");
    }
    CheckOutputVolume();
    Console.WriteLine(JsonSerializer.Serialize(CheckBypassAndPitch()));
    var current = new SongIdentity("first", "test", "", 1);
    var players = new List<string>();
    var monitor = new SongMonitor(_ => Task.FromResult<SongIdentity?>(current), current, () => players);
    if (await monitor.HasChanged() || monitor.HasPlayerChanged()) throw new Exception("Unchanged song must remain active");
    current = current with { Title = "second" };
    if (!await monitor.HasChanged()) throw new Exception("Song change must be detected");
    players.Add("another-player");
    if (!monitor.HasPlayerChanged() || monitor.HasPlayerChanged()) throw new Exception("Only a newly playing source should interrupt");
    Console.WriteLine("DSP and song lifecycle checks passed");
    if (!SongMonitor.MatchesApp("com.aurorawhisperer.lira", "LIRA") || SongMonitor.MatchesApp("other.app", "LIRA"))
      throw new Exception("LIRA must use the desktop's existing media-session identity");
  }
  static void CheckWindowsCompatibility()
  {
    foreach (int build in new[] { 19041, 19044, 19045, 20348, 22000, 26100 })
      if (!ProcessCapture.SupportsWindowsVersion(new Version(10, 0, build)))
        throw new Exception($"Process capture must allow Windows build {build}.");
    foreach (var version in new[] { new Version(6, 3, 9600), new Version(10, 0, 18363), new Version(10, 0, 19040) })
      if (ProcessCapture.SupportsWindowsVersion(version))
        throw new Exception($"Process capture must reject Windows {version} before changing audio routes.");
    Console.WriteLine("Windows compatibility checks passed: Windows 10 2004+, Windows 11 and older version rejection.");
  }

  sealed class BrokenOutput(ManualResetEventSlim stopping) : IWavePlayer
  {
    public WaveFormat OutputWaveFormat => WaveFormat.CreateIeeeFloatWaveFormat(48000, 2);
    public PlaybackState PlaybackState => PlaybackState.Playing;
    public float Volume { get; set; }
    public event EventHandler<StoppedEventArgs> PlaybackStopped { add {} remove {} }
    public void Init(IWaveProvider source) {}
    public void Play() {}
    public void Pause() {}
    public void Stop() {}
    public void Dispose() { stopping.Set(); throw new IOException("fixture output shutdown"); }
  }

  sealed class WaitingInput(ManualResetEventSlim entered, ManualResetEventSlim release) : ISampleProvider
  {
    public WaveFormat WaveFormat => WaveFormat.CreateIeeeFloatWaveFormat(48000, 2);
    public int Read(float[] buffer, int offset, int count)
    {
      entered.Set();
      if (!release.Wait(TimeSpan.FromSeconds(10))) throw new TimeoutException();
      Array.Clear(buffer, offset, count);
      return count;
    }
  }

  static async Task CheckSeparationFailure(string scratch)
  {
    string root = Path.Combine(Path.GetFullPath(scratch), "audio-model-" + Guid.NewGuid().ToString("N"));
    Directory.CreateDirectory(root);
    string? previousDirectory = Environment.GetEnvironmentVariable("LIRA_AUDIO_DATA_DIR");
    try
    {
      Environment.SetEnvironmentVariable("LIRA_AUDIO_DATA_DIR", root);
      using var entered = new ManualResetEventSlim();
      using var release = new ManualResetEventSlim();
      using var stopping = new ManualResetEventSlim();
      using var session = new AudioSession(action => action());
      void Configure(object value) => session.Configure(JsonSerializer.SerializeToElement(value));
      Configure(new { source = "file", strength = 0 });
      var dsp = new DspSource(new WaitingInput(entered, release));
      var engine = System.Runtime.CompilerServices.RuntimeHelpers.GetUninitializedObject(typeof(AudioEngine));
      const System.Reflection.BindingFlags fields = System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic;
      typeof(AudioEngine).GetField("dsp", fields)!.SetValue(engine, dsp);
      typeof(AudioEngine).GetField("output", fields)!.SetValue(engine, new BrokenOutput(stopping));
      typeof(AudioSession).GetField("engine", fields)!.SetValue(session, engine);
      using (File.Open(Path.Combine(AppContext.BaseDirectory, "vendor", "lira.onnx"), FileMode.Open, FileAccess.Read, FileShare.None))
      {
        try { Configure(new { strength = 70, volume = 180 }); throw new Exception("Locked model was accepted"); }
        catch (IOException) {}
        Configure(new { volume = 33, semitones = 2 });
        var saved = AssistantSettings.Load(Path.Combine(root, "settings.json"));
        if (saved.Strength != 0 || saved.Volume != 33 || dsp.StrengthPercent != 0 || dsp.Semitones != 2) throw new Exception("Failed separation changed controls");
      }
      Configure(new { strength = 70 });
      var samples = new float[2048];
      var callback = Task.Run(() => dsp.Read(samples, 0, samples.Length));
      try
      {
        if (!entered.Wait(TimeSpan.FromSeconds(10))) throw new TimeoutException("DSP did not start");
        var shutdown = Task.Run(session.Dispose);
        if (!stopping.Wait(TimeSpan.FromSeconds(10)) || shutdown.IsCompleted) throw new Exception("Model shutdown crossed the active DSP callback");
        release.Set();
        if (await callback != samples.Length) throw new Exception("Active DSP callback did not drain");
        await shutdown;
        if (dsp.Read(samples, 0, samples.Length) != 0) throw new Exception("Late output callback reached the closed DSP");
      }
      finally { release.Set(); }
      Console.WriteLine("Locked model rejected, volume and pitch saved, model retry succeeded, throwing output drained active DSP and late read returned zero.");
    }
    finally { Environment.SetEnvironmentVariable("LIRA_AUDIO_DATA_DIR", previousDirectory); Directory.Delete(root, true); }
  }

  static async Task CheckIdleSession(string scratch)
  {
    string root = Path.Combine(Path.GetFullPath(scratch), "audio-idle-" + Guid.NewGuid().ToString("N"));
    string? previousDirectory = Environment.GetEnvironmentVariable("LIRA_AUDIO_DATA_DIR");
    Directory.CreateDirectory(root);
    Environment.SetEnvironmentVariable("LIRA_AUDIO_DATA_DIR", root);
    try
    {
      using var session = new AudioSession(action => action());
      int changes = 0;
      session.Changed += () => changes++;
      for (int i = 0; i < 16; i++) await session.Tick();
      if (changes != 0) throw new Exception("An idle session must not publish periodic snapshots.");
      session.Refresh();
      if (JsonSerializer.SerializeToElement(session.Snapshot()).GetProperty("status").GetString() != "音乐来源和设备已刷新。")
        throw new Exception("Explicit inventory refresh must remain available while idle.");

      // An unreadable synthetic journal exercises retries without touching device routing.
      string routes = Path.Combine(root, "routes");
      Directory.CreateDirectory(routes);
      string journal = Path.Combine(routes, "invalid-test-record.json");
      File.WriteAllText(journal, "{");
      session.Recover();
      if (!JsonSerializer.SerializeToElement(session.Snapshot()).GetProperty("pendingRecovery").GetBoolean())
        throw new Exception("The synthetic journal must require recovery.");
      for (int i = 0; i < 20; i++) await session.Tick();
      if (changes != 0) throw new Exception("Unchanged recovery errors must not be broadcast repeatedly.");
      File.Delete(journal);
      for (int i = 0; i < 10; i++) await session.Tick();
      if (changes != 1 || JsonSerializer.SerializeToElement(session.Snapshot()).GetProperty("pendingRecovery").GetBoolean())
        throw new Exception("Recovery completion must still publish its new state.");
      for (int i = 0; i < 20; i++) await session.Tick();
      if (changes != 1) throw new Exception("A recovered idle session must return to silence.");

      using var guard = System.Diagnostics.Process.GetCurrentProcess();
      var deferred = new RouteSession.RouteRecord {
        Executable = Path.Combine(root, "closed-player.exe"), Previous = new string?[] { null, null, null },
        Endpoint = "test-route", Restoring = true, GuardPid = guard.Id,
        GuardStarted = guard.StartTime.ToUniversalTime().Ticks,
      };
      File.WriteAllText(journal, JsonSerializer.Serialize(deferred));
      session.Recover();
      CheckRecovery(true, true);
      session.Stop();
      CheckRecovery(true, true);
      int deferredChanges = changes;
      for (int i = 0; i < 20; i++) await session.Tick();
      if (changes != deferredChanges) throw new Exception("Safe deferred recovery must not keep changing its status.");

      deferred.GuardStarted--;
      File.WriteAllText(journal, JsonSerializer.Serialize(deferred));
      if (RouteSession.ReadRecoveryState() != (true, false))
        throw new Exception("A lost or replaced recovery guard must not be reported as safe background work.");
      deferred.GuardStarted++;

      // These records are synthetic: no real device, player or mute is changed.
      foreach (string state in new[] { "muted", "error", "active", "invalid" })
      {
        deferred.MutedEndpoint = state == "muted" ? "test-muted-endpoint" : null;
        deferred.RecoveryError = state == "error" ? "原声恢复未完成：test failure" : null;
        deferred.Restoring = state != "active";
        deferred.Previous = state == "invalid" ? Array.Empty<string?>() : new string?[3];
        File.WriteAllText(journal, JsonSerializer.Serialize(deferred));
        await session.Tick();
        session.Recover();
        CheckRecovery(true, false);
      }
      File.Delete(journal);
      for (int i = 0; i < 10; i++) await session.Tick();
      CheckRecovery(false, false);
      session.Stop();
      CheckRecovery(false, false);
      Console.WriteLine("Idle session checks passed: no periodic snapshots, explicit refresh, recovery deduplication and completion.");

      void CheckRecovery(bool pending, bool waiting)
      {
        var snapshot = JsonSerializer.SerializeToElement(session.Snapshot());
        if (snapshot.GetProperty("pendingRecovery").GetBoolean() != pending
          || snapshot.GetProperty("recoveryDeferred").GetBoolean() != waiting)
          throw new Exception($"Incorrect recovery state: pending={pending}, deferred={waiting}.");
      }
    }
    finally
    {
      Environment.SetEnvironmentVariable("LIRA_AUDIO_DATA_DIR", previousDirectory);
      if (Path.GetDirectoryName(root) != Path.GetFullPath(scratch)) throw new Exception("Unsafe fixture cleanup path.");
      Directory.Delete(root, true);
    }
  }

  static void CheckOutputVolume()
  {
    foreach (var (gain, volume) in new[] { (0.25, 0f), (0.25, 1f), (0.25, 2f), (0.75, 2f) })
    {
      var tone = new SignalGenerator(48000, 2) { Frequency = 440, Gain = gain, Type = SignalGeneratorType.Sin };
      var reference = new SignalGenerator(48000, 2) { Frequency = 440, Gain = gain, Type = SignalGeneratorType.Sin };
      using var dsp = new DspSource(tone) { Original = true, OutputVolume = volume };
      float[] actual = new float[2048], expected = new float[2048];
      int count = dsp.Read(actual, 0, actual.Length);
      if (count != actual.Length) throw new Exception("Volume check did not receive the expected sample count.");
      reference.Read(expected, 0, count);
      for (int i = 0; i < count; i++)
        if (actual[i] != Math.Clamp(expected[i] * volume, -1f, 1f))
          throw new Exception($"Output volume or clipping regression: gain {gain}, volume {volume}.");
    }
    Console.WriteLine("Output volume checks passed: mute, unity gain, 200% amplification and clipping.");
  }
  static object CheckBypassAndPitch()
  {
    var results = new List<object>();
    foreach (var mode in new[] { ("original", -100, 12, true, 50), ("zero", 0, 0, false, 100),
      ("down", 0, -12, false, 100), ("up", 0, 12, false, 100), ("slow", 0, 0, false, 50),
      ("fast", 0, 0, false, 200), ("fast-up", 0, 12, false, 200), ("slow-down", 0, -12, false, 50) })
    {
      var tone = new SignalGenerator(48000, 2) { Frequency = 440, Gain = 0.2, Type = SignalGeneratorType.Sin };
      var reference = new SignalGenerator(48000, 2) { Frequency = 440, Gain = 0.2, Type = SignalGeneratorType.Sin };
      using var dsp = new DspSource(tone.Take(TimeSpan.FromSeconds(4))) {
        StrengthPercent = mode.Item2, Semitones = mode.Item3, Original = mode.Item4, SpeedPercent = mode.Item5, OutputVolume = 1,
      };
      // WaveOut requests 50 ms of stereo PCM per device buffer at 48 kHz.
      bool waveOutSlow = mode.Item1 == "slow";
      float[] buffer = new float[waveOutSlow ? 2400 * 2 : 2048], expected = new float[buffer.Length];
      int previousRead = buffer.Length;
      int total = 0, crossings = 0, count;
      float previous = 0;
      double maximumDifference = 0;
      while ((count = dsp.Read(buffer, 0, buffer.Length)) > 0)
      {
        if (waveOutSlow && previousRead < buffer.Length)
          throw new Exception($"Half-speed WaveOut read {previousRead / 2} of 2400 frames, then returned another {count / 2} frames.");
        previousRead = count;
        reference.Read(expected, 0, count);
        for (int i = 0; i < count; i++)
        {
          if (!float.IsFinite(buffer[i])) throw new Exception("Bypass/pitch output is not finite.");
          maximumDifference = Math.Max(maximumDifference, Math.Abs(buffer[i] - expected[i]));
          if (i % 2 != 0) continue;
          int frame = (total + i) / 2;
          if (frame >= 24000 && frame < 72000 && previous <= 0 && buffer[i] > 0) crossings++;
          previous = buffer[i];
        }
        total += count;
      }
      double expectedHz = mode.Item4 ? 440 : 440 * Math.Pow(2, mode.Item3 / 12d);
      int expectedFrames = (int)(48000 * 4 / (mode.Item4 ? 1 : mode.Item5 / 100d));
      if (Math.Abs(crossings - expectedHz) > 3 || total != expectedFrames * 2)
        throw new Exception($"DSP pitch/duration regression: {mode.Item1}, {crossings} Hz, {total / 2}/{expectedFrames} frames");
      bool bypass = mode.Item1 is "original" or "zero";
      if (bypass && maximumDifference != 0) throw new Exception("Disabled effects must preserve every sample.");
      results.Add(new { mode = mode.Item1, frequency = crossings, frames = total / 2, expectedFrames, exactBypass = bypass ? maximumDifference == 0 : (bool?)null });
    }
    // Returning to zero must retain queued music instead of clearing the pitch engine.
    var changingTone = new SignalGenerator(48000, 2) { Frequency = 440, Gain = 0.2, Type = SignalGeneratorType.Sin };
    using var changing = new DspSource(changingTone.Take(TimeSpan.FromSeconds(8))) { OutputVolume = 1 };
    float[] scratch = new float[2048];
    int totalFrames = 0, read;
    while ((read = changing.Read(scratch, 0, scratch.Length)) > 0)
    {
      totalFrames += read / 2;
      changing.Semitones = totalFrames < 48000 ? 0 : totalFrames < 96000 ? 12 : totalFrames < 144000 ? 0 : totalFrames < 192000 ? -12 : 0;
    }
    if (Math.Abs(totalFrames - 48000 * 8) > 512) throw new Exception("Changing pitch dropped or duplicated music.");
    var changingSpeedTone = new SignalGenerator(48000, 2) { Frequency = 440, Gain = 0.2, Type = SignalGeneratorType.Sin };
    using var changingSpeed = new DspSource(changingSpeedTone.Take(TimeSpan.FromSeconds(8))) { OutputVolume = 1 };
    double expectedSpeedFrames = 0;
    int speedFrames = 0;
    while (true)
    {
      long before = changingSpeed.InputFrames;
      int speed = before < 48000 ? 100 : before < 96000 ? 50 : before < 192000 ? 200 : 100;
      changingSpeed.SpeedPercent = speed;
      int count = changingSpeed.Read(scratch, 0, scratch.Length);
      expectedSpeedFrames += (changingSpeed.InputFrames - before) * 100d / speed;
      speedFrames += count / 2;
      if (count == 0) break;
    }
    if (Math.Abs(speedFrames - expectedSpeedFrames) > 1) throw new Exception("Changing speed dropped or duplicated music.");
    var tails = new List<object>();
    foreach (int frames in new[] { 64, 1025 })
    foreach (int speed in new[] { 50, 200 })
    {
      var samples = new float[frames * 2];
      for (int i = 0; i < frames; i++) samples[i * 2] = samples[i * 2 + 1] = 0.2f;
      using var processor = new RubberBandProcessor { PitchSemiTones = speed == 50 ? -12 : 12, Tempo = speed / 100d };
      processor.PutSamples(samples, frames); processor.Flush();
      int tailFrames = 0, count;
      while ((count = processor.ReceiveSamples(scratch, scratch.Length / 2)) > 0)
      {
        if (scratch.Take(count * 2).Any(value => !float.IsFinite(value))) throw new Exception("Native pitch tail contains invalid samples.");
        tailFrames += count;
      }
      if (tailFrames != (int)Math.Round(frames * 100d / speed)) throw new Exception($"Native pitch tail length is wrong: {frames}, {speed}, {tailFrames}.");
      tails.Add(new { frames, speed, outputFrames = tailFrames });
    }
    return new { modes = results, switchingPitchFrames = totalFrames, expectedSwitchingFrames = 48000 * 8,
      switchingSpeedFrames = speedFrames, expectedSpeedFrames, tails };
  }

}
