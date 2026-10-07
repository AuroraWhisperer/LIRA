# 背景滤镜与样式包参数

Status: Completed

## Goal

画布背景可调白平衡、暗部/中间调/亮部颜色、辉光、周边模糊、暗角、色阶和颗粒。图片与视频共用渲染，作者在既有样式包 config 中携带参数，预览、保存、重开和正式来源保持一致。

## Boundaries and compatibility

- 只扩展背景外观字段；不改变 HTTP/IPC 路由、权限、数据库结构、其他组件及既有媒体生命周期。
- 参数缺省为无效果。旧媒体的 fill/音量兼容、作者默认快照、实例独立和旧包导入保持。
- 不解析 Shoost/VTS 工程，不新增可执行包格式，不导入人物、竖屏素材或生成本次背景美术。
- 不提交、不发布，保留当前工作区所有先前改动。临时证据写入 tmp/。

## Ownership and design

- public/js/shared/background-appearance.js：唯一背景字段表、范围、默认值和面板分组元数据；使用既有扁平 config。
- src/server/scene-extra-config.js：沿用白名单/类型/范围/步长校验，增加色阶黑白场关系校验；backgroundDefaults 经过同一校验。
- public/js/admin/background-parameter-view.js：复用现有控件和 controller，折叠分组、数字/滑块同步、checkbox、恢复作者默认。
- public/js/overlays/background-filters.js：背景专用 SVG 像素处理；复用 levelTable。辉光在不透明画面内部混合，最终恢复输入 alpha；默认时不创建滤镜，不复制视频、不启动动画循环。
- public/js/overlays/background.js：统一连接现有媒体的 filter 并释放滤镜资源。滤镜顺序固定并写入合同，避免引入未经请求的任意效果编辑器。
- docs/reference/frontend/overlays.md 是字段合同；docs/guides/background-style-packages.md 是作者/AI 可直接使用的包结构、JSON 示例、导入流程及错误说明；现有包指南链接过去。

## Milestones

- [x] 扩展字段、服务端校验和分组控件。验证旧配置保持、异常字段与黑白场被拒绝。
- [x] 实现背景滤镜。验证不透明亮部扩散、透明度不变、调色/暗角/模糊/颗粒生效、重复调参不重复媒体或泄漏节点。
- [x] 验证 ZIP inspect/install、默认快照、场景保存重开及正式输出；使用现有隔离 Electron 夹具检查真实入口。
- [x] 编写并通过真实导入器验证文档 JSON；检查最终增量 diff、git diff --check、git status。

## Verification

使用 node --experimental-vm-modules --test 运行受影响的 scene-extra-components、component-styles、背景 browser 和 admin 集成测试；node --test 运行隔离 Electron 背景流程。扩展到 npm run check、verify:docs、verify:architecture，原因是共享字段、持久化合同与新的渲染模块。不运行无关全套业务测试。

## Rollback and done

发生失败时仅回退本次文件增量，不覆盖已有工作。完成条件是参数及导入在上述路径通过、文档可执行示例经导入器确认、无新增媒体请求或播放重置、隔离进程清理且证据记录。实际 OBS/直播姬推流与硬件性能不由自动化结果代替。

## Validation findings and user correction

- 字段/旧配置/默认快照验证通过；实际图片与 WebM 经 inspect/install 接受示例字段。
- Chromium 沙箱像素检查覆盖白平衡冷暖与绿洋红方向、亮度保持、三区乘色、单通道色阶、三种不透明辉光、周边模糊、暗角、颗粒、alpha、恢复中性及重复调参节点清理。
- animated wallpaper 的画布检查通过：动态/静态切换、连续播放、保存、发布、重开、减少动态与恢复作者默认。参数变更保持原视频元素和进度。
- 初次隔离 Electron 验收已通过真实桌面导入、参数、无效黑白场、保存、发布、重开及恢复。用户指出展示的蓝白素材被调黄：原因是临时验收设置 temperature=45、preserveLuminance=false，并非包默认值。原素材与旧包未修改。
- 按用户反馈将作者示例改为原色柔光：白平衡与分区强度归零，辉光 0.12、阈值 0.9、柔和度 0.1，其他默认中性；文档明确保持亮度不等于保留色相，分类参考 Shoost，算法/范围和简化乘色不是 Shoost 数值兼容。
- 新增银蓝样本检查通过；隔离桌面补验使用原蓝白素材。画布采用小数缩放，恢复后的截图存在 GPU 重新栅格化差异，故比较同一素材 URL、filter=none、每通道平均绝对差 <1、颜色均值偏移 <0.5；不声称整张缩放截图逐字节一致。无缩放沙箱仍要求中性恢复像素一致。
- npm run check 与 verify:architecture 通过。完整 component-styles 检查 12/13 通过，已有 Moonlit 点歌板字号配置 30 与测试预期 22 不符，与背景无关，未改。
- 首次 verify:docs 6/10 通过：其他文档引用已迁移测试、woodland 活动计划状态、AI 路由表及规格证据路径失败。本次背景文档及清单未出现在失败项中，不修改其他任务的文档或测试。
- 归档后最终 verify:docs 为 9/10 通过：其他任务已更新链接，当前仅余 2026-10-06-woodland-frame-avatar 活动计划状态检查失败。本次全部文档链接、示例路径和归档索引通过；git diff --check 通过，保留并发的其他文件修改。
- 最终隔离 Electron 补验通过（约 60 秒）：恢复原色再次保存后，正式来源同步清除滤镜；原色柔光保存后，正式来源重新应用滤镜。最终恢复截图的通道平均偏移绝对值 <0.00001，原色保留。证据位于 tmp/background-filters-qa/desktop-canvas.png、original-blue.png、soft-blue.png。临时 Electron 数据与进程由测试关闭并清理；不控制用户运行中的应用。
- 最终相关命令：node --test test/desktop/background-filters-electron.test.js；node --test test/overlays/background-filters.test.js；node --experimental-vm-modules --test --test-name-pattern="background|static and reduced|hiding pauses|old play|disposal" test/scenes/scene-extra-components.test.js test/scenes/component-styles.test.js test/overlays/background-filters.test.js test/overlays/background-moonlit.test.js；背景相关全部通过。文档最终示例再次经 inspect/install 验证通过。
- 未构建安装包、未提交或发布；实际 OBS/直播姬及不同 GPU 性能未实测。已有无关检查失败不作为本次背景实现的未完成事项。
