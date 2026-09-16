# Blind-box Catalog Exclusions Implementation Plan

**Goal:** 指定的 8 种礼物不再成为盲盒映射候选，目录身份返回 `isBlindBox: false`；查明两个“大航海盲盒”的原因。

**Architecture:** 服务端目录拥有分类及官方关系；客户端消费已校验快照，不重复维护业务排除名单。沿用既有按 gift ID 排除入口。

**Tech Stack:** Node.js / CommonJS、Vanilla JavaScript ESM、现有 node:test。

**Status:** Complete（2026-09-16）；本地代码、测试及文档完成，未部署。

## Evidence and ownership

2026-09-16 只读查询线上 schema 3 目录确认：大航海盲盒有两个不同 ID `33925` / `34635`，均 50000 金瓜子，只有 `34635` 有核验的权益奖池。客户端逐身份渲染且隐藏了编号，未重复同一记录。

排除真实 ID：`31646` 盲盒道具、`32219` 拆宝盒、`34580` 测试盲盒（0.10 元）、`34929` 整蛊盲盒(test)、`35096` 疯五预演、`35429` 七夕盲盒/中秋盲盒、`35960` 组合测试。用户明确七夕盲盒仅排除 `35429`（¥15），`35141`（¥25）保持盲盒及核验奖池。

服务端位于 `D:/Work/lira-server`：`src/modules/gifts/blind-box-catalog.js` 拥有排除规则与兼容关系，`gift-variant-catalog.js` 拥有 schema 3 分类及关系验证，`gift-client-catalog.js` 已调用 ID 排除入口。已有未提交的 `35429` 排除修改必须保留；本次用户要求扩展其他被排除 ID，保留 `35141` 的既有规则。

客户端 `public/js/admin/gifts/blindbox.js` 拥有映射列表；用户确认只展示有核验奖池的官方身份，大航海只显示 `34635`；未来同名未核验资料同样过滤，多个有独立奖池的身份用真实编号区分。权益奖池展示名称及价值，不伪造礼物 ID。

## Constraints and non-goals

- 不删礼物元数据、活动身份或历史事件，不重算已建立的礼物组。
- 不修改 wire 字段、身份摘要算法、数据库 schema、授权或租户边界。
- 排除以真实 ID 为准，重命名、改价、同步或查询服务重建不能重新启用。
- 保留其他礼物分类和权益奖池；维护种子可留存历史关系，但默认发布不得包含排除来源盒；外部显式非法关系包仍整包拒绝。
- 保留两仓库既有用户修改；不提交、不部署、不写运行数据库。

## Milestones and verification

- [x] 在现有目录测试中先复现失败：全部排除身份为 false，官方关系移除，更新及重建后持续生效，显式关系包拒绝，正常盲盒不受影响。
- [x] 最小实现服务端排除及默认关系筛选；同步 requirement、acceptance、protocol/OpenAPI 中现有排除规则。
- [x] 按用户选择完成大航海盲盒展示；通过现有前端 fixture 验证更新后的 false 标签不进入映射，且不更改礼物身份。
- [x] 运行直接相关测试、必要的契约门禁，审查两个仓库任务 diff、`git diff --check`、`git status --short`。

主要验证命令：服务端 `node --test test/blind-box-catalog.test.js test/gift-client-catalog.test.js test/gift-variant-catalog.test.js test/gift-blind-box-service.test.js test/public-gift-catalog-contract.test.js` 和 `npm run docs:check`；客户端 `node --experimental-vm-modules --test test/frontend-blindbox-mapping-state.test.js test/frontend-blindbox-mapping-refresh.test.js test/remote-catalog-contract.test.js test/gift-identity-catalog.test.js`。

## Results

- 服务端上述测试加 `test/gift-variants.test.js`、`test/gift-catalog-version.test.js` 共 42 项通过；`docs:check` 33 项通过。
- 客户端上述测试加 `test/frontend-blindbox-admin.test.js`、`test/frontend-gifts.test.js`、`test/frontend-gifts-panel.test.js`、`test/frontend-gift-catalog-update.test.js`、`test/hybrid-gift-catalog.test.js` 共 51 项通过；`test/governance-docs.test.js` 5 项通过。
- 格式整理后重跑受影响服务端 14 项、前端 12 项及文档 5 项均通过。两个修改的服务端模块和客户端映射模块 `node --check` 通过，两仓库 `git diff --check` 通过。
- 既有服务端共享 fixture 已将 `35429` 标为非盲盒，客户端原有一项断言仍期待展开奖池，基线可复现失败。本次将断言改为无奖池，保留完整身份及图片匹配验证。
- 只修改源码、合成测试及文档。服务端已有及期间新增的其他任务改动保持原样，未操作真实数据库、未提交、未发布。

## Failure handling and done criteria

失败时仅修正本次拥有的行，不覆盖既有修改；网络读取仅作诊断，所有测试使用合成临时数据。完成要求排除规则覆盖 v2/v3 及官方详情、同步后不恢复、客户端遵循服务端分类；测试及最终 diff 检查通过，明确线上更新仍需部署。
