# 共享艺术字体

从本地歌词试验提取的两款完整字体，获取日期 2026-10-16。使用 fontTools 4.25.0 将原始 TTF 压缩为 WOFF2，没有裁字、改字形或内部名称；逐一核对转换前后 cmap 完全相同。两款各包含 7,015 个 Unicode 码点，CSS 使用 LIRA 别名避免与本机安装冲突，字重 400，其他字重由 Chromium 合成。

悠哉字体 v0.868 于 2026-10-26 加入共享库，取自上游 Regular 与 Medium 完整 TTF，分别声明为字重 400、500。两份各覆盖 26,006 个 Unicode 码点；同样只压缩格式，转换前后 cmap 与字重完全一致。CSS 字体族统一为 `Lira Yozai`，供所有共享字体入口选择；客户端「花与信笺」及其 tmp 样例默认使用该字体。内置清单的 `bundled[].weight` 保留各文件字重，未指定时继续使用 400；兼容的单文件修复缓存仍声明 400，其余字重由浏览器匹配或合成。

| 文件 / CSS 字体族 | 来源 | 许可 |
| --- | --- | --- |
| `zhimangxing.woff2` / `Lira Zhimangxing` | [Google Fonts / Zhi Mang Xing](https://github.com/google/fonts/tree/main/ofl/zhimangxing)，`ZhiMangXing-Regular.ttf` | [SIL OFL 1.1](zhimangxing-OFL.txt) |
| `mashanzheng.woff2` / `Lira Mashanzheng` | [Google Fonts / Ma Shan Zheng](https://github.com/google/fonts/tree/main/ofl/mashanzheng)，`MaShanZheng-Regular.ttf` | [SIL OFL 1.1](mashanzheng-OFL.txt) |
| `yozai-regular.woff2` / `Lira Yozai`，400 | [悠哉字体 v0.868](https://github.com/lxgw/yozai-font/releases/tag/v0.868)，`Yozai-Regular.ttf` | [SIL OFL 1.1](yozai-OFL.txt) |
| `yozai-medium.woff2` / `Lira Yozai`，500 | 同版 `Yozai-Medium.ttf` | [SIL OFL 1.1](yozai-OFL.txt) |

原始 TTF SHA-256：

- 志莽行：`644e0cae9b40f0b10ab729a01bd32032e3973bac22be3dccae01bf6ae7fde969`
- 马善政：`6d2546bb189c732a8ca29af9e22457b152387d158aa459e4ac2ce1e51788b7fb`
- 悠哉 Regular：`25071998a0fe6a72f54c235e714986d259633e5ff670b1a2b5e264387f3316ac`
- 悠哉 Medium：`05f50f252b45197d0d6148a4abc3e37c7cd4cfdf03c955b57c25d53d924f835f`

WOFF2 SHA-256：

- 志莽行：`9cd493650f11ecaf40c5291db897ddbe1dd0422bec81e7fc87ebc1726db0de2a`
- 马善政：`c7d3694525df10a332b01c185b147ccd20e8084ba194747b79dad16be3db4d23`
- 悠哉 Regular：`17266b707eba2584a9c4d773489a17e113b9f1926300a25ed2fbd1f7d7c425e4`
- 悠哉 Medium：`5492dfc65fe37e0b00c884be176cbcb786a4f38cff9d4035932228dba57fbf2a`

统一入口和使用范围见[共享字体库](../README.md)。演示的第三款得意黑复用 `player/smiley.woff2`。
