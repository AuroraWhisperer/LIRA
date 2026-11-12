# 2026-11-11 旧代码与维护入口清理

Status: Completed

用户在完整审计后要求直接修改，并将清理材料留在 `tmp/` 由其删除。

## 目标与当前证据

修复审计确认失效的截图/本地构建入口、退出无生产消费者的旧 helper 与内部兼容层、补齐语法检查覆盖并修复构建依赖审计项。审计和证据见 `output/legacy-code-audit-2026-11-11.md`、`tmp/legacy-audit-2026-11-11/`。不以“旧”或文件体积直接判定废弃。

## 范围、所有者与兼容边界

- Electron 登录策略、完整性和运行时桥：删除未使用策略/helper，运行时桥仅接受实际 runtime 或 `createServerRuntime` 工厂；维护 desktop 参考和云同步测试。
- Server WebSocket/lifecycle：测试改用实例 hub；退出模块级单例和已不用的自动换端口 helper；保留 CLI 的 `compatibility-runtime`、正常实例启停、HTTP/WS 鉴权和精确端口绑定。
- Bilibili gift/mention 与 settings migrations：仅删除旧 DTO/formatter/重复版本读取 helper，保持当前事件、回复字段、迁移和持久化格式。
- 维护工具：修复当前页面截图选择器，移除退役任务；bat 委托现有 npm 入口；JS/CJS/MJS 与 tools 纳入语法检查。同步工具 README、build/test 参考和相关现有测试。
- 构建依赖和资源：依据上游修复与实际 matcher 兼容证据处理 minimatch；旧诊断源码和历史截图保留研究用途，从安装包排除；修正诊断页授权说明。

不调整正常产品页面、公共 HTTP/WS/IPC 协议、数据库和设置键、登录/更新/安全边界；不删除真实用户数据、已发布资源兼容、独立交付物 `output/`、制作素材 `archive/` 或其他任务的临时目录。不提交、发布或自动清理依赖目录。

## 分工与里程碑

1. 死 helper 与旧 gift/mention API → 现用登录、设置、礼物特效和发送器测试通过。
2. 内部 runtime/WS/lifecycle 旧适配 → 云同步、传输授权/广播、实例生命周期测试通过，引用与参考一致。
3. 工具修复 → 现有 checker 测试、截图隔离 fixture 和 npm 转发核对通过。
4. 依赖/打包 → 安全版本和实际 builder matcher 检查、packaging-scope 通过；依赖审计无未解释项。
5. 收尾 → 文档、架构、语法、固定服务器契约检查；核对本任务增量并编写清理清单和结果。

## 验证与同步

各子任务使用已有 `node --test` 聚焦套件，确需前端模块时加 `--experimental-vm-modules`。修改期间不运行全套测试。所有编辑完成后运行 `npm run verify:quick`、`node scripts/verify-server-contract.js --runtime tmp/v6.1.5-server-contract`、相关构建/打包测试和 `npm audit --json`。不改变契约锁来迁就相邻工作树。最终 `git diff --check`、`git status --short`，核对 staging 未变与备份相对差异。

普通用户指南不因内部 helper 清理新增步骤；截图工具说明、现行接口参考、构建和测试参考按实际变化同步。历史审计报告保留原证据，完成情况另记。

## 回退和材料保留

开始前的维护文本逐字副本、摘要、Git 状态和 staging 补丁已保存在 `tmp/legacy-cleanup-2026-11-11/before/` 及同目录清单。独立移出文件放在 `removed/` 并记录原路径；代码片段由修改前副本和本任务差异保留。出现问题只逆转本任务差异，不能用 HEAD 覆盖此前用户修改。现有 `tmp/` 资料不作自动删除。

## 完成条件

- 已确认问题均有实现与适当验证；必要保留项有具体消费者/兼容理由。
- 测试、当前技术文档与工具说明一致，未以删除有效断言获得通过。
- 清理材料及恢复映射可由用户检查和删除；原有修改和交付物完整。
- 本任务最后差异审阅完成，未混入生成物、运行数据或秘密。

## 执行记录

- 2026-11-11：建立 2,894 个维护文本文件的修改前快照（约 25.3 MiB），开始并行修复。
- 旧 helper 相关 78 项、内部适配层相关 162 项、checker 7 项通过；截图与批处理成功/失败路径实测通过。
- minimatch 首次按父包 override 会传播到 glob/dir-compare 的旧 callable API，ASAR 测试发现失败；已改为受影响版本区间 override，旧 3.x/5.x 保留，packaging-scope 15/15 与安装器验证 11/11 通过。锁文件审计 0 项；一次普通 audit 遇 registry bulk/旧 quick endpoint 错误，未当作成功。
- 隔离 Windows 目录构建完成，输出在 `tmp/legacy-cleanup-2026-11-11/build-validation/`；未签名、未生成安装器或发布。3200 条真实打包 matcher 输入仅有预期的 6 个分发排除变化。
- 固定服务端提交的 10 份契约 fixture 通过。首次 quick 的文档检查发现本计划状态标签格式错误，已按既有 `Status:` 合同修正；继续执行统一门禁。
- 最终 `verify:quick` 通过：文档 10/10、架构 29/29，语法 1,872 文件（执行 7，复用 1,865）。普通 audit 重试与锁文件 audit 均为 0；安装树版本和运行依赖核对正常。
- 实际构建 ASAR 中 1,956 个源码/资源与当前工作树逐字一致，6 项退出分发、23 个生产依赖与完整性校验通过。聚焦自动化合计 273 项通过，独立交叉复核无遗漏调用/行为覆盖问题。
- 33 个实际修改文件的 before/after 摘要和恢复映射、各组差异、截图、日志及临时构建集中保存在 `tmp/legacy-cleanup-2026-11-11/`。暂存内容与开始前相同。没有整文件永久删除；用户可自行删除该材料目录。
- 完成报告为 `output/legacy-code-cleanup-2026-11-11.md`。代码、测试、工具和参考已同步，普通用户指南因操作未变保留。未执行全套业务测试、真实账号登录、正式安装器/升级、签名或发布。
