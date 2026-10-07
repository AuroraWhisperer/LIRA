# 流光彗尾飘窗样式

状态：已完成（2026-10-06）。两端代码与静态资产完成，未提交、未部署。

## 目标与边界

新增 comet「流光彗尾」飘窗样式：鲜艳的多色卡片及向右渐隐拖尾，整体从右向左移动。大航海深底、其他身份浅底。沿用 floating 的速度、区域及昵称/文字/表情能力，保留灰色款；不新增服务、依赖、参数或部署。

## 当前行为与所有权

共享 style-options/layout 定义两端展示合同；客户端选择器及参数面板、场景画布消费配置；服务端 overlay-settings 保存与发布。现有 floating feed 拥有运动及退出生命周期，CSS 拥有视觉，message-renderer 已提供稳定 data-tone。复用这些模块，不复制运动实现。

## 兼容与变更

- 新增 style 枚举、对应 options/region；老记录可缺少 comet 并补齐全画布区域，未知项继续拒绝。同步三份 OpenAPI 与规范。
- 浮动能力由布局判定，共用结构 CSS；新 CSS 提供渐变卡片、四组色调和右侧静态渐隐彗尾。
- 移动终点与清理计时纳入拖尾宽度，改变速度与区域延续当前位置。
- 选择器新增真实渲染缩略图，沿用已有设置控件。

## 里程碑与验证

1. 完成两端契约与渲染：运行 floating、layout、style-options、settings/protocol 相关 Node 测试。
2. 验证右向拖尾、深浅身份色、匀速左移/调速、完整离场、极小区域与样式切换：复用 overlay-floating 和 overlay-layout 浏览器用例，实际截图检查普通与大航海卡片及表情。
3. 复用隔离 Electron 画布测试验证选择新样式、满画布、速率保存回读。运行 git diff --check，检查两仓本次差异及状态。

## 回退与完成条件

开始编辑前在 tmp/comet-danmaku 保存对应文本基线；失败只回退任务局部，保留其他用户变更和并发随机布局工作。使用合成事件与隔离测试数据，不控制用户运行实例。新样式可选、符合视觉及生命周期要求、聚焦验证通过、合同一致且差异审阅完成后归档。

## 完成证据

- Live：`node --experimental-vm-modules --test` 运行 danmaku-floating、layout、style-options、server-danmaku-settings、local-preview、style-ownership、frontend-admin-danmaku、overlay-fullscreen、overlay-renderer、snapshot-stability、scene-component-registry，59 项通过；另运行 scene-display-client，2 项通过。
- Server：`node --require ./test/support/test-mode.cjs --test` 运行 overlay-floating、style-options、layout、settings-service、settings-routes、protocol-contract、static、preview，50 项通过。
- 浏览器：`npx playwright test e2e/overlay-floating.spec.js e2e/overlay-layout.spec.js e2e/overlay-style-options.spec.js e2e/overlay-preview.spec.js --workers=2`，首次 82/86 通过。4 项失败来自测试假设：模拟时钟不推进合成器动画、外层画布倍率影响测试取值，以及 comet 恢复主题后身份对应不同文字色。修正测试后对 floating/comet 的 11 项全部通过（同命令选择前三文件并 `--grep 'comet|floating'`），复用其余已通过结果。
- `node --test test/desktop/danmaku-canvas-electron.test.js`：隔离 Electron、真实 preload/IPC 通过；两款飘窗添加到 2560×1440 当前画布均铺满，120 默认速率改为 240，保存并重开保留。测试扩展修正 Electron evaluate 的首参数约定。
- 本地实际 renderer 的深/浅背景截图验证卡片色、文字和向右渐隐拖尾，缩略图已保存；浏览器资源已释放。Impeccable 检测无报告。修改的 JS 语法检查、两仓 git diff --check 通过，差异与状态已审阅。
- 没有真实 B 站直播验收或生产部署；交付范围为两仓代码与资产。
