# 滚动礼物卡片外观实施计划

**Status:** Completed

**目标：** 尾部与条带内部纹理独立组合；保留现有默认外观，增加五种内部纹理，并统一管理预览、画布、滚动画面与 PNG 导出。

**架构：** 继续由共享 `gift-banner.js` / `gift-banner.css` 渲染卡片；配置仍由 `display-settings.js` 校验并写入原 `giftDisplayConfig`。不增加依赖、下载、进程或权限。

## 范围与兼容

- 默认 `tailStyle: 'slant'`、`textureStyle: 'solid'`；旧设置和请求缺字段时补默认，原金额、行数及速度完整保留。
- 尾部为经典斜切、双色燕尾；燕尾仅下尖角变浅并稍向右错开。不采用未获认可的分层飘带。
- 内部纹理为丝缎流光、星屑幻彩、几何拼片、菱格织纹、糖纸波点，另保留原纯色。
- 两个字段可独立选择，采用现有保存／取消／恢复默认及画布共享设置流程。
- 保留 428×72 基础尺寸、价格配色、名称适配、数量扩宽、头像框、现有地址和滚动机制。
- 不改变身份、礼物核算、远程服务、数据存储结构或 Electron 生命周期；保留工作区其他修改。

## 所有者与消费者

- 选项：新增 `public/js/shared/gift-banner-styles.js` 供设置、画布及后台校验共用。
- 配置：`src/bilibili/gift/display-settings.js`；现有路由和 `scene-shared-appearance.js` 继续拥有写入。
- 渲染：`public/js/shared/gift-banner.js`、`public/css/shared/gift-banner.css`；滚动页的缓存签名包含外观字段。
- 浏览器源投影：`src/server/overlay-projection.js` 仅增加两个显示字段，保持既有 scope 与鉴权；由真实 overlay HTTP 与投影测试验证。
- 设置 UI：`public/pages/admin/toolbox/gift.html`、`public/js/admin/gifts/display-settings.js`、`public/css/admin/gift-display/settings.css`。
- 画布：`public/js/shared/scene-extra-components.js`、`public/js/admin/scene-extra-parameter-layout.js`。
- 契约：`docs/reference/backend/api.md`、`docs/reference/frontend/overlays.md`；用户步骤：`public/pages/admin/toolbox/usage-guide-guard-thanks.html`。核对交互引导是否受影响。

## 交付与验证

- [x] 增加兼容的独立配置、预览控件和共享渲染；用已有设置／横幅／场景测试覆盖保存、旧值兼容、取消及节点复用。
- [x] 接入画布与滚动画面刷新；确认组合不会引发重复节点、额外请求或改变滚动尺寸。
- [x] 同步 API、前端参考及用户步骤；确认旧默认仍是原效果。
- [x] 使用隔离 Electron 夹具检查桌面选择与保存、五种纹理及双色燕尾；复用现有测试，不触碰用户运行实例和数据。
- [x] 聚焦检查：`node --experimental-vm-modules --test test/gifts/gift-banner-feed.test.js test/gifts/gift-routes.test.js test/gifts/frontend-gift-banner.test.js test/gifts/frontend-gift-display-settings.test.js test/gifts/frontend-gift-feed.test.js test/scenes/shared-appearance.test.js`。
- [x] 运行 `npm run verify:docs`，相关语法／ESM 检查，以及最终改动审查；差异及状态检查随归档收尾执行，既有架构债务项见下文。

## 当前验证结果

- 六个礼物／场景相关套件 41/41 通过；隔离 Electron 中原样默认、五种纹理、燕尾下尖角和真实设置接口保存通过。
- overlay HTTP／投影、画布组件库、ESM 与架构检查共 45 项通过；架构检查的既有 `public/js/admin/client-settings.js` 空 catch 债务项失败，该文件在本任务开始时已是其他工作的未跟踪文件，本任务未修改。
- 画布组件库扩展了两个选项的操作与已发布输出断言，单独重跑 2/2 通过；礼物／场景、overlay HTTP／投影、画布共 64 项产品相关测试通过。
- 八个实现 JS 文件语法检查通过；文档门禁修正状态标签后 10/10 通过，归档后再核对导航。UI 检测仅提示既有数量字段的 Arial 字体，本次保持原字体。
- 隔离桌面实际检查了默认外观、五种纹理、两种尾部及设置接口保存。额外尝试刷新时，夹具的合成授权租约已过期并转到授权页，未把这次刷新记为通过；设置恢复由相关自动化覆盖。测试实例与临时数据已清理。
- 技术参考与应用内使用步骤已同步；旧截图保留并在图注明确新增入口位置，交互引导不包含此次改变的控件，无需改动。没有提交、打包、发布或操作用户运行实例。

## 失败与收尾

失败时只定位并撤回本任务的具体变更，不使用重置或整文件覆盖回滚。验收以旧配置保留、两个选项独立持久化、所有共享输出一致和相关测试通过为准；完成后将实际结果写入归档摘要并退出活动计划。
