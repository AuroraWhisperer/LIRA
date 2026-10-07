# 随机弹幕位置参数实施计划

**Status:** Complete（2026-10-06；范围内实现与验证完成，未部署）。

## 目标与边界

为 outline、cream、glow 增加中心倾向 centerBias 和离散程度 dispersion，均为 1–50 整数，默认 1（不施加对应偏置）。按样式保存，恢复默认清除覆盖；不改变 floating 横向飘窗、固定布局、鉴权、租户边界或数据格式外层。不提交或部署。

## 当前行为与所有权

现有 danmaku-feed 以消息哈希选择一个位置，碰撞后依次尝试四角和已有卡片周围。Live 与 lira-server 分别维护 feed，不能整文件覆盖已有改动。配置由两仓 Node/browser style-options 契约归一化，沿用 styleOptions 的既有持久化、IPC、预览与事件链路。

## 实施与验证

- [x] 契约/UI：在四份 style-options 中增加随机样式专用字段；复用参数滑块、数值输出及提示，并接通独立预览。校验 1/50、非法数值、旧配置默认、按样式恢复；服务端既有保存测试覆盖原子拒绝、读取和单租户发布。
- [x] 算法：将现有位置选择提取为两端一致的纯展示模块；48 个均匀候选按 exp(-12*c*中心归一化距离平方 +12*d*上一条中心欧式距离平方/区域对角线平方) 加权，Gumbel-max 做稳定伪随机选择。拥挤时才补充边角/相邻候选，所有候选必须在界内且不碰撞。保留已显示坐标；上一条过期后仍记住其中心，清空时重置。通过确定性统计验证中心倾向与相邻距离，及窄区域/碰撞/尺寸变化。
- [x] 集成：预览与正式 feed 传入参数；在线更新影响后续消息，保留在场位置。更新规范和 OpenAPI。运行相关 Node 测试、现有隔离 Electron 画布测试与服务端 overlay-layout 浏览器文件。

## 验证命令与完成条件

Live 使用 node --experimental-vm-modules --test 运行 test/danmaku 的 style-options、random-position、fullscreen、local-preview、frontend-admin 及 test/desktop/danmaku-canvas-electron.test.js。Server 使用 node --require ./test/support/test-mode.cjs --test 运行 overlay-random-position、overlay-settings-service/routes、overlay-protocol-contract；使用现有 Playwright 配置运行 e2e/overlay-layout.spec.js。必要的契约/模块检查按新增展示契约范围执行。最后审阅任务基线差异、两仓 git diff --check 与 git status --short。

完成需：两参数可保存、重读、恢复，边界/碰撞规则保留，两端算法相同，统计趋势和桌面集成通过；未部署作为交付限制说明。临时证据和基线仅放 tmp/random-danmaku-*，失败时仅撤销本任务差异，不触碰其他工作。

## 完成证据

- 契约/UI、算法、两端集成三项均完成。三个 OpenAPI（Device、Management、Public）同步参数边界；两端随机算法文件内容一致。
- Live 参数、随机算法、fullscreen、local-preview、frontend-admin 五文件 32/32 通过。Server 对应随机算法、设置服务、路由与协议共 25 项通过（首次 24 项，新增协议断言后协议文件 10/10）。
- 现有隔离 Electron 画布用例 1/1 通过，覆盖新增参数保存、重读和恢复默认。补充真实 Electron 参数面板检查通过，滑块 Home/End 分别为 1/50；截图在 tmp/random-danmaku-parameters.png，隔离进程和数据已清理。
- 服务端 e2e/overlay-layout.spec.js 36/36 通过；Impeccable 对新增控件的检查无发现。ESM 标识符边界检查通过。
- 扩展 feed/motion/buffer/snapshot/overlay/styles 检查首次 19/21 通过；两项失败来自并行 comet 修改（当时缺少 comet.css、样式 import 列表尚未同步）。并行资源补齐后仅复跑失败项，两项均通过，本任务未修改这些无关问题。文档治理检查仍有一项并行 comet 计划状态失败，保留原样。
- 任务差异与两仓 diff --check/status 已检查；不含新运行数据或秘密，不提交、不部署。线上来源需后续更新服务端才能接受这两个参数。
