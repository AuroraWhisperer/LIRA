# 月渡花汀弹幕素材

银蓝月白主题的透明装饰。昵称、头像、弹幕、礼物、金额和上任文字由 DOM 单独渲染，不烘焙在图片中。

- `guard-landscape.webp`：LiraHub `gpt-image-2.5-flare` 高质量生成的银蓝山水、空心月轮、月相、绢带和花枝；清理边缘后缩放压缩。
- `brush.webp`：同模型生成的横向笔刷透明底图，用作 CSS alpha 遮罩。
- `scroll-frame.webp`：既有花笺卷轴原画，保留作滚轴裁切的来源；现行布局使用独立纸面、双边线与笔刷边缘，避免长留言拉伸整张插画。
- `scroll-landscape.webp`：复用开播动画 `opening-moon-fan/landscape.webp`，等比缩至 960×540、WebP 质量 88，与已确认预览一致；纸面内从左到右由透明渐变至 55%，随画卷从右往左展开。
- `scroll-roller.webp`：由同一卷轴原画裁切，用于从右向左展开的活动滚轴，展开后保留在左侧。
- `flowers.webp`：裁切缩放自本项目开播动画 `opening-moon-fan/flowers-ne.webp`，作为卷轴完全展开后从左向右显现的上层装饰，固定大小贴在左上与右下。
- `crane.webp`：合成自该开播动画的 `crane-body.webp`、`crane-wing-far.webp`、`crane-wing-near.webp`；DOM 中恰好放置三只。
- `captain.webp`、`admiral.webp`、`governor.webp`：复用 `public/img/admin/gifts/bilibili-guard-captain.webp`、`bilibili-guard-prefect.webp`、`bilibili-guard-governor.webp` 的现有 B 站徽章，保留图像像素。

精确生成提示词、来源与加工说明见 [provenance.json](provenance.json)，每个 WebP 同时有工具生成的来源 sidecar。生成通过 LiraHub image 工具执行，不是 CLI 生成。客户端 `public/img/overlays/danmaku-moonlit/` 与服务器 `public/overlay/moonlit/` 图片及来源文件同步；身份配色由 CSS 控制。缩略图来自真实渲染器的四档合成弹幕截图，示例头像沿用项目已有预览素材。
