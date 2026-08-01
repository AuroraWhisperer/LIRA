# 小熊虫盲盒图片获取指南

## 需要的图片
文件名: `bilibili-blindbox-tardigrade.png`

## 获取方法

### 方法 1: 从 Bilibili 直播间获取
1. 打开任意 Bilibili 直播间
2. 打开浏览器开发者工具 (F12)
3. 切换到 Network (网络) 标签
4. 在直播间礼物面板中找到"小熊虫盲盒"
5. 在 Network 中搜索包含 "gift" 或图片相关的请求
6. 找到小熊虫盲盒的图片 URL (通常是 `.png` 或 `.webp` 格式)
7. 下载图片并保存为 `bilibili-blindbox-tardigrade.png`

### 方法 2: 从 Bilibili API 获取
访问礼物配置 API:
```
https://api.live.bilibili.com/xlive/web-room/v1/giftPanel/giftConfig
```

在返回的 JSON 中搜索 "小熊虫" 或 "tardigrade"，找到对应的图片 URL。

### 方法 3: 手动搜索
在搜索引擎中搜索: `bilibili 小熊虫盲盒 礼物图片`

## 图片规格
- 推荐尺寸: 48x48 像素或更大
- 格式: PNG (支持透明背景)
- 建议背景: 透明或白色

## 放置位置
将图片保存到:
```
public/img/bilibili-blindbox-tardigrade.png
```

## 临时方案
如果暂时找不到图片，系统会显示 🎁 表情符号作为占位符。
