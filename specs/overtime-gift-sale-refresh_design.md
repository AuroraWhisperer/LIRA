# Feature: 加班机在售礼物刷新

## Requirements (EARS Format)

- 当桌面端已配置远程礼物目录时，管理端打开或点击“同步服务器礼物”应从服务器全局目录读取 active 礼物代码；没有远程目录回调的兼容模式下，才从有效 Bilibili 直播间的官方礼物面板接口读取当前展示的礼物 ID。
- 当礼物同时出现在主列表、升级礼物或活动标签页时，系统应去重后保留该礼物。
- 当礼物当前在售且能在本地 Markdown 映射中找到自身或“同特效代码”时，系统应复用对应本地图片。
- 当礼物当前在售但没有本地图片时，系统仍应使用占位图把它列入加班机选择器；“发红包”（ID 13000）作为操作入口固定排除。
- 当礼物面板中的盲盒当前在售时，系统应把盲盒本体和 `giftBlindBoxConfig` 中该盲盒的每个可开出礼物分别计为在售。
- 当 Bilibili 账号已登录时，系统应读取该账号针对当前直播间返回的实时背包，并把其中数量大于零、未过期且未绑定到其他直播间的礼物加入可用目录；该结果只表示当前可送，不表示活动仍在开放。
- 系统不得用固定礼物 ID 或固定数量描述当前背包，也不得仅因礼物配置中的 `bag_gift` 标记扫描历史背包礼物；未登录时跳过实时背包读取，礼物面板刷新仍可继续。
- 对自动刷新无法捕获的礼物，用户应能按礼物名称关键字或礼物 ID 搜索本地 Markdown 映射中已有实际图片的礼物，并将其加入加班规则，即使该礼物当前未在售。
- 当刷新成功时，系统不得修改三份礼物 Markdown；这些文档只作为本地图片和别名映射来源。
- 当刷新失败时，系统应保留最后一次成功目录和既有加班规则，并向管理端显示可理解的错误。
- 当既有加班规则中的礼物已不在售时，系统应标记该规则，但不得自动删除或禁用它。

## Architecture

### Frontend

- `public/pages/admin/toolbox/overtime.html` 增加刷新按钮、目录状态文本，并在礼物名称输入框右侧增加“搜索本地礼物”按钮。
- `public/js/admin/overtime.js` 从 `/api/overtime/gifts` 读取本地运行时缓存，通过 `POST /api/overtime/gifts/refresh` 主动同步，并通过 `POST /api/overtime/gifts/local/search` 按需搜索本地礼物；远程目录变化由本地 WebSocket 的 `gift-catalog:update` 事件即时应用。
- 礼物选择器默认展示服务器全局目录（无远程回调时回退到房间目录）；大航海事件保持现有独立选项。用户执行本地搜索后可选择当前未在目录中的本地礼物。
- 既有规则根据当前目录增加“在售/当前未在售”状态，不使用 `innerHTML` 渲染远程数据。

### Backend

- `src/bilibili/gift/sale-catalog.js` 负责兼容模式下的固定 Bilibili 接口访问、响应校验、在售 ID 展平和只读 Markdown 映射解析。
- `src/bilibili/gift/remote-catalog-cache.js` 负责服务器扁平目录的 ETag 条件请求、内存/磁盘缓存、单飞刷新和 stale 保留；`src/bilibili/gift/hybrid-catalog.js` 优先返回远程快照并保留房间目录 fallback。
- `GET /api/overtime/gifts` 返回本地缓存的最后一次成功快照；`POST /api/overtime/gifts/refresh` 优先同步服务器目录，没有远程回调时才使用设置中的直播间号刷新。
- `POST /api/overtime/gifts/local/search` 只读取三份固定 Markdown 及其指向的本地图片，按名称或 ID 返回至多 100 个匹配项，不修改在售快照。
- 快照写入 `data/overtime-gift-sale.json`；三份 Markdown 永远只读，因此安装版不依赖修改 `asar` 内容。
- 远程快照写入 `data/overtime-gift-catalog.json`；服务器端目录通过 `GET /api/public/gifts/catalog` 一次返回，客户端只在授权恢复和低频轮询时条件请求，304 或网络失败都复用旧缓存。
- `scripts/refresh-bilibili-gift-sale.js` 复用同一服务，支持 `--room-id <id>`，未传时读取默认数据目录中的设置。

### Security

- API 继续使用现有 session token 鉴权，客户端不能提交 URL 或直播间号。
- 远程公共目录只由 Electron main process 使用已配置的 `LIRA_LICENSE_API_BASE` 访问；生产使用 HTTPS，测试 SSH 只允许显式 `http://127.0.0.1:<port>` loopback。设备 token 不进入 renderer，也不作为公共目录的必需鉴权。
- 上游 URL 固定为 Bilibili 官方 HTTPS 域名，禁止调用方控制目标，避免 SSRF。
- 每次上游请求设 15 秒超时；兼容的本地房间目录后台刷新最短间隔 10 秒，并合并并发刷新。服务器目录后台轮询使用更低频的条件请求；管理端“同步服务器礼物”按钮可强制发起一次条件请求，以便失败后立即重试。
- 只返回 `id`、`name`、`battery`、`rmb`、`imagePath` 等显式字段；服务器目录图片仅来自已配置 API origin 下的 `/gift-media/images/<basename>`。
- 礼物名称通过 DOM `textContent` 输出；未知图片只使用内置占位图。
- Markdown 只从三个固定路径读取，刷新过程不写入任何文档文件。
- 本地搜索查询去除首尾空白后必须为 1–100 个字符；服务端只接受内置图片目录中的现存文件，不接受客户端提交路径。
- 远程 `imageUrl` 只接受配置 API origin 下的 `/gift-media/images/<basename>` 路径；其他来源和路径遍历值使用占位图，规则保存也只允许该已配置 origin。

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

个人背包只说明当前账号已经持有什么，不能证明对应活动仍在开放。活动奖池无法从礼物面板和个人背包识别时，用户可通过本地搜索手动加入已下载图片的礼物；该操作不会把礼物写入在售快照，规则仍显示“当前未在售”。

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
- 兼容模式下十秒内重复刷新：返回缓存快照并标记 `cached: true`，避免连续打 Bilibili 接口；服务器目录的手动同步显式绕过其后台最小间隔，但仍使用单飞和 ETag。

桌面端存在远程目录回调时，该接口使用 `GET /api/public/gifts/catalog` 的 ETag 条件请求；远程目录没有成功快照或请求失败时保留已有远程快照。没有配置远程回调的旧部署继续执行上面的房间礼物面板刷新。

### `POST /api/overtime/gifts/local/search`

- 请求体：`{ "query": "万象" }`，也可传完整或部分数字 ID。
- 成功：`200`，返回 `{ "query": "万象", "count": 1, "gifts": [...] }`。
- 空查询或超过 100 个字符：`400`；没有匹配项时返回空数组。

## Acceptance Criteria

- 刷新前后三份 Markdown 内容保持完全不变。
- 同特效别名在售时，其主行显示“在售”。
- 除“发红包”（ID 13000）外，刷新返回的每个在售 ID 都能出现在加班机选择器，即使只能显示占位图。
- 在售盲盒本体和映射中的所有可开出礼物均分别出现在目录中；未在售盲盒不展开产物。
- 当前账号实时背包中数量大于零、未过期且适用于当前直播间的任意数量礼物均出现在目录中；未出现在实时背包的历史礼物不因 `bag_gift` 标记自动出现。
- 本地礼物搜索支持名称关键字和 ID，只返回 Markdown 已映射且图片文件实际存在的礼物；选中后可保存为规则，即使它不在当前自动刷新目录中。
- 已选择但下架的规则仍保留，并在界面显示“当前未在售”。
- 未授权请求仍返回 `401`；缺少直播间号不会发起上游请求。
- 已配置远程目录时，首次授权恢复后只发起一次远程目录请求；后续轮询携带 `If-None-Match`，304 不替换礼物数组；目录版本变化通过本地 WebSocket 通知已打开的选择器。
- SSH loopback 与 ICP 备案后的 HTTPS 使用相同相对 API 路径和响应结构；切换入口只改变 `LIRA_LICENSE_API_BASE`，不改变规则、结算或 overlay 的本地数据边界。
- `npm run check` 与 `npm test` 通过。
