# 发布校验与重试效率

**Status:** Completed

## Goal / Current Behavior

发布流程只完整校验最终安装包一次，在验证通过后才创建和推送标签，上传重试只补传未确认一致的附件。当前 builder 钩子和发布入口重复解包校验，远端对比重复读取本地摘要，失败后整组覆盖上传，构建前即推送标签。

## Ownership / Compatibility

`scripts/publish-release.js` 拥有发布顺序、产物摘要和重试；`scripts/verify-client-installer.js` 继续拥有最终安装器校验；`package.json` 的普通构建钩子保持有效。依据 `docs/reference/engineering/build.md` 与 ROUTE-RESOURCE-INTEGRITY。保留三附件名称、版本/tag 规则、校验失败阻断、上传前后内容检查、凭据脱敏和最多三次上传。

## Non-goals

语法检查并发保持 4；不增加语法缓存、不削减测试、不改签名/更新协议、不执行提交、标签推送或发布。不触碰当前礼物组件等用户修改。

## Proposed Changes / Milestones

- [x] 新增小型发布专用 builder 配置，继承 package build，仅由发布入口接管最终校验；普通 dist 命令继续使用原钩子。测试验证两种入口均保留校验，以及无效安装器阻断上传。
- [x] 拆分标签只读检查与写操作；提前解析凭据，构建/校验和文件一致性通过后再复核 HEAD 与标签并推送。模拟缺凭据、构建失败、校验失败及构建中 HEAD/tag 变化。
- [x] 远端比对复用已验证摘要；失败后仍核对已上传附件，按缺失/不一致集合重试；全部附件已确认一致时允许恢复成功。模拟部分上传、旧附件、远端查询失败及上传中本地产物变化。
- [x] 更新指南和构建事实文档；执行回归与隔离 Windows 构建，检查最终差异和工作区，归档实际结果。

## Verification

`node --test test/engineering/publish-release.test.js test/engineering/packaging-scope.test.js test/engineering/client-installer-integrity.test.js test/engineering/verify-windows-release.test.js`，以及 `npm run verify:quick`。在仓库 `tmp/release-efficiency/` 构建 Windows x64 NSIS（`--publish never`，本地 Electron），随后显式校验真实 EXE；不运行安装器或访问真实 GitHub 发布。最终 `git diff --check`、任务 diff、`git status --short`。

## Failure Handling / Done When

未通过最终资源校验或文件发生变化立即停止，远端无法确认一致不得判成功，绝不覆盖冲突标签。仅撤回本轮修改，不重置仓库或删除用户数据。全部回归、隔离构建与产物校验通过，文档吻合、差异无运行数据后完成；任何未通过门禁如实记录。

## Verification Results — 2026-10-04

- 新回归在原实现下出现 7 项预期失败；修复后四个定向文件共 36 项通过，0 失败/跳过。覆盖部分上传失败、上传响应丢失、远端已有匹配/不匹配附件、API 失败、产物变化、标签顺序与冲突、摘要读取次数和输出脱敏。
- 使用已安装 electron-builder 的真实配置加载器核对：发布配置与普通配置只差最终钩子的 null 覆盖。普通构建的钩子和 `afterSign` 重算仍通过既有回归。
- `npm run verify:quick` 通过：文档 10 项、1,226 个 JavaScript 文件语法检查、架构 22 项。归档和文档最后修订后补跑文档门禁。
- `npx electron-builder --win nsis --x64 --publish never --config scripts/release-builder-config.js --config.electronDist=node_modules/electron/dist --config.directories.output=tmp/release-efficiency/build` 成功生成 Windows x64 NSIS、blockmap、latest.yml。
- 显式调用既有 `verifyInstaller` 检查该实际 EXE，版本 5.0.19、win32/x64、资源范围和摘要通过（1 项 app.asar），实测约 4,045ms。此为本机一次测量，不代表所有机器的节省时间。
- 未执行安装器、Git 写入、真实上传或重新发布；未重跑全套产品测试。本轮使用 `tmp/release-efficiency/` 保存日志和产物，未改用户的礼物组件工作；最终检查任务 diff、`git diff --check` 和状态。
