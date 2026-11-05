# 圣诞绮笺装饰

`bow.svg`、`corner.svg`、`pendant.svg`、`garland.svg`、`wreath.svg` 为本款手工绘制的本地矢量装饰，参考 [Cozy Christmas](https://www.etsy.com/listing/1623353307/cozy-christmas-chat-widget-customizable) 的红金卡片与节日挂饰构图，未使用其付费文件或代码。

唯一消费者为客户端 `public/js/overlays/danmaku-christmas.js`。图片随客户端静态资源交付，不进入共享 CDN 启动下载；使用普通图片元素，兼容场景中 `sandbox allow-scripts` 的弹幕子页面。动效由本款 CSS 与公共 feed 分工维护，图片自身没有时间循环。
