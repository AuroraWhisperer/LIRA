using System.Runtime.InteropServices;

internal sealed class RubberBandProcessor : IDisposable
{
  const int BlockFrames = 1024;
  // Real-time, single-threaded R3; preserve stereo relationships and support live pitch changes.
  const int Options = 0x1 | 0x10000 | 0x4000000 | 0x10000000 | 0x20000000;
  readonly float[][] channels = { new float[BlockFrames], new float[BlockFrames] };
  readonly GCHandle[] pins = new GCHandle[2];
  readonly IntPtr[] pointers = new IntPtr[2];
  IntPtr state;
  int skip;
  long emittedFrames;
  double expectedFrames;
  double tempo = 1;
  int semitones;

  static RubberBandProcessor()
  {
    NativeLibrary.SetDllImportResolver(typeof(RubberBandProcessor).Assembly, (name, _, _) => name == "rubberband"
      ? NativeLibrary.Load(Path.Combine(AppContext.BaseDirectory, "vendor", "rubberband-x64.dll")) : IntPtr.Zero);
  }

  public double Tempo
  {
    set { tempo = value; if (state != IntPtr.Zero) SetTimeRatio(state, 1 / value); }
  }

  public int PitchSemiTones
  {
    set { semitones = value; if (state != IntPtr.Zero) SetPitchScale(state, Math.Pow(2, value / 12d)); }
  }

  void Initialize()
  {
    state = New(48000, 2, Options, 1 / tempo, Math.Pow(2, semitones / 12d));
    if (state == IntPtr.Zero) throw new InvalidOperationException("变速变调引擎初始化失败。");
    try
    {
      for (int channel = 0; channel < 2; channel++)
      {
        pins[channel] = GCHandle.Alloc(channels[channel], GCHandleType.Pinned);
        pointers[channel] = pins[channel].AddrOfPinnedObject();
      }
      SetMaxProcessSize(state, BlockFrames);
      skip = (int)GetStartDelay(state);
      // Real-time Rubber Band needs input padding and matching output trimming.
      int pad = (int)GetPreferredStartPad(state);
      while (pad > 0)
      {
        int frames = Math.Min(pad, BlockFrames);
        Process(state, pointers, (uint)frames, 0);
        pad -= frames;
      }
    }
    catch { Dispose(); throw; }
  }

  public void PutSamples(ReadOnlySpan<float> samples, int frames)
  {
    if (state == IntPtr.Zero) Initialize();
    for (int offset = 0; offset < frames; offset += BlockFrames)
    {
      int count = Math.Min(BlockFrames, frames - offset);
      for (int i = 0; i < count; i++)
      {
        channels[0][i] = samples[(offset + i) * 2];
        channels[1][i] = samples[(offset + i) * 2 + 1];
      }
      Process(state, pointers, (uint)count, 0);
      expectedFrames += count / tempo;
    }
  }

  public int ReceiveSamples(Span<float> destination, int frames)
  {
    if (state == IntPtr.Zero) return 0;
    while (true)
    {
      int count = Math.Min(Available(state), BlockFrames);
      if (count <= 0) return 0;
      if (skip > 0)
      {
        count = Math.Min(count, skip);
        skip -= (int)Retrieve(state, pointers, (uint)count);
        continue;
      }
      count = (int)Math.Min(Math.Min(count, frames), Math.Max(0, (long)Math.Round(expectedFrames) - emittedFrames));
      if (count == 0) return 0;
      count = (int)Retrieve(state, pointers, (uint)count);
      for (int i = 0; i < count; i++)
      {
        destination[i * 2] = channels[0][i];
        destination[i * 2 + 1] = channels[1][i];
      }
      emittedFrames += count;
      return count;
    }
  }

  public void Flush()
  {
    if (state != IntPtr.Zero) Process(state, pointers, 0, 1);
  }

  public void Dispose()
  {
    if (state != IntPtr.Zero) { Delete(state); state = IntPtr.Zero; }
    foreach (var pin in pins) if (pin.IsAllocated) pin.Free();
    Array.Clear(pins);
  }

  [DllImport("rubberband", EntryPoint = "rubberband_new", CallingConvention = CallingConvention.Cdecl)]
  static extern IntPtr New(uint rate, uint channels, int options, double timeRatio, double pitchScale);
  [DllImport("rubberband", EntryPoint = "rubberband_delete", CallingConvention = CallingConvention.Cdecl)]
  static extern void Delete(IntPtr state);
  [DllImport("rubberband", EntryPoint = "rubberband_set_time_ratio", CallingConvention = CallingConvention.Cdecl)]
  static extern void SetTimeRatio(IntPtr state, double ratio);
  [DllImport("rubberband", EntryPoint = "rubberband_set_pitch_scale", CallingConvention = CallingConvention.Cdecl)]
  static extern void SetPitchScale(IntPtr state, double scale);
  [DllImport("rubberband", EntryPoint = "rubberband_get_preferred_start_pad", CallingConvention = CallingConvention.Cdecl)]
  static extern uint GetPreferredStartPad(IntPtr state);
  [DllImport("rubberband", EntryPoint = "rubberband_get_start_delay", CallingConvention = CallingConvention.Cdecl)]
  static extern uint GetStartDelay(IntPtr state);
  [DllImport("rubberband", EntryPoint = "rubberband_set_max_process_size", CallingConvention = CallingConvention.Cdecl)]
  static extern void SetMaxProcessSize(IntPtr state, uint frames);
  [DllImport("rubberband", EntryPoint = "rubberband_process", CallingConvention = CallingConvention.Cdecl)]
  static extern void Process(IntPtr state, IntPtr[] samples, uint frames, int final);
  [DllImport("rubberband", EntryPoint = "rubberband_available", CallingConvention = CallingConvention.Cdecl)]
  static extern int Available(IntPtr state);
  [DllImport("rubberband", EntryPoint = "rubberband_retrieve", CallingConvention = CallingConvention.Cdecl)]
  static extern uint Retrieve(IntPtr state, IntPtr[] samples, uint frames);
}
