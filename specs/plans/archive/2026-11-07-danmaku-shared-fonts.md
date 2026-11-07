# 新弹幕字体复用与 CDN 字库更新

**Status:** Completed

**目标：** 核对近期弹幕的字体需求；保留有视觉依据的六款字体，将其加入各组件共用的字体菜单和既有 CDN 下载流程，更新多吉云字体包及清单。

**实现边界：** 沿用 `src/fonts/catalog.json`、`public/js/shared/font-catalog.js`、`src/resources/resource-packages.js` 与资源缓存 owner。保留字体原文件、字重、族名、旧 URL 和 OFL；不为每款样式另下载字库，不更改弹幕布局或已保存的字体值。用户于本次会话明确选择三款字体加入通用字库。

**范围发现：** 复核过程中其他进行中任务又注册了渐变气泡、天穹横栏与玻璃气泡。按用户要求覆盖新增样式字体，将 Montserrat、Cinzel 与 M PLUS Rounded 1c 一并纳入；Montserrat 两款样式的 300/400/700 字重合为一个包。此发现已告知用户，本次核对共 14 款近期样式。

## 当前证据与字体取舍

| 近期样式 | 默认字体与决定 |
| --- | --- |
| 极光薄笺、星轨飞语 | 复用既有界面字体；没有新增字库的视觉或功能要求。 |
| 漫画对白、沉笺、星尘 2.0 | 保留现有系统宋体／衬线链；仍可通过共享字体参数选择其他字库。 |
| 暗月 | 复用已有 Nunito；原样式比对记录已说明无需另引 Quicksand。 |
| 郁香海风、郁香海风 · 随机、线框星事 | 保留完整思源宋体 Regular；已有对照记录显示系统宋体偏细。三款共用同一 WOFF2。 |
| Stargazer · 星旅 | 保留 Poppins 400/700，满足既有参考排版；中文继续系统回退。 |
| Glass 玻璃通知 | 保留 Quicksand 300–700 可变字体，满足既有参考字形；中文继续系统回退。 |
| 渐变气泡、天穹横栏 | 保留 Montserrat 400/700 与 Latin 300，不替换原参考字形，归入一个共享包；天穹横栏昵称另保留 Cinzel Latin 700。 |
| 玻璃气泡 | 保留 M PLUS Rounded 1c ExtraBold 800，满足原款日文粗圆体；缺字继续中文回退。 |

六款新增字体共九文件、18,679,284 字节。原有共享库 13 款、56 文件；开始时线上清单 v2 的 60 个文件、17 个包与本地原清单完全一致。远程基线保存在 `tmp/danmaku-font-library-update/remote-manifest-before.json`。第一批三款已上传并完成远程摘要校验，完整目标为 19 款、65 个字体文件。

## 所有权与文件

- `src/fonts/catalog.json`：新增六款具名字体；通过 `bundled[].aliases` 保留线框星事与天穹横栏的旧族名。
- `public/js/shared/font-catalog.js`：通用菜单新增六款字体；西文与日文字体提供对应预览文本。
- `public/css/shared/display-fonts.css`：静态开发入口声明相同字体和字重；七份弹幕样式移除自己的 `@font-face`，继续使用原族名。
- `package.json`：六款字体二进制退出安装包，OFL 仍随包保留；字体路径不迁移。
- `src/resources/catalog.json`：由 `npm run export:resources` 生成，旧包和兼容图片摘要保持不变。
- `test/desktop/bundled-fonts-electron.test.js`：扩展现有安装资源验收，证明完整字体不在 ASAR；既有测试验证实际菜单解码、一次下载和断网重开。
- 字体 README、`docs/guides/cdn-resources.md`、`docs/reference/frontend/overlays.md`：同步来源、菜单数量、字节和交付方式；检查内置指南，字体操作步骤保持原入口。

## 里程碑与验证

- [x] 核对近期 14 个样式的 CSS、合同与字体来源记录；核实云端原有 13 包及清单基线。
- [x] 更新字体目录、共享 CSS、菜单和打包排除规则，扩展既有 ASAR 验收并导出资源。
- [x] 运行 `node --test test/engineering/cdn-resource-export.test.js test/desktop/font-downloads.test.js test/desktop/cdn-resource-library.test.js test/transport/font-assets.test.js test/ui/font-library-loader.test.js`；34/34 通过，覆盖缓存、损坏、更新及离线行为。
- [x] 运行 `node --test test/desktop/bundled-fonts-electron.test.js`；最终 1/1 通过：19 款真实字体正确显示、首次 20 个下载、离线重开零下载；夹具隔离 profile/session/cache/端口，不操作用户应用。
- [x] 运行 `npm run verify:docs`；首次 9/10，唯一失败为其他进行中的 Animated Gradient 计划缺少标准 `Status:` 字段；本任务状态字段已核实。归档后的最终复核保存在 `tmp/danmaku-font-library-update/docs-tests.log`。触及 diff 已检查，最终差异和状态检查与本记录归档一起收尾。
- [x] 比对导出结果与线上基线，上传六个新 ZIP，完整下载核对大小和 SHA-256，再更新 `resources/manifest.json`；远程与本地逐字节一致，全部原条目保留。

## 完成证据与交付边界

- CDN 现有 19 个字体包，清单共 69 文件、23 包；首次下载 19 字体包和地图，102,222,033 字节，旧客户端兼容图片仍为 61,380,128 字节。六款新增字体包共增加约 17.82 MiB，Montserrat 两款样式共包。
- 清单 SHA-256：`6f2c12ad26af48ae7236a8250f1c3db26ff8be90f8e2eecdb9599f82b597d592`。逐包校验见 `tmp/danmaku-font-library-update/remote-package-verification.json`，清单及旧资源保留检查见 `remote-manifest-verification.json`。
- 多吉云最终清单刷新任务于北京时间 2026-11-07 12:58 提交，控制台显示已完成、1/1 条生效。字体目录显示 19 项。浏览器截图接口两种调用均未能返回图片，保留 HTTP 字节与摘要证据，不伪造截图。
- 34 项 Node 检查与 1 项隔离 Electron ASAR/实际字体/下载/断网重开验收通过；源字库原文件及许可未改变。最后审查时确认 65 个共享文件之外仅有两份固定标题裁剪字体，七份样式 CSS 不再重复声明字体。
- 技术参考、字体来源及用户指南已同步；交互导览复用既有选择、保存入口。未提交、分支、构建或发布客户端安装包；菜单新增需要使用包含本次源码的客户端版本。

## 失败处理与完成条件

上传或验证失败时保留线上旧清单与全部旧文件，不通过删除、降级校验或改安全设置继续。只回退本任务拥有的改动；用户原有修改保留。若生成资源有变化，以具名内容摘要区分，先包后清单。六款字体进入所有共用选择器、安装包不再携带完整文件、现有样式原字体链仍可解析、聚焦验证通过、云端新包及清单校验通过，才完成本计划。
