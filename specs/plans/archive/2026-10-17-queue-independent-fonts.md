# 点歌板风格 1、2 独立字体

Status: Completed

## 目标与边界

风格 1、2 分别选择、保存、恢复字体，两者默认均为微软雅黑；字体库与本机字体入口不变。保留风格 3–6、资源包专用字体、认证和桌面安全设置。本次不提交、打包或部署。

## 当前行为与兼容

两款目前共用 `overlayFontFamily`，与用户要求不符。风格 1 保留此键；风格 2 新增 `identityQueueFontFamily`，默认 `Microsoft YaHei`。首次升级仅在新键不存在时复制旧字体，之后不覆盖独立值；旧场景读入时同样补齐一次。保留已有字体菜单点击修复及其他未提交工作。

## 归属与实施

- `src/storage/settings-defaults.js` / `settings-migrations.js` / `settings-store.js`：新默认和事务内幂等迁移，`INSERT ... SELECT ... ON CONFLICT(key) DO NOTHING` 在默认插入前执行。
- `src/storage/theme-store.js` / `src/server/overlay-projection.js` / `scene-components.js`：预设、展示投影、场景外观保留新键；旧场景缺键时复制自身 `overlayFontFamily`。
- `public/js/shared/queue-style-settings.js`：identity 字体映射独立键；渲染时仅把当前风格字体投影至既有 CSS 字段。
- `public/js/admin/queue-theme-config.js` / `queue-theme-view.js`：选择器读取当前风格值并只编辑对应字体键。`queue-theme.html` 和指南删除共用字体说明。
- 合同：`docs/reference/backend/storage.md` 与 `docs/reference/frontend/overlays.md`；指南及两张现有截图按实际界面同步。引导入口不变，无需改动。

## 里程碑与验证

- [x] 保存与兼容：扩展 `test/settings/settings-bootstrap.test.js`，断言旧字体只复制一次、新设置不被后续启动覆盖、空库两款默认微软雅黑、迁移失败可回滚；扩展 `test/scenes/scene-display.test.js` 验证旧场景与显式独立值。
- [x] 选择与显示：更新 `test/songs/frontend-queue.test.js` 和 `queue-overlay-esm.test.js`，断言风格 2 字体载荷不包含 `overlayFontFamily`、两款展示使用各自字体，旧快照仍可读取。
- [x] 隔离 Electron：两款各选不同字体，保存、来回切换、刷新；确认 `/queue` 输出字体匹配当前风格。测试使用 `tmp/` 合成数据和现有文档夹具。
- [x] 同步文档、相关静态检查、最终 diff 与 status。

命令：

```text
node --experimental-vm-modules --test test/settings/settings-bootstrap.test.js test/songs/frontend-queue.test.js test/songs/queue-overlay-esm.test.js test/scenes/scene-display.test.js test/scenes/shared-appearance.test.js
npm run verify:docs
npm run verify:architecture
git diff --check
git status --short
```

## 失败处理与完成条件

迁移沿用 bootstrap 事务，失败整体回滚；新字段不会删除旧值。若需撤回，仅逐项反向修改本任务 diff，不重置其他工作。只有独立保存、实际显示、旧值保留、相关检查和文档均完成后结束；临时测试进程必须关闭。

## 验证结果

65 项相关回归、27 项架构检查及文档门禁通过。隔离 Electron 中两款初始均为微软雅黑；风格 2 保存霞鹜文楷仅提交 `identityQueueFontFamily`，风格 1 随后仍为微软雅黑。风格 1 保存本机 STKaiti 后，两款来回切换、刷新与 `/queue` 输出分别保持 STKaiti 和文楷，单纯切换只提交 `overlayQueueStyle`。旧值迁移、重复启动和失败回滚均通过合成库测试。

技术参考及用户指南已修正；选择器位置和可见标签未变，现有两张配图仍准确，新手引导入口不变。测试实例已退出，未触碰用户运行中的应用。测试材料保留在 `tmp/queue-independent-fonts-tqDc31/`；此前清理操作被策略拒绝，本次未重试删除。未提交、打包或部署。
