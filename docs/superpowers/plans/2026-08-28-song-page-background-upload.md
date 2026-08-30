# 歌单页自定义背景 · 桌面端对接方案

日期：2026-08-28
服务器侧状态：**已实现并验证**（lira-server v0.6.0+）。本文档描述桌面端（D:\Work\Live）需要做的全部改动。

---

## 1. 功能概述

主播可以为自己的公开歌单页（`https://<subdomain>.lirahub.cn/`）上传一张自定义背景图。

- 每个主播**同时只保留一张**：上传新图自动覆盖旧图（包括换格式，旧文件会被删除）
- 删除后歌单页恢复默认水彩背景
- 网页端管理页（`<subdomain>.lirahub.cn/manage`）已自带该功能；本文档让桌面端也能管理
- 歌单页展示时会在背景图上叠加柔光磨砂层，保证文字可读，客户端无需处理

## 2. 服务器契约（已实现，直接可用）

三个端点都挂在设备路由下，认证方式与现有的 `/api/device/songs/sync` **完全相同**（`Authorization: Bearer <device accessToken>`）。

| 方法     | 路径                               | 说明          |
| -------- | ---------------------------------- | ------------- |
| `GET`    | `/api/device/song-page/background` | 查询当前背景  |
| `PUT`    | `/api/device/song-page/background` | 上传/替换背景 |
| `DELETE` | `/api/device/song-page/background` | 删除背景      |

### PUT 请求（重点，和现有 JSON 调用不一样）

- **请求体是图片原始字节**，不是 JSON，也不是 multipart
- `Content-Type` 必须是图片真实格式：`image/png` / `image/jpeg` / `image/webp` / `image/gif`
- 服务器会校验**魔数（文件头）与声明的 Content-Type 一致**，伪装扩展名会被拒
- 大小上限 5MB（服务器环境变量 `SONG_BACKGROUND_MAX_BYTES`，默认 5242880）

```http
PUT /api/device/song-page/background HTTP/1.1
Authorization: Bearer <accessToken>
Content-Type: image/png

<图片二进制>
```

### 响应

成功（PUT / GET）：

```json
{
  "ok": true,
  "background": {
    "url": "/api/public/streamers/mlbb/background?v=2026-08-28T15%3A23%3A12.045Z",
    "bytes": 67673,
    "updatedAt": "2026-08-28T15:23:12.045Z"
  }
}
```

- GET 无背景时返回 `{ "background": null }`（HTTP 200）
- `url` 是**相对路径**；拼接规则：`https://api.lirahub.cn` + `url`（该端点允许匿名访问，用于预览）
- `url` 里的 `?v=<updatedAt>` 是缓存破坏参数，**每次上传都会变**，客户端预览时不要自己缓存这个 URL

### 错误码

| HTTP | error                                                      | 含义                                               | 建议提示                             |
| ---- | ---------------------------------------------------------- | -------------------------------------------------- | ------------------------------------ |
| 400  | `BACKGROUND_IMAGE_REQUIRED`                                | 请求体为空或 Content-Type 不对（raw 解析器没接管） | “请选择图片文件”                     |
| 413  | `PAYLOAD_TOO_LARGE`                                        | 超过 5MB                                           | “图片超过 5MB，请压缩后再上传”       |
| 415  | `BACKGROUND_FORMAT_UNSUPPORTED`                            | 魔数校验失败 / 格式不支持 / 声明类型与实际不符     | “仅支持 PNG / JPG / WebP / GIF 图片” |
| 401  | `DEVICE_TOKEN_*`                                           | 设备凭证问题                                       | 走现有的授权失效流程                 |
| 403  | `DEVICE_REVOKED` / `LICENSE_REVOKED` / `STREAMER_DISABLED` | 授权被撤销                                         | 走现有的授权失效流程                 |

## 3. 客户端改动清单（按层）

整体照搬现有「云端歌单同步」的五层链路，改动位置一一对应：

| 层        | 文件                                                                                                                                                                | 参照的现有实现                                                      |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| HTTP 封装 | [src/electron/license/remote-license-client.js](../../../src/electron/license/remote-license-client.js)                                                             | `syncSongs`（约 65-73 行的 endpoint map）                           |
| 业务/令牌 | [src/electron/license/license-manager.js](../../../src/electron/license/license-manager.js)                                                                         | `syncSongs()`（约 203-208 行）                                      |
| IPC       | [src/electron/ipc/license-ipc.js](../../../src/electron/ipc/license-ipc.js)                                                                                         | `license:sync-songs`（约 27-31 行）                                 |
| Preload   | [src/electron/preload.js](../../../src/electron/preload.js)                                                                                                         | `window.liraLicense.syncSongs`（约 69-84 行）                       |
| UI        | [public/pages/admin/song/import-export.html](../../../public/pages/admin/song/import-export.html) + [public/js/admin/import.js](../../../public/js/admin/import.js) | `licenseSongSync` fieldset + `initCloudSongSync()`（约 196-212 行） |

### 3.1 remote-license-client.js — 加二进制上传支持

现有 `request()` 会把 payload 一律 `JSON.stringify`（约 25-39 行），**不能复用**。建议加一个 raw 变体：

```js
async function requestRaw(method, pathname, bodyBuffer, contentType, token) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs); // 沿用现有超时配置
  try {
    const response = await fetchImpl(`${baseUrl}${pathname}`, {
      method,
      headers: {
        Accept: 'application/json',
        'Content-Type': contentType,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: bodyBuffer, // Uint8Array / Buffer，直接透传
      signal: controller.signal,
      redirect: 'error',
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok)
      throw new RemoteLicenseError(
        payload.error || `HTTP_${response.status}`,
        payload.error || '请求失败',
        response.status,
      );
    return payload;
  } finally {
    clearTimeout(timer);
  }
}
```

> 注意：上面是示意，实际请沿用你现有的错误类/超时写法，保持和 `request()` 一致的错误形态。

endpoint map 里加三个：

```js
getSongPageBackground: (token) => request('GET', '/api/device/song-page/background', undefined, token),
uploadSongPageBackground: (bytes, contentType, token) => requestRaw('PUT', '/api/device/song-page/background', bytes, contentType, token),
deleteSongPageBackground: (token) => request('DELETE', '/api/device/song-page/background', undefined, token),
```

### 3.2 license-manager.js — 业务方法

```js
const SONG_BACKGROUND_MAX_BYTES = 5 * 1024 * 1024;
const SONG_BACKGROUND_TYPES = new Map([
  ['png', 'image/png'],
  ['jpg', 'image/jpeg'],
  ['jpeg', 'image/jpeg'],
  ['webp', 'image/webp'],
  ['gif', 'image/gif'],
]);

async function getSongPageBackground() {
  const token = await ensureAuthorized();
  return remote.getSongPageBackground(token);
}

async function uploadSongPageBackground(bytes, fileName) {
  const buffer = Buffer.from(bytes); // IPC 传来的 Uint8Array
  if (!buffer.length)
    throw new RemoteLicenseError(
      'BACKGROUND_IMAGE_REQUIRED',
      '请选择图片文件。',
    );
  if (buffer.length > SONG_BACKGROUND_MAX_BYTES)
    throw new RemoteLicenseError('PAYLOAD_TOO_LARGE', '图片超过 5MB。');
  const ext =
    String(fileName || '')
      .split('.')
      .pop()
      ?.toLowerCase() || '';
  const contentType = SONG_BACKGROUND_TYPES.get(ext);
  if (!contentType)
    throw new RemoteLicenseError(
      'BACKGROUND_FORMAT_UNSUPPORTED',
      '仅支持 PNG / JPG / WebP / GIF。',
    );
  const token = await ensureAuthorized();
  return remote.uploadSongPageBackground(buffer, contentType, token);
}

async function deleteSongPageBackground() {
  const token = await ensureAuthorized();
  return remote.deleteSongPageBackground(token);
}
```

- `ensureAuthorized()`（约 185-192 行）已处理令牌过期续期，直接复用
- 大小/类型在 manager 层前置校验一次（服务器仍会再校验，双重保险）

### 3.3 license-ipc.js — 三个通道

沿用 `safeHandle` 模式（约 7-14 行）。**在 IPC 边界也做一次校验**，防止渲染层传入超大对象占内存：

```js
safeHandle('license:get-song-page-background', () =>
  licenseManager.getSongPageBackground(),
);

safeHandle('license:upload-song-page-background', (payload) => {
  const bytes = payload?.bytes;
  if (!(bytes instanceof Uint8Array) || !bytes.length)
    return { ok: false, error: 'BACKGROUND_IMAGE_REQUIRED' };
  if (bytes.byteLength > 5 * 1024 * 1024)
    return { ok: false, error: 'PAYLOAD_TOO_LARGE' };
  return licenseManager.uploadSongPageBackground(bytes, payload?.fileName);
});

safeHandle('license:delete-song-page-background', () =>
  licenseManager.deleteSongPageBackground(),
);
```

> IPC structured clone 支持 `Uint8Array` 直接跨进程传输，5MB 以内没问题，不用转 Base64。

### 3.4 preload.js — 暴露方法

```js
getSongPageBackground: () => ipcRenderer.invoke('license:get-song-page-background'),
uploadSongPageBackground: (bytes, fileName) => ipcRenderer.invoke('license:upload-song-page-background', { bytes, fileName }),
deleteSongPageBackground: () => ipcRenderer.invoke('license:delete-song-page-background'),
```

### 3.5 UI — 歌单管理页加「歌单页背景」面板

位置建议：紧跟现有 `licenseSongSync` fieldset（[import-export.html](../../../public/pages/admin/song/import-export.html) 约 20-29 行）之后，同一个授权可见性逻辑（未授权时一起隐藏）：

```html
<fieldset id="licenseSongBackground" class="theme-section" hidden>
  <legend>歌单页背景</legend>
  <p class="hint">自定义公开歌单网页的背景图，仅保留最新一张，上传即覆盖。</p>
  <div class="song-bg-preview-wrap">
    <img
      id="licenseSongBgPreview"
      class="song-bg-preview"
      alt="当前背景预览"
      hidden
    />
    <p id="licenseSongBgEmpty" class="hint">
      未设置背景，歌单页使用默认水彩背景。
    </p>
  </div>
  <p id="licenseSongBgMeta" class="hint"></p>
  <div class="actions">
    <input
      id="licenseSongBgFile"
      type="file"
      accept="image/png,image/jpeg,image/webp,image/gif"
      hidden
    />
    <button id="licenseSongBgPickBtn" class="primary" type="button">
      选择图片
    </button>
    <button id="licenseSongBgDeleteBtn" class="secondary" type="button" hidden>
      删除背景
    </button>
  </div>
  <p id="licenseSongBgResult" class="hint" role="status" aria-live="polite"></p>
</fieldset>
```

渲染层 JS（[import.js](../../../public/js/admin/import.js)，参照 `initCloudSongSync` 与 [start-animation.js](../../../public/js/admin/start-animation.js) 约 238-267 行的文件读取模式）：

```js
const BG_MAX = 5 * 1024 * 1024;

async function refreshSongBackground() {
  const response = await window.liraLicense.getSongPageBackground();
  const bg = response?.background || null;
  preview.hidden = !bg;
  empty.hidden = Boolean(bg);
  if (bg) {
    preview.src = `https://api.lirahub.cn${bg.url}`; // 相对路径拼 API host
    meta.textContent = `更新于 ${new Date(bg.updatedAt).toLocaleString('zh-CN')} · ${(bg.bytes / 1024).toFixed(0)} KB`;
  }
}

fileInput.addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  event.target.value = ''; // 允许重选同一文件
  if (!file) return;
  if (file.size > BG_MAX) {
    result.textContent = '图片超过 5MB，请压缩后再上传。';
    return;
  }
  pickBtn.disabled = true;
  result.textContent = '正在上传…';
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const response = await window.liraLicense.uploadSongPageBackground(
      bytes,
      file.name,
    );
    if (response?.error) throw new Error(response.error);
    result.textContent = '背景已更新。';
    await refreshSongBackground();
  } catch (error) {
    result.textContent = `上传失败：${error.message}`;
  } finally {
    pickBtn.disabled = false;
  }
});
```

样式：复用现有 `.theme-section` / `.actions` / `.hint` / `.primary` / `.secondary`；预览图加一个

```css
.song-bg-preview {
  max-width: 320px;
  aspect-ratio: 16 / 9;
  object-fit: cover;
  border-radius: 12px;
}
```

### 选文件用哪种方式？

两种都行，**推荐渲染层 `<input type="file">`**（上面的写法）：

- 参照 `start-animation.js` 的现有模式，不需要新增 `dialog.showOpenDialog` IPC
- 只在「云端背景」场景需要把字节传到主进程（因为 Bearer token 在主进程），`Uint8Array` 走 IPC 即可

如果更想要原生对话框，也可参照 [music-ipc.js](../../../src/electron/ipc/music-ipc.js) 约 31-45 行的 `music:select-local-files`，在主进程读文件后直接上传——但要多维护一条链路，不推荐。

## 4. 状态与一致性约定

- **进入面板时**调一次 `getSongPageBackground` 刷新预览——可能网页端/另一台电脑刚改过，服务器是唯一事实来源
- 上传/删除成功后都用响应里的 `background` 刷新 UI（或再 GET 一次），不要本地假设
- 多设备并发上传：**后写覆盖先写**，无冲突合并，符合"只保留一张"的产品语义
- 授权失效（401/403）沿用现有 `LICENSE_NOT_AUTHORIZED` 流程，不要在这个面板里单独处理

## 5. 需要同步更新的客户端文档（按 docs 约定）

- [docs/architecture/backend/api.md](../backend/api.md)：登记三个新端点
- [docs/architecture/desktop/preload.md](../desktop/preload.md)：登记三个新 `license:*` IPC 通道
- [docs/architecture/frontend/pages.md](../frontend/pages.md)：`import-export.html` 新增面板说明

## 6. 本地联调步骤

服务器侧（lira-server）已带演示数据，启动后即可联调：

```bash
# lira-server 仓库
npm run dev          # http://127.0.0.1:3000
# 演示主播：子域名 mlbb，网页管理端账号 mlbb / demo123456
# 歌单页：http://127.0.0.1:3000/song/mlbb
# 网页管理：http://127.0.0.1:3000/streamer/assets/... 或 /song/mlbb 同源的 /manage 需要子域名 hosts
```

桌面端联调时把 API base 指向本地：`LIRA_LICENSE_API_BASE=http://127.0.0.1:3000`（`remote-license-client.js` 已支持该环境变量）。

curl 冒烟（用设备令牌流程太长的场景可直接用网页端验证服务器行为）：

```bash
# 网页端 cookie 流程（服务器行为一致，仅认证方式不同）
curl -c c.txt -X POST http://127.0.0.1:3000/api/streamer/login \
  -H "content-type: application/json" -d '{"accountName":"mlbb","password":"demo123456"}'
curl -b c.txt -X PUT http://127.0.0.1:3000/api/streamer/song-page/background \
  -H "content-type: image/png" --data-binary @test.png
curl http://127.0.0.1:3000/api/public/streamers/mlbb/background   # 应 200 image/png
```

验收清单：

- [ ] 上传 PNG/JPG/WebP/GIF 各一次，公开页背景即时更新（`?v=` 变化）
- [ ] 上传 6MB 图片 → 提示超过限制（不发出请求或收到 413）
- [ ] 把 .txt 改名 .png 上传 → 415 拒绝
- [ ] 删除后公开页恢复水彩背景（公开端点 404）
- [ ] 网页端和桌面端交叉上传，两边预览都正确刷新
