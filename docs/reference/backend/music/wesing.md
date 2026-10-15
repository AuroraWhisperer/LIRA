# 全民 K 歌采集(wesing-capture)

> 涉及文件:[wesing-capture.js](../../../../src/music/wesing-capture.js)、[wesing-capture-engine.js](../../../../src/music/wesing-capture-engine.js)、[wesing-playback-clock.js](../../../../src/music/wesing-playback-clock.js)、[wesing-lyric-resolver.js](../../../../src/music/wesing-lyric-resolver.js)、[wesing-qrc-watcher.js](../../../../src/music/wesing-qrc-watcher.js)、[wesing-native-monitor-source.js](../../../../src/music/wesing-native-monitor-source.js)、[wesing-online-lyrics.js](../../../../src/music/wesing-online-lyrics.js)、[lyric-parser.js](../../../../src/music/lyric-parser.js)(findCurrentLyricLine)、[lyric-state.js](../../../../src/music/lyric-state.js)、[lyric-timeline.js](../../../../src/music/lyric-timeline.js)、[server.js](../../../../src/server.js)(装配)、[inspect-wesing-playback.js](../../../../scripts/inspect-wesing-playback.js)(诊断)
> 依赖:`qrc-decoder`(QRC 解密);运行时内嵌 PowerShell + C# 监视源码

本文档是 WeSing(全民 K 歌)**离线歌词采集**的唯一事实源:监视源、日志/QRC 扫描、播放时钟、v3.3.14 的 loading 过渡跟踪、在线兜底打分与 WS 集成只在此成表。消息契约见 [ws.md](../ws.md),设置持久化见 [storage.md](../storage.md) §7,诊断工具见 [engineering/test.md](../../engineering/test.md)。

**内部模块边界:** `wesing-capture.js` 是兼容导出门面；`wesing-capture-engine.js` 拥有采集生命周期和监视样本状态机；`wesing-playback-clock.js` 只维护单调播放时钟；`wesing-lyric-resolver.js` 只决定本地/在线歌词结果；`wesing-qrc-watcher.js` 管理 QRC 和歌曲日志的文件监听与事件合并；`wesing-cache.js` 拥有目录、日志、QRC 解密与偏移校验；[wesing-cache-discovery.js](../../../../src/music/wesing-cache-discovery.js) 只探测固定候选缓存位置，由运行时注入引擎；`wesing-monitor.js` 拥有 PowerShell 进程与脚本组装；[wesing-diagnostics.js](../../../../src/music/wesing-diagnostics.js) 负责按需记录现有样本和归纳诊断结果。这些模块不反向依赖引擎状态。

采集器的启停代次使旧目录检查、旧监视样本及延时刷新失效；停用和 `stop()` 同时推进歌词刷新版本。旧歌词结果即使在重新启用后才返回，也不能发布状态或时间线。QRC watcher 单独持有监听代次，关闭后的目录检查、防抖回调和旧文件事件均不能重新创建监听或干扰新会话。

通用 `POST /api/settings` 与专用 WeSing 配置入口复用采集器的 `prepareConfiguration`：先校验缓存目录和歌词偏移、确认目录可用，再提交设置，成功后应用运行时状态。通用入口用原有 `setMany` 事务保存整批设置；目录无效或事务失败时不更新运行时。切换目录会关闭旧 watcher、清理旧歌词并刷新；只修改偏移会立即重算歌词位置，相同配置不重启监听。目录在校验后消失时沿用采集器既有不可用状态。

专用目录保存 `setCachePath` 按接收顺序串行完成实际缓存校验、持久化和运行态应用，避免较慢的旧选择在新选择之后覆盖配置；失败会向调用方返回错误，保留旧有效配置，且不阻塞后续保存。自动识别复用此保存队列，手动配置和启停代次会使未完成的旧识别结果失效；并发重新检测共用一次发现请求。此顺序由采集器拥有，与前端信源启停的 `activationQueue` 分开。

## 1. 概述

Windows 独有(仅 `platform === 'win32'` 支持):采集全民 K 歌客户端**正在播放**的歌曲,把本地缓存的逐字歌词(QRC)或在线匹配歌词叠加为实时桌面歌词。能力边界:

- 采集的是客户端**本地行为**(窗口标题、播放进度、音频会话、磁盘缓存),不碰任何全民 K 歌上游 API
- 播放进度靠 100ms 轮询的窗口/辅助功能快照 + `performance.now()` 单调时钟外推
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
| `PAUSED_AFTER_MS`          | 1500(进度停滞且无近期有效音量时判暂停)            | [wesing-capture-engine.js](../../../../src/music/wesing-capture-engine.js)            |
| `AUDIO_PEAK_THRESHOLD`     | 0.001(峰值大于此值才作为有效音量)                 | [wesing-capture-engine.js](../../../../src/music/wesing-capture-engine.js)            |
| `PROGRESS_COMPENSATION_MS` | 130(进度采样补偿)                                 | [wesing-capture-engine.js](../../../../src/music/wesing-capture-engine.js)            |
| `QRC_REFRESH_DEBOUNCE_MS`  | 2000(fs.watch 防抖)                               | [wesing-qrc-watcher.js](../../../../src/music/wesing-qrc-watcher.js)            |
| `AUTOMATIC_REFRESH_INTERVAL_MS` | 3000(监视样本触发的自动复查间隔)               | [wesing-capture-engine.js](../../../../src/music/wesing-capture-engine.js) |
| `MIN/MAX_LYRIC_OFFSET_MS`  | ±3000(歌词时间偏移夹取)                           | [wesing-cache.js](../../../../src/music/wesing-cache.js)     |
| `SAFE_SONG_MID`            | `/^[a-zA-Z0-9_-]{1,128}$/`(mid 白名单,防路径穿越) | [wesing-cache.js](../../../../src/music/wesing-cache.js)            |
| PowerShell 轮询间隔        | 默认 100ms,clamp 100–5000                         | [wesing-monitor.js](../../../../src/music/wesing-monitor.js) |

## 4. 监视源(两层)

### 4.1 PowerShell 外壳(createPowerShellWeSingMonitor,[wesing-monitor.js](../../../../src/music/wesing-monitor.js))

- 启动参数:`powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command <command>`,`windowsHide: true`
- **脚本注入方式(v3.3.13 起)**:脚本 UTF-8 编码 → Base64 → `[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('<b64>')) | Invoke-Expression`([wesing-monitor.js](../../../../src/music/wesing-monitor.js));替换了旧版 UTF-16 `-EncodedCommand`(解决中文编码问题)
- stdout 按行解析:每行非空即 `JSON.parse` 成样本喂 `onSample`,半行残留攒到下一块;stderr 保留最近 2000 字符;非主动停止的退出(exit 非 0)上报 `{error}`
- `buildPowerShellMonitorScript(options)`([wesing-monitor.js](../../../../src/music/wesing-monitor.js)):内嵌 C# 源码 `Add-Type -TypeDefinition … -ReferencedAssemblies Accessibility` 编译;每轮:找进程 → 音频快照 → 找播放窗口 → MSAA 进度 → UIA 兜底 → `ConvertTo-Json -Compress` 输出 + `Start-Sleep`

### 4.2 C# 原生监视源(WESING_NATIVE_MONITOR_SOURCE,[wesing-native-monitor-source.js:3-351](../../../../src/music/wesing-native-monitor-source.js#L3-L351))

编译进 PowerShell 进程的 `WeSingNativeMonitor` 静态类,三个入口:

| 方法                                    | 行为                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `FindPlaybackWindow(processIds)`        | `EnumWindows` 遍历**全部顶层窗口(含隐藏窗口)**,`GetWindowThreadProcessId` 匹配进程 → 标题以 `"全民K歌 - "`(`全民K歌 - `)开头且长度 > 7 → 返回 `{Handle, Title}`(取第一个即停)([wesing-native-monitor-source.js:70-89](../../../../src/music/wesing-native-monitor-source.js#L70-L89))                                                                                                                                                                                                                              |
| `GetAccessiblePlaybackSnapshot(handle)` | MSAA:`AccessibleObjectFromWindow(OBJID_CLIENT = 0xFFFFFFFC)` 拿 `IAccessible` 根,深度优先遍历(`MaximumAccessibleDepth = 20`、`MaximumAccessibleNodes = 3000` 双上限);每个节点 `get_accName` 匹配 `^\s*(\d{1,3}):(\d{2})\s*\|\s*(\d{1,3}):(\d{2})\s*$`(**MM:SS \| MM:SS 双进度**),校验 `total > 0 && 0 ≤ current ≤ total` 后返回 `{CurrentSec, TotalSec}`;任何节点名含 `"歌曲加载中"` 置 `Loading = true`([wesing-native-monitor-source.js:91-186](../../../../src/music/wesing-native-monitor-source.js#L91-L186)) |
| `GetAudioSessionSnapshot(processIds)`   | WASAPI: `EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE)` 枚举全部可用输出设备 → `IAudioSessionManager2.GetSessionEnumerator` 遍历会话，按 `IAudioSessionControl2.GetProcessId` 匹配全民进程；任一匹配会话 Active=1 即 `audioActive=true`，跨设备取最大峰值。无匹配会话 `State=-1`，单设备异常不阻断其他设备，每层 COM 引用均释放。覆盖 Windows 可见的内置、独立及虚拟声卡，无需切换默认输出。 |

音频快照同时输出 `outputDeviceCount`（可用输出设备数）、`audioSessionCount`（匹配的全民会话数）、`activeAudioSessionCount`（其中活跃的会话数）。它们随原始监视样本进入按需诊断，不进入普通 `wesing-state` 广播。未找到全民进程时不扫描音频设备；计数为 0 不代表系统没有声卡。音频活跃状态与峰值仍按 §6 的现有时钟规则共同判定，其他应用的声音不能推动全民歌词。

PowerShell 侧兜底:**MSAA 未给出进度时**,UIAutomation 从窗口句柄 `AutomationElement.FromHandle` 找全部 Text 控件,`Name` 匹配同一正则即 `progressSource: 'uia'`,含"歌曲加载中"同样置 loading([wesing-monitor.js](../../../../src/music/wesing-monitor.js));`includeDiagnostics` 开启时额外收集控件清单(≤250 行,仅 Button/Text/Slider)。

## 5. 缓存/日志扫描与 QRC 歌词

### 5.1 日志扫描(findLatestSongEntry,[wesing-cache.js](../../../../src/music/wesing-cache.js))

1. `Log/WeSing/` 下全部 `*.log` 按 mtime 降序取**最新文件**
2. 从尾部按 `LOG_TAIL_BYTES = 100 KiB` 向前分块读取，找到歌曲记录即停止，总量最多 `MAX_LOG_SCAN_BYTES = 4 MiB + 1 字节`。起始偏移按数值整除向下取整至偶数(UTF-16LE 防半个字符)，避免大于 2 GiB 的文件偏移被位运算截断；单块最多 100 KiB + 1 字节。
3. 每块 `utf16le` 解码，保留跨块未完行（最多 50 Ki 字符），按行**倒序**找含 `"StartKSong"` 的行，正则提取 `"mid"` 与 `"songname"`(`decodeJsonString` 解转义)。普通日志增长超过 100 KiB 后仍可恢复当前版本。
4. `SAFE_SONG_MID` 校验失败整体返回 null；最新歌曲记录与期望标题按 `normalizeTitle`(去"全民K歌 - "前缀 + 去空白 + 小写)不相等时也返回 null，不跳过它去找更早播放的同名歌曲。

### 5.2 QRC 歌词加载(loadWeSingLyrics,[wesing-cache.js](../../../../src/music/wesing-cache.js))

1. 日志命中 → 只读 `WeSingDL/Res/<mid>/<mid>.qrc`；缺失或无法解析则进入在线兜底，不再借用其他 mid 下的同名歌词。mid 标识当前伴奏版本。
2. 仅在日志未命中时兜底扫描 `listRecentQrcFiles`([wesing-cache.js](../../../../src/music/wesing-cache.js))——`SAFE_SONG_MID` 子目录批量(每批 100)stat 各自的 `.qrc`(`0 < size ≤ 4MB`)，按 mtime 降序取最多 80 个。候选中只有一份标题匹配(`normalizeTitle` 相等)时才采用；多份同名缓存返回 null，交给在线匹配，不按文件新旧猜版本。仅凭唯一缓存标题仍无法保证实际伴奏版本一致，应优先配置实际写入日志与 QRC 的缓存目录。

resolver 每次只读取一次歌曲日志，并通过 `loadWeSingLyrics({cachePath, title, logEntry})` 将同一条记录用于本地定位和在线歌手匹配。QRC 缺少歌手元数据时采用该日志的歌手；记录的 mid 单独返回引擎作为版本标识，不与在线平台的 track id 混用。

### 5.3 QRC 解密与解析(tryReadQrc / parseQrcDocument,[wesing-cache.js](../../../../src/music/wesing-cache.js))

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

### 6.1 单调外推(performance.now(),[wesing-playback-clock.js](../../../../src/music/wesing-playback-clock.js))

- `now` 可注入,默认 `performance.now()`(monotonic,不受系统时间跳变影响)
- 时钟 = `baseMs + (running ? now - startedAt : 0)`,`readPlaybackClock` 再夹到 `[0, durationMs]`(`state.durationMs || lyricDurationMs`)
- `setPlaybackClock(ms, ts)` 设基准并保持当前走/停状态;`startPlaybackClock` 起走(幂等);`pausePlaybackClock` 冻结当前值;`resetPlaybackClock` 归零并清进度、有效音量和陈旧进度外推记录及 `hasStartedCurrentTrack`

### 6.2 采样对齐(handleMonitorSample,[wesing-capture-engine.js](../../../../src/music/wesing-capture-engine.js))

每个样本按分支顺序处理:

1. `error` → 停时钟、`status:'error'`、错误文案截 160
2. 平台未检测(`detected !== true`)→ 停时钟、`waiting`
3. **平台刚恢复**(`platformResumed`)= 上次未检测且标题没变 → `currentMs=0`、重置时钟(不重新拉歌词)
4. **标题变化** → 清 `loadingTrackTitle`、`resetLyrics`、`status:'loading'`、`pendingRefresh = refreshLyrics(title)`
5. 标题为空 → 停时钟、`waiting`
6. `loading === true` → 记 `loadingTrackTitle = title`、重置时钟、`status` 保持 loading 文案(v3.3.14 见 §6.4)
7. 音频不活跃(`audioActive === false`)→ 立即停时钟并清近期音量证据;若有采样进度则 `setPlaybackClock(currentMs + 130ms)`，但已由音频外推的陈旧同值进度不能把时钟拉回；进度变化后重新作为有效锚点。
8. 有采样进度:
   - **重播检测**(`replayedFromStart`):`lastProgressMs > 3000 && currentMs ≤ 2000 && currentMs < lastProgressMs - 2000` → 回滚到 `currentMs + 130`，有非零进度或有效音量才起走，文案"检测到《…》重新开始,歌词已回到开头"
   - 进度变化 → `setPlaybackClock(currentMs + 130)` 并 `startPlaybackClock`(playing)
   - 首个进度 → 对齐基准;`currentMs > 0` 或有有效音量才起走，否则保持 `waitingForPlayback`
   - 进度不变但 `audioActive === true` 且 `audioPeak > AUDIO_PEAK_THRESHOLD` → 起走或继续单调时钟，不重复对齐陈旧进度；超过 1500ms 未变时标记为陈旧进度外推。进度重新变化后清除此标记并按真实位置校准。
   - 已在播放且音频会话仍活跃时，最近一次有效音量可延续 `PAUSED_AFTER_MS = 1500`，容忍伴奏短暂静音；仅有 Active、零音量、底噪或缺失峰值不能恢复已经暂停的时钟。
   - 超过 1500ms 无进度变化且不满足上述音量条件 → 停时钟(playing: false)
9. 无进度但音频活跃 → 直接起走时钟;否则停走

**+130ms 补偿**(`PROGRESS_COMPENSATION_MS`):采样到的进度是界面显示值,比真实播放滞后,故每次对齐把基准前移 130ms。

### 6.3 暂停确认

有采样进度时，暂停判定为进度停滞超过 1.5s 且无近期有效音量(§6.2 步骤 8 末支)；恢复判定为下一次进度变化或新的有效音量。音频明确不活跃仍立即暂停，不受音量宽限影响。声音恢复后从已冻结的位置继续，不能重复套用陈旧进度；真实进度恢复时重新对齐。`waitingForPlayback = !hasStartedCurrentTrack` 表达"本曲还没正式播过"。

音量只用于已经检测到的全民音频会话，阈值为 0.001；不能把 Active 本身当作伴奏仍在播放。若进度冻结同时音量不可用或持续低于阈值，仍会按暂停处理；无采样进度时沿用 §6.2 步骤 9 的既有音频会话兜底。

### 6.4 v3.3.14:loading 过渡跟踪(loadingTrackTitle)

| 事件                                                          | 行为                                                                                                                    | 出处                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 采样 `loading === true`                                       | `loadingTrackTitle = title`,重置时钟(进度此时不可信)                                                                    | [wesing-capture-engine.js](../../../../src/music/wesing-capture-engine.js)                                                                                                                                                                                                                                                 |
| **loading 标记消失且标题未变**(`loadingTrackTitle === title`) | 清标记,`pendingRefresh = refresh()` —— **恰好触发一次歌词刷新**(`refresh` 内部按 `state.trackTitle` 走 `refreshLyrics`) | [wesing-capture-engine.js](../../../../src/music/wesing-capture-engine.js)                                                                                                                                                                                                                                                 |
| 标题变化 / 平台丢失 / 标题清空 / 停用 / stop                  | 清 `loadingTrackTitle`(未触发的刷新作废)                                                                                | [wesing-capture-engine.js](../../../../src/music/wesing-capture-engine.js)、[wesing-capture-engine.js](../../../../src/music/wesing-capture-engine.js)、[wesing-capture-engine.js](../../../../src/music/wesing-capture-engine.js)、[wesing-capture-engine.js](../../../../src/music/wesing-capture-engine.js) |

动机:加载期间日志里可能已有新歌的 StartKSong、磁盘也刚开始写 QRC——标记消失是"播放真正开始"的最佳时机,一次刷新即可拿到新歌词,避免空轮询。

## 7. 歌词偏移与状态合成

### 7.1 偏移(lyricOffsetMs)

- 校验 `normalizeWeSingLyricOffsetMs`(±3000,取整,[wesing-cache.js](../../../../src/music/wesing-cache.js));`setLyricOffsetMs` 先持久化再生效([wesing-capture-engine.js](../../../../src/music/wesing-capture-engine.js))
- 生效点 `updateLyricState`([wesing-capture-engine.js](../../../../src/music/wesing-capture-engine.js)):`lyricCurrentMs = clamp(0, currentMs + offset)` 再夹到时长;`findCurrentLyricLine` 二分取当前行,产出 `lyricState`(经 `normalizeLyricState`,字段契约见 [services.md](services.md) §13)
- 设置键 `weSingCachePath` / `weSingLyricOffsetMs`,持久化见 [storage.md](../storage.md) §7
- 默认设置仍为当前 Windows 用户的 `%APPDATA%\Tencent\WeSing\WeSingCache`；候选包括已保存路径、`%APPDATA%`、`%LOCALAPPDATA%` 下的 `Tencent\WeSing\WeSingCache` 和 C–Z 盘根的 `WeSingCache`（如 `E:\WeSingCache`）。用户目录从当前进程环境读取，不写死用户名或 C 盘；用户目录迁移后仍按实际位置探测。缓存与全民安装目录可以不在同一盘，不递归扫描磁盘，也不从安装盘推断唯一位置。
- 启用时检查缓存；检测到客户端后，监视样本每 3 秒最多触发一次自动复查，客户端恢复或歌名变化可立即触发。在所有有效候选中，优先选择最新歌曲记录匹配当前歌名且日志写入时间最新的目录（歌名为空时比较可读取歌曲记录的日志）。无法区分活动候选时保留有效已保存路径，否则仅采用唯一有效候选；没有结果则继续等待并自动重试。旧目录仍有文件不阻止跟随新位置。
- 有效指 `Log/WeSing` 有非空 `.log`，或 `WeSingDL/Res/<mid>/<mid>.qrc` 为 `0 < size ≤ 4MB` 的文件；空目录不算就绪。探测和手动保存都不创建目录。首次播放生成日志或稍后下载 QRC 都由自动复查接续，不要求点击重新检测。路径/就绪状态不变时仅核对当前 mid；已有歌词不重复加载、不保存配置、不重置进度，空歌词会在后续复查重试。
- 播放页说明自动识别与跟随，文件夹按钮和“保存并检测”保留作特殊位置的备用入口；实时状态可回填识别结果，但不能覆盖尚未保存的输入草稿。

### 7.2 刷新竞态

`refreshLyrics(title)`([wesing-capture-engine.js](../../../../src/music/wesing-capture-engine.js)):`version = ++refreshVersion`;本地加载 + 在线兜底(§8)都完成后校验 `version !== refreshVersion || title !== state.trackTitle` 则丢弃结果(切歌/重复刷新的旧结果不得落地)。无结果 → `qrcReady:false, status:'empty'`;有行 → `qrcReady:true, status:'ready'`,`durationMs` 缺失时用歌词时长补。`resetLyrics` 同样 `refreshVersion++` 使在途刷新失效。

目录发现按路径和标题共用在途请求；自动刷新每次只运行一个，检查生命周期、配置代际和标题后才保存/应用路径。停用、切歌或手动选择使旧结果失效；保存失败保留原路径并在后续样本重试。定期复查依赖既有监视样本，无新增后台计时器；停用后不再触发。`waitForRefresh()` 同时等待当前自动复查和歌词加载。

## 8. 在线兜底(wesing-online-lyrics.js)

`createWeSingOnlineLyricResolver({ getRegistry, lyricsService, platforms, getPreferences, preferredPlatform, smartMatch })`([wesing-online-lyrics.js](../../../../src/music/wesing-online-lyrics.js))返回 `resolveWeSingOnlineLyrics({title, artist?, artists?, durationMs})`,由 [music-runtime.js](../../../../src/server/music-runtime.js) 注入 weSingCapture 的 `resolveFallbackLyrics`。采集器从匹配标题的最新 `StartKSong` 日志记录提取 `artist`/`singer` 等歌手字段；在线搜索关键词为“歌名 歌手”，搜索时去掉歌手的括号别名，匹配时保留别名，例如 `en (王翊恩)` 可匹配 `en` 或 `王翊恩`。

流程:

1. 每次解析读取最新偏好；智能选词开启时以 `Promise.allSettled` 并行查询 QQ、网易云，关闭时只查询首选平台。每平台搜索 `searchMusicTracks`（limit 20），由 `rankWeSingLyricTracks` 筛选：歌名经 NFKC、大小写、空白和引号归一化后，去括号内容的基础歌名必须一致；输入明确带括号版本时，完整歌名也必须一致；已知歌手必须命中歌手或括号别名，不能把子串当成歌手匹配。请求和候选均有时长时，误差不得超过 `MAX_DURATION_DISTANCE_MS = 5000`。不使用普通点歌对翻唱、Live、专辑的加减分。
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

另有 `cacheReady`(存在 §7.1 定义的实际缓存文件)、`platformDetected`、`qrcReady`、`songMid`、`lyricSource`(`wesing`/`qq`/`netease`)、`currentMs`/`durationMs`/`playing`/`waitingForPlayback`/`lyricOffsetMs`、内嵌 `lyricState`(normalizeLyricState 产物)。

### 9.3 返回 API([wesing-capture-engine.js](../../../../src/music/wesing-capture-engine.js))

| 方法                      | 行为                                                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `getStatus()`             | 状态深拷贝                                                                                                               |
| `setCachePath(input)`     | 校验 + 停 watcher + 持久化 + `resetLyrics` + `refresh`;返回新状态                                                        |
| `setLyricOffsetMs(input)` | ±3000 校验 + 持久化 + 立即重算 lyricState 并 emit                                                                        |
| `setActive(active)`       | 启停总开关:停 = 停监视/watcher/时钟;启 = supported 检查 → `monitor.start()` → `refresh`                                  |
| `refresh()`               | 校验目录，无效时尝试自动发现，再同步 watcher；有标题则刷新歌词（`waitForRefresh` 等待在途歌词刷新）                      |
| `diagnose()`              | 已启用的 Windows 采集器开始或复用按需诊断；返回报告 Promise（§11）                                                        |
| `exportDiagnostics(startedAt)` | 将最近一份时间匹配的诊断报告写入日志目录；返回 `{path}`，不重新采样（§11） |
| `cancelDiagnostics()`     | 结束当前诊断并返回中断报告；服务关闭时在等待在途请求之前调用，不改变播放器状态                                             |
| `stop()`                  | 关闭一切(服务关闭时序调用点 [server.js](../../../../src/server.js),见 [server-core.md](../server-core.md) §6.2) |

## 10. WS 集成与本地端点

装配([music-runtime.js](../../../../src/server/music-runtime.js)):

| 回调                   | 广播                                                                                                                                                                                |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `onState(state)`       | `{type:'wesing-state', state}`;且 active 且有 `lyricState` 时同步为全局 `lyricState` 并广播 `{type:'lyric-state', state}`([music-runtime.js](../../../../src/server/music-runtime.js)) |
| `onTimeline(timeline)` | `timeline.active` 时经 `publishLyricTimeline` 归一化后广播 `{type:'lyric-timeline', timeline}`([music-runtime.js](../../../../src/server/music-runtime.js))                            |

消息契约归属 [ws.md](../ws.md) §3;快照 17 字段中的 `weSing` 取 `weSingCapture.getStatus()`([music-runtime.js](../../../../src/server/music-runtime.js))。

本地端点前缀为 `/api/music/wesing/*`(端点清单与请求体见 [api.md](../api.md) 的 wesing-routes 节,此处不枚举):全部路由转发到 `context.weSing` 门面([api-context.js](../../../../src/server/api-context.js)),统一 `{ok, data}` 包装、业务失败回 400;`configure`/`offset` 在门面内完成设置持久化(§9.1 的 save 回调),`active`/`refresh` 直接透传采集器。

## 11. 按需播放诊断

桌面“播放 → 全民 K歌”在“重新检测”左侧提供“播放诊断”，调用管理端 `POST /api/music/wesing/diagnose`。沿用现有管理端认证；匿名请求返回 401，歌词 overlay 凭据不能访问。非 Windows 或采集未启用时返回 400。没有用户参数，不允许指定路径、采样时长或原始日志。

诊断复用当前监视器，固定采样 20 秒，记录间隔至少 250ms、最多 80 条，不创建第二个进程。并发请求共用一次采样。停用、停止采集或服务器关闭会清理计时器，以 `reason: 'stopped'` 返回已有记录；正常完成为 `reason: 'completed'`。服务器在等待在途 HTTP 请求之前取消诊断，避免关闭时等待完整采样周期。

报告 `version: 1` 包含 `startedAt`（ISO 时间）、`durationMs`、`reason`、`initial`/`final` 播放快照、`summary` 和 `samples`：

- 播放快照白名单：歌名（最多 120 字符）、缓存/歌词就绪状态、歌词来源和行数、首句时间、有无当前歌词、播放位置、时长、播放状态。没有缓存路径或歌词正文。
- 样本白名单：相对采样时间、客户端检测、原始进度/时长、加载状态、进度来源（`msaa`/`uia`）、音频活跃状态、峰值、设备/会话计数、是否达到现有有效音量阈值、错误布尔标志和播放快照。没有原始异常文本、控件列表、账号凭据、歌曲日志或录音。
- `summary` 包含客户端/声音是否被检测到、原始进度/歌词时钟是否净推进至少 1 秒、设备/会话计数及峰值的采样最大值、错误样本数。结果优先级为 `interrupted` → `no-samples` → `monitor-error`（全部样本异常）→ `client-missing` → `track-missing` → `track-changed` → `lyrics-missing` → `playback-stalled` → `intro` → `ready`。`intro` 表示已推进但尚未到首句；`ready` 表示采样期间歌词时钟推进，不代表远端直播画面已验证同步。

前端展示本次歌曲、歌词、进度和音频结果。采样期间禁用重复启动，失败可重试，收起后迟到结果不会自动展开。诊断 owner 在内存中只保留最近一份已结束的报告；点击“导出诊断”才调用管理端 `POST /api/music/wesing/diagnose/export`，以 `startedAt` 严格匹配报告。未完成任何诊断或该报告已被后续诊断替换时返回 400。服务端只写自己的白名单报告，不接收客户端报告正文或文件路径；认证边界与诊断端点相同。

保存位置复用 `resolveDataPaths(dataDir).logDir`，即 LIRA 数据目录同级的 `logs` 文件夹。文件名为 `wesing-playback-diagnostic-YYYY-MM-DD_HH-mm-ss-SSS.json`，采用导出时的本机时间，含毫秒。需要时创建日志目录，以 `wx` 排他创建文件，同名冲突不覆盖；写入失败返回 400，前端保留报告以便重试。成功返回 `{path}` 并在面板显示完整保存路径；保存期间阻止重复点击，旧导出结果不会覆盖新诊断的状态文案。不会自动导出或上传。端点和前端适配器分别见 [api.md](../api.md) 和 [playback.md](../../frontend/playback.md)。

### 11.1 开发诊断工具

[scripts/inspect-wesing-playback.js](../../../../scripts/inspect-wesing-playback.js)(配套 `inspect-wesing-playback.cmd`)输出 `tmp/wesing-playback-diagnostic-<时间戳>.jsonl`:

- CLI:`--cache <WeSingCache>`(缺省读运行中服务的 `/api/music/wesing/status` 拿当前配置,[inspect-wesing-playback.js:96-126](../../../../scripts/inspect-wesing-playback.js#L96-L126))、`--output <文件>`、`--duration <秒>`(≤3600)、`-h`
- 记录类型:实时日志探针(`wesing-log-file` / `wesing-log-line` / `wesing-log-error`,UTF-16LE 增量轮询,行截 8000 字符)、监视样本、按键标记(1-6:点击 K 歌/暂停/继续/退出/重进/此刻歌词状态不正确,[inspect-wesing-playback.js:11-18](../../../../scripts/inspect-wesing-playback.js#L11-L18))
- 用途:排查采集链路各环节(窗口检测、MSAA 进度、QRC 加载、歌词对位),详见 [engineering/test.md](../../engineering/test.md)
