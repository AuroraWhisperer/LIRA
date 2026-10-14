# 歌词播放时钟稳定性修复

Status: Completed

开始及完成日期：2026-10-14。

## 目标与当前证据

正常播放期间，内置及外置播放器的普通采样误差不能使歌词反复回退；主动跳转、切歌、来源切换、暂停与继续仍准确同步。原共享渲染器每次 `setState` 都强制重锚，绕过已有 350 ms 容差；内置上报另以 100 ms 取整。连续向前的模拟音频已复现 50 ms 回退和跨行倒退；网易云 UIA 连续整秒采样复现 100 ms 回退。既有测试将普通小幅回退当作预期。

## 所有权、范围与兼容

- `public/js/shared/lyric-clock.js`：已有连续时钟与漂移容差；补齐播放状态转换的准确重锚。
- `public/js/shared/lyric-word-renderer.js`：区分普通采样与已有 generation、曲目身份、显式 discontinuity；普通更新使用既有容差。
- `public/js/playback/services/lyric-service.js`：保留毫秒采样精度，继续使用原节流、发送队列和版本协议。
- 直接消费者为桌面预览、`/lyrics` 浏览器源、WeSing 播放页；检查逐字动画在换行及主动小幅 seek 时的重锚。
- 回归归属 `test/lyrics/desktop-lyric-publication.test.js`，并运行既有来源切换、外置采集和 WeSing 消费者测试。
- 技术契约归属 `docs/reference/frontend/playback.md` 和 `docs/reference/frontend/overlays.md`。没有新功能、设置或操作入口，用户指南无需变更。
- 保留 HTTP/WS/IPC 字段、来源仲裁、数据存储和 Electron 安全边界；不改外观、不接入 Now Playing、不提交或发布。
- 当前工作区的已有改动保留；任务前相关文件快照仅置于忽略的 `tmp/lyric-clock-stability-20261014/before/`。

## 实施与验证

- [x] 扩展已有测试，先复现正常播放回退和毫秒精度丢失；保留小幅主动 seek、暂停/继续、来源切换及大幅外置跳转的覆盖。
- [x] 最小修改共享时钟与内置上报，使用已存在的版本标记，不以禁止全部回退代替正确同步。
- [x] 执行直接受影响的歌词、播放与外置采集测试；只因明确失败或新增风险扩大范围。
- [x] 使用隔离 Electron 渲染器和合成歌词/播放输入验证持续播放、换行、逐字高亮、暂停/继续和向后跳转；不启动或控制用户的播放器，不使用真实数据。
- [x] 同步技术参考，运行 `npm run verify:docs`、受影响 JS 语法检查、`git diff --check`，按任务前快照审查增量并检查最终状态。

单元验证入口：`node --experimental-vm-modules --test test/lyrics/desktop-lyric-publication.test.js`。消费者回归包含 `desktop-lyric-renderer`、`desktop-lyric-surface`、`lyric-word-motion`、`lyric-generation-recovery`、`lyric-source-handoff`、`external-music-following`、QQ / 网易云 capture 与 `test/wesing/`。

桌面 QA 的可观察指标：同一 generation 下连续播放的显示位置与当前行不倒退；显式小幅向后 seek 能回退；暂停后位置不再变化、继续从正确位置开始；外置整数秒的重复读数不造成重复回拉。检查换行附近与延迟采样两类异常路径。截图与探针输出放入本任务 tmp 目录。

## 失败处理与完成条件

测试失败先定位所属行为，不扩大范围修复无关失败。只撤回任务引入的精确差异，保留其他用户修改，不使用 reset 或整文件回滚。代码、直接回归和隔离桌面验证均完成、技术参考一致且差异审查通过后才完成；真实 QQ/网易云版本联动不等同于合成采样验收。

## 执行发现

- 第一轮共享修复后，79 项直接回归通过。延长网易云 UIA 回放到 22 秒、以 550 ms 轮询真实连续时钟的整秒读数，仍复现两次 400 ms 回退，因此仅恢复共享容差不足以解决此来源。
- 在 `src/music/netease-client-capture.js` 的 UIA 路径保留仍落在读数所代表一秒区间内的连续估计；向后读数、暂停/恢复、切曲/切换时钟仍采用新锚点。`test/lyrics/netease-client-capture.test.js` 加入先失败的长回放回归，技术同步归属补入 `docs/reference/backend/music/services.md`，不扩大全局容差或更改 SMTC 算法。
- `desktop-lyric-renderer` 的两个动画边界另有先失败的回归：新一行采样提前到达时不能取消显示中当前行的动画；小于动画漂移阈值的主动 seek 必须重锚同一逐字动画。修复只保留当前行生命周期，并将已有 discontinuity 传给动画。

## 完成证据与限制

- 最终 `node --experimental-vm-modules --test` 聚焦运行 12 个文件、103 项全部通过；范围为上述直接消费者、QQ/网易云 capture、`wesing-capture` 与 `wesing-capture-timing`。8 个受影响 JS 文件通过 `node --check`。
- `npm run verify:docs` 10 项通过。首次检查发现新计划的中文状态标签不符合门禁，已改成标准 `Status:` 标签；`git diff --check` 在仓库原有换行配置下通过。曾用临时关闭 CRLF 归一化的检查命令产生换行误报，未据此改动任何无关文件。
- 隔离 Electron 使用实际歌词模块及静音合成 WAV，通过按钮验证连续播放、换行、100 ms 后退、2 秒后退、暂停/继续及连续填充/逐字点亮。最终连续片段记录进度回退 0 次、行号回退 0 次；暂停前后显示位置均为 7384.992 ms，无页面异常。单元测试另保护同字小幅 seek 的 WAAPI 时间及迟到行状态。
- 截图和运行记录保存在 `tmp/lyric-clock-stability-20261014/`，包括 `electron-results.json`、`continuous-playback.png`、`discrete-playback.png` 与 `focused-tests.log`。测试环境偶尔进入已有的低性能模式，本次不宣称稳定显示帧率。测试窗口和自建监听器已关闭，未控制用户运行中的播放器。
- 技术参考已同步；没有新操作入口或设置，用户指南和截图无需更新。原生 QQ/网易云具体版本联动未执行，采集稳定性由确定性回放验证；未打包、提交或替换安装版。
