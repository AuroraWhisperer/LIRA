# 共享艺术字体

从本地歌词试验提取的两款完整字体，获取日期 2026-10-16。使用 fontTools 4.25.0 将原始 TTF 压缩为 WOFF2，没有裁字、改字形或内部名称；逐一核对转换前后 cmap 完全相同。两款各包含 7,015 个 Unicode 码点，CSS 使用 LIRA 别名避免与本机安装冲突，字重 400，其他字重由 Chromium 合成。

| 文件 / CSS 字体族 | 来源 | 许可 |
| --- | --- | --- |
| `zhimangxing.woff2` / `Lira Zhimangxing` | [Google Fonts / Zhi Mang Xing](https://github.com/google/fonts/tree/main/ofl/zhimangxing)，`ZhiMangXing-Regular.ttf` | [SIL OFL 1.1](zhimangxing-OFL.txt) |
| `mashanzheng.woff2` / `Lira Mashanzheng` | [Google Fonts / Ma Shan Zheng](https://github.com/google/fonts/tree/main/ofl/mashanzheng)，`MaShanZheng-Regular.ttf` | [SIL OFL 1.1](mashanzheng-OFL.txt) |

原始 TTF SHA-256：

- 志莽行：`644e0cae9b40f0b10ab729a01bd32032e3973bac22be3dccae01bf6ae7fde969`
- 马善政：`6d2546bb189c732a8ca29af9e22457b152387d158aa459e4ac2ce1e51788b7fb`

WOFF2 SHA-256：

- 志莽行：`9cd493650f11ecaf40c5291db897ddbe1dd0422bec81e7fc87ebc1726db0de2a`
- 马善政：`c7d3694525df10a332b01c185b147ccd20e8084ba194747b79dad16be3db4d23`

统一入口和使用范围见[共享字体库](../README.md)。演示的第三款得意黑复用 `player/smiley.woff2`。
