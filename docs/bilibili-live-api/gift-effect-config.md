# B站直播礼物全屏特效配置

本页记录 B 站全屏礼物特效的配置字段和历史素材布局样例。LIRA 的实时事件、开关、配置缓存和播放规则由[展示页参考](../reference/frontend/overlays.md#14-礼物四方边框gift-effects)维护；本页不重复定义产品事件。

## 配置接口

```text
GET https://api.live.bilibili.com/xlive/general-interface/v1/fullScSpecialEffect/GetEffectConfListV2
    ?platform=pc&room_id=0&area_parent_id=0&area_id=0&source=live&build=0&base_version=0
```

- 接口不需要登录 Cookie。
- 请求应带浏览器 User-Agent，以及 `Referer: https://live.bilibili.com/`。
- 响应列表位于 `data.full_sc_resource.conf_list`。

常用字段：

| 字段                | 说明                                                |
| ------------------- | --------------------------------------------------- |
| `id`                | 特效 ID                                             |
| `type`              | 特效类型                                            |
| `bind_gift_ids`     | 与该特效绑定的礼物 ID 数组，`0` 表示未绑定          |
| `web_mp4`           | Web 直播间使用的全屏 MP4 素材                       |
| `web_mp4_json`      | MP4 内彩色画面与 alpha 遮罩的官方坐标配置           |
| `web_mp4_md5`       | MP4 的 MD5 信息                                     |
| `web_mp4_file_size` | MP4 文件大小                                        |

`web_mp4` 为空的记录可能使用旧 SVGA 素材。LIRA 接受的媒体、URL 和布局校验规则见上述展示页参考。

## CDN 与透明画面

打包素材可以把彩色画面和灰度 alpha 遮罩放在同一帧。应以 `web_mp4_json` 的 `rgbFrame` 与 `aFrame` 解释各区域，不能仅根据 MP4 宽高猜测。

历史样例中，礼物 `32132` 的 MP4 解码尺寸是 `1088×1296`，坐标记录为：

```json
{
  "videoW": 1088,
  "videoH": 1296,
  "rgbFrame": [0, 0, 720, 1280],
  "aFrame": [724, 0, 360, 640]
}
```

这个布局表示 `720×1280` 彩色区及右侧 `360×640` 遮罩；将遮罩缩放到彩色区尺寸后，用其灰度作为 alpha（白色不透明、黑色透明），不把分隔带和编码填充合入画面。

## LIRA 实现入口

当前 `/gift-effects` 同时支持官方 `gift:effect` 和感谢边框 `gift:frame`；官方特效路径仍在使用，播放器是 [gift-effect-player.js](../../public/js/overlays/gift-effect-player.js)。它要求有效的 RGB/alpha 布局，不提供无坐标亮度抠黑回退。完整行为见[展示页参考](../reference/frontend/overlays.md#14-礼物四方边框gift-effects)及[弹幕礼物特效规格](../../specs/gift-effect-danmaku.md)，本地查询和预览接口见 [HTTP 参考](../reference/backend/api.md)。
