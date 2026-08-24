# Feature: 加班机在售礼物刷新

## Requirements (EARS Format)

- 当管理端已有有效 Bilibili 直播间号时，用户点击“刷新在售礼物”，系统应从官方礼物面板接口读取该直播间当前展示的礼物 ID。
- 当礼物同时出现在主列表、升级礼物或活动标签页时，系统应去重后保留该礼物。
- 当礼物当前在售且能在本地 Markdown 映射中找到自身或“同特效代码”时，系统应复用对应本地图片。
- 当礼物当前在售但没有本地图片时，系统仍应使用占位图把它列入加班机选择器；“发红包”（ID 13000）作为操作入口固定排除。
- 当礼物面板中的盲盒当前在售时，系统应把盲盒本体和 `giftBlindBoxConfig` 中该盲盒的每个可开出礼物分别计为在售。
- 当 Bilibili 账号已登录时，系统应读取该账号针对当前直播间返回的实时背包，并把其中数量大于零、未过期且未绑定到其他直播间的礼物加入可用目录。
- 系统不得用固定礼物 ID 或固定数量描述当前背包，也不得仅因礼物配置中的 `bag_gift` 标记扫描历史背包礼物；未登录时跳过实时背包读取，礼物面板刷新仍可继续。
- 当刷新成功时，系统不得修改三份礼物 Markdown；这些文档只作为本地图片和别名映射来源。
- 当刷新失败时，系统应保留最后一次成功目录和既有加班规则，并向管理端显示可理解的错误。
- 当既有加班规则中的礼物已不在售时，系统应标记该规则，但不得自动删除或禁用它。

## Architecture

### Frontend

- `public/pages/admin/toolbox/overtime.html` 增加刷新按钮和目录状态文本。
- `public/js/admin/overtime.js` 改为从 `/api/overtime/gifts` 读取最后一次成功目录，并通过 `POST /api/overtime/gifts/refresh` 主动刷新。
- 礼物选择器只展示在售目录；大航海事件保持现有独立选项。
- 既有规则根据当前目录增加“在售/当前未在售”状态，不使用 `innerHTML` 渲染远程数据。

### Backend

- `src/bilibili/gift/sale-catalog.js` 负责固定 Bilibili 接口访问、响应校验、在售 ID 展平、只读 Markdown 映射解析、目录构建和缓存持久化。
- `GET /api/overtime/gifts` 返回最后一次成功快照；`POST /api/overtime/gifts/refresh` 使用服务端设置里的直播间号刷新。
- 快照写入 `data/overtime-gift-sale.json`；三份 Markdown 永远只读，因此安装版不依赖修改 `asar` 内容。
- `scripts/refresh-bilibili-gift-sale.js` 复用同一服务，支持 `--room-id <id>`，未传时读取默认数据目录中的设置。

### Security

- API 继续使用现有 session token 鉴权，客户端不能提交 URL 或直播间号。
- 上游 URL 固定为 Bilibili 官方 HTTPS 域名，禁止调用方控制目标，避免 SSRF。
- 每次请求设 15 秒超时；刷新最短间隔 10 秒，并合并并发刷新。
- 只返回 `id`、`name`、`battery`、`rmb`、`imagePath` 等显式字段。
- 礼物名称通过 DOM `textContent` 输出；未知图片只使用内置占位图。
- Markdown 只从三个固定路径读取，刷新过程不写入任何文档文件。

## In-Sale Definition

“在售”在此功能中表示礼物出现在指定直播间当前 Web 礼物面板，来源包括：

- `data.room_gift_list.gold_list`
- `data.room_gift_list.silver_list`
- 主列表条目的 `upgrade_gift`
- `data.tab_list[].list`
- 标签页条目的 `upgrade_gift`
- `data.discount_gift_list` 中可识别的礼物数组

在售盲盒会按设置中的 `giftBlindBoxConfig` 展开产物；产物通过礼物名称和人民币价格匹配官方礼物配置，同名同价时优先非背包版本。盲盒本体和每个产物使用各自礼物 ID，分别进入目录和计数。

当 Electron 中已有 Bilibili 登录 Cookie 时，刷新还会请求当前账号的实时礼物背包。系统直接使用接口当次返回的礼物 ID，不限制礼物数量；只保留数量大于零、尚未过期且没有绑定到其他直播间的条目。旧礼物不会因为仍残留在 `giftConfig` 且带有 `bag_gift` 标记而被推断为可用。背包礼物沿用本地 ID 图片映射，没有本地图片时继续使用占位图；`panelCount` 只统计礼物面板原始 ID。

`special.is_use` 表示当前账号是否满足赠送条件，不用于判定是否在售；例如等级礼物和大航海专属礼物仍属于当前面板礼物。

## API

### `GET /api/overtime/gifts`

```json
{
  "ok": true,
  "data": {
    "roomId": "22637261",
    "refreshedAt": "2026-08-16T06:00:00.000Z",
    "gifts": [],
    "count": 0
  }
}
```

### `POST /api/overtime/gifts/refresh`

- 请求体：空对象。
- 成功：`200`，返回更新后的同一快照结构。
- 未设置直播间号或上游响应无效：`400`，保留旧缓存。
- 十秒内重复刷新：返回缓存快照并标记 `cached: true`，避免连续打接口。

## Acceptance Criteria

- 刷新前后三份 Markdown 内容保持完全不变。
- 同特效别名在售时，其主行显示“在售”。
- 除“发红包”（ID 13000）外，刷新返回的每个在售 ID 都能出现在加班机选择器，即使只能显示占位图。
- 在售盲盒本体和映射中的所有可开出礼物均分别出现在目录中；未在售盲盒不展开产物。
- 当前账号实时背包中数量大于零、未过期且适用于当前直播间的任意数量礼物均出现在目录中；未出现在实时背包的历史礼物不因 `bag_gift` 标记自动出现。
- 已选择但下架的规则仍保留，并在界面显示“当前未在售”。
- 未授权请求仍返回 `401`；缺少直播间号不会发起上游请求。
- `npm run check` 与 `npm test` 通过。
