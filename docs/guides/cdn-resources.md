# CDN 公共资源分发

共享字体和已声明的公共图片通过 CDN 下载到本机缓存，不打进客户端安装包。首次登录授权后会与礼物资源同步拉取，之后每次启动只核对一次清单：只下载缺失或有变动的文件并显示进度，无更新则静默跳过；断网或失败也不会清掉本地已有资源。运行时客户端和直播画面都直接读取本地服务，不会反复请求 CDN。

## 导出与上传

在仓库根目录执行：

```powershell
npm run export:resources
```

脚本从 `src/fonts/catalog.json` 读取完整共享字库，从 `src/resources/resource-packages.js` 读取已声明的共享图片与旧客户端兼容图片，更新 `src/resources/catalog.json`，并生成：

| 产物 | 用途 |
| --- | --- |
| `tmp/cdn-resources/lira-cdn-resources.zip` | 可交付的资源 ZIP；先解压，不作为应用内样式包导入 |
| `tmp/cdn-resources/upload/client/resources/fonts/` | 按字体名称命名的 ZIP 下载包 |
| `tmp/cdn-resources/upload/client/resources/images/` | 按用途命名的独立图片 |
| `tmp/cdn-resources/upload/client/resources/manifest.json` | 原文件和下载包的大小、SHA-256 与对应关系 |

首次上传时，把 `upload/` 里的整个 `client` 文件夹拖到多吉云 `lirahub` 空间根目录，保持目录结构即可。当前导出有 24 个文件：19 个字体包、4 张图片、1 个更新清单；新客户端启动只补齐 19 个字体包和世界地图。三张航海旗帜图片及其清单条目保留给已发布的客户端，新客户端从导入样式 ZIP 读取动画，缺少这份公共缓存不会报错，已有缓存 URL 仍可读取。导出脚本会重建自己的 `upload/` 暂存目录，移除上一轮导出的旧文件；源码资源和应用内字体许可不受影响。

共享字体库共 19 项，按实际字体名称各自生成一个下载包。原有九款字体之外，Nunito 的两个字重合成一包；原歌词补字文件按 Noto Sans（20 个语种分支文件）、Gowun Dodum（韩文）和 Noto Serif Tibetan（藏文）归组为三个包。思源宋体、Poppins（400/700）、Quicksand（300–700 可变字体）、Montserrat（300/400/700）、Cinzel（Latin 700）和 M PLUS Rounded 1c（800）也各自归组为一个包，既保留对应弹幕的默认字形，也供所有组件选择；这六包共增加约 17.82 MiB 首次下载，后续复用缓存。Montserrat 的两款样式共用同一个包，原文件覆盖与本地 URL 保留。歌词继续自动调用原有多语言字库补字。时钟和大航海标题的两个 Noto Serif SC 裁剪字库合计仅 6,524 字节，随安装包提供，不进入 CDN 或通用字体菜单。客户端自动下载、校验并解包，内部仍保留原始文件和字符覆盖，使用者无需手动解压字体包。

文件名包含可读名称和 12 位内容摘要，例如 `霞鹜文楷-dfcd2d813f19.zip`、`世界地图-8K-aaddcd967a9f.png`。末尾是自动生成的版本标记；只在内容变化时改变，上传时保留完整名称。更新清单由软件读取，使用者无需打开或手工填写。

默认清单地址：

```text
https://assets.lirahub.cn/client/resources/manifest.json
```

请在 CDN 上单独为 `manifest.json` 配置「不缓存」规则，且优先级高于全局缓存规则；带摘要的字体包和图片可以长期缓存。务必关闭「自适应 WebP」，防止图片内容被转换导致校验失败。保持 HTTPS，公共资源无需开启防盗链或 URL 鉴权。

## 资源准入与防回归

资源必须先明确使用方和交付方式，不能因为文件大或放在素材目录就顺手纳入公共下载。共享字体取自字体目录的完整分片（具体分组见上文，完整文件退出安装包，OFL 许可保留）；公共图片须登记在 `resource-packages.js` 的 `SHARED_IMAGE_NAMES` 中；由 `COMPONENT_RESOURCE_PRESETS` 声明的外置样式图片随样式 ZIP 分发，不再进入新客户端的启动预下载。

图片改为随样式包外置后，请将旧客户端仍在依赖的条目移入 `LEGACY_IMAGE_NAMES`，保留原文件名、摘要、清单记录和线上文件，同时移出新客户端的启动下载与缺失统计——切勿直接从线上删掉旧客户端还要用的资源。新增共享资源时，源文件必须完整存在，缺失时导出脚本会直接报错，避免悄悄输出不完整的清单。

导出结果的 `startupDownloads`、`startupDownloadBytes` 是当前客户端首次下载的包数与字节；`compatibilityDownloadBytes` 是仅供旧客户端保留的下载字节。当前约为 97.5 MiB 和 58.5 MiB。检查资源变化时比较这两项，确认增长来自实际使用方，而不是素材扫描范围扩大。

既有测试门禁包含三种独立证据：`cdn-resource-export.test.js` 将公共下载与共享字库、外置样式资源交叉核对，拦截未声明资源自动加入及必要文件缺失；`cdn-resource-library.test.js` 检查实际请求、缓存复用、更新、损坏补齐和离线恢复；`bundled-fonts-electron.test.js` 在隔离安装目录中验证全部字体及地图显示，再断网重开。不能仅用导出脚本生成的结果作为同一脚本的正确性依据。

## 后续更新

1. 修改仓库内相同逻辑路径的字体或图片，然后再次执行导出命令。
2. 上传新增或变化的字体包、图片，保留旧版本，以便仍在使用旧清单的客户端继续下载。
3. 最后替换远程 manifest.json。客户端下次启动比较原文件摘要，只下载包含缺失或变化文件的字体包或图片，其余包不重复下载。
4. 新增或移除逻辑路径需要同步新的客户端目录及打包规则；旧客户端忽略新增路径，不能从清单下载未随自身目录批准的资源。发布清单应保留仍受支持旧客户端需要的逻辑路径。

字体族、字重、分片范围和新增功能仍由客户端代码定义。资源清单不承载脚本或插件，也不替代客户端版本更新。

## 本机使用与故障恢复

下载由主进程统一调度（2 路并发、每秒最多 8 次请求，适配当前 CDN 每 IP 每秒 10 次的限流）。首次准备页直接展示字体和图片的下载状态，不重复弹提示条；主进度以直播数据准备为准，字体和大图没下完也能先进主界面后台续下。进入主界面后，字体和大图共用一条进度提示条（按已下载字节算进度，按包/图计完成数），礼物图片走各自原有任务；详情可在「百宝箱 → 设置 → 系统与关于 → 资源下载任务」查看，无更新时静默不提示。

先写入应用数据目录 `cache/resources/` 的独占临时文件，校验完整大小和 SHA-256；字体包还会检查条目清单及每个需要补齐文件的大小和摘要，再恢复原文件缓存并发布索引。解包只写入客户端批准的资源，拒绝意外条目和路径穿越，临时 ZIP 使用后删除。已有字体、图片继续使用，失败可点击提示条的重试，或下次启动再检查。首次补齐需要联网，尚未下载的资源不会因安装包而离线存在。

自有部署可在启动环境变量中用 `LIRA_RESOURCE_CDN_BASE` 覆盖 CDN 根地址（仅接受 HTTPS 域名根地址）。该配置只在可信启动环境中生效，不向渲染进程开放任意下载地址。存储、HTTP 和 IPC 字段分别见[存储](../reference/backend/storage.md#公共资源缓存)、[资源接口](../reference/backend/api.md#共享字体资源)、[桌面桥](../reference/desktop/preload.md)。

## 音频组件独立交付

音频助手与原生声卡输出共用一个独立组件包，包含后台程序、私有 .NET 运行库和模型。普通字体图片清单不接受这些可执行文件；客户端内置唯一可信版本与摘要，不增加在线音频更新清单或轮询。

1. 音频源码或运行库依赖变化时运行 `npm run build:audio-assistant -- <vendor目录>`；仅更新客户端时复用已有音频构建。
2. 运行 `npm run export:audio`。产物位于 `tmp/audio-component-export/upload/client/resources/audio/`，上传说明为同级导出根目录的 `UPLOAD.md`；内置描述写入 `src/electron/audio-component-manifest.json`。重复导出相同输入产生相同内容版本和包摘要。
3. 只上传当前导出的 `audio-win-x64-<包摘要前缀>.zip` 至 CDN 的 `client/resources/audio/`，保留原名。使用 HTTPS、关闭内容转换、允许长期缓存，不能覆盖同名文件；已发布旧包继续保留。
4. 验证上传文件的大小和完整 SHA-256 与导出说明一致，然后发布包含对应内置描述的新客户端。无需修改字体/图片 `manifest.json` 或额外上传音频 manifest。

首次授权后，缺失组件由独立后台任务补齐，可在「百宝箱 → 设置 → 系统与关于」查看进度和重试。6.0.0 已有组件由安装器保留并校验复用；本地完整且兼容时无音频 CDN 请求，账号切换和无关客户端更新不重下。音频使用相同可信启动环境的 `LIRA_RESOURCE_CDN_BASE`，正常用户不需要安装 .NET。首次联网准备完成前，电音助手与原生声卡输出暂不可用（默认浏览器播放不受影响）；组件准备妥当后离线也能正常使用。

音频组件包需开启压缩，不能沿用字体包使用的无压缩（stored）ZIP 模式。客户端每次准备最多一个包请求、失败后等待明确重试；音频组件准备不阻塞礼物或字体任务。下载及版本目录的原子发布见[桌面主进程](../reference/desktop/main.md#电音助手生命周期)，持久位置见[存储](../reference/backend/storage.md#音频组件文件)。

## 客户端安装包与自动更新

安装包放在 `client/downloads/`，字体、图片和音频放在 `client/resources/`：

```text
lirahub/client/
├─ downloads/
│  ├─ lira-setup-6.0.0.exe
│  ├─ lira-setup-6.0.0.exe.blockmap
│  └─ latest.yml
└─ resources/
   ├─ fonts/
   ├─ images/
   └─ manifest.json
```

手动下载入口为 `https://lirahub.cn/download/client`，服务器在点击时读取 `https://assets.lirahub.cn/client/downloads/latest.yml`，再跳转到清单 `path` 声明的安装包。客户端自动更新读取同一清单，比较版本号，再下载并校验 SHA-512。两边都不扫描目录或按文件数量猜测最新版；没有可用清单时，官网入口返回暂不可用，客户端会报「更新清单暂不可用」。服务器入口的配置与部署验收由服务器仓库 `docs/operations/client-download.md` 维护。

每次正常构建仍生成 `release/lira-setup-X.Y.Z.exe`、`release/lira-setup-X.Y.Z.exe.blockmap` 和 `release/latest.yml`，GitHub 按原文件名发布，清单引用带版本号的安装包。发布流程与 v5.7.4 相同；发布任务在 GitHub 附件上传成功后结束，多吉云由维护者自行手动同步。

- **上传顺序与增量下载：** 同步多吉云时，直接上传同次构建的 `lira-setup-X.Y.Z.exe`、`lira-setup-X.Y.Z.exe.blockmap` 和原始 `latest.yml`，不要重命名、修改清单或混用不同构建的文件（混用会导致增量下载失败或 SHA-512 校验拦截安装）。务必先传 EXE 和 blockmap 并确认对应 URL 返回 200，最后再覆盖 `latest.yml`，保持 `version`、`files[].url`、`path`、`sha512`、`size` 的原始对应关系。新版客户端优先增量下载，CDN 对 EXE 的单段 `Range: bytes=起点-终点` 请求须返回 206、正确的 `Content-Range` 和实际范围字节（无需多段 multipart 响应）。
- **旧版兼容与清理：** 保留仍受支持旧版本的原始 blockmap（首次启用时需一并补传历史构建的原始 blockmap，不能用新包冒充），供本机缺少缓存块映射的客户端增量升级；若本机旧包、远端 blockmap 缺失或分段失败，客户端会自动回退整包下载并校验 SHA-512。旧版客户端仍走整包下载，新策略随新版生效。新版本验收通过后再清理不再供下载的旧 EXE（不要提前删除造成发布窗口中断，也不要误删仍在使用的旧 blockmap）；旧版帮助文档仍可能引用固定的 `lira-setup.exe`，请保留该兼容文件。
- **缓存与响应头：** 只需为持续覆盖的 `/client/downloads/latest.yml` 配置 CDN 不缓存规则（优先级高于全局规则，并设 `Cache-Control: no-store`）；调整规则、响应头或覆盖清单后记得刷新 CDN 缓存（含此前的 404）。带版本号的 EXE 和 blockmap 发布后不会覆盖，可长期缓存，`Content-Type` 设为 `application/octet-stream`，`Content-Disposition` 附件名使用带版本号的实际文件名（切勿把 EXE 的附件头套给清单）；兼容固定文件若原地覆盖也保持不缓存。字体和图片的缓存策略沿用上文规则。

更新地址修改随下一次客户端构建生效。已经安装或上传的旧 EXE 保留其原来的更新配置；旧版本继续使用空间根目录的 `downloads/` 和 `resources/`。支持期间先在两套路径发布并校验文件，再同步更新两套清单。构建和发布要求见[发布指南](../../RELEASE_GUIDE.md)与[构建参考](../reference/engineering/build.md)。
