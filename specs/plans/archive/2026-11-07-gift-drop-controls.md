# 礼物掉落静态图与紧凑参数实施计划

Status: Completed

用户已确认数量按实际礼物件数放大，默认 4 倍、范围 1–8 倍。

## 目标与边界

礼物掉落使用本地礼物 WebP 的静态首帧；新增本机数量倍率，贯通结算、投影、预览与播放。两款内置效果的数值参数使用滑块和窄数字框，触发金额保留输入框，摇摇乐文字模式保留选择框。复用现有主题、参数滑块、图片缓存与 fallback，不改变结算数量、金额、鉴权、场景持久化或摇摇乐图片行为，不增加依赖和下载。

## 实施前行为与归属

- `public/js/shared/gift-motion-settings.js` 定义字段；`src/bilibili/gift/motion-config.js` 校验并捕捉结算参数；`src/storage/settings-defaults.js` 提供本机默认值。
- `src/server/overlay-projection.js` 投影展示字段；`public/js/shared/gift-drop-physics.js` 当前按 `num` 展开，单笔最多 60 个刚体、总数最多 400，余量标在最后一张。
- `public/js/overlays/gift-motion-player.js` 当前直接显示原 WebP，动画会继续播放；`gift-wish-image.js` 已有首帧 PNG 与有界缓存，可提取公共转换逻辑并保留许愿 PNG 契约。
- `public/js/admin/gift-motion-settings.js`、`public/pages/admin/toolbox/gift.html`、`public/css/admin/toolbox/gift-effects.css` 拥有参数 UI、草稿、保存和预览。
- 相关覆盖：`test/gifts/gift-motion-effects.test.js`、`gift-motion-browser.test.js`、`frontend-gift-wishes.test.js`；已有隔离 Electron 夹具 `test/fixtures/danmaku-canvas-editor.cjs` 可验证桌面保存与画布。

## 决策与兼容

新增 `giftDropQuantityMultiplier='4'`，整数 1–8，事件字段为 `motion.quantityMultiplier`。实际 `num` 不变；原单笔 60 张代表图按倍率复制，仍受同屏 400 张限制，已有礼物不提前驱逐。纵向出场间隔按原代表图计，避免倍增导致更长的落入时间。静态图转换按路径和输出格式缓存，掉落输出 WebP，许愿继续输出 PNG。转换等待不改变原始到期时间。

## 实施与验证

- [x] 扩展现有结算与物理测试：倍率透传、非法倍率拒绝、视觉复制和真实数量标记、容量与到期。运行 `node --experimental-vm-modules --test test/gifts/gift-motion-effects.test.js`。
- [x] 提取已有首帧转换并用于掉落；扩展现有浏览器场景用例，验证动画输入变成静态 WebP、倍率和延迟图片到期。运行 `node --experimental-vm-modules --test test/gifts/gift-motion-browser.test.js test/gifts/frontend-gift-wishes.test.js`。
- [x] 使用现有 `parameter-range` 控件，双向同步数字和滑块；参数按卡片宽度排为三列/两列，字段以细线和间距分隔。用隔离 Electron 验证默认值、双向调整、保存重载、草稿预览、非法输入；图片延迟与到期由现有浏览器场景覆盖，检查实际桌面布局并更新指南截图。
- [x] 同步 storage、ws、overlays、pages 参考及内置用户指南；检查导览是否受影响。运行 `npm run verify:docs` 和 `npm run verify:architecture`，对改动 JS 运行语法检查。
- [x] 最终检查 touched diff、`git diff --check`、`git status --short`；关闭自己的隔离实例，记录临时目录删除被策略拒绝的范围并完成归档。

## 失败处理与完成条件

测试仅用 `tmp/` 中的合成数据，不控制用户正在运行的应用。转换失败沿用现有占位图；验证失败先修正拥有者，不扩大至无关领域。需要回退时只反向应用本任务的具体差异，保留其他修改。以上验证、文档同步、桌面保存和本地画布播放通过，且最终差异无运行数据或敏感内容时完成；不提交、不打包、不发布。

## 验证记录（2026-11-07）

- 修改前新增行为回归出现 3 个预期失败，分别为倍率未透传、默认数量未放大及大连送未按倍率复制；实现后聚焦 34/34 通过，无跳过。
- 隔离 Electron 使用既有 `danmaku-canvas-editor.cjs`：默认 4 倍；键盘调滑块至 5，数值框同步；键入 3，滑块同步；保存倍率 3 与金额 1.25 后重载回显；键入 9 阻止请求。草稿倍率 2、保存值 3 时，画布首组 8 个示例生成 16 张静态 WebP，未覆盖保存值。无页面异常，测试窗口与预览浏览器已关闭。
- 原生 Electron 卡片宽 648px / 1020px 分别为两列 / 三列；数值框 64px、金额框 88px，分隔线对齐。更新指南截图为 1312×499。
- `npm run verify:architecture` 30/30；`npm run check` 1775 个 JavaScript 文件通过。
- `npm run verify:docs` 10/10；最终改动逐项复核，`git diff --check` 通过，无暂存、提交、打包或发布操作。
- Impeccable 检测仅报告既有 `giftFrameThumb` 无 `src`：节点初始 `hidden`，导入样式后由原 owning 模块设置图片，正常截图中没有破图，不改动该既有延迟加载行为。
- storage、ws、overlays、pages 和内置指南已同步。API 参考使用既有字段定义链接，无新增入口或独立契约；组件来源指南与交互导览仅描述未变化的导航和预览入口，因此不修改。
- 清理限制：自动审批拒绝删除 `tmp/gift-drop-controls-b1ndql/`，仅返回 `blocked by policy`。没有重试或改用其他工具绕过；隔离进程已关闭，合成测试数据与截图留在该忽略目录，不进入产品差异。未执行真实 B 站送礼及直播软件实播验收。
