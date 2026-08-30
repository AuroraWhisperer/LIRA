# 发布指南

## 快速发布

就三步：

```
# 1. 改版本号
编辑 package.json → version
编辑 UPDATE.md   → 新增 ## vX.Y.Z 变更 小节
对比总结上一版更新了什么，用于提交github和release的时候说明并且写进去

# 2. 验证 + 提交
Claude Code 默认会给提交添加署名。提交前确认 `.claude/settings.json` 含有：
`"attribution": { "commit": "", "pr": "" }`
npm test
git add . && git commit -m "vX.Y.Z"

# 推送前检查；命中 Claude Co-Authored-By 时会中止
if (git log -1 --format=%B | Select-String -Quiet -Pattern '(?i)^Co-Authored-By:.*Claude') {
  throw 'Latest commit contains a Claude Co-Authored-By trailer.'
}
git push

# 3. 一键发布
npm run release:win
```

脚本自动完成：打 tag → 推送 tag → 创建 GitHub Release → 打包上传 → 校验文件完整性。
发布完成后看一眼 `gh release view vX.Y.Z` 确认三个文件（`.exe` / `.exe.blockmap` / `latest.yml`）都在。

---

## 文件说明

| 文件           | 发布前要改什么                             |
| -------------- | ------------------------------------------ |
| `package.json` | `version` 字段改成新版本号                 |
| `UPDATE.md`    | 新增 `## vX.Y.Z 变更` 小节，写本次变更内容 |

---

## 脚本做了什么（`npm run release:win`）

1. **自动打 tag** — 如果本地没有 `v<version>` tag，自动 `git tag -a` 创建并 push
2. **自动取 GH_TOKEN** — 从 `gh auth token` 获取，不需要手动 export
3. **先建 release 再上传** — 用 `gh release create` 建好空 release，避免 electron-builder 并发创建时的 422 竞态
4. **本地 electron 构建** — 使用 `node_modules/electron/dist`，跳过网络下载
5. **完整性校验** — 上传后检查 `.exe` / `.exe.blockmap` / `latest.yml` 是否全部 `uploaded`，缺文件自动重试（最多 3 次）

## 常见问题

**Q: 发布时说 "GH_TOKEN is not set"？**
跑一次 `gh auth login` 登录 GitHub CLI。

**Q: Release 里缺文件？**
脚本会自动重试 3 次。如果 3 次后还是不完整，手动 `gh release view vX.Y.Z` 检查，然后重新跑 `npm run release:win`（release 已存在时会补充上传缺失文件）。

**Q: 上传太慢，要好几分钟？**
脚本会自动检测本机代理（127.0.0.1 的 7890 / 10809 / 1080 端口，Clash / v2rayN 常见端口），检测到就把 GitHub 上传流量走代理——日志里会显示 `Auto-detected local proxy …` 或 `Using proxy from environment: …`，直连状态从几百 KB/s 提到代理带宽上限。

- 手动指定代理：`HTTPS_PROXY=http://127.0.0.1:7890 npm run release:win`
- 强制直连（禁用自动检测）：`RELEASE_NO_PROXY=1 npm run release:win`
- 安装包体积方面：`electronLanguages` 只保留 `zh-CN` / `en-US` 两个语言包（原来 55 个语言约 47MB），安装包已明显变小。

**Q: 为什么要用这个脚本而不是直接跑 electron-builder？**
两个原因：

1. `GH_TOKEN` 不是持久环境变量，electron-builder 直接跑可能找不到
2. electron-builder 并发上传 `.exe` 和 `.exe.blockmap` 时，如果 release 还不存在，两个任务同时创建 release 会产生竞态 — 一个成功一个 422 报错，导致 release 里缺文件
