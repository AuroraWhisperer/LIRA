# 全民 K 歌采集(wesing-capture)

> 涉及文件:[wesing-capture.js](../../../../src/music/wesing-capture.js)、[wesing-native-monitor-source.js](../../../../src/music/wesing-native-monitor-source.js)、[wesing-online-lyrics.js](../../../../src/music/wesing-online-lyrics.js)、[lyrics.js](../../../../src/music/lyrics.js)(findCurrentLyricLine)、[lyric-state.js](../../../../src/music/lyric-state.js)、[lyric-timeline.js](../../../../src/music/lyric-timeline.js)、[server.js](../../../../src/server.js)(装配)、[inspect-wesing-playback.js](../../../../scripts/inspect-wesing-playback.js)(诊断)
> 依赖:`qrc-decoder`(QRC 解密);运行时内嵌 PowerShell + C# 监视源码

本文档是 WeSing(全民 K 歌)**离线歌词采集**的唯一事实源:监视源、日志/QRC 扫描、播放时钟、v3.3.14 的 loading 过渡跟踪、在线兜底打分与 WS 集成只在此成表。消息契约见 [ws.md](../ws.md),设置持久化见 [storage.md](../storage.md) §7,诊断工具见 [engineering/test.md](../../engineering/test.md)。

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
│ 最新文件尾部 100KB     │   │ ≤4MB; [offset: 前缀剥除        │   │ qq+netease 双查,        │
│ (UTF-16LE,"StartKSong")│   │ → decryptQrc(hex)            │   │ 标题分 ≥60, gap≤5 择优,  │
│ 找当前 mid + 歌名      │   │ → XML → LyricContent → 行模型 │   │ 时长消歧,逐字/翻译质量分  │
└──────────────────────┘   └──────────────────────────────┘   └────────────────────────┘
   ▲ fs.watch 递归(2s 防抖,.qrc 过滤)    │ refreshVersion 竞态守卫
   └─────────────────────────────────────┴────────────► 行模型 lyrics[]
                                                        │ updateLyricState: currentMs + lyricOffsetMs(±1500)
                                                        │ findCurrentLyricLine 二分 → lyricState
                                                        ▼
                                   WS: wesing-state / lyric-state / lyric-timeline(见 ws.md §3)
```

## 3. 常量

| 常量 | 值 | 出处 |
|---|---|---|
| `LOG_TAIL_BYTES` | 100 KB(日志尾部扫描窗口) | [wesing-capture.js:12](../../../../src/music/wesing-capture.js#L12) |
| `MAX_QRC_BYTES` | 4 MB(单个 QRC 文件上限) | [wesing-capture.js:13](../../../../src/music/wesing-capture.js#L13) |
| `MAX_FALLBACK_FILES` | 80(目录扫描兜底文件数上限) | [wesing-capture.js:14](../../../../src/music/wesing-capture.js#L14) |
| `PAUSED_AFTER_MS` | 1500(进度停滞 1.5s 判暂停) | [wesing-capture.js:15](../../../../src/music/wesing-capture.js#L15) |
| `PROGRESS_COMPENSATION_MS` | 130(进度采样补偿) | [wesing-capture.js:16](../../../../src/music/wesing-capture.js#L16) |
| `QRC_REFRESH_DEBOUNCE_MS` | 2000(fs.watch 防抖) | [wesing-capture.js:17](../../../../src/music/wesing-capture.js#L17) |
| `MIN/MAX_LYRIC_OFFSET_MS` | ±1500(歌词时间偏移夹取) | [wesing-capture.js:18-19](../../../../src/music/wesing-capture.js#L18-L19) |
| `SAFE_SONG_MID` | `/^[a-zA-Z0-9_-]{1,128}$/`(mid 白名单,防路径穿越) | [wesing-capture.js:20](../../../../src/music/wesing-capture.js#L20) |
| PowerShell 轮询间隔 | 默认 100ms,clamp 100–5000 | [wesing-capture.js:780-783](../../../../src/music/wesing-capture.js#L780-L783) |

## 4. 监视源(两层)

### 4.1 PowerShell 外壳(createPowerShellWeSingMonitor,[wesing-capture.js:724-776](../../../../src/music/wesing-capture.js#L724-L776))

- 启动参数:`powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command <command>`,`windowsHide: true`
- **脚本注入方式(v3.3.13 起)**:脚本 UTF-8 编码 → Base64 → `[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('<b64>')) | Invoke-Expression`([wesing-capture.js:735-739](../../../../src/music/wesing-capture.js#L735-L739));替换了旧版 UTF-16 `-EncodedCommand`(解决中文编码问题)
- stdout 按行解析:每行非空即 `JSON.parse` 成样本喂 `onSample`,半行残留攒到下一块;stderr 保留最近 2000 字符;非主动停止的退出(exit 非 0)上报 `{error}`
- `buildPowerShellMonitorScript(options)`([wesing-capture.js:778-876](../../../../src/music/wesing-capture.js#L778-L876)):内嵌 C# 源码 `Add-Type -TypeDefinition … -ReferencedAssemblies Accessibility` 编译;每轮:找进程 → 音频快照 → 找播放窗口 → MSAA 进度 → UIA 兜底 → `ConvertTo-Json -Compress` 输出 + `Start-Sleep`

### 4.2 C# 原生监视源(WESING_NATIVE_MONITOR_SOURCE,[wesing-native-monitor-source.js:3-351](../../../../src/music/wesing-native-monitor-source.js#L3-L351))

编译进 PowerShell 进程的 `WeSingNativeMonitor` 静态类,三个入口:

| 方法 | 行为 |
|---|---|
| `FindPlaybackWindow(processIds)` | `EnumWindows` 遍历**全部顶层窗口(含隐藏窗口)**,`GetWindowThreadProcessId` 匹配进程 → 标题以 `"全民K歌 - "`(`全民K歌 - `)开头且长度 > 7 → 返回 `{Handle, Title}`(取第一个即停)([wesing-native-monitor-source.js:70-89](../../../../src/music/wesing-native-monitor-source.js#L70-L89)) |
| `GetAccessiblePlaybackSnapshot(handle)` | MSAA:`AccessibleObjectFromWindow(OBJID_CLIENT = 0xFFFFFFFC)` 拿 `IAccessible` 根,深度优先遍历(`MaximumAccessibleDepth = 20`、`MaximumAccessibleNodes = 3000` 双上限);每个节点 `get_accName` 匹配 `^\s*(\d{1,3}):(\d{2})\s*\|\s*(\d{1,3}):(\d{2})\s*$`(**MM:SS \| MM:SS 双进度**),校验 `total > 0 && 0 ≤ current ≤ total` 后返回 `{CurrentSec, TotalSec}`;任何节点名含 `"歌曲加载中"` 置 `Loading = true`([wesing-native-monitor-source.js:91-186](../../../../src/music/wesing-native-monitor-source.js#L91-L186)) |
| `GetAudioSessionSnapshot(processIds)` | WASAPI:默认音频端点(渲染流)→ `IAudioSessionManager2.GetSessionEnumerator` 遍历会话,`IAudioSessionControl2.GetProcessId` 匹配进程 → `GetState`(Active=1 即 `audioActive`)+ `IAudioMeterInformation.GetPeakValue`(跨会话取峰);无匹配会话 `State = -1`([wesing-native-monitor-source.js:193-253](../../../../src/music/wesing-native-monitor-source.js#L193-L253)) |

PowerShell 侧兜底:**MSAA 未给出进度时**,UIAutomation 从窗口句柄 `AutomationElement.FromHandle` 找全部 Text 控件,`Name` 匹配同一正则即 `progressSource: 'uia'`,含"歌曲加载中"同样置 loading([wesing-capture.js:822-838](../../../../src/music/wesing-capture.js#L822-L838));`includeDiagnostics` 开启时额外收集控件清单(≤250 行,仅 Button/Text/Slider)。

## 5. 缓存/日志扫描与 QRC 歌词

### 5.1 日志扫描(findLatestSongEntry,[wesing-capture.js:48-99](../../../../src/music/wesing-capture.js#L48-L99))

1. `Log/WeSing/` 下全部 `*.log` 按 mtime 降序取**最新文件**
2. 尾部 `LOG_TAIL_BYTES = 100KB`,起始偏移按 `& ~1` **偶数对齐**(UTF-16LE 防半个字符)
3. 整块 `utf16le` 解码,按行**倒序**找含 `"StartKSong"` 的行,正则提取 `"mid"` 与 `"songname"`(`decodeJsonString` 解转义)
4. `SAFE_SONG_MID` 校验失败整体返回 null;传入期望标题时按 `normalizeTitle`(去"全民K歌 - "前缀 + 去空白 + 小写)过滤

### 5.2 QRC 歌词加载(loadWeSingLyrics,[wesing-capture.js:101-126](../../../../src/music/wesing-capture.js#L101-L126))

1. 日志命中 → 直读 `WeSingDL/Res/<mid>/<mid>.qrc`(tryReadQrc 成功即返回)
2. 兜底:目录扫描 `listRecentQrcFiles`([wesing-capture.js:128-152](../../../../src/music/wesing-capture.js#L128-L152))——`SAFE_SONG_MID` 子目录批量(每批 100)stat 各自的 `.qrc`(`0 < size ≤ 4MB`),按 mtime 降序取最多 80 个,逐个解析直至标题匹配(`normalizeTitle` 相等)

### 5.3 QRC 解密与解析(tryReadQrc / parseQrcDocument,[wesing-capture.js:154-209](../../../../src/music/wesing-capture.js#L154-L209))

```
1. 读文件(≤4MB)→ 前 8 字节 ASCII 为 "[offset:" 时剥掉首个换行前的内容
2. 剩余 payload 长度 % 8 !== 0 → 判非法
3. decryptQrc(payload.toString('hex')) → QRC XML 文本 (qrc-decoder)
4. parseQrcDocument:
   - extractQrcLyricContent: 取 <Lyric_1 LyricContent="..."/> 属性值,无包裹则用全文;decodeXmlEntities 解实体
   - 行模型: parseLyricResult('', '', content, '')  —— 内容作为"逐字歌词"喂入,
     [start,duration](word) 结构直接产出 words[];无词行被丢弃
   - 元数据: [ti:标题] / [ar:歌手] 取前 120 字符
   - durationMs: XML 的 SaveTime="秒" 存在则 ×1000,否则取最后一行 endMs
```

`toLyricResult` 汇出 `{songMid, title, artists, durationMs, lines}`;`loadWeSingLyrics` 命中后调用方补 `source: 'wesing'`。

### 5.4 缓存目录监视(syncQrcWatcher,[wesing-capture.js:652-690](../../../../src/music/wesing-capture.js#L652-L690))

- active + 目录存在时 `fs.watch(cachePath, {recursive: true})`;`unref()` 防阻塞退出
- `handleQrcWatchEvent` 只认 `*.qrc` 事件;`QRC_REFRESH_DEBOUNCE_MS = 2s` 防抖后 `refreshLyrics(state.trackTitle)`;切目录先停旧 watcher
- 幂等:同一 `cachePath` 不重复 watch;失败静默(`cacheWatcher = null`)不阻断采集

## 6. 播放时钟

### 6.1 单调外推(performance.now(),[wesing-capture.js:519-554](../../../../src/music/wesing-capture.js#L519-L554))

- `now` 可注入,默认 `performance.now()`(monotonic,不受系统时间跳变影响)
- 时钟 = `baseMs + (running ? now - startedAt : 0)`,`readPlaybackClock` 再夹到 `[0, durationMs]`(`state.durationMs || lyricDurationMs`)
- `setPlaybackClock(ms, ts)` 设基准并停走;`startPlaybackClock` 起走(幂等);`pausePlaybackClock` 冻结当前值;`resetPlaybackClock` 归零并清 `lastProgressMs`/`hasStartedCurrentTrack`

### 6.2 采样对齐(handleMonitorSample,[wesing-capture.js:348-517](../../../../src/music/wesing-capture.js#L348-L517))

每个样本按分支顺序处理:

1. `error` → 停时钟、`status:'error'`、错误文案截 160
2. 平台未检测(`detected !== true`)→ 停时钟、`waiting`
3. **平台刚恢复**(`platformResumed`)= 上次未检测且标题没变 → `currentMs=0`、重置时钟(不重新拉歌词)
4. **标题变化** → 清 `loadingTrackTitle`、`resetLyrics`、`status:'loading'`、`pendingRefresh = refreshLyrics(title)`
5. 标题为空 → 停时钟、`waiting`
6. `loading === true` → 记 `loadingTrackTitle = title`、重置时钟、`status` 保持 loading 文案(v3.3.14 见 §6.4)
7. 音频不活跃(`audioActive === false`)→ 停时钟;若有采样进度则 `setPlaybackClock(currentMs + 130ms)`
8. 有采样进度:
   - **重播检测**(`replayedFromStart`):`lastProgressMs > 3000 && currentMs ≤ 2000 && currentMs < lastProgressMs - 2000` → 回滚到 `currentMs + 130`,文案"检测到《…》重新开始,歌词已回到开头"
   - 进度变化 → `setPlaybackClock(currentMs + 130)` 并 `startPlaybackClock`(playing)
   - 首个进度 → 同上;`currentMs > 0` 才起走,否则保持 `waitingForPlayback`
   - 停滞超过 `PAUSED_AFTER_MS = 1500` 无进度变化 → 停时钟(playing: false)
9. 无进度但音频活跃 → 直接起走时钟;否则停走

**+130ms 补偿**(`PROGRESS_COMPENSATION_MS`):采样到的进度是界面显示值,比真实播放滞后,故每次对齐把基准前移 130ms。

### 6.3 暂停确认

暂停判定 = 进度停滞 1.5s(§6.2 步骤 8 末支);恢复判定 = 下一次进度变化。`waitingForPlayback = !hasStartedCurrentTrack` 表达"本曲还没正式播过"。

### 6.4 v3.3.14:loading 过渡跟踪(loadingTrackTitle)

| 事件 | 行为 | 出处 |
|---|---|---|
| 采样 `loading === true` | `loadingTrackTitle = title`,重置时钟(进度此时不可信) | [wesing-capture.js:427-436](../../../../src/music/wesing-capture.js#L427-L436) |
| **loading 标记消失且标题未变**(`loadingTrackTitle === title`) | 清标记,`pendingRefresh = refresh()` —— **恰好触发一次歌词刷新**(`refresh` 内部按 `state.trackTitle` 走 `refreshLyrics`) | [wesing-capture.js:438-441](../../../../src/music/wesing-capture.js#L438-L441) |
| 标题变化 / 平台丢失 / 标题清空 / 停用 / stop | 清 `loadingTrackTitle`(未触发的刷新作废) | [wesing-capture.js:391-400](../../../../src/music/wesing-capture.js#L391-L400)、[wesing-capture.js:379-388](../../../../src/music/wesing-capture.js#L379-L388)、[wesing-capture.js:413-415](../../../../src/music/wesing-capture.js#L413-L415)、[wesing-capture.js:296,713](../../../../src/music/wesing-capture.js#L296-L713) |

动机:加载期间日志里可能已有新歌的 StartKSong、磁盘也刚开始写 QRC——标记消失是"播放真正开始"的最佳时机,一次刷新即可拿到新歌词,避免空轮询。

## 7. 歌词偏移与状态合成

### 7.1 偏移(lyricOffsetMs)

- 校验 `normalizeWeSingLyricOffsetMs`(±1500,取整,[wesing-capture.js:38-46](../../../../src/music/wesing-capture.js#L38-L46));`setLyricOffsetMs` 先持久化再生效([wesing-capture.js:274-284](../../../../src/music/wesing-capture.js#L274-L284))
- 生效点 `updateLyricState`([wesing-capture.js:610-628](../../../../src/music/wesing-capture.js#L610-L628)):`lyricCurrentMs = clamp(0, currentMs + offset)` 再夹到时长;`findCurrentLyricLine` 二分取当前行,产出 `lyricState`(经 `normalizeLyricState`,字段契约见 [services.md](services.md) §13)
- 设置键 `weSingCachePath` / `weSingLyricOffsetMs`,持久化见 [storage.md](../storage.md) §7
- 未手动配置时,缓存目录默认按当前 Windows 用户的 `%APPDATA%\\Tencent\\WeSing\\WeSingCache` 生成;保存目录或首次启用检测时会递归创建缺失的 `WeSingCache` 目录

### 7.2 刷新竞态

`refreshLyrics(title)`([wesing-capture.js:556-608](../../../../src/music/wesing-capture.js#L556-L608)):`version = ++refreshVersion`;本地加载 + 在线兜底(§8)都完成后校验 `version !== refreshVersion || title !== state.trackTitle` 则丢弃结果(切歌/重复刷新的旧结果不得落地)。无结果 → `qrcReady:false, status:'empty'`;有行 → `qrcReady:true, status:'ready'`,`durationMs` 缺失时用歌词时长补。`resetLyrics` 同样 `refreshVersion++` 使在途刷新失效。

## 8. 在线兜底(wesing-online-lyrics.js)

`createWeSingOnlineLyricResolver({ getRegistry, lyricsService, platforms, preferredPlatform })`([wesing-online-lyrics.js:15-56](../../../../src/music/wesing-online-lyrics.js#L15-L56))返回 `resolveWeSingOnlineLyrics({title, artist?, artists?, durationMs})`,由 [server.js:167-170](../../../../src/server.js#L167-L170) 注入 weSingCapture 的 `resolveFallbackLyrics`。采集器会从匹配标题的最新 `StartKSong` 日志记录提取 `artist`/`singer` 等歌手字段；歌手存在时在线搜索关键词为“歌名 歌手”，并将歌手一致性纳入候选打分。

| 常量 | 值 | 出处 |
|---|---|---|
| `MIN_TITLE_MATCH_SCORE` | 60(低于即放弃该平台) | [wesing-online-lyrics.js:6](../../../../src/music/wesing-online-lyrics.js#L6) |
| `CLOSE_MATCH_SCORE_GAP` | 5(分数差距阈值,见下) | [wesing-online-lyrics.js:7](../../../../src/music/wesing-online-lyrics.js#L7) |
| `DEFAULT_PLATFORMS` | `['qq','netease']` | [wesing-online-lyrics.js:5](../../../../src/music/wesing-online-lyrics.js#L5) |

流程:

1. `Promise.allSettled` 双平台并发;每平台:搜索(`searchMusicTracks`,limit 20)→ `rankWeSingLyricTracks` 按打分 + 时长距离排序([wesing-online-lyrics.js:97-115](../../../../src/music/wesing-online-lyrics.js#L97-L115))→ 取第一名,`score < 60` 或歌词无行则弃
2. `selectBestLyricCandidate`([wesing-online-lyrics.js:117-126](../../../../src/music/wesing-online-lyrics.js#L117-L126))排序:
   - 两候选分差 **> 5** → 高分者胜
   - 分差 ≤ 5 → 依次比:`qualityScore`(1 + 有逐字词 + 有翻译,[wesing-online-lyrics.js:132-136](../../../../src/music/wesing-online-lyrics.js#L132-L136))→ 歌词行数 → 时长距离 → 首选平台
3. 产出 `result`:`source`/`songMid`(取 track id)/`title`/`artists`/`durationMs = max(窗口时长, track 时长, 最后一行 endMs)`/`lines`
4. 全部失败:有拒绝项则抛**第一个被拒绝项**的错误(`settled.find(status === 'rejected')`,供 weSingCapture 显示"在线歌词匹配失败"),否则 null

打分复用的 `scoreTrackMatch`(歌名 +60 等)见 [services.md](services.md) §9;**时长距离只做同分消歧,不参与及格线**——无 artist 信息时用窗口时长区分同名翻唱。

## 9. createWeSingCapture 契约

### 9.1 选项([wesing-capture.js:211-226](../../../../src/music/wesing-capture.js#L211-L226))

| 选项 | 默认 | 说明 |
|---|---|---|
| `now` | `() => performance.now()` | 时钟源(测试可注入) |
| `platform` | `process.platform` | 平台;非 win32 直接 `supported:false` |
| `onState` / `onTimeline` | 空函数 | WS 广播回调(§10) |
| `monitorFactory` | `createPowerShellWeSingMonitor` | 监视器工厂(测试可注入) |
| `watchFactory` | `fs.watch` 包装 | 目录监视工厂 |
| `setTimer` / `clearTimer` | `setTimeout`/`clearTimeout` | 防抖定时器 |
| `resolveFallbackLyrics` | null | 在线兜底(§8);null 则无兜底 |
| `saveCachePath` / `saveLyricOffsetMs` | 无 | 设置持久化回调(写 `weSingCachePath`/`weSingLyricOffsetMs`) |
| `cachePath` / `lyricOffsetMs` | 无 | 初始值(非法值安全降级:空串 / 0) |

### 9.2 状态对象([wesing-capture.js:244-262](../../../../src/music/wesing-capture.js#L244-L262))

`getStatus()` 深拷贝快照:字段见 §2 图中 `wesing-state` 载荷,含 `status` 枚举与文案:

| status | 触发 |
|---|---|
| `inactive` | 初始 / 停用(文案"全民 K 歌捕捉未启用。") |
| `unsupported` | 非 Windows 启用 |
| `waiting` | 启用等待检测 / 平台丢失 / 标题清空 |
| `loading` | 标题变化、加载标记、刷新中("正在匹配《…》的歌词…") |
| `ready` | QRC 就绪(本地或在线) |
| `empty` | 本地 + 在线均无可用歌词 |
| `error` | 监视进程异常 / 启动监视失败 |

另有 `cacheReady`(WeSingDL/Res 存在)、`platformDetected`、`qrcReady`、`songMid`、`lyricSource`(`wesing`/`qq`/`netease`)、`currentMs`/`durationMs`/`playing`/`waitingForPlayback`/`lyricOffsetMs`、内嵌 `lyricState`(normalizeLyricState 产物)。

### 9.3 返回 API([wesing-capture.js:721](../../../../src/music/wesing-capture.js#L721))

| 方法 | 行为 |
|---|---|
| `getStatus()` | 状态深拷贝 |
| `setCachePath(input)` | 校验 + 停 watcher + 持久化 + `resetLyrics` + `refresh`;返回新状态 |
| `setLyricOffsetMs(input)` | ±1500 校验 + 持久化 + 立即重算 lyricState 并 emit |
| `setActive(active)` | 启停总开关:停 = 停监视/watcher/时钟;启 = supported 检查 → `monitor.start()` → `refresh` |
| `refresh()` | 重查 `cacheReady` + 同步 watcher;有标题则 `refreshLyrics`(有 `waitForRefresh` 可等待在途刷新) |
| `stop()` | 关闭一切(服务关闭时序调用点 [server.js:772](../../../../src/server.js#L772),见 [server-core.md](../server-core.md) §6.2) |

## 10. WS 集成与本地端点

装配([server.js:171-192](../../../../src/server.js#L171-L192)):

| 回调 | 广播 |
|---|---|
| `onState(state)` | `{type:'wesing-state', state}`;且 active 且有 `lyricState` 时同步为全局 `lyricState` 并广播 `{type:'lyric-state', state}`([server.js:183-188](../../../../src/server.js#L183-L188)) |
| `onTimeline(timeline)` | `timeline.active` 时经 `publishLyricTimeline` 归一化后广播 `{type:'lyric-timeline', timeline}`([server.js:189-191](../../../../src/server.js#L189-L191)) |

消息契约归属 [ws.md](../ws.md) §3;快照 15 字段中的 `weSing` 取 `weSingCapture.getStatus()`([server.js:519](../../../../src/server.js#L519))。

本地端点前缀为 `/api/music/wesing/*`(端点清单与请求体见 [api.md](../api.md) 的 wesing-routes 节,此处不枚举):全部路由转发到 `context.weSing` 门面([server.js:354-360](../../../../src/server.js#L354-L360)),统一 `{ok, data}` 包装、业务失败回 400;`configure`/`offset` 在门面内完成设置持久化(§9.1 的 save 回调),`active`/`refresh` 直接透传采集器。

## 11. 诊断工具

[scripts/inspect-wesing-playback.js](../../../../scripts/inspect-wesing-playback.js)(配套 `inspect-wesing-playback.cmd`)输出 `logs/wesing-playback-diagnostic-<时间戳>.jsonl`:

- CLI:`--cache <WeSingCache>`(缺省读运行中服务的 `/api/music/wesing/status` 拿当前配置,[inspect-wesing-playback.js:96-126](../../../../scripts/inspect-wesing-playback.js#L96-L126))、`--output <文件>`、`--duration <秒>`(≤3600)、`-h`
- 记录类型:实时日志探针(`wesing-log-file` / `wesing-log-line` / `wesing-log-error`,UTF-16LE 增量轮询,行截 8000 字符)、监视样本、按键标记(1-6:点击 K 歌/暂停/继续/退出/重进/此刻歌词状态不正确,[inspect-wesing-playback.js:11-18](../../../../scripts/inspect-wesing-playback.js#L11-L18))
- 用途:排查采集链路各环节(窗口检测、MSAA 进度、QRC 加载、歌词对位),详见 [engineering/test.md](../../engineering/test.md)
