# 大航海到期账号与总览提醒实施计划

Status: Awaiting Verification

**Goal:** 客户端按现有登录栏样式选择复用直播账号或单独登录可选的主播账号，服务器使用房主身份查询大航海到期名单，在主播中心总览显示结果。

**Architecture:** 复用既有 DeviceBearer、租户存储、B 站账号验证和受控 Electron 登录窗口。独立主播登录使用临时隔离的 Chromium session，只把凭据上传至当前租户的专用加密记录；不进入原直播登录分区、机器人或监控。服务端验证登录 UID、房主 UID 与上游返回的 anchor_info.ruid，按来源代次缓存完整名单。

**Tech Stack:** 现有 Electron / CommonJS / 原生 ESM / SQLite / Express；不增加依赖。

## 范围与约束

- 总览指服务端 `public/streamer/manage.html` 的首页总览，用户已确认。
- 默认 `source=shared`；现有下拉组件提供“使用上方登录账号”与“单独登录主播账号（可选）”。保留上方两栏原样，新增栏复用其样式；用途与切换说明放入问号，保留“可选”明文，不替换原直播账号。
- 独立登录为可选；缺少登录、非房主、上游不可用均显示状态，不能显示成零人。
- 不自动发私信、弹幕，不推断精确到期秒数，不抓取七日范围之外的数据。
- Cookie 只在 Electron main 和服务端处理；服务器拒绝客户端指定租户。临时文件均在对应仓库 `tmp/`。
- 保留两个仓库既有未提交修改；不提交、不推送、不部署。

## 当前实现与 owner

客户端 `main.js` 的登录回调通过 `cloud-sync-controller.js` 上传原直播账号；`bilibili-login-window.js` 已具备受限窗口、取消与 Cookie 监听清理。`settings-auth.js` 和 `song/settings.html` 拥有截图中的现有登录行。

服务端 `credential-service.js` 校验原账号并加密保存。`api.js` 拥有 B 站请求；`streamer-storage.js` 拥有租户初始化；`overview.js` 只读首页统计和手动舰队快照。现有普通名单没有到期数据。

## 接口决定

```text
GET /api/device/guard-expiry/account -> { source, loggedIn, uid, displayName, revision }
PUT /api/device/guard-expiry/account { source, cookie? } -> 同上
DELETE /api/device/guard-expiry/account -> 清除独立账号，保持 separate 来源
GET /api/streamer/guard-expiry -> { state, source, account, observedAt, expiring, expired }
```

`source` 为 `shared | separate`；带 Cookie 的 PUT 只接受 separate 并在线核验其为已配置直播间房主。切回 shared 清除独立云端凭据。GET 总览只返回安全投影，至多缓存成功结果五分钟，同来源合并并发。到期列表成员投影为 `{ uid, displayName, guardLevel, days }`；不把 Cookie、原始响应或内部来源指纹返回网页。

## 实施与验证

- [x] 服务端：新增 `guard-expiry-store.js`、`guard-expiry-service.js` 和上游字段标准化；扩展既有 B 站 adapter、Device routes 与 Streamer routes。以合成 Cookie / 上游 stub 验证两个租户、两个账号、UID 不匹配、分页、退出/换房/切来源竞态、旧库升级与密文隔离。
- [x] 客户端：新增 `guard-expiry-auth.js` 与窄 IPC / remote 方法，复用受控登录窗口；测试非持久独立分区、原直播登录不变、授权变化/退出/取消期间不提交旧 Cookie、错误脱敏、旧服务端不支持的反馈。
- [x] UI：在原登录栏下添加同样的 fieldset、来源选择、可选登录及问号说明。服务端总览显示七日内即将到期与七日内已过期名单。继承已有控件与样式，不增加重复信息区。覆盖加载、空列表、失败、账号不匹配、来源切换与长昵称。按用户补充，将原账号用途移入上方问号并精简文案。
- [x] 契约：服务端 requirement/acceptance、OpenAPI、错误码、路由 inventory 与上游协议同步；客户端 auth/preload/API/reference 与应用内使用说明同步。旧自动化仍准确的部分直接沿用。
- [x] 核验：Server 使用 `tmp/runtime/node-v24.15.0/node.exe scripts/verify.cjs`，同范围先 `--plan`，跑新增服务测试和受影响凭据/总览测试，再跑 `npm run docs:check` 对应受支持 Node；Live 运行新增测试、现有 settings/auth/IPC 边界及文档检查。测试期间不编辑参与输入。
- [x] Electron 与浏览器：使用既有隔离测试启动方式，检查完整登录选择和安全 IPC；总览使用隔离租户及合成上游检查布局。截图存 tmp，已清理自己启动的进程和独立桌面测试数据。
- [x] 收尾：审阅两仓本次增量，`git diff --check` 通过；界面独立复核结论为 `ship`，未发现需要修复的界面问题。
- [ ] 真实 B 站主播账号登录及上游名单核对：尚未执行，不计入自动化或截图验收。

## 实际验证记录（2026-10-12）

- Server：新增领域/API、凭据授权与生命周期、总览 API 共 38 项 Node 检查通过；`e2e/streamer-overview.spec.js` 完整文件 21 项通过，覆盖 1440/1100/760/390/320px。首次浏览器启动使用了非支持的系统 Node，改用 Node 24.15.0 并将其目录置于 PATH 后通过。文档与契约检查 54 项通过。
- Live：新增 auth/IPC 与原登录窗口 20 项通过；扩大回归的 132 项中 131 项首轮通过，退出测试夹具缺少新增依赖，补齐后退出与桌面流程 39 项通过。用户最后文案调整后，设置资料、隔离 Electron 与使用指南 20 项通过。文档检查 10 项通过。
- 真实 Electron 截图使用生产 markup、preload、IPC 和隔离登录控制器，合成登录原点与 Cookie；服务器浏览器截图使用合成认证数据。服务端截图位于 `tmp/guard-expiry-qa/`，客户端最终六张截图位于 `tmp/guard-expiry-style-qa/`，已保留 `.app-shell` 样式上下文和实际下拉组件；旧客户端截图不作为最终样式依据。此证据不包含真实 B 站账号或正式安装包。
- 静态界面扫描仅提示隐藏的动态头像无初始 src；实际界面无破图。独立审查核对最终截图、已有控件及新增源码，结论 `ship`，保留既有设计系统。用户明确保留上方两栏样式后，新增栏统一状态、昵称/UID 和按钮样式，六张客户端截图重新独立复核为 `ship`；相关 Electron/设置检查 4 项通过，文档检查 10 项通过。
- 仍待真实主播上游验收，因此计划保持 `Awaiting Verification`。本次未提交、推送、打包或部署。

## 失败处理与完成条件

服务端登录/查询失败不覆盖原直播凭据，不启动另一 monitor；已失效来源的查询不写缓存、不交付名单。独立窗口取消/退出/关应用清空其临时 session。回退只撤销本任务增量，保留用户与其他任务修改。

上述 UI、跨端接口及隔离测试完成、规范一致、隔离运行检查完成后交付；真实上游、正式打包和生产发布不冒充已验收。
