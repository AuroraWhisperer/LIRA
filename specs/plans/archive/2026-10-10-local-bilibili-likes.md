# 客户端直播点赞总数与未使用字段调查

Status: Completed

## 目标与边界

按用户澄清，点赞指直播间当前累计点赞数，不是观众逐条点赞记录。仅在客户端现有 Bilibili 长连接收 LIKE_INFO_V3_UPDATE.data.click_count，提供本机读取接口；不修改 LIRA Server，不新增上游连接、轮询、数据库或展示组件。另以 JSON 字段路径及真实开源消费案例解释礼物之外的数据用途。

沿用 writing-plans 的按所有者分步验证；仓库 PLANS.md 覆盖 skill 的计划路径、提交与执行方式默认值，本任务直接实施。

## 所有者与合同

- MessageHandlers 保存一个 `{count, updatedAt}` 快照，非负安全整数按绝对值覆盖，包括 0 与下降值；CLICK 个体提示不参与累加，非法值忽略。初始化/连接代次/连接尝试/销毁及 LIVE、PREPARING 边界清为未知。
- BilibiliDanmakuClient.getLikeState() 提供 `{roomId,count,updatedAt,connected}`。未鉴权、断线或停止时 count/updatedAt 为 null，不把历史轮询当实时点赞来源。
- 本机 bilibili-runtime/API context 透传只读方法；GET /api/bilibili/likes/state 返回 `{ok:true,data:...}`。沿用管理 API 授权，不开放 overlay/匿名访问，不广播全量管理快照。
- 继续保留前轮及其他并行任务修改，不提交、部署或读取真实数据。

## 实施与验证

- [x] 用合成帧验证总数覆盖、0/下降值、CLICK 不混入、非法值拒绝、生命周期清理，再在现有消息 owner 实现。
- [x] 贯通本机 runtime、API context 与路由；隔离 HTTP 验证管理读取、匿名与 overlay 拒绝、未知态不发上游请求。
- [x] 同步 protocol/danmaku/API 事实源、测试地图与简报；没有新增操作入口，监听前提写入技术参考，用户指南、截图与引导不受影响。
- [x] 定向测试、语法/文档/架构检查与范围审查。所有测试使用合成消息及隔离 HTTP，不使用真实用户数据。

## 调查分工与验收

主代理实现点赞；两个既有子代理分别只读核对本地丢弃字段及公开项目实际消费。报告区分“已收到但未用”“需要额外请求”和“仅库定义、没有实际功能案例”。不将协议资料里的描述当成真实完整推送保证。

完成条件：本机接口可以读当前可信快照且不会跨房/连接串值，所有直接回归通过；新报告给具体字段与可验证用途。若失败，先修拥有层并只复验受影响路径，不改无关代码或放宽测试。

## 验收与保留原因

2026-10-10 完成。首次定向测试复现 5 项缺失接口失败；实现后 likes/runtime/SC/礼物身份共 28 项通过，独立 HTTP 授权/接线 3 项通过。`npm run check`、`npm run verify:architecture`（27 项）、`npm run verify:docs`（10 项）通过。

保留本记录用于说明“平台房间累计快照而非个人记录”的裁决、本机只读合同和生命周期清空规则。没有连接真实直播做覆盖验收，不能保证平台推送频率或场次归零时点；协议与接口分别见当前技术参考。本轮不改 LIRA Server、不新增用户操作、存储或依赖。

字段调查已重写为[精简用途报告](../../../docs/reports/2026-10-10-bilibili-information-opportunities.md)，以现有响应投影及实际开源消费代码为依据，区分用途建议、现成功能和仍需额外请求的资料。
