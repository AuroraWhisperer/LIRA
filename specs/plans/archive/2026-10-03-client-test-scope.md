# Client Test Scope Implementation Plan

**Status:** Completed — 精确选择、环境分组、用例调整、聚焦测试、故障探针及差异复核已完成。

**Goal:** 让客户端局部变更只执行选定测试，清理歌单、盲盒和历史记录中重复或绑定内部写法的断言，保留数据、安全和失败恢复保护。

**Architecture:** 继续使用现有 Node test 执行器、依赖分组及 VM fixture。增加文件选择，不建设缓存/依赖推断系统，不改变产品实现。

**Tech Stack:** Node.js 24、node:test、node:assert/strict、现有 VM/Chromium 测试。

## Current Behavior

- 盘点发现 496 个测试文件，450 个归入 offline；其中 canvas-gift-components、component-workspace、scene-editor、scene-renderer 实际使用 Chromium，含经 helper 间接引用的情况。
- 执行器支持依赖组和领域目录，但没有文件选择；Node 名称过滤不会阻止无关文件加载。
- `verify` 先运行 quick 再运行全量，文档和三个架构测试重复执行。
- 盲盒 admin 混入普通礼物通知和整页装饰顺序，空 JSON 数组保存已有真实事件覆盖；排名只验证内部变量/源码。
- 历史记录危险操作的提示同时由源码和实际对话框检查；歌单滚动检查固定了内部缓冲参数及 ResizeObserver 的写法。
- 今天已有断言治理和多个未提交产品任务。本次保留其修改，以开始时快照区分增量。

## Ownership And Compatibility

- `scripts/run-tests.js`、`package.json` 拥有测试发现、选择、环境分组和验证编排；消费者包括 npm scripts 和开发者。
- `test/engineering/run-tests.test.js` 保护选集、不漏测、不重复、失败传播与进程隔离。
- `test/gifts/`、`test/songs/frontend-song-board.test.js` 和 `test/ui/frontend-toast-business.test.js` 拥有本次调整的行为覆盖。
- `docs/reference/engineering/test.md` 是测试策略事实源；构建表同步命令。
- 默认 `npm test` 仍为全量，完整验证仍包含全部现有独立检查。保留 Node VM flag、进程隔离、原生归属查询独立批次。
- 不改变 HTTP/WS/IPC、持久化、安全边界、页面/样式及发布操作，不提交或建分支。临时快照和日志保存在根 `tmp/test-scope-audit/`。

## Milestones And Verification

### 1. 精确选择与正确分组

- [x] 在执行器增加可重复 `--file=<test/...>`，支持 Node 24 `path.matchesGlob` 通配符；每个选择器必须匹配已发现文件，合并去重后与组/领域取交集；空值、拼写错误及空交集失败，不回退全量。
- [x] `--list` 只列出最终文件，执行时显示 full/partial 和选中文件数；帮助与策略说明名称过滤仅作用于已选择文件。
- [x] 将确认的四个 Chromium 消费者登记到 browser。保留全部用例。
- [x] 用现有合成仓库 fixture 覆盖重复/多文件选择、组交集、错误输入，以及未选文件顶层抛错也不被加载；沿用失败传播测试。fixture 放入根 tmp。
- [x] 运行 `node --experimental-vm-modules --test test/engineering/run-tests.test.js`，再用真实清单核对五组无重叠、无遗漏。

### 2. 用例按真实保护目标调整

- [x] 把普通礼物通知用例移到已有业务通知测试；去掉纯页面布局顺序用例，以及由 JSON 草稿保存用例承接的空数组源码测试。
- [x] 将盲盒排名内部变量/源码检查改成真实 render 输出，覆盖全部、仅汇总、限制人数、上限和默认值；保留配置控件边界。
- [x] 历史记录提示由已有确认流程验证；移除重复源码匹配并分别断言删除范围、不可撤销说明。实际列表输入加入私有身份哨兵，验证渲染和请求不泄露。
- [x] 歌单虚拟滚动继续验证有界 DOM、锚点、滚动和短列表；删除重复内部缓冲默认值、120ms 回调拼写及禁止替代布局写法。
- [x] 修改前后运行上述相关文件及盲盒 JSON 保存行为文件；不为纯装饰删除新增浏览器平台或截图矩阵。
- [x] 用临时副本/子进程验证一处等价源码改写仍通过、一处实际排名错误仍被行为测试发现。

### 3. 验证编排和收尾

- [x] `verify` 改为契约输入 → JS 语法 → 全量测试；全量已包含文档和架构用例，quick 仍独立保留。
- [x] 测试策略给出具体歌单、历史和盲盒选择命令，明确局部通过的边界及跨域消费者仍需按实际影响加入。
- [x] 更新构建命令表；执行文档检查及所改 JS 语法检查。
- [x] 最后检查相对任务基线的增量、`git diff --check` 与 `git status --short`。确认无运行数据或生成物进入 diff。

## Failure Handling

选择器无效或空范围立即失败。新测试失败先核对原始基线，不放宽实际行为预期。以 tmp 内任务开始时的逐文件快照定位并仅撤销本次增量，不覆盖其他任务修改。

## Done When

精确选择确实不加载无关文件，环境分组准确且全量覆盖不变；重复实现断言已由指定行为覆盖承接；聚焦测试、反例和文档检查通过，完成 diff 复核并记录实际结果。没有执行全量时不得宣称全量通过。

## Completion Evidence

- 最终清单仍为 496 个文件：offline 446、browser 25、desktop 8、installer 5、contracts 12；五组无重叠、无遗漏。已核对 offline 通过 helper 间接引用 Chromium 的情况。
- 文件选择示例：歌库筛选 1 个文件（songs 整组 25），历史记录 3 个文件、盲盒前端 5 个文件（gifts 整组 84）。这些是人工明确选择的范围，不是自动影响分析。
- 文档/架构四个门禁仍在全量收集清单；完整 verify 仅去除此前 quick 造成的重复执行。
- 歌单仍保留虚拟滚动构造和 ResizeObserver 重排接线检查；删除的是精确缓冲默认值和 120ms 写法，无等价运行证据的接线没有一概删除。
- 删除空 JSON 源码用例由 frontend-blindbox-mapping-refresh 的真实输入/保存失败流程承接；普通延迟礼物通知原样移至 frontend-toast-business。
- 未改动产品代码或运行数据，未执行客户端全量、浏览器全组或发布。

| 检查 | 实际结果 | 证据（根 tmp/test-scope-audit） |
| --- | --- | --- |
| 修改前聚焦基线 | 55/55 通过 | baseline.log |
| 执行器回归 | 新行为先失败，修改后 7/7 通过；未选文件顶层抛错也不被加载 | runner-red.log、runner-green.log |
| 调整用例及承接覆盖 | 七个文件 47/47 通过 | behavior.log |
| 最后补回必要滚动接线检查 | 歌单文件 8/8 通过，是前项的子集，不累计 | song-final.log |
| 等价实现探针 | 仅在子进程读取时重命名盲盒内部变量，10/10 通过 | probe-rename.log |
| 行为故障探针 | 仅在子进程读取时去掉排名人数限制，准确触发 1 项失败，其余 9 项通过 | probe-fault.log |
| JavaScript 语法 | 8 个修改文件检查通过；最后歌单改动已由上述执行验证 | 会话命令记录 |
| 文档 | 10/10 通过；归档后再复核 | docs.log、docs-final.log |
| 最终差异 | git diff --check 通过；任务外改动保留，scratch 被忽略，测试临时目录已清理 | diff-check.log、final-status.txt |

本次完成测试入口、全目录运行依赖盘点和歌单/盲盒/历史的指定用例调整，未逐条重审其余全部业务测试。测试数量与选择范围不等于产品覆盖率；保留安全、数据、撤销/重试和生命周期测试。
