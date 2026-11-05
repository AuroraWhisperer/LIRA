# 软件字体库

字体目录由 `public/js/shared/font-catalog.js` 维护，选择器由 `shared/font-library.js` 注册。菜单将默认／跟随选项置顶，字体来源统一为「软件字体库」与「系统字体库」。软件字体库提供已就绪的统一资源；系统字体库只列出本机枚举成功的已安装字体。旧页面的系统预设仅用于兼容已保存的字体名、别名和回退组合，不再追加为可选列表；能匹配本机字体的旧值在对应字体项回显，无法匹配的已保存字体单列在「当前设置」，保留原值。

系统字体库继续由 `shared/local-font-library.js` 共用一次枚举，放在独立分组；拒绝读取本机字体不影响共享库。播放器歌曲/歌词、直播歌词、弹幕、两类点歌板字体、歌单展示板及场景中对应参数全部使用同一目录。

| 字体 | 资源与来源 |
| --- | --- |
| 荆南麦圆、站酷快乐体、得意黑、小赖字体、猫啃什锦黑 | [原有五款字库](player/README.md)；完整 WOFF2 通过 CDN 补齐，所有组件共同使用 |
| 志莽行、马善政、悠哉 | [艺术字体](library/README.md)，完整字库；悠哉包含普通 400 与中等 500 两个字重；得意黑直接复用，不重复保存 |
| 霞鹜文楷 Light | [文楷分片](moonlit-wenkai/README.md)，共享库与外部资源样式共用来源 |
| Nunito | `spooky/nunito-500.ttf` 与 `nunito-700.ttf`，共用现有 OFL 字库和 `Spooky Nunito` 字体族名 |
| Noto Sans、Gowun Dodum、Noto Serif Tibetan | [多语言字库](lyrics-fallback/README.md)，按实际字体名称供所有组件选择，歌词继续自动补字 |

共享完整字体的二进制不进入安装包；两个微型标题裁剪字库随安装包保留。首次授权后，客户端与礼物初始化并行，从 CDN 下载缺失字体并保存在应用数据目录的 `cache/resources/`；首次补齐需要联网，之后可使用本地缓存。现有本地 HTTP 继续通过 `/fonts/` 提供资源，客户端和浏览器源不直接访问 CDN，也不向安装目录写入或注册 Windows 系统字体。文楷全部 23 个分片共同保留完整字符覆盖。CDN 上 13 款共享字体各一个具名 ZIP，同款字体的分片、字重和语种分支归入同包；客户端自动校验、解包并一起发布同一包的新缓存索引，完成数按字体包统计。

`css/shared/display-fonts.css` 是统一样式入口，由本地 HTTP 根据已就绪资源提供。[字体目录](../../src/fonts/catalog.json) 保留字体族、字重及分片范围；`bundled[].aliases` 让歌词旧字体族复用同一文件，[公共资源清单](../../src/resources/catalog.json) 提供允许下载的逻辑路径。每次已授权启动只检查一次远程清单，比较本地文件大小和 SHA-256，只补齐缺失、损坏或变化的文件；没有下载时不显示 toast。全部使用 `font-display: swap`，字体选择器确认本地字体解码成功后才列为可选字体，尚未就绪的已有选择保留并标记「未就绪」。艺术字体缺字仍由原有回退链补齐，不保证全部 Unicode。

共享库的 56 个完整字体文件合计约 56.63 MiB，经 CDN 分发；两个标题裁剪字库共 6,524 字节，与小型 OFL 许可一起随应用保留。字体与大图共用下载进度，在首次准备页和 Admin toast 中按字节显示，也可在「百宝箱 → 桌面更新」查看；失败保留已有资源并允许重试。旧 `cache/fonts/` 仍可为旧字体路由提供兼容数据，正常桌面资源同步不再访问 GitHub 或 jsDelivr。源码目录仍保留完整文件，开发态可复用与清单匹配的源文件。`shared/font-library-loader.js` 随已就绪文件刷新样式；桌面使用现有 IPC，浏览器源只在检查或下载期间轮询。缓存位置见[存储参考](../../docs/reference/backend/storage.md#公共资源缓存)，本地资源读取见[HTTP 参考](../../docs/reference/backend/api.md#共享字体资源)，上传与更新步骤见[CDN 资源分发](../../docs/guides/cdn-resources.md)。

新选择使用单个带双引号的 CSS 字体族；旧播放器 `maiyuan`/`kuaile`/`smiley` ID 和未加引号的旧字体名原样保留，不迁移持久化数据。场景参数继续限制原有字体名长度。资源样式中的文楷仍映射到资源包版本专用名称，旧 ZIP 的独立字体副本仍可使用。

服务端弹幕页继续使用 LIRA Server 的 `public/overlay/fonts/` 既有压缩副本与 `/overlay/assets/` 版本路由。客户端公共资源不使用该路径，不增加 LIRA Server 字体下载接口；后续更换字体版本或覆盖范围仍须核对该消费者。

## 专用资源

[多语言字体](lyrics-fallback/README.md)已加入共享库，也继续用于歌词自动补字。以下两份裁剪字体仅服务固定标题和时间显示，不在通用字体选择中显示。

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
