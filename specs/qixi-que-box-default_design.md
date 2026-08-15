# Feature: 七夕鹊匣默认映射与主题卡片

## Requirements (EARS Format)

- 当软件初始化默认设置时，系统应将“七夕鹊匣”作为第四个内置盲盒，成本为 25 元，并包含用户确认的六种开出礼物价值。
- 当已有用户升级且配置中没有“七夕鹊匣”时，系统应在保留用户现有配置的前提下追加该盲盒。
- 当管理页渲染“七夕鹊匣”映射时，系统应显示盲盒本体图片和偏紫粉色主题。
- 当最近礼物属于“七夕鹊匣”或礼物本身名为“七夕鹊匣”时，系统应显示本体图片和同一偏紫粉色主题卡片。
- 当礼物图片被打包时，盲盒本体应位于 `blind-box/`，开出礼物应继续位于现有价值区间目录。

## Architecture

### Frontend

- `public/js/admin/gifts/recent.js` 维护已知盲盒名称到本地图片及主题类的映射。
- `public/css/admin/gifts/blindbox-mapping.css` 为默认映射卡片增加“七夕鹊匣”粉紫主题。
- `public/css/admin/gifts/recent.css` 为最近礼物卡片增加同名主题，沿用现有两列信息和右侧 48px 图片布局。
- 调色板：浅樱粉 `#fff2fb`、雾紫 `#f3e8ff`、主粉紫 `#d786dc`、深紫粉 `#9b3fa6`、悬停色 `#bb63c4`。

### Backend

- `src/storage/settings-store.js` 将新盲盒追加到 `DEFAULT_SETTINGS.giftBlindBoxConfig` 的第四位。
- 现有 `migrateBlindBoxConfig()` 已按名称合并缺失默认条目，因此无需新接口或数据库结构。
- 默认人民币价值：月下牵丝 5、锦书传意 19、鹊语相思 26、云桥缘续 66、星河相拥 500、宸星定情 1200。

### Security

- 不新增外部输入、接口、权限或数据库查询。
- 映射名称和图片属性继续使用现有 `escapeHtml()`、`escapeAttr()` 输出编码。
- 图片路径是代码内固定的同源静态路径，不接受用户控制的 URL。
- 迁移仍以解析后的数组和精确盲盒名称去重，不覆盖用户已有同名配置。

## Acceptance Criteria

- 默认配置解析后共有四个盲盒，第四个名称为“七夕鹊匣”、成本为 25。
- 升级迁移只在缺失时追加“七夕鹊匣”，保留前三个和用户自定义条目。
- `getBlindBoxIcon()` 对 `blind_box_name`、配置 `name` 和礼物 `gift_name` 都能识别“七夕鹊匣”。
- 映射卡片及最近礼物卡片都使用 `/img/bilibili-gifts/blind-box/35786.webp`。
- 本体图片位于 `public/img/bilibili-gifts/blind-box/35786.webp`；不存在独立的 `qixi-que-box/` 目录。
- `npm run check` 和 `npm test` 通过。
