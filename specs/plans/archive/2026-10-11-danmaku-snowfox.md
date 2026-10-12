# 雪狐物语实施计划

状态：Completed。本地实现与雪狐专项验收完成，未提交或部署；同期其他样式检查的限制见下文。

## 目标与范围

落实[雪狐物语规格](../../danmaku-snowfox.md)。不改其他样式、消息接收、身份解析、鉴权、租户隔离及存储机制；保留工作区已有使用指南修改，不提交或发布。

## 当前行为与所有权

现有固定列表支持流霞等样式，三类消息和安全文本/图片渲染可复用。`src/shared/danmaku-style-options.js` 与浏览器镜像拥有客户端外观字段，服务端 `src/lib/overlay-style-options.js` 与镜像负责校验和应用。布局合同支持补齐后来新增的样式区域。服务端拥有公共 renderer，客户端通过 `scripts/sync-danmaku-source.cjs` 导入。参数由管理面板和独立预览编辑，保存沿用既有 styleOptions。

## 交付步骤

- [x] 合同与入口：注册 snowfox、可选 bubbleColor 和默认区域；同步四份外观合同、布局镜像、能力表、服务端样式白名单；管理页和预览增加默认/自定义配色控件。验证已有配置保留、字段校验、草稿恢复和入口。
- [x] 渲染：新增 snowfox 装饰与 CSS、几何 SVG；公共 renderer 调用主题装饰，SC 增加自己的卡片结构；同步快照和服务器样式。验证文本安全、身份来源、金额、贴纸，以及四类消息只渲染一次。
- [x] 交付：生成样式缩略图；用现有隔离测试路径检查默认/自定义和长内容；同步 overlays 参考、使用指南、服务端 requirements/acceptance/protocol/OpenAPI；审查两仓差异。

## 验证

客户端运行直接受影响的 `test/danmaku/` 配置、布局、渲染器、参数与入口测试以及 `test/engineering/danmaku-source.test.js`，`node scripts/sync-danmaku-source.cjs --server-root ../lira-server --check`。服务端运行对应 `overlay-style-options`、`overlay-layout`、`overlay-message-renderer`、`overlay-superchat-renderer`、`overlay-settings-service`、`overlay-protocol-contract` 测试以及新增雪狐样式浏览器文件。文档分别运行 `npm run verify:docs` / `npm run docs:check`。最终 `git diff --check`、两仓 scoped diff 与 status 检查；不默认运行无关全量套件。

## 风险与失败处理

新样式与新配色字段需要客户端和服务端都更新后用于远程直播画面。旧版服务器可能拒绝新样式，保留现有错误反馈，不静默丢弃配置。若验证失败，停在本地并修复对应 owner；回退仅逆转本任务差异，保留原有未提交修改。不使用真实账号或付费消息进行测试。

## 完成条件

规格行为、配置兼容、两端渲染与相关文档均完成，比例适当的验证通过且差异审阅完成；没有生成/运行数据或秘密进入提交范围。

## 2026-10-11 验收记录

- 真实 renderer + CSS 的默认／自定义、普通文字／贴纸、SC、礼物、上舰同屏检查完成；首轮发现通用礼物 CSS 的优先级覆盖，已在主题层修复并复核。缩略图来自实际渲染，预览截图保留于 `tmp/snowfox/final-render.png`。
- 客户端渲染、feed、参数入口与本地预览定向检查通过；本地预览 12 项、面板 9 项通过。后来并行新增样式曾造成清单断言失败，更新后的外观／布局 14 项通过。公共 CSS ownership 检查仍因其他任务修改的 `identity.css` 不再引用旧 `danmaku-gifts/` 路径而失败；本任务不回退该修改。
- `test/desktop/danmaku-snowfox-electron.test.js` 通过：使用现有隔离主进程夹具、真实 preload／IPC 和选色器，保存颜色、重开回填、画布恢复默认并再次保存；测试目录和进程由夹具清理。
- Server `e2e/overlay-snowfox.spec.js` 通过：四类消息、整条换色、默认恢复、SC 色值独立、360×640 长 SC、贴纸及无页面异常。外观、渲染器、SC、布局、设置保存和效果参数定向测试通过；协议及文档门禁 52 项通过。
- Node 全局版本 24.21 不在 Server 支持范围，Server 验证使用仓库 `tmp/danmaku-efficiency/node-runtime/` 下现有的 Node 24.18，不改运行时版本限制。
- 公共 renderer 固定快照与服务端源码校验通过；Impeccable detector 无发现。技术参考、用户指南、规格与协议同步；交互导览未改，因为入口与现有操作顺序保持不变。未运行无关全量套件、生产部署或真实付费事件测试。
- 客户端 `npm run verify:docs` 为 9/10：雪狐规格、链接与归档通过，剩余失败是同期 `2026-10-11-danmaku-harbor.md` 的活动状态格式；保留该任务的文档，不替它改动状态。两仓 `git diff --check` 和本次 JS 语法检查通过；临时截图、日志及测试数据均位于忽略的 `tmp/`。

## 2026-10-11 细节与入场动画补充

- 收紧普通气泡与身份条比例，细化狐耳、冰雪纹理、头像花边和 SC 金额框；扩大上舰船锚。礼物昵称与金额独立排版，长卡片的头像跟随雪屋定位。
- 四类消息采用独立有限入场动画，保留 feed 对根节点移位的所有权。修正 SC 花边裁切，以及礼物文字容器变换导致礼盒定位跳动的问题。
- `e2e/overlay-snowfox.spec.js` 两项通过：默认／自定义配色、完整内容、长昵称与金额、四类动画推进和收尾、追加时旧节点不重播、最终不重叠、减少动态效果。系统开播通知保留并单独计入条数。
- 实际渲染的正常宽度和窄宽度检查完成；最终图为 `tmp/snowfox/refinement-final.png`，动画为 `tmp/snowfox/snowfox-animation.webm`；缩略图已更新。两端主题 CSS／七个 SVG 同步，保留同期新增的列表移位速度参数。
- 客户端文档门禁现为 10/10，服务端为 53/53；规格、技术参考及服务端验收说明同步。使用指南和导览无需追加：设置入口、参数、保存步骤均未改变。此次仅细化样式与动效，复用此前 Electron 保存重开证据，不重跑桌面或无关全量套件。
