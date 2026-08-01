# 发布流程打标签并发布版本

打包并发布 Windows 安装包到 GitHub Releases 时，**必须使用** `npm run release:win`
（即 `scripts/publish-release.js`），禁止直接调用
`electron-builder --publish always`。

## 为什么

直接跑 `electron-builder --publish always` 在本项目环境下有两个已知问题：

1. `GH_TOKEN` 环境变量不是持久设置的，`gh` CLI 登录状态和它是两套凭据，容易在
   发布阶段才报 "GitHub Personal Access Token is not set" 中断。
2. electron-builder 会给 `.exe` 和 `.exe.blockmap` 各开一个上传任务，当对应 tag
   的 release 在 GitHub 上还不存在时，两个任务会同时尝试创建 release，产生竞态：
   一个成功、另一个撞上 "tag_name already_exists" 报 422 直接把整个流程判定失败——
   此时可能已经有文件传上去了，导致 release 里只有 1-2 个文件、缺 `latest.yml`
   或主 `.exe`，看起来像"打包上传时不时出问题"。

## 这个脚本做了什么

`scripts/publish-release.js`：

- 从 `gh auth token` 自动取 `GH_TOKEN`，不用手动 export。
- 发布前先用 `gh release create` 建好 release（避免 electron-builder 自己创建
  导致的竞态），标题/说明从 `UPDATE.md` 对应版本号的章节自动提取。
- **使用 `node_modules/electron/dist` 中的本地 electron**，跳过网络下载，
  通过设置 `ELECTRON_SKIP_BINARY_DOWNLOAD=1` 和
  `--config.electronDist=node_modules/electron/dist` 参数实现。
- 跑完 `electron-builder --publish always` 后用 `gh api` 校验三个预期文件
  （`*.exe` / `*.exe.blockmap` / `latest.yml`）是否都处于 `uploaded` 状态，
  没传全会自动重试，最多 3 次。
- 全部齐了才算成功退出；否则抛错并提示手动检查
  `gh release view v<version>`。

## 常规发布步骤

1. 确认 `package.json` 的 `version` 和 `UPDATE.md` 里对应的 `## v<version> 变更`
   小节已经写好。
2. `npm test` 跑一遍确认没有回归。
3. 提交改动，`git tag -a v<version> -m v<version>`（如果脚本没自动打好）。
4. `npm run release:win`，脚本会自动打 tag（如未打）、推送、建 release、打包、
   上传、校验。**脚本会使用本地已安装的 electron，不会重新下载。**
5. 完成后用 `gh release view v<version>` 确认三个文件都在。
