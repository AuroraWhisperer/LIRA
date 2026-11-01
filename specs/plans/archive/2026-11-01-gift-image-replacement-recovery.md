# 礼物图片原子替换恢复

Status: Completed

## Goal And Evidence

发布 v5.7.4 前修复已知 Windows 图片修复失败：历史完整验证及八进程 16,000 次独立序列已自然复现 `renameSync` 的 `EPERM`，导致损坏图片不能替换、目录 revision 不变。原证据保留于 `tmp/test-scope-reduction-2026-11-01/`，不把后续单轮通过当作已解决。

## Ownership And Constraints

- 写入 owner 为 `src/bilibili/gift/remote-gift-image-cache.js` 的 `writeAtomic`；同一函数写图片和最近成功图片索引。
- 沿用 `src/storage/component-style-index.js` 已有的同步、有界 `EPERM` / `EBUSY` 重试模式，只重试同一个已写好的临时文件，不重放下载或索引事务。
- 保留目的文件与同目录原子替换；持续失败或其他错误仍按原调用边界返回失败，清理自有临时文件。最多四次重试，等待 50/100/150/200 ms。
- 公开接口、数据格式、授权和用户操作不变；不改服务器、用户安装或无关缓存。保留当前未提交改动。
- 回归由 `test/gifts/remote-gift-image-cache.test.js` 承接，技术参考 owner 为 `docs/reference/backend/overtime.md`。用户指南无新入口或步骤，无需修改。

## Milestones And Verification

- [x] 在原实现上用实际 Windows 文件占用复现修复失败；补充短暂替换失败和索引持续失败的行为回归，确认修复前失败。
- [x] 在原写入函数加入有界重试，同步参考；运行 `npm test -- --file=test/gifts/remote-gift-image-cache.test.js --file=test/gifts/hybrid-gift-catalog.test.js --file=test/gifts/gift-catalog-initializer.test.js`。
- [x] 重跑实际占用场景及八进程损坏图片修复序列，明确记录自然错误、重试与结果；所有进程使用根 tmp 下独立目录并自行清理。
- [x] 完成版本说明和其他已知发布失败纠正后，仅运行一次 `npm run verify` 最终验收；如有失败，按 RELEASE_GUIDE 定向处理再验收。

## Failure Handling And Done When

不删除目的文件、不跳过断言或重试整套测试。若重试仍失败，保留证据并停止发布，继续定向诊断。只回退本任务增量，不重置工作区。受控失败在修复前可复现、修复后恢复且永久失败保留旧文件，相关测试与完整发布门禁通过后归档，记录剩余实播限制。

## Focused Evidence

原实现的两条新增回归均失败。实际 Windows FileStream 拒绝删除共享时，原实现第一次 rename 报 `EPERM` 并返回空图片；修复后同一 140 ms 占用产生两次真实 `EPERM`，第三次替换成功，图片字节正确。注入持续索引锁定时五次尝试后返回原错误，旧索引、已有图片保留，临时文件清理。

图片 owner、目录消费者、初始化及独立来源四文件 25/25 通过。八进程共 16,000 次独立损坏/修复序列全部通过，进程退出码均为 0，用时 53,488 ms。临时探针和日志位于 `tmp/release-5.7.4/`，不覆盖原始诊断。

同步了独立来源测试的旧断线清屏预期；实际 Chromium 验证断线后保留已有消息。安装器历史失败由 PATH 选错 GNU tar 触发，本次使用 Windows System32 tar，所属资源校验三项全部通过；未修改安装器实现。最终统一门禁使用 SHA-256 已核验的官方 Node 24.22.2、独立 `npm ci` 依赖、锁定服务器检出及本机 NSIS 缓存。

## Final Verification

`npm run verify` 一次退出 0：固定服务器提交的 10 份 fixture、1,663 个 JavaScript 文件语法和完整 640 个测试文件通过。独立原生批次 5 项、主批次 4,861 项，合计 4,866 项，0 失败、0 跳过、0 取消；实际执行 NSIS 安装、迁移和卸载场景。日志为 `tmp/release-5.7.4/verify.log`，结构化结果为 `tmp/test-results/run-I2mMBy/results.json`。统一验证前后完整差异字节和待发布路径一致。

测试、所属技术参考与 v5.7.4 更新说明已同步。用户入口和操作未变，使用指南无需修改；真实直播环境长期运行仍由更新后的现场结果确认。该修复已完成代码与发布门禁验收，后续提交、构建和上传按 `RELEASE_GUIDE.md` 执行。
