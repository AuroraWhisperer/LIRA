# Feature: 萌时钟固定网址

## Goal

萌时钟在管理页只向用户提供固定 `/clock` 地址；用户修改风格、日期、秒数、
小时制或角标文案时，地址保持不变，当前配置由服务端持久化并在 Browser Source
加载时应用。

## Context

当前管理页同时展示固定地址和把全部配置编码进查询参数的地址。只有带参数地址
能保留自定义设置，因此设置变化会产生不同的 OBS 地址。

## Constraints

- Electron 管理页和 OBS Browser Source 仍通过本机 `127.0.0.1:3000` 服务通信。
- 不新增数据库表或运行时依赖；配置沿用现有 `settings` 键值存储。
- 旧的带参数 `/clock?...` 地址继续可用，显式查询参数优先于已保存设置。

## Non-goals

- 不增加跨设备同步。
- 不要求已经打开的 OBS 页面在不刷新 Browser Source 的情况下实时热更新。
- 不改变时钟视觉、尺寸、时间来源或计时方式。

## Architecture

- Frontend: `public/js/admin/clock-card.js` 即时渲染预览并经现有
  `POST /api/settings` 保存配置；界面只展示和复制固定地址。
- Backend: `settings-store` 保存五个时钟配置键；`GET /api/clock/config`
  向无管理会话的 Browser Source 返回经过校验的公开配置。
- Overlay: `public/js/overlays/clock.js` 首帧读取公开配置，旧查询参数按字段覆盖。

## Security

- 配置写入继续要求现有 session token；公开接口只读且不返回敏感数据。
- 风格、布尔值和小时制按枚举校验；角标移除控制字符、合并空白并限制为
  16 个 Unicode 字符。
- 角标继续仅通过 `textContent` 渲染。

## Compatibility

- `/clock` 页面地址保持不变。
- 既有 `style/date/seconds/format/label` 查询参数仍受支持。
- 缺失或非法持久化配置回退到原有默认值。

## Acceptance Criteria

- 管理页只显示一个 `/clock` 地址，修改任意设置不会改变该地址。
- 修改后的配置保存到 `settings`，刷新管理页后仍能恢复。
- 无查询参数的 `/clock` 加载保存配置；旧参数地址可逐字段覆盖保存配置。
- 非法服务端配置写入返回 400，公开读取只返回规范化字段。

## Done When

实现、聚焦测试、契约文档、差异检查和工作树检查均完成。
