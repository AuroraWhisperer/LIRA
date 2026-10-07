# 飘窗弹幕实施计划

状态：已完成（2026-10-06）。客户端与服务端代码完成，未提交、未部署。

## 目标与边界

新增 floating 飘窗分类。每条消息独立灰色圆角描边卡片，昵称和正文/表情，从右向左匀速移动；舰长/提督/总督深灰，其他身份浅灰。移动速率为 20–600 逻辑像素/秒整数，默认 120；默认区域铺满画布，沿用区域编辑。卡片允许交叠，匹配提供的多人截图。复用内容渲染、安全图片和现有配置链路；不改变固定/随机模式、不部署、不提交。

## 当前行为与所有权

Live 的 shared/danmaku-style-options、danmaku-layout 拥有展示配置；admin 参数面板及 overlay 预览消费这些配置。danmaku-feed 拥有布局生命周期，message-renderer 拥有安全内容渲染。lira-server 的 overlay-settings 持久化并发布同租户配置，public/overlay 提供正式渲染。两端 feed 已有各自修改，不能整文件互相覆盖。

## 兼容与实施

- [x] 两端 browser/Node 展示契约新增 floating、speedPixelsPerSecond；保留旧九/十区域记录，补齐新增区域，未知字段继续拒绝。更新 OpenAPI、规范。
- [x] 添加独立横向运动布局模块，由现有 feed 分派；复用 message renderer；移出后清理，限制条数，销毁释放动画/计时器/观察器。尺寸变化保留当前位置，速率可实时修改。
- [x] 客户端选择器新增第三组、速率参数、真实缩略图；预览与服务端均接通配置。
- [x] 针对配置校验/存取、旧布局兼容、移动方向/速率/退出、身份色/表情、模式切换运行直接相关 Node 与浏览器测试。运行现有桌面画布验证覆盖新增控件。

## 验证与完成条件

使用 node --test 的弹幕配置/布局/渲染相关文件，服务端 test-mode 隔离测试，Playwright overlay-floating 专项与相关既有用例；具体命令、结果完成后记录。审阅两仓本次修改及 git diff --check、git status --short。所有临时产物放 tmp/，不接触用户运行数据。保留本次开始时文件快照以区分已有修改；失败时只撤销本任务局部修改。

## 完成证据

- Live：`node --experimental-vm-modules --test` 运行 floating、layout、style-options、server-danmaku-settings、local-preview、style-ownership、frontend-admin-danmaku、overlay-fullscreen、overlay-renderer、snapshot-stability、feed-buffer、feed-motion 与 scene-component-registry 文件，70 项通过；IPC 相关用例在前一轮通过。
- Server：`node --require ./test/support/test-mode.cjs --test` 运行 overlay-floating、style-options、layout、settings-service、settings-routes、protocol-contract、static、preview，48 项通过。配置持久化、速率非法值原子拒绝与协议校验通过。
- `npx playwright test e2e/overlay-floating.spec.js e2e/overlay-layout.spec.js e2e/overlay-style-options.spec.js e2e/overlay-preview.spec.js --workers=2`：首次 79/80 通过；新增飘窗的小区域用例推动修正缩区后的起点及极小缩放的换行偏移。修复后对 floating 的 4 项直接受影响用例全部通过（`--grep floating`），复用其余 76 项成功结果。
- `node --test test/desktop/danmaku-canvas-electron.test.js`：隔离 Electron + 真实 preload/IPC 通过。新增飘窗在 2560×1440 当前画布自动铺满，120 默认速率修改为 240、保存并重开仍保留。
- 实际渲染深浅卡片、昵称及表情并检查；缩略图来自本地真实 renderer。Impeccable 检测无报告。样式背景透明，未改动真实用户实例。

没有生产部署或真实 B 站直播验收；本任务交付为已验证的两仓代码与资产。
