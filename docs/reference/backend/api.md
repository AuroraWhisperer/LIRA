# HTTP API 端点注册表

粉丝私人档案不进入本地 HTTP/WS API 或公开状态，使用 [受限 IPC](../desktop/preload.md)。主进程通过 DeviceBearer 调用远端 `LIRA Server: GET /api/device/fan-facts?after=&epoch=&limit=200` 获取可靠 typed identity 与会员观察；scope 来自已认证账号，离线保留本机编辑，旧服务 404 显示同步不可用。契约见 companion Server `docs/protocol/fan-facts.md`、Device OpenAPI 和 fixture；本地实现需求见 [fan-profiles](../../../specs/fan-profiles.md)。

礼物身份扩展（2026-09-13）：本地 `/api/overtime/gifts`、`/api/overtime/gifts/catalog`、搜索响应中的完整礼物增加 `variantId` 与 `giftIdentity: {variantId, priceRaw, coinType, bagGift}`。全局快照以 `variantBlindBoxes` 提供完整官方关系，`blindBoxes` 保留当前投影的兼容关系；同 ID 资料不合并。`/api/overtime/rules` 保存可空 giftIdentity；规则快照增加 `bindingStatus`（bound/needs-selection），身份摘要与 giftId/giftName 必须一致。同一身份不能重复，旧无身份规则保留但不匹配普通平台事件，重新选择可保留原设置。见[礼物身份规格](../../../specs/gift-identity-overtime.md)。

> 涉及文件:[src/server/api-routes.js](../../../src/server/api-routes.js)、[src/server/http-utils.js](../../../src/server/http-utils.js)、[src/server/routes/system-routes.js](../../../src/server/routes/system-routes.js)、[src/server/routes/settings-routes.js](../../../src/server/routes/settings-routes.js)、[src/server/routes/clock-routes.js](../../../src/server/routes/clock-routes.js)、[src/server/routes/opening-routes.js](../../../src/server/routes/opening-routes.js)、[src/server/routes/wesing-routes.js](../../../src/server/routes/wesing-routes.js)、[src/server/routes/music-routes.js](../../../src/server/routes/music-routes.js)、[src/server/routes/playback-routes.js](../../../src/server/routes/playback-routes.js)、[src/server/routes/theme-routes.js](../../../src/server/routes/theme-routes.js)、[src/server/routes/song-routes.js](../../../src/server/routes/song-routes.js)、[src/server/routes/queue-routes.js](../../../src/server/routes/queue-routes.js)、[src/server/routes/superchat-routes.js](../../../src/server/routes/superchat-routes.js)、[src/server/routes/gift-routes.js](../../../src/server/routes/gift-routes.js)、[src/server/routes/overtime-routes.js](../../../src/server/routes/overtime-routes.js)、[src/server/routes/data-routes.js](../../../src/server/routes/data-routes.js)、[src/server/routes/ai-routes.js](../../../src/server/routes/ai-routes.js)、[src/server/routes/game-routes.js](../../../src/server/routes/game-routes.js)、[src/server/routes/bilibili-routes.js](../../../src/server/routes/bilibili-routes.js)

本文档是全部 HTTP API 端点的**唯一事实源**:每个端点的方法、路径、请求体、响应形态与错误码只在此成表。其他文档一律链接此处,不自行罗列端点。服务进程的端口、token 机制、请求管线详见 [server-core.md](server-core.md);WebSocket 消息与快照见 [ws.md](ws.md);数据库与设置见 [storage.md](storage.md)。

## 0. 路由机制与通用约定

### 组件样式库

[component-style-routes.js](../../../src/server/routes/component-style-routes.js) 提供以下入口，响应为 `{ok:true,data}`；失败为 `{ok:false,error}`。管理入口要求桌面管理身份；画布入口要求当前 canvas Bearer 以及查询参数 `id`、`attachmentId`，复用 `authorizeCanvasMedia`，不接受短入口或其他组件能力。写入在读取请求体后再次验证当前权限，上传中撤销或断开不能安装。所有入口拒绝外站及 opaque Origin；库为本机设备共享的素材，不含账号凭据或业务数据。

| 管理端点 | 绑定画布端点 | 请求与结果 |
| --- | --- | --- |
| `GET /api/component-styles/list` | `GET /api/component-preview/styles/list` | 返回包数组；包含 `id/name/packageId?/version?/bytes/createdAt/styles`，样式含 `id/type/name/config`；过滤已移除样式 |
| `POST /api/component-styles/add` | `POST /api/component-preview/styles/add` | 原始媒体 bytes；查询 `description` 为 URL 编码 JSON `{type,filename,name,width,height,media?}`。校验并安装一个样式，返回包 |
| `POST /api/component-styles/inspect` | `POST /api/component-preview/styles/inspect` | 原始 ZIP bytes；校验并暂存，返回包含临时 `id` 的套装清单供确认，此时不可用于场景 |
| `POST /api/component-styles/install` | `POST /api/component-preview/styles/install` | JSON `{id}`，确认暂存包；原子登记并返回包；重复内容返回 `alreadyInstalled:true`，恢复已移除样式返回 `restored:true` |
| `POST /api/component-styles/remove` | `POST /api/component-preview/styles/remove` | JSON `{id}`，此处 id 为样式 ID；从库中移除，返回 `{id}`，保留场景引用文件 |
| `POST /api/component-styles/cancel` | `POST /api/component-preview/styles/cancel` | JSON `{id}`，删除本次暂存包；返回 `{id}`，重复取消安全 |

API 响应均 `no-store`。400 为格式/清单/文件错误，401 为管理身份缺失，403 为权限或 Origin 无效，404 为样式不存在，409 为同版本不同内容或画布接管冲突，410 为会话失效，413 为流体积超限，503 为会话暂不可用。JSON 操作体不超过 4 KiB。单素材上限 512 MiB；ZIP 上限 1 GiB，展开总量 2 GiB、256 条目、64 样式；清单及单份说明各 256 KiB。CRC、解压长度、路径、重复文件名、链接、加密和媒体签名均需校验。普通媒体只允许 PNG/JPEG/GIF/WebP/MP4/WebM；ZIP 另允许每份不超过 1 MiB 的 SVG/WOFF2 资源、根清单及 TXT/MD 说明。schemaVersion 1 保持兼容；2 允许受信预设资源型样式，必须声明该预设的完整资源映射且格式匹配；不执行包内脚本。

`GET/HEAD /component-media/<包 UUID>/<SHA-256>.<扩展名>` 提供匿名本机媒体读取，保留原 Host 闸门；严格匹配路径，拒绝链接及非普通文件。支持单段 byte Range（206/416）、正确 MIME、nosniff、immutable 缓存和浏览器源所需 CORS。SVG 额外使用 `sandbox; default-src 'none'; style-src 'unsafe-inline'` CSP，禁止导航执行脚本或请求外部资源；WOFF2 使用 font/woff2。素材没有目录枚举接口。持久化见[存储合同](storage.md#本地组件样式库)，清单格式见[作者指南](../../guides/component-style-packages.md)。

### 浏览器组件预览

`POST /api/component-preview` 由 [component-preview-routes.js](../../../src/server/routes/component-preview-routes.js) 处理，响应 `{ok:true,data}`。这是客户端与默认浏览器之间的临时配置会话；组件保存与绑定场景的发布、来源读取，由创建会话的客户端控制器调用已有领域 owner 处理。

场景编辑器为四个已注册组件及直播场景分别创建会话。客户端经 `link` 将这些会话绑定成短入口：`/c#<22字符base64url能力>`，完整地址在四位端口下为 46 字符，组件及尺寸不再放入 query。浏览器经 `resolve` 读取各组件的独立能力、初始选中组件和已保存尺寸。短入口映射只留在会话内存中，锚定 canvas 会话（缺少 canvas 时为第一个组件），任一成员关闭、替换、撤销或账号/generation 变化后失效；不持久化，也不授予管理或正式直播源权限。相同控制器及 generation 的重复打开复用原会话；每个初始组件（含无初始选择）各保留一个稳定入口，切换入口不会撤销其他入口，尺寸更新沿用该入口能力。可选 selectedItemId 将入口定位到具体场景实例，同类型不同实例保留不同稳定入口；link 与 resolve 均核对当前 canvas 草稿中的实例 ID 和类型。省略时保持原响应结构与按类型选择行为。

兼容旧 `/component-preview` 页面和 43 字符短入口的解析。旧 query `component` 与 fragment 的 `id`/`token` 表示初始组件，`components` 携带其他组件的 `{component,id,token,draftKey}` 数组，`canvas` 携带独立场景会话；旧 fragment `size` 及 query `size=<宽>x<高>` 仍可读取。场景编辑仅传递 `{document}` 草稿，客户端适配器固定场景 ID，浏览器不能替换绑定 ID、创建或轮换场景凭据。缺少场景会话的旧链接仍可保存组件参数，但公共布局须从客户端重新打开后保存。短入口在同标签 sessionStorage 中仅缓存组件名及恢复用 draftKey，缓存键使用入口能力的 SHA-256；不缓存明文入口能力或组件 token。已断开页面刷新时仍可只读查看该标签的本地恢复草稿。

“保存并应用”只等待当前场景及其共享外观 owner 的浏览器编辑被客户端确认，再同步预检、冻结并批量保存这些 owner，最后按 revision 发布组合画面；独立实例不依赖其类型的默认配置，无关默认草稿不保存。全部保存结束后再次检查参与者的读取、保存、冲突、草稿和账号代际状态，以及本次场景保存的规范化结果与 revision；任一失败或出现新的并发修改均停止发布，保留已成功保存的部分。发布请求发出后的后续编辑留作下次草稿。`publish`/`source` 仅允许 canvas 能力排队，结果通过该会话 `display` 的 `{sequence,busy,result?,error?}` 返回。编辑页在显式复制时读取来源，拼成 `http://127.0.0.1:<实际端口>/scene?id=<场景ID>#token=<来源能力>`；客户端地址目录在首次读取、页签点击、窗口 focus 及 `scene:published` 后刷新，未发布场景仍提示先保存并应用。后续正常保存和发布沿用该地址，来源能力不进入文档或模板。

除只用于解析的短入口能力外，每个组件请求只使用目标会话自己的凭据，能力不可互换。多个图层同时保留各自 renderer，选中组件只切换参数面板。网页刷新/离开只释放当前页面资源；新页面接管后，旧页面可刷新继续编辑。显式 close 时各会话分别处理已接受命令并撤销，不提前撤销其他会话的待保存操作。

| action | 身份与请求 | data |
| --- | --- | --- |
| `open` | 管理身份；`{component,state,display?}`，component 为 danmaku/clock/queue/overtime/canvas | `{id,token,draftKey}`，256 位随机预览能力；draftKey 仅定位账号/场景的本地恢复草稿，不授予权限；同类型旧会话失效 |
| `link` | 管理身份；`{links:[{id,token}],selectedId?,selectedSize?}`，1–5 个不同的有效会话，逐项校验能力；selectedId 为绑定的共享组件类型、绑定 canvas 会话时的独立场景类型或 null，selectedSize 仅在有选择时可为 `{width,height}`，各轴 32–7680 | `{key}`，独立 128 位随机能力的 22 字符 base64url 编码；一个锚定会话按已注册场景类型分别保留短入口；重复申请同一组会话与选择复用 key 并更新尺寸 |
| `resolve` | 短入口 Bearer；`{action:'resolve'}` | `{links:[{component,id,token,draftKey}],selectedId,selectedSize}`，只返回绑定的有效会话与入口元数据；不续活闲置租约；未知或失效入口为 410 |
| `exchange` | 管理身份；`{id,state,display?,ack}` | `{commands:[{sequence,action,change?}],closed}`，按序确认，已确认命令不重放；closed 时处理已排队操作后释放会话 |
| `revoke` | 管理身份；`{id}` | `{closed}` |
| `read` | 当前会话 Bearer；`{id,attachmentId?}`；未附页面标识的读取用于接管前取得快照 | `{component,draftKey,state,display,ack,sequence,attachmentId}`，attachmentId 初始为 null；只含组件草稿、已保存值、保存状态和必要展示数据 |
| `attach` | 当前会话 Bearer；`{id,attachmentId,previousAttachmentId}`；新标识为 UUID v4，previousAttachmentId 为刚读取的标识 | 同 read；比较原标识后接管，重试同一接管幂等；拒绝迟到旧页面接管；保留已接受命令及确认序号 |
| `edit` / `save` / `discard` | 当前会话 Bearer；`{id,attachmentId?,commandId?,change?}`，edit 只允许该组件已有草稿字段 | `{sequence}`；仅表示已排队，保存完成以之后的 state 为准 |
| `publish` / `source` | 仅当前 canvas 会话 Bearer；`{id,attachmentId?,commandId?}`，领域场景 ID 由客户端绑定 | `{sequence}`；publish 结果 `{publishedVersion}`，source 结果 `{id,token}`，均从后续 display 按 sequence 读取 |
| `preset` | 仅当前 canvas 会话 Bearer；`change:{action:'select',id}` 或 `{action:'create',title,duplicate:boolean}` | 仅选择桌面 state.presets 列出的预设，或由桌面新建/复制；结果 `{id}` 经 display 返回，不发布、不授予通用管理权限 |
| `close` | 当前会话 Bearer；`{id,attachmentId?}` | `{}`，显式关闭浏览器访问；客户端先处理已经接受的修改/保存，再撤销会话 |

接管后，网页变更和关闭必须携带当前 attachmentId，轮询也校验附带的标识；旧页面请求返回 409。
未接管会话保留无标识旧协议。网页在每次接管内串行发送递增 commandId，重试最近一次编号返回
原 sequence，确认后亦不重复执行；更早编号拒绝。新页面接管后可以重新计数，但不能丢弃已接受命令。
恢复草稿前等待 `ack === sequence`、state.saving 和 display.busy 结束，避免重放此前已接受的保存/发布。正常 token 续期保留画布连接；预览 owner 绑定经主进程校验的账号与登录生命周期，见 [授权生命周期](../desktop/auth.md)。

canvas 的 state 另含 `presets:[{id,title,dirty}]`、`activeSceneId` 和已发布的 `activeSceneTitle`。
切换预设后 draftKey 随当前文档 ID 更新，恢复副本不能跨预设写入或重放。短链接记住入口所属
预设；切换后刷新该链接不再添加或选中旧入口组件，显式从客户端重新打开组件则绑定当前预设。

中继拥有分层 UTF-8 大小限制：每份场景 document 仍限 256 KiB；单个 saved/draft 配置或 edit change 限 257 KiB，双份状态封装限 518 KiB，display 限 256 KiB；完整 HTTP 请求限 778 KiB（含 4 KiB 请求元数据余量）。超限不改变已有会话或命令，文档结构和领域配置仍由原保存 owner 校验。每会话最多 64 条待确认命令、每类型最多一会话。有效网页请求或客户端 exchange 续期；双方连续两分钟无有效请求暂停网页操作并返回可重试的 503，保留会话等待原客户端通过认证、同 generation 的 exchange 恢复，网页不能自行续活。账号归属/登录生命周期变化、控制器 generation 变化、显式 close/revoke 或同类型新会话使旧会话永久失效。状态只在内存中，服务关闭清理；不保存用户配置。页面能力仅用于此中继及下述受限画布文本素材接口，不能访问管理 API、WebSocket 或其他预览。凭据通过 URL fragment 交付，随后只放在 Authorization 请求头；无管理凭据注入浏览器 HTML。拒绝 opaque/外站 Origin，沿用 loopback/Host 和授权闸门；401 管理身份缺失，403 能力或 Origin 无效，409 配置未就绪或页面/操作已被替代，410 会话结束，413 请求过大，429 待处理操作过多，其他非法请求 400。客户端关闭撤销会话；网页 pagehide 仅停止当前页面轮询，刷新可继续编辑；领域保存失败保留原控制器草稿。

### 本地场景

画布文本素材由 [scene-text-media-routes.js](../../../src/server/routes/scene-text-media-routes.js) 共享处理：桌面入口使用管理鉴权；外部画布入口仅接受 canvas 会话的 Bearer 能力，以及查询参数 `id`、`attachmentId`。能力必须属于当前账号、未关闭且在活动租期内，配置已读取，并匹配当前 attachment；读取请求体或目录后再次复核，替代页面及撤销期间的慢请求不能写入文件或返回目录。素材操作不续租、不提交场景，也不授予通用管理或加班接口权限。所有素材 API 拒绝 opaque/外站 Origin，沿用服务 Host 与授权闸门。

| 端点 | 输入 | 输出与行为 |
| --- | --- | --- |
| `POST /api/scenes/text-image` | 管理身份；原始图片 bytes，Content-Type 为 image/png、image/jpeg、image/gif 或 image/webp | `{ok:true,data:{imagePath}}`；最大 5 MiB，校验文件签名，保留动画原字节；不接受客户端文件路径 |
| `GET /api/scenes/text-gifts` | 管理身份；source=room（默认）或 all | `{ok:true,data:{gifts,guards,...目录元数据}}`；只读本房间或全局缓存，不触发同步或读取礼物账本 |
| `POST /api/component-preview/text-image` | canvas Bearer；id、attachmentId 查询；图片 bytes 与 Content-Type 同桌面入口 | 同桌面上传；其他组件或短入口能力不能使用 |
| `GET /api/component-preview/text-gifts` | canvas Bearer；id、attachmentId、source 查询 | 同桌面目录；只开放此受限读取，不能使用通用加班接口 |

素材 API 响应禁止缓存；400 格式或来源参数无效，401 桌面入口未认证，403 能力/Origin 无效，409 attachment 已替换或配置未读取，410 会话已结束，413 超过 5 MiB，503 租期暂停，500 存储或目录暂时不可用。图片通过 `/scene-text-images/<UUID v4>.<png|jpg|gif|webp>` 提供 GET/HEAD，支持匿名浏览器源读取，仍受本地 Host 闸门；严格匹配文件名并拒绝符号链接、非普通文件、超限及签名不符的文件，设置正确 MIME、nosniff 与 immutable 缓存。目录与保留规则见 [存储合同](storage.md#本地场景持久化)。

管理接口沿用管理页鉴权，并由 main 当前授权的 Server origin 与 streamerId 决定归属。`document` 是展示文档；管理 DTO 为 `{document,revision,publishedVersion,hasPublication}`，普通读写不包含凭据。领域模型见 [场景规格](../../../specs/component-scenes.md)。

客户端「点歌 → 浏览器源 → 直播场景」与场景编辑器共用同一绑定场景，显式复制时读取 `source`，不会自动保存或发布。复制前未应用时提示先编辑场景并保存应用；账号/在线来源变化清空客户端已显示的地址。

| 端点 | 输入 | 输出与行为 |
| --- | --- | --- |
| `GET /api/scenes/list` | 无 | 管理 DTO 数组，仅当前账号 |
| `GET /api/scenes/canvas` | 无；当前账号至少有一个场景 | `{outputId,activeSceneId,publishedVersion,activeSceneTitle}`，首次绑定原有首个场景，此后输出 ID 固定 |
| `GET /api/scenes/document?id=UUID` | 场景 ID | 管理 DTO |
| `POST /api/scenes/validate` | `{document}` | 规范化后的展示文档；模板导入先验证所有独立外观，不写入或创建场景 |
| `POST /api/scenes/create` | `{title,canvas:{width,height}}` | 空场景管理 DTO，凭据仅加密保存 |
| `POST /api/scenes/save` | `{id,expectedRevision,document}` | 更新草稿并递增 revision，不改变已发布版；旧 revision 返回 409 |
| `POST /api/scenes/publish` | `{id,expectedRevision,expectedDefaults?}` | 固定所有有效外观后原子发布，递增 publishedVersion；编辑器传共享类型外观快照确认，缓存尚未同步或已变化返回 503；失败保留旧版 |
| `POST /api/scenes/canvas-publish` | `{id,expectedRevision,expectedPublishedVersion,expectedDefaults?}` | 将指定预设发布到当前账号绑定的唯一画布来源；事务检查预设 revision 和来源 publishedVersion，提交发布快照、当前预设和共享尺寸；任一冲突返回 409、失败保留旧输出 |
| `GET /api/scenes/source?id=UUID` | 场景 ID | `{id,token,itemIds}`，itemIds 为已发布实例 ID，仅显式复制来源使用 |
| `POST /api/scenes/rotate` | `{id}` | 新 `{id,token}`，旧凭据立即失效 |
| `GET /api/scene/output` | `id,version,epoch,cursor,item?,projection?` 查询；场景 Bearer | `{sceneId,version,projection,document,data}`；相同发布版本 document 为 null；item 可选 UUID 只投影该发布实例，移至原点并使用保存宽高；凭据权限仍属于整个场景 |
| `OPTIONS /api/scene/output` | Origin 为 null，请求方法 GET、请求头 Authorization | 204，精确路径预检不带凭据，实际 GET 必须验凭据 |
| `GET /api/scene/events` | `id,version,item?,projection?` 查询；场景 Bearer | `text/event-stream`，仅通知 `ready` / `change` / `revoked` 与注释心跳；数据仍从 output 读取；本地运行时最多四条连接，超限 429 |
| `OPTIONS /api/scene/events` | Origin 为 null，请求方法 GET、请求头 Authorization | 204，精确路径预检不带凭据，实际 GET 必须验凭据 |
| `GET /api/component/size` | clock/queue/overtime/danmaku 的 overlay 凭据；管理请求使用 type 查询 | `{ok:true,data:{width,height}\|null}`；组件 scope 取自凭据，不能由查询覆盖；当前账号尚无保存尺寸时为 null |

输出中的 `projection` 是服务进程签发的类型投影回执，绑定已认证 owner scope/epoch、sceneId、来源 capability、item 选择及发布版本；不含实时数据或来源 token，不独立授予访问能力。父页面在整套 renderer 成功提交时同时记录 version/projection，后续请求携带该 active 回执。服务端仅合并最新文档与已验证 active 回执的类型集合，新版移除某类组件但准备失败时旧版仍获得更新；成功切换后旧类型随回执替换而释放。伪造、跨账号/场景/实例、版本不匹配、轮换或服务重启后的回执返回 403，父页清空旧版与回执后重新读取当前版。省略 projection 的旧客户端沿用仅投影最新文档的行为。没有历史文档缓存或无限版本保留。

上述响应均禁止缓存。场景 Bearer 不属于通用 HTTP/WS principal，不能访问管理 API、旧 overlay API 或其他场景。通知使用 fetch SSE、Authorization 请求头和省略凭据模式，不接受查询参数中的 token。流绑定当前 owner scope/epoch、sceneId、capability 和可选 item，复用 output 的 active projection 验证；成功发布/轮换或对应类型的运行时变化触发通知，40ms 合并突发变化。每次通知及每秒心跳都复核访问和 HTTP server 的实际 license/lifecycle；撤销发送 `revoked` 后关闭，不可用或关闭阶段直接断流。消息不含组件数据、外部 URL 或业务事件 ID；慢客户端被关闭，shutdown 在 inflight drain 前释放所有流。

客户端输出读取不重叠，请求开始至少间隔 100ms；通知正常时每五秒补读检查，断线、未实现或超出连接上限时回退为响应结束后约 750ms 重读，并有限退避重连。通知接口初次 HTTP 失败本身不清空有效输出；明确的 `revoked` 或 output 授权失败才撤销。提交新 renderer 版本/回执后重开通知订阅，准备失败继续订阅旧版所需类型。云事件仍提供本地缓冲 `epoch/nextCursor/reset/gap/events`，不提供服务端历史重放。

`gift-feed` / `gift-wishes` 的展示读取通过真实礼物门面获取 `viewRevision`，缓存按账号、revision 和日期失效。许愿配置变化另清除 gift-wishes 缓存，礼物目录更新清除这两类缓存，随后通知对应类型；失效前的慢读取不能覆盖新缓存。礼物来源尚不可用或正在切换时，相关 `data[type]` 为 `null`，不让整个场景输出失败；来源恢复后重新读取当前 revision 的投影。

包含 `gift-frame` / `guard-thanks` 的场景分别取得 `data[type]={epoch,sequence,events:[{sequence,payload}]}`。
两者复用现有礼物最终显示事件和手动预览投影，字段与 `gift-effects` WebSocket 白名单一致；
合计只保留最近 200 条，按当前授权账号 scope/epoch 清空，不写入业务持久化。序列由父页面消费，
首读及断线恢复以当前序列为基线，不补播旧记录；准备中有界暂存，已交付旧版的事件不在新版重复播放。

`npm run verify:docs` 的 `GOV-API-001` 从实际 `ROUTE_MODULES` 的 routes 映射推导本地方法/路径，并与本文完整的反引号端点条目双向比较（支持 `GET/POST` 和查询参数）。新增或删除接口时同步修改所属表，不维护另一份路由清单。独立服务器接口放在标题含 `LIRA Server` 的章节；其他位置的远端引用明确使用 `LIRA Server: METHOD /api/path`，不计入本地注册表。

2026-09-14 新增动态抽奖路由模块，使用原管理鉴权，不加入公开白名单。专用账号凭据只经 Electron 注入后端；HTTP 不能提交 `streamerId`、作者 UID、候选顺序或中奖 UID。当前路由为客户端简化流程，不包含独立公示会话。

| 端点 | 输入 | 输出与行为 |
| --- | --- | --- |
| `GET /api/bilibili/dynamic-lottery/state` | 可选 `taskId` 查询参数 | `{ok:true,data:{tasks,task,result,job,error}}`；当前授权账号最近 50 个活动，选中活动进度和获奖者；不返回 Cookie、内部游标或随机顺序，不触发上游请求 |
| `POST /api/bilibili/dynamic-lottery/tasks` | `{url,winnerCount,requireLike,requireRepost,requireFollow,requestId}` | 中奖人数 1–100，三个开关必须为 boolean；作者检查及采集后台执行，返回同一状态结构；同 requestId 同参数不重复建活动，异参冲突 |
| `POST /api/bilibili/dynamic-lottery/tasks/action` | `{taskId,revision,action:'pause'\|'resume'\|'draw'}` | 受信 scope 归属检查，继续/开奖需匹配 revision；pause 可省 taskId 以取消正在解析链接的当前操作；继续不重新随机；已结束活动重复操作不重新开奖 |

`result.winners[]` 保留 `uid`、`position`、`verification`、`drawnAtMs`，并增加可空的 `displayName`（最多 256 字符的采集时昵称）与 `commentText`（完整参与评论）。两者来自本轮冻结成员指向的评论证据，按 scan/source/recordId/uid 关联；旧记录缺少元数据时返回 `null`，不额外请求用户资料。昵称与评论均为不可信纯文本，不参与资格判定或名单摘要。

以上端点 `Cache-Control: no-store`。错误为 `{ok:false,error:LOTTERY_*}`，不返回上游正文、SQL 或 Cookie；401 沿用通用 token 拦截，403 `LOTTERY_IDENTITY_UNAVAILABLE`，404 `LOTTERY_TASK_NOT_FOUND`，409 `LOTTERY_BUSY`/`LOTTERY_DRAW_CONFLICT`，其他规则/来源/存储不可用为 400。异步错误保存在同 scope 状态或活动暂停原因，客户端展示后由用户决定继续。隔离测试不代表真实 B站接口可用性验证。

路由分发在 [api-routes.js](../../../src/server/api-routes.js) 中完成,无状态、无框架(`node:http` 手写路由):

| 事实            | 值                                                                                                                                  | 出处                                                             |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| 模块注册        | `ROUTE_MODULES` 数组按序 require **19 个路由模块**,每个模块导出 `prefixes[]` 与 `routes` 映射(`"METHOD /path"` → handler)           | [api-routes.js](../../../src/server/api-routes.js)   |
| 匹配顺序        | 按模块顺序做前缀匹配(`pathName.startsWith(prefix)`);**先注册的模块优先**,因此 `/api/music/wesing/*` 归属 WeSing 模块而非 music 模块 | [api-routes.js:29-39](../../../src/server/api-routes.js#L29-L39) |
| 405 与 404 区分 | 模块前缀命中但路径没有对应方法时,`findRoute` 置 `pathExists` → **405**;任何模块前缀都不命中 → **404**                               | [api-routes.js:34-38](../../../src/server/api-routes.js#L34-L38) |
| 请求体惰性读取  | `createBodyReader` 只在 handler 真正调用 `request.body()` 时读一次 JSON(GET 请求不读 body)                                          | [api-routes.js:42-48](../../../src/server/api-routes.js#L42-L48) |

**认证**：仅 `GET /api/health` 匿名可用。本地 API 使用管理身份或独立页面能力；Bearer/query 由同一服务端 owner 验证，显式 Authorization 优先且不回退。管理身份可访问下表各领域接口；overlay 只允许 §0.0 的路径、方法和参数。时钟与开播配置也需要各自页面能力，页面会自动携带。此规则不改变独立 lira-server 的公开目录。凭据生命周期和 Electron 引导见 [server-core.md](server-core.md) §4/§7。

- 401：`{ok:false,error:'未授权访问。请重新打开页面。'}`，缺少或无效凭据。
- 403：有效页面能力越过 scope、调用管理动作，或来源不被允许。
- 405/404：管理路由的方法不支持/路径不存在；overlay 未列入能力表的请求均为 403。
- 顶层异常返回脱敏 500；非法 JSON 返回 400，请求体超预算返回带 `Connection: close` 的 413。


**请求体与预算**：常规 JSON 使用 [api-routes.js](../../../src/server/api-routes.js) 的惰性 `createBodyReader`，空 body 为 `{}`、非法 JSON 为 400；默认入站预算为 16 MiB，`/api/interactions/` 明确收紧为 **16 KiB**。原始文件上传由所属路由调用 `readRawBody` 并独立设定预算（开播动画上传见 §2.1），不能从 JSON 上限推断文件大小上限。超量读取标记 `REQUEST_BODY_TOO_LARGE`；[http-utils.js](../../../src/server/http-utils.js) 暂停读取并清缓存，413 携带 `Connection: close`，未结束上传有 1 秒强制回收上界。领域 handler 应透传该限额错误。

| 响应类别 | Content-Type / 缓存 | 响应与错误边界 |
| --- | --- | --- |
| 常规 JSON | `application/json; charset=utf-8`，`no-store` | 通常为 `{ok:true,data}`，个别端点按所属表直接返回字段；错误通常为 `{ok:false,error,details?}`，不假定所有本地/远端响应都有 `data` |
| 歌库 CSV / XLSX | `text/csv; charset=utf-8`（含 BOM）/ `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`，`no-store`，`Content-Disposition: attachment` | `sendCsv` / `sendBuffer` 一次输出下载内容，不实现 Range；响应开始前的失败由路由 JSON 错误表达 |
| Bilibili 头像代理 | 经过头像 owner 验证的 `image.contentType`，`private, max-age=3600`，`inline`、`nosniff` 和 Content-Length | [bilibili-routes.js](../../../src/server/routes/bilibili-routes.js) 返回图片字节；输入错误 400，其余读取失败 502 JSON；不实现 Range |
| QQ 本地解密媒体流 | 已解析 MIME（Q0 默认 `audio/flac`，其余默认 `audio/ogg`），`no-store`，`Accept-Ranges: bytes` | [qq-encrypted-stream.js](../../../src/music/qq-encrypted-stream.js) 只转发有效的单一 `bytes=start-end?`；不支持的 Range 格式按无 Range 处理。上游 206 保留为 206，透传存在的 Content-Length/Content-Range；上游 416 返回 416 JSON，其余不可用为 502、超时为 504。响应头发出后失败只能断流，不在音频中追加 JSON |

QQ 流的上游响应字节预算、主动读取超时、背压及取消见 [音乐服务 §4](music/services.md#4-流解析编排stream-resolverjs--track-contractjs)。它们是上游读取约束，与入站 JSON、文件上传或导出文件大小不同。

### 0.0 Overlay HTTP 能力

[access-policy.js](../../../src/server/access-policy.js) 拥有精确能力表，[overlay-http.js](../../../src/server/overlay-http.js) 限制输入，[overlay-projection.js](../../../src/server/overlay-projection.js) 对每层响应使用字段 allowlist。以下范围外的领域 API 默认仅管理身份可用；匿名打开其他展示 HTML 不等于复用当前页凭据授权其他 scope。

| Scope | 允许的本地 API | 附加限制 |
| --- | --- | --- |
| 全部 15 页 | `GET /api/state` | 仅本页最小状态；无 snapshot 消费者返回 `{}`，也用于旧凭据恢复检查 |
| queue / overtime / lyrics / gift-effects | 无额外 REST | 专用推送见 [ws.md](ws.md) |
| songlist | `GET /api/songs` | 服务端强制 enabledOnly，仅 category 展示过滤；不返回文件路径、禁用歌或导入元数据 |
| blindbox | `GET /api/gifts/blind-box-stats` | 可选 boxName，仅公开统计字段 |
| gift-feed | `GET /api/gifts/display-settings`、`/api/gifts/history`、`/api/gifts/card-profiles`、`/api/overtime/gifts/catalog`、`/api/bilibili/avatar` | history 强制北京时间今日、100 条、created_at 升序；只允许 cursor/viewRevision；card-profiles 只转发 viewRevision，返回当日 eventId、senderId 与昵称/头像/等级证据，禁止客户端选择旧日期、来源或其他用户过滤 |
| gift-export | `GET /api/bilibili/avatar` | 导出数据由 main 注入冻结快照；没有历史、selection 或导出 IPC 权限 |
| gift-wishes | `GET /api/gifts/wishes` | 仅心愿展示字段、整数计数、进度及直播窗口；无来源 ID、送礼人或管理写权限 |
| interactions | `GET /api/interactions/session` | 只读投票/评分公开结果；禁止写入与 host-state |
| games | `GET /api/games/session`、`/api/games/winner-profile`、`/api/bilibili/avatar`；`POST /api/games/session`、`/api/games/session/move`、`/api/games/session/draw` | session 仅 stop/restart；move 的 value 仅 number/string，禁止夹带主持动作对象；draw 仅 append/undo/clear。不能新开配置、读取 host-state/词库/观众或揭晓答案 |
| danmaku | `GET /api/bilibili/avatar`、`GET /api/danmaku/display` | 保留现有头像/表情 CDN 校验；display 仅返回当前账号的已规范化弹幕外观及展示缓冲投影 |
| wheel | `GET /api/wheel`、`POST /api/wheel/spin` | 只读展示配置与抽取，不允许编辑配置 |
| opening | `GET /api/opening/config` | 仅文案、展示参数、当前媒体 URL |
| clock | `GET /api/clock/config` | 仅时钟显示参数 |

HTML sandbox 使展示请求的 Origin 为 `null`。该值本身没有权限：预检仅对上表已知方法/路径开放 Authorization/Content-Type，实际请求再校验有效 scope；管理凭据对此来源一律拒绝。仅上述路径的实际错误响应允许页面读取，以便旧凭据收到 401 后刷新，不返回额外状态。没有 `Access-Control-Allow-Credentials`。

`GET /api/danmaku/display?epoch=…&cursor=…` 由 [danmaku-display-routes.js](../../../src/server/routes/danmaku-display-routes.js) 处理，供本机独立地址 `/danmaku?source=component` 使用。响应 `{ok:true,data:{config,data}}`，其中 `config` 为已保存的 `{style,fullscreenDurationSeconds,styleOptions,layout}`，配置尚未取得时为 `null`；内层 `data` 是已有云展示缓冲的 `{epoch,status,state,nextCursor,reset,gap,events}`。读口由 `scene-runtime` 复用当前账号的同一缓冲，不创建场景或第二条上游连接。首次/无效 cursor/切账号按已有缓冲契约 reset，不重放旧直播消息。每次读取 `no-store`，未就绪端口为 503；匿名为 401，其他 overlay scope、管理凭据配 opaque Origin 或写方法均被拒绝。固定页仍只注入 danmaku 展示凭据，不能读取管理配置。

---

## 0.1 LIRA Server 设备授权域(song-page background)

> 远端模块:lira-server 的设备路由;桌面端通过 [remote-license-client.js](../../../src/electron/license/remote-license-client.js) 调用。服务地址由 `LIRA_LICENSE_API_BASE` 配置,生产环境默认 `https://api.lirahub.cn`。

`LIRA_LICENSE_API_BASE` 只接受使用 DNS 主机名的 HTTPS 根 origin，不允许凭据、子路径、查询参数或片段；HTTP、`localhost` 和 IPv4/IPv6 literal 都会被拒绝。这里填写服务根地址，不要填写 `/admin/activations` 页面路径，客户端会自行请求 `/api/device/*`。

以下端点使用设备 Bearer Token(`Authorization: Bearer <device accessToken>`),响应不套用本地服务的 `data` 包装:

| 端点                                      | 请求                                                                                      | 成功响应                                            | 错误码                                                                                                   |
| ----------------------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `GET /api/device/song-page/background`    | 无                                                                                        | `{ok:true, background:null\|{url,bytes,updatedAt}}` | 401 `DEVICE_TOKEN_*`;403 `DEVICE_REVOKED`/`LICENSE_REVOKED`/`STREAMER_DISABLED`                          |
| `PUT /api/device/song-page/background`    | 原始图片字节;`Content-Type` 必须为 `image/png`/`image/jpeg`/`image/webp`/`image/gif`;≤5MB | `{ok:true, background:{url,bytes,updatedAt}}`       | 400 `BACKGROUND_IMAGE_REQUIRED`;413 `PAYLOAD_TOO_LARGE`;415 `BACKGROUND_FORMAT_UNSUPPORTED`;401/403 同上 |
| `DELETE /api/device/song-page/background` | 无                                                                                        | `{ok:true, background:null}`                        | 401/403 同上                                                                                             |

上传接口校验文件魔数与 `Content-Type` 一致,每个主播只保留最新一张背景,后写覆盖先写。服务端返回的 `background.url` 是相对路径;桌面 main process 使用已校验的 `LIRA_LICENSE_API_BASE` 同源解析为 `background.previewUrl` 后才交给 renderer,其中 `?v=<updatedAt>` 用于缓存破坏。公开端点匿名可访问,删除后返回 404。

---

## 0.2 LIRA Server 全局礼物目录(桌面选择器)

桌面端通过已配置的 `LIRA_LICENSE_API_BASE` 请求独立 lira-server 的公开端点 `GET /api/public/gifts/catalog?schemaVersion=3`。默认入口是 `https://api.lirahub.cn`，覆盖配置也必须是使用 DNS 主机名的 HTTPS 根 origin。该请求由 Electron main process 发起，不携带 DeviceBearer；首次授权后，本地运行时校验并保存完整身份包，仅向选择器提供 `coinType === 'gold' && priceRaw >= 0` 的付费子集并准备其图片，后续每次授权启动及持续运行每 12 小时条件检查一次。renderer 的房间主目录访问本地 `/api/overtime/gifts`，全局目录通过本地 `/api/overtime/gifts/catalog` 一次读取完整快照并在前端筛选名称/ID，`/api/overtime/gifts/local/search` 保留原有查询契约，图片只显示本地 `/overtime-gift-images/<basename>`。本地全局快照补充 `assetsUpdatedAt`（本进程实际图片扫描完成的 ISO 时间或空字符串），用于同版本缺图修复的通知去重，不改变服务器字段。服务器目录不决定房间成员，只按完整礼物身份为房间面板/配置和在售盲盒展开出的条目提供图片。

成功响应为 schema 3 身份快照：`schemaVersion:3`、`catalog`、`variants[]`、按 variantId 引用的 `blindBoxes[]`、`count`（真实 ID 数）、`variantCount`、`updatedAt`、`stale`、`sources`、`versionLabel` 和业务摘要 `version`。每个 variant 保存真实 giftId、规范化名称、标价、币种、背包属性、图片与特效资料；客户端完整验证字段、关系引用及身份/业务摘要后，再生成本地 `gifts[]` 和 `variantBlindBoxes[]`。旧 schema 2 缓存继续可读，但不能推断历史身份。客户端以 `If-None-Match` 条件请求，命中返回 `304`；未就绪返回 `503` 和 `Retry-After: 60`。网络或校验失败时保留已有快照。服务器完整契约见 lira-server 的 `docs/protocol/gift-variants.md`；本地联动见 [overtime.md](overtime.md) §1.5。

---

## 0.3 LIRA Server 云端权威主播同步

Electron main process 通过 [remote-license-client.js](../../../src/electron/license/remote-license-client.js) 调用以下固定 DeviceBearer 端点；租户只由已验证设备会话确定，body 中的 `streamerId` 不参与选择。完整字段、状态码和重试语义以 lira-server 的 `docs/protocol/device-api.openapi.json` 与 `docs/protocol/client-server-api.md` 为准。

| 端点 | main-process 用途 |
| ---- | ----------------- |
| `GET /api/device/cloud-state` | 一次读取 settings、songs、Bilibili 三个 scope 的 `initialized` / `revision` 元数据及完整 settings。 |
| `GET /api/device/cloud-state/events` | 保持 DeviceBearer SSE，只接收 `cloud-state-changed` 的 scope revision 失效通知；不含 scope 内容或秘密。 |
| `PUT /api/device/cloud-settings` | 上传直播间、监听开关及点歌设置的完整 scope。 |
| `GET /api/device/songs` | revision 变化后拉取最多 5000 首的完整云端歌库。 |
| `PUT /api/device/songs/sync` | 上传本地完整歌库并推进云端 song revision。 |
| `GET/PUT/DELETE /api/device/bilibili-credentials` | 在 Electron main 与云端间读取、上传或清除 Bilibili 登录凭据；这些方法不进入本地 HTTP、preload 或 renderer。 |
| `GET /api/device/gift-history`、`GET /api/device/gift-events`、`GET /api/device/gift-events/stream` | 构建当前认证主播的本地礼物投影，并以 epoch/cursor 对账和 SSE 在线加速保持连续。 |
| `GET /api/device/gift-card-profiles` | 只读获取当前认证主播北京时间今日的送礼人 UID 与展示证据，用于滚动卡片和 PNG 导出；每页最多 200 条，仅接受公开 eventId cursor，不修改礼物同步 DTO 或流水。 |
| `POST /api/device/gift-history/clear` | 以固定 `{confirm:true}` 清空当前认证主播的服务端礼物 ledger/outbox；只由 Electron main 调用，不接收租户选择字段。 |

本地 renderer 仍只调用既有 `/api/settings`、`/api/songs/*` 与 `/api/database/*`，不持有远端凭据。云端 scope 写入成功后通过运行时内部 `requestCloudSync(scope)` 通知 [cloud-sync-controller.js](../../../src/electron/cloud-sync-controller.js) 标记 dirty；云端应用使用 `applyCloudSettingsSnapshot` / `replaceCloudSongsSnapshot` 直接写本地 owner，不再发出 dirty 回声。授权后立即同步、SSE 失效通知、10 分钟自动兜底、resume/重连同步和冲突规则见 [../desktop/main.md](../desktop/main.md) §2.2。

---

## 1. 系统域(system)

> 模块文件:[src/server/routes/system-routes.js](../../../src/server/routes/system-routes.js)
> 前缀:`/api/health`、`/api/state`、`/api/system/`

| 端点                        | 请求                                                                                                                                                                      | 响应(data)                                                                                                                    | 错误码               |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| `GET /api/health` | 匿名可用；有效管理 Bearer/query token 可读 ready 诊断详情；可选 `X-Lira-Instance-Challenge` | 匿名 `{serviceId,phase}`；详情与实例证明见 [server-core.md](server-core.md) §2/§7 | 400（Host 不匹配） |
| `GET /api/state`            | 无                                                                                                                                                                        | 管理身份返回全量状态，overlay 返回 §0.0 的本页投影；管理数据与 WS 快照 `state` 一致(见 [ws.md](ws.md) §2)                                                      | —                    |
| `GET /api/system/metrics`   | 查询参数 `windowMs`(可选,默认 5000)                                                                                                                                       | `getSystemMetrics` 采样窗口内 CPU/内存/GPU 指标(见 [server-core.md](server-core.md) §8)                                       | —                    |
| `GET /api/system/hardware`  | 查询参数 `includeTemperatures=true`(可选)                                                                                                                                 | 本机 CPU/物理 GPU/内存型号与容量（排除虚拟显示适配器），以及当前显示器配置；仅显式传 `true` 时读取支持的 GPU 温度，结果不含序列号                 | —                    |
| `POST /api/system/shutdown` | body `{confirm: true}`(必须)                                                                                                                                              | `{shuttingDown: true}`,随后延迟 250ms 关闭服务                                                                                | 400 `缺少退出确认。` |

硬件查询的 `displays` 为主屏优先的数组，元素为 `{name,primary,width,height,scalePercent,refreshRate}`；宽高是 Windows 当前显示模式的像素值，不是网页逻辑尺寸或屏幕最大支持分辨率。缩放百分比与刷新率（Hz）未知时为 `null`，Windows 默认频率标记 0/1 不作实际 Hz 展示。显示配置每次查询重新读取，CPU/GPU/内存型号仍缓存；不支持、读取失败或无可用显示器时返回 `displays:[]` 和 `displayMessage`，不阻断其他硬件信息。性能页打开和开始检测时查询，不后台轮询。

行为文档:[server-core.md](server-core.md) §6(启动/关闭时序)。

## 2. 设置域(settings)

> 模块文件:[src/server/routes/settings-routes.js](../../../src/server/routes/settings-routes.js)
> 前缀:`/api/settings`

| 端点 | 请求 | 响应(data) | 错误 |
| --- | --- | --- | --- |
| `POST /api/settings` | 设置键值 patch；只处理 `settings.defaults` 白名单键，未知键静默忽略；下表说明特殊归一化 | `system.getState()` 业务快照 | 字段无效 400 `设置 <key> 的值无效。`；WeSing prepare 失败为 400；其他未捕获异常走顶层错误映射 |

归一化 owner 是 [settings-contract.js](../../../src/server/settings-contract.js) 的 `normalizeSettingsPatch`；存储默认值与分组见 [storage.md](storage.md) §7。以下字段处理完成后才使用剩余白名单键的 `String(rawValue)` 回退，不能用“其余字符串化”跳过已存在的领域规则。

| 键/组 | 接受输入与存储形态 |
| --- | --- |
| `danmakuMonitoringEnabled`、`giftMonitoringEnabled`、`enableBilibili`、`paused`、`onlyFromLibrary`、`allowDuplicate`、`giftEffectDanmakuEnabled` | 仅 boolean、数字 0/1、精确字符串 `'true'/'false'/'0'/'1'`；存为 `'true'/'false'`，不接受任意 truthy 值 |
| `queueLimit` / `userCooldownSeconds` | number 或十进制数字字符串（可首尾空白）；整数分别 1–300 / 0–3600，存规范十进制字符串；不接受指数/小数/符号形式的字符串 |
| `roomId` | §2.2 的 `normalizeRoomInput`；空值可清空，非空但不能解析的输入失败，不默认为有效空房间 |
| `customReplyRules` | §2.3 的数组/JSON 解析与清洗，结果保存为 JSON 文本；非法 JSON 按该 owner 的既有规则回退空数组 |
| `songRequestBlacklist` | 仅接受字符串；每行一项，将 CRLF/CR 转 LF、按 `cleanText` 合并行内空白并去首尾空白，去掉空行和重复项；存为换行分隔文本。空字符串清空名单；仅保存在本机 |
| `giftBlindBoxConfig` / `giftBlindBoxCustomConfigV2` | 数组或 JSON 文本，交给 [blind-box-config.js](../../../src/bilibili/gift/blind-box-config.js) 校验；失败返回无效字段。V2 特许 `null`/`'null'` 保存为 `'null'`（未确认）；`[]` 是明确空配置，不能混同 |
| 礼物边框设置 | [frame-config.js](../../../src/bilibili/gift/frame-config.js)：`giftFrameEnabled` / `giftFrameThresholdRmb` 控制林间花信；enabled 仅 boolean/字符串 true/false；阈值用 Number 转换并四舍五入到安全整数分，拒绝空字符串、负数和非有限数，存元数字字符串。门槛比较在服务端按整数分进行；已撤销的缎带设置不再接受写入 |
| 大航海感谢两键 | [guard-thanks-config.js](../../../src/bilibili/gift/guard-thanks-config.js)：`guardThanksEnabled` 仅 boolean/字符串 true/false；`guardThanksTextMode`=`bilingual/zh/en` |
| `danmakuOverlayStyle` / `danmakuFullscreenDurationSeconds` | 样式仅 `bubble/signal/minimal/ranked/transparent/identity/outline`；时长为 number 或十进制数字字符串，安全整数 2–30，存字符串 |
| 时钟设置 | [clock-contract.js](../../../src/server/clock-contract.js)：style 为九种已登记样式，hourFormat=`12/24`；日期/秒开关经 trim/lowercase 后仅 true/false/0/1；label 去控制符、合并空白、按 Unicode code point 截取前 16 个，存字符串；clockFlipFrameColor / clockFlipFaceColor / clockFlipTextColor 仅接受六位十六进制颜色 #RRGGBB 并统一小写；clockMoonMode 仅 light/dark/auto，clockMoonIntervalSeconds 仅 1–86400 整数秒，默认 light/30 |
| `openingTrackMotion` | [opening-contract.js](../../../src/server/opening-contract.js) 的 `heart/barber/progress` 枚举 |
| `openingStyle` | [opening-contract.js](../../../src/server/opening-contract.js) 的 `classic/pixel-cassette` 枚举；默认 `classic` |
| 互动外观 | [interaction-appearance.js](../../../public/js/shared/interaction-appearance.js)：标题/提示为字符串且最多 60/80 字素；规则文本转 LF、NFC；显示开关仅 boolean/字符串 true/false；透明度整数 0–100、字号 16–24、圆角 0–32（数字或 1–3 位数字字符串）；颜色为六位十六进制，存小写；数字/布尔存字符串 |
| `weSingCachePath` / `weSingLyricOffsetMs` | [wesing-cache.js](../../../src/music/wesing-cache.js)：路径转字符串、trim/去外层双引号，必须为绝对路径且末级名为 WeSingCache，长度 ≤1024、无控制字符；偏移 Number 转换、四舍五入后为 -3000～3000 ms，存字符串 |
| `checkinBlessings` / `fortunePool` | 兼容遗留键；字符串保持原样，其他值 JSON.stringify，null/undefined 按 String 保存；不是云端每日机器人配置入口 |

盲盒 normalizer 的边界补充：两个配置数组均最多100盒，每盒 outputs 为1–200项；归一化后 JSON UTF-8≤64 KiB。legacy 盒为 `{name,price,outputs}`，output 可名称字符串或 `{name,price?}`；名称 trim 后≤100个 UTF-16单元，禁止 NUL/换行。V2 盒为 `{customId?,giftId:null或ID,name,price,outputs:[{giftId,name,price?}]}`；customId 若提供须合法 UUID（转小写），giftId 为1–20位非零开头数字；名称 NFC、禁止所有 Cc。V2 盒名/customId/非空 giftId 不重复，每盒 output giftId 不重复。价格 Number 转换后须有限、>0且≤1,000,000元，四舍五入两位后仍>0；可选产物价 null/undefined 表示未知并省略。以上只定义可同步格式，不在客户端重建服务器收礼判定。

提交顺序：完整 normalize → 必要时 `weSing.prepareConfiguration` → `settings.setMany` → 必要时 prepared `apply` → `bilibili.configure` → 广播 `settings` → 按实际 `changedKeys` 决定请求 settings 云同步。任一字段或 prepare 无效都在写库前失败，也不会先启动新采集器；`setMany` 事务失败回滚全部设置及缓存。prepare 的文件系统准备与数据库不是跨资源事务，提交后的 apply/后续消费者失败也不承诺撤回已提交设置。`configure` 由运行时判断是否真的替换 Bilibili 连接。无变化或仅本机键变化不标记云 scope dirty；广播仍沿用现有行为。测试入口：[settings-contract.test.js](../../../test/settings/settings-contract.test.js)、[settings-bootstrap.test.js](../../../test/settings/settings-bootstrap.test.js)。

## 2.1 开播动画域(opening)

> 模块文件:[src/server/routes/opening-routes.js](../../../src/server/routes/opening-routes.js)
> 前缀:`/api/opening`

`GET /api/opening/config` 的 `style` 字段返回 `classic` 或 `pixel-cassette`，缺省及非法保存值回退 `classic`；
opening 页面能力的只读投影包含该字段。管理端通过现有设置接口保存 `openingStyle`，非法枚举返回 400。

| 端点                            | 请求                                                                                                  | 响应(data)                                                                                                                                                                    | 错误码                                         |
| ------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `GET /api/opening/config`       | 无；管理身份或 opening 页面能力                                              | 已清洗的文案、画质、开关、音量、轨道动效 `trackMotion`(`heart`/`barber`/`progress`)、当前音频与人物图 URL；未上传或文件缺失时对应 URL/名称为空且 `hasUploaded` 标志为 false，非法轨道值回退 `heart` | —                                              |
| `POST /api/opening/music`       | `multipart/form-data`，字段 `file`；≤ 64 MB，扩展名限 `.mp3/.flac/.wav/.aac/.ogg/.m4a/.wma`           | 保存至 data 目录下 `opening-music/` 并将其设为当前音频                                                                                                                        | 400(缺少/不支持音频文件)、413(超限)            |
| `DELETE /api/opening/music`     | 无                                                                                                    | 清除当前音乐选择，回到无音乐状态；保留已上传文件                                                                                                                               | —                                              |
| `POST /api/opening/character`   | `multipart/form-data`，字段 `file`；内容 ≤ 16 MB，扩展名限 `.png/.jpg/.jpeg/.webp` 且必须匹配图片签名 | 保存至 data 目录下 `opening-character/` 并将其设为当前人物图                                                                                                                  | 400(缺少、不支持或签名不匹配)、413(请求体超限) |
| `DELETE /api/opening/character` | 无                                                                                                    | 清除当前人物图选择，回到无人物图状态；保留已上传文件                                                                                                                           | —                                              |

上传文件使用随机文件名；音频和人物图分别只允许当前设置指向的文件通过 `/opening-media/` 与 `/opening-character/` 读取，原始文件名仅作为界面显示文本。本节写接口仅管理身份可用；opening 页面能力只能读取裁剪后的配置。

人物图上传与清除可携带查询参数 `style=pixel-cassette`，操作动画 2 独立的头像；省略或指定 `classic`
仍操作经典舞台人物图，非法样式返回 400。两种样式的素材互不覆盖，未上传时均为空。
配置新增 `pixelCharacterUrl`、`pixelCharacterName`、`hasUploadedPixelCharacter`；opening 页面能力仅接收
其中的图片 URL。图片读取只允许经典与像素样式各自当前选中的文件，替换或清除后旧文件不再可读。

### 2.2 normalizeRoomInput 实现细节([shared/utils.js](../../../src/shared/utils.js))

`roomId` 值经此函数规范化后再写库，规则按优先级：

| 条件                                                                  | 结果                           |
| --------------------------------------------------------------------- | ------------------------------ |
| 空字符串 / 纯空白                                                     | 返回 `''`                      |
| 纯数字字符串(`/^\d+$/`)                                               | 原样返回                       |
| URL 含 `live.bilibili.com/<数字>` 或 `live.bilibili.com/blanc/<数字>` | 提取路径数字                   |
| URL 含 `?room_id=<数字>` 或 `?id=<数字>`                              | 提取查询参数数字               |
| 其他含 ≥ 3 位连续数字的字符串                                         | 提取第一组连续数字（松散兜底） |
| 均无匹配                                                              | 返回 `''`                      |

在精确模式匹配之前先对输入做 `decodeURIComponent`，因此直接粘贴浏览器地址栏的编码 URL 也能正确解析。

### 2.3 parseCustomReplyRules 实现细节([bilibili/custom-reply-service.js](../../../src/bilibili/custom-reply-service.js))

`customReplyRules` 设置值存为 JSON 字符串，写入前经此函数校验并清洗：

1. 输入可以是数组或 JSON 字符串；非法 JSON 静默回退为 `[]`
2. 每条规则经 `normalizeCustomReplyRule` 清洗：`keyword` 截 30 字符、`reply` 截 120 字符，均经 `cleanText` 去控制字符；`enabled` 字段透传（`undefined` 时匹配时视为 `true`）
3. 过滤掉 `keyword` 或 `reply` 为空的条目
4. 截取前 `MAX_CUSTOM_REPLY_RULES = 30` 条

写入时 `JSON.stringify(parseCustomReplyRules(rawValue))` 落库；读取时再次 `parseCustomReplyRules(stored)` 反序列化使用。

## 2.4 萌时钟域(clock)

> 模块文件:[src/server/routes/clock-routes.js](../../../src/server/routes/clock-routes.js)
> 前缀:`/api/clock`

| 端点                    | 请求                                                       | 响应(data)                                                                                               | 错误码 |
| ----------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------ |
| `GET /api/clock/config` | 无；管理身份或 clock 页面能力 | 已清洗的 `style`（九套样式）、`showDate`、`showSeconds`、`hourFormat`、`label`、`flipFrameColor`、`flipFaceColor`、`flipTextColor`、`moonMode`（light/dark/auto）、`moonIntervalSeconds`（1–86400 的整数，默认 30）；非法存量值回退默认配置 | —      |

## 3. WeSing 采集域(wesing)

> 模块文件:[src/server/routes/wesing-routes.js](../../../src/server/routes/wesing-routes.js)
> 前缀:`/api/music/wesing/`(注册顺序在 music 模块之前,故该前缀不会落入 §4)

全部端点经 `weSingRoute` 包装:handler 抛错统一回 **400** `{ok:false, error}`。

| 端点                               | 请求                            | 响应(data)                                   | 错误码                                |
| ---------------------------------- | ------------------------------- | -------------------------------------------- | ------------------------------------- |
| `GET /api/music/wesing/status`     | 无                              | 全民K歌采集状态(WS 快照 `weSing` 字段同源)   | 400                                   |
| `POST /api/music/wesing/configure` | `{cachePath}`                   | 配置缓存目录(写回设置 `weSingCachePath`)     | 400                                   |
| `POST /api/music/wesing/offset`    | `{offsetMs}`                    | 设置歌词偏移(写回设置 `weSingLyricOffsetMs`) | 400                                   |
| `POST /api/music/wesing/active`    | `{active: boolean}`(必须为布尔) | 开关采集                                     | 400(非布尔时 `active 必须是布尔值。`) |
| `POST /api/music/wesing/refresh`   | 无                              | 立即刷新当前歌词                             | 400                                   |

行为文档:[music/wesing.md](music/wesing.md)。

## 4. 在线音源域(music)

> 模块文件:[src/server/routes/music-routes.js](../../../src/server/routes/music-routes.js)
> 前缀:`/api/music/`(不含 `/api/music/wesing/`,见 §3)

无效音乐平台由 provider owner 标记为 **400**，健康检查和 `sendProviderResult` 均返回稳定参数错误；其他未接入/Provider 错误保留 **501** `{ok:false,error}`。QQ 加密媒体记录的 URL 或重定向不符合 CDN 白名单时返回 **502**，不当作调用者参数错误，也不回传上游地址。`GET /api/music/health` 仍要求 token。

| 端点                                      | 请求                                                                                                                                                                                                                                                                          | 响应(data)                                                                                | 错误码                                                |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `GET /api/music/health`                   | 查询参数 `platform`(可选,空则全部)                                                                                                                                                                                                                                            | 各音源 Provider 健康状态([provider-health.js](../../../src/music/provider-health.js))     | 400（无效平台） |
| `GET /api/music/cache`                    | 无                                                                                                                                                                                                                                                                            | 音乐 API/歌词缓存统计                                                                     | —                                                     |
| `POST /api/music/resolve-stream`          | `{track, forceRefresh?}`(`forceRefresh: true` 跳过缓存)                                                                                                                                                                                                                       | 解析后播放流信息                                                                          | 400/501 |
| `GET /api/music/qq-encrypted-stream`      | `id` + session token;支持浏览器 `Range`                                                                                                                                                                                                                                       | 服务端短期 QMC2 解密的 FLAC/Ogg 播放流                                                    | 404/416/502                                           |
| `POST /api/music/search`                  | `{platform?`(默认 `netease`), `keyword                                                                                                                                                                                                                                        | query                                                                                     | songName`(必填,截断 120 字符), `limit`(1–30,默认 20)} | `{source, keyword, tracks}`                                | 501、400(缺关键词)                            |
| `POST /api/music/home`                    | `{platform?`, `action?`(`personalized`(默认)/`playlist-tracks`/`daily`/`radio`/`liked`/`created-playlists`/`collected-playlists`/`recent`), `limit`(1–5000,默认 100), `offset`, `page`(1–50), `playlistId?`, `refresh?`, `track?`(仅 `created-playlists` 附带时标注歌单归属)} | 首页/歌单内容(`personalized`/`playlist-tracks` 走 5 分钟 API 缓存,`daily`/`radio` 不缓存) | 501、400                                              |
| `POST /api/music/playlists/tracks/add`    | `{platform                                                                                                                                                                                                                                                                    | source?`(默认 `qq`), `playlist: {id                                                       | tid, dirId?, title                                    | dirName?(截断 200)}`, `tracks[]`(**≤ 100 条**,空数组报错)} | `{source, operation:'add', playlist, result}` | 501、400(`缺少要修改的音乐歌曲。`) |
| `POST /api/music/playlists/tracks/remove` | 同上(`tracks` ≤ 100)                                                                                                                                                                                                                                                          | `{source, operation:'remove', playlist, result}`                                          | 501、400                                              |
| `POST /api/music/lyrics`                  | `{track}`(经 `normalizeMusicTrackForProvider` 归一化;命中 30 天歌词缓存时附 `cached: true`)                                                                                                                                                                                   | 歌词数据                                                                                  | 400/501 |
| `POST /api/music/lyrics/parse`            | `{lyric, translation, wordLyric                                                                                                                                                                                                                                               | yrc, roma?}`(每段文本上限 512 KB)                                                         | `{lines: 解析后的时间轴行}`                           | —                                                          |
| `POST /api/music/match-track`             | `{songName                                                                                                                                                                                                                                                                    | title`(必填,截断 120), `artist`(截断 80), `durationMs?`, `candidates[]`(≤ 50)}            | `{request, threshold: 70, results}`                   | 400(缺歌名)                                                |
| `POST /api/music/cache/clear`             | 无                                                                                                                                                                                                                                                                            | 清空音乐 API/歌词缓存结果                                                                 | —                                                     |

请求体校验与截断规则见 [lyrics-service.js:44-171](../../../src/music/lyrics-service.js#L44-L171)。

行为文档:[music/services.md](music/services.md)(在线音源、播放器领域)。

## 5. 播放器持久化域(playback)

管理页实际 GET 的 HTML 启动信息携带服务端分配的 writerId/generation；同页发送端每次创建同步递增 senderGeneration，每次捕获快照递增 sequence。保存的 `payload.snapshotVersion` 为这四个字段，HTTP、IPC 与 beacon 使用同一版本，不依赖额外 HTTP 握手。新页面只领取代次时不抢占已有发送端；实际接受新代快照后，旧代次、旧序号或无版本降级返回 `{saved:false,reason:'stale-snapshot'}`。同一版本重放返回 `{saved:true,duplicate:true,bytes}` 且不再写库。旧存档读取保持兼容；持久化门槛及清空行为见 [storage.md](storage.md) §3.4。

> 模块文件:[src/server/routes/playback-routes.js](../../../src/server/routes/playback-routes.js)
> 前缀:`/api/playback/`

全部端点经 `storeRoute` 包装:store 抛错统一回 **400**，超限请求体透传统一 **413**。`clientId` 取值优先级:**body.clientId → query `clientId` → `'default'`**(`clientIdOf`,[playback-routes.js:22-24](../../../src/server/routes/playback-routes.js#L22-L24));历史与队列态按 clientId 隔离,收藏与歌单为全局。

| 端点                                         | 请求                                                                       | 响应(data)                                                        | 错误码 |
| -------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------ |
| `POST /api/playback/lyric-state`             | body(歌词行状态,经 `normalizeLyricState`;可选兼容 `generation`/`sequence`) | 接受时返回版本化 state 并广播；旧版本不广播，返回最后接受的 state + `nextGeneration`（当前服务代际门槛 + 1），供发送者恢复 | 400    |
| `POST /api/playback/lyric-timeline`          | body(歌词时间轴,经 `normalizeLyricTimeline`)                               | 归一化后的 timeline;同时广播 `lyric-timeline`                     | 400    |
| `GET /api/playback/history`                  | 查询参数 `clientId?`、`limit?`(默认 500)                                   | `{tracks}`                                                        | 400    |
| `POST /api/playback/history`                 | `{track, clientId?, origin?, requesterName?, playedAt?}`                   | `recordPlay` 结果                                                 | 400    |
| `POST /api/playback/history/remove`          | `{trackKey, clientId?}`                                                    | `{removed: boolean}`                                              | 400    |
| `POST /api/playback/history/clear`           | `{clientId?}`                                                              | 清空结果                                                          | 400    |
| `GET /api/playback/queue-state`              | 查询参数 `clientId?`                                                       | `{payload, updatedAt}`(无记录时 `{payload: null, updatedAt: ''}`) | 400    |
| `POST /api/playback/queue-state`             | `{payload, clientId?}`                                                     | 保存队列快照结果                                                  | 400    |
| `POST /api/playback/queue-state/clear`       | `{clientId?}`                                                              | 清空结果                                                          | 400    |
| `GET /api/playback/favorites`                | 无                                                                         | `{tracks}`                                                        | 400    |
| `POST /api/playback/favorites`               | `{track}`                                                                  | 添加收藏结果                                                      | 400    |
| `POST /api/playback/favorites/remove`        | `{trackKey}`                                                               | 移除收藏结果                                                      | 400    |
| `GET /api/playback/playlists`                | 查询参数 `id?`:带 `id` 返回 `{id, tracks}`;否则 `{playlists}`              | 歌单列表/歌单曲目                                                 | 400    |
| `POST /api/playback/playlists`               | body(歌单结构,`createPlaylist`)                                            | 新建歌单                                                          | 400    |
| `POST /api/playback/playlists/delete`        | `{id}`                                                                     | 删除歌单                                                          | 400    |
| `POST /api/playback/playlists/tracks`        | `{id, tracks[]}`(兼容 `track` 单曲)                                        | 向歌单加曲                                                        | 400    |
| `POST /api/playback/playlists/tracks/remove` | `{id, trackKey}`                                                           | 从歌单移除                                                        | 400    |

行为文档:[music/services.md](music/services.md)(播放器持久化、歌词状态)。

## 6. 主题预设域(theme)

> 模块文件:[src/server/routes/theme-routes.js](../../../src/server/routes/theme-routes.js)
> 前缀:`/api/theme/`

全部端点经 `themeRoute` 包装:抛错统一回 **400**。应用预设会写回 settings,故附带快照广播。

| 端点                             | 请求                                                                                | 响应(data)                                          | 错误码                                                  |
| -------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------- |
| `GET /api/theme/presets`         | 无                                                                                  | `{presets}`                                         | 400                                                     |
| `POST /api/theme/presets`        | `{name`(必填,截断 60 字符), `scope?}`;把**当前** settings 外观收成一套预设,同名覆盖 | `{preset}`                                          | 400(`缺少预设名称。`/`内置预设不能覆盖,请换一个名称。`) |
| `POST /api/theme/presets/apply`  | `{id}`                                                                              | `{preset, appliedKeys}`;广播 `theme:preset-applied` | 400(`预设不存在。`)                                     |
| `POST /api/theme/presets/rename` | `{id, name}`                                                                        | `{preset}`                                          | 400                                                     |
| `POST /api/theme/presets/delete` | `{id}`                                                                              | `{removed, id, name}`                               | 400(`内置预设不能删除。`)                               |

校验规则见 [theme-store.js:79-128](../../../src/storage/theme-store.js#L79-L128)。

行为文档:[storage.md](storage.md) §7(主题设置键)。

## 7. 歌库域(songs)

> 模块文件:[src/server/routes/song-routes.js](../../../src/server/routes/song-routes.js)
> 前缀:`/api/songs`、`/api/categories`

CSV/XLSX 端点走 `sendCsv`/`sendBuffer` 下载(带 BOM / `Content-Disposition`),其余为 JSON。`save/delete/toggle/import/import-xlsx` 未包 try/catch,校验失败经顶层 500 返回。

歌曲保存接受可选 `requestPrice` / `songClip`（兼容 `request_price` / `song_clip`）；省略保留已有值，显式空值清空。这两项保留内部空格与换行，规范化 CRLF、控制字符及首尾空白。客户端价格表单超过 1000 UTF-16 code unit 阻止提交，但历史超长值回填不截断；本地 API 不新增截断行为。

导入价格额外接受「点歌条件 / 点歌说明」；同一行价格别名的不同非空文本计为该行失败，相同值或一个非空值接受。默认 `import` / `import-xlsx` 仍以 HTTP 200 返回统计和 `failures: [{row, reason}]`，row 为解析后的数据行序号（从 1 起）；合法行继续导入，已有同歌名同歌手歌曲跳过且不更新。模板五首各使用一个价格文本，导出十列保持；核对平台按阶段 4 升级为导出保存值，CSV 仍保护公式前缀。要求与验收见 [点歌资料规范](../../../specs/song-request-metadata.md)。

显式更新使用独立本地鉴权 API，沿用现有 token、Origin 与授权边界；不改变云端 wire contract：

| 端点 | 请求 | 成功响应 `data` | 错误 |
| --- | --- | --- | --- |
| `POST /api/songs/import-preview` | `{rows?,base64?,allowEmptyClear?:boolean}`，XLSX 用 base64，否则提供保留实际列的原始行对象，1–5000 行 | `{previewToken,counts:{inserted,updated,unchanged,conflict,invalid},rows:[{row,name,artist,status,differences:[{field,before,after}],reason?}],canApply}` | 400 `SONG_IMPORT_INPUT_INVALID`，500 `SONG_IMPORT_FAILED` |
| `POST /api/songs/import-apply` | 同一原始输入和空值选项，加 `previewToken`；客户端不传执行计划 | `{total,inserted,updated,unchanged,conflict,invalid,createdCategories}` | 409 `SONG_IMPORT_PREVIEW_STALE`，422 `SONG_IMPORT_PREVIEW_INVALID`，400 输入无效，500 事务失败 |

错误体 `{ok:false,error,message}`；请求体必须是对象（`null`、数组、同时传 rows/base64 均为 400）。预览纯读取；应用在本地事务内重读全部歌曲及全部分类，重算变更并核对绑定输入和快照的 SHA-256 token。任一冲突/无效行或零变更不能应用；过期无写入。最终完整歌库超过 5000 首时新增和更新行均报无效，包括历史超限库的纯更新，提示先整理歌库且不自动删除。成功一次 `songs:import` 广播与一次 `cloudSync.request('songs')`，由既有 dirty/retry 控制器上传完整歌曲快照；失败不触发。token 是乐观并发检查，不替代 API 授权。

| 端点                           | 请求                                                                                                                                       | 响应(data)                                                             | 错误码                                                                                                                      |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/categories`          | 无                                                                                                                                         | 分类列表(`sort_order,name COLLATE NOCASE` 排序,`is_enabled` 布尔化)    | —                                                                                                                           |
| `GET /api/songs`               | 查询参数:`query?`、`category`(**可重复**,`getAll`)、`language?`、`artist?`、`tag`(**可重复**)/`tags?`、`enabledOnly?`(`'true'` 时只列启用) | `{songs}`(LIKE 模糊检索 name/artist/tags/分类名)                       | —                                                                                                                           |
| `GET /api/songs/template.csv`  | 无                                                                                                                                         | CSV 导入模板(UTF-8 BOM,文件名 `song-import-template.csv`)              | —                                                                                                                           |
| `GET /api/songs/template.xlsx` | 无                                                                                                                                         | XLSX 导入模板(文件名 `song-import-template.xlsx`)                      | —                                                                                                                           |
| `GET /api/songs/export.csv`    | 无                                                                                                                                         | 全量曲库 CSV(文件名 `songs-export.csv`)                                | —                                                                                                                           |
| `GET /api/songs/export.xlsx`   | 无                                                                                                                                         | 全量曲库 XLSX(文件名 `songs-export.xlsx`)                              | —                                                                                                                           |
| `POST /api/songs/save`         | `{id?`(有则更新,无则新建), `name                                                                                                           | songName`(必填), `artist?`, `categoryName                              | category?`(默认 `'默认'`,不存在自动建), `isEnabled?`, `note?`, `tags?`, `language?`, `sourcePlatform?`};自动生成拼音/首字母 | 保存结果;广播 `songs:save` | 500(`歌曲名不能为空。`/`歌曲不存在。`) |
| `POST /api/songs/delete`       | `{id}`                                                                                                                                     | `{id}`;广播 `songs:delete`                                             | 500                                                                                                                         |
| `POST /api/songs/toggle`       | `{id}`                                                                                                                                     | `{id}`;广播 `songs:toggle`                                             | **404**(`Song not found.`)、500                                                                                             |
| `POST /api/songs/import`       | `{rows[]}`(歌曲对象数组,结构与 save 一致)                                                                                                  | 导入统计 `{total, inserted, duplicate, failed, …}`;广播 `songs:import` | 422 `SONG_IMPORT_LIMIT_EXCEEDED` / 500 |
| `POST /api/songs/import-xlsx`  | `{base64}`(XLSX 文件 Base64)                                                                                                               | 同 import(先 `parseSongsFromXlsx`);广播 `songs:import-xlsx`            | 422 `SONG_IMPORT_LIMIT_EXCEEDED` / 500 |

行为文档:[music/services.md](music/services.md)(歌库服务)。

## 8. 播放队列域(queue)

> 模块文件:[src/server/routes/queue-routes.js](../../../src/server/routes/queue-routes.js)
> 前缀:`/api/queue/`

除随机点歌入口显式返回的规则提示外，抛出的错误沿用顶层 **500** 处理。

| 端点                     | 请求                                                                                                                                                                                                                                                                                                                                 | 响应(data)                                          | 错误码                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `POST /api/queue/add`    | `{songName`(必填), `artist?`, `categoryName?`, `requesterName?`(默认 `'主播'`), `requesterUid?`(默认 `'admin'`), `requesterGuardLevel?`, `requesterMedalName?`, `requesterMedalLevel?`, `source?`(默认 `'admin'`), `message?`(默认 `''`), `isPinned?`};命中曲库时自动补全 artist/category 并关联 `song_id`,同时写点歌流水 `requests` | 新队列项;广播 `queue:add`                           | 500(`歌曲名不能为空。`/`点歌队列已达到上限。`/`队列里已经有这首歌。`/`歌库里没有这首歌。`) |
| `POST /api/queue/action` | `{action, id?}`:`next`/`clear` 不需要 id;`pin`/`unpin`/`delete`/`done`/`skip` 需要 `id`(取第一首当前歌时置 `done`)                                                                                                                                                                                                                   | 队列快照 `{current, waiting}`;广播 `queue:<action>` | 500(`缺少队列 ID。`/`未知队列操作。`)                                                      |
| `POST /api/queue/random` | 无；忽略客户端提供的身份或指令，以服务端当前已登录 Bilibili 账号 UID 和用户信息门面中的昵称、可用房间身份调用现有“随机点歌”处理器；昵称不可用时显示 `UID <uid>` | 新队列项；来源为 `random`，广播既有 `queue:add`；不发送直播弹幕 | 401（缺少会话 token）；400（未登录直播账号、暂停点歌、用户冷却、无可随机歌曲、重复歌曲、队列上限）；其他异常沿用顶层 500 脱敏处理 |

校验与动作语义见 [queue-service.js](../../../src/music/queue-service.js) 的 `addQueueItem` / `handleQueueAction`(队列上限取自设置 `queueLimit`,`allowDuplicate`/`onlyFromLibrary` 开关生效)。

行为文档:[music/services.md](music/services.md)(点歌队列)。

## 9. 醒目留言域(superchats)

> 模块文件:[src/server/routes/superchat-routes.js](../../../src/server/routes/superchat-routes.js)
> 前缀:`/api/superchats/`

handler 未包 try/catch:抛错走顶层 **500**。

| 端点                          | 请求                                                                                          | 响应(data)                                    | 错误码                |
| ----------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------- | --------------------- |
| `POST /api/superchats/action` | `{action, id}`:`delete`(状态 `deleted`)、`assist`(状态 `assisted`)、`unassist`(状态 `active`) | SC 快照(按价格降序);广播 `superchat:<action>` | 500(`未知 SC 操作。`) |

行为文档:[bilibili/gift.md](bilibili/gift.md)(醒目留言)。

## 10. 礼物域(gifts)

> 模块文件:[src/server/routes/gift-routes.js](../../../src/server/routes/gift-routes.js)
> 前缀:`/api/gifts/`

礼物许愿接口由 `routes/gift-wish-routes.js` 合并到礼物路由。`GET /api/gifts/wishes` 返回当前授权来源的 `viewRevision/asOf/day/partial/session/items`；管理页额外取得内置舰队选择项。`POST /api/gifts/wishes/save` 接收 `viewRevision`、整数 `target`（1–999999999）、`label`（最多 40 字）；新建另需 `period`（`long/day/session`）及目录 `giftKey`（variantId 优先，舰队使用 guard ID），编辑只需 `id`，不改变礼物和起算时间。每个来源最多 30 条。`POST /api/gifts/wishes/delete` 接收 `viewRevision/id`。非法参数返回 400，来源未就绪或版本变化返回 409，客户端禁止选择 sourceId。保存/删除广播 `gift:wishes` 快照刷新通知。计数与时间窗口合同见 [礼物许愿](bilibili/gift.md#礼物许愿)。

保存支持可选 `displayStyle`（`card` / `text` / `circle` / `moonlit`）、`textTemplate`（最多 240 个 Unicode code point，含标记，去除首尾空白）、`textImagePosition`（`none` / `before` / `after` / `inline`，兼容旧位置配置）和 `textImageFormat`（`animated` / `static`）。新建缺省为卡片、空模板、不显示图片及动态原图；旧编辑请求省略字段时保留已保存值，非法枚举返回 400。另支持可选 `textPendingColor` / `textReceivedColor`（`#` 加六位十六进制颜色，保存为小写；空字符串使用默认色，新建省略同空字符串，编辑省略保留旧值，非法值返回 400）。两色字段同时包含在管理与 overlay 许愿投影中，按每条许愿保存，只作用于文字版。当前编辑器统一将图片位置写入模板的 `{图片}`，并将 `textImagePosition` 保存为 `none`；读取旧配置时转换成对应标记，显式图片标记优先，避免重复显示。上限为旧 200 字模板加图片标记留出空间。切换样式不改变礼物、创建时间或已收数量。这些字段及服务端计算的 `todayCount` 均包含在管理与 overlay 的许愿条目中，图片和动态标记的展示规则见 [前端页面](../frontend/pages.md)。

| 端点                                | 请求                                                                                                                          | 响应(data)                                          | 错误码                              |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ----------------------------------- |
| `POST /api/gifts/sprint/reset`      | 无                                                                                                                            | 重置礼物冲刺进度;广播 `gift:sprint:reset`           | —                                   |
| `GET /api/gifts/effects/resolve` | 查询参数 `giftId`（1–12 位正整数） | 解析可播放的 MP4 全屏特效，返回 `{giftId,effect}` | 400（ID 无效）、404（无可播放特效） |
| `POST /api/gifts/effects/preview` | `{giftId}`（1–12 位正整数） | 返回 `{giftId,effect}`，并广播 `gift:effect` 预览（`eventId:0,preview:true`） | 400（ID 无效）、404（无可播放特效） |
| `GET /api/gifts/history`            | 查询参数:`query?`(非空时规范化后 **1–100 个 Unicode code point**)、`range?`(`7d\|30d\|90d\|all\|today`,默认 `30d`)、`limit?`(**1–100**,默认 50)、`cursor?`(opaque keyset)、`sortField?`(`created_at\|gift_name\|price\|remarks`)、`sortDirection?`(`asc\|desc`)；`startDate/endDate`(北京时间 YYYY-MM-DD)、`userQuery/giftQuery`(独立名称交集)、`amountAbove?`(人民币元，非负且精确到分；单条总金额严格大于该值，留空不限；与其他条件取交集并绑定游标)、`viewRevision`(来源投影版本)；禁止 `sourceId/source_id` | 当前授权 source 的付费礼物分页、`total/totalPages` 及同步完整性状态 | 400(参数/排序/来源选择器无效)、409(来源未就绪) |
| `POST /api/gifts/selection` | `viewRevision`、可选 `eventIds`（最多 10000）及与 history 相同的筛选/排序 | 固定记录快照，不合并；无 eventIds 时选择全部筛选结果，保留 partial 状态 | 400(无效参数/超限)、409(来源变化或记录失效) |
| `GET /api/gifts/card-profiles` | 可选 `viewRevision`；来源由当前授权决定，日期固定北京时间今日 | 返回 `viewRevision/day/items/partial`；items 仅含 eventId、senderId、userName、avatarUrl、guardLevel、createdAt。运行时遍历服务端分页并验证来源、日期和同步代次；离线或旧服务器只复用同来源/日期缓存，否则返回空资料及 partial，不猜测身份 | 409(来源或日期变化/来源未就绪) |
| `GET/POST /api/gifts/display-settings` | POST 固定 palette、三个严格递增正整数分 thresholds、visibleRows(1–10)、scrollSpeed(1–50)，后两者须为整数；minGiftAmountCents 为非负安全整数分且是 10 的倍数（界面金额最多一位小数），省略默认 0 | 读取/保存本地礼物展示配置，保存后广播刷新；速率线性对应每行 5–0.1 秒，默认 12（每行 3.9 秒）。最小金额 0 不过滤，正数仅让当天合并后累计金额严格大于门槛的卡片进入滚动，不影响历史或导出。旧配置/请求缺金额字段补 0；合法 intervalSeconds、paused/lowPower 兼容读入为速率 1，保留配色和行数，返回与保存仅使用新字段 | 400(设置无效) |
| `GET /api/gifts/statistics`         | 查询参数:`query?`、`range?` 同 history;禁止 `sourceId/source_id`                                                          | 当前授权 source 的 8 项整数分 summary、`topGifts`(≤50)、`timeSeries`(≤240)及同步完整性状态 | 400(参数/来源选择器无效)、409(来源未就绪) |
| `GET /api/gifts/blind-box-stats`    | 查询参数 `boxName?`                                                                                                           | 盲盒统计                                            | —                                   |
| `GET /api/gifts/blind-box-analysis` | 查询参数:`viewer?`、`box?`、`view?`(默认 `users`)、`page?`(默认 `1`)、`limit?`(默认 `25`)、`sort?`、`direction?`(默认 `desc`)、`startDate?/endDate?`(本机日期 YYYY-MM-DD，含首尾两天；只给一端为单日，都省略为今天) | 当前授权来源的盲盒开盒分析；`dateRange` 返回生效日期，`today` 仍为本机当天零点 | 400(日期无效或逆序) |
| `GET /api/gifts/search`             | 查询参数:`from?`、`to?`、`limit?`(**1–500**,默认 100)                                                                         | 时间范围检索结果                                    | —                                   |
| `POST /api/gifts/frame/preview`     | `{userName?, giftName?, num?, themeId?}`；themeId 仅支持 `woodland-bloom`（默认），num 默认 1 | 广播 `gift:frame` 预览事件，不读取实时开关/阈值；不再需要金额（内部占位 1 分且不展示），旧金额若提供仍须大于 0，旧 motionMode 忽略 | 400(数量、主题或显式旧金额无效) |
| `POST /api/gifts/guard-thanks/preview` | `{tier, userName?, months?, textMode?}`；tier 为 `captain/admiral/governor`，months 为 1–999 整数（默认 1），textMode 为 `bilingual/zh/en`（默认 `bilingual`） | 广播独立 `gift:guard-thanks` 预览事件（`preview:true`，不带头像），不读取实时开关 | 400(等级、月数或文字模式无效) |
| `POST /api/gifts/clear-recent`      | `{confirm: true}`(必须)                                                                                                       | 清空最近礼物;广播 `gift:clear-recent`               | 400(`缺少清空确认。`)               |

行为文档:[bilibili/gift.md](bilibili/gift.md)(礼物事件、检测账本、冲刺)。礼物分区投影、同步完整性与查询合同见 [gift-ledger-projection-sync_design.md](../../../specs/gift-ledger-projection-sync_design.md) 和 [ADR-0011](../../architecture/adr/0011-source-partitioned-gift-ledger-projection.md)。

## 11. 加班机域(overtime)

> 模块文件:[src/server/routes/overtime-routes.js](../../../src/server/routes/overtime-routes.js)
> 前缀:`/api/overtime`

全部端点经 `overtimeRoute` 包装:抛错统一回 **400** `{ok:false, error}`。校验规则全部来自 [overtime-contract.js](../../../src/overtime/overtime-contract.js),常量:`MAX_OVERTIME_SECONDS = 315_328_464_000`(9,999 年)、`MAX_EFFECT_FACTOR = 1_000`、`MAX_RANDOM_WEIGHT = 100_000`、`MAX_ENABLED_RULES = 8`、`MAX_DISPLAY_TEXT_LENGTH = 6`。

| 端点                                    | 请求                                                                                                                                                   | 响应(data)                                                                                                                                                                                                                                                    | 错误码                                                          |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `GET /api/overtime`                     | 无                                                                                                                                                     | 加班机总览(`getSnapshot()`:`enabled/status/initialSeconds/effectiveRemainingMs/serverNowMs/revision/background/rules`) + `limits:{maxSeconds, maxEffectFactor, maxRandomWeight, maxRandomApplications, maxEnabledRules, minRandomOutcomes, maxRandomOutcomes, maxDisplayTextLength}`；另含 `pendingCount`、`quantityLimitedCount`（数量超限而尚未结算的笔数）与 `settlements` | 400                                                             |
| `GET /api/overtime/gifts`               | 无                                                                                                                                                     | 当前直播间礼物目录的最后成功快照：房间面板/配置和在售盲盒展开产物；不读取个人背包，服务器全局目录只按完整身份补充图片且不会覆盖成员范围                                                                                                                                                       | 400                                                             |
| `GET /api/overtime/gifts/catalog`       | 无                                                                                                                                                     | 本机付费全局目录完整快照，尚无缓存时为 `null`；供 Admin 全库浏览及前端名称/ID 筛选，按完整身份返回目录元数据和当前校验通过的 `/overtime-gift-images/<basename>`，读取过程不发起网络请求                                                                                                          | 400                                                             |
| `POST /api/overtime/gifts/refresh`      | `{}`                                                                                                                                                   | 手动刷新当前配置直播间的礼物面板、配置和在售盲盒展开；十秒内重复请求可返回缓存，并发请求单飞；服务器图片不可用时仍保留礼物并使用占位图                                                                                                                                             | 400（未配置有效直播间号或 Bilibili 上游返回错误）               |
| `POST /api/overtime/gifts/local/search` | `{query}`：字符串，去除首尾空白后 **1–100 字符**                                                                                                       | 在本机付费全局目录中按名称/ID 匹配，最多 100 个；不发起远程请求、不读取 Markdown 或静态图库，保留兼容，Admin 选择器改用完整快照在前端筛选                                                                                                                                                         | 400（查询无效或本地全局目录不可用）                             |
| `POST /api/overtime/gifts/server/search` | `{query}`：同上                                                                                                                                        | 兼容别名；执行与 `/local/search` 相同的纯本地查询，不刷新服务器、不修改当前直播间快照，Admin 不再调用                                                                                                                                                                       | 400（同 `/local/search`）                                       |
| `POST /api/overtime/time`               | `{initialSeconds?}` 与 `{remainingSeconds?}` **至少一个**,取值范围 **0–315,328,464,000**;`remainingSeconds` 设置后状态置为 `paused`(归零时 `finished`) | 更新后的快照                                                                                                                                                                                                                                                  | 400(`initialSeconds or remainingSeconds is required.`/越界报错) |
| `POST /api/overtime/action`             | `{action}` ∈ `start`/`pause`/`reset`/`enable`/`disable`                                                                                                | 更新后的快照                                                                                                                                                                                                                                                  | 400(`action must be start, pause, reset, enable, or disable.`)  |
| `POST /api/overtime/config`             | `{path?, fit?}`:`fit` ∈ `cover`/`contain`/`fill`(默认 `cover`);`path` 若非空必须是内置图片路径(正则 `/img/overtime-machine/…`,拒绝 `..`/反斜杠/协议头) | 更新后的快照                                                                                                                                                                                                                                                  | 400                                                             |
| `POST /api/overtime/rules`              | `{rules: [...]}`(规则数组,整体替换;校验见下)                                                                                                           | 更新后的快照                                                                                                                                                                                                                                                  | 400                                                             |

`rules` 元素字段与校验([overtime-contract.js:43-95](../../../src/overtime/overtime-contract.js#L43-L95)):

| 字段                        | 规则                                                                                                                                                                                               |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `giftId`(必填)              | 字符串,≤ 100 字符,**数组内不可重复**                                                                                                                                                               |
| `giftName`                  | ≤ 100 字符                                                                                                                                                                                         |
| `imagePath`                 | 新规则非空时使用 `/overtime-gift-images/<basename>` 或 `/img/admin/gifts/`、`/img/overtime-machine/` 内置路径；桌面远程目录可另使用已配置 HTTPS DNS origin 下的 `/gift-media/images/<basename>` URL；旧 `/img/bilibili-gifts/...` 仅作兼容迁移路径 |
| `mode`(必填)                | `fixed`、`random` 或 `display`                                                                                                                                                                     |
| `quantityMode`              | `group`(默认,按连击组)或 `item`(按具体数量)                                                                                                                                                        |
| `enabled`                   | 默认 true;**启用的规则 ≤ 8 条**                                                                                                                                                                    |
| `sortOrder`                 | 整数                                                                                                                                                                                               |
| `fixedEffect`(mode=fixed)   | `{operation, value}`:operation ∈ `add`/`subtract`/`multiply`/`divide`/`clear`;add/subtract 的 value ∈ **0–315,328,464,000**;multiply/divide 的 value ∈ **2–1,000**;clear 的 value = 0              |
| `outcomes`(mode=random)     | **2–10 项**,每项 `{operation, value, weight}`;weight ∈ **1–100,000**;**总权重 ≤ 100,000**                                                                                                          |
| `displayText`(mode=display) | 1–6 个 Unicode 字符；不得包含控制字符；收到礼物时只展示文字，不修改剩余时间                                                                                                                        |

行为文档:[overtime.md](overtime.md)。

## 12. 数据清理域(data)

> 模块文件:[src/server/routes/data-routes.js](../../../src/server/routes/data-routes.js)
> 前缀:`/api/database/`

清空类端点统一经 `clearRoute` 包装:body 必须 `{confirm: true}`,否则 **400** `缺少清空确认。`;成功后广播对应快照。清库范围见 [storage.md](storage.md) §6。

| 端点                                  | 请求                                                                                                         | 响应(data)                                                                          | 错误码                          |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- | ------------------------------- |
| `POST /api/database/clear`            | `{confirm: true}`                                                                                            | 清点歌库(songs/分类/导入批次,保留 settings 与主题);广播 `database:clear`            | 400                             |
| `POST /api/database/clear-superchats` | `{confirm: true}`                                                                                            | 清 SC 库;广播 `database:clear-superchats`                                           | 400                             |
| `POST /api/database/clear-playback`   | `{confirm: true}`                                                                                            | 清播放历史与队列态(保留收藏/歌单);广播 `database:clear-playback`                    | 400                             |
| `POST /api/database/clear-gifts`      | `{confirm: true}`                                                                                            | 先清当前 Device 认证主播的服务器礼物 ledger/outbox，再清当前本地 source 的礼物事件+结算流水并重建空投影；保留加班机状态/规则；广播 `database:clear-gifts` | 400、502/503(服务器未清理，本地不删除)、500(服务器已清理但本地失败) |
| `POST /api/database/clear-all`        | `{confirm: true}`                                                                                            | **清五库全部业务数据**(见 §12.1);调用前静默异步写入器;成功广播 `database:clear-all` | 400、**500**(部分失败,见 §12.1) |
| `GET /api/database/stats`             | 无                                                                                                           | `{schemaVersions, tables}`(各库版本 + 保留期统计行数/时间范围/raw_json 字节数)      | —                               |
| `POST /api/database/retention`        | `{dryRun?`, `confirm?`, `policy?}`:`dryRun: true` 只统计不删除(**免 confirm**,不广播);否则需 `confirm: true` | 保留策略执行统计;非 dryRun 广播 `database:retention`                                | 400(`缺少清理确认。`)           |

### 12.1 Clear-All 部分失败契约

`POST /api/database/clear-all` 使用两阶段协调，默认分类和禁用的加班机状态行在提交前、各自库的事务内重建。重建失败且全部回滚成功时返回普通 HTTP 500，业务数据保留；跨库提交、回滚或提交后的运行状态恢复失败时返回结构化部分失败:

**成功响应(HTTP 200)**:

```json
{
  "ok": true,
  "data": {
    "cleared": true,
    "scope": "all",
    "committed": ["songDb", "superChatDb", "giftDb", "musicDb", "checkinDb"],
    "preserved": [
      "settings",
      "ai_configuration",
      "theme_presets",
      "overtime_machine_state",
      "overtime_gift_rules",
      "favorites",
      "playlists",
      "playlist_tracks"
    ],
    "deletedCounts": {
      "songs": 100,
      "categories": 5,
      "queue": 10,
      "requests": 200,
      "importBatches": 3,
      "userCooldowns": 50,
      "aiRequestLogs": 1000,
      "aiApiUsage": 12,
      "aiViewerContext": 5,
      "aiQueryCache": 20,
      "aiBlacklist": 2,
      "sc": 30,
      "gifts": 500,
      "overtimeSettlements": 10,
      "playHistory": 300,
      "playQueueState": 1,
      "checkins": 80
    },
    "totalDeleted": 2328,
    "recreated": ["song_categories", "overtime_machine_state"]
  }
}
```

**部分失败响应(HTTP 500)**:

```json
{
  "ok": false,
  "partial": true,
  "error": "Commit failed at giftDb",
  "data": {
    "ok": false,
    "partial": true,
    "committed": ["songDb", "superChatDb"],
    "failed": ["giftDb"],
    "deletedCounts": {/* 各表统计,包括失败库的预统计 */},
    "results": [
      { "db": "songDb", "status": "committed" },
      { "db": "superChatDb", "status": "committed" },
      { "db": "giftDb", "status": "failed", "error": "database is locked" }
    ]
  }
}
```

**部分失败处理要求**:

- 前端检测 `response.partial === true` 时**强制刷新页面**并提示用户数据库不一致,需手动检查
- 部分失败后异步写入器(礼物检测/加班机恢复)**不恢复**,避免向不一致数据库写入
- `committed` 数组列出已清空的库,`failed` 列出失败的库
- 回滚失败附带 `data.phase: 'pre-commit'`、`committed: []` 和 `rollbackFailed`；提交后的状态重载/写入恢复失败分别附带 `data.phase: 'runtime-reset'`/`'resume'`、`cleared: false`、实际 `committed` 与 `failed: []`，表示数据库提交完成但运行状态尚未恢复
- 数据库处于不一致状态,建议用户手动清理或恢复备份

**静默协调(Quiesce)**:
清空全部前路由经 `api-context` 调用真实领域服务；暂停端口缺失会在清库前报错:

- `context.gifts.pauseDetection()`:停止检测、finalize 与消费重试；远端导入抛出 `GIFT_DETECTION_PAUSED`，避免同步游标越过未写入的记录
- `context.overtime.pauseRecovery()`:停止结算补偿与倒计时归零写入

成功后先恢复加班机消费者，再恢复礼物检测器；完整回滚的错误只解除当前请求取得的暂停，不能解除此前部分失败留下的暂停:

- `context.overtime.resumeRecovery()`
- `context.gifts.resumeDetection()`

行为文档:[server-core.md](server-core.md) §5、[storage.md](storage.md) §6(清空矩阵详细说明)。

## 13. AI 域(ai)

> 模块文件:[src/server/routes/ai-routes.js](../../../src/server/routes/ai-routes.js)
> 前缀:`/api/ai`

`ALLOWED_KEYS`([ai-routes.js:7-15](../../../src/server/routes/ai-routes.js#L7-L15)):`enabled, trigger, modelProvider, deepseekResponsesUrl, modelApiProtocol, deepseekApiKey, model, webSearchEnabled, reasoningEnabled, reasoningEffort, qweatherApiHost, qweatherApiKey, amapApiHost, amapApiKey, weatherEnabled, placesEnabled, routesEnabled, replyMaxChars, generationConcurrency, queueLimit, sendIntervalMs, userCooldownSeconds, roomLimitPerMinute, requestTimeoutMs, maxToolCalls, cacheTtlSeconds, contextTtlSeconds, systemPrompt`;`modelProvider` 固定枚举为 `auto, deepseek, openai, anthropic, gemini, custom`，官方预设的地址与协议由服务端强制；密钥键 `SECRET_KEYS = {deepseekApiKey, qweatherApiKey, amapApiKey}` 与 settings 隔离存 `ai_configuration` 表(见 [storage.md](storage.md) §3.1)。

**密钥字段安全契约**:GET 响应与 PUT 响应均**不回显密钥明文**;GET 返回 `has*ApiKey` 布尔标志(`hasDeepSeekApiKey, hasQWeatherApiKey, hasAmapApiKey`),密钥字段本身**不出现**在响应中;PUT 请求时传 `''` 跳过更新(保留现值)、传非空字符串更新、传 `null` 清空。前端渲染已保存密钥为 `'********'` 遮罩,提交时过滤该遮罩值(等同跳过)。

模型密钥不随目标隐式迁移：PUT 更换有效 origin（含供应商预设切换或恢复旧自定义地址）而复用已有 `deepseekApiKey` 时返回 400，整次配置不落库；须同时提供新值或 `null` 清空。`POST /api/ai/models` 更换有效 origin 时若未显式提供 `apiKey`，也返回 400 且不请求上游。同 origin 路径调整、显式密钥、自定义供应商能力与响应字段保持不变。

| 端点                         | 请求                                                                                                     | 响应(data)                                                                                                                                 | 错误码                                      |
| ---------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| `GET /api/ai/config`         | 无                                                                                                       | AI 配置(`getPublicConfig()`):密钥字段不出现；包含 `has*ApiKey` 与无密钥 `modelEndpoint {protocol, provider, webSearchMode, reasoningMode}` | —                                           |
| `PUT /api/ai/config`         | body:仅 `ALLOWED_KEYS` 子集生效(其余忽略);密钥键传 `''` 跳过、传 `null` 置空                             | 更新后的配置(同 GET,密钥不回显)                                                                                                            | 400(`AI 配置无效。`)                        |
| `GET /api/ai/status`         | 无                                                                                                       | AI 运行状态                                                                                                                                | —                                           |
| `POST /api/ai/models`        | `{apiKey?, apiUrl?, modelProvider?, modelApiProtocol?}`；Key ≤ 512、URL ≤ 2048、两个枚举字段各 ≤ 32 字符 | 当前模型服务的模型列表；官方供应商忽略 `apiUrl`/协议覆盖                                                                                   | 400(字段、枚举或上游响应无效)               |
| `POST /api/ai/test`          | 无                                                                                                       | DeepSeek 连通性测试                                                                                                                        | **502**(`{ok:false, error}`)                |
| `POST /api/ai/test/deepseek` | 无                                                                                                       | 该 Provider 连接测试                                                                                                                       | **502** `{ok:false, code(≤80 字符), error}` |
| `POST /api/ai/test/qweather` | 无                                                                                                       | 同上(和风天气)                                                                                                                             | 502                                         |
| `POST /api/ai/test/amap`     | 无                                                                                                       | 同上(高德地图)                                                                                                                             | 502                                         |

行为文档:[ai.md](ai.md)。

## 14. Bilibili 域(bilibili)

> 模块文件:[src/server/routes/bilibili-routes.js](../../../src/server/routes/bilibili-routes.js)
> 前缀:`/api/bilibili/`

| 端点                                           | 请求                                                                                                      | 响应(data)                                                                                                                                | 错误码                                                                                                                                                                           |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/bilibili/avatar?url={https图片地址}` | 仅接受 `https://*.hdslb.com/*`，沿用 session token                                                        | Node 后端代取头像或弹幕表情并以内联图片返回，浏览器缓存 1 小时；保留既有 `avatar` 路径名以兼容旧消费者                                    | 400、502                                                                                                                                                                         |
| `GET /api/bilibili/auth/state`                 | 无                                                                                                        | 登录状态 `{loggedIn, uid, message}`;非 Electron 环境返回 `{loggedIn:false, uid:0, message:'Bilibili 登录仅在 Electron 桌面环境中可用。'}` | 500                                                                                                                                                                              |
| `GET /api/bilibili/room/profile`               | 无；只查询当前已保存的直播间，沿用管理身份认证 | 房主资料 `{roomId, uid, name, avatarUrl}`，`roomId` 为解析后的房间号；未设置房间时字段为空，头像仍通过既有代理加载 | 502（房间解析失败；可选用户资料不可用时保留房间号和已知房主昵称） |
| `POST /api/bilibili/reconnect`                 | 无                                                                                                        | 手动重连结果;失败时同步更新 `liveStatus`                                                                                                  | **500** `{ok:false, error, detail, data:{liveStatus}}`                                                                                                                           |
| `GET /api/bilibili/danmaku/state`              | 无                                                                                                        | 弹幕发送器状态 + 设置 `checkinBlessings/fortunePool/customReplyRules`                                                                     | 500                                                                                                                                                                              |
| `POST /api/bilibili/danmaku/send`              | `{message`(**必填**,去空格后非空,否则 400 `弹幕内容不能为空。`), `mentionRequester?`(`true` 时@点歌观众)} | 发送结果                                                                                                                                  | 400、**502**(`{ok:false, error, detail}`,error 为 `publicDanmakuSendErrorMessage` 的人话文案:频率限制/未登录/房间号不对/风控 code=-352/拦截 code=-412/参数 code=-400/网络异常等) |

行为文档:[bilibili/danmaku.md](bilibili/danmaku.md)。

# 小游戏 API

游戏 owner 把 `isStreamer:true` 的弹幕（包括主播账号自动回复）排除出观众候选、数字炸弹/五子棋观众回合和画猜计分。画猜仍显示该弹幕；真正观众继续遵循单人指定 UID 或多人模式规则。

`GET /api/games/viewers` 先按需触发一次在线榜拉取，再返回当前在线快照中的直播间观众候选；
`GET /api/games/draw-guess/categories` 返回固定题库的分类摘要 `[{id,label,count}]`，不返回具体词条；当前内置 9 类、每类 100 词，共 900 个规范化后不重复的可画词条；
`GET /api/games/session` 返回当前公开游戏状态（数字炸弹不会返回炸弹位置；你画我猜在作画阶段不会返回题词或别名）；胜利后附加临时 `winner:{role:'host'|'viewer',uid,name}`，仅用于胜利展示；
`GET /api/games/host-state` 返回你画我猜主持状态 `{game,word,category,categoryIds,phase,round,totalRounds}`，供 Admin 私下显示题词并恢复本场所选分类；它仅接受管理身份，games 页面能力由服务端拒绝访问；
`GET /api/games/winner-profile` 按当前会话的 `winner` 临时查询 Bilibili 头像，返回 `{avatarUrl,name}`，没有胜者或查询失败时字段为空，不写入存储；`/games` 把该地址和你画我猜弹幕头像统一交给 `GET /api/bilibili/avatar` 代取，因此数字炸弹、五子棋结算与画猜消息不直接加载 CDN HTTPS；
`POST /api/games/session` 接受 `{game, mode, targetUid, targetName}` 开始会话；`draw-guess` 还可接受整数 `totalRounds`（1–12）、`roundDurationSeconds`（15–300）和分类 ID 数组 `categoryIds`。轮数与时长缺失或越界时分别回退为 5 和 90；`categoryIds` 缺失时使用全部分类，显式空数组、未知分类或非法 ID 返回 400，重复 ID 会去重，只有所选分类进入本场随机题池。`game` 为 `number-bomb|gomoku|draw-guess`；也接受 `{action:"stop"}` 结束会话，或在数字炸弹/五子棋结算后接受 `{action:"restart"}`，按相同游戏、模式和指定观众原子重开下一局。未结算时重开返回 409；已有会话时普通开始请求返回 **409** `{ok:false,error:'已有游戏正在进行，请先结束当前游戏。'}`，不会覆盖旧会话；
`POST /api/games/session/move` 接受主播的 `{value}` 落子；仅管理身份的你画我猜控制使用 `{value:{action:'finish-round'|'reveal-answer'|'next-round'}}` 结束作画、公布答案或开始下一题。时间到后会进入待公布状态，`reveal-answer` 前公开状态不含答案且弹幕仍会被收集但不计分；
`POST /api/games/session/draw` 接受 `{action:'append',clientId,strokeId,color,width,points:[{x,y}]}`、`{action:'clear',clientId}` 或 `{action:'undo',clientId}`。撤销由服务端按当前最后一笔决定，并在广播中带回被撤销的 `strokeId`；服务端只允许固定颜色/笔宽、1–32 个归一化坐标、最多 160 笔和每局 6000 个坐标，成功返回 `{revision}` 并广播 `game:draw`。没有可撤销笔画时返回稳定的 400 错误。沿用 `{ok,data}` 信封；管理身份拥有完整操作，展示页能力遵循 §0.0 限制。

你画我猜为内存会话，默认五局、每局 90 秒，允许配置 1–12 局和每局 15–300 秒；固定题库由 `src/games/draw-guess-words.js` 拥有，题目可带 `|` 分隔的等价答案，但分类摘要不会暴露这些词条。服务端单计时器到时结束作画并等待主播公布答案。会话公开状态保留本局开始后收到的弹幕（最多 500 条，含 uid、昵称、内容和可选头像地址），直到会话结束；观众弹幕按完整答案匹配，同一 UID 每局只计分一次，第 1/2/3 位分别得 10/7/5 分，其余答对者得 3 分，时间到后不再计分。

常规猜题消息完成计分后只发布一次包含新弹幕与最终得分的 `game:update`；错误答案仍更新聊天。游戏候选观众缓存按单调时钟保留最近十分钟，刷新 UID 时调整内部过期顺序，公开 `uid/name/lastSeenAt` 字段不变。

## 独立转盘 API

`GET /api/wheel` 返回当前内存中的转盘配置、总份数、最近结果、活动抽取动画和服务端 `limits:{minEntries,maxEntries,maxLabelLength,minWeight,maxWeight,maxTotalWeight}`；`POST /api/wheel/config` 接受 `{entries:[{label,weight}]}`，服务端限制 2–12 个不重复内容、每项 1–100 份、总份数不超过 300；`POST /api/wheel/spin` 按服务端权重抽取并广播 `wheel:update`。转盘 service 与 `/api/games/session` 独立，不参与数字炸弹、五子棋或你画我猜的单会话互斥。沿用 `{ok,data}` 信封；管理身份拥有完整操作，展示页能力遵循 §0.0 限制。


## 投票与评分（类别 3）

拥有者：`src/games/interaction-session-service.js`；路由：`src/server/routes/interaction-routes.js`；组合：`src/server/game-runtime.js`。全部状态仅在本地内存中。

| 方法 / 路径 | 调用者 | 合同 |
| --- | --- | --- |
| `GET /api/interactions/session` | 管理端、interactions scope | `{ok:true,data:{runtimeId,revision,session}}`，空场 session=null，不启动收集 |
| `GET /api/interactions/host-state` | 管理端 | 公开 envelope 加 ready、blockedReason、participants；无 UID/未公布总分 |
| `POST /api/interactions/session` | 管理端 | `{kind:'poll'|'rating',title?,options?,durationSeconds?}`；poll 1–6 项，每项 1–10 字素，时长 1–3600 秒 |
| `POST /api/interactions/session/finish` | 管理端 | `{sessionId}`；立即退订、冻结保留结果，同一已完成场次幂等 |
| `POST /api/interactions/session/clear` | 管理端 | `{sessionId}`；取消或关闭结果，推送带新 revision 的 null |

配置 16 KiB、最坏公开快照 64 KiB；主题最多 60 字素。配置错误 400，body 超限沿用 HTTP 解析器错误；未就绪、活动冲突、过期 sessionId 返回 409。配置规范化为 trim+NFC，前后端共享 `public/js/shared/interaction-rules.js`；隐藏字符拒绝，完整 RGI emoji 的 ZWJ/变体选择符保留。类别 1 未结束时不能开始类别 3，类别 3 collecting 时不能开始/重开类别 1；finished/interrupted 不占跨类收集资格，本类结果需先 clear。

`interactions` 凭据只能 GET 本类公开 session；通用 `/api/state` 与 WS snapshot 只投影本页外观设置（键与默认值见 [storage.md](storage.md)），不含其他领域。不能写入、读 host-state 或其他领域；games 凭据不能读取本类。外观由管理身份通过 `POST /api/settings` 更新：标题/提示分别最多 60/80 个可见字符，可为空（留空隐藏）；`interactionRatingRules` 接受多行纯文本及空字符串，统一 CRLF/CR 为 LF 并进行 NFC 规范化，保留空行与手动换行，仅修改展示文案；四个颜色仅接受 `#RRGGBB`；背景/整体不透明度为 0–100 整数，文字大小为 16–24 整数，圆角为 0–32 整数；状态/人数显示接受布尔值或字符串 `true`/`false`。数值和布尔设置均保存为字符串；非法值使整批设置返回 400 且不写入。评分未结束只发 average=null，不发人数/分布/总分，主持人数由 host-state 提供；结束才公开均分与人数。数字炸弹/五子棋结果新增可选 restartBlocked，供旧游戏展示页禁用下一局。
