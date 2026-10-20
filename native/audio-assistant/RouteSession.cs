using System.Diagnostics;
using System.Text.Json;
using System.Security.Cryptography;
using System.Text;
using NAudio.CoreAudioApi;

internal sealed class RouteSession : IDisposable
{
  readonly Process helper;
  readonly Task<string?> readiness;
  readonly int playerPid;
  readonly long playerStarted;
  bool disposed;
  public string EndpointId { get; }
  public bool PlayerExited => !IsSameProcess(playerPid, playerStarted);
  static string DirectoryPath => Path.Combine(Program.DataDirectory, "routes");

  public static (bool Pending, bool Deferred) ReadRecoveryState()
  {
    if (!Directory.Exists(DirectoryPath)) return (false, false);
    bool pending = false, deferred = true;
    foreach (string path in Directory.GetFiles(DirectoryPath, "*.json"))
    {
      try
      {
        var record = ReadRecord(path);
        pending = true;
        // Only a live guard with a restored endpoint can finish quietly in the background.
        deferred &= record.Restoring && record.MutedEndpoint == null && !record.RoutingRestored
          && record.RecoveryError == null && record.Previous is { Length: 3 }
          && !string.IsNullOrWhiteSpace(record.Executable) && !string.IsNullOrWhiteSpace(record.Endpoint)
          && IsSameProcess(record.GuardPid, record.GuardStarted);
      }
      catch (FileNotFoundException) { }
      catch { return (true, false); }
    }
    return (pending, pending && deferred);
  }

  RouteSession(Process helper, string endpointId, int playerPid, long playerStarted)
  {
    this.helper = helper; EndpointId = endpointId;
    this.playerPid = playerPid; this.playerStarted = playerStarted;
    readiness = helper.StandardOutput.ReadLineAsync();
  }

  public static async Task<RouteSession> Start(int pid, string endpointId, CancellationToken cancellation = default)
  {
    long started;
    using (var target = Process.GetProcessById(pid))
    {
      string executable = target.MainModule?.FileName ?? throw new InvalidOperationException("无法识别播放器。");
      started = target.StartTime.ToUniversalTime().Ticks;
      RecoverPending();
      for (int attempt = 0; HasPending(executable) || HasPendingEndpoint(endpointId); attempt++)
      {
        if (attempt >= 40) throw new InvalidOperationException("此播放器或原声通道仍在处理或恢复中，请先停止其他处理窗口。");
        await Task.Delay(200, cancellation);
      }
    }
    var info = new ProcessStartInfo(Environment.ProcessPath!) {
      UseShellExecute = false, CreateNoWindow = true,
      RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true,
    };
    info.ArgumentList.Add("--route-guard");
    info.ArgumentList.Add(pid.ToString());
    info.ArgumentList.Add(endpointId);
    cancellation.ThrowIfCancellationRequested();
    var helper = Process.Start(info) ?? throw new InvalidOperationException("无法启动原声恢复助手。");
    var session = new RouteSession(helper, endpointId, pid, started);
    try
    {
      string? response = await session.readiness.WaitAsync(TimeSpan.FromSeconds(8), cancellation);
      if (response != "ready") throw new InvalidOperationException(response?.Replace("error:", "") ?? "隔离助手未就绪。");
      return session;
    }
    catch (Exception error)
    {
      try { session.Dispose(); }
      catch (Exception recovery) { throw new AggregateException(error.Message + "\n" + recovery.Message, error, recovery); }
      throw;
    }
  }

  public void Dispose()
  {
    if (disposed) return;
    disposed = true;
    try
    {
      helper.StandardInput.Close();
      // Cancellation of the wait does not cancel the outstanding pipe read.
      readiness.WaitAsync(TimeSpan.FromSeconds(5)).GetAwaiter().GetResult();
      string? response = helper.StandardOutput.ReadLineAsync().WaitAsync(TimeSpan.FromSeconds(5)).GetAwaiter().GetResult();
      if (response == "pending") return;
      bool exited = helper.WaitForExit(5000);
      int exitCode = exited ? helper.ExitCode : -1;
      string message = exited ? helper.StandardError.ReadToEnd().Trim() : "恢复助手仍在处理，稍后可点“恢复原声”。";
      if (exitCode != 0) throw new InvalidOperationException(string.IsNullOrEmpty(message) ? "原声路由尚未恢复，请点“恢复原声”。" : message);
    }
    finally { helper.Dispose(); }
  }

  public static void RunGuard(int pid, string endpointId, WaitHandle installationExit)
  {
    string? path = null;
    RouteRecord? record = null;
    Ownership? ownership = null;
    Ownership? endpointOwnership = null;
    try
    {
      using var process = Process.GetProcessById(pid);
      string executable = process.MainModule?.FileName ?? throw new InvalidOperationException("无法识别播放器，请以普通权限启动播放器和助手。");
      ownership = new Ownership(executable);
      endpointOwnership = new Ownership("endpoint:" + endpointId);
      if (HasPendingEndpoint(endpointId)) throw new InvalidOperationException("原声通道仍有待恢复状态，请先恢复原声。");
      var occupied = AudioDevices.Apps().FirstOrDefault(app => app.Pid != pid && app.ActiveEndpoints.Contains(endpointId));
      if (occupied != null) throw new InvalidOperationException($"原声通道正被 {occupied.Name} 使用，请选择一个空闲的独立通道。");
      using var devices = new MMDeviceEnumerator();
      using var endpoint = devices.GetDevice(endpointId);
      using var current = Process.GetCurrentProcess();
      using var policy = new AppAudioRoute();
      if (installationExit.WaitOne(0)) return;
      record = new RouteRecord {
        Pid = pid, Started = process.StartTime.ToUniversalTime().Ticks, Executable = executable,
        GuardPid = Environment.ProcessId, GuardStarted = current.StartTime.ToUniversalTime().Ticks,
        Endpoint = AppAudioRoute.Encode(endpointId),
        Previous = Enumerable.Range(0, 3).Select(role => policy.Get(pid, role)).ToArray(),
        MutedEndpoint = endpointId, PreviousMute = endpoint.AudioEndpointVolume.Mute,
      };
      Directory.CreateDirectory(DirectoryPath);
      path = Path.Combine(DirectoryPath, $"{Guid.NewGuid():N}.json");
      Save(path, record); // Durable undo information must precede every Windows mutation.
      // Process loopback is before endpoint master mute. Silence the raw endpoint,
      // not the player's session, so virtual-device forwarding cannot bypass DSP.
      endpoint.AudioEndpointVolume.Mute = true;
      if (!endpoint.AudioEndpointVolume.Mute) throw new InvalidOperationException("无法关闭原声通道直通，已取消接管。");
      for (int role = 0; role < 3; role++) policy.Set(pid, role, record.Endpoint);
      for (int role = 0; role < 3; role++)
        if (!Same(policy.Get(pid, role), record.Endpoint)) throw new InvalidOperationException("Windows 未应用播放器隔离路由。");
      Console.WriteLine("ready");
      Console.Out.Flush();
      // Restore even if the player exits before the UI notices. EOF also covers UI crashes.
      Task.WhenAny(Task.Run(() => Console.ReadLine()), process.WaitForExitAsync(),
        Task.Run(() => installationExit.WaitOne())).GetAwaiter().GetResult();
    }
    catch (Exception error)
    {
      Console.WriteLine("error:" + error.Message);
      Console.Out.Flush();
      Console.Error.WriteLine(error.Message);
      Environment.ExitCode = 1;
    }
    finally
    {
      try { if (path != null && record != null) RestoreUntilDone(path, record, installationExit, endpointOwnership); }
      finally { endpointOwnership?.Dispose(); ownership?.Dispose(); }
    }
  }

  public static string[] RecoverPending()
  {
    if (!Directory.Exists(DirectoryPath)) return Array.Empty<string>();
    var errors = new List<string>();
    foreach (string path in Directory.GetFiles(DirectoryPath, "*.json"))
    {
      try
      {
        var record = ReadRecord(path);
        if (IsSameProcess(record.GuardPid, record.GuardStarted))
        {
          if (!record.Restoring) errors.Add("此前的恢复助手仍在运行，请先停止正在处理的音乐，或稍后再试。");
          else if (record.RecoveryError != null) errors.Add(record.RecoveryError);
          continue;
        }
        if (File.Exists(path))
        {
          var info = new ProcessStartInfo(Environment.ProcessPath!) {
            UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true,
          };
          info.ArgumentList.Add("--recover-route"); info.ArgumentList.Add(path);
          using var recovery = Process.Start(info) ?? throw new InvalidOperationException("无法启动自动恢复助手。");
          if (recovery.StandardOutput.ReadLineAsync().WaitAsync(TimeSpan.FromSeconds(5)).GetAwaiter().GetResult() != "pending"
            && File.Exists(path)) throw new InvalidOperationException("自动恢复助手尚未就绪。");
        }
      }
      catch (FileNotFoundException) { } // A guard can finish between enumeration and reading.
      catch (Exception error) { errors.Add("恢复记录处理失败：" + error.Message); }
    }
    return errors.ToArray();
  }

  public static void RunRecovery(string path, WaitHandle installationExit)
  {
    var record = ReadRecord(path);
    if (IsSameProcess(record.GuardPid, record.GuardStarted)) return;
    using var ownership = new Ownership(record.Executable);
    if (!File.Exists(path)) return;
    using var current = Process.GetCurrentProcess();
    record.GuardPid = current.Id; record.GuardStarted = current.StartTime.ToUniversalTime().Ticks;
    RestoreUntilDone(path, record, installationExit);
  }

  static void RestoreUntilDone(string path, RouteRecord record, WaitHandle installationExit, Ownership? endpointOwnership = null)
  {
    endpointOwnership ??= record.MutedEndpoint == null ? null : new Ownership("endpoint:" + record.MutedEndpoint);
    try
    {
      record.Restoring = true;
      Save(path, record);
      bool replied = false;
      while (File.Exists(path))
      {
        string? error = RestoreRecord(path, record);
        // A closed player may need deferred routing recovery, but must not keep
        // the shared endpoint muted or locked after processing has stopped.
        if (record.MutedEndpoint == null) { endpointOwnership?.Dispose(); endpointOwnership = null; }
        bool pending = File.Exists(path);
        if (pending && error != record.RecoveryError) { record.RecoveryError = error; Save(path, record); }
        if (!replied)
        {
          try { Console.WriteLine(pending ? "pending" : "restored"); Console.Out.Flush(); }
          catch (IOException) { } // The UI may have already exited; recovery still belongs to this guard.
          replied = true;
        }
        // Installers may replace this binary only after the endpoint is safe.
        // Keep deferred player undo information for recovery by the next version.
        if (record.MutedEndpoint == null && installationExit.WaitOne(0)) return;
        if (pending) Thread.Sleep(500);
      }
    }
    finally { endpointOwnership?.Dispose(); }
  }

  static bool HasPending(string executable) => Directory.Exists(DirectoryPath)
    && Directory.GetFiles(DirectoryPath, "*.json").Any(path => {
      try { return Same(ReadRecord(path).Executable, executable); }
      catch (FileNotFoundException) { return false; }
    });

  static bool HasPendingEndpoint(string endpointId) => Directory.Exists(DirectoryPath)
    && Directory.GetFiles(DirectoryPath, "*.json").Any(path => {
      try { return Same(ReadRecord(path).MutedEndpoint, endpointId); }
      catch (FileNotFoundException) { return false; }
    });

  static string? RestoreRecord(string path, RouteRecord record)
  {
    string? failure = null;
    if (record.MutedEndpoint != null)
    {
      try
      {
        using var devices = new MMDeviceEnumerator();
        using var endpoint = devices.GetDevice(record.MutedEndpoint);
        if (endpoint.AudioEndpointVolume.Mute) endpoint.AudioEndpointVolume.Mute = record.PreviousMute;
        if (endpoint.AudioEndpointVolume.Mute && !record.PreviousMute) throw new InvalidOperationException("Windows 尚未还原原声通道静音。");
        record.MutedEndpoint = null;
        Save(path, record);
      }
      catch (Exception error) { failure = "原声通道恢复未完成：" + error.Message; }
    }
    if (record.Previous.Length != 3 || string.IsNullOrWhiteSpace(record.Executable)) return failure ?? "恢复记录不完整，请通过 Windows 音量混合器恢复播放器输出。";
    if (!record.RoutingRestored)
    {
      var candidates = Process.GetProcessesByName(Path.GetFileNameWithoutExtension(record.Executable));
      try
      {
        foreach (var process in candidates)
        {
          try
          {
            if (process.HasExited || !Same(process.MainModule?.FileName, record.Executable)) continue;
            if (process.Id == record.Pid && process.StartTime.ToUniversalTime().Ticks != record.Started) continue;
            RestoreProcess(process.Id, record);
            record.RoutingRestored = true;
            Save(path, record);
            break;
          }
          catch (Exception error) { failure ??= "原声恢复未完成：" + error.Message; }
        }
      }
      finally { foreach (var process in candidates) process.Dispose(); }
    }
    if (record.RoutingRestored && record.MutedEndpoint == null) { File.Delete(path); return null; }
    return failure; // A closed player is deferred, not an instruction to reopen it.
  }

  static void RestoreProcess(int pid, RouteRecord record)
  {
    using var policy = new AppAudioRoute();
    for (int role = 0; role < 3; role++)
    {
      // A later user change takes precedence over our stored snapshot.
      if (!Same(policy.Get(pid, role), record.Endpoint)) continue;
      policy.Set(pid, role, record.Previous[role]);
      if (!Same(policy.Get(pid, role), record.Previous[role])) throw new InvalidOperationException("Windows 尚未还原播放器输出，请稍后再次恢复。");
    }
  }

  static bool IsSameProcess(int pid, long started)
  {
    try { using var process = Process.GetProcessById(pid); return process.StartTime.ToUniversalTime().Ticks == started; }
    catch (ArgumentException) { return false; }
    catch (System.ComponentModel.Win32Exception) { return true; }
  }

  static bool Same(string? left, string? right) => string.Equals(left, right, StringComparison.OrdinalIgnoreCase);
  internal static RouteRecord ReadRecord(string path)
  {
    using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
    return JsonSerializer.Deserialize<RouteRecord>(stream) ?? throw new InvalidDataException("恢复记录为空。");
  }
  static void Save(string path, RouteRecord record)
  {
    string temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
    using (var stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None))
    {
      JsonSerializer.Serialize(stream, record);
      stream.Flush(true);
    }
    // Replacement can be briefly denied while another process has the journal open.
    // Keep the durable old snapshot until the atomic replacement succeeds.
    for (int attempt = 0; ; attempt++)
    {
      try { File.Move(temporary, path, true); break; }
      catch (IOException) when (attempt < 10) { Thread.Sleep(50); }
      catch (UnauthorizedAccessException) when (attempt < 10) { Thread.Sleep(50); }
    }
  }

  // A deferred recovery must never undo a newer route started by another window.
  sealed class Ownership : IDisposable
  {
    readonly Mutex mutex;
    bool disposed;
    public Ownership(string executable)
    {
      string identity = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(executable.ToUpperInvariant())));
      mutex = new Mutex(false, "Local\\LiraAudioRoute-" + identity);
      try { if (mutex.WaitOne(0)) return; }
      catch (AbandonedMutexException) { return; }
      mutex.Dispose();
      throw new InvalidOperationException("另一个窗口正在处理或恢复此播放器，请等待它完成。");
    }
    public void Dispose() { if (disposed) return; disposed = true; mutex.ReleaseMutex(); mutex.Dispose(); }
  }

  internal sealed class RouteRecord
  {
    public int Pid { get; set; }
    public long Started { get; set; }
    public string Executable { get; set; } = "";
    public int GuardPid { get; set; }
    public long GuardStarted { get; set; }
    public bool Restoring { get; set; }
    public string? RecoveryError { get; set; }
    public string Endpoint { get; set; } = "";
    public string?[] Previous { get; set; } = Array.Empty<string?>();
    public string? MutedEndpoint { get; set; }
    public bool PreviousMute { get; set; }
    public bool RoutingRestored { get; set; }
  }
}
