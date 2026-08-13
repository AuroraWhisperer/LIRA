'use strict';

const WESING_NATIVE_MONITOR_SOURCE = String.raw`
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public sealed class WeSingPlaybackWindow
{
    public IntPtr Handle { get; set; }
    public string Title { get; set; }
}

public static class WeSingNativeMonitor
{
    private delegate bool EnumWindowsProc(IntPtr handle, IntPtr parameter);

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr parameter);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr handle, out uint processId);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr handle, StringBuilder text, int count);

    [DllImport("user32.dll")]
    private static extern int GetWindowTextLength(IntPtr handle);

    public static WeSingPlaybackWindow FindPlaybackWindow(int[] processIds)
    {
        var wanted = new HashSet<int>(processIds ?? new int[0]);
        WeSingPlaybackWindow result = null;
        EnumWindows((handle, ignored) =>
        {
            uint processId;
            GetWindowThreadProcessId(handle, out processId);
            if (!wanted.Contains((int)processId)) return true;
            int length = GetWindowTextLength(handle);
            if (length <= 0) return true;
            var text = new StringBuilder(length + 1);
            GetWindowText(handle, text, text.Capacity);
            string title = text.ToString();
            if (!title.StartsWith("全民K歌 - ", StringComparison.Ordinal) || title.Length <= 7) return true;
            result = new WeSingPlaybackWindow { Handle = handle, Title = title };
            return false;
        }, IntPtr.Zero);
        return result;
    }

    public static int GetAudioSessionState(int[] processIds)
    {
        var wanted = new HashSet<int>(processIds ?? new int[0]);
        object deviceEnumeratorObject = null;
        IMMDevice device = null;
        object managerObject = null;
        IAudioSessionEnumerator sessions = null;
        try
        {
            deviceEnumeratorObject = new MMDeviceEnumeratorComObject();
            var deviceEnumerator = (IMMDeviceEnumerator)deviceEnumeratorObject;
            Marshal.ThrowExceptionForHR(deviceEnumerator.GetDefaultAudioEndpoint(0, 1, out device));
            Guid managerId = typeof(IAudioSessionManager2).GUID;
            Marshal.ThrowExceptionForHR(device.Activate(ref managerId, 23, IntPtr.Zero, out managerObject));
            var manager = (IAudioSessionManager2)managerObject;
            Marshal.ThrowExceptionForHR(manager.GetSessionEnumerator(out sessions));
            int count;
            Marshal.ThrowExceptionForHR(sessions.GetCount(out count));
            bool found = false;
            for (int index = 0; index < count; index += 1)
            {
                IAudioSessionControl control = null;
                try
                {
                    if (sessions.GetSession(index, out control) < 0 || control == null) continue;
                    var control2 = (IAudioSessionControl2)control;
                    int processId;
                    if (control2.GetProcessId(out processId) < 0 || !wanted.Contains(processId)) continue;
                    found = true;
                    AudioSessionState state;
                    if (control.GetState(out state) >= 0 && state == AudioSessionState.Active) return 1;
                }
                finally
                {
                    ReleaseComObject(control);
                }
            }
            return found ? 0 : -1;
        }
        catch
        {
            return -1;
        }
        finally
        {
            ReleaseComObject(sessions);
            ReleaseComObject(managerObject);
            ReleaseComObject(device);
            ReleaseComObject(deviceEnumeratorObject);
        }
    }

    private static void ReleaseComObject(object value)
    {
        if (value == null || !Marshal.IsComObject(value)) return;
        try { Marshal.FinalReleaseComObject(value); } catch { }
    }
}

public enum AudioSessionState { Inactive = 0, Active = 1, Expired = 2 }

[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
internal class MMDeviceEnumeratorComObject { }

[ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("A95664D2-9614-4F35-A746-DE8DB63617E6")]
internal interface IMMDeviceEnumerator
{
    [PreserveSig] int EnumAudioEndpoints(int dataFlow, uint stateMask, out object devices);
    [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
    [PreserveSig] int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMMDevice device);
    [PreserveSig] int RegisterEndpointNotificationCallback(IntPtr client);
    [PreserveSig] int UnregisterEndpointNotificationCallback(IntPtr client);
}

[ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("D666063F-1587-4E43-81F1-B948E807363F")]
internal interface IMMDevice
{
    [PreserveSig] int Activate(ref Guid interfaceId, int classContext, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object instance);
    [PreserveSig] int OpenPropertyStore(int access, out IntPtr properties);
    [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
    [PreserveSig] int GetState(out uint state);
}

[ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F")]
internal interface IAudioSessionManager2
{
    [PreserveSig] int GetAudioSessionControl(ref Guid sessionId, uint streamFlags, out IAudioSessionControl control);
    [PreserveSig] int GetSimpleAudioVolume(ref Guid sessionId, uint crossProcess, out IntPtr volume);
    [PreserveSig] int GetSessionEnumerator(out IAudioSessionEnumerator sessions);
    [PreserveSig] int RegisterSessionNotification(IntPtr notification);
    [PreserveSig] int UnregisterSessionNotification(IntPtr notification);
    [PreserveSig] int RegisterDuckNotification([MarshalAs(UnmanagedType.LPWStr)] string sessionId, IntPtr notification);
    [PreserveSig] int UnregisterDuckNotification(IntPtr notification);
}

[ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8")]
internal interface IAudioSessionEnumerator
{
    [PreserveSig] int GetCount(out int count);
    [PreserveSig] int GetSession(int index, out IAudioSessionControl control);
}

[ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("F4B1A599-7266-4319-A8CA-E70ACB11E8CD")]
internal interface IAudioSessionControl
{
    [PreserveSig] int GetState(out AudioSessionState state);
    [PreserveSig] int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string name);
    [PreserveSig] int SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string name, ref Guid eventContext);
    [PreserveSig] int GetIconPath([MarshalAs(UnmanagedType.LPWStr)] out string path);
    [PreserveSig] int SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string path, ref Guid eventContext);
    [PreserveSig] int GetGroupingParam(out Guid groupingId);
    [PreserveSig] int SetGroupingParam(ref Guid groupingId, ref Guid eventContext);
    [PreserveSig] int RegisterAudioSessionNotification(IntPtr events);
    [PreserveSig] int UnregisterAudioSessionNotification(IntPtr events);
}

[ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D")]
internal interface IAudioSessionControl2
{
    [PreserveSig] int GetState(out AudioSessionState state);
    [PreserveSig] int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string name);
    [PreserveSig] int SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string name, ref Guid eventContext);
    [PreserveSig] int GetIconPath([MarshalAs(UnmanagedType.LPWStr)] out string path);
    [PreserveSig] int SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string path, ref Guid eventContext);
    [PreserveSig] int GetGroupingParam(out Guid groupingId);
    [PreserveSig] int SetGroupingParam(ref Guid groupingId, ref Guid eventContext);
    [PreserveSig] int RegisterAudioSessionNotification(IntPtr events);
    [PreserveSig] int UnregisterAudioSessionNotification(IntPtr events);
    [PreserveSig] int GetSessionIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string sessionId);
    [PreserveSig] int GetSessionInstanceIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string instanceId);
    [PreserveSig] int GetProcessId(out int processId);
    [PreserveSig] int IsSystemSoundsSession();
    [PreserveSig] int SetDuckingPreference([MarshalAs(UnmanagedType.Bool)] bool optOut);
}
`;

module.exports = { WESING_NATIVE_MONITOR_SOURCE };
