# Now Playing 全民 K歌歌词链路逆向说明

## 分析范围

本说明只覆盖 `now-playing-service` 的全民 K歌歌曲识别与歌词获取链路。证据来自：

- `WeSingService.cs`：窗口标题与 UI Automation 播放进度。
- `wesing/WeSingService.java`：本地日志、QRC 定位与索引。
- `LyricService.java`：本地歌词优先和在线回退策略。
- `QQMusicService.java`、`SongMatchingUtil.java`：在线候选匹配与安全阈值。
- 本机运行实例 `127.0.0.1:9863` 的只读 API：当前《失控》歌词来源为 QQ。

## 观察到的数据流

1. `WeSing.exe` 的播放子窗口标题提供歌曲名，格式为 `全民K歌 - {歌名}`。
2. UI Automation 在该窗口后代文本节点中查找 `MM:SS | MM:SS`，提供当前进度和总时长。
3. 本地歌词优先读取用户选择的 `WeSingCache\WeSingDL\Res`：
   - 优先从 UTF-16LE 日志的最新 `StartKSong` 记录获取 `mid`；
   - 其次扫描、解密 QRC，并按规范化歌名和版本修饰词匹配。
4. 本地 QRC 不可用时，歌词服务退化到在线匹配：
   - 开启“智能匹配最佳歌词”时并行请求 QQ 和网易云；
   - 每个平台对搜索候选计算歌名、歌手与版本相似度；
   - 候选通过阈值后，比较普通歌词、翻译和逐字歌词完整度；
   - 内容完整度相同时使用用户配置的默认歌词源。

## 观察到的需求（EARS）

- 当全民 K歌播放子窗口出现时，系统应从窗口标题提取当前歌名。
- 当 UI Automation 提供进度文本时，系统应解析当前秒数和歌曲总秒数。
- 当匹配的本地 QRC 存在时，系统应优先使用本地逐字歌词。
- 当本地 QRC 不存在或无法匹配时，系统应尝试在线歌词，不应因缓存目录为空而停止歌曲识别。
- 当一个在线平台失败时，系统应允许另一个平台独立返回歌词。
- 当候选歌名不可靠时，系统应返回空歌词，不应展示明显不匹配的歌词。

## 本项目实现差异

本项目通过 `src/music/wesing-online-lyrics.js` 隔离在线回退，采集状态机只依赖
`resolveFallbackLyrics()` 接口。在线策略保持 QQ/网易云并行与完整度择优，同时额外使用
UI Automation 得到的歌曲总时长，对同名翻唱、现场版和原版进行消歧。

## 已知不确定性

全民 K歌窗口标题通常不包含歌手。若多个版本歌名和时长都相同，任何纯在线匹配都可能
无法完全消歧；此时本地 `StartKSong` 的 `mid` + QRC 仍是最可靠来源。

用户当前选择的 `C:\Users\Tom\AppData\Roaming\Tencent\WeSing\WeSingCache` 在分析时为空，
但参考软件仍能返回《失控》的 QQ 逐字歌词。这证明该次成功来自在线回退，而不是本地 QRC。
