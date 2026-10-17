# AI 接龙与未完整送达回复恢复

**Status:** Completed

## Goal and evidence

让互动回答完成当前回合，关键答案优先；回复分段未完整送达后，按同一个问题和历史生成单条精简回复，避免多段重试继续丢失关键内容。

本机审计在同一问题后记录两次生成，错误日志有 `reply missing from room feed ... attempt=1/3`。持久会话只记录用户的“先入为主”和最终“先入为主，接‘主’～喵”，未把失败回答作为新输入。旧安装版现已退出，不能声称本轮已验证真实模型改进。

## Ownership and constraints

- 生成/重试 owner：`src/ai/ai-assistant-service.js`；提示与长度预算：`ai-assistant-helpers.js`、`prompt.js`；输出审核：`safety.js`。
- 复用现有送达校验、三次尝试上限、同观众串行、同一历史快照和回声过滤，不重写投递器，不新增成语库或游戏状态机。
- 首次最多三条的正常回答保持兼容；仅未完整送达后的重新生成收紧为一条，预算仍扣除 @ 昵称。
- 不改变用户人格、思考设置、接口、数据格式或登录状态，不修改真实会话数据。不启动或替换用户安装版。

## Implementation

- [x] 扩展 `test/ai/ai-assistant-delivery.test.js`，用现有 service fixture 和真实弹幕分段函数复现：首次多段未确认送达，重试必须一条，问题与历史不变，只记最终确认送达的文本；修复前先确认失败。
- [x] 共享回答规则明确轮到助手必须实际出词、不能复述后把回合推回观众；核心答案先写。输出审核检查最新有效词及助手本轮的新词，不能把正确新词压成重复输入。
- [x] `generateReply` 的重试选项增加内部 `singleMessage`，同步生成、工具后续和输出审核长度要求，最终截断使用同一单条预算。`deliverReply` 未确认送达后的重新生成传入该选项。
- [x] 缓存规则版本更新为 reply-v7，避免复用旧提示的缓存答案。
- [x] 更新 `docs/reference/backend/ai.md` 与 `public/pages/admin/toolbox/usage-guide-ai.html`；既有设置和入口不变，导览与截图无需修改。

## Verification and done when

- 聚焦：`node --test test/ai/ai-assistant-delivery.test.js test/ai/ai-assistant-generation.test.js test/ai/ai-assistant-session.test.js test/ai/ai-danmaku-delivery-verifier.test.js test/ai/ai-conversation-continuity.test.js test/ai/ai-assistant-service.test.js test/ai/ai-personas.test.js`。
- 覆盖重新生成、失败不记忆、同一问题、回声不触发、发送取消、三次上限；不以合成响应断言真实模型一定能接出所有成语。
- 使用说明：`node --experimental-vm-modules --test test/admin/frontend-usage-guide.test.js`；文档：`npm run verify:docs`；修改 JS 语法检查。
- 完成前检查任务 diff、`git diff --check`、`git status --short`。完成以合成回归与文档检查通过为界，实际模型和 B 站分段风控仍需新版实测。

## Rollback

仅撤回本任务 hunks，保留前序审核思考修复和其他并行修改。失败时沿用现有拒绝/错误处理与三次送达上限，不放行未审核内容。

## Results

- 新增回归修复前失败：重试仍分为 2 条，预期 1 条；修复后通过。
- AI 生成、投递、会话、回声过滤及人格相关 87 项通过；使用指南 16 项、文档门禁 10 项与 5 个修改 JS 文件的语法检查通过。
- 技术参考与使用说明同步；没有新增设置或界面入口，无需修改交互导览及截图。
- 未提交、打包或替换安装版。实际模型接词质量与 B 站送达效果未在本轮验证；合成回归证明单条重试、原问题与历史不变、仅保存确认送达答案，不证明模型总能接出正确成语。
