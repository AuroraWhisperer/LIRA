using System.Security.Cryptography;
using System.Numerics;
using Microsoft.ML.OnnxRuntime;
using NAudio.Wave;
using NAudio.Wave.SampleProviders;

// The separation model consumes 44.1 kHz stereo spectra.
internal sealed class StemSeparator : ISampleProvider, IDisposable
{
  readonly ISampleProvider source;
  readonly StemModel model = new();
  VocalSource vocals = null!;
  ISampleProvider output = null!;
  public WaveFormat WaveFormat { get; } = WaveFormat.CreateIeeeFloatWaveFormat(48000, 2);
  public float InputPeak => vocals.InputPeak;

  public StemSeparator(ISampleProvider source)
  {
    this.source = source;
    Reset();
  }

  public void SetStrength(float strength) => vocals.Strength = Math.Clamp(strength, -1, 1);
  public int Read(float[] buffer, int offset, int count) => output.Read(buffer, offset, count);
  public void Reset()
  {
    float strength = vocals?.Strength ?? 0;
    model.Reset();
    vocals = new VocalSource(new WdlResamplingSampleProvider(source, StemModel.SampleRate), model) { Strength = strength };
    output = new WdlResamplingSampleProvider(vocals, 48000);
  }
  public void Dispose() => model.Dispose();

  internal sealed class VocalSource(ISampleProvider source, StemModel model) : ISampleProvider
  {
    readonly float[] chunk = new float[StemModel.Hop * 2];
    readonly float[] estimate = new float[StemModel.Hop * 2], ready = new float[StemModel.Hop * 2];
    int readyCount, readyOffset, priming = StemModel.Delay * 2;
    long receivedTotal, emittedTotal;
    bool inputEnded;
    public float Strength;
    public float InputPeak { get; private set; }
    public WaveFormat WaveFormat { get; } = WaveFormat.CreateIeeeFloatWaveFormat(StemModel.SampleRate, 2);

    public int Read(float[] buffer, int offset, int count)
    {
      int written = 0;
      while (written < count)
      {
        if (readyOffset < readyCount)
        {
          int available = Math.Min(readyCount - readyOffset, count - written);
          Array.Copy(ready, readyOffset, buffer, offset + written, available);
          readyOffset += available; written += available;
          continue;
        }
        if (inputEnded && emittedTotal == receivedTotal) break;
        int received = 0, read;
        if (!inputEnded)
        {
          while (received < chunk.Length && (read = source.Read(chunk, received, chunk.Length - received)) > 0) received += read;
          receivedTotal += received;
          inputEnded = received < chunk.Length;
        }
        if (received < chunk.Length) Array.Clear(chunk, received, chunk.Length - received);
        float peak = 0;
        for (int i = 0; i < received; i++) peak = Math.Max(peak, Math.Abs(chunk[i]));
        InputPeak = peak;
        model.Process(chunk, estimate);
        // Remove the STFT pre-roll and flush only the actual input length at EOF.
        int skip = Math.Min(priming, chunk.Length);
        priming -= skip;
        readyCount = (int)Math.Min(chunk.Length - skip, receivedTotal - emittedTotal); readyOffset = 0;
        var original = model.AlignedOriginal;
        float originalGain = 1 + Math.Min(Strength, 0);
        for (int i = 0; i < readyCount; i++) ready[i] = originalGain * original[skip + i] - Strength * estimate[skip + i];
        emittedTotal += readyCount;
      }
      return written;
    }
  }
}

internal sealed class StemModel : IDisposable
{
  public const int SampleRate = 44100, Step = 512, BatchFrames = 6, Hop = Step * BatchFrames, WindowSize = 2048, Delay = WindowSize - Step;
  const int Bins = WindowSize / 2 + 1;
  static readonly Complex[] Roots = Enumerable.Range(0, WindowSize / 2).Select(i => Complex.FromPolarCoordinates(1, -2 * Math.PI * i / WindowSize)).ToArray();
  static readonly Complex[] InverseRoots = Roots.Select(Complex.Conjugate).ToArray();
  static readonly (int First, int Second)[] ReversalSwaps = CreateReversalSwaps();
  const string ModelHash = "ECA41B447DF6C0C9BB3B0B419F46EAB485AFEA41BF0A6F25B44F6514EC070E05";
  static readonly string[] InputNames = { "input", "hn_in", "cn_in", "band_norm_coe" };
  static readonly string[] OutputNames = { "output/sink_port_0", "hn_out/sink_port_0", "cn_out/sink_port_0" };
  static readonly long[][] Shapes = { new long[] { 2, 2, BatchFrames, Bins }, new long[] { 1, 6, 114, 100 }, new long[] { 1, 6, 114, 100 }, new long[] { 2, 57, BatchFrames } };
  static readonly int[] BandWidths = Enumerable.Repeat(2, 20).Concat(Enumerable.Repeat(4, 10)).Concat(Enumerable.Repeat(11, 8))
    .Concat(Enumerable.Repeat(23, 8)).Concat(Enumerable.Repeat(46, 8)).Concat(new[] { 92, 92, 121 }).ToArray();
  readonly float[][] inputs = Shapes.Select(shape => new float[shape.Aggregate(1L, (a, b) => a * b)]).ToArray();
  readonly float[][] outputs = Shapes.Take(3).Select(shape => new float[shape.Aggregate(1L, (a, b) => a * b)]).ToArray();
  readonly List<OrtValue> inputValues = new(), outputValues = new();
  readonly List<OrtIoBinding> bindings = new();
  int bindingIndex;
  readonly float[] history = new float[WindowSize * 2], overlap = new float[WindowSize * 2];
  readonly float[] alignedOriginal = new float[Hop * 2];
  static readonly float[] window = Enumerable.Range(0, WindowSize).Select(i => (float)(0.5 - 0.5 * Math.Cos(2 * Math.PI * i / (WindowSize - 1)))).ToArray();
  static readonly float[][] Normalizations = CreateNormalizations();
  int normalizationPhase;
  readonly Complex[] fft = new Complex[WindowSize];
  InferenceSession? session;
  RunOptions? runOptions;
  public ReadOnlySpan<float> AlignedOriginal => alignedOriginal;

  public StemModel()
  {
    try
    {
      string path = Path.Combine(AppContext.BaseDirectory, "vendor", "lira.onnx");
      using (var file = File.OpenRead(path))
        if (Convert.ToHexString(SHA256.HashData(file)) != ModelHash) throw new InvalidDataException("人声分离模型校验失败，请重新安装完整客户端。");
      using var options = new SessionOptions { IntraOpNumThreads = 1, InterOpNumThreads = 1, ExecutionMode = ExecutionMode.ORT_SEQUENTIAL };
      options.AddSessionConfigEntry("session.intra_op.allow_spinning", "0");
      options.AddSessionConfigEntry("session.inter_op.allow_spinning", "0");
      session = new InferenceSession(path, options);
      runOptions = new RunOptions();
      for (int i = 0; i < Shapes.Length; i++)
      {
        inputValues.Add(OrtValue.CreateTensorValueFromMemory(inputs[i], Shapes[i]));
        if (i < outputs.Length) outputValues.Add(OrtValue.CreateTensorValueFromMemory(outputs[i], Shapes[i]));
      }
      // Both bindings share buffers; only the recurrent state changes direction.
      for (int phase = 0; phase < 2; phase++)
      {
        var binding = session.CreateIoBinding();
        bindings.Add(binding);
        for (int i = 0; i < InputNames.Length; i++)
          binding.BindInput(InputNames[i], phase == 1 && i is 1 or 2 ? outputValues[i] : inputValues[i]);
        for (int i = 0; i < OutputNames.Length; i++)
          binding.BindOutput(OutputNames[i], phase == 1 && i is 1 or 2 ? inputValues[i] : outputValues[i]);
      }
      Process(new float[Hop * 2], new float[Hop * 2]);
      Reset();
    }
    catch { Dispose(); throw; }
  }

  public void Process(ReadOnlySpan<float> interleaved, Span<float> vocals)
  {
    if (interleaved.Length != Hop * 2 || vocals.Length != Hop * 2) throw new ArgumentException("The model requires one stereo hop.");
    for (int frame = 0; frame < BatchFrames; frame++)
    {
      Array.Copy(history, Step * 2, history, 0, Delay * 2);
      interleaved.Slice(frame * Step * 2, Step * 2).CopyTo(history.AsSpan(Delay * 2));
      Array.Copy(history, 0, alignedOriginal, frame * Step * 2, Step * 2);
      for (int channel = 0; channel < 2; channel++)
      {
        for (int i = 0; i < WindowSize; i++) fft[i] = new Complex(history[i * 2 + channel] * window[i], 0);
        Transform(false);
        int real = (channel * 2 * BatchFrames + frame) * Bins, imaginary = real + BatchFrames * Bins;
        for (int i = 0; i < Bins; i++)
        {
          inputs[0][real + i] = (float)fft[i].Real;
          inputs[0][imaginary + i] = (float)fft[i].Imaginary;
        }
        int start = 0;
        for (int band = 0; band < BandWidths.Length; band++)
        {
          float power = 0;
          int end = start + BandWidths[band];
          for (int i = start; i < end; i++) power += inputs[0][real + i] * inputs[0][real + i] + inputs[0][imaginary + i] * inputs[0][imaginary + i];
          inputs[3][(channel * BandWidths.Length + band) * BatchFrames + frame] = MathF.Sqrt(power + 1.1920928955078125e-7f);
          start = end;
        }
      }
    }
    // Six causal frames share one invocation without changing the trained weights.
    session!.RunWithBinding(runOptions!, bindings[bindingIndex]);
    for (int frame = 0; frame < BatchFrames; frame++)
    {
      for (int channel = 0; channel < 2; channel++)
      {
        int real = (channel * 2 * BatchFrames + frame) * Bins, imaginary = real + BatchFrames * Bins;
        for (int i = 0; i < Bins; i++) fft[i] = new Complex(outputs[0][real + i], outputs[0][imaginary + i]);
        fft[0] = new Complex(fft[0].Real, 0); fft[Bins - 1] = new Complex(fft[Bins - 1].Real, 0);
        for (int i = Bins; i < WindowSize; i++) fft[i] = Complex.Conjugate(fft[WindowSize - i]);
        Transform(true);
        for (int i = 0; i < WindowSize; i++) overlap[i * 2 + channel] += (float)(fft[i].Real / WindowSize * window[i]);
      }
      var normalization = Normalizations[normalizationPhase];
      for (int i = 0; i < Step; i++)
        for (int channel = 0; channel < 2; channel++) vocals[(frame * Step + i) * 2 + channel] = normalization[i] > 1e-8f ? overlap[i * 2 + channel] / normalization[i] : 0;
      Array.Copy(overlap, Step * 2, overlap, 0, Delay * 2);
      Array.Clear(overlap, Delay * 2, Step * 2);
      if (normalizationPhase < Normalizations.Length - 1) normalizationPhase++;
    }
    // Reuse the produced recurrent state with its pinned tensor, keeping both buffers separate.
    for (int i = 1; i < outputs.Length; i++)
    {
      (inputs[i], outputs[i]) = (outputs[i], inputs[i]);
      (inputValues[i], outputValues[i]) = (outputValues[i], inputValues[i]);
    }
    bindingIndex ^= 1;
  }

  // Double-precision twiddles preserve quiet frequency bins used by BandNorm.
  void Transform(bool inverse)
  {
    foreach (var swap in ReversalSwaps) (fft[swap.First], fft[swap.Second]) = (fft[swap.Second], fft[swap.First]);
    var roots = inverse ? InverseRoots : Roots;
    for (int length = 2; length <= WindowSize; length <<= 1)
    {
      int rootStep = WindowSize / length;
      for (int start = 0; start < WindowSize; start += length)
        for (int i = 0; i < length / 2; i++)
        {
          var root = roots[i * rootStep];
          var even = fft[start + i];
          var odd = fft[start + i + length / 2] * root;
          fft[start + i] = even + odd;
          fft[start + i + length / 2] = even - odd;
        }
    }
  }

  static (int First, int Second)[] CreateReversalSwaps()
  {
    var swaps = new List<(int, int)>();
    for (int i = 1, j = 0; i < WindowSize; i++)
    {
      int bit = WindowSize >> 1;
      for (; (j & bit) != 0; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) swaps.Add((i, j));
    }
    return swaps.ToArray();
  }

  static float[][] CreateNormalizations()
  {
    var values = new float[WindowSize / Step][];
    for (int phase = 0; phase < values.Length; phase++)
    {
      values[phase] = new float[Step];
      for (int i = 0; i < Step; i++)
        // Match the rolling window's float addition order, including startup phases.
        for (int offset = phase * Step; offset >= 0; offset -= Step)
          values[phase][i] += window[i + offset] * window[i + offset];
    }
    return values;
  }

  public void Reset()
  {
    // Keep the binding direction paired with the current input/output buffers.
    foreach (float[] values in inputs) Array.Clear(values);
    foreach (float[] values in outputs) Array.Clear(values);
    Array.Clear(history); Array.Clear(overlap); normalizationPhase = 0;
    Array.Clear(alignedOriginal);
  }
  public void Dispose()
  {
    foreach (var binding in bindings) binding.Dispose();
    foreach (var value in inputValues) value.Dispose();
    foreach (var value in outputValues) value.Dispose();
    runOptions?.Dispose(); session?.Dispose();
  }
}
