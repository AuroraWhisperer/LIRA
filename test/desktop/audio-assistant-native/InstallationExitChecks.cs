using System.Diagnostics;
using System.Text.Json;

internal static class InstallationExitChecks
{
  public static async Task Run(string executable, string scratch)
  {
    string root = Path.Combine(Path.GetFullPath(scratch), "audio-install-" + Guid.NewGuid().ToString("N"));
    Directory.CreateDirectory(root);
    try
    {
      using (var bridge = Start("--bridge"))
      {
        try
        {
          string? ready = await bridge.StandardOutput.ReadLineAsync().WaitAsync(TimeSpan.FromSeconds(10));
          if (ready == null || !ready.Contains("\"ready\":true")) throw new Exception("Bridge did not become ready.");
          RequestExit(bridge);
          await ExpectExit(bridge);
        }
        finally { StopFixture(bridge); }
      }

      string journal = Path.Combine(root, "deferred.json");
      var record = new RouteSession.RouteRecord {
        Executable = Path.Combine(root, "absent-player.exe"), Previous = new string?[] { null, "original", null },
        Endpoint = "fixture-route", Restoring = true, GuardPid = int.MaxValue,
      };
      File.WriteAllText(journal, JsonSerializer.Serialize(record));
      // Two successive versions can take ownership without losing the undo data.
      for (int attempt = 0; attempt < 2; attempt++)
      {
        using var recovery = Start("--recover-route", journal);
        try
        {
          await ExpectPending(recovery);
          RequestExit(recovery);
          await ExpectExit(recovery);
          var retained = RouteSession.ReadRecord(journal);
          if (retained.GuardPid != recovery.Id || !retained.Restoring || retained.RoutingRestored
            || retained.MutedEndpoint != null || retained.Executable != record.Executable
            || !retained.Previous.SequenceEqual(record.Previous) || retained.Endpoint != record.Endpoint)
            throw new Exception("Installation lost deferred player recovery information.");
        }
        finally { StopFixture(recovery); }
      }

      // An invalid synthetic device cannot mutate real hardware. Its failed restore
      // must keep the helper alive even after an installer requests exit.
      record.MutedEndpoint = "lira-missing-test-device-" + Guid.NewGuid().ToString("N");
      File.WriteAllText(journal, JsonSerializer.Serialize(record));
      using (var recovery = Start("--recover-route", journal))
      {
        try
        {
          await ExpectPending(recovery);
          RequestExit(recovery);
          await Task.Delay(1200);
          var retained = RouteSession.ReadRecord(journal);
          if (recovery.HasExited || retained.MutedEndpoint != record.MutedEndpoint || retained.RecoveryError == null)
            throw new Exception("Installation must wait until endpoint restoration is safe.");
        }
        finally { StopFixture(recovery); }
      }
      Console.WriteLine("Installation exit checks passed: bridge, deferred recovery, restart and failed endpoint restore.");
    }
    finally
    {
      if (Path.GetDirectoryName(root) != Path.GetFullPath(scratch)) throw new Exception("Unsafe fixture cleanup path.");
      Directory.Delete(root, true);
    }

    Process Start(params string[] args)
    {
      var info = new ProcessStartInfo(executable) {
        UseShellExecute = false, CreateNoWindow = true,
        RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true,
      };
      info.Environment["LIRA_AUDIO_DATA_DIR"] = root;
      foreach (string arg in args) info.ArgumentList.Add(arg);
      return Process.Start(info) ?? throw new Exception("Failed to start isolated audio helper.");
    }
  }

  static void RequestExit(Process process)
  {
    using var signal = EventWaitHandle.OpenExisting($"Local\\LiraAudioAssistant-Install-{process.Id}");
    signal.Set();
  }

  static async Task ExpectPending(Process process)
  {
    string? response = await process.StandardOutput.ReadLineAsync().WaitAsync(TimeSpan.FromSeconds(10));
    if (response != "pending")
      throw new Exception($"Expected deferred recovery, received: {response ?? await process.StandardError.ReadToEndAsync()}");
  }

  static async Task ExpectExit(Process process)
  {
    await process.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(5));
    if (process.ExitCode != 0) throw new Exception(await process.StandardError.ReadToEndAsync());
  }

  static void StopFixture(Process process)
  {
    if (process.HasExited) return;
    process.Kill();
    process.WaitForExit();
  }
}
