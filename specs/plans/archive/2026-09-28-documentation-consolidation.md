# Documentation Consolidation Implementation Plan

**Status:** Completed (2026-09-28).

**Goal:** 清除当前文档中的已确认冲突和重复契约，明确架构、技术参考、规格、计划与历史报告的用途，统一旧计划的生命周期。

**Architecture:** 架构入口维护稳定职责、边界、数据流及决策导航；实现契约和操作细节由 `docs/reference/` 的领域文档维护。规格保留需求和验收依据，活动计划只跟踪尚未完成的实施；历史内容保留原始证据并明确不代表现状。

**Tech Stack:** 现有 Markdown、D2 图、Node.js 文档校验；不改变产品运行时。

## Constraints and ownership

- 延续当前工作区已有文档修订，保留其他代码、测试、UI 及图表修改；不提交、不创建分支、不发布。
- 不将当前实现自动提升为新的需求；Accepted ADR、明确未完成或暂停的工作不能为了归档而标记完成。
- 现状入口为 `docs/README.md`、`docs/architecture/README.md` 和技术参考索引；文档治理由 `PLANS.md`、规格索引、AI owner 路由表及 `test/engineering/governance-docs.test.js` 约束。
- 迁移文档时同步相对链接及活跃引用；历史记录保留日期、当时的命令和验证结果。

## Phase 1 — Correct current contradictions

- [x] 核对并清除本地签到/抽签旧回复说明、盲盒日期范围旧限制。
- [x] 更新 IPC 通道只在 preload 契约表维护；更新状态机保留在 update 文档。
- [x] 签名配置与操作只在签名参考维护，明确已实现脚本与尚未接入的发布步骤。
- [x] 验证：直接比较 owning code 与文档，执行 `npm run verify:docs`。

## Phase 2 — Separate architecture and reference

- [x] 盘点当前 docs 的全部目录和文档用途，建立统一入口及内容归属规则。
- [x] 将 backend/frontend/desktop 实现参考和 build/test/signing 操作参考迁入 `docs/reference/`；架构保留 overview、diagrams、ADR、模块化规则及 owner 导航。
- [x] 收敛重复字段、配置与流程细节，架构摘要链接唯一契约；核查迁移后的当前文档，记录并修复发现的现状冲突。
- [x] 同步入站引用和文档校验；验证当前文档本地链接、导航和契约索引。

## Phase 3 — Reconcile historical material

- [x] 逐一分类 `docs/superpowers/plans/` 与 `specs/plans/` 中的旧计划。完成/被替代的计划归档；未完成工作保留状态、剩余条件及当前 owner。
- [x] 整理 docs 根目录的旧审查/规划及 reports；区分历史证据、当前未结项与实施计划，提供明确导航和替代链接。
- [x] 核对规格索引与当前明确状态，避免将延期/待实测工作误报完成。
- [x] 最终执行 `npm run verify:docs`、迁移链接/内容归属检查、`git diff --check`，审阅本任务 diff 与 `git status --short`。

## Failure handling and done when

移动前保存本任务起始文档快照；回退只恢复任务自己的文档改动，不覆盖已有工作。当前文档具有明确归属、已确认冲突及重复契约已处理、旧计划均完成分类、现有未结项有可追踪入口、引用校验通过后完成。无需真实账号、外部服务、产品发布或运行时全套测试。

## Execution evidence

- 初始确认：当前文档仍存在此前列出的签到/抽签、盲盒范围、更新 IPC 重复和已完成计划未归档问题。工作区已有大量文档和运行时代码修改，本任务只整理文档及对应治理检查。

### 分阶段结果

- 阶段一：直接核对 domain-services/bilibili-client、blind-box-analysis/gift-routes、update-ipc、签名/验签脚本，清除旧签到/抽签、本日盲盒限制、重复 IPC 表及发布者模糊匹配说明。
- 阶段二：迁移 28 份技术/使用参考，架构首页只保留边界、数据流、ADR 与治理导航；歌词解析和流编排回归单一 owner，签名待实施步骤单列计划。同步代码内文档提示、Storage AGENTS、owner 路由及治理检查引用。
- 阶段三：原活动区及旧 docs 计划共 78 份逐一分类，35 份按原完成记录归档，29 份标明替代关系后归档，14 份保留验收/复核/延期/暂停状态；另将使用指南补充方案迁入计划区。未结项台账迁为活动导航，报告全部标记历史基线。
- 规格状态：旧 opening MVP 草案标记 Superseded，指向已有后续规格；区分礼物投影/云机器人“需求已接受”与交付状态；不把粉丝档案的历史门禁失败宣称为当前失败。

### 验证与边界

- 扩展后的 `npm run verify:docs`：9/9 通过，包含当前文档链接、所有 docs/specs 的相对文档链接、活动计划状态/索引、本地 HTTP 注册表及规格证据。一次校验发现本任务误把替代规格放入 Runtime Evidence，已改回真实 source/test 路径，未放宽规则。
- 当前文档 Markdown 标题锚点扫描及迁移引用检查通过；旧 UPDATE.md 作为版本历史保持原文。
- 78 份旧计划正文与任务起始快照比较：除引用迁移、状态标识及暂停计划中失效外部材料链接改为明确的历史路径外，无意外正文改写；没有补勾历史测试。
- 只修改文档、文档路径提示和文档治理检查。没有更改业务行为、操作真实账号/数据库/生产、构建签名产物、提交或发布；外部平台资料与真实验收继续保留明确限制。

- 最终检查：59 个当前 Markdown 标题锚点无失效；244 个本任务文本差异（含迁移与未跟踪文件）做基线对比及空白检查，仅发现新索引末尾空行，已修正。迁移文件无缺失，产品源文件只同步一处文档提示路径。
