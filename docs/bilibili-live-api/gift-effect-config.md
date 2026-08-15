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
| `web_mp4_json` | MP4 内彩色画面与 alpha 遮罩的官方坐标配置 |
| `web_mp4_md5` | MP4 的 MD5 信息 |
| `web_mp4_file_size` | MP4 文件大小 |

`web_mp4` 为空的旧 SVGA 特效暂不播放。MP4 和坐标 JSON 必须同时存在，并且只接受 HTTPS 且位于 B站相关 CDN 域名下的素材；坐标拉取或校验失败时直接跳过该特效，避免把辅助区当成画面，也避免将 lookup API 变成任意远程视频入口。

## CDN 与透明画面

MP4 既可能是普通黑色背景，也可能把彩色画面和灰度 alpha 遮罩打包在同一帧。打包方式不能根据 MP4 宽高猜测：服务端会继续读取并校验 `web_mp4_json`，再把其中的 `rgbFrame` 与 `aFrame` 随播放事件发给 overlay。

例如礼物 `32132` 的 MP4 解码尺寸是 `1088×1296`，官方坐标是：

```json
{
  "videoW": 1088,
  "videoH": 1296,
  "rgbFrame": [0, 0, 720, 1280],
  "aFrame": [724, 0, 360, 640]
}
```

overlay 严格按 `rgbFrame` 取出完整的 `720×1280` 彩色动画，按 `aFrame` 取出右侧 `360×640` 遮罩并缩放到彩色区尺寸，然后直接使用遮罩灰度作为 alpha（白色不透明、黑色透明）。分隔带、右侧辅助区和编码填充都不会进入最终画面，也不会用额外白色图层遮住动画。亮度抠黑只保留为兼容旧的无坐标事件，不用于当前官方素材。

第三方页面直接携带 Referer 请求 CDN 还可能得到 403，因此 overlay 同时使用：

- 页面级 `<meta name="referrer" content="no-referrer">`
- 视频元素 `referrerPolicy = 'no-referrer'`
- 视频元素 `crossOrigin = 'anonymous'`

透明合成不能依赖 `mix-blend-mode: screen`，因为透明页面本身没有可混合的底色。普通黑底素材绘制到 canvas 后使用亮度抠黑：

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
    "layoutUrl": "https://i0.hdslb.com/bfs/live/example.json",
    "md5": "",
    "fileSize": 417612,
    "layout": {
      "videoWidth": 1088,
      "videoHeight": 1296,
      "rgbFrame": [0, 0, 720, 1280],
      "alphaFrame": [724, 0, 360, 640]
    }
  }
}
```
