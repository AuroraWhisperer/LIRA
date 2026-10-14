'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { NETEASE_NATIVE_PLAYER_SOURCE } = require('../../src/music/netease-native-player-source');
const { createScratchDirectory } = require('../helpers/scratch-directory');

test('NetEase native reader validates synthetic code signatures and coherent playback fields', { skip: process.platform !== 'win32' }, (t) => {
  const fixture = String.raw`
public static class NeteaseNativeFixture {
  private const long Module = 0x100000;
  private const int Player = 0x2100;
  private const int Clock = 0x2240;
  private static byte[] memory;
  private static bool changeDuringRead;
  private static byte[] Read(long address, int size) {
    int offset = checked((int)(address - Module));
    if (offset < 0 || size < 1 || offset + size > memory.Length) throw new Exception("Read outside synthetic image");
    var result = new byte[size];
    Array.Copy(memory, offset, result, 0, size);
    if (changeDuringRead && offset == Clock) memory[0x2400] = (byte)'9';
    return result;
  }
  private static void Put(int offset, byte[] value) { value.CopyTo(memory, offset); }
  private static void Pattern(int offset, string pattern, int operand, int target) {
    var tokens = pattern.Split(' ');
    for (int index = 0; index < tokens.Length; index++) memory[offset + index] = tokens[index] == "?" ? (byte)0 : Convert.ToByte(tokens[index], 16);
    Put(offset + operand, BitConverter.GetBytes(target - offset - operand - 4));
  }
  private static void Section(int offset, string name, int rva, uint flags) {
    Put(offset, Encoding.ASCII.GetBytes(name));
    Put(offset + 8, BitConverter.GetBytes(0x1000));
    Put(offset + 12, BitConverter.GetBytes(rva));
    Put(offset + 36, BitConverter.GetBytes(flags));
  }
  private static void Identity(string value, bool inline) {
    Array.Clear(memory, 0x2310, 32);
    Put(0x2320, BitConverter.GetBytes((long)value.Length));
    Put(0x2328, BitConverter.GetBytes(inline ? 15L : 31L));
    if (!inline) Put(0x2310, BitConverter.GetBytes(Module + 0x2400));
    Put(inline ? 0x2310 : 0x2400, Encoding.ASCII.GetBytes(value + "\0"));
  }
  private static void Initialize() {
    memory = new byte[0x4000];
    changeDuringRead = false;
    Put(0, BitConverter.GetBytes((ushort)0x5A4D));
    Put(0x3C, BitConverter.GetBytes(0x80));
    Put(0x80, BitConverter.GetBytes(0x4550));
    Put(0x84, BitConverter.GetBytes((ushort)0x8664));
    Put(0x86, BitConverter.GetBytes((ushort)2));
    Put(0x94, BitConverter.GetBytes((ushort)0xF0));
    Put(0x98, BitConverter.GetBytes((ushort)0x20B));
    Section(0x188, ".text", 0x1000, 0x60000020);
    Section(0x1B0, ".data", 0x2000, 0xC0000040);
    Pattern(0x1000, NeteaseNativePlayer.PlayerPattern, 3, Player);
    Pattern(0x1100, NeteaseNativePlayer.ClockPattern, 4, Clock);
    Put(Player + 0x50, BitConverter.GetBytes(Module + 0x2300));
    Put(Player + 0x60, BitConverter.GetBytes(1));
    Put(Player + 0xA8, BitConverter.GetBytes(200.007959));
    Put(Clock, BitConverter.GetBytes(81.114));
    Identity("1234567890_A1B2C3", false);
  }
  private static void Check(bool result, string message) { if (!result) throw new Exception(message); }
  private static NeteaseNativeSnapshot Snapshot() { return NeteaseNativePlayer.ReadSnapshot(Read, Module + Player, Module + Clock); }
  private static bool Located() {
    long player, clock;
    NeteaseNativePlayer.Locate(Module, memory.Length, Read, out player, out clock);
    Check((player == 0) == (clock == 0), "Partial signature pair must not survive");
    return player == Module + Player && clock == Module + Clock;
  }
  public static void Run() {
    Initialize();
    Check(Located(), "Unique relative code signatures were not located");
    var sample = Snapshot();
    Check(sample.SourceTrackId == "1234567890" && sample.PlaybackStatus == "Playing" && sample.PositionMs == 81114 && sample.DurationMs == 200008, "Fractional playback or alphanumeric song suffix lost");
    Put(Player + 0x60, BitConverter.GetBytes(2));
    Put(Clock, BitConverter.GetBytes(3.25));
    Check(Snapshot().PlaybackStatus == "Paused" && Snapshot().PositionMs == 3250, "Paused seek was not read");
    Identity("123", true);
    Check(Snapshot().SourceTrackId == "123", "Inline song identity not supported");
    Put(Player + 0x60, BitConverter.GetBytes(0));
    Check(Snapshot() == null, "Stopped playback retained a clock");
    Initialize();
    Put(Clock, BitConverter.GetBytes(Double.NaN));
    Check(Snapshot() == null, "Non-finite position accepted");
    Put(Clock, BitConverter.GetBytes(201.0));
    Check(Snapshot() == null, "Position beyond duration accepted");
    Put(Clock, BitConverter.GetBytes(1.0));
    Put(Player + 0xA8, BitConverter.GetBytes(Double.PositiveInfinity));
    Check(Snapshot() == null, "Non-finite duration accepted");
    Initialize();
    Identity("../not-a-song", true);
    Check(Snapshot() == null, "Non-song identity accepted");
    Initialize();
    Put(0x2320, BitConverter.GetBytes(1024L));
    Check(Snapshot() == null, "Oversized identity read allowed");
    Initialize();
    changeDuringRead = true;
    Check(Snapshot() == null, "Identity changed during clock read");
    Initialize();
    memory[0x1100] = 0;
    Check(!Located(), "Missing signature accepted");
    Initialize();
    Pattern(0x1200, NeteaseNativePlayer.ClockPattern, 4, Clock);
    Check(!Located(), "Ambiguous signature accepted");
    Initialize();
    Pattern(0x1100, NeteaseNativePlayer.ClockPattern, 4, 0x3100);
    Check(!Located(), "Clock outside writable data accepted");
    Initialize();
    Put(0x1B0 + 12, BitConverter.GetBytes(Int32.MaxValue));
    Check(!Located(), "Section outside module accepted");
    Console.WriteLine("native fixture passed");
  }
}
`;
  const source = 'using System; using System.Text; using System.Text.RegularExpressions; using System.Runtime.InteropServices;\n' +
    NETEASE_NATIVE_PLAYER_SOURCE + fixture;
  const scriptPath = path.join(createScratchDirectory('netease-native-', t), 'reader.ps1');
  fs.writeFileSync(scriptPath, "\ufeff$ErrorActionPreference = 'Stop'\nAdd-Type -TypeDefinition @'\n" + source + "\n'@\n[NeteaseNativeFixture]::Run()\n");
  const result = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', scriptPath], {
    windowsHide: true, encoding: 'utf8', timeout: 15000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /native fixture passed/);
});
