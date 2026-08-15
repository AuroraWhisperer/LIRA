# B站直播礼物全屏特效配置

直播间里持续数秒的烟花、飞船等全屏动画，不直接包含在礼物弹幕消息中。服务端需要用礼物 ID 查询 B站 Web 直播间使用的特效配置，再把匹配到的素材广播给 overlay。

## 配置接口

```text
GET https://api.live.bilibili.com/xlive/general-interface/v1/fullScSpecialEffect/GetEffectConfListV2
    ?platform=pc&room_id=0&area_parent_id=0&area_id=0&source=live&build=0&base_version=0
```

- 接口不需要登录 Cookie。
- 请求应带浏览器 User-Agent，以及 `Referer: https://live.bilibili.com/`。
- 本项目缓存配置 12 小时；刷新失败时保留旧缓存，并限制失败重试频率。
- 响应列表位于 `data.full_sc_resource.conf_list`。

常用字段：

| 字段 | 说明 |
| --- | --- |
| `id` | 特效 ID；同一礼物关联多条记录时取数值最大的最新记录 |
| `type` | 特效类型 |
| `bind_gift_ids` | 与该特效绑定的礼物 ID 数组，`0` 表示未绑定 |
| `web_mp4` | Web 直播间使用的全屏 MP4 素材 |
| `web_mp4_md5` | MP4 的 MD5 信息 |
| `web_mp4_file_size` | MP4 文件大小 |

`web_mp4` 为空的旧 SVGA 特效暂不播放。实现只接受 HTTPS 且位于 B站相关 CDN 域名下的素材，避免将 lookup API 变成任意远程视频入口。

## CDN 与透明画面

MP4 既可能是黑色背景，也可能把 `9:16` 彩色画面和半宽 alpha 遮罩横向打包在同一帧。overlay 会识别打包格式、按原始比例居中合成；普通黑底素材继续使用亮度抠黑。第三方页面直接携带 Referer 请求 CDN 还可能得到 403，因此 overlay 同时使用：

- 页面级 `<meta name="referrer" content="no-referrer">`
- 视频元素 `referrerPolicy = 'no-referrer'`
- 视频元素 `crossOrigin = 'anonymous'`

透明合成不能依赖 `mix-blend-mode: screen`，因为透明页面本身没有可混合的底色。本项目把每一帧绘制到 canvas，并使用亮度抠黑：

```text
alpha = max(r, g, b)
```

## 本项目接口与页面

- 查询礼物 ID：`GET /api/gifts/effects/resolve?giftId=31645`
- 直播监听 overlay：`/gift-effects`
- 手动预览：在百宝箱输入礼物 ID 后，服务端通过 WebSocket 通知已打开的固定 `/gift-effects` 页面播放
- 服务端解析：`src/bilibili/gift/effect-config.js`
- 百宝箱工具：`public/pages/admin/toolbox/gift-effects.html`
- 透明合成：`public/js/overlays/gift-effects.js`

收到真实礼物并完成组合礼物结算后，服务端通过现有 WebSocket 广播：

```json
{
  "type": "gift:effect",
  "eventId": 77,
  "giftId": 31645,
  "giftName": "礼物名称",
  "effect": {
    "effectId": 584,
    "type": 1,
    "mp4Url": "https://i0.hdslb.com/bfs/live/example.mp4",
    "md5": "",
    "fileSize": 417612
  }
}
```
