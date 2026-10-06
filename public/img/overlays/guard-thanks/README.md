# 大航海感谢 · 珠贝纹章素材

这组三档透明纹章用于 `guard-thanks-aurora.js`。2026-10-04 通过 LiraHub 图像工具 `image_generate` 生成（非 CLI），模型 `gpt-image-2.5-flare`，质量 high。

成品为 1280×1280 RGBA 无损 WebP。由 1254×1254 原始生成图清理零散 alpha 噪点后重新采样，主体居中缩入 1050×1050；沿用已确认的冰蓝、紫晶与红金调色，保留原图的亮度细节和真实透明边缘。2560×1440 的 16:9 输出下，图片元素约为 853×853 像素，素材有足够的分辨率余量。素材本身不含文字、背景或动画；纹章始终保持原位与角度，仅淡入淡出。表面反光按同一 WebP 的 alpha 裁切，星芒、外围流光与光晕由共享渲染器编排。

| 成品 | 主题 | 生成请求 ID |
|---|---|---|
| `captain-pearl-v1.webp` | 冰蓝珠贝船锚 | `a0722bcd-3b3b-4f89-89b6-8a66a704ade3` |
| `admiral-pearl-v1.webp` | 紫晶珠贝月弧罗盘 | `127b0cea-6f41-4889-8df3-7cbaddc82598` |
| `governor-pearl-v1.webp` | 红色珠贝与金属船舵 | `4e57a2c6-6b7d-4ee3-93eb-a08738016021` |

后续通过本地 alpha 轮廓精修，去除了舰长船锚、总督船舵背后的实体月弧及末端珠饰，仅提督保留月弧。精修沿用原图的珠贝与金属纹理、配色、尺寸和主体位置；以下请求 ID 与提示词记录的是原始生成过程。

## 原始生成提示词

### captain

```text
Use case: stylized-concept. Create a premium 3D nautical achievement emblem as an isolated cutout for a livestream welcome animation. Subject: one beautifully proportioned upright ship anchor, forged in polished cool platinum, with wide smooth ivory mother-of-pearl inlays carrying a very subtle powder-blue iridescence. Slender but substantial sculptural volume, rounded bevels, exceptional luxury object craft, restrained jewelry details. A slender incomplete orbital crescent of the same platinum curves behind the anchor, with one tiny pearl at its lower tip. Front-facing orthographic composition with only a subtle sense of depth; anchor vertical and symmetrical, fully visible and centered, total object occupies roughly 74 percent of square. The form must read instantly at 300 pixels tall. Studio product rendering, soft large-area light from upper left, gently shaded blue-gray sides, crisp silhouettes, low-contrast satin highlights. Material is pearlescent ceramic and brushed precious metal, NOT glowing neon or glass wireframe. Transparent alpha background; no scene, ground, cast ground shadow, fog, bloom, bokeh, stars, particles, frame, plaque, text, letters, watermark, diamond clusters or ornate fantasy crown. The object itself is the complete artwork and the surrounding negative space must be genuinely transparent.
```

### admiral

```text
Use case: stylized-concept. Create a premium 3D nautical achievement emblem as an isolated cutout for a livestream welcome animation, matching a luxury platinum and mother-of-pearl anchor collection. Subject: one elegant eight-point maritime compass rose, with longer north/south points, forged in brushed cool platinum. Wide smooth ivory mother-of-pearl inlays inside the beveled compass points carry a delicate lavender and pale lilac iridescence, never saturated purple. One small luminous pearl cabochon at the central hub. A slender incomplete orbital crescent of platinum with pearlescent inlay curves behind the compass rose, one tiny pearl at its lower tip, and a simple slim inner compass ring. Sculptural but delicate, refined jewelry craftsmanship, medium thickness with smooth rounded bevels. The compass points must stay broad and substantial rather than wire lines. Front-facing orthographic composition with a subtle sense of depth, balanced and centered, entire object fully visible, occupies 74 percent of the square. Clear instantly at 300 pixels tall. Soft large-area studio light from upper left, violet-gray shaded sides, satin highlights, crisp silhouette, believable material texture. Transparent alpha background; no scene, floor, pedestal, cast ground shadow, glow, bloom, fog, stars, particles, text, letters, numbers, labels, diamonds, sharp sparkles or watermark. Surrounding negative space must be genuinely transparent. Keep a quiet understated luxury product-render aesthetic, not a fantasy game weapon.
```

### governor

```text
Use case: stylized-concept. Create a premium 3D nautical achievement emblem as an isolated cutout for a livestream welcome animation, matching a luxury mother-of-pearl anchor and compass collection. Subject: one exquisite eight-spoke ship's helm, with eight short elegantly tapered rounded handles, a circular wheel with wide ivory mother-of-pearl inlay, a single pearl cabochon in the central hub, and eight slim sculptural spokes. The finish is brushed pale champagne platinum, NOT saturated yellow gold. Warm ivory nacre with faint peach and champagne iridescence, softly shaded bronze-gray edges, precise rounded bevels. A single incomplete slender orbital crescent made of matching champagne metal and pearl inlay curves behind the wheel, with a tiny pearl at its lower tip. The whole design feels like a finely crafted celestial maritime heirloom, delicate yet substantial, no excessive ornament. Front-facing orthographic view with a subtle sense of sculptural depth. Centered, fully visible with generous margin, occupies roughly 74 percent of square. Legible silhouette at 300 pixels tall. Soft large-area studio light from upper left, satin reflective highlights, crisp clean contours, detailed believable nacre. Genuine transparent alpha background, including every hole between wheel spokes. No background, scenery, floor, pedestal, cast ground shadow, fog, bloom, glow, stars, particles, ribbons, text, labels, letters, watermark, diamonds or crown. Understated quiet luxury product rendering.
```
