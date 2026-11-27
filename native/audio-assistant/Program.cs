using System.Text;
using System.Text.Json;

internal static class Program
{
  public static string DataDirectory => Environment.GetEnvironmentVariable("LIRA_AUDIO_DATA_DIR")
    ?? throw new InvalidOperationException("缺少电音助手数据目录。");

  [STAThread]
  static void Main(string[] args)
  {
    try
    {
      // A hidden WinExe has pipes but no console whose code page can be changed.
      Console.SetIn(new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false)));
      Console.SetOut(new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false)) { AutoFlush = true });
      Console.SetError(new StreamWriter(Console.OpenStandardError(), new UTF8Encoding(false)) { AutoFlush = true });
      Directory.CreateDirectory(DataDirectory);
      using var installationExit = new EventWaitHandle(false, EventResetMode.ManualReset,
        $"Local\\LiraAudioAssistant-Install-{Environment.ProcessId}");
      if (args.Length == 3 && args[0] == "--route-guard") { RouteSession.RunGuard(int.Parse(args[1]), args[2], installationExit); return; }
      if (args.Length == 2 && args[0] == "--recover-route") { RouteSession.RunRecovery(args[1], installationExit); return; }
      if (args.Length == 1 && args[0] == "--playback-output")
      {
        ApplicationConfiguration.Initialize();
        Application.Run(new PlaybackOutputContext(installationExit));
        return;
      }
      if (args.Length != 1 || args[0] != "--bridge") throw new ArgumentException("未知电音助手启动方式。");
      ApplicationConfiguration.Initialize();
      Application.Run(new AssistantContext(installationExit));
    }
    catch (Exception error) { Console.Error.WriteLine(error.Message); Environment.ExitCode = 1; }
  }
}

internal sealed class AssistantContext : ApplicationContext
{
  readonly Control dispatcher = new();
  readonly System.Windows.Forms.Timer timer = new() { Interval = 500 };
  readonly AudioSession session;
  readonly AssistantStateOutput output;
  bool ticking, closing;

  public AssistantContext(WaitHandle installationExit)
  {
    _ = dispatcher.Handle;
    session = new AudioSession(action => { if (!closing) dispatcher.BeginInvoke(action); });
    output = new(session, Console.Out, Environment.GetEnvironmentVariable("LIRA_AUDIO_METER_FRAMES") == "1");
    session.Changed += output.Publish;
    timer.Tick += async (_, _) => {
      if (installationExit.WaitOne(0)) { Close(); return; }
      if (ticking || closing) return;
      ticking = true;
      try { await session.Tick(output.PublishLevels); }
      catch (Exception error) { session.Fail(error); }
      finally { ticking = false; }
    };
    timer.Start();
    output.Publish();
    _ = Task.Run(async () => {
      string? line;
      while ((line = await Console.In.ReadLineAsync()) != null)
      {
        if (line.Length > 65536) break;
        var command = line;
        if (closing) return;
        dispatcher.BeginInvoke(() => Handle(command));
      }
      if (!closing) dispatcher.BeginInvoke(Close);
    });
  }

  async void Handle(string line)
  {
    int id = 0;
    try
    {
      using var document = JsonDocument.Parse(line);
      var request = document.RootElement;
      session.PlaybackProcessId = request.TryGetProperty("playbackProcessId", out var player)
        && player.ValueKind == JsonValueKind.Number && player.TryGetInt32(out int pid) && pid > 0 ? pid : null;
      id = request.GetProperty("id").GetInt32();
      string operation = request.GetProperty("op").GetString()!;
      var value = request.TryGetProperty("value", out var argument) ? argument : default;
      switch (operation)
      {
        case "get": break;
        case "configure": session.Configure(value); break;
        case "file": session.SelectFile(value.GetString()!); break;
        case "start": await session.Start(); break;
        case "stop": session.Stop(); break;
        case "refresh": session.Refresh(); break;
        case "recover": session.Recover(); break;
        default: throw new ArgumentException("未知电音助手操作。");
      }
      output.Reply(id);
    }
    catch (Exception error)
    {
      output.Reply(id, error.Message);
    }
  }

  void Close()
  {
    if (closing) return;
    closing = true;
    timer.Stop();
    session.Dispose();
    ExitThread();
  }

  protected override void Dispose(bool disposing)
  {
    if (disposing) { timer.Dispose(); session.Dispose(); dispatcher.Dispose(); }
    base.Dispose(disposing);
  }
}

internal sealed class AssistantStateOutput(AudioSession session, TextWriter writer, bool meterFrames)
{
  IReadOnlyList<AudioApp>? publishedApps;
  public void Publish() => WriteFrame(false);

  public void PublishLevels()
  {
    // Only the player list can be replaced during a running tick. Compare its visible choices on re-enumeration.
    var apps = session.Apps;
    bool same = ReferenceEquals(apps, publishedApps) || publishedApps != null && apps.Count == publishedApps.Count
      && apps.Select(Choice).SequenceEqual(publishedApps.Select(Choice));
    WriteFrame(meterFrames && same);
  }

  static (int, string, string) Choice(AudioApp app) => (app.Pid, app.Name, app.Title);

  void WriteFrame(bool levelsOnly)
  {
    writer.WriteLine(JsonSerializer.Serialize(new { type = levelsOnly ? "levels" : "state", state = session.Snapshot(levelsOnly) }, AssistantSettings.Json));
    writer.Flush();
    publishedApps = session.Apps;
  }

  public void Reply(int id, string? error = null)
  {
    string state = JsonSerializer.Serialize(session.Snapshot(), AssistantSettings.Json);
    writer.WriteLine($"{{\"type\":\"state\",\"state\":{state}}}");
    string outcome = error == null ? "\"ok\":true" : $"\"ok\":false,\"error\":{JsonSerializer.Serialize(error)}";
    writer.WriteLine($"{{\"id\":{id},{outcome},\"state\":{state}}}");
    writer.Flush();
    publishedApps = session.Apps;
  }
}
