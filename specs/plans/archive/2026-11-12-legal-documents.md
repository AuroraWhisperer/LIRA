# Separate legal documents and website privacy entry

**Status:** Complete

**Goal:** 将 LIRA 用户协议、隐私政策拆成独立文本及官网子网址，统一安装程序和客户端入口；官网页脚通过「隐私与 Cookie」说明面板提供两份文档链接。

**Architecture:** 客户端随包文本是正文源，现有导出脚本生成官网静态 HTML。官网沿用 `register-pages.js` 与主站 Host guard；`/legal` 保留兼容入口，新增 `/legal/terms` 和 `/legal/privacy`。不新增运行依赖、服务或认证 API。

**Tech Stack:** NSIS、原生 HTML/CSS/JavaScript、Node.js、Express。

## Constraints and decisions

- 用户确认官网页脚入口打开 Cookie 面板，面板内放两个协议链接。当前只有必要登录 Cookie 和本地偏好，确认按钮写「我已了解」，不声称开启或关闭不存在的统计/广告收集。
- Cookie 用途、存储期限和清理方式收进隐私政策章节，不另建第三份协议。旧 `accepted` / `essential` 浏览器状态仍视为已经看过说明。
- 现有协议实质条款保留，修正拆分后的交叉引用、日期和入口。运营主体/联系方式暂保留现有团队及管理员渠道，不编造身份、邮箱或完成法律审查的结论。
- 不改变安装同意门槛、更新跳过、安装目录、授权、Cookie 安全属性或实际数据处理。
- 不提交、推送、部署或打包正式发行版；两仓既有修改保持原样。

## Current behavior and owners

- Live `public/pages/admin/toolbox/user-agreement.txt` 是合并正文；`scripts/export-user-agreement.js` 导出 Server `public/site/legal/index.html`。
- `build/installer.nsh` 的单个 SysLink 指向 `/legal`；`settings-license.js` 读取一份正文到同一个 dialog。
- Server `public/site/index.html` / `site.js` 的 Cookie 两个按钮只保存本地选择，无统计或广告开关；页脚目前另有合并协议链接。
- 文档：Live 构建参考和入门/重装使用指南；Server `REQ-UX-002`、`AC-UX-002`、首页展示规范及相关品牌中性规则。
- 检查：Live installer-static、设置行为；Server legal-pages、site-preferences、公开首页偏好/动效/页脚现有浏览器检查。

## Milestones

- [x] 拆分两份文本，补 Cookie 章节及独立更新/联系说明，修正交叉引用；扩展导出脚本生成双页及兼容入口。
  - 验证：正文完整、无旧跨部分引用，静态网页与随包文本一致，URL/Host/cache/no-cookie 契约检查通过。
- [x] 安装页双链接与客户端两个入口；共享阅读弹窗正确加载、缓存、失败重试，迟到请求不覆盖当前文档。
  - 验证：相关 Node 检查，编译隔离 NSIS fixture；复用现有桌面验证能力，不操作用户运行实例。
- [x] 官网 Cookie 面板双链接与单确认按钮，页脚入口及无脚本后备链接；更新翻译、受影响的现有测试和说明。
  - 验证：真实页面链接/确认/重开/刷新及窄屏可达；现有浏览器检查按实际变化选择。
- [x] 同步文档并完成两仓最终差异检查。

## Verification

- Live `node --test test/engineering/installer-static.test.js test/engineering/installer-update.test.js`；设置文档读取用现有 ESM 测试工具补具体切换行为。
- Live `npm run verify:docs`。
- Server `npm run verify -- --node test/legal-pages.test.js --node test/site-preferences.test.js --plan`，确认后同范围执行；浏览器文件选定后同样先 `--plan`。
- Server `npm run docs:check`。
- 自有临时文件/预览/截图仅在两仓 `tmp/`；打开预览前检查精确 URL 的 HTTP 状态。
- 最终检查任务差异、`git diff --check` 与 `git status --short`，不触碰无关暂存内容。

## Failure handling

失败时保留原始正文和已有兼容地址，只调整任务拥有的差异。停止自有测试进程，不使用 reset/checkout 或移动用户数据。源码与本地验证不代表官网已上线。

## Done when

安装页和客户端能分别访问用户协议、隐私政策；两个官网子网址返回对应全文，旧 `/legal` 可继续找到两份文件。官网页脚可重开说明，面板链接与确认行为真实、可访问，无脚本也能查阅正文。相关检查、文档同步与最终差异审查完成；部署与运营主体未补充的边界明确报告。

## Evidence

- 2026-11-12：核对当前本地源码，确认 Cookie 两个选择没有控制不同收集行为。参考 VS Code 页脚的隐私/条款/隐私选择以及 Mozilla 的网站与 Cookie 说明；用户选择面板内双链接。
- Live：`node --test test/engineering/installer-static.test.js test/engineering/installer-update.test.js test/settings/settings-legal-documents.test.js`，15/15 通过；包括真实 NSIS include graph 编译、更新/静默语义及独立文档缓存、迟到响应和重试。
- 自有 NSIS 预览编译通过，静默 fixture 直接执行生产链接回调：两条链接的 NM_CLICK 与 NM_RETURN 分别记录 terms/privacy 正确目标，其他索引和通知不打开地址；未安装软件或操作用户运行实例。
- Server：legal-pages、site-preferences、public-art 三个 Node 文件 12/12 通过。preferences、registration-footer、homepage-motion 三个完整浏览器文件 41/41 通过；保留有效结果，不执行全仓浏览器套件。
- 初轮浏览器发现 300×568 字体回退时 Cookie 面板遮挡平台说明，以及无脚本用例仍期待无效设置按钮。缩短面板说明、收紧相关间距，保持两个链接及完整正文；无脚本期待改为静态文档入口。上述完整浏览器复验全部通过。
- 真实浏览器核对两份网页正文与随包文本逐字一致（忽略排版空白），SHA-256 与各源文件一致；旧正文差异只涉及拆分标题、日期、交叉引用与独立说明，保留原有实质条款。桌面、300px 小屏和政策页视觉检查通过。
- Live 文档门禁最终 10/10；Server 文档门禁 59/59。构建与前端参考、两份应用内指南、官网需求与验收同步；引导配置无协议入口，不需修改。无新增 wire API、鉴权或存储机制，协议/OpenAPI/ADR 不受影响。
- Impeccable detector 已运行；其 URL→文件映射不能解析站点静态路由，字体层级警告为未加载样式导致。实际浏览器已确认样式、正文层级与对比度。
- 两仓任务差异已复核，修复导出入口空行的尾随空白；自有浏览器与隔离预览服务已关闭。临时产物保留于 `tmp/legal-documents/`，不进入正式变更。
- 完成范围为本地源码；未提交、推送、正式打包或部署。运营主体及联系渠道仍沿用原有团队/管理员说明，没有补造真实身份或将此视为法律合规审查。
