# 客户端审计确认问题修复

Status: Completed

依据：2026-11-12 客户端审计的 F1–F7，用户明确要求直接修复。

## 目标与边界

修复全民 K 歌下旧歌词恢复内置音频、本地设置绑定等待云资料、歌词发布丢封面、歌单无法返回、场景漏接增量能力、空规则颜色错配、怀唐伊时区错误，并同步入门指南中过时的保存操作。

沿用现有模块化单体、原生 ESM/CSS、现有控制器和测试夹具。保留当前 HTTP/WS/IPC 输出结构、授权与数据格式、增量协商及旧消费者完整回补；不改正在其他任务中开发的昵称管理，不处理审计已排除的候选，不提交或打包。

当前工作树包含大量既有修改。任务前版本及复现记录保存在 `tmp/client-audit-fixes-2026-11-12-984a/`，最终按任务前版本核对差异，不能用整体 checkout/reset 回滚。

## 已确认行为与所有者

| 事项 | 代码 owner／消费者 | 相关测试／文档 |
| --- | --- | --- |
| F1 选源与歌词点击 | `public/js/playback/features/playback-controls.js`；`controller.js`、`core/initializer.js`、`ui/fullscreen.js` | `test/playback/playback-wesing.test.js`；`docs/reference/frontend/playback.md` |
| F2 设置初始化 | `public/js/admin/settings-form.js`；账户资料展示 | `test/admin/frontend-admin-startup.test.js`；`docs/reference/frontend/app.md` |
| F3 封面发布 | `src/server/routes/playback-routes.js` → `src/server/music-runtime.js` | `test/lyrics/external-music-following.test.js`；`docs/reference/backend/api.md`、`docs/reference/frontend/playback.md` |
| F4 歌单历史 | `public/js/playback/services/home-service.js` 持有历史；`ui/drawer.js`、`core/renderer.js` 显示状态 | `test/playback/playback-home-lifecycle.test.js`；播放参考与现有播放指南 |
| F5 场景装配 | `src/server.js` 传入已有 `getDisplaySession`／`getBlindBoxChangeToken` | `test/scenes/scene-extra-components.test.js`、场景真实 runtime 测试；`docs/reference/backend/server-core.md` |
| F6 规则槽位 | `public/js/overlays/queue-render.js` 与 `queue-theme.js` | 既有点歌板覆盖／本次隔离渲染检查；操作流程不变 |
| F7 城市时区 | `scripts/generate-world-clock-cities.js` 与 `public/js/admin/world-clock/city-catalog.js` | `test/admin/world-clock.test.js`；操作流程不变 |

## 实施与验收

- [x] **播放与歌词边界（F1／F3／F4）**
  - F1：全屏歌词仅提出跳转请求，由现有播放控制模块检查当前来源、曲目及异步输出准备后的请求有效性，再 seek/play；保持内置来源点击歌词可跳转并恢复播放。使用真实初始化／选源／已绑定歌词事件扩展现有测试，覆盖切源后不可恢复及正常内置播放。
  - F3：让歌词 HTTP 发布保留 runtime 所需 `coverUrl`，仍由现有归一化 owner 规范化输出。用真实路由到 runtime 的回归证明两个入口保留封面，同时公开歌词输出不新增封面字段。
  - F4：Drawer 从 HomeService 的 `canGoBack()` 渲染返回状态；移除因此成为孤立的 Drawer 历史，保留 HomeService 单一 owner。扩展现有歌单导航场景，验证进入详情和返回列表。
  - 验证：`node --experimental-vm-modules --test test/playback/playback-wesing.test.js test/playback/playback-home-lifecycle.test.js test/lyrics/external-music-following.test.js`，并运行受改动直接影响的已有播放测试。
- [x] **设置与城市数据（F2／F7）**
  - F2：账户资料异步加载不阻塞本地事件绑定；沿用其既有错误处理。扩展 pending-account 启动测试，确认房间表单、规则与监控操作已经有功能监听。
  - F7：给稳定城市 ID `ne-1159151737` 映射 `Pacific/Chatham`，同步生成目录的一条记录。现有时钟测试验证一冬一夏均快新西兰本土 45 分钟。
  - 入门指南把“点击保存点歌规则”同步为自动保存，不改变锚点、布局或其他步骤。
  - 验证：`node --experimental-vm-modules --test test/admin/frontend-admin-startup.test.js test/admin/world-clock.test.js`。
- [x] **场景与点歌板（F5／F6）**
  - F5：组合根补齐两个已存在的端口，不重新实现缓存或协议。用实际 server/runtime 装配验证：回合状态更新不再附带未变画布、稳定盲盒版本不重复返回、首次／旧消费者读取仍完整；既有组件用例继续覆盖聊天更新的画布／成绩增量。复用现有场景 fixture，不新增源码扫描测试。
  - F6：先保留规则原始槽位编号，再略过空文本；真实渲染／主题模块复查空第一条、第二条颜色匹配。不为纯颜色再建测试框架。
  - 验证：`node --test test/scenes/scene-extra-components.test.js test/scenes/scene-runtime.test.js test/scenes/scene-display.test.js`，补运行实际新增集成断言所属文件；隔离渲染验证规则槽位。
- [x] **同步、门禁与收尾**
  - 在既有参考文档同步变化的内部 owner 与发布输入，用户指南只改已确认漂移；不重复新建接口契约。
  - `node scripts/check-js.js --force`、`npm run verify:architecture`、`npm run verify:docs`、`git diff --check`。
  - 核对本任务差异、状态与临时文件；保留既有和并发修改。仅当直接受影响检查出现更大范围失败才扩展测试，不恢复其他计划暂停的全量验收。

## 失败处理与完成条件

若测试失败，先定位对应责任与真实输入，不能弱化断言。对异步播放保留当前选源／请求代次保护，对增量响应保留完整回补。必要时按任务前副本逐处撤销本任务的补丁，不能覆盖别人的修改。

七项缺陷均有通过的针对性证据、相关参考与指南一致、最终差异和门禁结果核对完成后关闭计划。全仓门禁的无关并行失败须明确保留，不冒称通过。临时脚本、合成数据库和日志只放在根 `tmp/`；无需操作真实桌面、账号或音频设备来重复 Node 已证明的控制规则。

## 完成证据（2026-11-12）

- F1–F7 均完成。F1 的全屏 UI 仅提出请求，播放控制模块拥有实际 seek/play；恢复请求使用用户操作当时的播放代次，保留切音质／解析下一首期间手动暂停与恢复。F4 删除 Drawer 重复历史，以 HomeService 为唯一 owner。其余修复沿用已有 owner 和接口。
- 缺陷复现与修复后的证据位于 `tmp/client-audit-fixes-2026-11-12-984a/`：`fullscreen-before-fix.log`、`admin-before-fixes.log`、`music-navigation-red.log`、`scenes-before-fix.log`；规则颜色通过 `desktop-queue-rule-verify.cjs` 验证。未覆盖或删除原审计证据。
- 最终 22 个直接相关测试文件 **285/285 通过**，包括播放来源／品质／队列／错误恢复、输出设备、歌词发布、抽屉浏览器焦点、设置、时区、点歌板及真实场景 HTTP 装配。结果见 `final-focused-tests.log`；没有运行全仓业务测试。
- `npm run verify:architecture` **29/29 通过**；`node scripts/check-js.js --force` **1,882 个 JavaScript 文件通过**，检查器确认期间输入未变化；`git diff --check` 通过。
- `npm run verify:docs` **9/10 通过**。唯一失败是并行 C01–C15 任务的 `specs/plans/2026-11-12-client-audit-15-fixes.md` 使用中文“状态”标签，门禁要求 `Status:`；该计划明确不属于本任务，保留其状态及原文。本任务文档的内容、链接及索引已核对。
- 同步 `docs/reference/frontend/playback.md`、`frontend/app.md`、`backend/api.md`、`backend/server-core.md` 和入门指南自动保存说明。F6/F7 没有新增用户操作，其他指南无需改动。
- 按任务前副本逐项审阅差异，保留同时出现的云端退出装配及礼物答谢文档修改。未提交、打包、发布、访问真实账号／数据库或操作用户运行中的客户端；本次未进行真实音频设备或 OBS／哔哩哔哩直播姬实播验收。
