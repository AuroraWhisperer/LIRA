using System.Reflection;
using System.Runtime.CompilerServices;
using System.Text;
using System.Text.Json;
using NAudio.Wave;
using NAudio.Wave.SampleProviders;

internal static class StateFrameChecks
{
  static readonly string[] Lists = ["apps", "outputs", "outputChoices", "inputs"];
  const BindingFlags Private = BindingFlags.Instance | BindingFlags.NonPublic;
  static T Bare<T>() where T : class => (T)RuntimeHelpers.GetUninitializedObject(typeof(T));
  static void Set(object target, string field, object? value) => target.GetType().GetField(field, Private)!.SetValue(target, value);
  static void Check(bool condition, string detail) { if (!condition) throw new Exception(detail); }

  sealed class Pipe : StringWriter
  {
    public string[] Lines() => ToString().Split(NewLine, StringSplitOptions.RemoveEmptyEntries);
    public JsonElement Last() => JsonSerializer.Deserialize<JsonElement>(Lines()[^1]);
  }

  static bool Full(JsonElement state) => Lists.All(key => state.GetProperty(key).ValueKind == JsonValueKind.Array);
  static int Bytes(string[] lines) => lines.Skip(1).Sum(line => Encoding.UTF8.GetByteCount(line + Environment.NewLine));

  public static async Task Run(string? tracePath = null)
  {
    var session = Bare<AudioSession>(); // Its regular constructor opens Windows endpoints.
    var tone = new SignalGenerator(48000, 2) { Gain = .75, Type = SignalGeneratorType.Square };
    using var dsp = new DspSource(tone) { OutputVolume = 1 };
    using var engine = Bare<AudioEngine>();
    Set(engine, "dsp", dsp);
    Set(session, "engine", engine);
    Set(session, "settings", new AssistantSettings());
    Set(session, "source", "input");
    Set(session, "status", "fixture");
    Set(session, "inputError", "");
    var player = new AudioApp(17, "Test", "Track", true, "", "", true);
    Set(session, "apps", new List<AudioApp> { player });
    Set(session, "outputs", new List<(string, string)> { ("out", "Output") });
    Set(session, "inputs", new List<(string, string)> { ("in", "Input") });
    Set(session, "playbackOutputs", new List<PlaybackOutput> { new("asio:Studio", "ASIO：Studio", "asio", "") });
    using var pipe = new Pipe();
    using var oldPipe = new Pipe();
    var output = new AssistantStateOutput(session, pipe, meterFrames: true);
    var oldOutput = new AssistantStateOutput(session, oldPipe, meterFrames: false);
    session.Changed += output.Publish;
    session.Changed += oldOutput.Publish;
    output.Publish();
    oldOutput.Publish();
    var pcm = new float[960];
    for (int i = 0; i < 11; i++)
    {
      if (i < 10) dsp.Read(pcm, 0, pcm.Length);
      await session.Tick(() => { output.PublishLevels(); oldOutput.PublishLevels(); });
    }
    var modern = pipe.Lines();
    var legacy = oldPipe.Lines();
    Check(modern.Length == 12 && legacy.Length == 12, "Expected a seed and eleven ticks for both protocols.");
    for (int i = 0; i < modern.Length; i++)
    {
      var frame = JsonSerializer.Deserialize<JsonElement>(modern[i]);
      var state = frame.GetProperty("state");
      var oldState = JsonSerializer.Deserialize<JsonElement>(legacy[i]).GetProperty("state");
      Check(Full(oldState) && oldState.GetProperty("level").GetSingle() == (i is > 0 and <= 10 ? .75f : 0f), "Legacy levels or choices lost.");
      if (i == 0) Check(frame.GetProperty("type").GetString() == "state" && Full(state), "Missing initial inventory.");
      else Check(frame.GetProperty("type").GetString() == "levels" && !Lists.Any(k => state.TryGetProperty(k, out _))
        && state.EnumerateObject().All(p => JsonElement.DeepEquals(p.Value, oldState.GetProperty(p.Name))), "Partial frame lost live state.");
    }
    Console.WriteLine($"PASS stable: ticks=11, listFrames modern=0 legacy=11, UTF8 pipeBytes modern={Bytes(modern)} legacy={Bytes(legacy)} (includes newlines)");
    if (tracePath != null) File.WriteAllText(tracePath, JsonSerializer.Serialize(new { modern, legacy }));

    Set(session, "source", "pid:17");
    output.Publish();
    void Players(params AudioApp[] choices) { Set(session, "apps", choices.ToList()); output.PublishLevels(); }
    Players(player with { Playing = false, Device = "New route" });
    Check(pipe.Last().GetProperty("type").GetString() == "levels" &&
      pipe.Last().GetProperty("state").GetProperty("sourceDevice").GetString() == "New route", "The route can change without a menu change.");
    var renamed = player with { Title = "Next" };
    var other = player with { Pid = 18 };
    Players(renamed);
    Check(pipe.Last().GetProperty("state").GetProperty("apps")[0].GetProperty("name").GetString()!.Contains("Next"), "Rename lost.");
    Players(renamed, other);
    Players(other, renamed);
    Check(pipe.Last().GetProperty("state").GetProperty("apps")[0].GetProperty("id").GetString() == "pid:18", "New order lost.");
    Players();
    Check(pipe.Last().GetProperty("state").GetProperty("apps").GetArrayLength() == 0, "Empty player list lost.");
    Players();
    Check(pipe.Last().GetProperty("type").GetString() == "levels", "An unchanged empty inventory was resent.");
    Console.WriteLine("PASS player refresh: same labels/new route, rename, add, reorder and clear");

    Set(session, "inputs", new List<(string, string)>());
    Set(session, "outputs", new List<(string, string)> { ("out", "Renamed output") });
    Set(session, "playbackOutputs", new List<PlaybackOutput>());
    output.Reply(23);
    var replyLines = pipe.Lines();
    var notification = JsonSerializer.Deserialize<JsonElement>(replyLines[^2]).GetProperty("state");
    var reply = pipe.Last();
    Check(Full(notification) && notification.GetProperty("inputs").GetArrayLength() == 0 &&
      notification.GetProperty("outputChoices").GetArrayLength() == 0 &&
      notification.GetProperty("outputs")[0].GetProperty("name").GetString() == "Renamed output" &&
      reply.GetProperty("id").GetInt32() == 23 && JsonElement.DeepEquals(notification, reply.GetProperty("state")), "Refresh reply and push diverged.");
    Console.WriteLine("PASS command: complete notification and reply include replacement and empty choices");

    Set(session, "engine", null);
    int count = pipe.Lines().Length;
    await session.Tick(output.PublishLevels);
    Check(pipe.Lines().Length == count, "Idle tick published a frame.");
    Console.WriteLine("PASS idle: zero frames");
  }
}
