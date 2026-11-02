# CDN 公共资源分发

客户端字体与超过 10 MiB 的公共图片通过 CDN 下载到本机缓存，不随安装包分发。首次授权后与礼物准备并行；每次启动只检查一次更新清单。缺失或变化的文件才下载并显示进度，无变化时保持安静；网络失败不会清空已有资源。客户端和直播画面继续读取本地 HTTP 资源，正常显示不反复访问 CDN。

## 导出与上传

在仓库根目录执行：

```powershell
npm run export:resources
```

脚本从 `public/fonts/` 选择 WOFF2、TTF、OTF，从 `public/img/` 选择超过 10 MiB 的图片，更新 `src/resources/catalog.json`，并生成：

| 产物 | 用途 |
| --- | --- |
| `tmp/cdn-resources/lira-cdn-resources.zip` | 可交付的资源 ZIP；先解压，不作为应用内样式包导入 |
| `tmp/cdn-resources/upload/resources/fonts/` | 按字体名称命名的 ZIP 下载包 |
| `tmp/cdn-resources/upload/resources/images/` | 按用途命名的独立图片 |
| `tmp/cdn-resources/upload/resources/manifest.json` | 原文件和下载包的大小、SHA-256 与对应关系 |

首次上传时，把 `upload/` 里的整个 `resources` 文件夹拖到多吉云 `lirahub` 空间根目录，保持目录结构即可。当前共 18 个文件：13 个字体包、4 张图片、1 个更新清单。导出脚本会重建自己的 `upload/` 暂存目录，移除上一轮导出的旧文件；源码资源和应用内字体许可不受影响。

共享字体库共 13 项，按实际字体名称各自生成一个下载包。原有九款字体之外，Nunito 的两个字重合成一包；原歌词补字文件按 Noto Sans（20 个语种分支文件）、Gowun Dodum（韩文）和 Noto Serif Tibetan（藏文）归组为三个包。这些字体可供各组件选择，歌词继续自动调用同一字库补字。时钟和大航海标题的两个 Noto Serif SC 裁剪字库合计仅 6,524 字节，随安装包提供，不进入 CDN 或通用字体菜单。客户端自动下载、校验并解包，内部仍保留原始文件和字符覆盖，使用者无需手动解压字体包。

文件名包含可读名称和 12 位内容摘要，例如 `霞鹜文楷-dfcd2d813f19.zip`、`世界地图-8K-aaddcd967a9f.png`。末尾是自动生成的版本标记；只在内容变化时改变，上传时保留完整名称。更新清单由软件读取，使用者无需打开或手工填写。

默认清单地址：

```text
https://assets.lirahub.cn/resources/manifest.json
```

为这一指定文件配置不缓存规则，并让它优先于全部文件规则；字体包和图片可长缓存。保持自适应 WebP 关闭，以免下载图片被转换成另一种内容。保留 HTTPS，域名防盗链及 URL 鉴权不需要为公共客户端资源开启。

## 后续更新

1. 修改仓库内相同逻辑路径的字体或图片，然后再次执行导出命令。
2. 上传新增或变化的字体包、图片，保留旧版本，以便仍在使用旧清单的客户端继续下载。
3. 最后替换远程 manifest.json。客户端下次启动比较原文件摘要，只下载包含缺失或变化文件的字体包或图片，其余包不重复下载。
4. 新增或移除逻辑路径需要同步新的客户端目录及打包规则；旧客户端忽略新增路径，不能从清单下载未随自身目录批准的资源。发布清单应保留仍受支持旧客户端需要的逻辑路径。

字体族、字重、分片范围和新增功能仍由客户端代码定义。资源清单不承载脚本或插件，也不替代客户端版本更新。

## 本机使用与故障恢复

下载任务由主进程管理，两路并发，每秒最多启动 8 次请求，兼容当前 CDN 的每 IP 每秒 10 次配置。字体和大图共享一条进度 toast，按收到的下载字节显示进度，完成数按字体包或图片计算；礼物图片使用原有独立任务。详情在「百宝箱 → 桌面更新」的正在下载区域。检查和零下载结果不提示。

先写入应用数据目录 `cache/resources/` 的独占临时文件，校验完整大小和 SHA-256；字体包还会检查条目清单及每个需要补齐文件的大小和摘要，再恢复原文件缓存并发布索引。解包只写入客户端批准的资源，拒绝意外条目和路径穿越，临时 ZIP 使用后删除。已有字体、图片继续使用，失败可点击 toast 的重试，或下次启动再检查。首次补齐需要联网，尚未下载的资源不会因安装包而离线存在。

自有部署可在启动环境使用 `LIRA_RESOURCE_CDN_BASE` 覆盖 CDN 根 origin，只允许 HTTPS DNS 域名根地址。该配置由可信启动环境设置，不向 renderer 开放任意下载地址。存储、HTTP 和 IPC 字段分别见[存储](../reference/backend/storage.md#公共资源缓存)、[资源接口](../reference/backend/api.md#共享字体资源)、[桌面桥](../reference/desktop/preload.md)。

## 客户端安装包与自动更新

安装包放在同一空间的 `downloads/` 下，与 `resources/` 平级：

```text
lirahub/
├─ downloads/
│  ├─ lira-setup.exe
│  └─ latest.yml
└─ resources/
   ├─ fonts/
   ├─ images/
   └─ manifest.json
```

手动下载地址为 `https://assets.lirahub.cn/downloads/lira-setup.exe`。客户端自动更新先读取 `https://assets.lirahub.cn/downloads/latest.yml`，比较版本号，再下载清单声明的同一安装包并校验 SHA-512。只有 EXE、没有 `latest.yml` 时，手动下载可用，自动版本检查会报「更新清单暂不可用」。

每次正常构建仍生成 `release/lira-setup-X.Y.Z.exe`、`release/lira-setup-X.Y.Z.exe.blockmap` 和 `release/latest.yml`，GitHub 按原文件名发布，清单引用带版本号的安装包。发布流程与 v5.7.4 相同；发布任务在 GitHub 附件上传成功后结束，多吉云由维护者自行手动同步。

上传多吉云时，维护者自行把同次构建的安装包副本重命名为 `lira-setup.exe`；同时在 `latest.yml` 的上传副本中，将 `files[].url` 和 `path` 对应的安装包文件名改为 `lira-setup.exe`，保留 `version`、`sha512`、`size` 等原有值。GitHub 使用的原文件和原清单保持带版本号。先上传安装包，最后上传匹配的清单副本；整包下载不依赖 blockmap，无需将它上传 CDN。不能只给旧 EXE 改文件名就宣称为新版本。

为 `/downloads/latest.yml` 和 `/downloads/lira-setup.exe` 两个固定路径配置不缓存规则，优先于全部文件规则；更换后刷新已有 CDN 缓存。不要混用不同构建的 EXE 和清单，否则摘要校验会阻止安装。字体和图片使用内容版本文件名，仍可长缓存。

更新地址修改随下一次客户端构建生效。已经安装或上传的旧 EXE 保留其原来的更新配置；若要切换这些客户端，应先安装包含 CDN feed 配置的新客户端。构建和发布要求见[发布指南](../../RELEASE_GUIDE.md)与[构建参考](../reference/engineering/build.md)。
