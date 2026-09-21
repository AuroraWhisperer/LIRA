# 本日礼物循环最低金额 Implementation Plan

**Goal:** 在“本日礼物循环”增加最小礼物金额（元）；默认 0 不过滤，正数只展示当天同一送礼人、同款礼物合并后累计金额严格大于该值的卡片。

**Architecture:** 沿用本地 `giftDisplayConfig` 和现有设置 GET/POST、设置广播与 OBS 白名单。后端保存整数分，前端在完整读取今日记录、派生卡片后过滤，再交给现有滚动状态。

**Tech Stack:** Node.js CommonJS、Vanilla JavaScript ESM、原生 HTML 表单、node:test 与现有隔离浏览器测试。

**Status:** Complete（2026-09-21）。

## Global Constraints

- 用户已确认按当天合并后的累计金额判断；比较为严格大于，0 表示不限制。
- 用户补充：金额只允许整数或一位小数，输入步长为 0.1 元。
- 保持现有公共路径、鉴权、数据隔离、整数分计算及滚动锚点/换行更新行为。
- 不影响原始礼物记录、历史筛选、导出、分色金额；不增加依赖、数据表或迁移。
- 保留工作区既有改动和上一轮蓝色色板调整，不提交代码。

## Current Behavior And Ownership

- `src/bilibili/gift/display-settings.js` 拥有默认值、读取兼容与校验；`src/server/routes/gift-routes.js` 已负责保存和广播，无需新增路由。
- `src/server/overlay-projection.js` 明确列出 gift-feed 可读取的设置字段。
- `public/pages/admin/toolbox/gift.html` 与 `public/js/admin/gifts/display-settings.js` 拥有设置表单、草稿、保存、取消及默认值。
- `public/js/shared/gift-card-model.js` 已计算合并卡片的 `cardTotalCents`；未知 UID 的独立记录仍需按历史单价乘数量计算。
- `public/js/overlays/gift-feed.js` 拥有滚动集合；当前不按金额过滤，完整重读后在换行边界应用新集合，静态/隐藏时立即更新。
- 契约归属 `docs/architecture/backend/api.md`；展示行为归属 `docs/architecture/frontend/overlays.md`。

## Compatibility

新增 `minGiftAmountCents` 非负安全整数且必须为 10 的倍数。旧配置/旧请求缺字段时规范化为 0；显式 null、负数、非整数、超过一位小数精度的金额、字符串、非有限数及超出安全整数的值拒绝保存。沿用原设置键和旧滚动速率兼容逻辑。

## Task 1: Settings Contract And Form

- [x] 扩展 `test/gift-banner-feed.test.js`、`test/gift-routes.test.js`、`test/overlay-http-access.test.js`：覆盖默认 0、旧配置保留其余值、合法整数分、非法值不改变持久配置、OBS 读取已保存值。
- [x] 默认对象增加 `minGiftAmountCents: 0`；校验使用 `value.minGiftAmountCents === undefined ? 0 : value.minGiftAmountCents`、`Number.isSafeInteger` 和 `% 10 === 0`；规范化返回包含新字段。
- [x] OBS 设置白名单加入 `minGiftAmountCents`。
- [x] 在行数/速度下添加 `giftFeedMinAmount` 数字输入，`min="0" step="0.1" required`，提示 0 不限制、最多一位小数和同人同款当日累计金额严格超过门槛。
- [x] 表单读取/填充按元和分转换；提交时四舍五入消除浮点噪声；恢复默认归零，取消还原已保存值。
- [x] 扩展 `test/frontend-gift-display-settings.test.js`：验证元转分、保存回填、旧配置默认、原生无效值校验、默认及取消。

## Task 2: Filter Aggregated Feed Cards

- [x] 在 `test/frontend-gift-feed.test.js` 覆盖低于/等于/高于门槛、合并历史不同单价、未知 UID 单独计价、0 不限制，以及设置刷新后滚动的启停。
- [x] `buildGiftCards` 后构造 pending 集合：0 保留全部，正数用 BigInt 比较 `cardTotalCents`；独立记录回退为 `BigInt(Math.round(unitPrice * 100)) * BigInt(num)`。不在分页前过滤。
- [x] 更新上述 API 与 overlay 契约文档。

## Verification

先运行新后端校验测试确认缺失行为，再实现；最终运行：

```text
node --experimental-vm-modules --test test/gift-banner-feed.test.js test/gift-routes.test.js test/overlay-http-access.test.js test/overlay-projection.test.js test/frontend-gift-display-settings.test.js test/frontend-gift-feed.test.js test/gift-card-model.test.js
npm run verify:quick
git diff --check
git status --short
```

预期全部任务相关检查通过。只使用既有隔离测试数据和浏览器 fixture；不操作用户正在运行的桌面应用。新增输入沿用现有布局，以表单交互测试验证；不建立临时 Electron 验证环境。

## Rollback Or Failure Handling

失败时只检查并修正任务拥有的局部差异；旧配置缺字段自然回退 0，不重写真实用户数据。若需要撤销，只撤销本计划对应字段、表单、过滤和测试/文档的改动，保留其他改动。

## Done When

- [x] 设置可保存、回填、恢复默认、取消；严格金额边界与累计语义正确。
- [x] OBS 收到新设置，滚动集合使用过滤后的数量，旧配置保持原展示。
- [x] 检查通过；差异已复核，无生成物或敏感/运行时数据进入修改。

## Results

- 实现前的 3 项默认值/过滤回归测试均按预期失败，证明现有行为缺少该能力。
- 实现后上述 7 个测试文件共 58 项测试全部通过，包含真实隔离浏览器中的输入精度、保存、恢复默认、累计过滤和轮播启停。
- `npm run verify:quick` 通过：5 项治理文档测试、966 个 JavaScript 文件语法检查、22 项架构测试。
- Impeccable 对 3 个修改的 UI 文件的机械检查无发现；沿用现有布局，未额外启动桌面实例或执行截图验证。
- `git diff --check` 通过；逐项审阅任务差异和工作区状态，保留其他任务改动。
