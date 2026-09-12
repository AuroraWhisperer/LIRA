# 点歌与播放时序

弹幕点歌在本地歌库匹配并入队。播放器选中曲目后，独立执行在线音源搜索、匹配及流地址解析；入队本身不调用 QQ 搜索，也不保证自动开始播放。

拥有者：[命令处理](../../../src/bilibili/bilibili-message-handler.js)、[领域装配](../../../src/server/domain-services.js)、[队列服务](../../../src/music/queue-service.js)、[队列存储](../../../src/storage/queue-store.js)、[音乐路由](../../../src/server/routes/music-routes.js)、[播放路由](../../../src/server/routes/playback-routes.js)。

```mermaid
sequenceDiagram
    actor Viewer as 观众
    participant BL as B站弹幕通道
    participant CMD as 本地点歌命令处理
    participant QS as 队列服务
    participant DB as 本地歌库与队列存储
    participant WS as 本地WebSocket
    participant UI as 管理页与队列浏览器源
    Viewer->>BL: 点歌 夜曲
    BL->>CMD: 已解析的弹幕
    CMD->>DB: resolveSongRequest 本地歌名匹配
    CMD->>QS: addQueueItem
    QS->>QS: 容量、重复与歌库限制校验
    QS->>DB: songs.find 与 insertRequest 事务
    DB-->>QS: 队列项
    QS-->>CMD: accepted 与 queueItem
    CMD->>WS: broadcastSnapshot bilibili:danmaku
    WS-->>UI: snapshot 队列状态
```

队列的请求人身份只在相应领域使用，公开页面使用各自的投影。点歌确认弹幕取决于机器人设置，不是每次入队的固定步骤。

```mermaid
sequenceDiagram
    actor User as 主播或播放器队列
    participant FE as 播放引擎
    participant API as 本地音乐与播放API
    participant P as 选定的音乐Provider
    participant CDN as 音频来源
    participant WS as 本地WebSocket
    participant Lyric as 歌词消费者
    User->>FE: 选择要播放的曲目
    opt 需要在线搜索与匹配
        FE->>API: POST /api/music/search 等音乐查询
        API->>P: 搜索候选
        P-->>API: 候选音轨
        API-->>FE: JSON 音轨结果
    end
    FE->>API: POST /api/music/resolve-stream
    API->>P: resolvePlayableUrl
    P-->>API: 流描述与有效期
    API-->>FE: JSON ok/data，含播放URL
    FE->>CDN: 播放URL请求，QQ加密流经本地解密路由
    FE->>API: POST /api/music/lyrics
    API->>P: 获取歌词
    API-->>FE: 歌词数据
    FE->>API: POST /api/playback/lyric-timeline 与 lyric-state
    API->>WS: lyric-timeline 与 lyric-state
    WS-->>Lyric: 时间轴与当前播放进度
    FE->>API: POST /api/playback/history
```

本地文件和全民 K 歌分别走本地媒体与采集通道；详细播放/歌词消息约束见 [music/services.md](../backend/music/services.md) 和 [ws.md](../backend/ws.md)。
