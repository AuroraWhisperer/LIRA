# 云端签到与抽签

状态：accepted（2026-09-18 用户要求按照设计开始实施）。运行完成情况见实施计划。

需求来源：[设计报告](../docs/reports/2026-09-18-cloud-checkin-fortune-design.md)。报告第 1–9、11 节作为本次行为和验收要求；本规格明确其实现参数，不宣称线上已经部署。

- Server 独占签到和抽签受理、北京时间判日、累计、签文快照与发送；Live 只控制云端状态和一次性接管。精确命令在本地始终占用，不能落到 DIY。
- 每租户 streamer.db 增量建表；每日唯一键保证原子累计，业务提交先于回复。重启不重放回复，关闭保留历史。
- 独立开关 revision 和共享接管 revision；接管默认 pending，两项默认关闭。停写确认、来源归属确认与最终快照按序进行，不能自动代用户选择 no-legacy/fresh-start/imported。
- 固定 DeviceBearer 接口、main 内 token、受限 IPC、账号代际隔离；失败保留最后确认值，关闭失败明确提示，旧服务器不回退本地。
- 每机器人每租户 4 个待完成任务，同 UID/日期成功入队后 30 秒冷却，接收起 60 秒有效，最多 4 段、每段完整 @ 昵称计入 40 UTF-16 单位。词库预检用 10 字昵称及最长累计；运行时再按完整昵称校验。
- 一次导入最多 50,000 人、16 MiB canonical JSON；250 人/批、最多 200 批、256 KiB/批；每租户一个活动导入，24 小时后按访问惰性过期。回执永久保留，暂存仅当前编号可清除。词库各最多 1,000 条；一次性修正或选择内置词库需重新生成导入编号。
- Snapshot 包含 schemaVersion/sourceId/cutoffAt/libraryChoice/checkins/blessings/fortunes。canonical JSON 递归按键名字典序排列对象字段、保留数组顺序；checkins 按 UID 十进制字符串的字典序排列。SHA-256 由服务端复算，不构造旧抽签历史。
- 开发环境不安排备份/恢复演练；原库原位保留。自动化只用临时租户和合成身份，真实停旧端、导入、部署和全天测试须记录实际执行证据。

Server 契约：[daily-bots](../../lira-server/docs/protocol/daily-bots.md)。本地旧设置和旧库保留用于一次性核对，不参与云端通用同步。
