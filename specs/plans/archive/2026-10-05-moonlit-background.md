# 月渡花汀静态背景实施计划

Status: Completed (2026-10-05)

## Goal and boundaries

以项目已有过程原画 `tmp/opening-moon-fan/source/landscape-v2.png`（1672×941）适度调色并输出 1920×1080，作为套装中的“背景”以及独立背景分类添加到直播画布。用户明确要求以最初的浅淡截图为色彩基准：降低整体对比和饱和度，避免原画浓重的山水颜色抢占直播主体。使用原始素材加工不等于恢复原画浓度。保留原构图、留白及静态性质。不修改已有开播动画、不增加上传或动画功能，不提交代码。

## Current behavior and ownership

`component-preview-suites.js` 已列出月渡花汀四个组件；`scene-extra-components.js` 统一声明独立组件，前后端自动消费其类型与参数。现有套装浏览器测试覆盖添加、保存、输出。复用此注册机制、组件协议和场景服务，不引入新持久化结构或业务数据源。

Contract owners: `specs/component-scenes.md`、`docs/reference/frontend/overlays.md`、`pages.md`。Consumers: picker、canvas add flow、template import、sandboxed output。保留已有工作区改动、文档版本、认证和隔离边界；`background` 是新增允许类型，旧客户端不保证识别它。

## Milestones

- [x] 处理原图并输出内置 WebP 与缩略图；检查构图、浅银蓝层次、灯火与 16:9 尺寸。按用户追加反馈，以首张浅淡壁纸为准，替换过浓的中间版本。
- [x] 注册独立 `background` 类型，配置仅 `style: moonlit`。新增 `/background` 静态渲染页，沿用 sandbox allow-scripts 与预览握手；无 HTTP/WS 业务请求。分类与套装复用同一素材。画布添加时填满当前画布、插入底层；保留正常图层操作。
- [x] 模板不要求背景绑定业务来源；扩展现有套装用例检查置底、尺寸、图片解码、保存、输出和重载，运行组件契约检查，更新说明并复核任务差异。

## Files and verification

素材位于 `public/img/overlays/backgrounds/` 和 `public/img/component-previews/`。新页面、样式和模块为 `public/pages/overlays/background.html`、`public/css/overlays/background.css`、`public/js/overlays/background.js`。

修改上述共享定义、套装注册、picker 图标、`component-preview-canvas-view.js` 的添加规则、`scene-template.js` 的绑定规则与 `http-utils.js` 的新页面映射；测试复用 `canvas-component-suites.test.js`、`scene-extra-components.test.js`。

验证命令：

```
node --experimental-vm-modules --test test/admin/scene-component-definitions.test.js test/scenes/scene-extra-components.test.js test/admin/scene-document-model.test.js
node --test test/admin/canvas-component-suites.test.js
npm run verify:quick
git diff --check
git status --short
```

沿用隔离测试夹具，不访问真实用户数据；检查浏览器源渲染，不声称合成桌面 fixture 验证了 Electron 特权能力。视觉检查仅覆盖新增静态图与套装入口。

## Failure handling and completion

用 `tmp/moonlit-background/before/` 的任务前快照核对并仅撤销本任务修改，不覆盖其他改动。完成条件：素材可见且无动画；分类和套装均可添加背景；置底及画布尺寸正确；保存输出、模板与已有组件行为通过检查；文档和最终差异一致。

## Verification results

- 27 项组件定义、场景额外组件和文档模型测试通过。
- 36 项管理页面、overlay HTTP 权限与 scene HTTP 测试通过。
- 套装集成测试通过：五个组件各一份、2560×1440 画布背景置底并铺满、图片解码、完整输出无背景动画、保存与重载正常。测试选择器已按实际自定义下拉的 button/option 语义修正。
- `npm run verify:quick` 通过（文档、JS 检查、架构边界）；`git diff --check` 通过。
- 使用现有内存数据库 fixture 完成浏览器视觉检查：套装五张卡片、背景分类添加、1920×1080 与同套时钟搭配、隐藏/恢复、重开套装后无重复卡片或图层，页面无溢出和 pageerror。截图在 `tmp/moonlit-background/suite.png`、`canvas.png`；最终浅色 WebP 约 637 KiB。
- 自有浏览器与 fixture 已关闭；未操作用户运行中的 Electron 或直播软件，未做实播验证。
