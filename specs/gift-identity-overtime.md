# Gift identity across catalogs and overtime

## Goal

同一 B 站 ID 重新上架为不同名称、标价、币种或背包属性的礼物时，各自资料、图片、奖池和加班规则保持独立。本文扩展原目录同步和服务端权威礼物规格中的 ID 唯一假设；既有兼容协议和已完成结算不重写。

## Requirements

1. 新版 main process 请求 `catalog?schemaVersion=3`，验证完整包、身份 SHA-256、业务摘要和关系后原子保存。镜像保留全部 gold 身份，真实 ID 单独保留。schema 2/3 的礼物项必须含具名 `giftCategory`；生产两端同步升级并重新安装客户端，不兼容旧目录类别标记。
2. 身份为 `(giftId, normalizedName, priceRaw, coinType, bagGift)`，`variantId` 为该数组 JSON 的 SHA-256 加 `gv_` 前缀。名称按 NFKC、折叠空白和 ASCII 小写规范化。标价不等于实付单价。
3. Device pull/history/SSE 主动发送 `X-Lira-Gift-Identity: 1`。两个新增可空字段 `giftVariantId`、`blindBoxVariantId` 来自服务端冻结账本；旧服务器仍可提供原字段，规范化身份为 null。身份字段不完整或格式错误拒绝整条 wire 记录。
4. gift-data.db v10 增加事件身份列，规则改为 `(gift_id, gift_identity_key)` 主键并保存 `gift_identity_json`。已有规则原样迁移为空身份，数字平台 ID 的规则返回 `bindingStatus: needs-selection`，尚不生效。大航海别名保持原有兼容语义。
5. 新规则传 `giftIdentity: {variantId, priceRaw, coinType, bagGift}`，结合 giftId/giftName 校验身份摘要。不同身份可分别设规则，同一身份不可重复。最终结算只匹配真实 ID 和冻结身份；未知身份不匹配平台规则。设置重选、更新或重启均不回放 applied/ignored 流水。
6. 选择器显示名称、真实 ID、标价与角色，同 ID 候选分别可选。旧规则显示重新选择入口，重选保留模式、时间、随机结果、数量方式、启用状态和位置。缺少完整资料的房间候选显示待同步。
7. 房间补图和盲盒展开只使用完整身份。官方盒子及产物分别按 variantId 展示；自定义映射须有匹配的 ID、名称、标价及唯一候选。图片 index schema 2 用 variantId 保存最近成功图片，换图失败仅回退本身份，旧数字 ID 索引不用于跨身份回退。
8. 首次捕获的本地身份保持冻结；旧客户端已导入但未保存身份的历史可校验原展示投影后幂等跳过，不补填身份或重放消费者。已有非空身份发生冲突拒绝导入；游标提交继续与导入使用原事务。
9. 最近收礼和来源盲盒图标优先按冻结身份查图。无身份的旧记录只允许 ID、名称唯一匹配；同名改价存在多个候选时用占位图。换图失败可保留本身份旧图，其他身份和缺图候选不得被合并。特殊盲盒样式也须名称匹配。
10. 缺少可用图片或浏览器加载失败时，所有礼物图片位置统一回退到随应用打包的 `/img/gift-placeholder.png` 通用礼盒插画，包括加班选择器、规则、OBS 票券、最近收礼及盲盒配置。旧占位路径在展示层映射到新图；图片刷新和重选后继续保留回退能力。默认图本身失败时停止重试并保留周围礼物名称，不能写回目录、身份或图片缓存。

11. 目录类别统一为 `directGift`（直送礼物）、`blindBox`（盲盒）、`blindBoxOutput`（盲盒产物），替换目录 `isBlindBox`。main 校验枚举及关系一致性：关系来源必须是盲盒，非盒子产物必须标为产物，产物必须有来源。类别包含在服务端业务摘要内并原子缓存，renderer 直接使用类别；关系仅补充来源名称。身份未匹配不沿用旧类别。原始 metadata 和收礼事件/账本的 `isBlindBox` 不变，不按目录重新结算；概率可以后补。

The complete catalog response must have a finite decoded-byte budget as specified in [desktop/main.md](../docs/architecture/desktop/main.md#21-设备授权生命周期). Exceeding that budget fails the refresh atomically, preserving the last valid catalog and ETag.

## Acceptance criteria

- 完整目录读取遵守 [桌面响应容量合同](../docs/architecture/desktop/main.md#21-设备授权生命周期)。达到上限的合法正文可读取；多一个字节即取消 reader、返回 `RESPONSE_TOO_LARGE`，已有内存/磁盘目录及 ETag 不变。不得截断身份或把不完整目录写成成功版本。验证：`test/remote-catalog-capacity.test.js`。

- 同 ID 的旧名称、新名称、同名新标价三个规则并存，分别触发 30、60、90 秒；没有身份的同 ID 事件不触发，重放与重启不二次结算。
- 旧数字 ID 规则迁移后保留原设置并提示重新选择；选择新礼物后仅后续该身份事件生效。
- 目录刷新、非法摘要、本地写失败与重启不会丢失已保存的不同身份；图片下载失败不显示另一个身份的图。
- 同 ID 的不同盲盒不能互相展开奖池或共用规则图片。
- 源图为空、404 或解码失败时显示同一打包 PNG；默认 PNG 失败不循环请求，后续新图可正常显示；相关礼物展示共用同一回退函数。
- 最近收礼中同 ID 改名、同名改价、来源盒子换代各自取图，未知和歧义项不会借用另一个活动的图。
- 桌面及 390px 窄屏的规则和选择器完整显示价格、待重选提示；取消不改绑定，保存重选不改原来的数量方式和时间操作。
- 新增字段与旧字段两种 wire 形状均兼容；非法或矛盾身份被拒绝，历史同步不触发加班。

- 数字 0/1、字符串 0+1、未知/缺失类别、关系与类别冲突均拒绝；失败刷新不替换内存/磁盘快照。三种类别、共享奖池、同 ID 不同身份在重启及选择器中保持一致。

## Ownership and verification

Owners: `src/shared/gift-identity.js`, `src/bilibili/gift/variant-catalog-contract.js`,
`src/bilibili/gift/remote-catalog-cache.js`, `src/bilibili/gift/hybrid-catalog.js`,
`src/storage/gift-identity-migration.js`, `src/overtime`, and Admin overtime modules.
Verification: `test/gift-category.test.js`, `test/gift-identity-catalog.test.js`, `test/overtime-service.test.js`,
`test/overtime-gift-picker.test.js`, `test/processed-gift-import.test.js`, and
`test/remote-gift-image-cache.test.js`, `test/gift-artwork-identity.test.js`,
`test/gift-image-fallback.test.js`. Shared wire/catalog fixtures live in
the adjacent lira-server repository's normative protocol fixtures directory.

## Non-goals

不发布服务、不安装桌面版本、不重算历史、不改变租户或鉴权边界，不改手动输入 ID 的特效预览和无关统计口径。
