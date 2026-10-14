# 播放器与直播歌词内置字体

用于「播放 → 播放器外观」以及直播歌词的字体选项。三款字体均以 SIL Open Font License 1.1 分发，许可原文随字体保存。字体文件随客户端 `public/**/*` 打包，不依赖字体安装、外部组件包或运行时网络请求。`css/shared/display-fonts.css` 声明 `@font-face`，由播放器外观与直播歌词共享样式引入，仅选用时加载，使用 `font-display: swap`；缺字走系统字体回退。

| 文件 / CSS 字体族 | 字体来源 | 原始字符覆盖 | 许可 |
| --- | --- | --- | --- |
| `maiyuan.woff2` / `Lira Maiyuan` | [荆南麦圆](https://github.com/maoken-fonts/KNMaiyuan/tree/580b2bb873828122f7816f1c5c4caf2667cba62f)，`fonts/TTF/KNMaiyuan-Regular.ttf` | 17,491 个 Unicode 码点 | [maiyuan-OFL.txt](maiyuan-OFL.txt) |
| `kuaile.woff2` / `Lira Kuaile` | [站酷快乐体](https://github.com/google/fonts/tree/6d49995f5d8f1c7d476760a580ffb89ce1e52c5d/ofl/zcoolkuaile)，`ZCOOLKuaiLe-Regular.ttf` | 7,053 个 Unicode 码点 | [kuaile-OFL.txt](kuaile-OFL.txt) |
| `smiley.woff2` / `Lira Smiley` | [得意黑 v2.0.1](https://github.com/atelier-anchor/smiley-sans/releases/tag/v2.0.1)，发行包中的 `SmileySans-Oblique.ttf.woff2` 原文件 | 9,440 个 Unicode 码点 | [smiley-OFL.txt](smiley-OFL.txt) |

麦圆与快乐体只通过 fontTools 的 `TTFont.flavor = 'woff2'` 做格式压缩，没有裁剪字符、修改字形或内部名称；转换后 cmap 与源字体一致。得意黑直接使用上游 WOFF2。CSS 别名只用于避免与已安装字体冲突。三款都是单字重，粗细选项中的其他字重由 Chromium 合成；得意黑字形本身带倾斜。

## SHA-256

| 文件 | SHA-256 |
| --- | --- |
| 原始 `KNMaiyuan-Regular.ttf` | `94ea78c51086b1ea58c1744784b2335dea2c5ef1c5193b80e02c7d46b8e0283f` |
| `maiyuan.woff2` | `00bb811406e2a37423a962c73d6a3b855071f565153d024136c8eda3d38fe5e0` |
| 原始 `ZCOOLKuaiLe-Regular.ttf` | `812a6fc1fe54b6d73a419245c32dfeba8aa33104d5be90d1cf6af082007cb71d` |
| `kuaile.woff2` | `c6fc388b486afb363e00420540b56079561e4b46eba4c0d09a65b999bd0235e0` |
| `smiley.woff2` | `731f22973349404b15a88a99ef3b5dd4104c0965c23b7e485c1f11e84fea99e2` |

外观字段、默认值及本机字体权限说明见[播放器外观合同](../../../docs/reference/frontend/playback.md#81-大播放器外观)。

直播歌词默认使用荆南麦圆；选项与旧设置兼容说明见[直播歌词合同](../../../docs/reference/frontend/overlays.md#6-直播歌词页lyrics)。
