using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using Windows.Media.Control;

internal sealed record SongIdentity(string Title, string Artist, string Album, int Track);

internal sealed class SongMonitor(Func<CancellationToken, Task<SongIdentity?>> read, SongIdentity initial,
  Func<IEnumerable<string>>? readPlayingPlayers = null)
{
  HashSet<string> playingPlayers = new(readPlayingPlayers?.Invoke() ?? Array.Empty<string>(), StringComparer.OrdinalIgnoreCase);

  public async Task<bool> HasChanged(CancellationToken cancellation = default)
  {
    var current = await read(cancellation);
    return current != null && current != initial;
  }

  public bool HasPlayerChanged()
  {
    if (readPlayingPlayers == null) return false;
    var current = new HashSet<string>(readPlayingPlayers(), StringComparer.OrdinalIgnoreCase);
    bool started = current.Except(playingPlayers).Any();
    playingPlayers = current;
    return started;
  }

  public static async Task<SongMonitor> Start(AudioApp app, CancellationToken cancellation, Func<string, bool>? isMusicPlayer = null)
  {
    isMusicPlayer ??= AudioDevices.IsMusicPlayer;
    GlobalSystemMediaTransportControlsSessionManager? manager = null;
    try { manager = await GlobalSystemMediaTransportControlsSessionManager.RequestAsync().AsTask(cancellation).WaitAsync(TimeSpan.FromSeconds(3), cancellation); }
    catch (Exception error) when (error is not OperationCanceledException) { }
    IEnumerable<string> ReadPlayingPlayers() => manager == null ? Array.Empty<string>() : manager.GetSessions()
      .Where(item => !MatchesApp(item.SourceAppUserModelId, app.Name)
        && isMusicPlayer(Path.GetFileNameWithoutExtension(item.SourceAppUserModelId))
        && item.GetPlaybackInfo().PlaybackStatus == GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing)
      .Select(item => item.SourceAppUserModelId);
    var session = manager?.GetSessions().FirstOrDefault(item => MatchesApp(item.SourceAppUserModelId, app.Name));
    if (session != null)
    {
      async Task<SongIdentity?> ReadMedia(CancellationToken token)
      {
        var current = manager!.GetSessions().FirstOrDefault(item => item.SourceAppUserModelId == session.SourceAppUserModelId);
        if (current == null) return null;
        var media = await current.TryGetMediaPropertiesAsync().AsTask(token).WaitAsync(TimeSpan.FromSeconds(2), token);
        return string.IsNullOrWhiteSpace(media.Title) ? null : new(media.Title.Trim(), media.Artist.Trim(), media.AlbumTitle.Trim(), media.TrackNumber);
      }
      var initial = await ReadMedia(cancellation);
      if (initial != null) return new SongMonitor(ReadMedia, initial, ReadPlayingPlayers);
    }
    var windowSong = ReadWindow(app);
    if (windowSong == null) throw new InvalidOperationException("尚未识别当前歌曲，未接管音频。请先播放歌曲，并开启播放器的系统媒体信息或歌曲窗口标题，以便切歌时自动恢复原声。");
    return new SongMonitor(_ => Task.FromResult(ReadWindow(app)), windowSong, ReadPlayingPlayers);
  }

  internal static bool MatchesApp(string appId, string name) =>
    Path.GetFileNameWithoutExtension(appId).Equals(name, StringComparison.OrdinalIgnoreCase)
    || name.Equals("LIRA", StringComparison.OrdinalIgnoreCase)
      && appId.Equals("com.aurorawhisperer.lira", StringComparison.OrdinalIgnoreCase);

  static SongIdentity? ReadWindow(AudioApp app)
  {
    // Netease's existing client monitor uses the largest "title - artist" window,
    // including hidden/minimized windows and its sibling audio process.
    var processes = Process.GetProcessesByName(app.Name);
    try
    {
      var pids = processes.Select(process => process.Id).ToHashSet();
      SongIdentity? song = null;
      long largest = -1;
      EnumWindows((window, _) => {
        GetWindowThreadProcessId(window, out uint pid);
        if (!pids.Contains((int)pid)) return true;
        var text = new StringBuilder(1024);
        GetWindowText(window, text, text.Capacity);
        string title = text.ToString();
        int separator = title.LastIndexOf(" - ", StringComparison.Ordinal);
        if (separator <= 0 || separator + 3 >= title.Length || title.Contains("MediaPlayer")) return true;
        GetWindowRect(window, out var rect);
        long area = (long)Math.Max(0, rect.Right - rect.Left) * Math.Max(0, rect.Bottom - rect.Top);
        if (area > largest) { song = new(title[..separator].Trim(), title[(separator + 3)..].Trim(), "", 0); largest = area; }
        return true;
      }, IntPtr.Zero);
      return song;
    }
    finally { foreach (var process in processes) process.Dispose(); }
  }

  delegate bool WindowCallback(IntPtr window, IntPtr parameter);
  [StructLayout(LayoutKind.Sequential)] struct Rect { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] static extern bool EnumWindows(WindowCallback callback, IntPtr parameter);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr window, StringBuilder text, int count);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr window, out Rect rect);
}
