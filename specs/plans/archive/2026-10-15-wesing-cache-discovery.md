# 全民 K 歌缓存自动识别实施计划

Status: Complete

## 目标与边界

首次启用全民 K 歌采集或点击重新检测时，保留有效的已保存路径；否则只检查常见位置，唯一有效结果自动保存，无结果或多个结果交由现有目录选择器处理。手动保存必须验证实际缓存，不能再创建空目录作为成功结果。

不改设置键、HTTP/WS/IPC 形状、Electron 权限、安装器；不全盘递归、不下载歌词、不修改全民 K 歌文件。保留此前歌词版本修复和所有其他工作区改动。用户追加同名切换反馈后，扩展到歌曲日志事件驱动的 mid 切换识别，并清除旧版本歌词与播放进度。

## 当前证据

- 已安装 LIRA 使用 C 盘空默认目录，实际日志与 QRC 在 D 盘；上轮已纠正该用户配置并验证 en 版本。
- `ensureWeSingCacheDirectory` 当前创建目录，`refresh` 仅检查 Res 目录存在，不能证明选中了真实缓存。
- 已有文件夹选择、手动输入、保存与重新检测入口；无需新增 IPC 或第二套设置。
- 现场读取发现 A-Lin 的最新 mid 为 `000RtgX03yAYu5`，运行中程序仍显示 en 的 `0033GXPP2fY8ON`。只监听新写入 QRC 会漏掉已下载版本的同名切换。已通过现有重新检测端点临时纠正当前状态，源代码需修复持续监听。

## Owner 与实现

- `src/music/wesing-cache.js`：`hasWeSingCacheData(path)` 检查非空日志或有效大小的 QRC 文件，手动配置复用该验证。
- `src/music/wesing-cache-discovery.js`：候选为用户 AppData 默认位置及 C–Z 盘根的 WeSingCache；只读取固定路径，去重，唯一有效候选返回路径，其余返回空。测试可注入候选，避免访问用户缓存。
- `src/music/wesing-capture-engine.js`：复用生命周期代际、路径保存队列；自动发现的过时结果不能覆盖手动保存或停用状态；并发检测共用一个发现请求。手动应用后的刷新不再触发自动发现，避免队列自等待。
- `src/server/music-runtime.js`：注入发现函数及既有设置持久化回调。
- `src/music/wesing-qrc-watcher.js` 与 `wesing-lyric-resolver.js`：合并歌曲日志事件，按 mid 切换；每次解析使用同一日志记录定位 QRC 和在线歌手，空 QRC 歌手由日志补齐。
- `public/js/playback/services/wesing-service.js` 与 `public/pages/admin/playback/page.html`：在现有输入区显示识别失败与手动选择说明，实时状态保留未保存输入。
- 契约和用户指导：`docs/reference/backend/music/wesing.md`、`specs/wesing-live-lyrics_design.md`、`public/pages/admin/toolbox/usage-guide-playback.html`。交互引导入口不变，现有截图的操作控件仍准确。

## 交付步骤与验证

- [x] 目录判定与有界发现：新增 `test/wesing/wesing-cache-discovery.test.js`，覆盖空目录、日志、QRC、唯一候选、歧义、去重和已保存路径优先；更新现有配置测试以验证错误路径不被创建。
- [x] 采集生命周期：更新 `wesing-lifecycle.test.js`，验证发现与手动选择竞态、停用/重启作废、重复刷新合并、保存失败恢复；保留现有时钟测试。追加同名切换晚到结果丢弃、日志事件合并及停用取消验证。
- [x] UI：复用 `test/playback/playback-wesing.test.js`，验证未识别提示、有效路径回填、输入草稿不被实时状态覆盖和手动保存。隔离 Electron 检查新提示与已有文件夹入口。
- [x] 同步文档，执行相关组合回归、语法、文档及模块边界检查，检查最终 diff/status，无运行数据进入改动。

运行命令：

```powershell
$weSingTests = @(rg --files test/wesing -g '*.test.js')
node --experimental-vm-modules --test @weSingTests test/playback/playback-wesing.test.js test/lyrics/lyric-source-handoff.test.js test/lyrics/qq-client-routes.test.js test/admin/frontend-usage-guide.test.js
npm run verify:docs
npm run verify:architecture
git diff --check
git status --short
```

## 失败与回退

找不到唯一有效目录时保留设置、继续现有在线歌词兜底并指引手动选择；不猜测、不删除和不创建用户缓存。自动发现结果先通过代际检查，再通过同一保存队列持久化。回退仅撤销本轮明确文件块，保留上轮修改和用户其他工作。

## 完成条件

合成验证与本机只读发现确认能找到真实缓存；新安装的默认空路径可被替换，手动选择可以纠错；失败可理解且不覆盖草稿。相关测试、文档及隔离界面检查通过；安装包未重新构建属于明确交付边界，不宣称已更新安装版。

## 完成记录（2026-10-15）

- 工作区基线 `5ff523b8`，未提交、打包或发布。用户原有改动保留。
- 相关组合 129 项通过；最终路径安全校验补充后复验缓存 15 项通过。8 个修改的生产 JS 文件语法通过，架构 27 项、文档 10 项通过。
- 本机只读自动发现从空 AppData 默认路径找到 `D:\WeSingCache`，不依赖安装盘规则。
- 用户补充庾澄庆缓存后，将《天若有情》en/A-Lin 和《春泥》余超颖/庾澄庆四份真实 QRC 复制到隔离临时缓存，通过合成切歌日志与真实 `fs.watch` 回放 20 次切换，逐次验证 mid、完整逐字时间轴、歌手和采样进度对应行；未自动操作全民窗口，也不是安装版实播验收。QRC 副本在回放后删除，确定性测试只使用合成数据。
- 隔离 Electron 使用真实 preload、授权管理路由与配置 API，测试未识别提示、自动回填、失焦保留草稿、无效目录错误与文件夹选择后的保存。原生目录选择结果为合成路径；原有 IPC 契约测试保留。最终提示改用现有 small 样式，重启测试实例后核验缺失/就绪两种视觉状态。
- 测试进程已关闭。删除两套 Electron 临时 profile/data 目录时，自动审批返回 `blocked by policy`，故未重试其他删除手段，目录保留在 `tmp/wesing-cache-qa/desktop-5muSYn` 与 `desktop-f9GpUK`，不进入交付 diff。
- 临时证据位于仓库 `tmp/wesing-cache-qa/`：回放结果、测试日志、最终截图。资料不进入交付 diff。
- 已同步专项参考、API 校验说明、两份规格和页面使用指导。持久化键与默认值、README 导航、交互导览入口均未变；原指南截图仍准确显示手动选择控件，无需替换。
- 当前安装版只通过既有 API 临时更正缓存路径和当前歌曲。新代码需随后续安装包更新生效，不将缓存回放或源码验证描述为安装版已修复。
