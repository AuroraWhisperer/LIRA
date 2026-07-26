# 打包与更新说明

当前版本：`1.1.0`

## 本机打包

```powershell
npm.cmd install
npm.cmd run dist:win
```

生成文件在 `release/`：

```text
bilibili-live-song-plugin-setup-1.1.0.exe
bilibili-live-song-plugin-setup-1.1.0.exe.blockmap
latest.yml
```

## 发布 GitHub 自动更新

GitHub 自动更新依赖 Releases。发布新版本时，先修改 `package.json` 里的 `version`，再运行：

```powershell
npm.cmd run release:win
```

如果手动上传 Release，必须把安装包、同名 `.blockmap` 和 `latest.yml` 一起上传到 `AuroraWhisperer/Request-song` 的同一个 Release。

桌面版“桌面更新”页会读取 `latest.yml`，发现新版本后优先通过 `.blockmap` 差分下载变化部分，并提示应用更新。
