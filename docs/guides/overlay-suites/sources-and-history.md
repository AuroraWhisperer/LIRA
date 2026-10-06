# 月渡花汀：来源、路径与版本决策

核对日期：2026-10-06。工作区为 `D:/Work/Live`，关联服务器工作区为 `D:/Work/lira-server`。这是本次整理时的快照；后续制作应重新核对当前源码，不能把本表当成永远有效的部署状态。

## 参考视频与图片

主参考：[Bilibili · BV14BXWYSELi](https://www.bilibili.com/video/BV14BXWYSELi/)。历史对话称其为《飞花令·画堂春》。保留干净链接，去掉追踪参数。

| 参考范围 | 用途 | 来源依据 |
| --- | --- | --- |
| 视频 1:30–1:33 右侧 | 普通弹幕底框、笔墨染色、身份区分 | 用户在「设计月渡花汀弹幕姬」中指定 |
| 视频 2:13 之后 | 礼物卡片布局、顺滑滚动、卷轴及消息展示 | 用户在「改进礼物感谢弹幕样式」中指定 |
| 全屏送礼 / 上任段落 | 四周装饰、上方英文、下方感谢、层次和顺序 | 多个感谢对话与用户截图；未记录统一精确秒数 |
| 最初冰蓝古风截图 | 开播的画法、色彩和精细度 | `cbe32f7f-…/image-1.png` |
| 用户后续浅淡壁纸截图 | 静态与动态背景的颜色强度 | 静态壁纸对话中的浅色版本 |

本次未重新播放外站视频，上述时间点来自已读取的用户消息；同时查看了本地参考图与最终静帧。截图用于理解结构和节奏，原画来源记录表明本项目美术为另行生成和加工，没有把视频截图作为运行素材。

**30 张本地参考图全部找到并复制。** 完整原绝对路径、图片说明、关联对话和归档文件见 [参考截图索引](../../../archive/moonlit-suite/reference-index.md)；逐文件散列见 [归档清单](../../../archive/moonlit-suite/manifest.json)。其中既有外部样式参考，也有用户指出问题时截取的中间版本，不能全部当作目标图。

## 对话索引

读取了下列 11 个对话的全部可返回页；摘录保留可见用户消息、最终回复、被查看的附件路径和图像生成请求。分叉对话可能重复早期内容，一些中途指令只体现在后续成片或最终回复中；摘录不是完整原始事件日志。

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

## 正式源码与资源的 owner

正式资源仍在原地址加载；归档中的 `public/` 只是当日快照。2026-10-06 已从正式目录删除四个不再使用的旧背景文件（约 21.79 MiB），清单见[背景素材说明](../../../public/img/overlays/backgrounds/README.md#已淘汰资源)。指南预览和新版制作流程不依赖这些文件；归档中的新版原画、分层循环与成片继续保留，旧对话和源码快照仅作历史依据。

| 责任 | 当前入口 |
| --- | --- |
| 套装成员 | [component-preview-suites.js](../../../scripts/package-moonlit-suite.js) |
| 背景选择与播放 | [background.js](../../../public/js/overlays/background.js)、[background-moonlit.js](../../../public/js/overlays/background-moonlit.js) |
| 背景素材说明 | [backgrounds/README.md](../../../public/img/overlays/backgrounds/README.md) |
| 开播绘制与生命周期 | [opening-moon-fan-art.js](../../../public/js/overlays/opening-moon-fan-art.js)、[opening-moon-fan.js](../../../public/js/overlays/opening-moon-fan.js) |
| 开播原画说明 | [opening-moon-fan/README.md](../../../public/img/overlays/opening-moon-fan/README.md) |
| 时钟运行与样式 | [clock.js](../../../public/js/overlays/clock.js)、[moonlit-fan.css](../../../public/css/overlays/clock/moonlit-fan.css) |
| 弹幕主题 | [danmaku-moonlit.js](../../../public/js/overlays/danmaku-moonlit.js)、[moonlit.css](../../../public/css/overlays/danmaku/moonlit.css)、[素材来源](../../../public/img/overlays/danmaku-moonlit/provenance.json) |
| 礼物许愿主题 | [gift-wish-moonlit.js](../../../public/js/shared/gift-wish-moonlit.js)、[gift-wish-moonlit.css](../../../public/css/shared/gift-wish-moonlit.css)、[原画 sidecar](../../../public/img/shared/gift-wish-moonlit.webp.json) |
| 当前正式礼物边框主题注册 | [frame-config.js](../../../src/bilibili/gift/frame-config.js)：当前仅 `woodland-bloom`，没有月伞感谢 |

服务器弹幕的历史同步位置是 `D:/Work/lira-server/public/overlay/moonlit/`。本次没有复制服务器工程或验证线上发布，继续跨端修改前须读取那边的说明和实际文件。

现有契约详见 [Overlay 实现参考](../../reference/frontend/overlays.md) 与 [组件/浏览器源使用指南](../component-sources.md)。本指南负责美术制作和材料导航，不复制完整业务接口定义。

## 哪些意见已经变成最终方向

下表用于快速判断哪个版本仍适用。每轮为何修改、哪些话来自用户、哪些只是实现结果，见 [实际调试复盘](iteration-history.md)。各部件在不同对话中迭代，不能把本表当成一份从开始就确定的需求清单。

| 过程中的版本或意见 | 最后采用 / 当前状态 |
| --- | --- |
| 开播最初“6 秒入场 + 24 秒待机” | 被约 15 秒完整往复替代 |
| 原画更繁密、挂饰更多 | 用户要求收回到中等密度，保留亭台/月亮/倒影、减少挂饰 |
| 壁纸直接用浓色原画 | 改为浅银蓝低对比，保留结构细节 |
| 背景轻微漂移、旧图局部扭曲 | 被新原画分层重制替代，最终 2K / 60fps |
| 动态背景 1080p 版本 | 旧合成成片已从正式目录删除；分层制作材料保留在归档，当前产品地址指向 HQ 1440p WebM |
| 礼物许愿零散小花冠 | 最终 v4：贴圆白山茶、墨蓝枝叶、如意纹、折扇起点 |
| 时钟只有浅底深字 | 增加深底浅字与自动交替 |
| 弹幕灰底取消 | 后续明确保留更深的小身份底框 |
| 礼物纸面一度改为向右展开 | 用户随后纠正为向左；装饰等纸面完成后向右 |
| 消息礼物双横带 / 无卷轴的探索 | 后续弹幕 v6 回到分离纸面与滚轴的方案；不要覆盖当前版本 |
| 卷轴中加入淡山水暗纹和微光 | 有独立预览，尚未作为正式样式接入 |
| 全屏感谢第一层玉饰 | 用户明确放弃；旧原画只保留溯源 |
| 全屏感谢侧架、绢带和底部铭牌 | 最新月伞花汀换成纸伞和连续水岸，中央透明 |
| 全屏称谓“新总督上任” | 去掉“新”，称谓文楷、字号错落 |
| 全屏称谓加身份色 | 最后对话仅建议“月白主体 + 少量身份色”；**未确认实施**，不能当作既成事实 |

## 历史实施记录

- [开播初版](../../../specs/plans/archive/2026-10-05-opening-moonlit-fan.md) 与 [背景密度/往复修订](../../../specs/plans/archive/2026-10-05-opening-moonlit-fan-revision.md)。
- [弹幕](../../../specs/plans/archive/2026-10-05-danmaku-moonlit.md)、[礼物许愿](../../../specs/plans/archive/2026-10-05-gift-wish-moonlit.md)、[时钟深浅配色](../../../specs/plans/archive/2026-10-05-clock-moon-palettes.md)。
- [套装入口](../../../specs/plans/archive/2026-10-05-component-suites.md)、[静态背景](../../../specs/plans/archive/2026-10-05-moonlit-background.md)、[早期背景动效](../../../specs/plans/archive/2026-10-05-moonlit-background-motion.md)。

这些计划保存当时的实施证据。背景动态方案之后继续重制，以 HQ 资源说明、对应对话和当前播放源码核对最终版本；不能只读最初计划就恢复旧实现。
