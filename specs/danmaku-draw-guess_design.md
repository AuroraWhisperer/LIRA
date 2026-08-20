# Feature: Bilibili 弹幕你画我猜

## Goal

在百宝箱小游戏的第四张卡片加入“你画我猜”。主播通过固定 `/games` 网页实时作画，直播间观众直接发送答案弹幕；系统按答对顺序累计积分，五局后在同一直播画面展示最终排行。

## Context

现有数字炸弹和五子棋共享一个服务端游戏会话与固定 `/games` 地址，转盘独立运行。线上调研显示 Bilibili 直播中的画猜通常由主播展示绘画过程、观众用弹幕抢答，软件负责识别正确答案和累计排名。本功能沿用这一直播互动模型，不引入第三方画板或第二个网页地址。

## Constraints

- 保持 Node.js 24+、CommonJS 后端、Vanilla JavaScript ES modules、原生 CSS 和无构建前端。
- 保持 `/games` 为数字炸弹、五子棋、你画我猜共用的唯一游戏网页。
- 你画我猜与数字炸弹、五子棋使用同一个单会话互斥；转盘继续独立。
- 一场固定五局，每局 90 秒；第 1、2、3 位答对者分别获得 10、7、5 分，之后每位答对者获得 3 分。
- 同一观众每局只能得分一次；五局结束后按总分、首猜次数、最后得分时间排序。
- 不新增数据库、设置键、进程、端口、运行时依赖或页面入口。

## Non-goals

- 不允许观众作画或多人轮换画手。
- 不提供自定义词库、持久化历史战绩、礼物加分、模糊语义识别或 AI 判题。
- 作画阶段不把答案显示在 `/games` 直播画面中；本局结束后正常揭晓。
- 不改变数字炸弹、五子棋或独立转盘的规则。

## Architecture

- Backend owner: `src/games/draw-guess.js` 负责词库、答案规范化、回合、计分、公开状态和绘画输入限制；`src/games/game-session-service.js` 负责单会话互斥、服务端倒计时、弹幕接入和广播。
- HTTP contract: `GET /api/games/host-state` 返回主持人私有题词；`POST /api/games/session/draw` 接收受限的增量绘画操作；现有 `POST /api/games/session/move` 接收结束本局和开始下一题操作。
- WebSocket contract: `game:update` 继续广播公开会话；新增 `game:draw` 只广播已经校验的增量画笔操作。
- Frontend owner: `public/js/admin/games.js` 管理第四张卡片、私有题词和回合控制；`public/js/overlays/games.js` 在 `/games` 上提供主播画布并同步给其它浏览器源实例。
- Timer authority: 服务端维护单个回合截止计时器；客户端只根据 `remainingMs` 和 `serverNowMs` 插值显示。

## Security

- 题词和别名不得进入公开会话、`game:update`、`game:draw`、日志或错误消息；仅 `GET /api/games/host-state` 在现有 session-token 管线后返回。
- 弹幕只在活动作画阶段按规范化后的完整答案匹配；UID 为空、重复答对或非活动回合均不计分。
- 绘画接口仅接受白名单颜色、固定笔宽、有限长度 ID、归一化坐标、有限单批点数、有限笔画数和有限整局点数。
- 前端使用 DOM API 和 `textContent` 渲染昵称、答案和排行，不插入不可信 HTML。
- 所有状态变更继续受现有 Host、Origin 和 Bearer token 校验保护。

## Compatibility

- 保留现有 `/api/games/session`、`/api/games/session/move`、`game:update` 和 `/games?game=` 兼容行为。
- 数字炸弹与五子棋的公开状态形状、弹幕解析、胜者头像和操作方式不变。
- `/wheel` 与 `wheel:update` 不参与新互斥关系。
- 游戏会话仍为内存态，服务重启后清空。

## Acceptance Criteria

1. 小游戏列表第四张卡片为可向下展开的“你画我猜”，清楚展示五局、90 秒和 10/7/5/3 计分规则。
2. 开始你画我猜时若游戏 1 或 2 正在运行，服务端返回 409 且不覆盖旧会话；反向开始游戏 1 或 2 也同样被拒绝。
3. 主播在 `/games` 画板产生的笔画实时出现在另一 `/games` 实例，刷新后可从公开会话恢复完整画布。
4. 作画阶段公开状态只包含类别、字数、回合、倒计时、答对名单、积分榜和画布，不包含答案或别名。
5. 管理页私有主持区显示当前题词，并可结束本局、开始下一题和结束整场。
6. 观众弹幕完整命中答案后按 10/7/5/3 得分，同一 UID 每局只得分一次；非命中、无 UID 和非作画阶段不计分。
7. 每局 90 秒由服务端自动结束并揭晓答案；第五局结束后公开状态展示最终排行。
8. 清空画布和增量笔画均经过服务端验证与上限保护，非法请求返回稳定的 400 错误。
9. 桌面端小游戏面板和 `/games` 页面在正常窗口尺寸下可操作，键盘焦点和 reduced-motion 行为保持可用。

## Done When

规格索引和架构 owner 文档已更新；聚焦游戏测试、`npm run check`、`npm run verify:quick` 和完整 `npm test` 通过；Electron 桌面端完成第四张卡片、私有题词、画板与同步验证；最终 diff 只包含任务文件和被保留的用户并行修改。
