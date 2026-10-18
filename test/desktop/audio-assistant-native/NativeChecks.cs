using System.Text.Json;
using NAudio.Wave;
using NAudio.Wave.SampleProviders;

internal static class NativeChecks
{
  static async Task Main(string[] args)
  {
    await InstallationExitChecks.Run(args[0], args[1]);
    // Construction verifies the packaged model hash and runs a warm-up inference.
    using (var model = new StemModel())
      Console.WriteLine("Packaged lira.onnx model loaded and inference completed.");
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
      float[] buffer = new float[2048], expected = new float[2048];
      int total = 0, crossings = 0, count;
      float previous = 0;
      double maximumDifference = 0;
      while ((count = dsp.Read(buffer, 0, buffer.Length)) > 0)
      {
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
