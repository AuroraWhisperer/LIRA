# 点歌全链路时序图(观众弹幕 → 播放)

> 涉及文件: [src/bilibili/danmaku-client.js](../../../src/bilibili/danmaku-client.js)(WS 二进制帧解析) · [src/bilibili/bilibili-message-handler.js](../../../src/bilibili/bilibili-message-handler.js)(命令解析) · [src/music/queue-service.js](../../../src/music/queue-service.js)(队列) · [src/music/song-matcher.js](../../../src/music/song-matcher.js)(匹配打分) · [src/music/music-cache.js](../../../src/music/music-cache.js)(缓存) · [src/music/providers/qq-provider.js](../../../src/music/providers/qq-provider.js)(上游搜索/流地址) · [src/storage/database.js](../../../src/storage/database.js)(SQLite) · [src/server/ws.js](../../../src/server/ws.js)(快照广播) · [public/js/playback/](../../../public/js/playback/)(播放引擎)

本图由 Mermaid `sequenceDiagram` 渲染(GitHub 原生支持;本地预览用 VSCode Mermaid 插件)。

```mermaid
sequenceDiagram
    actor Viewer as直播间观众
    participant BL as B站直播服务器
    participant DC as BilibiliDanmakuClient
    participant CMD as 命令解析器
    participant QS as QueueService
    participant SM as SongMatcher
    participant CACHE as MusicCache
    participant QQ as QQ音乐Provider
    participant DB as SQLite
    participant WS as WebSocket广播
    participant FE as 播放引擎
    participant OBS as OBS悬浮层

    Viewer->>BL: 发弹幕 "点歌 夜曲"
    BL-->>DC: WS 二进制帧推送
    DC->>DC: protobuf 解析 + 去重过滤

    DC->>CMD: handleDanmaku(danmaku)
    CMD->>CMD: 识别命令类型 → 点歌请求

    CMD->>QS: addRequest(songName, uid)
    QS->>SM: matchSong("夜曲")
    SM->>CACHE: lookup("夜曲")

    alt缓存命中
        CACHE-->>SM: 曲目元数据
    else 缓存未命中
        SM->>QQ: search("夜曲")
        QQ->>QQ: GTK签名 + zzcSign 计算
        QQ-->>SM: 搜索结果列表
        SM->>SM: 多维打分排序
        SM->>CACHE: 写入缓存 (TTL)
    end

    SM-->>QS: 匹配曲目 + 相似度分值
    QS->>DB: INSERT INTO queue (song, uid, pos)
    DB-->>QS: 入队成功
    QS-->>CMD: 回调 → 发送弹幕确认

    CMD->>BL: 发弹幕回复 "已点夜曲 ✓"
    CMD->>WS: broadcastSnapshot('queue:add')

    par WS 广播到所有客户端
        WS-->>FE: 队列快照更新
        WS-->>OBS: 队列悬浮层刷新
    end

    Note over OBS: 队列层实时显示新增曲目

    Note over FE: 当前曲目播放结束
    FE->>QQ: GET /api/music/stream?id=xxx
    QQ->>QQ: 解析播放 URL / 格式协商
    QQ-->>FE: 302 重定向 → 流地址

    FE->>FE: 开始播放 + 加载歌词
    FE->>WS: POST /api/playback/status (playing)
    WS->>WS: broadcastSnapshot('playback:start')

    par 歌词广播
        WS-->>OBS: 歌词快照 + YRC逐字词时间轴
    end

    OBS->>OBS: 桌面歌词层逐字渐显动画
    FE->>DB: 播放记录写入 (history)
```
