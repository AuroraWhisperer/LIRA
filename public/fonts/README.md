# LIRA 共享字体库

字体目录由 `public/js/shared/font-catalog.js` 维护，选择器由 `shared/font-library.js` 注册。本机字体继续由 `shared/local-font-library.js` 共用一次枚举，放在独立分组；拒绝读取本机字体不影响共享库。播放器歌曲/歌词、直播歌词、弹幕、两类点歌板字体、歌单展示板及场景中对应参数全部使用同一目录。

| 字体 | 资源与来源 |
| --- | --- |
| 荆南麦圆、站酷快乐体、得意黑、小赖字体、猫啃什锦黑 | [原有五款字库](player/README.md)；所有组件共同使用，源码保留开发/素材制作副本 |
| 志莽行、马善政 | [艺术字体](library/README.md)，从歌词试验中提取完整字库；得意黑直接复用，不重复保存 |
| 霞鹜文楷 Light | [文楷分片](moonlit-wenkai/README.md)，共享库与外部资源样式共用来源 |

`css/shared/display-fonts.css` 是统一样式入口，由本地 HTTP 根据已就绪资源提供。首次授权与礼物初始化并行下载字体；未下载时使用系统/补字回退，进入桌面后继续后台下载。`shared/font-library-loader.js` 在字体就绪后刷新样式：桌面使用现有 IPC 状态，浏览器源只在下载进行中每两秒查询本地状态，完成或失败后停止。失败后重试的桌面自动刷新；遇到过失败的已打开浏览器源可手动刷新。全部使用 `font-display: swap`，实际选用时才加载进浏览器，不安装到 Windows。艺术字体缺字仍由原有回退链补齐，不保证全部 Unicode。

下载由 [JSON 清单](../../src/fonts/catalog.json) 固定版本、长度与 SHA-256；客户端直连字体作者的 GitHub 和 jsDelivr，不经过 LIRA Server，也不向其回源。得意黑从官方 ZIP 只读取固定 WOFF2 条目；其余下载同版本完整 TTF（文楷为 Light），保留字形与字符覆盖。正常首次网络下载约 84.2 MiB（含得意黑 ZIP），缓存约 79.8 MiB。以后启动只补缺失、损坏或清单变化的文件，完整缓存零字体网络请求；清单随客户端版本更新，不追随上游 latest。

八款可选字体的源码 WOFF2 约 36.5 MiB 不进入 EXE；约 6 MiB 多语言补字、小型固定标题字库和 OFL 许可继续内置。源码开发仍使用校验一致的 WOFF2，文楷开发/套装副本仍分片。缓存位置见[存储参考](../../docs/reference/backend/storage.md#共享字体缓存)，本地资源读取见[HTTP 参考](../../docs/reference/backend/api.md#共享字体资源)。

新选择使用单个带双引号的 CSS 字体族；旧播放器 `maiyuan`/`kuaile`/`smiley` ID 和未加引号的旧字体名原样保留，不迁移持久化数据。场景参数继续限制原有字体名长度。资源样式中的文楷仍映射到资源包版本专用名称；共享字体独立下载，旧 ZIP 的独立字体副本仍可使用。

服务端弹幕页继续使用 LIRA Server 的 `public/overlay/fonts/` 既有压缩副本与 `/overlay/assets/` 版本路由。本次客户端下载不使用该路径，不增加服务器字体下载接口；后续更换字体版本或覆盖范围仍须核对该消费者。

## 专用资源

[歌词多语言补字](lyrics-fallback/README.md)与以下裁剪字体服务于特定渲染场景，不在通用字体选择中显示。

### 大航海感谢标题字库

`guard-thanks-serif-400.woff2` 是 [Google Fonts Noto Serif SC](https://github.com/google/fonts/tree/main/ofl/notoserifsc) 的裁剪版本，固定字重 400，内部名称改为 **Lira Guard Serif**。

- 原始文件：`NotoSerifSC[wght].ttf`，获取日期 2026-10-04。
- 保留字符：`舰长提督总CAPTAINADMIRALGOVERNOR `（去重后 20 个字符，含空格）。
- 仅用于三档固定中英文称谓；欢迎语和月数继续使用系统字体。
- 版权与 SIL Open Font License 1.1 见 [OFL-NotoSerifSC.txt](OFL-NotoSerifSC.txt)。

### 月渡花汀时钟

`clock-moon-serif-400.woff2` 取自同一份 Noto Serif SC 原始字体，固定字重 400，
内部名称改为 **Lira Moon Serif**。保留数字、冒号、日期与星期汉字、AM/PM 及常用间隔符，
仅供本主题的时间和日期显示；保留等宽数字特性。授权同上。
