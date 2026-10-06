# 月渡花汀时钟深浅配色与自动交替

Status: Completed — 2026-10-05。深浅配色、手动固定与按秒自动交替已实现。

## 目标与边界

在已有月渡花汀时钟中增加靛蓝山水底、月白数字的深色版本。用户可固定浅色、固定深色，
或按指定秒数自动交替；默认保持固定浅色，默认间隔 30 秒，允许 1–86400 的整数秒。
保持已有透明外围、花枝/折扇、尺寸、时间与日期控件。其他时钟样式不使用这两个外观参数。
不增加依赖、服务或新的计时器，不更改认证及真实用户数据。

## 当前行为与所有者

- `public/css/overlays/clock/moonlit-fan.css` 拥有浅色主题；增加同构深色调色板，复用原画。
- `public/js/overlays/clock.js` 拥有配置合并、日期格式与秒边界调度；自动配色由设备时间的
  固定秒段决定，预览和正式来源使用同样相位，隐藏后恢复直接校准。
- `public/js/shared/clock-settings.js` 与 `public/js/admin/clock-preview.js` 拥有设置映射和表单绑定。
- `src/server/clock-contract.js`、`overlay-projection.js`、`scene-components.js` 与
  `src/storage/settings-defaults.js` 拥有保存验证、公开字段白名单、场景兼容及默认值。
- 契约在 `docs/reference/frontend/overlays.md`、`docs/reference/backend/api.md` 和 `storage.md`。

## 兼容约束

新增设置 `clockMoonMode`（light/dark/auto）与 `clockMoonIntervalSeconds`（整数秒），
配置和旧参数网址中对应 `moonMode`、`moonIntervalSeconds`。旧网址、缺省配置和旧独立场景
补足 light/30；新增字段显式非法时拒绝保存。现有必填场景字段仍严格校验。
settings 通用键值存储已有默认值补全路径，本次不变更数据库 schema。

## 实施与验证

- [x] 1. 补足保存/投影/旧场景兼容与参数覆盖测试，再实现两项配置；验证非法模式、
  0/小数/空值/超大间隔不能保存，旧场景归一化成功，不暴露其他设置。
- [x] 2. 增加深色 CSS 与模式/秒数控件；复用秒调度器计算交替相位。
  确定性时钟测试覆盖每次边界、固定模式、隐藏恢复、重复配置和销毁。
- [x] 3. 通过现有内存 fixture 做浏览器验证：三种模式、间隔编辑、保存回读、
  场景输出、固定尺寸、两轮交替。检查完整与缩小尺寸、两个稳定配色，保存截图至 `tmp/`。
- [x] 4. 更新契约并审查本轮代码与测试 diff；完成记录归档，最终门禁日志留在 `tmp/clock-moon-palettes/`。

命令：`node --experimental-vm-modules --test test/overlays/clock-overlay.test.js test/overlays/frontend-clock-runtime.test.js test/overlays/overlay-projection.test.js test/scenes/scene-component-contract.test.js`；
`node --test --test-name-pattern='clock' test/admin/component-preview-browser.test.js`；
相关 settings/scene 回归；`npm run check`、`npm run verify:docs` 和 `git diff --check`。

## 回退与完成条件

仅逆向本轮补丁，保留此前时钟和工作区其他改动，不 reset/checkout。完成条件：深浅视觉均可读，
三模式真实生效并持久化，旧配置/场景可读，新字段白名单和校验有效，没有重复计时或请求，
上述针对性检查通过且限制如实记录。

## 验证记录

- 配置、运行时、投影、场景外观及设置保存共 44 项测试通过，含 SQLite 内存库重新创建 store 后的回读与无效批次回滚。
- 原有两个 clock 浏览器测试通过；新增模式/间隔、保存重载、场景发布快照、正式来源与预览三次同步交替的测试通过。
  测试使用内存 fixture；其模拟 controller 不写后端，因此发布前将待保存草稿映射给同一合成 runtime，
  实际设置持久化由上述 settings-contract 测试验证。
- 持久浏览器 QA 确认固定深浅、2 秒交替、12 小时制与隐藏日期/秒数、完整及半尺寸可读性。
  深色文字对靛蓝底的保守对比度下界：主时间 10.73:1、秒数/时段 7.45:1、日期 7.92:1。
  外围透明；完整对照图为 `tmp/clock-moon-palettes/qa/light-dark-comparison.png`，观测记录为同目录 `observations.json`。
- `npm run check`：1269 个 JavaScript 文件通过。最终文档门禁及 diff 检查日志为
  `tmp/clock-moon-palettes/docs-check.txt`、`git-diff-check.txt`；未运行与本次无关的完整测试集。
- 浏览器页面/资源错误为零；已关闭本任务创建的浏览器与内存 fixture。未验证 OBS/直播姬实播或重启用户桌面应用。
