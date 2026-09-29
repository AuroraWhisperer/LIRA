# 礼物许愿文字图片与今日收礼状态

**Status:** Completed

## 目标与边界

文字版许愿可隐藏图片、放在文字前/后或第一个礼物名称前，可选择动态原图或静态 PNG；今日收到至少一个匹配礼物时由现有粉色切换为绿色。沿用北京时间日界线、来源隔离与 variant 精确匹配。卡片/徽章的完成效果、统计周期、鉴权和 OBS 地址不变，不调整服务端礼物目录或新增依赖。

## 当前行为与归属

`src/bilibili/gift/wish-service.js` 从最终账本计算许愿，`src/storage/gift-wish-store.js` 保存定义，gift_db 当前 v14。图片只有一个已校验的本地 imagePath；部分盲盒源为 PNG，普通礼物没有配套静态图。`public/js/shared/gift-wish-card.js` 由管理页与 OBS 共用，文字版目前不显示图片且按 completed 变色。

接口由 `src/server/routes/gift-wish-routes.js` 拥有，OBS 白名单在 `src/server/overlay-projection.js`。契约更新到 `docs/reference/backend/{api,storage,bilibili/gift}.md` 与 `docs/reference/frontend/pages.md`；直接测试为 `test/gifts/{gift-wishes,gift-wish-routes,frontend-gift-wishes}.test.js`。

## 兼容与实现

- v15 幂等追加 `text_image_position`（none/before/after/inline，默认 none）、`text_image_format`（animated/static，默认 animated）。旧定义保留所有数据；编辑省略参数时保留已存值。
- 保存接口验证可选 `textImagePosition`、`textImageFormat`；快照附带这两个字段及 `todayCount`。同一次快照使用同一时间点；本日条目复用 count，其余按当日账本读取，不写累计器。
- 静态模式由共享 renderer 对本地图片取默认帧/首帧生成内存 PNG，复用转换结果；图片失败沿用占位图，不回退成动画。原图模式沿用现有图片加载。图片处理独立于模板文字，仍用 DOM/textContent，不解释 HTML。
- 实际 OBS 沙盒验证发现不带 CORS 的图片会污染 canvas。转换用 `crossOrigin=anonymous`；`http-utils.js` 的公开、已校验礼物缓存图片响应补充与 public 静态资源一致的 `Access-Control-Allow-Origin: *`。不发送凭据、不改 HTML 沙盒和 API 权限。补充 opaque-origin 浏览器用例及 `test/overtime/overtime-routes.test.js` 的实际 HTTP 头断言。
- 图片位置合并为一个选择项（不显示、文字前、文字后、礼物名称前）；没有 `{礼物}` 时嵌入位置回退文字前。第一处名称插入一次图片，多次名称不重复图片。格式选择只在显示图片时展开。
- 文字版以 `todayCount > 0` 切换绿色，即使累计目标此前已完成，今天未收到仍用粉色。卡片/徽章保留 completed 语义。

## 里程碑与验证

- [x] 存储/领域/投影：覆盖 v14 升级与重复迁移、配置保存重启和省略保留、非法枚举、今日计数/跨天/来源/盲盒/舰队。运行 `node --experimental-vm-modules --test test/gifts/gift-wishes.test.js test/gifts/gift-wish-routes.test.js test/storage/database-maintenance.test.js`。
- [x] 管理与 OBS：覆盖开关/位置/格式、编辑重置、首帧 PNG、缺图、安全文本、今日状态刷新。运行 `node --experimental-vm-modules --test test/gifts/frontend-gift-wishes.test.js test/admin/admin-page-composition.test.js test/admin/admin-style-ownership.test.js`。
- [x] 视觉验收：复用隔离 Electron fixture、真实 preload/本地运行时和合成数据，实看前后/名称内三种排版，以及长文字换行、今日收过/未收状态；动画 WebP 的红/绿双帧用例验证静态 PNG 固定红色首帧。实际保存、重开和 OBS 缓存图片显示通过。所有测试资源由本任务创建并关闭。
- [x] 收尾：`npm run check`、`npm run verify:architecture`、`npm run verify:docs`；审查本次差量，执行 `git diff --check` 和 scoped `git status --short`，真实结果见下。

## 验证结果

2026-09-28：以上六组与 `test/overtime/overtime-routes.test.js`、`test/overlays/overlay-http-access.test.js`、`test/overlays/overlay-projection.test.js` 合并运行，71/71 通过。JS 全库语法检查通过（1043 文件），末次修改后另做受影响 JS 语法检查。Impeccable 对改动前端文件的机械检查返回空列表。独立 Electron 管理页 HTTP 200、真实 preload 与桌面授权会话可用；OBS HTTP 200、opaque origin 下 PNG 加载成功。长文本与三种位置对比未见水平溢出，名称内图片仅出现在第一处标记。

全局门禁存在与本任务无关的失败：架构检查 20/22 通过，`gift-display.css` 与 `frontend-gift-display-settings.test.js` 超出未登记行数门槛，`start-animation.js` 含空 catch；文档检查 8/9 通过，另一份 `2026-09-28-danmaku-canvas.md` 计划状态未符合索引校验。本任务不改这些并行工作，许愿相关契约与验证已完成；归档不代表全库门禁通过。

测试进程、浏览器和数据库已关闭；删除本次临时测试目录的命令被自动执行策略拒绝（blocked by policy），没有改用其他方式绕过，合成数据文件保留在系统临时目录。

## 失败处理与完成条件

测试只使用隔离临时库，不启动生产 main.js 或读取真实账号。迁移仅追加列，可停用新增 renderer 配置而保留数据；如需撤回，逐段反向修改本任务差量，不重置工作区。配置保存/重开一致、实际静态图不播放、北京时间跨天恢复颜色、两种展示消费方一致且相关测试通过后完成。已有未提交改动必须保留。
