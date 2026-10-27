# LIRA 共享字体库

字体目录由 `public/js/shared/font-catalog.js` 维护，选择器由 `shared/font-library.js` 注册。本机字体继续由 `shared/local-font-library.js` 共用一次枚举，放在独立分组；拒绝读取本机字体不影响共享库。播放器歌曲/歌词、直播歌词、弹幕、两类点歌板字体、歌单展示板及场景中对应参数全部使用同一目录。

| 字体 | 资源与来源 |
| --- | --- |
| 荆南麦圆、站酷快乐体、得意黑、小赖字体、猫啃什锦黑 | [原有五款字库](player/README.md)；完整 WOFF2 随安装包分发，所有组件共同使用 |
| 志莽行、马善政、悠哉 | [艺术字体](library/README.md)，完整字库；悠哉包含普通 400 与中等 500 两个字重；得意黑直接复用，不重复保存 |
| 霞鹜文楷 Light | [文楷分片](moonlit-wenkai/README.md)，共享库与外部资源样式共用来源 |

九款完整字体随安装包内置，首次使用无需访问 GitHub、jsDelivr 或使用 VPN。安装后位于 `<安装目录>/resources/app.asar/public/fonts/` 的 `player/`、`library/`、`moonlit-wenkai/`；Electron 从 ASAR 中读取资源，经现有本地 HTTP 提供给客户端和浏览器源，不依赖启动工作目录，也不写入安装目录或注册 Windows 系统字体。文楷全部 23 个分片共同保留完整字符覆盖。

`css/shared/display-fonts.css` 是统一样式入口，由本地 HTTP 根据已就绪资源提供。启动按 [JSON 清单](../../src/fonts/catalog.json) 校验内置文件或兼容的旧缓存；正常首次启动零字体下载、无需字体缓存目录。全部使用 `font-display: swap`，直播渲染页按实际使用加载；字体选择器先从本地资源加载菜单预览字形，确认解码成功后才列为可选字体，尚未就绪的已有选择保留并标记「未就绪」。艺术字体缺字仍由原有回退链补齐，不保证全部 Unicode。

九款字体 WOFF2 合计约 50.5 MiB，连同 OFL 许可随软件更新；约 6 MiB 多语言补字与小型固定标题字库也继续内置。原有下载缓存与修复入口保留兼容，仅在对应内置资源和有效缓存均缺失或损坏时尝试固定版本来源；修复下载仍依赖网络，不作为正常使用前提。`shared/font-library-loader.js` 在状态就绪后刷新样式，桌面使用现有 IPC，浏览器源只在修复下载进行中轮询；已打开浏览器源遇到修复失败后需手动刷新重试结果。缓存位置见[存储参考](../../docs/reference/backend/storage.md#共享字体缓存)，本地资源读取见[HTTP 参考](../../docs/reference/backend/api.md#共享字体资源)。

新选择使用单个带双引号的 CSS 字体族；旧播放器 `maiyuan`/`kuaile`/`smiley` ID 和未加引号的旧字体名原样保留，不迁移持久化数据。场景参数继续限制原有字体名长度。资源样式中的文楷仍映射到资源包版本专用名称，旧 ZIP 的独立字体副本仍可使用。

服务端弹幕页继续使用 LIRA Server 的 `public/overlay/fonts/` 既有压缩副本与 `/overlay/assets/` 版本路由。客户端内置资源不使用该路径，不增加服务器字体下载接口；后续更换字体版本或覆盖范围仍须核对该消费者。

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
