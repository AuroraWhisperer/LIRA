# 无行为变化的代码精简

## 目标与边界

删除当前产品不执行的代码、无消费者的局部依赖和主题预设无效字段。
保留页面、HTTP/WS/IPC、持久化设置、迁移、安全校验和兼容入口；不压缩 JSON
排版，不删除维护工具、历史依据或测试，不修改工作区已有及期间新增的 CSS、
前端布局测试改动。

## 当前证据与归属

- 已扫描 580 个 JavaScript 文件的词法作用域，并检查运行源码、页面、CSS 的
  静态加载链；没有确认可整份删除的运行模块。
- `src/music/provider-registry.js` 的占位类未实例化，实际使用 QQ/网易云 Provider。
- `src/music/providers/qq-provider-utils.js` 的旧最近播放解析器和两个递归辅助
  仅在废弃链内互相引用；QQ 文档也记录其没有调用点。
- `public/js/playback/` 的组合根和子模块存在未消费的注入/导入/局部变量。
- `public/data/theme-presets.json` 有重复保留的旧排版字段；消费者为
  `shared/theme.js`、Admin theme/display/forms 和 OBS queue/songlist。
  对照实际表单 ID、收集设置与渲染逻辑后删除；所有有效值、名称和色板保留。
- 少量 Admin、礼物对账、Electron 导入及共享纯工具同样没有消费者。
- 清理前 `node scripts/run-tests.js offline --test-reporter=spec`：2705 通过，0 失败。

## 交付步骤

1. 删除已核实的音乐死代码和孤立纯工具；保持实际 Provider 接口不变。
2. 删除没有读者的局部导入、缓存变量及播放模块注入；保留副作用与加载链。
3. 从默认主题及 28 套预设移除无效字段，更新所属架构文档。
4. 比较清理前后全部预设的有效字段；执行离线回归与源码、模块、文档门禁。

## 验证与失败处理

- `node scripts/run-tests.js offline --test-reporter=spec`
- `npm run check`
- `npm run verify:architecture`
- `npm run verify:modularity`
- `npm run verify:docs`
- `git diff --check`、逐文件 diff 和 `git status --short`。
- 测试沿用仓库的隔离 fixture；不启动完整桌面应用或访问真实用户数据。
- 如出现新失败，调查并修正本次改动；仅撤销本任务拥有的具体片段。

## 完成条件

所有删除都有调用链/作用域/表单消费者证据，相关文档与代码一致，清理后检查
通过或明确记录既有问题，最终差异不含生成数据、秘密或无关用户改动。

## 进度

- [x] 入口、作用域、JSON 与基线测试核查。
- [x] 完成删除与文档同步。
- [x] 完成最终验证与差异审阅。

## 结果

- 23 个源码/配置文件净减少 453 行；3 份所属架构文档同步。
- 主题 JSON 删除 14 类共 262 项无效参数，31,806 → 23,182 字节；默认主题、
  28 套预设的全部保留值、名称、色板及有效表单字段逐项比较一致。
- 清理后离线测试仍为 2705 通过，0 失败，无测试删除或放宽。
- `verify:quick`：文档 7 通过，JavaScript 语法 1031 文件通过，架构 22 通过。
- `verify:modularity`：1304 文件，16 个既有规模登记，0 错误。
- 已审阅源码与文档差异，`git diff --check` 通过；无生成或敏感材料进入差异。
- 保留词法扫描的误报，包括自增计数器、用于排除私有字段的解构，以及既有
  测试打包器需要的 queue-render 显式导入；没有删除兼容入口或整个运行模块。
- 未启动真实 Electron/OBS，也未进行安装、发布或访问真实账号的验证。
