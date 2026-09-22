# 交互式引导系统说明

更新：2026-09-22。本文合并原视觉说明，以当前 Electron 管理页实现为准。

## 当前入口与首次展示

管理页通过 `app.js` 初始化聚光灯引导。初始状态加载成功后，`claimAutoOpen()` 检查 `localStorage.liraTourFirstRunShown` 与旧的 `liraTourCompleted`：仅当两者均不存在时自动打开，并在打开前立即记录首次展示。因此后续启动、覆盖安装和引导版本升级不会再次自动展示。

“百宝箱 → 使用文档”的重新打开按钮调用 `window.liraTour.reset()`，从头开始引导，但不清除首次展示记录。控制器也提供 `open()` 和 `close()`。完成引导会保存完成版本；手动退出使用现有确认面板。

旧七步弹窗的 JavaScript、HTML、CSS 和 `window.AdminApp.onboarding` 已退役。`onboardingVersion`、`onboardingCompletedAt`、`onboardingSkippedOptional` 三个旧设置键保留兼容，不参与现行引导的自动展示判定。

## 操作流程

引导直接导航到真实功能位置，不复制登录、导入或设置业务逻辑：

1. 欢迎说明。
2. 认识顶部“点歌 / 播放 / 礼物 / 百宝箱”四个主入口。
3. 导航到点歌设置页，登录直播账号。
4. 填写直播间号或网址。
5. 查看右上角直播间状态和“刷新直播”按钮，按提示保存设置并建立连接。
6. 打开导入导出页，了解导入歌单的入口。
7. 切换到播放页，了解音乐平台选择器。
8. 打开百宝箱使用文档。
9. 显示完成提示。

带 `waitForAction` 的步骤通过配置中的 `checkCompleted` 检查实际操作状态，未完成时不能进入下一步。等待时显示琥珀色状态，完成后显示绿色确认状态。步骤文案、目标和条件以配置文件为准。

## 视觉与定位

遮罩使用 `rgba(16, 29, 46, 0.38)`，不做全屏模糊。有目标时用四块矩形围出高亮区域，内部透明且保留真实控件交互；无目标步骤显示普通遮罩和居中说明。高亮边框使用现有强调色 token。

浮动提示按目标、可用空间和视口边界定位，空间不足时换边并钳制位置；相邻目标可以组合高亮。调整窗口或滚动时更新位置。切换步骤时避免导航过渡引入额外等待，不以持续动画或高频布局刷新维持高亮。具体字号、圆角、动画和窄窗口规则以 CSS 为准。

## 文件职责与验证

| 文件 | 职责 |
| --- | --- |
| [interactive-tour-config.js](../public/js/admin/interactive-tour-config.js) | `TOUR_CONFIG_STEPS`、版本、完成检查间隔及首次展示标记判定 |
| [interactive-tour.js](../public/js/admin/interactive-tour.js) | 控制器、真实页面导航、操作检测、打开/关闭与退出确认；保留 `TOUR_STEPS` 等既有导出 |
| [interactive-tour-position.js](../public/js/admin/interactive-tour-position.js) | 提示框定位计算 |
| [interactive-tour.css](../public/css/admin/other-features/interactive-tour.css) | 遮罩、高亮、提示框与状态样式 |
| [app.js](../public/js/admin/app.js) | 管理页初始化和首次自动打开 |
| [usage-guide.js](../public/js/admin/usage-guide.js) | 手动重新打开入口 |
| [interactive-tour.test.js](../test/interactive-tour.test.js) | 首次展示、手动重开、定位、目标配置与样式回归 |
| [frontend-admin-startup.test.js](../test/frontend-admin-startup.test.js) | 初始数据、主题和桌面控制的启动顺序 |

验证命令：`node --experimental-vm-modules --test test/interactive-tour.test.js test/frontend-admin-startup.test.js`。真实登录仍要求 Electron 的正常授权环境，普通浏览器不能验证桌面登录能力。
