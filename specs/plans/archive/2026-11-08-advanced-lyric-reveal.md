# 高级歌词当前句与逐字显现

Status: Completed

## 目标与边界

高级样式始终只输出当前句。新增「隐藏未唱到的字」，默认开启，关闭后显示当前整句并保留逐字高亮。显现、入场、停留和退出使用现有歌词时钟，暂停和前后拖动能确定性恢复。保留基础歌词和已完成的紧凑编辑布局，不增加样式数量、依赖、服务或输出入口。

## 当前证据与设计方向

- 当前 renderer 在整句构建时显示所有字形，仅高亮蒙版随时间变化；`ShowNextLine` 还参与构图。
- 已查看用户的 [B 站演示](https://www.bilibili.com/video/BV1RQxu6UEF7/) 中字块、错位大小字和单句排版。参考其文字主导的构图，但显示范围服从本次明确要求。
- [JIZURA 表达包](https://github.com/852wa/JIZURA/blob/main/docs/EXPRESSION_PACKS.md) 将构图、入场、停留、退场分离；[FitBox](https://github.com/arijit-debug/LyricalStudio/blob/main/src/templates/FitBox.tsx) 按静态几何适配。沿用本项目已有对应结构，不移植外部代码。
- 动效焦点：每个字在演唱时间到达时进入既定位置；文字与其描边/投影/回声共同显现。构图不随显现重排，字块底板跟随该组首字出现。退出不得提前吞掉尾字。
- 性能预算：现有共享帧循环与 WAAPI；换句/设置/字体/尺寸变化时测量，稳态不读布局。保留连写字形和超长句的有界单元，必要时整形文本用蒙版连续显现。

## 所有权与兼容

- 字段与预设：`public/js/shared/advanced-lyric-appearance.js`；显式持久化默认值：`src/storage/settings-defaults.js`。
- 显现与生命周期：`public/js/lyrics/advanced-lyric-renderer.js`、`advanced-lyric-layouts.js`、`advanced-lyric-motion.js`、对应 CSS。
- 编辑入口：`public/js/admin/advanced-lyric-editor.js`、`desktop-lyric-parameter-layout.js`、`scene-extra-preview.js`。
- 保留旧 `advancedLyricShowNextLine` 键的布尔解析和预设兼容，隐藏控制且渲染忽略。新增 `advancedLyricHideUnsung='true'`，缺失值由现有默认值机制补齐，不迁移数据库、不改用户数据目录。
- 缺少逐字时间时，沿用句内均匀估算；多字 token 的区间按字形进度分配。翻译没有独立时间时跟随当前句估算，不能把估算描述成真实对齐。
- 消费者仍为管理页预览、独立浏览器源和场景歌词；不新增请求/订阅/计时器。

## 实施与验证

- [x] 在既有 browser suite 重现未唱字可见与下一句泄漏；覆盖所有排版、回声、材质、关闭逐字动作、暂停/回退/隐藏恢复。
- [x] 更新字段、桌面/场景参数和保存预设；在既有 settings/shared appearance 用例验证 false 值持久化、旧预设接受、新参数投影。
- [x] 当前句构图移除下一句路径；字形显现采用独立包装层，避免与逐字动作争用 transform；分组底板和退场跟随有效时间。
- [x] 同步 `docs/reference/frontend/overlays.md`、`docs/reference/backend/storage.md`、应用内配置指南；app/pages 仍正确描述入口和预览归属，导览无相关下一句说明，均无需再次调整。
- [x] 运行 `node --experimental-vm-modules --test test/lyrics/advanced-lyric-renderer.test.js test/lyrics/advanced-lyric-browser.test.js test/lyrics/desktop-lyric-renderer.test.js test/lyrics/desktop-lyric-settings-runtime.test.js test/settings/settings-contract.test.js test/scenes/shared-appearance.test.js`，71/71 通过。
- [x] 用已有隔离 Electron 夹具验证显示内容开关与预览；实际播放观察连续显现，浏览器覆盖尾字、回退、取消隐藏、底板与回声。截图及隔离数据仅存 `tmp/`，自有实例已关闭。
- [x] `npm run verify:docs` 10/10、7 个受影响生产 JS 语法检查通过；完成任务差异复核，收尾执行 `git diff --check` 与 `git status --short`。

## 回退与完成条件

失败时保留现场和失败证据，只反向修改本任务涉及行，不回滚其他会话的更改。完成须满足：全部高级样式不输出上下句；默认未唱字不可见、关闭后整句可见；时间边界/暂停/拖动/销毁正确；现有配置、预设与场景保持兼容；聚焦检查、文档和最终 diff 复核完成。

## 验证记录

修改前新增两项回归分别失败于下一句存在和未唱字可见；修改后 71 项相关测试通过。补充全入场类型轮换后 browser suite 7/7 再次通过。原有减少动态测试的下一句 aria-label 预期同步为仅当前句。

Electron 使用 `test/fixtures/danmaku-canvas-editor.cjs` 的独立数据目录、随机端口及真实 preload/桌面授权；正常 `/admin?desktop=1` 导航 200。显示内容默认勾选新开关，旧下一句控件不存在；两种状态均收到 `/api/settings` 200，保存的字符串分别为 `'false'`、`'true'`。实际共享时钟播放采样为「把」「把此」「把此刻」，取消隐藏后整句可见。1440×913 内容区内表单、开关和预览均完整可达。

证据：`tmp/lyric-reveal-kCQc1E/hidden-unsung.png`、`full-current-line.png`、`playback-0.png` 至 `playback-2.png`。第一次导航过早中断夹具，第二次查询串脚本匹配与缺少面板 active 状态导致工具等待；已定位并改为完整加载后验证。最终自有 Electron 已关闭，临时目录递归清理被执行策略拒绝，保留测试数据和截图，不换通道删除。未测真实直播软件实播；未提交、打包或发布。
