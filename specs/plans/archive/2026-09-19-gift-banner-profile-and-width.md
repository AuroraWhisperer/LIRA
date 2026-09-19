# 礼物头像、身份与词条长度修正

**目标：**可靠的送礼时头像和大航海等级进入共用横幅，横幅基础宽度由 504px 缩至 428px（约 15%），滚动、预览和 PNG 一致。

## 证据与归属

- 运行中的本日接口有 6 条记录，avatarUrl / guardLevel 全部为空；客户端已有头像代理和身份框渲染。
- lira-server 的 V2 解析只读取 JSON envelope 的展示资料，未读取 protobuf 根字段 3（face）、5（guard_level）。字段布局已与 blivedm 的 SendGiftBroadcast 定义核对。
- 服务器解析归属 gift-v2-parser.js / gift-parser-utils.js；已有 gift.display DTO、租户存储、可选协商和客户端投影继续承担传递。
- 宽度归属共享 gift-banner CSS/JS；Electron gift-export-controller 校验 PNG 最小宽度。

## 边界

遵照本次用户要求，服务器规范从“无 JSON 资料的 protobuf 保持未知”细化为“读取已核验的 protobuf 发送者字段；缺失或非法仍未知”。保留 JSON 有效证据优先、明确等级 0、不按礼物名/昵称推测身份。Device DTO、鉴权、租户边界、存储格式、金额及去重规则不变。不修改真实历史、不发布或部署；已有缺资料的记录不能由客户端凭空补齐。保留工作区既有改动。

## 实施与验证

- [x] 为服务器添加合成 V2 多产物资料回归，先确认当前解析失败；修复并更新 requirement / acceptance / upstream 规范。
- [x] 同步客户端基础宽度及 PNG 最小宽度，更新直接相关尺寸断言；增加有头像与舰长身份的渲染回归。
- [x] 运行服务器解析/展示资料/协议治理及客户端分色/投影/渲染/导出测试；运行已有 Electron 导出检查并检查生成图片。
- [x] 检查两个仓库的任务 diff、git diff --check、git status；记录验证结果及运行版本限制。

## 失败处理与完成条件

只调整本任务负责的行；检查失败时停在对应层修复，不重置工作区。合成资料经解析、投影和渲染后保留头像/等级，缺失资料继续安全回退；普通横幅为 428px、双倍 PNG 为至少 856px，大数量仍自动延长。验证充分后归档本计划。

## 验证结果

- 客户端：`node --experimental-vm-modules --test test/gift-banner-feed.test.js test/frontend-gift-display-settings.test.js test/gift-export-controller.test.js test/gift-display-profile.test.js`，20 项通过。
- 服务器：`node --require ./test/support/test-mode.cjs --test test/gift-display-profile.test.js test/bilibili-gift-parser.test.js test/room-monitor-gift-batches.test.js test/gift-history-contract.test.js test/documentation-governance.test.js test/device-protocol-contract.test.js test/architecture-governance.test.js`，63 项通过。
- 已有 Electron `scripts/verify-gift-export.cjs` 通过：头像代理加载及 PNG 像素、舰长框加载、透明合图、白底逐条、40 条拆图。人工检查生成的合成数据 PNG，身份框完整、文字和数量不重叠。
- Impeccable detector 仅指出已有 Arial 数量字体；按本任务保留现有视觉风格，不做无关字体变更。
- 两个仓库 `git diff --check` 通过；既有及并发工作区改动保留。
- 仅完成源码修改；运行中的已安装客户端和远端服务器尚未更新。未知历史缺少可靠资料，未修改真实账本或实施回填。
