# 全民 K 歌采集(wesing-capture)

> 涉及文件:[wesing-capture.js](../../../../src/music/wesing-capture.js)、[wesing-capture-engine.js](../../../../src/music/wesing-capture-engine.js)、[wesing-playback-tracker.js](../../../../src/music/wesing-playback-tracker.js)、[wesing-lyric-resolver.js](../../../../src/music/wesing-lyric-resolver.js)、[wesing-qrc-watcher.js](../../../../src/music/wesing-qrc-watcher.js)、[wesing-native-monitor-source.js](../../../../src/music/wesing-native-monitor-source.js)、[wesing-online-lyrics.js](../../../../src/music/wesing-online-lyrics.js)、[lyric-parser.js](../../../../src/music/lyric-parser.js)(findCurrentLyricLine)、[lyric-state.js](../../../../src/music/lyric-state.js)、[lyric-timeline.js](../../../../src/music/lyric-timeline.js)、[server.js](../../../../src/server.js)(装配)、[inspect-wesing-playback.js](../../../../scripts/inspect-wesing-playback.js)(诊断)
> 依赖:`qrc-decoder`(QRC 解密);运行时内嵌 PowerShell + C# 监视源码

本文档是 WeSing（全民 K 歌）**离线歌词采集**的单一事实来源，涵盖监视源、日志/QRC 扫描、播放时钟、v3.3.14 的 loading 过渡跟踪、在线兜底打分与 WS 集成。消息契约见 [ws.md](../ws.md)，设置持久化见 [storage.md](../storage.md) §7，诊断工具见 [engineering/test.md](../../engineering/test.md)。

**内部模块边界**（以下子模块均不反向依赖引擎状态）：

- `wesing-capture.js`：对外兼容导出门面；
- `wesing-capture-engine.js`：采集主流程、曲目/歌词刷新与缓存生命周期；
- `wesing-playback-tracker.js`：单调播放时钟、音频/进度判定、停滞外推与重播检测；
- `wesing-lyric-resolver.js`：本地 QRC 与在线兜底歌词选择；
- `wesing-qrc-watcher.js`：QRC 与日志目录的文件监听及事件合并；
- `wesing-cache.js`：缓存目录校验、日志扫描、QRC 解密与偏移归一化；
- [wesing-cache-discovery.js](../../../../src/music/wesing-cache-discovery.js)：固定候选缓存路径探测（由运行时注入引擎）；
- `wesing-monitor.js`：PowerShell 监视进程管理与脚本组装；
- [wesing-diagnostics.js](../../../../src/music/wesing-diagnostics.js)：按需诊断采样与报告汇总。

## 1. 概述

Windows 独有(仅 `platform === 'win32'` 支持):采集全民 K 歌客户端**正在播放**的歌曲,把本地缓存的逐字歌词(QRC)或在线匹配歌词叠加为实时桌面歌词。能力边界:

- 采集的是客户端**本地行为**(窗口标题、播放进度、音频会话、磁盘缓存),不碰任何全民 K 歌上游 API
- 播放窗口存在时默认每 100ms 采样，进度由窗口/辅助功能快照及 `performance.now()` 单调时钟外推。等待窗口时默认每秒探测一次。
- 歌词内容优先本地 `WeSingCache\WeSingDL\Res\<mid>\<mid>.qrc`,失败走 QQ/网易云在线兜底
- 服务端仅此一个消费方;Electron 桌面端用 `/api/music/wesing/*` 控制(见 [api.md](../api.md) 的 wesing-routes 节)

## 2. 架构图

```
┌───────────────────────── 全民K歌客户端 (WeSing.exe, Windows) ─────────────────────────┐
│  窗口 "全民K歌 - <歌名>"(含隐藏窗口)  进度文本 "MM:SS | MM:SS"   WASAPI 音频会话/峰值    │
└──────────┬──────────────────────────────────┬───────────────────────────┬───────────┘
           │ EnumWindows + GetWindowText       │ MSAA (AccessibleObjectFromWindow) /    │
           │ (wesing-native-monitor-source.js) │ UIAutomation Text 控件                  │
           ▼                                  ▼                           ▼
┌───────────────────────────────────────────────────────────────────────────────────────┐
│ PowerShell 监视进程 (powershell.exe 100ms 轮询; UTF-8 base64 → Invoke-Expression)     │
│   每轮样本: { detected, title, currentSec, totalSec, loading, audioActive, audioPeak, │
│              progressSource: 'msaa'|'uia', processIds, controls?, error? }            │
│   → stdout 逐行 JSON ────────────────► createPowerShellWeSingMonitor 解析行            │
└───────────────────────────────────────────────────────────────────────────────────────┘
                                          │ handleMonitorSample() —— 状态机 + 播放时钟
              ┌───────────────────────────┼───────────────────────────────┐
              ▼                           ▼                                ▼
┌──────────────────────┐   ┌──────────────────────────────┐   ┌────────────────────────┐
│ WeSingCache 日志扫描   │   │ QRC 歌词加载 (loadWeSingLyrics)│   │ 在线歌词兜底             │
│ Log/WeSing/*.log      │   │ WeSingDL/Res/<mid>/<mid>.qrc │   │ (wesing-online-lyrics)  │
│ 最新文件分块回读 ≤4MiB │   │ ≤4MB; [offset: 前缀剥除        │   │ qq+netease 双查,        │
│ (UTF-16LE,"StartKSong")│   │ → decryptQrc(hex)            │   │ 歌名/歌手/版本匹配,      │
│ 找当前 mid + 歌名      │   │ → XML → LyricContent → 行模型 │   │ 时长消歧,逐字/翻译质量分  │
└──────────────────────┘   └──────────────────────────────┘   └────────────────────────┘
   ▲ fs.watch 递归(QRC 2s / 日志 100ms) │ refreshVersion 竞态守卫
   └─────────────────────────────────────┴────────────► 行模型 lyrics[]
                                                        │ updateLyricState: currentMs + lyricOffsetMs(±3000)
                                                        │ findCurrentLyricLine 二分 → lyricState
                                                        ▼
                                   WS: wesing-state / lyric-state / lyric-timeline(见 ws.md §3)
```

## 3. 常量

| 常量                       | 值                                                | 出处                                                                           |
| -------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------ |
| `LOG_TAIL_BYTES`           | 100 KiB(日志倒序读取的单块大小)                    | [wesing-cache.js](../../../../src/music/wesing-cache.js)            |
| `MAX_LOG_SCAN_BYTES`       | 4 MiB(日志回读上限，UTF-16 对齐可多 1 字节)        | [wesing-cache.js](../../../../src/music/wesing-cache.js)            |
| `MAX_QRC_BYTES`            | 4 MB(单个 QRC 文件上限)                           | [wesing-cache.js](../../../../src/music/wesing-cache.js)            |
| `MAX_FALLBACK_FILES`       | 80(目录扫描兜底文件数上限)                        | [wesing-cache.js](../../../../src/music/wesing-cache.js)            |
| `PAUSED_AFTER_MS`          | 1500(进度停滞且无近期有效音量时判暂停)            | [wesing-playback-tracker.js](../../../../src/music/wesing-playback-tracker.js) |
| `AUDIO_PEAK_THRESHOLD`     | 0.001(峰值大于此值才作为有效音量)                 | [wesing-playback-tracker.js](../../../../src/music/wesing-playback-tracker.js) |
| `PROGRESS_COMPENSATION_MS` | 130(进度采样补偿)                                 | [wesing-playback-tracker.js](../../../../src/music/wesing-playback-tracker.js) |
| `QRC_REFRESH_DEBOUNCE_MS`  | 2000(fs.watch 防抖)                               | [wesing-qrc-watcher.js](../../../../src/music/wesing-qrc-watcher.js)            |
| `AUTOMATIC_REFRESH_INTERVAL_MS` | 3000(监视样本触发的自动复查间隔)               | [wesing-capture-engine.js](../../../../src/music/wesing-capture-engine.js) |
| `MIN/MAX_LYRIC_OFFSET_MS`  | ±3000(歌词时间偏移夹取)                           | [wesing-cache.js](../../../../src/music/wesing-cache.js)     |
| `SAFE_SONG_MID`            | `/^[a-zA-Z0-9_-]{1,128}$/`(mid 白名单,防路径穿越) | [wesing-cache.js](../../../../src/music/wesing-cache.js)            |
| PowerShell 轮询间隔        | 活动窗口或显式诊断默认 100ms（可设 100–5000ms），等待窗口至少 1000ms | [wesing-monitor.js](../../../../src/music/wesing-monitor.js) |

## 4. 监视源(两层)

### 4.1 PowerShell 外壳(createPowerShellWeSingMonitor,[wesing-monitor.js](../../../../src/music/wesing-monitor.js))

- 启动参数:`powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command <command>`,`windowsHide: true`
- **脚本注入方式(v3.3.13 起)**:脚本 UTF-8 编码 → Base64 → `[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('<b64>')) | Invoke-Expression`([wesing-monitor.js](../../../../src/music/wesing-monitor.js));替换了旧版 UTF-16 `-EncodedCommand`(解决中文编码问题)
- stdout 按行解析:每行非空即 `JSON.parse` 成样本喂 `onSample`,半行残留攒到下一块;stderr 保留最近 2000 字符;启动错误和非主动停止的退出上报 `{error}`，同时释放当前进程记录。
- `start()` 在已有进程时不重复启动，`isRunning()` 反映当前进程记录。已启用采集器的手动重新检测可重新启动退出的监视器，每次操作最多尝试一次，不新增后台重启循环；并发重检复用已启动进程。每个进程独立保存 stdout 半行和 stderr，旧进程的迟到事件不能清除新进程或发布样本。`stop()` 会先清空当前进程标识再终止子进程，停用后触发的刷新不再重启监视器。
- `buildPowerShellMonitorScript(options)`([wesing-monitor.js](../../../../src/music/wesing-monitor.js)):内嵌 C# 源码 `Add-Type -TypeDefinition … -ReferencedAssemblies Accessibility` 编译;每轮:找进程 → 音频快照 → 找播放窗口 → MSAA 进度 → UIA 兜底 → `ConvertTo-Json -Compress` 输出 + `Start-Sleep`

### 4.2 C# 原生监视源(WESING_NATIVE_MONITOR_SOURCE,[wesing-native-monitor-source.js:3-351](../../../../src/music/wesing-native-monitor-source.js#L3-L351))

编译进 PowerShell 进程的 `WeSingNativeMonitor` 静态类,三个入口:

| 方法                                    | 行为                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `FindPlaybackWindow(processIds)`        | `EnumWindows` 遍历**全部顶层窗口(含隐藏窗口)**,`GetWindowThreadProcessId` 匹配进程 → 标题以 `"全民K歌 - "`(`全民K歌 - `)开头且长度 > 7 → 返回 `{Handle, Title}`(取第一个即停)([wesing-native-monitor-source.js:70-89](../../../../src/music/wesing-native-monitor-source.js#L70-L89))                                                                                                                                                                                                                              |
| `GetAccessiblePlaybackSnapshot(handle)` | MSAA:`AccessibleObjectFromWindow(OBJID_CLIENT = 0xFFFFFFFC)` 拿 `IAccessible` 根,深度优先遍历(`MaximumAccessibleDepth = 20`、`MaximumAccessibleNodes = 3000` 双上限);每个节点 `get_accName` 匹配 `^\s*(\d{1,3}):(\d{2})\s*\|\s*(\d{1,3}):(\d{2})\s*$`(**MM:SS \| MM:SS 双进度**),校验 `total > 0 && 0 ≤ current ≤ total` 后返回 `{CurrentSec, TotalSec}`;任何节点名含 `"歌曲加载中"` 置 `Loading = true`([wesing-native-monitor-source.js:91-186](../../../../src/music/wesing-native-monitor-source.js#L91-L186)) |
| `GetAudioSessionSnapshot(processIds)`   | WASAPI: `EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE)` 枚举全部可用输出设备 → `IAudioSessionManager2.GetSessionEnumerator` 遍历会话，按 `IAudioSessionControl2.GetProcessId` 匹配全民进程；任一匹配会话 Active=1 即 `audioActive=true`，跨设备取最大峰值。无匹配会话 `State=-1`，单设备异常不阻断其他设备，每层 COM 引用均释放。覆盖 Windows 可见的内置、独立及虚拟声卡，无需切换默认输出。 |

音频快照同时输出 `outputDeviceCount`（可用输出设备数）、`audioSessionCount`（匹配的全民会话数）、`activeAudioSessionCount`（其中活跃的会话数）。它们随原始监视样本进入按需诊断，不进入普通 `wesing-state` 广播。未找到全民进程时不扫描音频设备；计数为 0 不代表系统没有声卡。音频活跃状态与峰值仍按 §6 的时钟规则共同判定，其他应用的音频不会驱动全民 K 歌歌词推进。

UIAutomation 读取窗口的 Text 控件，补充 MSAA 缺失的进度并识别独立的「歌曲加载中」标签。MSAA 正进度稳定时每秒校正一次。切歌、零进度、加载中及显式诊断时逐样本读取。`includeDiagnostics` 还会收集最多 250 行 Button/Text/Slider 控件。[监视脚本](../../../../src/music/wesing-monitor.js)

## 5. 缓存/日志扫描与 QRC 歌词

### 5.1 日志扫描(findLatestSongEntry,[wesing-cache.js](../../../../src/music/wesing-cache.js))

1. 枚举 `Log/WeSing/` 下的 `*.log` 并逐个读取元数据，在同一轮遍历中选择 mtime 最大的**最新文件**，不对文件列表排序。
2. 从尾部按 `LOG_TAIL_BYTES = 100 KiB` 向前分块读取，找到歌曲记录即停止，总量最多 `MAX_LOG_SCAN_BYTES = 4 MiB + 1 字节`。起始偏移按数值整除向下取整至偶数(UTF-16LE 防半个字符)，避免大于 2 GiB 的文件偏移被位运算截断；单块最多 100 KiB + 1 字节。
3. 每块 `utf16le` 解码，保留跨块未完行（最多 50 Ki 字符），按行**倒序**找含 `"StartKSong"` 的行，正则提取 `"mid"` 与 `"songname"`(`decodeJsonString` 解转义)。普通日志增长超过 100 KiB 后仍可恢复当前版本。
4. `SAFE_SONG_MID` 校验失败整体返回 null；最新歌曲记录与期望标题按 `normalizeTitle`(去"全民K歌 - "前缀 + 去空白 + 小写)不相等时也返回 null，不跳过它去找更早播放的同名歌曲。

采集引擎按目录保存日志解析结果，指纹包含路径和 `dev/ino/birthtimeMs/ctimeMs/mtimeMs/size`。同一文件追加时校验原末尾最多 64 字节，从上一条未结束的 UTF-16 行继续读取，并按当前标题匹配扫描窗口内的最新记录。截断、轮转、文件替换或末尾校验失败时重新倒扫。读取失败可重试，启停清空缓存。同一轮刷新中的发现、就绪检查及歌词解析共用快照，切歌后丢弃旧快照。

### 5.2 QRC 歌词加载(loadWeSingLyrics,[wesing-cache.js](../../../../src/music/wesing-cache.js))

1. 日志命中 → 只读 `WeSingDL/Res/<mid>/<mid>.qrc`；缺失或无法解析则进入在线兜底，不再借用其他 mid 下的同名歌词。mid 标识当前伴奏版本。
2. 仅在日志未命中时兜底扫描 `listRecentQrcFiles`([wesing-cache.js](../../../../src/music/wesing-cache.js))——`SAFE_SONG_MID` 子目录批量(每批 100)stat 各自的 `.qrc`(`0 < size ≤ 4MB`)，按 mtime 降序取最多 80 个。候选中只有一份标题匹配(`normalizeTitle` 相等)时才采用；多份同名缓存返回 null，交给在线匹配，不按文件新旧猜版本。仅凭唯一缓存标题仍无法保证实际伴奏版本一致，应优先配置实际写入日志与 QRC 的缓存目录。

resolver 优先使用引擎传入的 `logEntry`；未传入时通过引擎的缓存读取器取得，独立调用则默认读取最新歌曲日志。显式传入 null 表示没有匹配记录，不再次扫描日志。通过 `loadWeSingLyrics({cachePath, title, logEntry})` 将同一条记录用于本地定位和在线歌手匹配。QRC 缺少歌手元数据时采用该日志的歌手；记录的 mid 单独返回引擎作为版本标识，不与在线平台的 track id 混用。

引擎通过同一个 `createWeSingCacheReader().loadLyrics()` 缓存已成功解析的 QRC：每次读取前核对文件指纹（`dev/ino/birthtimeMs/ctimeMs/mtimeMs/size`），指纹未变时复用在途读取与解析结果，变化后重新解密。仅缓存含有效歌词行的文件（失败或未下载完的下次可重试）；缓存按 LRU 淘汰，最多保留 80 个文件且总内容体积上限为 16 MiB（按 JSON 字符串 UTF-16 长度估算；单文件超限时仅保留其指纹与已验证歌名）。

按歌名兜底扫描时，只对歌名匹配、尚未记录歌名或指纹变化的候选重新解密，同名多版本仍参与歧义判定。扫描过程不拷贝未命中候选的歌词，仅对最终选中结果复制歌手并深拷贝歌词行，避免调用方污染缓存。启停、调用 `stop()` 或切换缓存目录时会清空缓存，并丢弃在途旧结果。

### 5.3 QRC 解密与解析(tryReadQrc / parseQrcDocument,[wesing-cache.js](../../../../src/music/wesing-cache.js))

实体解码由 [qrc-xml-entities.js](../../../../src/music/qrc-xml-entities.js) 的 `decodeXmlEntities` 统一维护，与 QQ 音乐复用；`extractQrcLyricContent` 的提取规则由各自模块负责。

```
1. 读文件(≤4MB)→ 前 8 字节 ASCII 为 "[offset:" 时剥掉首个换行前的内容
2. 剩余 payload 长度 % 8 !== 0 → 判非法
3. decryptQrc(payload.toString('hex')) → QRC XML 文本 (qrc-decoder)
4. parseQrcDocument:
   - extractQrcLyricContent: 取 <Lyric_1 LyricContent="..."/> 属性值,无包裹则用全文;decodeXmlEntities 解实体
   - 行模型: parseLyricResult('', '', content, '')  —— 内容作为"逐字歌词"喂入,
     [start,duration](word) 结构直接产出 words[];无词行被丢弃
   - 元数据: [ti:标题] / [ar:歌手] 取前 120 字符
   - durationMs: 取最后一行 endMs；XML 的 SaveTime 是保存时间戳，不能作为歌曲时长。采集器仍优先使用窗口报告的伴奏总时长。
```

`toLyricResult` 汇出 `{songMid, title, artists, durationMs, lines}`;`loadWeSingLyrics` 命中后调用方补 `source: 'wesing'`。

### 5.4 缓存目录监视(syncQrcWatcher,[wesing-qrc-watcher.js](../../../../src/music/wesing-qrc-watcher.js))

- active + 目录存在时 `fs.watch(cachePath, {recursive: true})`;`unref()` 防阻塞退出
- `*.qrc` 事件用 `QRC_REFRESH_DEBOUNCE_MS = 2s` 防抖后刷新当前歌词；保持播放时钟。
- `Log/WeSing/*.log` 事件以 100ms 合并，期间新事件不推迟检查。引擎重新读取当前标题的最新 `StartKSong`，仅 mid 变化时清除旧歌词、重置进度并加载新版本；相同 mid 的普通日志写入不刷新歌词。同名翻唱之间切换无需重新下载 QRC，也无需手动点重新检测。
- 切目录或停用先关闭旧 watcher，同时取消 QRC 和日志事件定时器。
- 幂等:同一 `cachePath` 不重复 watch;失败静默(`cacheWatcher = null`)不阻断采集

## 6. 播放时钟

### 6.1 单调外推(performance.now(),[wesing-playback-tracker.js](../../../../src/music/wesing-playback-tracker.js))

- `now` 可注入,默认 `performance.now()`(monotonic,不受系统时间跳变影响)
- 时钟 = `baseMs + (running ? max(0, timestamp - startedAt) : 0)`；tracker 的 `read(timestamp)` 再夹到 `[0, durationMs]`(`state.durationMs || lyricDurationMs`)，采集器将它绑定为 `readPlaybackClock`。
- tracker 对外提供 `read/pause/reset/sample`：`pause` 冻结当前值，`reset` 归零并清进度、有效音量、陈旧进度外推记录及本曲开始标记；`sample` 内部通过 `set` / `start` 对齐基准并幂等启动时钟，返回 `{currentMs,playing,waitingForPlayback,progressEvent}`，采集器据此更新歌词及状态文案。

### 6.2 采样对齐（采集器处理曲目/加载生命周期，playback tracker 处理播放证据）

每个样本按分支顺序处理：

1. `error` → 停时钟、`status:'error'`、错误文案截 160
2. 平台未检测（`detected !== true`）→ 停时钟、`waiting`
3. **平台刚恢复**（`platformResumed`）= 上次未检测且标题没变 → `currentMs=0`、重置时钟（不重新拉歌词）
4. **标题变化** → 清 `loadingTrackTitle`、`resetLyrics`、`status:'loading'`、`pendingRefresh = refreshLyrics(title)`
5. 标题为空 → 停时钟、`waiting`
6. `loading === true` → 记 `loadingTrackTitle = title`、重置时钟、`status` 保持 loading 文案（v3.3.14 见 §6.4）
7. 音频不活跃（`audioActive === false`）→ 立即停时钟并清近期音量证据；若有采样进度则将基准设为 `currentMs + 130ms`，但已由音频外推的陈旧同值进度不能把时钟拉回；进度变化后重新作为有效锚点。
8. 有采样进度：
   - **重播检测**（`replayedFromStart`）：`lastProgressMs > 3000 && currentMs ≤ 2000 && currentMs < lastProgressMs - 2000` → 回滚到 `currentMs + 130`，仅在存在非零进度或有效音量时启动计时，文案「检测到《…》重新开始，歌词已回到开头」
   - 进度变化 → 将基准设为 `currentMs + 130` 并启动时钟（`playing`）
   - 首个进度 → 对齐基准；仅在 `currentMs > 0` 或有有效音量时启动计时，否则保持 `waitingForPlayback`
   - 进度不变但 `audioActive === true` 且 `audioPeak > AUDIO_PEAK_THRESHOLD` → 启动或继续单调时钟，不重复对齐陈旧进度；超过 1500ms 未变时标记为陈旧进度外推。进度重新变化后清除此标记并按真实位置校准。
   - 已在播放且音频会话仍活跃时，最近一次有效音量可延续 `PAUSED_AFTER_MS = 1500`，容忍伴奏短暂静音；仅有 Active、零音量、底噪或缺失峰值不能恢复已经暂停的时钟。
   - 超过 1500ms 无进度变化且不满足上述音量条件 → 暂停计时（`playing: false`）
9. 无采样进度但音频活跃 → 直接启动时钟；否则暂停计时

**+130ms 补偿**（`PROGRESS_COMPENSATION_MS`）：采样到的进度是界面显示值，比真实播放滞后，故每次对齐把基准前移 130ms。

### 6.3 暂停确认与恢复要点

- **暂停/恢复**：音频不活跃立即暂停（不受音量宽限影响）；有采样进度且进度停滞超过 1.5s、同时无近期有效音量（`audioPeak > 0.001`，仅限全民音频会话，不把 Active 本身视作伴奏在播）时判暂停。恢复后从已冻结位置继续，不重复套用陈旧进度，待真实进度恢复变化时重新对齐。
- **未起播状态**：`waitingForPlayback = !hasStartedCurrentTrack` 表示当前曲目尚未正式开始播放。

### 6.4 v3.3.14:loading 过渡跟踪(loadingTrackTitle)

| 事件                                                          | 行为                                                                                                                    | 出处                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 采样 `loading === true`                                       | `loadingTrackTitle = title`，重置时钟（进度此时不可信）                                                                    | [wesing-capture-engine.js](../../../../src/music/wesing-capture-engine.js)                                                                                                                                                                                                                                                 |
| **loading 标记消失且标题未变**（`loadingTrackTitle === title`） | 清标记，`pendingRefresh = refresh()` —— **恰好触发一次歌词刷新**（`refresh` 内部按 `state.trackTitle` 走 `refreshLyrics`） | [wesing-capture-engine.js](../../../../src/music/wesing-capture-engine.js)                                                                                                                                                                                                                                                 |
| 标题变化 / 平台丢失 / 标题清空 / 停用 / stop                  | 清 `loadingTrackTitle`（未触发的刷新作废）                                                                                | [wesing-capture-engine.js](../../../../src/music/wesing-capture-engine.js) |

动机:加载期间日志里可能已有新歌的 StartKSong、磁盘也刚开始写 QRC——标记消失是"播放真正开始"的最佳时机,一次刷新即可拿到新歌词,避免空轮询。

## 7. 歌词偏移、缓存发现与状态合成

### 7.1 偏移(lyricOffsetMs)

- 校验 `normalizeWeSingLyricOffsetMs`（±3000，取整，[wesing-cache.js](../../../../src/music/wesing-cache.js)）；`setLyricOffsetMs` 先持久化再生效，并立即重算歌词位置（[wesing-capture-engine.js](../../../../src/music/wesing-capture-engine.js)）。
- 生效点 `updateLyricState`（[wesing-capture-engine.js](../../../../src/music/wesing-capture-engine.js)）：`lyricCurrentMs = clamp(0, currentMs + offset)` 再夹到时长；`findCurrentLyricLine` 二分取当前行，产出 `lyricState`（经 `normalizeLyricState`，字段契约见 [services.md](services.md) §13）。
- 设置键 `weSingCachePath` / `weSingLyricOffsetMs` 为本机设置（不分区、不同步云端），持久化见 [storage.md](../storage.md) §7。

### 7.2 缓存目录自动发现与有效性校验

- **候选路径**　先检查已保存路径和当前用户 `%APPDATA%`、`%LOCALAPPDATA%` 下的 `Tencent\WeSing\WeSingCache`。跨盘发现仅探测 Windows 枚举为固定磁盘的根目录下的 `WeSingCache`。网络盘和移动盘上的缓存可手动指定，已保存路径继续复查。
- **自动复查与选择**　检测到客户端后每 3 秒复核当前目录和最新歌曲记录，每 30 秒复查用户目录。切歌和客户端恢复可提前触发用户目录检查。首次检测到客户端时可跨盘发现，此后持续检测到客户端时每 30 分钟最多一轮。手动「重新检测」可立即查固定盘。优先选择歌曲记录匹配当前歌名且日志最新的目录。歌名为空时比较含可读记录的日志。无法区分时保留有效的已保存路径，其次采用唯一有效候选。每轮刷新复用同一目录的快照。
- **有效性判定**：目录有效指 `Log/WeSing` 下有非空 `.log`，或 `WeSingDL/Res/<mid>/<mid>.qrc` 中存在 `0 < size ≤ 4MB` 的文件（空目录不算就绪；探测与手动保存均不创建目录）。日志未命中时，QRC 有效性检查以每批最多 100 个文件并行校验并在首个有效批次立即停止（实际歌词兜底仍按 §5.2 完整扫描并按 `mtime` 排序）。路径与就绪状态不变时仅核对当前 `mid`，已有歌词不重复加载、不写配置也不重置进度；前端交互与备用路径输入规则见 [playback.md](../../frontend/playback.md)。
- **配置保存、串行队列与授权校验**：通用 `POST /api/settings` 与专用 WeSing 配置入口复用采集器的 `prepareConfiguration`（先校验缓存目录与偏移并确认目录可用，再落盘，最后应用运行时状态；目录无效或事务失败时不更新运行时）。切目录会关闭旧 watcher、清理旧歌词并刷新；相同配置不重启监听。`setCachePath`（及自动识别写回）由采集器内部串行队列按接收顺序执行，避免慢速旧选择覆盖新选择，失败保留旧配置且不阻塞后续保存；并发重新检测共享同一发现请求。专用路径/偏移 setter 支持传入可选的 `authorize` 校验回调，由 HTTP 传入本次请求的账号归属校验，在排队准备完成后、保存前及应用运行时前复核；校验失效立即中止后续步骤（已完成的落盘不回滚；错误契约见 [API 通用约定](../api.md#0-路由机制与通用约定)）。

### 7.3 并发竞态与启停代次

- **启停与监听代次**：采集器的启停代次使旧目录检查、旧监视样本及延时刷新失效；停用和 `stop()` 同时递增 `refreshVersion`，旧歌词结果即使在重新启用后才返回也不得发布状态或时间轴。QRC watcher 单独维护监听代次，关闭后的目录检查、防抖回调和旧文件事件均不能重建监听或干扰新会话。
- **刷新竞态**：`refreshLyrics(title)`（[wesing-capture-engine.js](../../../../src/music/wesing-capture-engine.js)）递增 `refreshVersion`，在本地加载与在线兜底（§8）完成后核对 `version === refreshVersion && title === state.trackTitle`，不符即丢弃。无结果置 `qrcReady:false, status:'empty'`；有行置 `qrcReady:true, status:'ready'`，`durationMs` 缺失时用歌词时长补齐。`resetLyrics` 同样递增 `refreshVersion` 使在途刷新失效。
- **自动复查串行化**：目录发现按路径和标题合并在途请求；自动刷新同一时间只运行一个，校验生命周期、配置代次和标题后才保存并应用路径（停用、切歌或手动选择使旧结果失效，保存失败保留原路径并在后续样本重试）。定期复查依赖监视样本，无额外后台计时器；`waitForRefresh()` 同时等待当前自动复查与歌词加载。当前歌曲无有效歌词时，自动复查会继续尝试歌词解析，在线请求频率受 §8 退避策略约束。

## 8. 在线兜底(wesing-online-lyrics.js)

`createWeSingOnlineLyricResolver({ getRegistry, catalogService, lyricsService, platforms, getPreferences, preferredPlatform, smartMatch, now? })`（[wesing-online-lyrics.js](../../../../src/music/wesing-online-lyrics.js)）返回 `resolveWeSingOnlineLyrics({title, artist?, artists?, durationMs}, {songMid?, force?})` 与 `clear()`，由 [music-runtime.js](../../../../src/server/music-runtime.js) 注入 `weSingCapture` 的 `resolveFallbackLyrics`。目录查询使用 `catalogService.searchMusicTracks`，歌词获取使用 `lyricsService.getMusicTrackLyrics`。采集器从匹配标题的最新 `StartKSong` 日志记录提取 `artist` / `singer` 等歌手字段；在线搜索关键词为「歌名 歌手」，搜索时去掉歌手括号别名，匹配时保留别名（如 `en (王翊恩)` 可匹配 `en` 或 `王翊恩`）。

解析器只维护当前歌曲的一组并发在途请求和短期未命中状态（不写入长期歌词缓存）：当曲目版本、歌手、时长、平台偏好、registry 与授权修订号（[services.md §3.1](services.md#31-provider-registryjs)）均相同时复用同一个在途请求。

无可靠结果或全部失败时，首次完成后按单调时钟退避 30 秒，连续未命中后退避 60 秒。手动刷新可立即重试同一曲目，已有在途请求可以复用。解析器复核曲目版本、偏好、授权修订及 registry，启停时清除旧结果。空歌词的一般查找每 30 秒进行一次。存在对应 mid 时每 3 秒单独检查其 QRC，文件事件也可提前触发，因此等待在线重试期间仍能取得晚到的本地歌词。

流程:

1. 每次解析读取最新偏好；智能匹配歌词开启时以 `Promise.allSettled` 并行查询 QQ、网易云，关闭时只查询首选平台。每平台搜索 `searchMusicTracks`（limit 20），由 `rankWeSingLyricTracks` 筛选：歌名经 NFKC、大小写、空白和引号归一化后，去括号内容的基础歌名必须一致；输入明确带括号版本时，完整歌名也必须一致；已知歌手必须命中歌手或括号别名，不能把子串当成歌手匹配。请求和候选均有时长时，误差不得超过 `MAX_DURATION_DISTANCE_MS = 5000`。不使用普通点歌对翻唱、Live、专辑的加减分。
2. 平台内按时长距离从小到大取第一名（未知时长排后，同距离保留搜索顺序），读取其歌词，无行则弃。`selectBestLyricCandidate` 跨平台依次比较：时长距离 → `qualityScore`（1 + 有逐字词 + 有翻译）→ 歌词行数 → 首选平台。歌词完整度不能覆盖歌手、明确版本或时长匹配要求。
3. 产出 `result`:`source`/`songMid`(取 track id)/`title`/`artists`/`durationMs = max(窗口时长, track 时长, 最后一行 endMs)`/`lines`
4. 全部失败:有拒绝项则抛**第一个被拒绝项**的错误(`settled.find(status === 'rejected')`,供 weSingCapture 显示"在线歌词匹配失败"),否则 null

已知歌手但没有对应版本时返回空结果，不自动套用其他歌手的时间轴；没有歌手信息时仍可按歌名和时长筛选，但无法保证同名、同时长的不同翻唱完全消歧。窗口标题通常只有歌名，实际缓存目录中的日志和当前 mid 的 QRC 是更可靠的版本依据。

## 9. createWeSingCapture 契约

### 9.1 选项([wesing-capture-engine.js](../../../../src/music/wesing-capture-engine.js))

| 选项                                  | 默认                            | 说明                                                       |
| ------------------------------------- | ------------------------------- | ---------------------------------------------------------- |
| `now`                                 | `() => performance.now()`       | 时钟源(测试可注入)                                         |
| `platform`                            | `process.platform`              | 平台;非 win32 直接 `supported:false`                       |
| `onState` / `onTimeline`              | 空函数                          | WS 广播回调(§10)                                           |
| `monitorFactory`                      | `createPowerShellWeSingMonitor` | 监视器工厂(测试可注入)                                     |
| `logDir`                              | 无                              | 运行时注入 `resolveDataPaths(dataDir).logDir`，仅用于用户主动导出诊断 |
| `watchFactory`                        | `fs.watch` 包装                 | 目录监视工厂                                               |
| `setTimer` / `clearTimer`             | `setTimeout`/`clearTimeout`     | 防抖及诊断定时器                                           |
| `resolveFallbackLyrics`               | null                            | 在线兜底(§8);null 则无兜底                                 |
| `discoverCachePath`                   | 无                              | 异步目录发现函数；运行时注入固定候选发现器，测试可替换       |
| `saveCachePath` / `saveLyricOffsetMs` | 无                              | 设置持久化回调(写 `weSingCachePath`/`weSingLyricOffsetMs`) |
| `cachePath` / `lyricOffsetMs`         | 无                              | 初始值(非法值安全降级:空串 / 0)                            |

### 9.2 状态对象([wesing-capture-engine.js](../../../../src/music/wesing-capture-engine.js))

`getStatus()` 深拷贝快照:字段见 §2 图中 `wesing-state` 载荷,含 `status` 枚举与文案:

| status        | 触发                                               |
| ------------- | -------------------------------------------------- |
| `inactive`    | 初始 / 停用(文案"全民 K 歌捕捉未启用。")           |
| `unsupported` | 非 Windows 启用                                    |
| `waiting`     | 启用等待检测 / 平台丢失 / 标题清空                 |
| `loading`     | 标题变化、加载标记、刷新中("正在匹配《…》的歌词…") |
| `ready`       | QRC 就绪(本地或在线)                               |
| `empty`       | 本地 + 在线均无可用歌词                            |
| `error`       | 监视进程异常 / 启动监视失败                        |

另有 `cacheReady`（存在 §7.2 定义的实际缓存文件）、`platformDetected`、`qrcReady`、`songMid`、`lyricSource`（`wesing`/`qq`/`netease`）、`currentMs`/`durationMs`/`playing`/`waitingForPlayback`/`lyricOffsetMs`、内嵌 `lyricState`（`normalizeLyricState` 产物）。

### 9.3 返回 API([wesing-capture-engine.js](../../../../src/music/wesing-capture-engine.js))

| 方法                      | 行为                                                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `getStatus()`             | 状态深拷贝                                                                                                               |
| `setCachePath(input)`     | 校验 + 停 watcher + 持久化 + `resetLyrics` + `refresh`;返回新状态                                                        |
| `setLyricOffsetMs(input)` | ±3000 校验 + 持久化 + 立即重算 lyricState 并 emit                                                                        |
| `setActive(active)`       | 启停总开关:停 = 停监视/watcher/时钟;启 = supported 检查 → `monitor.start()` → `refresh`                                  |
| `refresh()`               | 已启用且支持时确保监视进程启动；启动失败保留错误状态。校验目录，无效时尝试自动发现，再同步 watcher；有标题则刷新歌词（`waitForRefresh` 等待在途歌词刷新） |
| `diagnose()`              | 已启用的 Windows 采集器开始或复用按需诊断；返回报告 Promise（§11）                                                        |
| `exportDiagnostics(startedAt)` | 将最近一份时间匹配的诊断报告写入日志目录；返回 `{path}`，不重新采样（§11） |
| `cancelDiagnostics()`     | 结束当前诊断并返回中断报告；服务关闭时在等待在途请求之前调用，不改变播放器状态                                             |
| `stop()`                  | 关闭一切(服务关闭时序调用点 [server.js](../../../../src/server.js),见 [server-core.md](../server-core.md) §6.2) |

## 10. WS 集成与本地端点

装配([music-runtime.js](../../../../src/server/music-runtime.js)):

| 回调                   | 候选更新与广播                                                                                                                                                                                |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `onState(state)` | 广播管理采集状态 `{type:'wesing-state', state}`，并经 `acceptExternalState('wesing', state, state.lyricState)` 更新 WeSing 候选 |
| `onTimeline(timeline)` | 经 `acceptExternalTimeline('wesing', timeline)` 归一化并缓存 WeSing 候选时间轴 |

候选更新后由 `music-runtime` 统一仲裁，只有切换输出来源或更新当前输出来源时发布歌词；完整选择与版本规则见 [音乐服务 §13](services.md#13-歌词状态与时间轴lyric-statejs--lyric-timelinejs)。本地 QRC 和在线兜底只决定 WeSing 候选内容，不绕过来源选择。消息契约归属 [ws.md](../ws.md) §3;管理快照中的 `weSing` 取 `weSingCapture.getStatus()`([music-runtime.js](../../../../src/server/music-runtime.js))。

本地端点前缀为 `/api/music/wesing/*`(端点清单与请求体见 [api.md](../api.md) 的 wesing-routes 节,此处不枚举):全部路由转发到 `context.weSing` 门面([api-context.js](../../../../src/server/api-context.js)),统一 `{ok, data}` 包装、业务失败回 400;`configure`/`offset` 在门面内完成设置持久化(§9.1 的 save 回调),`active`/`refresh` 直接透传采集器。

## 11. 按需播放诊断

桌面「播放 → 全民 K 歌」的「播放诊断」入口调用管理端 `POST /api/music/wesing/diagnose`（无用户参数，不允许指定路径、采样时长或原始日志；鉴权与状态码见 [api.md](../api.md) 的 wesing-routes 节）。

诊断复用当前监视器，固定采样 20 秒，记录间隔至少 250ms、最多 80 条，不创建第二个进程。并发请求共用一次采样。停用、停止采集或服务器关闭会清理计时器，以 `reason: 'stopped'` 返回已有记录；正常完成为 `reason: 'completed'`。服务器在等待在途 HTTP 请求之前取消诊断，避免关闭时等待完整采样周期。

报告 `version: 1` 包含 `startedAt`（ISO 时间）、`durationMs`、`reason`、`initial`/`final` 播放快照、`summary` 和 `samples`：

- 播放快照白名单：歌名（最多 120 字符）、缓存/歌词就绪状态、歌词来源和行数、首句时间、有无当前歌词、播放位置、时长、播放状态。没有缓存路径或歌词正文。
- 样本白名单：相对采样时间、客户端检测、原始进度/时长、加载状态、进度来源（`msaa`/`uia`）、音频活跃状态、峰值、设备/会话计数、是否达到现有有效音量阈值、错误布尔标志和播放快照。没有原始异常文本、控件列表、账号凭据、歌曲日志或录音。
- `summary` 包含客户端/声音是否被检测到、原始进度/歌词时钟是否净推进至少 1 秒、设备/会话计数及峰值的采样最大值、错误样本数。结果优先级为 `interrupted` → `no-samples` → `monitor-error`（全部样本异常）→ `client-missing` → `track-missing` → `track-changed` → `lyrics-missing` → `playback-stalled` → `intro` → `ready`。`intro` 表示已推进但尚未到首句；`ready` 仅表示采样期间歌词时钟正常推进，不代表外部直播画面同步状态。

前端展示本次歌曲、歌词、进度和音频结果；采样期间禁用重复启动，失败可重试，收起后迟到结果不会自动展开。诊断服务在内存中仅保留最近一份已完成的报告；点击「导出诊断」时调用管理端 `POST /api/music/wesing/diagnose/export`，以 `startedAt` 严格匹配报告（服务端只写自身白名单报告，不接收客户端报告正文或路径）。

保存位置复用 `resolveDataPaths(dataDir).logDir`（LIRA 数据目录同级 `logs` 文件夹），文件名为 `wesing-playback-diagnostic-YYYY-MM-DD_HH-mm-ss-SSS.json`（导出时本机时间，含毫秒）。按需创建日志目录并以 `wx` 排他创建文件，同名冲突不覆盖，成功返回 `{path}`，不会自动导出或上传。端点和前端适配器分别见 [api.md](../api.md) 和 [playback.md](../../frontend/playback.md)。

### 11.1 开发诊断工具

[scripts/inspect-wesing-playback.js](../../../../scripts/inspect-wesing-playback.js)(配套 `inspect-wesing-playback.cmd`)输出 `tmp/wesing-playback-diagnostic-<时间戳>.jsonl`:

- CLI:`--cache <WeSingCache>`(缺省读运行中服务的 `/api/music/wesing/status` 拿当前配置,[inspect-wesing-playback.js:96-126](../../../../scripts/inspect-wesing-playback.js#L96-L126))、`--output <文件>`、`--duration <秒>`(≤3600)、`-h`
- 记录类型:实时日志探针(`wesing-log-file` / `wesing-log-line` / `wesing-log-error`,UTF-16LE 增量轮询,行截 8000 字符)、监视样本、按键标记(1-6:点击 K 歌/暂停/继续/退出/重进/此刻歌词状态不正确,[inspect-wesing-playback.js:11-18](../../../../scripts/inspect-wesing-playback.js#L11-L18))
- 用途:排查采集链路各环节(窗口检测、MSAA 进度、QRC 加载、歌词对位),详见 [engineering/test.md](../../engineering/test.md)
