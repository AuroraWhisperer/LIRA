using System.Text.Json;
using System.Runtime.InteropServices;

internal sealed class AudioSession : IDisposable
{
  readonly AudioDeviceNames names = new();
  readonly Action<Action> dispatch;
  readonly string settingsPath = Path.Combine(Program.DataDirectory, "settings.json");
  readonly AssistantSettings settings;
  List<AudioApp> apps = new();
  List<(string Id, string Name)> outputs = new();
  List<PlaybackOutput> playbackOutputs = new();
  List<(string Id, string Name)> inputs = new();
  AudioInputDevice? inputDevice;
  string inputError = "";
  AudioEngine? engine;
  RouteSession? route;
  SongMonitor? song;
  CancellationTokenSource? startup;
  string source, status = "选择音乐来源，开启当前歌曲的处理。";
  string? filePath;
  int ticks;
  int? activePid;
  bool starting, disposed, original, pendingRecovery, recoveryDeferred;
  public event Action? Changed;
  public int? PlaybackProcessId { get; set; }

  public AudioSession(Action<Action> dispatch)
  {
    this.dispatch = dispatch;
    settings = AssistantSettings.Load(settingsPath);
    source = settings.DeviceSource.Length > 0 ? settings.DeviceSource : settings.External ? "auto" : "file";
    RefreshInventory();
    Recover(false);
  }

  AudioApp? AutoApp() => apps.FirstOrDefault(a => a.Pid == activePid && a.Playing)
    ?? apps.FirstOrDefault(a => a.Playing && AudioDevices.IsMusicPlayer(a))
    ?? apps.FirstOrDefault(AudioDevices.IsMusicPlayer);
  AudioApp? SelectedApp() => source == "auto" ? AutoApp()
    : source.StartsWith("pid:") && int.TryParse(source[4..], out int pid) ? apps.FirstOrDefault(a => a.Pid == pid) : null;
  bool DeviceSource => source is "input" or "loopback";
  bool PlayerSource => source != "file" && !DeviceSource;

  public object Snapshot()
  {
    var app = SelectedApp();
    return new {
      ready = true, running = engine != null && !starting, starting, source, settings, original, status,
      sourceProcessId = PlayerSource ? activePid ?? app?.Pid : null,
      song = DeviceSource ? inputDevice?.Name ?? "请选择可用的输入设备"
        : source == "file" ? filePath == null ? "尚未选择本地歌曲" : Path.GetFileName(filePath)
        : app == null ? "等待播放器播放歌曲" : $"{app.Name} · {app.Title}",
      sourceDevice = DeviceSource ? "" : app?.Device ?? "", fileName = filePath == null ? "" : Path.GetFileName(filePath),
      apps = apps.Select(a => new { id = $"pid:{a.Pid}", name = $"{a.Name} · {a.Title}" }).ToArray(),
      outputs = outputs.Select(d => new { id = d.Id, name = d.Name }).ToArray(),
      outputChoices = playbackOutputs.Select(d => new { id = d.Backend == "wasapi" && d.EndpointId.Length > 0 ? d.EndpointId : d.DeviceId, name = d.Name }).ToArray(),
      inputs = inputs.Select(d => new { id = d.Id, name = d.Name }).ToArray(),
      inputDevice, inputError, inputLevel = engine?.Dsp.InputPeak ?? 0,
      level = engine?.Dsp.OutputPeak ?? 0, position = engine?.PositionSeconds ?? 0,
      duration = engine?.DurationSeconds ?? 0, pendingRecovery, recoveryDeferred,
    };
  }

  void RefreshInventory()
  {
    names.Clear();
    outputs = AudioDevices.Outputs(names);
    playbackOutputs = PlaybackOutputs.Enumerate();
    inputs = AudioDevices.Inputs(names);
    apps = AudioDevices.Apps(names, PlaybackProcessId);
    RefreshInput();
    if (settings.CableId.Length == 0)
      settings.CableId = outputs.FirstOrDefault(d => AudioDevices.IsIsolationDevice(d.Name)).Id ?? "";
  }

  void RefreshInput()
  {
    inputDevice = null;
    inputError = "";
    if (!DeviceSource) return;
    try { inputDevice = AudioDevices.DescribeInput(source == "input" ? settings.InputId : settings.LoopbackId, source == "loopback"); }
    catch (Exception error) when (error is COMException or InvalidOperationException)
    {
      inputError = "输入设备不可用，请检查连接后刷新设备。";
    }
  }

  public void Refresh()
  {
    RequireIdle();
    RefreshInventory();
    if (!pendingRecovery || recoveryDeferred) status = "音乐来源和设备已刷新。";
  }

  void RequireIdle()
  {
    if (starting || engine != null) throw new InvalidOperationException("请先关闭当前歌曲的处理，再切换音乐来源或设备。");
  }

  public void SelectFile(string path)
  {
    RequireIdle();
    if (!File.Exists(path)) throw new InvalidOperationException("本地歌曲不存在，请重新选择。");
    filePath = path;
    source = "file";
    settings.External = false;
    settings.DeviceSource = "";
    RefreshInput();
    Save();
    if (!pendingRecovery || recoveryDeferred) status = "本地歌曲已就绪，开启当前歌曲即可处理。";
  }

  public void Configure(JsonElement values)
  {
    if (values.TryGetProperty("source", out var selected))
    {
      RequireIdle();
      var next = selected.GetString()!;
      if (next != "auto" && next != "file" && next != "input" && next != "loopback" && !apps.Any(a => next == $"pid:{a.Pid}"))
        throw new InvalidOperationException("播放器已退出，请刷新来源。");
      if (source != next) { settings.InputChannels = "auto"; settings.InputMusic = false; }
      source = next;
      settings.External = source != "file";
      settings.DeviceSource = DeviceSource ? source : "";
    }
    if (values.TryGetProperty("outputId", out var output)) { RequireIdle(); settings.OutputId = output.GetString()!; }
    if (values.TryGetProperty("cableId", out var cable)) { RequireIdle(); settings.CableId = cable.GetString()!; }
    if (values.TryGetProperty("inputId", out var input))
    {
      RequireIdle();
      string id = input.GetString()!;
      if (id.Length > 0 && !inputs.Any(d => d.Id == id)) throw new InvalidOperationException("输入设备不可用，请刷新设备后重新选择。");
      if (settings.InputId != id) { settings.InputChannels = "auto"; settings.InputMusic = false; }
      settings.InputId = id;
    }
    if (values.TryGetProperty("loopbackId", out var loopback))
    {
      RequireIdle();
      string id = loopback.GetString()!;
      if (id.Length > 0 && !outputs.Any(d => d.Id == id)) throw new InvalidOperationException("输入设备不可用，请刷新设备后重新选择。");
      if (settings.LoopbackId != id) { settings.InputChannels = "auto"; settings.InputMusic = false; }
      settings.LoopbackId = id;
    }
    if (values.TryGetProperty("inputChannels", out var channels))
    {
      RequireIdle();
      if (!InputChannelProvider.IsValidSelection(channels.GetString()!)) throw new InvalidOperationException("输入声道无效，请重新选择。");
      settings.InputChannels = channels.GetString()!;
    }
    if (values.TryGetProperty("inputMusic", out var music)) { RequireIdle(); settings.InputMusic = music.GetBoolean(); }
    if (values.TryGetProperty("source", out _) || values.TryGetProperty("inputId", out _) || values.TryGetProperty("loopbackId", out _))
      RefreshInput();
    if (values.TryGetProperty("strength", out var strength)) settings.Strength = Math.Clamp(strength.GetInt32(), -100, 100);
    if (values.TryGetProperty("semitones", out var semitones)) settings.Semitones = Math.Clamp(semitones.GetInt32(), -12, 12);
    if (values.TryGetProperty("speedPercent", out var speed)) settings.SpeedPercent = Math.Clamp(speed.GetInt32(), 50, 200);
    if (values.TryGetProperty("volume", out var volume)) settings.Volume = Math.Clamp(volume.GetInt32(), 0, 200);
    if (values.TryGetProperty("original", out var bypass)) original = bypass.GetBoolean();
    ApplyControls();
    Save();
    if (!starting && engine == null && (!pendingRecovery || recoveryDeferred)) status = "设置已保存。";
  }

  void ApplyControls()
  {
    if (engine == null) return;
    engine.Dsp.StrengthPercent = DeviceSource && !settings.InputMusic ? 0 : settings.Strength;
    engine.Dsp.Semitones = settings.Semitones;
    engine.Dsp.SpeedPercent = source == "file" ? settings.SpeedPercent : 100;
    engine.Dsp.OutputVolume = settings.Volume / 100f;
    engine.Dsp.Original = original;
  }

  void Save() => settings.Save(settingsPath);

  public async Task Start()
  {
    if (starting || engine != null || disposed) return;
    starting = true;
    using var cancellation = new CancellationTokenSource();
    startup = cancellation;
    try
    {
      bool external = PlayerSource;
      if (source == "file" && filePath == null) throw new InvalidOperationException("请先选择一首本地歌曲。");
      if (DeviceSource)
      {
        RefreshInput();
        if (inputDevice == null) throw new InvalidOperationException(inputError);
      }
      if (external && !ProcessCapture.SupportsWindowsVersion(Environment.OSVersion.Version))
        throw new InvalidOperationException("外部实时处理需要 Windows 10 2004（Build 19041）或更新版本。请更新 Windows，或使用本地歌曲。");
      if (external && !outputs.Any(d => d.Id == settings.CableId))
        throw new InvalidOperationException("请先选择已有的独立原声通道；没有可用通道时可使用本地歌曲。");
      if (external) apps = AudioDevices.Apps(names, PlaybackProcessId);
      var app = SelectedApp();
      if (external && app == null) throw new InvalidOperationException("没有检测到播放器，请先播放歌曲。");
      status = external ? "正在确认最终输出；若播放器暂停，请继续播放。" : "正在启动音频处理…";
      Changed?.Invoke();
      string outputBackend = "wasapi";
      string outputId;
      if (settings.OutputId.StartsWith("wasapi:") || settings.OutputId.StartsWith("directsound:")
        || settings.OutputId.StartsWith("waveout:") || settings.OutputId.StartsWith("asio:"))
        (outputBackend, outputId) = PlaybackOutputs.Resolve(settings.OutputId);
      else outputId = await AudioDevices.ResolveOutput(settings.OutputId, external ? app!.Pid : null, cancellation.Token);
      if (external && outputId == settings.CableId)
        throw new InvalidOperationException("原声通道与最终输出不能相同，请选择空闲的独立通道。");
      if (source == "loopback" && string.Equals(outputId, inputDevice!.Id, StringComparison.OrdinalIgnoreCase))
        throw new InvalidOperationException("采集的播放设备与最终输出不能相同，请另选输出设备，避免声音循环回送。");
      if (external)
      {
        song = await SongMonitor.Start(app!, cancellation.Token);
        cancellation.Token.ThrowIfCancellationRequested();
        status = "正在检查播放器通道；可随时关闭当前歌曲处理。";
        Changed?.Invoke();
        route = await RouteSession.Start(app!.Pid, settings.CableId, cancellation.Token);
        cancellation.Token.ThrowIfCancellationRequested();
        if (!await AudioDevices.WaitForIsolation(app.Pid, settings.CableId, cancellation.Token))
          throw new InvalidOperationException("播放器未切入原声通道，已恢复。请将播放器输出设为系统默认，并关闭独占 / ASIO 后重试。");
        if (await song.HasChanged(cancellation.Token)) throw new InvalidOperationException("歌曲已切换，请重新开启当前歌曲处理。");
      }
      cancellation.Token.ThrowIfCancellationRequested();
      status = "正在启动音频处理…";
      Changed?.Invoke();
      var created = new AudioEngine(source == "file" ? filePath : null, external ? app!.Pid : null, outputId,
        DeviceSource && !settings.InputMusic ? 0 : settings.Strength, settings.Semitones, settings.SpeedPercent,
        DeviceSource ? inputDevice : null, source == "loopback", settings.InputChannels, outputBackend);
      engine = created;
      activePid = external ? app!.Pid : null;
      created.Stopped += error => dispatch(() => {
        if (engine != created) return;
        bool playerExited = route?.PlayerExited == true;
        Stop();
        if (error != null && !playerExited) status = $"音频已停止：{error.Message}\n{status}";
        Changed?.Invoke();
      });
      ApplyControls();
      await created.Start(cancellation.Token);
      cancellation.Token.ThrowIfCancellationRequested();
      status = DeviceSource ? "正在处理输入声音" : "正在处理当前歌曲";
    }
    catch (OperationCanceledException) { Stop(); }
    catch (Exception error) { Fail(error); throw; }
    finally { startup = null; starting = false; if (!disposed) Changed?.Invoke(); }
  }

  public void Stop()
  {
    startup?.Cancel();
    var previous = engine;
    engine = null;
    activePid = null;
    song = null;
    var previousRoute = route;
    route = null;
    var errors = new List<string>();
    try { previous?.Dispose(); }
    catch (Exception error) { errors.Add("音频停止异常：" + error.Message); }
    try { previousRoute?.Dispose(); }
    catch (Exception error) { errors.Add(error.Message); }
    UpdateRecoveryState(errors.Count > 0);
    status = errors.Count > 0 ? "已停止，原声恢复需要检查：" + string.Join("\n", errors)
      : pendingRecovery ? RecoveryStatus
      : previousRoute == null ? "当前歌曲处理已关闭" : "当前歌曲处理已关闭，播放器输出已还原";
    Changed?.Invoke();
  }

  public void Fail(Exception error)
  {
    Stop();
    status = error.Message + "\n" + status;
    Changed?.Invoke();
  }

  public void Recover(bool reportSuccess = true)
  {
    RequireIdle();
    var errors = RouteSession.RecoverPending();
    UpdateRecoveryState(errors.Length > 0);
    if (errors.Length > 0) status = string.Join("\n", errors.Distinct());
    else if (reportSuccess) status = pendingRecovery ? RecoveryStatus : "原声恢复完成。";
  }

  string RecoveryStatus => recoveryDeferred
    ? "原声通道已恢复；播放器的输出设置将在下次播放时自动还原。" : "正在恢复原声。";

  void UpdateRecoveryState(bool failed)
  {
    (pendingRecovery, recoveryDeferred) = RouteSession.ReadRecoveryState();
    if (failed) { pendingRecovery = true; recoveryDeferred = false; }
  }

  public async Task Tick()
  {
    ticks++;
    if (starting) return;
    if (engine == null)
    {
      if (pendingRecovery && ticks % 10 == 0)
      {
        string previousStatus = status;
        bool previousPendingRecovery = pendingRecovery;
        bool previousDeferred = recoveryDeferred;
        Recover();
        if (status != previousStatus || pendingRecovery != previousPendingRecovery || recoveryDeferred != previousDeferred)
          Changed?.Invoke();
      }
      return;
    }
    bool refreshed = ticks % 8 == 0 && PlayerSource;
    if (route?.PlayerExited == true) { Stop(); return; }
    if (refreshed) apps = AudioDevices.Apps(names, PlaybackProcessId);
    if (route != null && !AudioDevices.IsMuted(route.EndpointId))
    {
      Fail(new InvalidOperationException("原声通道被解除静音，已停止处理，避免重复播放。")); return;
    }
    if (song != null)
    {
      var monitored = song;
      bool changed = await monitored.HasChanged();
      if (disposed || song != monitored || engine == null) return;
      if (changed || monitored.HasPlayerChanged())
      {
        Fail(new InvalidOperationException("歌曲或播放器已切换，需要处理时请重新开启。")); return;
      }
    }
    if (refreshed && activePid.HasValue)
    {
      var next = AutoApp();
      if (next != null && next.Pid != activePid && next.Playing)
      {
        Fail(new InvalidOperationException("已切换播放器，需要处理时请重新开启。")); return;
      }
      if (route != null)
      {
        if (apps.Any(a => a.Pid != activePid && a.ActiveEndpoints.Contains(route.EndpointId)))
        {
          Fail(new InvalidOperationException("其他程序开始使用原声通道，请选择空闲的独立通道。")); return;
        }
        var active = apps.FirstOrDefault(a => a.Pid == activePid);
        if (active == null || active.ActiveEndpoints.Any(id => id != route.EndpointId))
        {
          Fail(new InvalidOperationException("播放器已退出或音频通道发生变化。")); return;
        }
      }
    }
    status = DeviceSource ? engine.Dsp.InputPeak > 0.00001f ? original ? "正在试听原声" : "正在处理输入声音" : "正在等待输入声音"
      : source == "file" ? original ? "正在试听原声" : "正在处理本地歌曲"
      : engine.Dsp.InputPeak > 0.00001f ? original ? "原声已隔离 · 原声对比" : "原声已隔离 · 正在输出处理后的音乐"
      : "原声已隔离 · 等待播放器声音";
    Changed?.Invoke();
  }

  public void Dispose()
  {
    if (disposed) return;
    disposed = true;
    Stop();
    names.Dispose();
  }
}
