# Feature: 加班机在售礼物刷新

## Requirements (EARS Format)

- 管理端打开礼物选择器或点击“刷新在售礼物”时，应从有效 Bilibili 直播间的官方礼物面板、当前盲盒配置和当前账号可用背包读取当前可送礼物；已配置的服务器全局目录不得覆盖该主目录。
- 当礼物同时出现在主列表、升级礼物或活动标签页时，系统应去重后保留该礼物。
- 当礼物当前在售且能在本地 Markdown 映射中找到自身或“同特效代码”时，系统应复用对应本地图片。
- 当礼物当前在售但没有本地图片时，系统仍应使用占位图把它列入加班机选择器；“发红包”（ID 13000）作为操作入口固定排除。
- 当礼物面板中的盲盒当前在售时，系统应把盲盒本体和 `giftBlindBoxConfig` 中该盲盒的每个可开出礼物分别计为在售。
- 当 Bilibili 账号已登录时，系统应读取该账号针对当前直播间返回的实时背包，并把其中数量大于零、未过期且未绑定到其他直播间的礼物加入可用目录；该结果只表示当前可送，不表示活动仍在开放。
- 系统不得用固定礼物 ID 或固定数量描述当前背包，也不得仅因礼物配置中的 `bag_gift` 标记扫描历史背包礼物；未登录时跳过实时背包读取，礼物面板刷新仍可继续。
- 对当前直播间目录没有的礼物，用户应能按礼物名称关键字或礼物 ID 搜索服务器全局目录并将其加入加班规则；服务器有图片的匹配项应先下载到本机缓存后显示，即使该礼物当前未在售。
- 当刷新成功时，系统不得修改三份礼物 Markdown；这些文档只作为本地图片和别名映射来源。
- 当刷新失败时，系统应保留最后一次成功目录和既有加班规则，并向管理端显示可理解的错误。
- 当既有加班规则中的礼物已不在售时，系统应标记该规则，但不得自动删除或禁用它。

## Architecture

### Frontend

- `public/pages/admin/toolbox/overtime.html` 显示“在售目录 / 刷新在售礼物”，并在礼物名称输入框右侧提供“搜索服务器礼物”。
- `public/js/admin/overtime.js` 从 `/api/overtime/gifts` 读取当前直播间缓存，通过 `POST /api/overtime/gifts/refresh` 主动刷新，并通过 `POST /api/overtime/gifts/server/search` 按需搜索服务器礼物；远程 `gift-catalog:update` 只表示服务器搜索缓存更新，不得覆盖当前直播间主目录。
- 礼物选择器默认展示当前直播间目录；大航海事件保持现有独立选项。用户执行服务器搜索后可选择当前未在目录中的服务器礼物。
- 既有规则根据当前目录增加“在售/当前未在售”状态，不使用 `innerHTML` 渲染远程数据。

### Backend

- `src/bilibili/gift/sale-catalog.js` 负责兼容模式下的固定 Bilibili 接口访问、响应校验、在售 ID 展平和只读 Markdown 映射解析。
- `src/bilibili/gift/remote-catalog-cache.js` 负责服务器扁平目录的 ETag 条件请求、内存/磁盘缓存、单飞刷新和 stale 保留；`src/bilibili/gift/hybrid-catalog.js` 始终把房间目录用于主读取/刷新，并只把远程快照用于服务器搜索。
- `GET /api/overtime/gifts` 返回本地房间目录的最后一次成功快照；`POST /api/overtime/gifts/refresh` 使用设置中的直播间号刷新礼物面板、盲盒和当前账号背包。
- `POST /api/overtime/gifts/server/search` 对服务器目录执行条件刷新后按名称或 ID 返回至多 100 个匹配项，不修改在售快照；远程失败但已有快照时可继续搜索旧缓存。
- 既有 `POST /api/overtime/gifts/local/search` 继续只读三份固定 Markdown，作为兼容端点保留，但 Admin 不再使用它。
- 快照写入 `data/overtime-gift-sale.json`；三份 Markdown 永远只读，因此安装版不依赖修改 `asar` 内容。
- 远程快照写入 `data/overtime-gift-catalog.json`；服务器端目录通过 `GET /api/public/gifts/catalog` 一次返回，客户端在授权恢复、低频轮询和显式服务器搜索时条件请求，304 或网络失败都复用旧缓存。
- 服务器搜索命中的图片从配置服务器的 `/gift-media/images/<basename>` 下载到 `data/overtime-gift-images/`，通过本地 `/overtime-gift-images/<basename>` 展示；单张图片失败只使用占位图。
- `scripts/refresh-bilibili-gift-sale.js` 复用同一服务，支持 `--room-id <id>`，未传时读取默认数据目录中的设置。

### Security

- API 继续使用现有 session token 鉴权，客户端不能提交 URL 或直播间号。
- 远程公共目录只由 Electron main process 使用已配置的 `LIRA_LICENSE_API_BASE` 访问；生产使用 HTTPS，测试 SSH 只允许显式 `http://127.0.0.1:<port>` loopback。设备 token 不进入 renderer，也不作为公共目录的必需鉴权。
- 上游 URL 固定为 Bilibili 官方 HTTPS 域名，禁止调用方控制目标，避免 SSRF。
- 每次 Bilibili 房间目录请求设 15 秒超时，十秒内重复刷新返回缓存并合并并发刷新。服务器目录后台轮询使用更低频的条件请求；“搜索服务器礼物”可强制发起一次条件请求，以便失败后立即重试。
- 只返回 `id`、`name`、`battery`、`rmb`、`imagePath` 等显式字段；服务器图片源仅允许已配置 API origin 下的 `/gift-media/images/<basename>`，下载禁止重定向、限制 15 秒和 5 MiB，并校验 raster 图片签名。
- 礼物名称通过 DOM `textContent` 输出；未知图片只使用内置占位图。
- Markdown 只从三个固定路径读取，刷新过程不写入任何文档文件。
- 服务器搜索查询去除首尾空白后必须为 1–100 个字符；服务端不接受客户端提交 URL、图片文件名或路径。
- 远程 `imageUrl` 只接受配置 API origin 下的 `/gift-media/images/<basename>` 路径；其他来源和路径遍历值使用占位图。新规则保存本地 `/overtime-gift-images/<basename>`，并兼容既有已验证服务器绝对 URL。

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

个人背包只说明当前账号已经持有什么，不能证明对应活动仍在开放。活动奖池无法从礼物面板和个人背包识别时，用户可通过服务器搜索手动加入全局目录礼物；该操作不会把礼物写入在售快照，规则仍显示“当前未在售”。

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
- 十秒内重复刷新返回缓存快照并标记 `cached: true`，避免连续请求 Bilibili 接口；并发刷新继续单飞。

是否配置远程目录回调不改变该端点的当前直播间语义。

### `POST /api/overtime/gifts/server/search`

- 请求体：`{ "query": "万象" }`，也可传完整或部分数字 ID。
- 成功：`200`，返回 `{ "query": "万象", "count": 1, "gifts": [...] }`；有服务器图片的结果使用本地 `/overtime-gift-images/<basename>`。
- 空查询或超过 100 个字符：`400`；没有远程快照且服务器不可用时返回 `400`，已有旧快照时从旧快照搜索。
- 搜索不修改当前直播间在售快照。

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
- 服务器礼物搜索支持名称关键字和 ID，至多返回 100 个全局目录匹配项；能从服务器缓存下载的图片以本地同源路径显示和保存，即使礼物不在当前直播间目录中。
- 旧本地礼物搜索端点继续支持名称关键字和 ID，只返回 Markdown 已映射且图片文件实际存在的礼物，但不再作为 Admin 入口。
- 已选择但下架的规则仍保留，并在界面显示“当前未在售”。
- 未授权请求仍返回 `401`；缺少直播间号不会发起上游请求。
- 已配置远程目录时，首次授权恢复后发起一次远程目录请求；后续轮询和服务器搜索携带 `If-None-Match`，304 不替换礼物数组；目录版本变化通过本地 WebSocket 更新搜索缓存但不覆盖当前直播间主目录。
- SSH loopback 与 ICP 备案后的 HTTPS 使用相同相对 API 路径和响应结构；切换入口只改变 `LIRA_LICENSE_API_BASE`，不改变规则、结算或 overlay 的本地数据边界。
- `npm run check` 与 `npm test` 通过。
