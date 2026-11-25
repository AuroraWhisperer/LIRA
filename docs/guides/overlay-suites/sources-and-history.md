# 月渡花汀：来源、路径与版本决策

核对日期：2026-10-06（本地仓库 `D:/Work/Live`，服务端仓库 `D:/Work/lira-server`）。本表仅记录当日快照，后续继续开发前请先核对最新源码，不要直接当成当前线上状态。

## 参考视频与图片

主参考：[Bilibili · BV14BXWYSELi](https://www.bilibili.com/video/BV14BXWYSELi/)。历史对话称其为《飞花令·画堂春》。保留干净链接，去掉追踪参数。

| 参考范围 | 用途 | 来源依据 |
| --- | --- | --- |
| 视频 1:30–1:33 右侧 | 普通弹幕底框、笔墨染色、身份区分 | 用户在「设计月渡花汀弹幕姬」中指定 |
| 视频 2:13 之后 | 礼物卡片布局、顺滑滚动、卷轴及消息展示 | 用户在「改进礼物感谢弹幕样式」中指定 |
| 全屏送礼 / 上任段落 | 四周装饰、上方英文、下方感谢、层次和顺序 | 多个感谢对话与用户截图；未记录统一精确秒数 |
| 最初冰蓝古风截图 | 开播的画法、色彩和精细度 | `cbe32f7f-…/image-1.png` |
| 用户后续浅淡壁纸截图 | 静态与动态背景的颜色强度 | 静态壁纸对话中的浅色版本 |

上述时间点摘自历史对话记录（整理时未重播外站视频），同时核对了本地参考图与成品静帧。参考截图仅用于分析构图与节奏，本项目全部美术素材均另行生成与加工，未直接使用视频截图。

**30 张本地参考图全部找到并复制。** 完整原绝对路径、图片说明、关联对话和归档文件见[参考截图索引](../../../archive/moonlit-suite/reference-index.md)；逐文件散列见[归档清单](../../../archive/moonlit-suite/manifest.json)。其中既有外部样式参考，也有用户指出问题时截取的中间版本，不能全部当作目标图。

## 对话索引

以下 11 个对话的摘录整理自历史聊天记录，保留了当时的用户提问、最终回复、附件路径和图像生成请求。分支对话可能包含重复的前情，部分中途调整只体现在后续成片或终稿回复里，因此摘录并非完整的原始操作日志。

在 Codex 中可用 `codex://threads/<ID>` 定位。标题保留应用中的原名。

| 对话标题 | ID | 本次提取重点 |
| --- | --- | --- |
| 评估开播动画与礼物感谢 | `01a10a4e-187b-79a2-9124-e62895883fbc` | 母风格、原创分层、开播 15 秒与中等背景密度 |
| 评估开播动画与礼物感谢 (2) | `01a10af7-3791-7102-aa34-d15b2af3120e` | 全屏感谢的分层探索、取消第一层、第三层材质与动效 |
| 设计月渡花汀弹幕姬 | `01a10b45-dee9-7563-959b-73041590ddf7` | 普通观众 + 三档大航海身份、上任、礼物/SC、动作放慢、使用现有徽章 |
| 制作礼物感谢装饰 | `01a10b48-7e75-71a1-bf6d-28759fbf4f69` | 用户确认接礼物许愿；贴圆装饰、墨条长度、折扇起点 |
| 设计月渡花汀配套时钟 | `01a10b47-007d-7392-8262-7a07ad6f3600` | 同主题复用、深浅两版、固定与自动交替 |
| 优化舰长与礼物感谢样式 | `01a10b63-0344-7091-b25e-c33ff469595a` | 底部信息布局、必须展示完整组合、贴底调整 |
| 查找月渡花汀全屏动画 | `01a10bbd-aaf2-7183-abd1-3b5b8d60336a` | 明确是礼物感谢；最新月伞花汀；文楷、去掉“新”、未接事件 |
| 改进礼物感谢弹幕样式 | `01a10bf5-3eeb-7342-9a06-9969d39b065a` | 最终纸面向左/装饰向右；深底框保留；高清预览；暗纹仍是提案 |
| 添加套装组件标签页 | `01a10c15-4c20-7da0-97ef-4d540c5cea29` | 套装显式分组，各组件分别添加 |
| 美化套装静态壁纸 | `01a10c34-6cab-79d2-855f-cbea5be8dc50` | 从开播过程原图加工浅色壁纸；要求明显的独立元素运动 |
| 重制并优化动态背景 | `01a10c78-0147-76d0-81ea-d99ebcee7cbf` | 分层重制替代旧图扭曲，最终确认 2K / 60fps 完整成片 |

本地摘录文件：`D:/Work/Live/archive/moonlit-suite/conversations/thread-excerpts.json`。历史助手所说“通过”“已同步”属于当时报告，本次另外核对了下文的本地文件，未重新进行那些功能检查。

## 原路径与本地归档路径

归档采用统一映射：原文件 `D:/Work/Live/<相对路径>` → `D:/Work/Live/archive/moonlit-suite/files/<相对路径>`。下表写原仓库相对路径；在归档中前面加 `files/` 即可找到已精选复制的文件。不是对原目录做无差别全量备份，准确范围以清单为准。

| 部件 | 原制作目录 | 应优先查看的文件 |
| --- | --- | --- |
| 开播 | `tmp/opening-moon-fan/` | `source/generation-prompts.json`、`source/revision-prompts.json`、`prepare-assets.py`、`prepare-revision-assets.py`、`月渡花汀-动画预览.html`、`月渡花汀-v2-完整往复动画.webm` |
| 静态背景 | `tmp/moonlit-background/` | `grade.py`；输入来自开播 `source/landscape-v2.png` |
| 动态背景分层 | `tmp/moonlit-background-rebuild/` | `source/prompts.json`、三张源图、`prepare-assets.py`、`render-scene.js`、`loops/placements.json` 和六层透明循环 |
| 动态背景最终 2K | `tmp/moonlit-background-hq/` | `prepare-assets.py`、`render-scene.js`、`layers/`、`moonlit-composite-hq-60.mp4`、`moonlit-loop-hq-60.webm`、`qa/encoding-plan.json` |
| 时钟 | `tmp/clock-moonlit-fan/`、`tmp/clock-moon-palettes/qa/` | `prepare-assets.py`、`final-backgrounds.png`、`light-dark-comparison.png`、`observations.json` |
| 弹幕 | `tmp/danmaku-moonlit/` | `generation-calls.txt`、`prepare-assets.py`、`prepare-v2.py`、`revision-v6/`；`scroll-details-preview.html` 为提案 |
| 礼物许愿 | `tmp/gift-wish-moonlit/` | `ring-v4-prompt.txt`、`ring-v4-source.png`、`prepare-art-v4.py`、`build-preview.cjs`、`月渡花汀-礼物心愿动态预览.html` |
| 早期全屏感谢 | `tmp/moonlit-thanks/` | `source/prompts.json`、`assets/`、`thanks-art.js`、`BRIEF.md`；旧外框和玉饰为探索历史 |
| 最新全屏感谢 | `tmp/moonlit-thanks-refinement/` | 观看 `月渡花汀-完整感谢动画.html`；源码为 `source/generation-prompts.json`、`prepare-moon-art.py`、`moon-border.js`、`thanks-art.js`、`full-preview.html`（构建模板）、`build-full-preview.py`；说明为 `使用说明-月伞花汀.md` |

当前 2K 合成还需要 `moonlit-background-rebuild/source/` 的图集与叶片。最新感谢的构建器仍依赖 `moonlit-thanks/assets/` 和 `danmaku-moonlit/revision-v2-before/`；这些虽是旧目录，却是实际构建输入，已保留。礼物许愿 v4 也仍读取 `qa/revision-v2/banner-before.webp` 和 `qa/revision-v4/banner-before.webp.json`，不能只留 v4 文件名就删除前序材料。

## 正式源码与资源归属

月渡花汀套装清单以原素材路径作为 `resources` 的键，导入后组件从本机 `/component-media/` 地址加载对应文件。归档中的 `public/` 只是当日快照。2026-10-06 已从正式目录删除四个不再使用的旧背景文件（约 21.79 MiB），清单见[背景素材说明](../../../public/img/overlays/backgrounds/README.md#已淘汰资源)。指南预览和新版制作流程不依赖这些文件；归档中的新版原画、分层循环与成片继续保留，旧对话和源码快照仅作历史依据。

| 责任 | 当前入口 |
| --- | --- |
| 套装成员 | [package-moonlit-suite.js](../../../scripts/package-moonlit-suite.js) |
| 背景选择与播放 | [background.js](../../../public/js/overlays/background.js)、[background-moonlit.js](../../../public/js/overlays/background-moonlit.js) |
| 背景素材说明 | [backgrounds/README.md](../../../public/img/overlays/backgrounds/README.md) |
| 开播绘制与生命周期 | [opening-moon-fan-art.js](../../../public/js/overlays/opening-moon-fan-art.js)、[opening-moon-fan.js](../../../public/js/overlays/opening-moon-fan.js) |
| 开播原画说明 | [opening-moon-fan/README.md](../../../public/img/overlays/opening-moon-fan/README.md) |
| 时钟运行与样式 | [clock.js](../../../public/js/overlays/clock.js)、[moonlit-fan.css](../../../public/css/overlays/clock/moonlit-fan.css) |
| 弹幕主题 | [danmaku-moonlit.js](../../../public/js/overlays/danmaku-moonlit.js)、[moonlit.css](../../../public/css/overlays/danmaku/moonlit.css)、[素材来源](../../../public/img/overlays/danmaku-moonlit/provenance.json) |
| 礼物许愿主题 | [gift-wish-moonlit.js](../../../public/js/shared/gift-wish-moonlit.js)、[gift-wish-moonlit.css](../../../public/css/shared/gift-wish-moonlit.css)、[原画元数据](../../../public/img/shared/gift-wish-moonlit.webp.json) |
| 当前正式礼物边框主题注册 | [frame-config.js](../../../src/bilibili/gift/frame-config.js)：当前仅 `woodland-bloom`，没有月伞感谢 |

服务器弹幕的历史同步位置是 `D:/Work/lira-server/public/overlay/moonlit/`。本次未复制服务器工程或验证线上发布，继续跨端修改前须先核对服务端说明与实际文件。

现有契约详见[直播画面实现参考](../../reference/frontend/overlays.md)与[组件与浏览器源使用指南](../component-sources.md)；各部件的历史修订与最终敲定过程见[实际调试复盘](iteration-history.md)。

## 历史实施记录

- [开播初版](../../../specs/plans/archive/2026-10-05-opening-moonlit-fan.md) 与 [背景密度/往复修订](../../../specs/plans/archive/2026-10-05-opening-moonlit-fan-revision.md)。
- [弹幕](../../../specs/plans/archive/2026-10-05-danmaku-moonlit.md)、[礼物许愿](../../../specs/plans/archive/2026-10-05-gift-wish-moonlit.md)、[时钟深浅配色](../../../specs/plans/archive/2026-10-05-clock-moon-palettes.md)。
- [套装入口](../../../specs/plans/archive/2026-10-05-component-suites.md)、[静态背景](../../../specs/plans/archive/2026-10-05-moonlit-background.md)、[早期背景动效](../../../specs/plans/archive/2026-10-05-moonlit-background-motion.md)。

这些计划保存当时的实施证据。背景动态方案之后继续重制，以 HQ 资源说明、对应对话和当前播放源码核对最终版本；不能只读最初计划就恢复旧实现。
