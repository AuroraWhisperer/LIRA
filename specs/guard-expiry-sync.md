# 可选的主播账号与大航海到期同步

状态：Implemented。来源：2026-10-12 用户要求；总览位置已确认是服务端主播中心。

## 要求与验收

- 设置页保留上方 B 站登录和直播间两栏的既有样式，新增栏复用相同 fieldset、状态、账号资料与按钮。原账号用于弹幕、礼物及机器人；所有用途与切换说明集中在问号中，只有“可选”常驻说明。来源使用现有下拉组件，默认“使用上方登录账号”。服务器核对房主身份，选择本身不代表身份已验证。
- “单独登录主播账号（可选）”必须明文显示可选，并用现有问号组件说明仅用于大航海到期同步。独立账号状态、UID、登录和退出明确标注用途。
- 选来源即保存到云端，与直播间“保存设置”分开；失败恢复最后确认来源。未配置直播间须先保存房间再登录房主；未登录独立账号不影响原功能。
- 独立登录使用一次性 Electron session，在主进程上传到当前租户；不读取、持久化或替换原直播/机器人 Cookie。失败、取消、来源切换和授权变化清理登录；不向 renderer 返回秘密。切回复用会清除独立云端登录。
- 服务端主播中心总览显示七日内即将到期、已到期七日内名单和相对日数；未知及失败不能视为零人。客户端无需下载成员或保存第二份名单。

## 所有权与验证

`guard-expiry-auth.js` 拥有登录生命周期；`guard-expiry-ipc.js` 沿用主窗口/frame/origin 授权；`settings-guard-expiry.js` 拥有来源与状态 UI。字段与桥见[preload](../docs/reference/desktop/preload.md)，秘密生命周期见[auth](../docs/reference/desktop/auth.md)。服务端协议在相邻 `lira-server/docs/protocol/guard-expiry.md`。

`test/bilibili/guard-expiry-auth.test.js`、`guard-expiry-ipc.test.js` 及 `test/desktop/guard-expiry-settings-electron.test.js` 覆盖来源、隔离、取消、失败、权限和真实 Electron preload。使用合成账号，真实主播登录验收见[计划](plans/2026-10-12-guard-expiry-sync.md)。
