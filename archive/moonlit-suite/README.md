# 月渡花汀制作档案

2026-10-06 整理。这里保存本机可复用的原始参考、绘画素材、制作过程和已选成片。长期说明在 [套装指南](../../docs/guides/overlay-suites/README.md)，无需每次重新翻所有对话。

## 先打开什么

- `preview.html`：本地成片总入口，包含完整背景、开播、时钟、弹幕、礼物许愿和全屏感谢样片。用 Edge / Chrome 打开；页面不依赖服务、外部脚本或网络素材。
- [reference-index.md](reference-index.md)：30 张参考图逐张说明、原路径、所属对话与归档路径。
- [manifest.json](manifest.json)：每个复制文件的原绝对路径、归档相对路径、用途、字节数和 SHA-256。
- `conversations/thread-excerpts.json`：11 个对话的精选可见内容及图像生成请求；没有保存推理、完整工具轨迹、浏览器配置或账号数据。

相对 `files/` 的布局与原项目一致。例如：

```text
原文件：D:/Work/Live/tmp/opening-moon-fan/source/landscape-v2.png
归档：  D:/Work/Live/archive/moonlit-suite/files/tmp/opening-moon-fan/source/landscape-v2.png
```

归档当时采用复制，未移动、删除或修改原来的 `tmp/`、聊天附件与 `public/` 引用。之后正式目录的资源清理见[来源与版本决策](../../docs/guides/overlay-suites/sources-and-history.md#正式源码与资源的-owner)；归档文件与散列仍保持采集时的快照。

## 当前成品选用规则

| 部件 | 归档中优先打开的文件（相对本目录） |
| --- | --- |
| 开播最终往复 | `files/tmp/opening-moon-fan/月渡花汀-动画预览.html`、`月渡花汀-v2-完整往复动画.webm`（同目录） |
| 动态背景最终 2K | `files/tmp/moonlit-background-hq/moonlit-composite-hq-60.mp4`、`moonlit-loop-hq-60.webm`（同目录） |
| 静态背景 | `files/public/img/overlays/backgrounds/moonlit.webp` |
| 时钟 | `files/tmp/clock-moon-palettes/qa/light-dark-comparison.png` |
| 弹幕最新正式规则 | `files/tmp/danmaku-moonlit/revision-v6/moonlit-motion-2x-60fps.webm` |
| 礼物许愿 v4 | `files/tmp/gift-wish-moonlit/月渡花汀-礼物心愿动态预览.html` |
| 全屏感谢最新样片 | `files/tmp/moonlit-thanks-refinement/月渡花汀-完整感谢动画.html` |
| 全屏感谢观看视频 | `files/tmp/moonlit-thanks-refinement/月渡花汀-月伞花汀-完整动画.mp4` |

全屏感谢仍未接真实事件；观看 MP4 带深色底，透明输出看 HTML 和同目录透明 PNG。当前月伞版没有最终透明 WebM，不要把 `moonlit-thanks` 旧版透明视频当作新成片。`references/gift-scroll-details.html` 和弹幕 `scroll-details-preview.html` 是暗纹设计提案。

## 保存了什么，哪些没有复制

保存原始图和提示词、透明素材/字体许可、图像处理脚本、关键动作源码、生产主题快照、最新独立 HTML、完整成片、六层背景循环及关键检查记录。另保存少量被放弃的探索原画，用于理解修订原因。

未复制整个仓库、服务器工程、`node_modules`、浏览器配置、用户运行数据、日志、逐帧导出堆、重复的旧大视频和全部测试备份。该包是**精选设计档案，不是完整应用备份或开箱即用的构建环境**。

`manifest.json` 的 `historical-QA-evidence-not-rerun-today` 明确表示历史检查；复制和散列一致只能证明文件完整，不能替代重新运行功能检查。

## Git、安装包和备份

本目录 `.gitignore` 排除 `files/`、`references/`、`conversations/`、本地预览和验证结果。指南、README、参考索引、清单可随项目管理，但本次没有执行 Git 提交。

原始素材与视频约 383 MiB，只保存在本机。**要备份成品，复制整个 `archive/moonlit-suite/`，不能只推送 Git。** 如果从 Git 获取项目而没有另外取得素材包，预览和原图缺失是预期情况，需从本机备份恢复。

现有安装包通过 `package.json` 的文件白名单收集应用代码与资源，该目录不在白名单中，不需要改构建配置。

## 为什么有约 383 MiB

这是为了继续编辑而保存的材料总量。单个 2K 背景 MP4 为 **42.25 MiB**，配套产品 WebM 为 **40.14 MiB**，两份合计约 82.39 MiB。

| 文件类型 | 体积（约） | 用途 |
| --- | --- | --- |
| 视频（WebM + MP4） | 196.17 MiB | 背景成片、开播、感谢、六层循环和弹幕预览 |
| PNG | 96.05 MiB | 生成原画、用户参考图、透明成品和精选检查截图 |
| 原始 TTF 字体 | 48.79 MiB | 保留文楷、宋体等源字体，便于以后重新做文字子集 |
| 独立 HTML | 24.51 MiB | 内嵌原画与字体，可离线播放的交付文件 |
| WebP、WOFF2、总览 JPG、代码与记录 | 17.12 MiB | 加工图、字体子集、导航及制作材料 |

体积按 `manifest.json` 所列 288 个复制文件计算，共约 382.64 MiB，不含少量说明和清单自身。归档里的背景 WebM、分层视频与字体源文件承担不同用途，不能只按扩展名视为重复成片。本次保留制作材料完整性，没有进一步删减或压缩。

## 恢复与继续制作

1. 只观看：打开本地 `preview.html`，独立 HTML 已内嵌相应素材。不要把旧的 `127.0.0.1:<临时端口>` 当成永久地址。
2. 修改前：从 [来源与版本索引](../../docs/guides/overlay-suites/sources-and-history.md) 选择正确基线，先看最新预览，再看过程脚本。`public/` 快照不是对当前代码的自动回滚指令。
3. 重用历史脚本：准备完整项目副本，把所需 `files/tmp/...` 按原相对结构放回副本的 `tmp/...`。核对脚本中的 `D:/Work/Live`、`parents[2]`、相邻目录与写入目标；不要在 `archive/.../files` 里直接执行。
4. 依赖按脚本实际 import 准备。常见图像加工使用 Python、Pillow、NumPy、SciPy；字体子集步骤涉及 fontTools；预览构建有 Node/Python。视频编码当时使用 FFmpeg 和浏览器 Canvas，临时 REPL 环境与编码工具本体未打包。
5. 在副本里执行处理后检查输出与原成片。新一轮过程文件放新的 `tmp/<主题>-<部件>-<版本>/`，确认后建立新的归档快照并更新指南入口。

尤其不要漏掉这些跨目录输入：

| 脚本 | 仍需要的材料 |
| --- | --- |
| `moonlit-background-hq/prepare-assets.py` | 相邻 `moonlit-background-rebuild/source/` 三张原画 |
| `moonlit-thanks-refinement/build-full-preview.py` | `moonlit-thanks/assets/`、`danmaku-moonlit/revision-v2-before/`、完整项目的 `public/` renderer/CSS/素材 |
| `gift-wish-moonlit/prepare-art-v4.py` | `qa/revision-v2/banner-before.webp`、`qa/revision-v4/banner-before.webp.json` |
| 开播与时钟加工/预览脚本 | 原位置的主题素材、项目 `public/` 及脚本引用的根目录 |

这些旧目录中的必要输入已精选复制，但运行依赖与完整项目仍须另外提供。图像生成是非确定性的；提示词可以复用，逐像素复现应使用归档原图及加工代码。

## 本次整理的验证范围

核对参考文件存在、逐文件复制散列、指南路径与文档导航、最终版本对应关系。没有重新运行动画制作脚本、重新编码视频、启动真实直播连接或部署服务。具体文件数和大小以 `manifest.json` 为准；本地完整性检查见 `verification.json`。
