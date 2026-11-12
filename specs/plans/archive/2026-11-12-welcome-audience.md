# 进场欢迎名单实施计划

**Status:** Completed

**目标：** 在进场欢迎的参数、词库旁增加「欢迎名单」，按 UID 编辑白名单和黑名单，由服务器统一执行。

## 决策与边界

- 白名单仅豁免普通首次欢迎的荣耀门槛，仍遵守欢迎开关、直播准入、延时、冷却；不提高荣耀等级，不豁免二次问候条件。
- 黑名单优先于白名单和个人文案，阻止普通欢迎、二次问候及 PK 串门欢迎；保存后取消尚未发送的被屏蔽欢迎，已交给上游的发送不能撤回。
- 当前只有按 UID 定制文案，没有欢迎名单；画面屏蔽名单拥有不同职责，继续独立。
- 新增 V2 `welcomeWhitelist` / `welcomeBlacklist`，均为最多 100 个不重复的 1～20 位正整数字符串 UID，默认空数组。两个名单可同时包含同一 UID，由黑名单优先。
- 使用现有租户 `danmaku.welcomeOptions`，不新增表、同步流、连接或客户端发送器。省略字段保留原值，空数组清空；V1 保留且不暴露名单。
- 新客户端仅在服务器完整返回两个字段后启用编辑，旧服务器缺少两个字段时保留原功能；缺少一个字段或格式错误不得确认保存。
- 两份名单独立保存草稿，刷新和保存期间的新编辑保留，切换账号清空并忽略迟到结果。

## 所有权与兼容

- Server：`src/lib/welcome-options.js` 校验、`src/storage/welcome-settings.js` 保存/读取、`src/modules/danmaku/welcome-service.js` 准入与取消；既有 Device 路由继续根据认证身份选租户。
- Live：`src/shared/welcome-settings-contract.js` 约束 IPC，`danmaku-welcome.js` 管理账号和保存，新增同目录名单编辑模块与页面片段，沿用现有 CSS tokens。
- 契约归属：Server `docs/protocol/viewer-welcome.md`、Device OpenAPI 与 fixture；需求/验收同步到既有欢迎章节。Live `docs/reference/desktop/main.md` 和应用内欢迎使用指南同步。
- 保留两个仓库已有未提交工作；不提交、推送、部署或修改真实数据。仅修改本任务涉及的片段。

## 里程碑与验证

- [x] 服务端：扩展设置与名单准入，覆盖白名单/荣耀/个人文案、黑名单冲突、排队取消及 PK 独立性；扩展既有设置/HTTP 测试验证原子失败、租户隔离和 V1 保留。
- [x] 客户端：第三页签与两个独立编辑器，沿用 UID 输入、分页、删除和显式保存；扩展现有 frontend/IPC 用例验证草稿、旧服务器和迟到响应。
- [x] 桌面：沿用 `test/fixtures/daily-bot-editor.cjs` 的隔离 Electron 夹具，检查名单保存、重载和页面布局，不接触用户运行中的应用。
- [x] 同步文档并检查相关引导；按变更范围运行文档、模块/契约与语法门禁，审查任务 diff 与工作区状态。

验证入口：

- Server：`node scripts/run-with-node.cjs --require ./test/support/test-mode.cjs --test test/welcome-stages.test.js test/welcome-service.test.js test/welcome-lifecycle.test.js test/welcome-settings.test.js test/welcome-settings-http.test.js`；`npm run docs:check`。
- Live：`npm test -- --file=test/settings/frontend-welcome.test.js --file=test/settings/welcome-settings-ipc.test.js --file=test/desktop/welcome-editor-electron.test.js --file=test/admin/admin-page-composition.test.js`；`npm run verify:docs`，相关 JS 语法检查与架构检查。
- 两仓最终 `git diff --check`、任务范围 diff 与 `git status --short`。

## 失败处理与完成条件

失败时保留未保存草稿，检查当前账号与支持能力，不降级写入、不静默清空服务器名单。只回退本任务修改，不覆盖原有工作。功能、相关测试、契约与指南一致且定向验证通过才完成；源码完成与生产上线分开报告。

## 实施证据

- Server 欢迎/设置/HTTP/生命周期 53/53；`npm run docs:check` 59/59。
- Live frontend/IPC/隔离 Electron/页面组合 44/44；最后的指南编辑后页面组合复验 6/6。测试记录在 `tmp/test-results/run-VEqbyv/` 和 `run-NH1bDo/`。
- Live 架构门禁 29/29、文档门禁 10/10、四份相关 JS 语法检查通过。首次文档检查只因本计划状态标签使用中文未被识别而失败，改为标准 `Status` 后通过。
- 当前 Server V2 fixture 经 Live sanitizer 通过，完整 UID 名单 patch 经双端校验一致；未修改发布契约版本锁。
- 真实隔离 Electron `/admin` 保持匿名 401；空名单与示例名单页目视检查通过，无横向溢出。进程已关闭；截图转为 `public/img/usage-guide/E/welcome-audience.webp`，指南明确演示 UID。
- Impeccable 对新编辑器、片段与欢迎 CSS 检测返回空问题列表。新增行为延续当前桌面样式，无新增网络请求、连接或本地名单持久副本。
- 已同步双端契约、需求/验收、Live 桌面和页面参考、应用内说明及截图；交互式引导没有欢迎编辑步骤，现有指南链接/锚点不变。
- 两仓任务基线差异及 `git diff --check` 已审查，保留原有改动。源码完成，未提交、打包、部署或向真实直播间发送消息；线上使用需配套更新服务端和客户端。
