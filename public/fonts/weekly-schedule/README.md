# 周表字体

`zcool-xiaowei.woff2` 为站酷小薇完整字体，源文件来自
[Google Fonts 的 ZCOOL XiaoWei](https://github.com/google/fonts/tree/6d49995f5d8f1c7d476760a580ffb89ce1e52c5d/ofl/zcoolxiaowei)。
从 `ZCOOLXiaoWei-Regular.ttf` 仅转换为 WOFF2，未裁掉字形；保留原字体名称及版权信息。
许可原文见 [OFL.txt](OFL.txt)。

原始 TTF 的「回」（U+56DE）在 Chromium 和 Pillow 中均呈实心块，常规与加粗一致。
周表 `@font-face` 的 `unicode-range` 跳过该字，使用字体栈的正常回退保证文字可读；
字体二进制保留原样。其余已检查的示例文字正常渲染。

消费方为 `public/css/admin/toolbox/weekly-schedule-art.css` 的 `ZCOOL XiaoWei` 字体族，
用于周表实时预览和固定内部导出页。文件随客户端本地打包，仅在选用该字体时由 Chromium 加载；
不增加启动 CDN 下载或独立字体清单。其他已就绪字体和系统字体沿用软件字体选择器。

WOFF2 SHA-256：`e8d72506087d92ee6407f4d3d00ee3508205980cc97866388cf9301e7802f877`。
