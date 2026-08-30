# Feature: 全民 K 歌在线歌词源选择

## Requirements (EARS Format)

- 当全民 K 歌能读取并匹配本地 QRC 时，系统应继续优先使用本地歌词，不调用在线歌词源。
- 当本地 QRC 不可用且智能匹配已开启时，系统应并行查询 QQ 音乐和网易云音乐，并允许任一平台独立成功。
- 当两个在线结果都可用时，系统应先比较歌曲匹配度，再比较逐字歌词、翻译和完整行数；结果接近时应使用用户选择的歌词源。
- 当智能匹配已关闭时，系统应只查询用户选择的歌词源。
- 当用户从未修改设置时，系统应默认选择网易云音乐并开启智能匹配。
- 当用户在桌面歌词设置列修改歌词源或智能匹配时，系统应自动保存，并在下一次全民 K 歌在线歌词解析时读取最新值。
- 当 QQ 音乐或网易云音乐播放器播放歌曲时，系统应继续直接获取该播放器当前曲目所属平台的歌词，不受全民 K 歌设置影响。

## Architecture

### Frontend

- 在 `public/pages/admin/song/desktop-lyric.html` 的设置列顶部新增“全民 K 歌在线歌词”区域。
- 歌词源使用两个原生 radio 控件组成分段选择，默认网易云音乐；智能匹配使用现有开关样式。
- `public/js/admin/desktop-lyric.js` 负责序列化 `weSingLyricSource` 和 `weSingSmartLyricMatch`，并从 `app:settings-state` 恢复 radio/checkbox 状态。
- 设置沿用桌面歌词表单现有自动保存队列，不增加独立提交按钮，也不强制重新加载当前歌曲。

### Backend

- `src/storage/settings-store.js` 新增默认值：`weSingLyricSource: 'netease'`、`weSingSmartLyricMatch: 'true'`。现有 `INSERT OR IGNORE` 会为旧数据库补齐键。
- `src/server/music-runtime.js` 向全民在线歌词 resolver 注入 `getPreferences()`；每次解析都从 `settingsStore.getSettings()` 读取最新设置。
- `src/music/wesing-online-lyrics.js` 保留现有搜索、匹配和质量择优算法：
  - 智能匹配开启：`Promise.allSettled` 并行解析 QQ 与网易云。
  - 智能匹配关闭：只解析首选平台。
  - 设置值在 resolver 内归一化为固定平台枚举和布尔值，未知平台回退网易云。
- 普通 `/api/music/lyrics` 路由、播放器端 `LyricService` 和 Provider 原生歌词获取不修改。

### Security

- 设置写入继续受现有 session token 和默认设置白名单保护。
- resolver 只接受 `qq` 或 `netease`，不会把设置值解释为 URL、文件路径或命令。
- UI 文案和平台名称均为静态内容；不新增 `innerHTML` 写入用户数据。
- 不新增外部依赖、凭据、日志原文或歌词缓存内容暴露。

## Failure Handling

- 智能匹配开启时，一个平台失败不会压制另一个平台；两个平台均失败时保留现有错误传播行为。
- 智能匹配关闭时，所选平台失败即返回该失败，不暗中改用另一个平台。
- 搜索结果未达到现有最低匹配阈值时返回空结果，避免展示明显错误的歌词。
- 设置切换只影响下一次在线解析；已经载入的当前歌词不被中途替换。

## Acceptance Criteria

- 默认设置为网易云音乐 + 智能匹配开启。
- 关闭智能匹配并选择网易云时，全民在线回退只请求网易云；切换为 QQ 后下一次只请求 QQ。
- 开启智能匹配时两家并行请求，单源失败可由另一源成功返回；质量相同的接近结果优先网易云默认源。
- 桌面歌词设置列能自动保存并正确恢复两个控件，键盘焦点清晰可见。
- 普通 QQ/网易云播放器的歌词请求仍只携带当前 track，并继续走 track 自身 `source`。
- `npm run check` 和 `npm test` 通过。
