# 圣诞来信插画

这八张透明 WebP 为本项目生成的原创角色素材：圣诞树、姜饼人、小鹿、袜子、雪人、圣诞老人、帽子和礼盒。2026-11-04 使用 LiraHub `gpt-image-2.5-flare` 生成，随后裁切、清理透明边缘并将最长边压至 256px。源图和生成记录保留在本机 `tmp/christmas-danmaku-prototype/assets/sources/`。

消费者为客户端内置 `christmas-letter` 弹幕样式，交付由客户端本地静态资源负责，不加入启动 CDN 下载。现有 Nunito 字体复用 `public/fonts/spooky/`，许可见该目录。

`captain-scene.webp`、`admiral-scene.webp`、`governor-scene.webp` 为用户在 2026-11-04 提供截图的静态裁切，保留原角色与船，移除外侧浅色底和独立题字，并保留白色船体。它们用于对应的开通／续费卡背景，不属于前述生成插画。原图 SHA-256、裁切坐标与输出尺寸见 `guard-scenes-sources.json`；本机处理脚本与源截图在 `tmp/christmas-danmaku-prototype/qa/guard-background-revision/`。三个静态背景由同一客户端本地目录交付，不依赖航海旗帜动画包或新增启动下载。
