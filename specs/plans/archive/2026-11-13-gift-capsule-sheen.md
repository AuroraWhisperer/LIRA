# 圆角礼物条与独立扫光实施计划

Status: Completed

## 目标与范围

保留礼物多选导出、既有三种外形、六种纹理和四档配色，增加 `tailStyle: 'capsule'`。增加独立 `sheen: boolean`（默认 false），所有外形和纹理均可启用；设置预览、画布及滚动展示播放白色扫光，导出预览和 PNG 始终不显示扫光。不增加动图导出或改变礼物合并、金额筛选、图片目录和桌面权限。

## 当前实现与归属

- `public/js/shared/gift-banner-styles.js` 拥有外观枚举和兼容默认值；`src/bilibili/gift/display-settings.js` 拥有持久配置校验。
- `public/js/shared/gift-banner.js` 与 `public/css/shared/gift-banner.css` 共用于设置、滚动与导出；保留 72px 行高、实际数量撑宽和 2 倍 PNG 输出。
- 设置由 `admin/gifts/display-settings.js` 和 `pages/admin/toolbox/gift.html` 编辑，画布由 `scene-extra-components.js`、`scene-extra-parameter-layout.js` 描述，`overlay-projection.js` 投影允许字段，`overlays/gift-feed.js` 更新已显示卡片。
- API 契约归 `docs/reference/backend/api.md`，渲染归 `frontend/overlays.md`；操作说明归应用内 `usage-guide-gifts.html`。不变更 HTTP 路径、IPC、持久键或数据源。

## 实施与验证

- [x] 外观合同增加 capsule 与 sheen，旧请求缺失 sheen 补 false；拒绝非布尔值。扩展 `gift-banner-feed.test.js`、相关路由和场景投影验证。
- [x] 既有选择控件保留，外形标签改为条带外形，增加白色扫光开关；保存/取消/默认值和画布参数贯通。扩展现有 `frontend-gift-display-settings.test.js`、`frontend-gift-feed.test.js`，不增加静态文案快照。
- [x] 圆角背景跟随实际条宽；白光仅在动态播放容器且 sheen=true 时生成，沿用最近礼物的 115 度光带和约 1.8 秒扫过节奏，循环留停顿，隐藏与减少动态效果时停止。导出使用静态上下文并显式关闭扫光。
- [x] 复用长数量 PNG 尺寸用例验证胶囊与导出隔离；以隔离 Electron/已有前端测试检查外形、纹理、开关与静态导出，截图放 tmp/。同步契约与用户说明。
- [x] 直接受影响的 Node 49 项、前端 21 项、架构 30 项、17 个改动 JS 语法检查通过。实现与测试差异已审阅；文档门禁最初只有计划索引格式失败，归档后 10/10 通过。

## 验收证据与限制

使用既有 `danmaku-canvas-editor.cjs` 隔离 Electron 宿主及独立数据目录，真实管理认证会话中选择圆角胶囊、糖纸波点和白色扫光，经实际设置端点保存并读回成功；白光矩阵随帧推进，减少动态效果时无扫光动画。真实 `/gift-export` 渲染在输入 sheen=true 时仍输出 sheen=false、零动画，长数量输出尺寸为 1074×144。六种纹理视觉核对通过，证据图片保留于 `tmp/gift-capsule-evidence/`，测试宿主和临时数据库已清理。扫描器仅提示既有 Arial 与无 src 图片，不在此次修改范围。未打包、发布或操作真实直播数据。

## 失败处理与完成条件

只修改上述责任范围。失败时定位到拥有者并用定向验证，不覆盖用户修改、不提交或发布。完成条件：旧设置兼容、任意外形纹理可组合开关、保存与运行时同步、长数量完整、导出无扫光，文档一致且定向验证通过；未验证的桌面正式版本如实记录。
