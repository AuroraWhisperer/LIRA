'use strict';

// Player signatures and field layout adapted from Music-DiscordRPC:
// https://github.com/kriYamiHikari/Music-DiscordRPC/blob/master/MusicRpc/Players/NetEase.cs
// MIT License — Copyright (c) 2018 Kyle
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

const NETEASE_NATIVE_PLAYER_SOURCE = String.raw`
public sealed class NeteaseNativeSnapshot {
  public string SourceTrackId;
  public string PlaybackStatus;
  public double PositionMs;
  public double DurationMs;
}

// Read the audio engine, so hiding the player's UI does not hide its clock.
// No writes, injection, debug privilege, or reads outside playback fields/code.
public sealed class NeteaseNativePlayer : IDisposable {
  internal const string PlayerPattern = "48 8D 0D ? ? ? ? E8 ? ? ? ? 48 8D 0D ? ? ? ? E8 ? ? ? ? 90 48 8D 0D ? ? ? ? E8 ? ? ? ? 48 8D 05 ? ? ? ? 48 8D A5 ? ? ? ? 5F 5D C3 CC CC CC CC CC 48 89 4C 24 ? 55 57 48 81 EC ? ? ? ? 48 8D 6C 24 ? 48 8D 7C 24";
  internal const string ClockPattern = "66 0F 2E 0D ? ? ? ? 7A ? 75 ? 66 0F 2E 15";
  [DllImport("kernel32.dll")] private static extern IntPtr OpenProcess(uint access, bool inherit, int processId);
  [DllImport("kernel32.dll")] private static extern bool ReadProcessMemory(IntPtr process, IntPtr address,
    [Out] byte[] data, int size, out IntPtr obtained);
  [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr handle);
  private IntPtr process;
  private int processId;
  private long playerAddress;
  private long clockAddress;

  public void Dispose() {
    if (process != IntPtr.Zero) CloseHandle(process);
    process = IntPtr.Zero;
    processId = 0;
    playerAddress = clockAddress = 0;
  }

  private byte[] ReadBytes(long address, int size) {
    if (address < 0x10000 || address > 0x7FFFFFFFFFFF - size || size < 1 || size > 32 * 1024 * 1024)
      throw new InvalidOperationException("Invalid playback read");
    var data = new byte[size];
    IntPtr obtained;
    if (!ReadProcessMemory(process, new IntPtr(address), data, size, out obtained) || obtained.ToInt64() != size)
      throw new InvalidOperationException("Playback read unavailable");
    return data;
  }

  private void Attach(int id) {
    Dispose();
    processId = id;
    try {
      using (var target = System.Diagnostics.Process.GetProcessById(id)) {
        if (!String.Equals(target.ProcessName, "cloudmusic", StringComparison.OrdinalIgnoreCase)) return;
        foreach (System.Diagnostics.ProcessModule module in target.Modules) {
          if (!String.Equals(module.ModuleName, "cloudmusic.dll", StringComparison.OrdinalIgnoreCase)) continue;
          process = OpenProcess(0x0010, false, id); // PROCESS_VM_READ only
          if (process == IntPtr.Zero) return;
          Locate(module.BaseAddress.ToInt64(), module.ModuleMemorySize, ReadBytes, out playerAddress, out clockAddress);
          return;
        }
      }
    } catch {
      if (process != IntPtr.Zero) CloseHandle(process);
      process = IntPtr.Zero;
      playerAddress = clockAddress = 0;
    }
  }

  internal static void Locate(long module, int moduleSize, Func<long, int, byte[]> read,
    out long player, out long clock) {
    player = clock = 0;
    var header = read(module, 4096);
    if (moduleSize < 4096 || moduleSize > 128 * 1024 * 1024 || BitConverter.ToUInt16(header, 0) != 0x5A4D) return;
    int pe = BitConverter.ToInt32(header, 0x3C);
    if (pe < 64 || pe > 1024 || BitConverter.ToUInt32(header, pe) != 0x4550 ||
        BitConverter.ToUInt16(header, pe + 4) != 0x8664 || BitConverter.ToUInt16(header, pe + 24) != 0x20B) return;
    int sections = BitConverter.ToUInt16(header, pe + 6);
    int table = pe + 24 + BitConverter.ToUInt16(header, pe + 20);
    if (sections < 1 || sections > 32 || table < pe + 24 || table + sections * 40 > header.Length) return;
    long codeStart = 0, dataStart = 0, dataEnd = 0;
    int codeSize = 0;
    for (int index = 0; index < sections; index++) {
      int offset = table + index * 40;
      string name = Encoding.ASCII.GetString(header, offset, 8).TrimEnd('\0');
      int size = BitConverter.ToInt32(header, offset + 8);
      int rva = BitConverter.ToInt32(header, offset + 12);
      uint flags = BitConverter.ToUInt32(header, offset + 36);
      if (rva < 4096 || size < 1 || (long)rva + size > moduleSize) return;
      if (name == ".text" && (flags & 0x60000020) == 0x60000020 && size <= 32 * 1024 * 1024) {
        codeStart = module + rva;
        codeSize = size;
      }
      if (name == ".data" && (flags & 0xC0000000) == 0xC0000000) {
        dataStart = module + rva;
        dataEnd = dataStart + size;
      }
    }
    if (codeStart == 0 || dataStart == 0) return;
    var code = read(codeStart, codeSize);
    long playerMatch = FindUnique(code, codeStart, PlayerPattern, 3);
    long clockMatch = FindUnique(code, codeStart, ClockPattern, 4);
    if (playerMatch < dataStart || playerMatch > dataEnd - 0xB0 || clockMatch < dataStart || clockMatch > dataEnd - 8) return;
    player = playerMatch;
    clock = clockMatch;
  }

  private static long FindUnique(byte[] code, long start, string pattern, int displacementOffset) {
    var tokens = pattern.Split(' ');
    var bytes = new int[tokens.Length];
    for (int index = 0; index < tokens.Length; index++) bytes[index] = tokens[index] == "?" ? -1 : Convert.ToInt32(tokens[index], 16);
    long result = 0;
    int found = 0;
    for (int offset = 0; offset <= code.Length - bytes.Length; offset++) {
      if (code[offset] != bytes[0]) continue;
      bool matches = true;
      for (int index = 1; index < bytes.Length; index++) {
        if (bytes[index] >= 0 && code[offset + index] != bytes[index]) { matches = false; break; }
      }
      if (!matches) continue;
      if (++found > 1) return 0;
      result = start + offset + displacementOffset + 4 + BitConverter.ToInt32(code, offset + displacementOffset);
    }
    return result;
  }

  private static string ReadIdentity(Func<long, int, byte[]> read, long info) {
    if (info < 0x10000 || info > 0x7FFFFFFFFFFF - 48) return null;
    var value = read(info + 0x10, 32);
    long length = BitConverter.ToInt64(value, 16);
    long capacity = BitConverter.ToInt64(value, 24);
    if (length < 1 || length > 64 || capacity < length || capacity > 1024 * 1024) return null;
    var text = capacity < 16 ? value : read(BitConverter.ToInt64(value, 0), (int)length + 1);
    if (text[(int)length] != 0) return null;
    string identity = Encoding.ASCII.GetString(text, 0, (int)length);
    return Regex.IsMatch(identity, @"^[1-9][0-9]{0,19}(?:_[A-Za-z0-9_]+)?$") ? identity : null;
  }

  internal static NeteaseNativeSnapshot ReadSnapshot(Func<long, int, byte[]> read, long player, long clock) {
    var fields = read(player + 0x50, 0x60);
    long info = BitConverter.ToInt64(fields, 0);
    int state = BitConverter.ToInt32(fields, 0x10);
    double duration = BitConverter.ToDouble(fields, 0x58);
    if (state != 1 && state != 2) return null;
    string identity = ReadIdentity(read, info);
    if (identity == null) return null;
    double position = BitConverter.ToDouble(read(clock, 8), 0);
    if (Double.IsNaN(position) || Double.IsInfinity(position) || Double.IsNaN(duration) ||
        Double.IsInfinity(duration) || position < 0 || duration <= 0 || duration > 86400 || position > duration) return null;
    var after = read(player + 0x50, 0x18);
    if (BitConverter.ToInt64(after, 0) != info || BitConverter.ToInt32(after, 0x10) != state ||
        ReadIdentity(read, info) != identity) return null;
    return new NeteaseNativeSnapshot {
      SourceTrackId = identity.Split('_')[0], PlaybackStatus = state == 1 ? "Playing" : "Paused",
      PositionMs = Math.Round(position * 1000), DurationMs = Math.Round(duration * 1000)
    };
  }

  public NeteaseNativeSnapshot Read(int id) {
    if (id != processId) Attach(id);
    if (process == IntPtr.Zero || playerAddress == 0 || clockAddress == 0) return null;
    try { return ReadSnapshot(ReadBytes, playerAddress, clockAddress); }
    catch { return null; }
  }
}
`;

module.exports = { NETEASE_NATIVE_PLAYER_SOURCE };
