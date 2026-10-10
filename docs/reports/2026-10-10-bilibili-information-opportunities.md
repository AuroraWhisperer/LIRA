# Bilibili 已获取但未用上的字段

2026-10-10。这里关注现有响应里被舍弃的内容；对应功能运行时才会请求，并非 LIRA 始终取得所有资料。以下用途是建议，只有明确链接到消费代码的项目才算已核实的他人用法。

**当前直播间点赞总数已接入客户端**：从 `LIKE_INFO_V3_UPDATE.data.click_count` 更新一个内存快照，预留本机 `GET /api/bilibili/likes/state`。不用服务器、逐人记录或数据库。尚无推送/断线时返回未知，后续可做目标条或达标效果；完整合同见 [点赞状态](../reference/backend/bilibili/danmaku.md#42-直播间点赞状态)。

| 已有来源 → 目前使用 | 剩余字段是什么 | 可以怎么用 / 他人实例 |
| --- | --- | --- |
| `Master/info` → 主播昵称 | `data.follower_num` 粉丝总数；`data.room_news.{content,ctime}` 公告及修改时间 | 涨粉目标、公告自动同步，减少重复填写。持续涨粉趋势需后续采样；这是用途建议。 |
| 用户 `card` → 昵称、头像 | `data.card` 下的 `level_info.current_level`、`sign`、`official_verify`、`pendant.image`：账号等级、签名、认证、头像挂件 | 丰富中奖者名片；等级不是直播荣耀等级，也不代表信誉。外观信息优先级较低。 |
| 视频 `view` → ID、作者、标题、发布时间 | `data.{pic,duration,desc,stat}`：封面、时长、简介、播放/点赞/评论统计 | 抽奖来源预览，直观看出选了哪个视频。[yt-dlp](https://github.com/yt-dlp/yt-dlp/blob/51bab8a0116f4d8004c315706d809782607d5847/yt_dlp/extractor/bilibili.py#L801-L815) 已用 `pic/desc/stat` 输出封面、简介和互动元信息；其此处来自网页 `videoData`，不是同一个 HTTP 端点。 |
| 评论接口 → UID、昵称、正文、时间、等级 | `data.replies[]` 下的 `member.avatar`、`like`：评论者头像、该评论获赞；`root/parent/rcount/replies`：楼层关系和子回复 | 复用头像做中奖者卡，按获赞选精选评论；说明楼中楼是否纳入。现有代码只采顶层评论，完整楼中楼还要额外分页，不能把内嵌预览当全量。 |
| `DANMU_MSG` → 正文、身份、头像、表情 | `info[0][15].extra` 中的回复对象，例如 `reply_uname`（另有 `reply.reply_uname` 结构） | 显示“谁在回复谁”。[blivechat](https://github.com/xfgryujk/blivechat/blob/848409df78d2cca65d3cc8ffe938eb6b6f261b76/services/chat.py#L527-L530) 已把回复昵称拼成 `@某人`，这是最直接可复用的现成功能。 |
| 同一条 `DANMU_MSG` | `info[0][1/2/3]`：位置模式、字号、颜色 | 可选保留原生彩色/顶部/底部弹幕，或导出回放。[录播姬](https://github.com/BililiveRecorder/BililiveRecorder/blob/2744d605b93fec44d00a7957de93ec3148e412fc/BililiveRecorder.Core/Danmaku/BasicDanmakuWriter.cs#L134-L149) 已实际写入兼容 XML。 |

我建议先考虑 **回复对象、抽奖来源预览、评论头像复用**，都能改善已有功能。粉丝目标和公告同步有明确展示需求再接；其余字段不用为了齐全全部保存。

源码核对位置：[HTTP 资料投影](../../src/bilibili/danmaku/api-client.js)、[视频/评论投影](../../src/bilibili/dynamic-lottery/provider-parsers.js)、[弹幕解析](../../src/bilibili/parsers/danmaku-parser.js)、[消息消费](../../src/bilibili/danmaku/message-handlers.js)。匿名公开样例的房间初始化、主播资料、用户卡、视频资料、评论接口已返回上述 HTTP 字段；没有据此承诺所有账号/场景都能返回，也未用真实账号做直播验证。

避免重复建设：表情 URL/尺寸已使用；`room_init.live_time` 已用于[心愿单场次](../../src/bilibili/gift/wish-session.js)，分区已用于开播问候，舰队人数/陪伴天数已有消费者。房间初始化还有封禁、加密及横竖屏标记，可供以后做连接错误解释或布局提示；字幕和完整楼中楼则需要额外请求，不算现有 JSON 随手可用的全量资料。

原采集问题及修复证据见[审查](2026-10-10-bilibili-ingestion-reuse-audit.md)与[修复记录](../../specs/plans/archive/2026-10-10-bilibili-ingestion-fixes.md)。
