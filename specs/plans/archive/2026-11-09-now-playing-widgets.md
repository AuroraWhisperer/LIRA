# 歌曲信息双组件实施计划

**状态：Complete**

**目标：**「歌曲信息」保留一个设置页，唱片与歌名／歌手各有设置、预览、画布和浏览器源入口；画布分别移动、缩放和隐藏两者。

## 边界与当前行为

现有 `now-playing` 只提供唱片加文字的组合渲染，共用 `nowPlayingAppearance`。继续复用同一歌曲订阅、配置 owner、渲染器与画布类型，通过场景专属 `nowPlayingPart=all|record|text` 区分内容。旧配置缺省为 `all`，旧场景和 `/now-playing` 保持原组合效果；新入口创建 `record` 或 `text`。不增加服务、依赖、数据库迁移或云端契约，不修改音乐来源、授权与账号隔离。

## Owner、消费者与同步

- 字段及渲染：`public/js/shared/now-playing-appearance.js`、`now-playing-renderer.js` 和共享 CSS。
- 本机配置：`src/server/now-playing-settings.js`；场景共享外观由 `src/server/scene-shared-appearance.js` 投影，排除组件身份，几何继续属于场景。
- 设置页：`public/js/admin/now-playing.js`、对应 HTML/CSS；画布目录、参数和尺寸延用现有 preview 管线。
- 独立输出：`public/js/overlays/now-playing.js` 支持 `?part=record|text`，画布内继续由父页推送同一 `nowPlaying` 数据。
- 验证：已有 now-playing renderer、shared-appearance、scene definitions、component sources 和真实 Electron shared-canvas 测试。
- 文档：`docs/reference/frontend/overlays.md`、`app.md`、`docs/guides/component-sources.md` 及应用内歌曲信息、画布使用指南。API 字段表继续引用共享 owner。

## 里程碑与验证

- [x] 字段、独立渲染与旧组合兼容：扩展已有 renderer 和 shared-appearance 回归，验证唱片填充自身区域、文字不显示唱片或请求封面、场景身份不会被共享配置覆盖。
- [x] 设置页拆为两个组件，画布添加对应独立图层：扩展已有 Electron 用例，验证两者参数回填、不同位置尺寸、保存和实际场景输出。
- [x] 更新使用指南、实现参考与预览图；检查 Electron 页面及画布实际呈现，运行文档门禁、相关语法/架构检查。

## 完成与失败处理

完成条件为两组件可独立使用和编排，旧组合继续显示，相关回归通过，文档一致，任务 diff、`git diff --check` 与 `git status --short` 已核对。所有临时数据和截图只放 `tmp/`，真实账号数据不参与测试。工作区有大量既有修改，逐文件保留它们；失败时只撤回本任务的增量，不重置工作区，不提交或发布。

## 验证记录

- renderer、shared-appearance、scene-extra-components、scene-component-definitions、component-source 聚焦回归通过；旧组合默认值及来源保持兼容。
- `shared-canvas-appearance-electron.test.js` 的两组件用例通过：不同 X/Y/宽高、双向外观同步、保存重开及实际 `/scene` 图层输出。夹具补上生产音乐展示读取端口，使用合成歌曲，不接触真实数据。
- 画布库、共享外观并发、preview contracts 与 registry 共 18 项通过（registry 已随两按钮更新）；两组件入口由隔离 Electron 交互复核，分别添加后画布中为两个图层，页面无脚本错误。
- 独立显隐、放弃草稿、保存及两类复制地址已验证；三个唱片和文字缩略图从共享 renderer 生成，使用指南截图来自 1440 × 913 原始 Electron 窗口。
- `npm run check` 通过（1,811 个 JS 文件）；`npm run verify:architecture` 29 项通过；Impeccable 检测结果 `[]`。
- `npm run verify:docs` 最终 9/10；本次当前文档链接与活动计划检查通过，唯一失败为仓库既有 `docs/reports/2026-11-05-continuous-audit.md` 引用缺失的历史 `tmp/continuous-audit-2026-11-05/` 材料。并行计划归档期间曾见其状态检查失败，最终已由该任务自身归档消失，未修改其内容。
- 技术参考、操作指南及截图已同步；API 字段仍由共享 owner 声明，现有接口与音乐来源引导不变，无需修改服务器或引导导航。
- 任务增量已按开始时的文件副本检查；保留其他任务在相同文件内的修改，未提交、打包或发布。
