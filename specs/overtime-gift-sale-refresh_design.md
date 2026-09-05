# Feature: 加班机在售礼物刷新

## Requirements (EARS Format)

- 管理端打开礼物选择器或点击“刷新在售礼物”时，应从有效 Bilibili 直播间的 `giftData`、`giftConfig` 和当前盲盒配置读取当前可送礼物；个人账号背包不得扩展该目录，服务器全局目录也不得覆盖该主目录。
- 当礼物同时出现在主列表、升级礼物或活动标签页时，系统应去重后保留该礼物。
- 当礼物当前在售时，系统应按礼物 ID 从服务器目录解析图片；同名礼物必须保持各自 ID 对应的图片，不得按名称合并。
- 当礼物当前在售但服务器目录或图片暂时不可用时，系统仍应使用占位图把它列入加班机选择器；“发红包”（ID 13000）作为操作入口固定排除。
- 当礼物面板中的盲盒当前在售时，系统应把盲盒本体和 `giftBlindBoxConfig` 中该盲盒的每个可开出礼物分别计为在售。
- 对当前直播间目录没有的礼物，用户应能按礼物名称关键字或礼物 ID 搜索首次授权后落盘的付费全局目录并将其加入加班规则；搜索本身不得发起网络请求，即使该礼物当前未在售。
- 系统不得读取或打包三份旧礼物 Markdown、`bilibili-gifts.json` 或 `public/img/bilibili-gifts/` 静态图库。
- 当刷新失败时，系统应保留最后一次成功目录和既有加班规则，并向管理端显示可理解的错误。
- 礼物选择器和既有加班规则不显示单个礼物的在售状态，也不按该状态高亮、自动删除或禁用规则。
- 当既有规则仍保存 `/img/bilibili-gifts/...` 图片路径时，系统应按规则中的礼物 ID 替换为当前服务器图片缓存路径；无法解析时只降级为占位图，不得删除规则。

## Architecture

### Frontend

- `public/pages/admin/toolbox/overtime.html` 显示“在售目录 / 刷新在售礼物”，并在礼物名称输入框右侧提供“搜索全部礼物”。
- `public/js/admin/overtime.js` 从 `/api/overtime/gifts` 读取当前直播间缓存，通过 `POST /api/overtime/gifts/refresh` 主动刷新，并通过 `POST /api/overtime/gifts/local/search` 搜索本机付费全局目录；远程 `gift-catalog:update` 只更新全局缓存元数据，不得把全局目录当作当前直播间主目录。
- 礼物选择器默认展示当前直播间目录；大航海事件保持现有独立选项。用户执行全局本地搜索后可选择当前未在目录中的付费礼物。
- 全局搜索统一显示“礼物库”，不加“本地”前缀；礼物条目与既有规则不计算或显示“目录中/当前未在售”状态，不使用 `innerHTML` 渲染远程数据。
- `public/js/admin/gifts/recent.js` 从 `GET /api/overtime/gifts/catalog` 读取完整的本地按 ID 图片映射，用于盲盒和单价至少 1000 元的最近礼物，不再读取静态 JSON 或硬编码 Bilibili 盲盒图片路径。

### Backend

- `src/bilibili/gift/sale-catalog.js` 负责固定 Bilibili 礼物面板/配置接口访问、响应校验、在售 ID 展平和盲盒展开，不接收 Cookie，也不读取本地图片映射。
- `src/bilibili/gift/remote-catalog-cache.js` 负责服务器扁平目录的 ETag 条件请求、付费子集内存/磁盘缓存、单飞刷新和 stale 保留；`gift-catalog-initializer.js` 扫描完整付费目录并准备图片；`hybrid-catalog.js` 按精确礼物 ID 把本地图片装饰到房间目录，并用全局快照支持本地搜索。
- `GET /api/overtime/gifts` 返回当前房间目录的最后一次成功快照；`POST /api/overtime/gifts/refresh` 使用设置中的直播间号刷新礼物面板和盲盒，然后缓存这些 ID 对应的服务器图片。
- `GET /api/overtime/gifts/catalog` 返回本机付费全局目录及当前可用图片路径；`POST /api/overtime/gifts/local/search` 按名称或 ID 返回至多 100 个本地匹配项，二者都不发起远程请求，也不修改在售快照。
- 既有 `POST /api/overtime/gifts/server/search` 保留路由和响应结构，但只是同一本地搜索的兼容别名，Admin 不调用该别名。
- 房间快照写入 `data/overtime-gift-sale.json`，远程快照写入 `data/overtime-gift-catalog.json`；二者只保存元数据，不包含图片字节。旧版无 schema 版本的房间快照可能混有个人背包礼物，升级后不再读取，首次打开礼物选择器时重新按房间刷新。
- 服务器端目录通过 `GET /api/public/gifts/catalog` 一次返回，客户端在首次授权初始化、后续授权恢复和低频轮询时条件请求，304 或网络失败都复用旧缓存；客户端只把 `coinType === 'gold' && priceRaw > 0` 的快照写入 `data/overtime-gift-catalog.json`。
- 首次授权先按目录中的安全 Bilibili `sourceUrl` 下载全部付费礼物图片到 `data/overtime-gift-images/`，没有源地址或下载失败时回退配置服务器的 `/gift-media/images/<basename>`。图片按礼物 ID 和源 URL hash 命名并通过本地 `/overtime-gift-images/<basename>` 展示；单张失败只使用占位图，后续启动继续补齐。
- 旧的背包图集同步脚本随静态图库一起删除；房间目录诊断脚本保留，但不再读取 `publicDir`，新安装包显式排除旧资源路径。

### Security

- API 继续使用现有 session token 鉴权，客户端不能提交 URL 或直播间号。
- 远程公共目录只由 Electron main process 使用已配置的 `LIRA_LICENSE_API_BASE` 访问；配置只接受使用有效 DNS 主机名且无凭据、无子路径/查询/片段的 HTTPS 根 origin，HTTP、`localhost` 和 IP literal 均被拒绝。设备 token 不进入 renderer，也不作为公共目录的必需鉴权。
- 上游 URL 固定为 Bilibili 官方 HTTPS 礼物面板/配置接口，禁止调用方控制目标，避免 SSRF；不再请求账号背包接口或传递 Bilibili Cookie。
- 每次 Bilibili 房间目录请求设 15 秒超时，十秒内重复刷新返回缓存并合并并发刷新。服务器目录后台轮询使用更低频的条件请求；搜索只读取本地快照，初始化失败重试才强制发起目录请求。
- 本地 API 只返回目录所需的显式字段。首选图片源仅允许 HTTPS `hdslb.com` 或其子域，不允许凭据、非默认端口或片段；服务器回退源仅允许已配置 API origin 下的 `/gift-media/images/<basename>`。下载禁止重定向、限制 15 秒和 5 MiB，并校验 raster 图片签名。
- 礼物名称通过 DOM `textContent` 输出；未知图片只使用内置占位图。
- 客户端不解析 Markdown 或静态礼物 manifest；服务器目录和房间接口响应均按显式字段规范化。
- 全局本地搜索查询去除首尾空白后必须为 1–100 个字符；服务端不接受客户端提交 URL、图片文件名或路径。
- 远程 `imageUrl` 只接受配置 API origin 下的 `/gift-media/images/<basename>` 路径；其他来源和路径遍历值使用占位图。新规则保存本地 `/overtime-gift-images/<basename>`，并兼容既有已验证服务器绝对 URL。

## In-Sale Definition

“在售”在此功能中表示礼物出现在指定直播间当前 Web 礼物面板，来源包括：

- `data.room_gift_list.gold_list`
- `data.room_gift_list.silver_list`
- 主列表条目的 `upgrade_gift`
- `data.tab_list[].list`
- 标签页条目的 `upgrade_gift`
- `data.discount_gift_list` 中可识别的礼物数组

在售盲盒会按设置中的 `giftBlindBoxConfig` 展开产物；产物通过礼物名称和人民币价格匹配当前 `giftConfig`，不读取个人背包。盲盒本体和每个产物使用各自礼物 ID，分别进入目录和计数。无法从礼物面板或配置识别的活动礼物仍可通过全局本地搜索手动加入，且不会写入在售快照。

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
- 成功：`200`，返回更新后的同一快照结构；能在服务器目录按 ID 匹配且下载成功的图片使用 `/overtime-gift-images/<basename>`。
- 未设置直播间号或上游响应无效：`400`，保留旧缓存。
- 十秒内重复刷新返回缓存快照并标记 `cached: true`，避免连续请求 Bilibili 接口；并发刷新继续单飞。

是否配置远程目录回调不改变该端点的当前直播间成员范围；没有可用服务器快照时图片为空并由界面使用占位图。

### `GET /api/overtime/gifts/catalog`

- 请求体：无。
- 成功：`200`，返回本机已持久化的全部付费礼物元数据；每项 `imagePath` 只在对应本地图片校验通过时为 `/overtime-gift-images/<basename>`。
- 目录尚未初始化时：`200` 且 `data` 为 `null`；首次授权导航门控负责在进入 Admin 前完成初始化。

### `POST /api/overtime/gifts/local/search`

- 请求体：`{ "query": "万象" }`，也可传完整或部分数字 ID。
- 成功：`200`，返回 `{ "query": "万象", "count": 1, "gifts": [...] }`；已准备图片的结果使用本地 `/overtime-gift-images/<basename>`。
- 空查询或超过 100 个字符：`400`；没有本地全局目录快照时返回 `400`，没有匹配项时返回空数组。
- 搜索不发起服务器或 Bilibili 请求，也不修改当前直播间在售快照。

### `POST /api/overtime/gifts/server/search`

- 兼容别名：请求、响应和错误语义与 `/local/search` 完全相同。
- 不发起服务器刷新，不读取 Markdown 或静态图片目录；Admin 不再调用。

## Acceptance Criteria

- 刷新只请求 Bilibili `giftData` 和 `giftConfig`，不请求个人背包或读取本地 Markdown。
- 除“发红包”（ID 13000）外，刷新返回的每个在售 ID 都能出现在加班机选择器，即使只能显示占位图。
- 在售盲盒本体和映射中的所有可开出礼物均分别出现在目录中；未在售盲盒不展开产物。
- 同名不同 ID 的礼物按 ID 获取各自服务器图片；不存在按名称复用图片的路径。
- 首次授权在进入 Admin 前完成付费目录和完整图片扫描；已完成用户立即进入并在后台增量补齐，单张图片失败不会永久阻塞。
- 全局本地搜索支持名称关键字和 ID，至多返回 100 个付费目录匹配项，处理查询期间不发起网络请求；旧服务器搜索端点只保留为同一本地操作的兼容别名。
- 已选择但下架的规则仍保留，礼物条目和规则均不显示在售状态或对应高亮。
- 已保存的 `/img/bilibili-gifts/...` 规则图片按礼物 ID 替换为服务器图片缓存路径，无法替换时规则仍保留并使用占位图。
- 未授权请求仍返回 `401`；缺少直播间号不会发起上游请求。
- 已配置远程目录时，首次授权初始化发起一次远程目录请求；后续授权恢复和轮询携带 `If-None-Match`，304 不替换礼物数组；目录版本变化触发后台图片增量扫描并通过本地 WebSocket 更新全局缓存，但不覆盖当前直播间主目录。
- 远程目录及其图片只接受配置的、使用有效 DNS 主机名的 HTTPS 根 origin；HTTP、`localhost`、IP literal、跨 origin、带凭据/查询/片段和非根基址均被拒绝，且不改变规则、结算或 overlay 的本地数据边界。
- 源码树、新构建的 `app.asar` 和安装包均不包含 `public/img/bilibili-gifts/`、`public/img/bilibili-gifts.json` 或其维护脚本。
- `npm run check` 与 `npm test` 通过。
