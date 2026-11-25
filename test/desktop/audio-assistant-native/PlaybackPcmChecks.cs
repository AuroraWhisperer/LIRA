using System.Runtime.InteropServices;
using System.Text.Json;

internal static class PlaybackPcmChecks
{
  public static void Run()
  {
    var pcm = new byte[16384];
    var samples = Enumerable.Range(0, 2048).Select(i => (i - 1024) / 1024f).ToArray();
    var expected = MemoryMarshal.AsBytes(samples.AsSpan());
    string encoded = Convert.ToBase64String(expected);
    using var packet = JsonDocument.Parse($"\"{encoded}\"");
    int length = PlaybackOutputContext.DecodePcm(packet.RootElement, pcm);
    if (!expected.SequenceEqual(pcm.AsSpan(0, length))) throw new Exception("Stereo packet changed during decoding.");

    long before = Measure(() => Convert.TryFromBase64String(packet.RootElement.GetString()!, pcm, out _));
    long after = Measure(() => PlaybackOutputContext.DecodePcm(packet.RootElement, pcm));
    if (after >= encoded.Length * 1000L) throw new Exception("PCM decoding still allocates a large buffer per packet.");
    Console.WriteLine($"1000 standard PCM packets: GetString + decode {before} B; direct decode + validation {after} B.");

    int Decode(string json)
    {
      using var document = JsonDocument.Parse(json);
      return PlaybackOutputContext.DecodePcm(document.RootElement, pcm);
    }
    // Check the length after unescaping, including a maximum-size packet.
    var full = new byte[pcm.Length];
    var first = MemoryMarshal.Cast<byte, float>(full.AsSpan());
    first[0] = BitConverter.Int32BitsToSingle(0x3effffff);
    first[1] = 2;
    first[2] = -2;
    string fullPacket = Convert.ToBase64String(full);
    first[1] = 1;
    first[2] = -1;
    foreach (var body in new[] { fullPacket, fullPacket.Replace("/", "\\/").Replace("=", "\\u003d") })
      if (Decode($"\"{body}\"") != full.Length || !full.AsSpan().SequenceEqual(pcm))
        throw new Exception("Maximum-size PCM or sample clamping changed.");
    if (Decode("\"AAAA AAAA AAA=\"") != 8 || Decode("\"AAAA\\nAAAAAAA=\"") != 8)
      throw new Exception("Base64 whitespace handling changed.");

    foreach (string json in new[] {
      "null", "123", "\"\"", "\"AAAA\"", "\"AAAA!AAAAAA=\"", "\"AAAAAAAAAAA=A\"",
      "\"AAAAAAAAAAA\\u0021\"", $"\"{new string(' ', 21840)}AAAAAAAAAAA=\"",
      $"\"{Convert.ToBase64String(new byte[16392])}\"",
      $"\"{Convert.ToBase64String(MemoryMarshal.AsBytes(new float[] { 0, float.NaN }.AsSpan()))}\"",
      $"\"{Convert.ToBase64String(MemoryMarshal.AsBytes(new float[] { float.PositiveInfinity, 0 }.AsSpan()))}\"",
    })
    {
      try { Decode(json); }
      catch (ArgumentException) { continue; }
      throw new Exception("Invalid PCM was accepted.");
    }
    Console.WriteLine("PCM frame length, JSON escapes, padding, finite samples and clamping checks passed.");
  }

  static long Measure(Action decode)
  {
    decode();
    long start = GC.GetAllocatedBytesForCurrentThread();
    for (int i = 0; i < 1000; i++) decode();
    return GC.GetAllocatedBytesForCurrentThread() - start;
  }
}
