# 直播歌词实时预览与独立地址

Status: Completed

## 目标与当前行为

按用户要求恢复左宽右窄的歌词设置布局，仅预览当前音乐来源的真实歌词；移除两个输出开关和示例试播，右侧显示随基础／高级页签切换的可点击复制地址。当前预览列最多 560px，示例播放器会暂时替代实时歌词；现有独立地址仍被历史显示开关阻止。

## 归属与兼容

- 管理页：`public/pages/admin/song/desktop-lyric*.html`、`public/js/admin/desktop-lyric.js`、`desktop-lyric-preview.js`、`public/css/admin/desktop-lyric/`。
- 输出可见性：`public/js/lyrics/desktop-lyric-renderer.js`。复用 `/lyrics?layer=basic|advanced`，显式选层直接启用对应层，暂停隐藏规则继续生效。
- 旧 `/lyrics` 合并地址及 `lyricLayer=both` 保留历史开关兼容；不迁移或删除已有设置键，不改变音乐采集、时钟、保存接口或桌面授权。
- 文档 owner：`docs/reference/frontend/app.md`、`pages.md`、`overlays.md`；用户操作说明：`public/pages/admin/toolbox/usage-guide-configuration.html`。
- 测试 owner：`test/lyrics/desktop-lyric-renderer.test.js`、`desktop-lyric-settings-runtime.test.js`、`advanced-lyric-browser.test.js`；桌面检查复用 `test/fixtures/danmaku-canvas-editor.cjs`。
- 不修改歌曲信息独立组件、其他样式、用户运行中的客户端和现有无关修改。

## 实施与验收

- [x] 移除开关、示例 UI 与独占逻辑；右侧先缩至 360px，再按用户补充要求加宽 10% 至 396px。基础预览字号缩小至设置值的 65%，设置值保持不变。
- [x] 地址与编辑页签同步；显式输出层不受历史开关影响，保留暂停隐藏及旧合并输出。扩展现有 owner 测试，清理已取消的示例测试。
- [x] 更新直接受影响的技术参考与使用指南。现有音乐来源与交互引导入口不变。
- [x] `node --experimental-vm-modules --test test/lyrics/desktop-lyric-renderer.test.js test/lyrics/desktop-lyric-settings-runtime.test.js test/lyrics/desktop-lyric-surface.test.js`：30/30 通过。
- [x] `node --test --test-name-pattern='advanced preview dragging' test/lyrics/advanced-lyric-browser.test.js`：1/1 通过。
- [x] 隔离 Electron 43.8.3 中使用合成播放器事件检查等待播放、基础／高级歌词、地址切换及真实剪贴板复制。基础→高级→基础复制正确，页签切换不发送设置请求，零页面异常。最终两模式预览宽 396px，基础字号 56 的预览为 36.4px；测试进程已关闭。
- [x] `npm run verify:architecture`：29/29 通过；三个修改脚本 `node --check` 通过。
- [x] `npm run verify:docs`：10/10 通过；任务相关差异已审阅，`git diff --check` 通过，已核对状态并保留其他任务修改。

## 完成与失败处理

初次文档门禁因计划使用中文状态标签失败，已改用标准状态格式并归档。设计扫描只报告已有歌词材质缩略图的渐变文字；该效果属于用户选择的歌词材质，本次未修改。截图与记录位于 `tmp/lyric-preview-qa-It4D3I/`；未控制真实播放器或验证直播软件实播，不以隔离输入代替外部采集验收。

若检查失败，只修复本次变更导致的问题；回退时按文件差异撤销本任务片段，不重置或覆盖无关修改。不提交、打包或发布。
