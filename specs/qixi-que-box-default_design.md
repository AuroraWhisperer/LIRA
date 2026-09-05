# Feature: 七夕鹊匣默认映射与主题卡片

## Requirements (EARS Format)

- 当软件初始化默认设置时，系统应将“七夕鹊匣”作为第四个内置盲盒，成本为 25 元，并包含用户确认的六种开出礼物价值。
- 当已有用户升级且非空配置中没有“七夕鹊匣”时，系统应在保留用户现有配置的前提下追加该盲盒；已有空字符串或合法 `[]` 表示用户明确清空，不应回填默认盲盒。
- 当管理页渲染“七夕鹊匣”映射时，系统应按礼物 ID 从服务器目录取得盲盒本体图片；图片暂不可用时仍显示映射和占位图，并保持偏紫粉色主题。
- 当最近礼物属于“七夕鹊匣”或礼物本身名为“七夕鹊匣”时，系统应按礼物 ID 使用当前房间目录返回的服务器图片或占位图，并保持同一偏紫粉色主题卡片。
- 盲盒本体及开出礼物不再依赖打包的 Bilibili 礼物图库；服务器目录按精确礼物 ID 提供图片，运行时按需缓存到 `data/overtime-gift-images/`。

## Architecture

### Frontend

- `public/js/admin/gifts/recent.js` 维护已知盲盒名称到主题类的映射，并按 `/api/overtime/gifts` 返回的礼物 ID 图片映射渲染最近礼物。
- `public/css/admin/gifts/blindbox-mapping.css` 为默认映射卡片增加“七夕鹊匣”粉紫主题。
- `public/css/admin/gifts/recent.css` 为最近礼物卡片增加同名主题，沿用现有两列信息和右侧 48px 图片布局。
- 调色板：浅樱粉 `#fff2fb`、雾紫 `#f3e8ff`、主粉紫 `#d786dc`、深紫粉 `#9b3fa6`、悬停色 `#bb63c4`。

### Backend

- `src/storage/settings-store.js` 将新盲盒追加到 `DEFAULT_SETTINGS.giftBlindBoxConfig` 的第四位。
- 现有 `migrateBlindBoxConfig()` 对非空旧配置按名称合并缺失默认条目；空字符串只规范化为 `[]`，合法 `[]` 在重复启动时保持为空，因此无需新接口或数据库结构。
- 默认人民币价值：月下牵丝 5、锦书传意 19、鹊语相思 26、云桥缘续 66、星河相拥 500、宸星定情 1200。

### Security

- 不新增外部输入、接口、权限或数据库查询。
- 映射名称和图片属性继续使用现有 `escapeHtml()`、`escapeAttr()` 输出编码。
- 图片路径只接受服务器目录校验后的本地同源缓存路径，不接受用户控制的 URL；缺失图片使用内置占位图。
- 迁移仍以解析后的数组和精确盲盒名称去重，不覆盖用户已有同名配置。

## Acceptance Criteria

- 默认配置解析后共有四个盲盒，第四个名称为“七夕鹊匣”、成本为 25。
- 非空升级配置只在缺失时追加“七夕鹊匣”，保留前三个和用户自定义条目；明确的空配置跨重启仍为 `[]`。
- `getBlindBoxIcon()` 对 `blind_box_name`、配置 `name` 和礼物 `gift_name` 都能识别“七夕鹊匣”。
- 映射卡片及最近礼物卡片按精确礼物 ID 使用 `/overtime-gift-images/<basename>` 服务器图片缓存；缓存缺失时使用现有占位图，不按名称复用其他礼物图片。
- 源码和安装包不包含 `public/img/bilibili-gifts/`、`public/img/bilibili-gifts.json` 或三份礼物 Markdown；运行时服务器图片缓存位于 `data/overtime-gift-images/`。
- `npm run check` 和 `npm test` 通过。
