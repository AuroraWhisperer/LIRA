# 简笔画弹幕

状态：Completed（2026-10-07）

## 目标与边界

按用户截图新增 `sketch`（绿萌简笔画）固定弹幕：两种细线气泡、星芒、兔猫与藤叶装饰，礼物显示真实名称、数量及两位小数金额。沿用字体、字号、滚动方向、背景不透明度；既有 `textColor` 在此样式中作为主题色，派生浅色描边与底色。透明直播背景，不复制宣传图背景与水印。

## 所有权与兼容

现有 renderer/feed 分别拥有内容和滚动；独立 sketch 装饰模块与 CSS 仅负责新主题。桌面与 lira-server 两端保持主题一致；在样式枚举、可选布局区域及三份 OpenAPI 中增量注册。旧布局补齐新区域，其他配置和行为不变。SC 保留完整原文并使用同主题。无依赖、认证、存储键、发布或真实用户数据变更。既有未提交工作保留，任务前快照位于 `tmp/sketch/before/`。

## 实施与验证

- [x] 主题、装饰和实际内容接入；注册两端选项、画布和缩略图。
- [x] 聚焦验证布局兼容、主题色保存/恢复、真实金额、纯文本安全和 SC。
- [x] 使用隔离浏览器验证默认/自定义颜色、长文字/表情、上下滚动；截图保留在 tmp。
- [x] 更新对应规范；复核任务差异、两仓 diff check 和状态。

完成条件：上述检查通过，或明确尚未验证的限制；不将源码完成说成已部署。失败仅修正本次增量，不重置已有改动。

## 验证与交付

桌面相关 38 项 Node 检查在聚焦运行及修正样式名单预期后通过：`danmaku-sketch`、`danmaku-style-options`、`danmaku-layout`、`danmaku-style-ownership`、`frontend-admin-danmaku`、`danmaku-local-preview`、`danmaku-superchat-renderer`。新样式纳入完整本地预览样本遍历。服务端 `overlay-sketch`、`overlay-settings-service`、`overlay-layout` 通过，保存测试确认新颜色及透明度持久化且不向其他租户广播。

服务端独立端口 3298 执行完整 `e2e/overlay-sketch.spec.js` 通过，覆盖默认/修改/恢复颜色、零背景、长昵称、换行、表情、SC、上下滚动、无重复节点及无页面异常。桌面组件在独立静态端口 3297 使用合成数据复核，两端 CSS/装饰模块一致。默认和换色截图为 `tmp/sketch/default.png`、`pink.png`，缩略图来自默认实际渲染。视觉审查结论 ship；文档一致性审查通过，设计检测为空。

服务端 `npm run docs:check` 46/47 通过；唯一失败是同一工作区并行变更新增 `styleParameters` 后，管理配置完整字段断言尚未更新，与 sketch 样式无关。保留该变更，不代为修改。未部署服务器、未启动或重启用户 Electron、未连接真实直播；线上使用需更新服务端源码。

## 身份规则与底纹补充（2026-10-07）

按用户确认的规则，普通观众固定使用第一种，大航海等级 1/2/3 固定使用第二种，取消内容种子选择；粉丝牌和主播标记不单独触发第二种。第二种色带补充层叠枝叶和浅色花瓣负形，随主题色和背景不透明度变化，保持文字在装饰上方。同步两端实现、规范、验收与桌面缩略图。

桌面 `test/danmaku/danmaku-sketch.test.js` 和服务端 `test/overlay-sketch.test.js` 各 2 项通过；完整 `e2e/overlay-sketch.spec.js` 通过，包含角色分配、底纹换色/透明度和长消息。隔离预览复核默认绿色与自定义粉色，截图为 `tmp/sketch/refined-default.png`、`tmp/sketch/refined-pink.png`。本次未重复运行与改动无关的全量检查。
