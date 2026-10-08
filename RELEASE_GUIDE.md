# 发布指南

在仓库根目录使用 Windows PowerShell；需要 Node.js 24+、已安装的项目依赖、Git 和 GitHub CLI。下文 `X.Y.Z` 替换为待发布版本，每条命令成功后再继续。

## 1. 更新版本与变更说明

同步更新 `package.json` 和 `package-lock.json`，暂不创建提交或标签：

```powershell
npm version X.Y.Z --no-git-tag-version
```

更新 [UPDATE.md](UPDATE.md) 顶部的当前版本，并新增 `## vX.Y.Z 变更` 小节。以上一个已发布版本为基线，写清本次新增、优化和修复；提交说明复用这份摘要，Release 正文由脚本自动读取该小节。

## 2. 验证、提交、推送

先按[本地发布验证](docs/reference/engineering/build.md#本地发布验证)准备环境：优先复用已有的锁定服务器检出与本机 NSIS 缓存；需要指定服务器检出时设置 `LIRA_SERVER_ROOT`，不要切换正在开发的服务器工作区。

运行一次统一验证；它依次执行契约输入校验、语法检查和全量 `npm test`。不要另跑 `verify:quick`、`check` 或 `npm test` 重复覆盖。保留实时输出；需要日志时同步保存，避免完全重定向后反复读取日志。

```powershell
npm run verify
```

失败时先处理失败项，暂不提交和发布：

- 使用 `npm test -- --file=实际失败文件` 定向复现；需要定位单个用例时追加 `--test-name-pattern`。收齐本轮失败并集中修复，不在每个单项通过后重跑全量。
- 单独复测通过但完整运行失败时，先检查并发、异步就绪条件和环境占用；仅在验证具体假设时限次复测，不默认连跑多遍或降低整套测试的并发。
- 有明确修复或经定向验证的环境调整后，再跑一次统一验证。若仍失败，依据新的失败证据继续定位；不要原样重复全量直到碰巧通过。

通过后暂存本次发布文件，再提交并推送（替换版本号和摘要）。发布脚本要求工作区没有未提交或未跟踪文件。

```powershell
git commit -m "vX.Y.Z" -m "本次主要变更摘要"
git push
```

## 3. 发布

```powershell
npm run release:win
```

脚本先检查凭据与版本标签冲突，在构建和一次完整安装包验证通过后创建并推送版本标签，再创建或复用 Release，只上传缺失或内容不一致的附件。输出 `All expected assets uploaded` 且正常退出即完成，无需再人工检查附件完整性。实现细节见[构建与发布参考](docs/reference/engineering/build.md#7-发布流程scriptspublish-releasejs)。

## 失败处理与可选设置

- **未登录 GitHub**：执行 `gh auth login` 后重跑。
- **上传失败**：单次运行最多尝试上传三次，期间不重新构建；每轮核对远端附件，只补传缺失或内容不一致的文件。仍失败时，排除网络或权限问题，在同一提交、同一版本下重跑 `npm run release:win`；重跑会重新构建并按新产物摘要决定补传范围，已有 Release 的正文不会自动更新。
- **标签与当前提交不一致**：构建或安装包验证失败不会创建新标签；标签在这些步骤通过后推送，后续上传失败时可能已存在。已有标签若对应另一提交，使用新版本号发布，不覆盖既有远端标签。
- **指定代理**：脚本会自动探测常用本机代理；需要手动指定时，在当前 PowerShell 会话设置 `$env:HTTPS_PROXY = 'http://127.0.0.1:7890'` 后重跑。
- **关闭代理自动探测**：设置 `$env:RELEASE_NO_PROXY = '1'`。已有 `HTTPS_PROXY` / `HTTP_PROXY` 环境变量仍优先，不等于强制直连；需要直连时还应清除这些变量。

## Claude Code 专用备注

仅使用 Claude Code 时，提交前确认 `.claude/settings.json` 包含 `"attribution": { "commit": "", "pr": "" }`，并在推送前检查：

```powershell
if (git log -1 --format=%B | Select-String -Quiet -Pattern '(?i)^Co-Authored-By:.*Claude') {
  throw 'Latest commit contains a Claude Co-Authored-By trailer.'
}
```
