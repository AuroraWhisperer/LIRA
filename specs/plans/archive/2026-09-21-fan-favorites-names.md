# 档案特别关注与曾用名

状态：Complete（2026-09-21）。

## 目标与范围

特别关注优先排序并在姓名后显示黄色星标；取消后恢复大航海、灯牌、最近记录排序。卡片显示最新平台昵称，基本资料可编辑最近三个不同曾用名（由近到远，不含当前昵称）。保留人工常用称呼。

## 当前行为与所有权

`src/fans/profile-service.js` 拥有列表和资料保存；`profile-facts.js` 已按可靠身份与观察时间更新昵称、追加旧昵称到 `nameHistory`。`public/js/admin/fans/view.js`、`forms.js` 和档案 CSS 拥有展示和编辑。契约见 `specs/fan-profiles.md`。现有 history 为从旧到新的 `{ name, observedAt }` 数组。

## 兼容与实现

复用现有 history 格式，不改数据库、认证或同步协议。私有档案操作增加可选 `formerNames` 字符串数组输入与详情/列表投影；校验最多三个、每个最长 200 字，保存为现有 history 结构，人工补录观察时间为空。读取旧的长 history 时仅投影最近三个不同名字；后续更名时整理为三条。保留完整备份 v1 的导入导出和人工称呼；不触碰当前其他功能的未提交改动。

## 步骤与验证

- [x] 在档案领域实现特别关注排序、曾用名投影/编辑/更名更新；覆盖关注与取消、重复和回改昵称、旧观察拒绝、编辑后自动更新、重启与备份恢复。
- [x] 在现有卡片、基本资料与表单加入星标和曾用名；主名称优先显示平台昵称，常用称呼另行保留；覆盖转义和表单读取。
- [x] 更新规格，运行档案相关测试、JS 检查和边界检查，审查任务 diff、`git diff --check`、`git status --short`。

## 验证结果

- `node --experimental-vm-modules --test`，参数为 `test/fan-profiles-*.test.js` 和 `test/frontend-fan-profiles.test.js` 展开的文件：117/117 通过。
- `npm run check`：956 个 JS 文件通过；`npm run verify:architecture`：22/22 通过。
- `node --test test/governance-docs.test.js`：5/5 通过；最终改动后再运行 `test/modularity-size.test.js`：9/9 通过。
- impeccable 对三个 UI 修改文件静态检测结果为空。
- 未启动或操作用户 Electron 会话，未做实际窗口视觉核验；测试均使用临时隔离数据。

## 回退与完成条件

只反向修改本任务 diff，不操作用户数据，不提交或创建分支。上述行为测试通过、备份兼容、未引入运行数据即可完成。Electron 实际窗口如未检查，最终明确说明。
