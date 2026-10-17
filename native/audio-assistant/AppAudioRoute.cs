using System.Runtime.InteropServices;

// Windows internal per-application audio routing ABI.
internal sealed class AppAudioRoute : IDisposable
{
  const string RuntimeClass = "Windows.Media.Internal.AudioPolicyConfig";
  const string Prefix = @"\\?\SWD#MMDEVAPI#";
  const string RenderSuffix = "#{e6327cad-dcec-4949-ae8a-991e976a79d2}";
  readonly IntPtr factory;
  readonly bool initialized;
  readonly SetEndpoint set;
  readonly GetEndpoint get;

  [UnmanagedFunctionPointer(CallingConvention.StdCall)]
  delegate int SetEndpoint(IntPtr self, uint pid, int flow, int role, IntPtr device);
  [UnmanagedFunctionPointer(CallingConvention.StdCall)]
  delegate int GetEndpoint(IntPtr self, uint pid, int flow, int role, out IntPtr device);
  [DllImport("combase.dll")] static extern int RoInitialize(uint type);
  [DllImport("combase.dll")] static extern void RoUninitialize();
  [DllImport("combase.dll")] static extern int RoGetActivationFactory(IntPtr name, ref Guid iid, out IntPtr factory);
  [DllImport("combase.dll", CharSet = CharSet.Unicode)] static extern int WindowsCreateString(string value, int length, out IntPtr result);
  [DllImport("combase.dll")] static extern int WindowsDeleteString(IntPtr value);
  [DllImport("combase.dll")] static extern IntPtr WindowsGetStringRawBuffer(IntPtr value, out uint length);

  public AppAudioRoute()
  {
    int hr = RoInitialize(0);
    if (hr < 0 && hr != unchecked((int)0x80010106)) Marshal.ThrowExceptionForHR(hr);
    initialized = hr >= 0;
    IntPtr name = ToHString(RuntimeClass);
    try
    {
      var iid = new Guid("ab3d4648-e242-459f-b02f-541c70306324");
      hr = RoGetActivationFactory(name, ref iid, out factory);
      if (hr < 0)
      {
        iid = new Guid("2a59116d-6c4f-45e0-a74f-707e3fef9258");
        hr = RoGetActivationFactory(name, ref iid, out factory);
      }
      Marshal.ThrowExceptionForHR(hr);
      IntPtr table = Marshal.ReadIntPtr(factory);
      // Six IInspectable slots and nineteen preceding AudioPolicy methods.
      set = Marshal.GetDelegateForFunctionPointer<SetEndpoint>(Marshal.ReadIntPtr(table, 25 * IntPtr.Size));
      get = Marshal.GetDelegateForFunctionPointer<GetEndpoint>(Marshal.ReadIntPtr(table, 26 * IntPtr.Size));
    }
    catch { Dispose(); throw; }
    finally { WindowsDeleteString(name); }
  }

  public static string Encode(string endpointId) => Prefix + endpointId + RenderSuffix;

  public string? Get(int pid, int role)
  {
    int hr = get(factory, (uint)pid, 0, role, out IntPtr text);
    try
    {
      if (hr == unchecked((int)0x80070490)) return null;
      Marshal.ThrowExceptionForHR(hr);
      IntPtr value = WindowsGetStringRawBuffer(text, out uint length);
      return length == 0 ? null : Marshal.PtrToStringUni(value, (int)length);
    }
    finally { if (text != IntPtr.Zero) WindowsDeleteString(text); }
  }

  public void Set(int pid, int role, string? encodedEndpoint)
  {
    IntPtr value = string.IsNullOrEmpty(encodedEndpoint) ? IntPtr.Zero : ToHString(encodedEndpoint);
    try { Marshal.ThrowExceptionForHR(set(factory, (uint)pid, 0, role, value)); }
    finally { if (value != IntPtr.Zero) WindowsDeleteString(value); }
  }

  static IntPtr ToHString(string value)
  {
    Marshal.ThrowExceptionForHR(WindowsCreateString(value, value.Length, out IntPtr result));
    return result;
  }

  public void Dispose()
  {
    if (factory != IntPtr.Zero) Marshal.Release(factory);
    if (initialized) RoUninitialize();
  }
}
