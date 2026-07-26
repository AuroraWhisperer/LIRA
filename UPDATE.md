# 打包与更新说明

当前版本：`1.1.3`

## v1.1.3 变更

- 点歌板固定显示 6 行，移除“点歌板显示等待数”设置项。
- 修复点歌队列从 6 首增加到 7 首时点歌板高度突然变化的问题。
- 修复滚动队列没有滚动到最底部就返回的问题。
- 新增歌曲时保留当前滚动动画进度，避免点歌板跳回顶部。
- 增加更多字体选项和点歌板主题预设，并将默认队列滚动速度调整为 80。

## v1.1.2 变更

- 管理端点歌队列中，第 1 位未置顶歌曲不再显示“置顶”按钮；如果第 1 位已经置顶，仍显示“取消置顶”。

## 本机打包

```powershell
npm.cmd install
npm.cmd run dist:win
```

生成文件在 `release/`：

```text
bilibili-live-song-plugin-setup-1.1.3.exe
bilibili-live-song-plugin-setup-1.1.3.exe.blockmap
latest.yml
```

## 发布 GitHub 自动更新

GitHub 自动更新依赖 Releases。发布新版本时，先修改 `package.json` 里的 `version`，再运行：

```powershell
npm.cmd run release:win
```

如果手动上传 Release，必须把安装包、同名 `.blockmap` 和 `latest.yml` 一起上传到 `AuroraWhisperer/Request-song` 的同一个 Release。

桌面版“桌面更新”页会读取 `latest.yml`，发现新版本后优先通过 `.blockmap` 差分下载变化部分，并提示应用更新。
