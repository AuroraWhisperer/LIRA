# 客户端更新提速 Implementation Plan

## 状态与目标

**Status:** Awaiting Verification

普通同目录升级原地保留数据，避免全量复制；更新器优先增量下载，失败继续使用整包。用户已授权实施；在当前工作区逐项执行，不提交或发布。

## 当前行为与边界

- `build/installer-data.nsh` 无条件复制完整 data；现有卸载器升级时已保留 data/logs/updates，但 builder 实际执行磁盘上的旧卸载器。
- `src/electron/update-manager.js` 禁用了 electron-updater 的增量能力。CDN 指南目前只要求上传 EXE 与 latest.yml。
- 不改变数据位置、数据库结构、退出与音频恢复顺序、授权、安装模式或用户删除数据的确认。无需新增依赖或更新框架。
- 未知旧版第一次升级仍需备份；本次安装成功后记录能力，后续同目录升级才可跳过。下载策略随新客户端生效。

## 归属与方案

### 安装数据

- 在安装根目录写入 `uninstall-data-preservation.ini`，记录实际新卸载器的 SHA-256。记录属于安装程序，正常卸载/程序替换时一并清理，不放进 data。
- 安装 section 在切换 AppData 上下文前读取 builder 当前安装上下文的 UninstallString。只有它规范化后等于当前安装内的卸载器，且同目录、原 data 存在、能力摘要匹配、没有旧版捆绑音频时才走快路径。all-users 若还存在第二个 current-user 卸载项，保守回退。
- 已发布备份冲突检查先于快路径。未知、替换过的卸载器、不同目录、旧 AppData、遗留音频继续原有完整备份/恢复；不通过试运行未知卸载器探测能力。
- 成功路径仅将 `liraDataBackup` 清空并返回，复用已有恢复函数的空备份短路。标记写入失败只影响下次提速，不削弱数据保护。

### 下载

- 将 `disableDifferentialDownload` 设为 false。generic provider 使用单 Range 请求，避免假设 CDN 支持 multipart ranges；复用原框架的整包回退和 SHA-512 校验。
- 本地旧安装包继续保存在 updates/lira-updater。CDN 同步 EXE、同次构建的 blockmap，最后更新 latest.yml；支持中的旧 blockmap 保留。
- 使用真实 NsisUpdater 和本地 HTTP 夹具验证请求字节、缓存复用、块图缺失/Range 失败回退、摘要错误与离线失败，不连接生产服务做自动化测试。

## 实施与验证

- [x] 扩展 `test/engineering/installer-migration.test.js`：同目录能力匹配零复制、卸载器被替换/注册路径不匹配回退、能力存在时仍保护换目录/备份冲突/遗留音频。复用原生 NSIS 工具与隔离目录。
- [x] 修改 `build/installer.nsh` 与 `build/installer-data.nsh`，通过上述回归及 `npm run test:installer`，检查未跳过原生安装器用例。
- [x] 更新更新器配置及其现有测试，增加聚焦下载集成覆盖；不新增源文本或默认值快照断言。
- [x] 同步 `docs/reference/engineering/build.md`、`docs/reference/desktop/main.md`、`docs/reference/desktop/update.md`、`docs/guides/cdn-resources.md`、ADR-0015/0016 和测试入口说明。应用内更新指南、README 与交互引导的入口及操作步骤未变，不改这些内容。
- [x] 运行 `npm run verify:quick`、直接受影响的更新/退出测试。安装脚本变更使用临时输出构建 NSIS 安装包并通过既有资源验证；不运行用户已安装程序。
- [x] 检查最终 diff、`git diff --check` 和 `git status --short`，记录实际验证结果与发布前提。

## 本地验证记录（2026-11-06）

- `npm run test:installer`：78 项通过、0 跳过，包括真实 NSIS 数据保护、关闭、卸载与更新进度。
- `node --test test/desktop/update-manager.test.js`：15 项通过。模拟 262144 字节安装包实际传输变化部分 131072 字节；离线复用、整包回退、坏摘要拒绝均通过，该比例只代表夹具，不是正式版本的压缩比。
- 直接相关的 desktop-update-controller、electron-shutdown、installer-static、installer-tools、packaging-scope、publish-release、verify-windows-release 共 88 项回归；首次只有 packaging-scope 将 provider 整个对象固定为旧配置而失败，已改为继续核对其 provider/URL 契约，新增单 Range 行为由真实下载测试覆盖。修正后 packaging-scope 15 项全部通过，其余既有通过结果未重复运行。
- `npm run verify:quick`：文档 10 项、1714 个 JS 文件语法、架构 28 项通过。初次发现本计划状态标签格式不符合门禁，已修正后通过。
- `electron-builder --win nsis --x64 --publish never --config.directories.output=tmp/efficient-update-build --config.electronDist=node_modules/electron/dist`：成功；已执行最终安装器资源/生产依赖验证，生成配置确认 `useMultipleRangeRequest: false`。构建产物仅在 tmp，无版本调整或发布。
- 只读探测线上 6.0.0：EXE `Range: bytes=0-0` 返回 206、正确 Content-Range 与 1 字节；同版 blockmap HEAD 返回 404。已同步维护者上传要求。

## 发布验收剩余项

- [ ] 在实际下一次发布时，同步新版本 EXE、原始 blockmap 和同次构建的 latest.yml。旧 blockmap 只补继续支持差分优化的版本；缺失时已有整包回退，不将补齐所有历史块图作为正确性阻塞。
- [ ] 用已发布旧客户端完成真实升级，再验证安装了能力标记的新客户端下一次升级走快路径；测量正式相邻版本的下载量与安装耗时。本次未操作真实用户安装或发布包。

### 2026-11-11 必要性与交付复核

公开 CDN 当前 feed 返回 200、`no-store`，版本为 6.1.2；对应 blockmap 返回 200，安装包两字节 Range 返回 206 和正确的 MZ 头。6.0.0、6.2.0、6.2.1 的 blockmap 返回 404；后两者不在当前线上 feed 中，不能由本地构建版本推断已同步 CDN。此结果为当日只读观察，不是发布操作。

本地 `release/latest.yml` 为 6.2.1，EXE 126,050,252 字节；SHA-512 与清单的两处摘要一致，blockmap 解压后覆盖的大小与 EXE 一致。已具备匹配的本地产物，但没有上传、运行安装器或宣布线上升级完成。

`node --test test/desktop/update-manager.test.js test/desktop/cdn-resource-library.test.js` 30/30 通过。真实 NsisUpdater 的隔离 HTTP 夹具覆盖差分、冷缓存、缺块图、Range 拒绝、坏摘要和离线；差分夹具传输 131,072 / 262,144 字节。资源 owner 覆盖冷/暖缓存、离线、损坏修复与原子替换。这些已有本地行为不再重复列为未实现，真实安装/数据保留仍在发布条件中。

## 失败处理与完成条件

能力或路径无法确认时完整备份；备份/恢复失败继续停止并保留原有报告；差分失败由原更新器回退整包，校验失败禁止安装。仅撤回本任务修改，不重置工作区。

实现、聚焦原生/下载验证、构建与文档检查通过后完成本地任务。生产 CDN blockmap 上传和真实旧版客户端升级属于发布验收，应记录为尚未执行，不能宣称已经上线。
