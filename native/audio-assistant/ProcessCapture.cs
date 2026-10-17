using System.Runtime.InteropServices;
using NAudio.CoreAudioApi;
using NAudio.CoreAudioApi.Interfaces;
using NAudio.Wave;

// Windows process-loopback: independent of the player's physical output endpoint.
public sealed class ProcessCapture : IDisposable
{
  readonly CancellationTokenSource cancellation = new();
  Task? worker;
  // 48 kHz stereo IEEE float bytes; consumers must copy before returning.
  public event Action<byte[], int>? Data;
  public event Action<Exception>? Failed;
  public long Frames { get; private set; }

  public Task Start(int pid)
  {
    var ready = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
    worker = Task.Run(() => {
      try
      {
        using var client = Activate(pid);
        using var signal = new EventWaitHandle(false, EventResetMode.AutoReset);
        client.Initialize(AudioClientShareMode.Shared,
          AudioClientStreamFlags.Loopback | AudioClientStreamFlags.EventCallback,
          0, 0, WaveFormat.CreateIeeeFloatWaveFormat(48000, 2), Guid.Empty);
        client.SetEventHandle(signal.SafeWaitHandle.DangerousGetHandle());
        var capture = client.AudioCaptureClient;
        byte[] samples = new byte[Math.Max(client.BufferSize * 8, 48000 * 8)];
        client.Start();
        ready.TrySetResult();
        try
        {
          while (!cancellation.IsCancellationRequested)
          {
            signal.WaitOne(50);
            while (capture.GetNextPacketSize() > 0)
            {
              var address = capture.GetBuffer(out int frames, out var flags);
              try
              {
                if (samples.Length < frames * 8) samples = new byte[frames * 8];
                if ((flags & AudioClientBufferFlags.Silent) != 0) Array.Clear(samples, 0, frames * 8);
                else Marshal.Copy(address, samples, 0, frames * 8);
                Frames += frames;
                Data?.Invoke(samples, frames);
              }
              finally { capture.ReleaseBuffer(frames); }
            }
          }
        }
        finally { client.Stop(); }
      }
      catch (Exception error) { ready.TrySetException(error); Failed?.Invoke(error); }
    });
    return ready.Task;
  }

  static AudioClient Activate(int pid)
  {
    var parameters = new ActivationParameters { Type = 1, ProcessId = (uint)pid, Mode = 0 };
    var data = Marshal.AllocHGlobal(Marshal.SizeOf<ActivationParameters>());
    var variant = Marshal.AllocHGlobal(Marshal.SizeOf<BlobVariant>());
    var completed = new Completion();
    try
    {
      Marshal.StructureToPtr(parameters, data, false);
      Marshal.StructureToPtr(new BlobVariant { Type = 65, Size = Marshal.SizeOf<ActivationParameters>(), Data = data }, variant, false);
      var iid = typeof(IAudioClient).GUID;
      Marshal.ThrowExceptionForHR(ActivateAudioInterfaceAsync("VAD\\Process_Loopback", ref iid, variant, completed, out var operation));
      if (!completed.Done.Wait(TimeSpan.FromSeconds(5))) throw new TimeoutException("打开播放器音频超时。");
      GC.KeepAlive(operation);
      Marshal.ThrowExceptionForHR(completed.Result);
      return new AudioClient((IAudioClient)(completed.Client ?? throw new InvalidOperationException("没有获取到播放器音频。")));
    }
    finally { Marshal.FreeHGlobal(variant); Marshal.FreeHGlobal(data); }
  }

  public void Dispose()
  {
    cancellation.Cancel();
    worker?.GetAwaiter().GetResult();
    cancellation.Dispose();
  }

  [StructLayout(LayoutKind.Sequential)]
  struct ActivationParameters { public int Type; public uint ProcessId; public int Mode; }
  [StructLayout(LayoutKind.Sequential)]
  struct BlobVariant { public ushort Type, Reserved1, Reserved2, Reserved3; public int Size; public IntPtr Data; }
  [DllImport("Mmdevapi.dll", ExactSpelling = true, CharSet = CharSet.Unicode)]
  static extern int ActivateAudioInterfaceAsync(string path, ref Guid iid, IntPtr parameters,
    ICompletion completion, out IOperation operation);
  [ComImport, Guid("72A22D78-CDE4-431D-B8CC-843A71199B6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IOperation
  {
    [PreserveSig] int GetActivateResult(out int result, [MarshalAs(UnmanagedType.IUnknown)] out object instance);
  }
  [ComVisible(true), Guid("41D949AB-9862-444A-80F6-C261334DA5EB"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface ICompletion { [PreserveSig] int ActivateCompleted(IOperation operation); }
  [ComVisible(true), Guid("94EA2B94-E9CC-49E0-C0FF-EE64CA8F5B90"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IAgileObject { }
  [ComVisible(true), ClassInterface(ClassInterfaceType.None)]
  public class Completion : ICompletion, IAgileObject
  {
    public readonly ManualResetEventSlim Done = new();
    public int Result;
    public object? Client;
    public int ActivateCompleted(IOperation operation)
    {
      try { int hr = operation.GetActivateResult(out Result, out var client); if (hr < 0) Result = hr; Client = client; }
      catch (Exception error) { Result = error.HResult; }
      finally { Done.Set(); }
      return 0;
    }
  }
}
