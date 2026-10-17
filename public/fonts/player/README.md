# 共享字体库：原有五款字体

五款字体现由[共享字体库](../README.md)统一提供给所有字体选择入口；`player/` 保留为兼容资源路径。全部以 SIL Open Font License 1.1 分发，许可原文随字体保存。WOFF2 保留作开发/素材副本，不再进入 EXE；安装版直接下载同版本原始 TTF（得意黑为官方 WOFF2），缓存后离线可用。统一由 `css/shared/display-fonts.css` 声明，选用或补字时加载，使用 `font-display: swap`。

| 文件 / CSS 字体族 | 字体来源 | 原始字符覆盖 | 许可 |
| --- | --- | --- | --- |
| `maiyuan.woff2` / `Lira Maiyuan` | [荆南麦圆](https://github.com/maoken-fonts/KNMaiyuan/tree/580b2bb873828122f7816f1c5c4caf2667cba62f)，`fonts/TTF/KNMaiyuan-Regular.ttf` | 17,491 个 Unicode 码点 | [maiyuan-OFL.txt](maiyuan-OFL.txt) |
| `kuaile.woff2` / `Lira Kuaile` | [站酷快乐体](https://github.com/google/fonts/tree/6d49995f5d8f1c7d476760a580ffb89ce1e52c5d/ofl/zcoolkuaile)，`ZCOOLKuaiLe-Regular.ttf` | 7,053 个 Unicode 码点 | [kuaile-OFL.txt](kuaile-OFL.txt) |
| `smiley.woff2` / `Lira Smiley` | [得意黑 v2.0.1](https://github.com/atelier-anchor/smiley-sans/releases/tag/v2.0.1)，发行包中的 `SmileySans-Oblique.ttf.woff2` 原文件 | 9,440 个 Unicode 码点 | [smiley-OFL.txt](smiley-OFL.txt) |
| `xiaolai.woff2` / `Lira Xiaolai` | [小赖字体 v3.126](https://github.com/lxgw/kose-font/releases/tag/v3.126)，`Xiaolai-Regular.ttf` | 44,871 个 Unicode 码点 | [xiaolai-OFL.txt](xiaolai-OFL.txt) |
| `assorted.woff2` / `Lira Assorted` | [猫啃什锦黑 v1.70](https://github.com/maoken-fonts/MaokenAssortedSans/releases/tag/v1.70)，`MaokenAssortedSans.ttf` | 31,220 个 Unicode 码点 | [assorted-OFL.txt](assorted-OFL.txt) |

麦圆、快乐体、小赖字体与猫啃什锦黑只通过 fontTools 的 `TTFont.flavor = 'woff2'` 做格式压缩，没有裁剪字符、修改字形或内部名称；转换后 cmap 与源字体一致。得意黑直接使用上游 WOFF2。CSS 别名只用于避免与已安装字体冲突。五款都是单字重，粗细选项中的其他字重由 Chromium 合成；得意黑字形本身带倾斜。

直播歌词的所有字体选项共用[自动补字资源](../lyrics-fallback/README.md)，无需手动设置备用字体。所选字体缺字时先使用按韩文范围加载的 Gowun Dodum，再由小赖字体和 Noto 字库补充；连写和组合文字直接使用完整的对应语种字库。旧备用字体设置保留在自动补字之后，最终仍由系统字体补充未收录字符，不保证全部 Unicode。

小赖字体覆盖基本拉丁可打印字符、完整 CJK 基本区、平假名 U+3041–3096、片假名 U+30A1–30FA、韩文兼容字母 U+3131–318E，以及 11,171 个现代韩文音节。Gowun Dodum 覆盖全部 11,172 个现代韩文音节，包括小赖未收录独立码点的 `썏`（U+C34F）。猫啃什锦黑自身覆盖拉丁字母、常用中文与日文假名，韩文由上述补字链提供。

## SHA-256

| 文件 | SHA-256 |
| --- | --- |
| 原始 `KNMaiyuan-Regular.ttf` | `94ea78c51086b1ea58c1744784b2335dea2c5ef1c5193b80e02c7d46b8e0283f` |
| `maiyuan.woff2` | `00bb811406e2a37423a962c73d6a3b855071f565153d024136c8eda3d38fe5e0` |
| 原始 `ZCOOLKuaiLe-Regular.ttf` | `812a6fc1fe54b6d73a419245c32dfeba8aa33104d5be90d1cf6af082007cb71d` |
| `kuaile.woff2` | `c6fc388b486afb363e00420540b56079561e4b46eba4c0d09a65b999bd0235e0` |
| `smiley.woff2` | `731f22973349404b15a88a99ef3b5dd4104c0965c23b7e485c1f11e84fea99e2` |
| 原始 `Xiaolai-Regular.ttf` | `e2f68daf0e72777a8cf58bc83de1b98634b251e537ddbfca24b0ae50d1802da2` |
| `xiaolai.woff2` | `f93a1d734a2a42acb63aebef76c663bf8e6be9f8be646497d3bd4707142cdc63` |
| 原始 `MaokenAssortedSans.ttf` | `29b4fea4dfaf50be4b9ede602cc713eca1e411e0b498b74e8ea41f2c68f6fb90` |
| `assorted.woff2` | `8423638361bf42d33a196390ebc907b0605db432c60cc881bbb2c3b9665d7063` |

外观字段、默认值及本机字体权限说明见[播放器外观合同](../../../docs/reference/frontend/playback.md#81-大播放器外观)。

直播歌词默认使用荆南麦圆；选项与旧设置兼容说明见[直播歌词合同](../../../docs/reference/frontend/overlays.md#6-直播歌词页lyrics)。
