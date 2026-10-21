using System.Diagnostics;
using NAudio.Wave;
using NAudio.Wave.SampleProviders;

internal sealed class AudioEngine : IDisposable
{
  readonly IWavePlayer output;
  readonly DspSource dsp;
  readonly AudioFileReader? file;
  readonly ProcessCapture? capture;
  readonly DeviceCapture? deviceCapture;
  public event Action<Exception?>? Stopped;
  public DspSource Dsp => dsp;
  public double PositionSeconds => file?.CurrentTime.TotalSeconds ?? 0;
  public double DurationSeconds => file?.TotalTime.TotalSeconds ?? 0;

  public AudioEngine(string? filePath, int? processId, string? outputId, int strength, int semitones, int speedPercent = 100,
    AudioInputDevice? inputDevice = null, bool loopback = false, string inputChannels = "auto", string outputBackend = "wasapi")
  {
    try
    {
      ISampleProvider input;
      if (filePath != null)
      {
        file = new AudioFileReader(filePath);
        input = file;
        if (input.WaveFormat.Channels == 1) input = new MonoToStereoSampleProvider(input);
        if (input.WaveFormat.Channels != 2) throw new InvalidOperationException("电音助手只支持单声道或双声道歌曲。");
        if (input.WaveFormat.SampleRate != 48000) input = new WdlResamplingSampleProvider(input, 48000);
      }
      else if (inputDevice != null)
      {
        deviceCapture = new DeviceCapture(inputDevice.Id, loopback, inputChannels);
        deviceCapture.Failed += error => Stopped?.Invoke(error);
        input = deviceCapture.Input;
      }
      else
      {
        var incoming = new BufferedWaveProvider(WaveFormat.CreateIeeeFloatWaveFormat(48000, 2)) {
          BufferDuration = TimeSpan.FromMilliseconds(500), ReadFully = true, DiscardOnBufferOverflow = false,
        };
        capture = new ProcessCapture();
        capture.Data += (samples, frames) => incoming.AddSamples(samples, 0, frames * 8);
        capture.Failed += error => Stopped?.Invoke(error);
        input = incoming.ToSampleProvider();
      }
      dsp = new DspSource(input) { StrengthPercent = strength, Semitones = semitones, SpeedPercent = filePath == null ? 100 : speedPercent };
      output = PlaybackOutputs.Create(outputBackend, string.IsNullOrEmpty(outputId) ? AudioDevices.DefaultOutputId() : outputId, dsp.ToWaveProvider());
      output.PlaybackStopped += (_, args) => Stopped?.Invoke(args.Exception);
      ProcessId = processId;
    }
    catch { Dispose(); throw; }
  }

  int? ProcessId { get; }
  public async Task Start(CancellationToken cancellationToken = default)
  {
    if (capture != null)
    {
      await capture.Start(ProcessId!.Value);
      // Fill ahead of the STFT look-ahead and the first WASAPI / pitch callback.
      await Task.Delay(120, cancellationToken);
    }
    if (deviceCapture != null)
    {
      deviceCapture.Start();
      await Task.Delay(60, cancellationToken);
    }
    cancellationToken.ThrowIfCancellationRequested();
    output.Play();
  }
  public void Dispose()
  {
    try { capture?.Dispose(); }
    finally
    {
      try { deviceCapture?.Dispose(); }
      finally
      {
        try { output?.Dispose(); }
        finally { dsp?.Dispose(); file?.Dispose(); }
      }
    }
  }
}

internal sealed class DspSource : ISampleProvider, IDisposable
{
  readonly ISampleProvider source;
  readonly StemSeparator separator;
  readonly RubberBandProcessor pitch = new();
  readonly float[] input = new float[2048];
  int directOffset, directCount;
  bool finished;
  bool wasOriginal;
  bool separationActive;
  bool pitchActive;
  int appliedSemitones = int.MinValue;
  int appliedSpeed;
  float appliedStrength;
  bool strengthNeedsUpdate = true;
  public volatile int StrengthPercent;
  public volatile int Semitones;
  public volatile int SpeedPercent = 100;
  public volatile float InputPeak;
  public volatile float OutputPeak;
  public volatile float OutputVolume = 0.7f;
  public volatile bool Original;
  public double WorkMilliseconds { get; private set; }
  public long InputFrames { get; private set; }
  public WaveFormat WaveFormat { get; } = WaveFormat.CreateIeeeFloatWaveFormat(48000, 2);

  public DspSource(ISampleProvider source) { this.source = source; separator = new StemSeparator(source); }

  public int Read(float[] buffer, int offset, int count)
  {
    long work = Stopwatch.GetTimestamp();
    int written = 0;
    while (written < count)
    {
      var destination = buffer.AsSpan(offset + written, count - written);
      int directSamples = Math.Min(destination.Length, directCount);
      input.AsSpan(directOffset, directSamples).CopyTo(destination);
      directOffset += directSamples; directCount -= directSamples;
      int available = directSamples / 2;
      if (available == 0) available = pitch.ReceiveSamples(destination, destination.Length / 2);
      written += available * 2;
      if (written == count || finished) break;
      bool original = Original;
      int semitones = original ? 0 : Semitones;
      int speed = original ? 100 : Math.Clamp(SpeedPercent, 50, 200);
      // Once an effect is started, keep its stream alive until Stop so returning to
      // zero does not discard buffered music or introduce a second timing jump.
      if (semitones != 0 || speed != 100) pitchActive = true;
      if (!original && StrengthPercent != 0) separationActive = true;
      if (semitones != appliedSemitones)
      {
        pitch.PitchSemiTones = semitones;
        appliedSemitones = semitones;
      }
      if (speed != appliedSpeed)
      {
        pitch.Tempo = speed / 100d;
        appliedSpeed = speed;
      }
      if (original != wasOriginal)
      {
        if (original && separationActive)
        {
          separator.Reset();
          strengthNeedsUpdate = true;
        }
        wasOriginal = original;
      }
      float nextStrength = appliedStrength + (Math.Clamp(StrengthPercent, -100, 100) / 100f - appliedStrength) * 0.35f;
      if (nextStrength != appliedStrength || strengthNeedsUpdate)
      {
        appliedStrength = nextStrength;
        separator.SetStrength(appliedStrength);
        strengthNeedsUpdate = false;
      }
      // A/B bypass omits both effects; returning to processing resets its rate bridge.
      bool separating = !original && separationActive;
      int read = (separating ? separator : source).Read(input, 0, input.Length);
      if (read == 0)
      {
        if (pitchActive) pitch.Flush();
        finished = true;
        continue;
      }
      if (separating) InputPeak = separator.InputPeak;
      else
      {
        float peak = 0;
        for (int i = 0; i < read; i++) peak = Math.Max(peak, Math.Abs(input[i]));
        InputPeak = peak;
      }
      InputFrames += read / 2;
      PutProcessed(input.AsSpan(0, read), read / 2);
    }
    float outputPeak = 0;
    float volume = OutputVolume;
    for (int i = offset; i < offset + written; i++)
    {
      buffer[i] = Math.Clamp(buffer[i] * volume, -1f, 1f);
      outputPeak = Math.Max(outputPeak, Math.Abs(buffer[i]));
    }
    OutputPeak = outputPeak;
    WorkMilliseconds += Stopwatch.GetElapsedTime(work).TotalMilliseconds;
    return written;
  }

  void PutProcessed(ReadOnlySpan<float> samples, int frames)
  {
    if (pitchActive) pitch.PutSamples(samples, frames);
    else { directOffset = 0; directCount = frames * 2; }
  }

  public void Dispose() { pitch.Dispose(); separator.Dispose(); }
}
