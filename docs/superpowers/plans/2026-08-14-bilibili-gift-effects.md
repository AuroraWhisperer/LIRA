# B站礼物全屏特效 Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增一个礼物全屏特效 overlay——收到带特效的礼物时,在直播间画面上叠加播放 B 站那类几秒钟的全屏 MP4 动画(如烟花、飞船特效)。

**Architecture:** 服务端新增特效配置解析模块,通过 B 站 web 前端同款接口 `GetEffectConfListV2` 拉取全屏特效清单并缓存(12 小时 TTL),建立 `giftId → 特效素材` 映射。礼物落库时(`onGiftFlushed`)查找特效,命中则通过现有 WebSocket hub 广播 `{ type: 'gift:effect' }` 事件。新增 overlay 页面监听该事件,用 `<video crossorigin="anonymous" referrerpolicy="no-referrer">` 播放 CDN 上的 MP4(绕开 Referer 防盗链),逐帧 canvas "亮度抠黑"把黑底特效合成到透明画布上。透明合成不能用 `mix-blend-mode: screen`——overlay 页面背景透明,没有可混合的底色,黑色会原样保留,必须走 canvas 抠黑。SVGA 老礼物(如 25 小电视飞船,共 6 个)无 MP4,本期不播放特效,保持现有静态图展示。

**Tech Stack:** Node.js 24+ CommonJS、内置 `fetch`、`node:test` + `node:assert/strict`、原生 DOM/Canvas(无新依赖)。

## Global Constraints

- 不新增任何 npm 依赖;Node.js ≥ 24;验证用 `npm run check && npm test`。
- 服务端新模块放入 `src/bilibili/gift/`,沿用 `createX(options)` 依赖注入工厂模式与「编写人」文件头注释。
- Overlay 前端沿用现有惯例:IIFE + `window.__API_TOKEN__`、绝对路径 `/css/...`、`/js/...`、缓存版本号 `?v=YYYYMMDD-NN`、`<body class="overlay-body ...">`。
- 特效接口无需登录 Cookie,但请求头必须带 `Referer: https://live.bilibili.com/`;MP4 CDN 防盗链只查 Referer,overlay 内视频必须 `referrerpolicy="no-referrer"`(第三方 Referer 会 403)。
- 同一礼物绑定多个特效时取 `id` 最大(最新)的一条;`bind_gift_ids` 为 0 或 `web_mp4` 为空(SVGA 老特效)的条目跳过。
- 礼物事件广播沿用现有 WebSocket hub(`webSocketHub.broadcast`),不新建通道。

---

### Task 1: 特效配置解析模块(giftId → MP4 素材映射)

**Files:**
- Create: `src/bilibili/gift/effect-config.js`
- Test: `test/gift-effect-config.test.js`

**Interfaces:**
- Consumes: 内置 `fetch`;B 站接口 `https://api.live.bilibili.com/xlive/general-interface/v1/fullScSpecialEffect/GetEffectConfListV2?platform=pc&room_id=0&area_parent_id=0&area_id=0&source=live&build=0&base_version=0`
- Produces:
  - `buildEffectMap(payload)` → `Map<giftId, { effectId, type, mp4Url, md5, fileSize }>`(纯函数,导出供测试)
  - `pickEffect(entries)` → 单条 effect 或 `null`(纯函数)
  - `createGiftEffectResolver(options)` → `{ getEffectMap(): Promise<Map>, resolve(giftId): effect|null }`,并发去重 + TTL 缓存 + 失败保留旧缓存
  - `EFFECT_API_URL`、`DEFAULT_REFRESH_MS` 常量导出

- [ ] **Step 1: Write the failing test**

```js
// test/gift-effect-config.test.js
'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  EFFECT_API_URL,
  buildEffectMap,
  pickEffect,
  createGiftEffectResolver
} = require('../src/bilibili/gift/effect-config');

const confEntry = (id, giftIds, mp4 = `https://i0.hdslb.com/bfs/live/eff${id}.mp4`) => ({
  type: 1,
  web_mp4: mp4,
  id,
  bind_gift_ids: giftIds,
  web_mp4_md5: 'md5-' + id,
  web_mp4_file_size: 1000 + id
});

test('buildEffectMap maps gift ids to effects and skips svga/no-mp4 entries', () => {
  const payload = {
    data: {
      full_sc_resource: {
        conf_list: [
          confEntry(8, [25], ''),        // SVGA 老特效,无 MP4 → 跳过
          confEntry(584, [31645]),
          confEntry(12, [20008]),
          confEntry(0, [0])              // 未绑定 → 跳过
        ]
      }
    }
  };
  const map = buildEffectMap(payload);
  assert.equal(map.size, 2);
  assert.equal(map.get(31645).mp4Url, 'https://i0.hdslb.com/bfs/live/eff584.mp4');
  assert.equal(map.get(31645).fileSize, 1584);
  assert.equal(map.get(25), undefined);
});

test('buildEffectMap keeps the newest effect when one gift binds several', () => {
  const payload = {
    data: {
      full_sc_resource: {
        conf_list: [confEntry(147, [30636]), confEntry(1638, [30636]), confEntry(1636, [30636])]
      }
    }
  };
  const map = buildEffectMap(payload);
  assert.equal(map.get(30636).effectId, 1638);
});

test('buildEffectMap tolerates missing conf_list', () => {
  assert.equal(buildEffectMap({ data: {} }).size, 0);
  assert.equal(buildEffectMap(null).size, 0);
});

test('pickEffect returns highest id or null', () => {
  assert.equal(pickEffect([confEntry(1, [1]), confEntry(9, [1])]).effectId, 9);
  assert.equal(pickEffect([]), null);
  assert.equal(pickEffect(null), null);
});

test('resolver fetches lazily once, dedupes concurrent calls and refreshes after ttl', async () => {
  let calls = 0;
  const resolver = createGiftEffectResolver({
    refreshMs: 60 * 1000,
    fetchJson: async (name, url) => {
      calls += 1;
      assert.equal(name, 'gift_effect_config');
      assert.equal(url, EFFECT_API_URL);
      return { payload: { data: { full_sc_resource: { conf_list: [confEntry(584, [31645])] } } } };
    }
  });

  assert.equal(resolver.resolve(31645), null); // 未加载 → null
  const [a, b] = await Promise.all([resolver.getEffectMap(), resolver.getEffectMap()]);
  assert.equal(calls, 1); // 并发去重
  assert.equal(a.get(31645).mp4Url, 'https://i0.hdslb.com/bfs/live/eff584.mp4');
  assert.equal(resolver.resolve(31645).effectId, 584);

  await resolver.getEffectMap(); // TTL 内 → 不重新拉
  assert.equal(calls, 1);
});

test('resolver keeps stale cache when refresh fails', async () => {
  let calls = 0;
  const resolver = createGiftEffectResolver({
    fetchJson: async () => {
      calls += 1;
      if (calls > 1) throw new Error('network down');
      return { payload: { data: { full_sc_resource: { conf_list: [confEntry(584, [31645])] } } } };
    }
  });
  const map = await resolver.getEffectMap();
  assert.equal(map.get(31645).effectId, 584);
  const again = await resolver.getEffectMap();
  assert.equal(again.get(31645).effectId, 584); // 失败后保留旧缓存
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/gift-effect-config.test.js`

Expected: FAIL with `Cannot find module '../src/bilibili/gift/effect-config'`.

- [ ] **Step 3: Write minimal implementation**

```js
// src/bilibili/gift/effect-config.js
// 编写人：AuroraWhisperer
// B站礼物全屏特效配置 — 拉取/缓存 GetEffectConfListV2,建立 giftId → 特效素材映射。
'use strict';

const EFFECT_API_URL = 'https://api.live.bilibili.com/xlive/general-interface/v1/fullScSpecialEffect/GetEffectConfListV2' +
  '?platform=pc&room_id=0&area_parent_id=0&area_id=0&source=live&build=0&base_version=0';

const DEFAULT_REFRESH_MS = 12 * 60 * 60 * 1000; // 12 小时

function pickEffect(entries) {
  // 同一礼物绑定多个特效时,取 id 最大(最新注册)的一条
  if (!Array.isArray(entries) || entries.length === 0) return null;
  return entries.reduce((best, entry) => (entry.id > best.id ? entry : best), entries[0]);
}

function buildEffectMap(payload) {
  const confList = payload && payload.data
    && payload.data.full_sc_resource && payload.data.full_sc_resource.conf_list;
  const byGiftId = new Map();
  if (!Array.isArray(confList)) return byGiftId;
  for (const raw of confList) {
    const mp4Url = typeof raw.web_mp4 === 'string' ? raw.web_mp4.trim() : '';
    if (!mp4Url) continue; // SVGA 老特效没有 MP4,跳过
    const effect = {
      effectId: Number(raw.id) || 0,
      type: Number(raw.type) || 0,
      mp4Url,
      md5: typeof raw.web_mp4_md5 === 'string' ? raw.web_mp4_md5 : '',
      fileSize: Number(raw.web_mp4_file_size) || 0
    };
    const giftIds = Array.isArray(raw.bind_gift_ids) ? raw.bind_gift_ids : [];
    for (const giftId of giftIds) {
      const id = Number(giftId);
      if (!id) continue; // bind_gift_ids 里的 0 表示未绑定
      const existing = byGiftId.get(id);
      if (!existing || effect.effectId > existing.effectId) byGiftId.set(id, effect);
    }
  }
  return byGiftId;
}

function createGiftEffectResolver(options = {}) {
  const fetchJson = options.fetchJson || defaultFetchJson;
  const refreshMs = options.refreshMs || DEFAULT_REFRESH_MS;
  let byGiftId = new Map();
  let fetchedAt = 0;
  let pending = null;

  function isFresh() {
    return fetchedAt > 0 && Date.now() - fetchedAt < refreshMs;
  }

  async function getEffectMap() {
    if (isFresh()) return byGiftId;
    if (!pending) {
      pending = fetchJson('gift_effect_config', EFFECT_API_URL)
        .then(({ payload }) => buildEffectMap(payload))
        .then((map) => {
          byGiftId = map;
          fetchedAt = Date.now();
          console.log(`[Bilibili][GiftEffect] 特效配置已更新:${map.size} 个礼物有全屏特效`);
          return map;
        })
        .catch((error) => {
          console.warn(`[Bilibili][GiftEffect] 特效配置拉取失败,沿用旧缓存:${error.message || error}`);
          return byGiftId;
        })
        .finally(() => { pending = null; });
    }
    return pending;
  }

  function resolve(giftId) {
    return byGiftId.get(Number(giftId) || 0) || null;
  }

  return { getEffectMap, resolve };
}

async function defaultFetchJson(endpointName, url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Origin': 'https://live.bilibili.com',
      'Referer': 'https://live.bilibili.com/'
    }
  });
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch (_) {
    throw new Error(`Bilibili API ${endpointName} returned non-JSON response. HTTP ${response.status}.`);
  }
  if (!response.ok || Number(payload.code) !== 0) {
    throw new Error(`Bilibili API ${endpointName} failed: http=${response.status} code=${payload.code} message=${payload.message || ''}`);
  }
  return { payload, response };
}

module.exports = {
  EFFECT_API_URL,
  DEFAULT_REFRESH_MS,
  pickEffect,
  buildEffectMap,
  createGiftEffectResolver
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/gift-effect-config.test.js`

Expected: PASS (6 tests)。

- [ ] **Step 5: Commit**

```bash
git add src/bilibili/gift/effect-config.js test/gift-effect-config.test.js
git commit -m "feat: resolve bilibili full-screen gift effects from GetEffectConfListV2"
```

---

### Task 2: 礼物落库时广播 gift:effect 事件

**Files:**
- Modify: `src/bilibili/gift/effect-config.js`(新增 `buildGiftEffectEvent`)
- Modify: `src/server.js`(创建 resolver + `onGiftFlushed` 接线,约 99-107 行)
- Test: `test/gift-effect-config.test.js`(新增事件构造用例)、`test/gift-effects-overlay.test.js`(接线断言)

**Interfaces:**
- Consumes: Task 1 的 `createGiftEffectResolver({}).getEffectMap()`;server.js 中 `onGiftFlushed(item)` 的规范化礼物行(`item.id`、`item.giftId`、`item.giftName`、`item.num`、`item.unitPrice`、`item.userName`,如缺失回退 snake_case 字段);`webSocketHub.broadcast(message)`。
- Produces: `buildGiftEffectEvent(item, resolver)` → Promise,解析为 `{ type: 'gift:effect', eventId, giftId, giftName, num, unitPrice, userName, effect: { effectId, type, mp4Url, md5, fileSize } }` 或 `null`(礼物无特效/配置未就绪)。Task 3 的 overlay 消费此消息。

- [ ] **Step 1: Write the failing test**

在 `test/gift-effect-config.test.js` 末尾追加:

```js
test('buildGiftEffectEvent resolves gift rows with effects and skips the rest', async () => {
  const { buildGiftEffectEvent } = require('../src/bilibili/gift/effect-config');
  const resolver = {
    getEffectMap: async () => new Map([[35457, { effectId: 584, type: 1, mp4Url: 'https://i0.hdslb.com/bfs/live/eff.mp4', md5: '', fileSize: 417612 }]])
  };
  const event = await buildGiftEffectEvent({ id: 77, giftId: 35457, giftName: '马上来财', num: 1, unitPrice: 10000, userName: '观众A' }, resolver);
  assert.equal(event.type, 'gift:effect');
  assert.equal(event.eventId, 77);
  assert.equal(event.giftName, '马上来财');
  assert.equal(event.effect.mp4Url, 'https://i0.hdslb.com/bfs/live/eff.mp4');

  assert.equal(await buildGiftEffectEvent({ id: 78, giftId: 31643 }, resolver), null); // 无特效礼物
  assert.equal(await buildGiftEffectEvent({ id: 0, giftId: '' }, resolver), null);      // 无 giftId
});

test('buildGiftEffectEvent returns null when effect config is unavailable', async () => {
  const { buildGiftEffectEvent } = require('../src/bilibili/gift/effect-config');
  const resolver = { getEffectMap: async () => { throw new Error('api down'); } };
  assert.equal(await buildGiftEffectEvent({ id: 1, giftId: 31645 }, resolver), null);
});
```

新建 `test/gift-effects-overlay.test.js`:

```js
// test/gift-effects-overlay.test.js
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT_DIR = path.join(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

test('server wires gift effect events into the websocket broadcast path', () => {
  const serverSource = read('src/server.js');
  assert.match(serverSource, /buildGiftEffectEvent\(item, giftEffectResolver\)/);
  assert.match(serverSource, /webSocketHub\.broadcast\(effectEvent\)/);
  assert.match(serverSource, /createGiftEffectResolver\(/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/gift-effect-config.test.js test/gift-effects-overlay.test.js`

Expected: FAIL——`buildGiftEffectEvent` 未导出,server.js 无相关接线。

- [ ] **Step 3: Write minimal implementation**

`src/bilibili/gift/effect-config.js` 中追加(放在 `createGiftEffectResolver` 之后,并加入 module.exports):

```js
async function buildGiftEffectEvent(item, resolver) {
  const giftId = Number(item && (item.giftId ?? item.gift_id)) || 0;
  if (!giftId) return null;
  let effect;
  try {
    const effectMap = await resolver.getEffectMap();
    effect = effectMap.get(giftId) || null;
  } catch (error) {
    effect = null;
  }
  if (!effect) return null;
  return {
    type: 'gift:effect',
    eventId: Number(item.id) || 0,
    giftId,
    giftName: String(item.giftName ?? item.gift_name ?? '').trim() || '礼物',
    num: Number(item.num) || 1,
    unitPrice: item.unitPrice ?? item.unit_price ?? 0,
    userName: String(item.userName ?? item.user_name ?? ''),
    effect
  };
}
```

`src/server.js` 修改两处:

1. 在 `giftService.repairGiftV2Events({ db });`(约 113 行)之前新增:

```js
  const giftEffectResolver = giftEffectModule.createGiftEffectResolver();
  giftEffectResolver.getEffectMap(); // 启动即预热,失败时内部静默保留空缓存
```

2. `onGiftFlushed` 回调(约 102-105 行)改为:

```js
    onGiftFlushed: (item) => {
      logGiftDelivery('final', item);
      broadcastSnapshot('bilibili:gift');
      giftEffectModule.buildGiftEffectEvent(item, giftEffectResolver).then((effectEvent) => {
        if (effectEvent) webSocketHub.broadcast(effectEvent);
      });
    },
```

(顶部 require 区新增 `const giftEffectModule = require('./bilibili/gift/effect-config');`,与既有 `const giftService = ...` 平级;`webSocketHub` 为同作用域后续 `const`,闭包在礼物落库时执行、早于首条弹幕,不会触发 TDZ。)

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/gift-effect-config.test.js test/gift-effects-overlay.test.js`

Expected: PASS(gift-effect-config 8 个用例 + overlay 接线 1 个)。

- [ ] **Step 5: Commit**

```bash
git add src/bilibili/gift/effect-config.js src/server.js test/gift-effect-config.test.js test/gift-effects-overlay.test.js
git commit -m "feat: broadcast gift:effect websocket events for gifts with full-screen effects"
```

---

### Task 3: 礼物特效 overlay 页面(抠黑合成播放)

**Files:**
- Create: `public/pages/overlays/gift-effects.html`
- Create: `public/css/overlays/gift-effects.css`
- Create: `public/js/overlays/gift-effects.js`
- Modify: `src/server/http-utils.js`(静态页映射表,约 86-90 行,追加 `/gift-effects`)
- Test: `test/gift-effects-overlay.test.js`(追加 overlay 断言)

**Interfaces:**
- Consumes: Task 2 的 WS 消息 `{ type: 'gift:effect', eventId, giftId, giftName, num, unitPrice, userName, effect: { mp4Url, ... } }`;`window.__API_TOKEN__`(既有 overlay 惯例);`window.OverlayUtils` 可选(本期不使用,预留)。
- Produces: 新 overlay 页面 `/gift-effects`,OBS 浏览器源直接使用该 URL;无 JS API 导出。

- [ ] **Step 1: Write the failing test**

在 `test/gift-effects-overlay.test.js` 追加:

```js
test('gift effects overlay is routed, referrer-safe and luma-keys mp4 frames', () => {
  const serverSource = read('src/server/http-utils.js');
  const html = read('public/pages/overlays/gift-effects.html');
  const css = read('public/css/overlays/gift-effects.css');
  const overlayJs = read('public/js/overlays/gift-effects.js');

  assert.match(serverSource, /\['\/gift-effects', 'pages\/overlays\/gift-effects\.html'\]/);
  assert.match(html, /meta name="referrer" content="no-referrer"/);
  assert.match(html, /id="giftEffectStage"/);
  assert.match(css, /\.gift-effects-overlay-body\s*\{[^}]*background:\s*transparent/);
  assert.match(overlayJs, /payload\.type === 'gift:effect'/);
  assert.match(overlayJs, /referrerPolicy\s*=\s*'no-referrer'/);
  assert.match(overlayJs, /crossOrigin\s*=\s*'anonymous'/);
  assert.match(overlayJs, /keyOutBlack/);
  assert.match(overlayJs, /Math\.max\(data\[i\][^)]*data\[i \+ 2\]\)/);
  assert.match(overlayJs, /MAX_PLAYING/);
  assert.match(overlayJs, /eventId\s*<=\s*lastEventId/);
  // 透明页面上 mix-blend-mode 没有底色可混合,必须走 canvas 抠黑
  assert.doesNotMatch(overlayJs, /mix-blend-mode/);
  assert.doesNotMatch(css, /mix-blend-mode/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/gift-effects-overlay.test.js`

Expected: FAIL——三个新文件不存在(`read()` 抛错)。

- [ ] **Step 3: Write minimal implementation**

`public/pages/overlays/gift-effects.html`:

```html
<!-- 编写人：AuroraWhisperer -->
<!-- 礼物全屏特效 overlay — OBS 浏览器源投屏 -->
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="referrer" content="no-referrer">
    <title>礼物特效</title>
    <link rel="stylesheet" href="/css/overlays/base.css?v=20260814-01">
    <link rel="stylesheet" href="/css/overlays/gift-effects.css?v=20260814-01">
  </head>
  <body class="overlay-body gift-effects-overlay-body">
    <div id="giftEffectStage"></div>
    <script src="/js/overlays/gift-effects.js?v=20260814-01"></script>
  </body>
</html>
```

`public/css/overlays/gift-effects.css`:

```css
/* 礼物全屏特效 overlay */
.gift-effects-overlay-body {
  background: transparent;
  margin: 0;
  overflow: hidden;
  pointer-events: none;
}

#giftEffectStage {
  position: fixed;
  inset: 0;
}

.gift-effect-layer {
  position: absolute;
  inset: 0;
  width: 100vw;
  height: 100vh;
}
```

`public/js/overlays/gift-effects.js`:

```js
// 编写人：AuroraWhisperer
// 礼物全屏特效 overlay — 监听 gift:effect 事件,播放 MP4 并逐帧亮度抠黑合成到透明画布。
'use strict';

(function () {
  const urlParams = new URLSearchParams(location.search);
  const SOUND_ON = urlParams.get('sound') === '1'; // 默认静音,OBS 源自动播放不受浏览器策略限制
  const MAX_PLAYING = Math.min(6, Math.max(1, Number.parseInt(urlParams.get('max') || '3', 10) || 3));
  const MAX_PENDING = 8;

  const stage = document.getElementById('giftEffectStage');
  const playing = new Map(); // eventId -> { video, canvas, context }
  const pending = [];
  let lastEventId = 0;
  let socket = null;
  let reconnectTimer = null;

  document.addEventListener('DOMContentLoaded', connectSocket);

  function connectSocket() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const token = window.__API_TOKEN__;
    const wsUrl = protocol + '//' + location.host + '/ws' + (token ? '?token=' + encodeURIComponent(token) : '');
    socket = new WebSocket(wsUrl);

    socket.addEventListener('open', () => {
      clearTimeout(reconnectTimer);
    });

    socket.addEventListener('message', (event) => {
      let payload;
      try {
        payload = JSON.parse(event.data);
      } catch (_) {
        return;
      }
      if (payload.type === 'gift:effect') handleEffectEvent(payload);
    });

    socket.addEventListener('close', () => {
      reconnectTimer = setTimeout(connectSocket, 3000);
    });
  }

  function handleEffectEvent(payload) {
    const eventId = Number(payload.eventId) || 0;
    if (eventId && eventId <= lastEventId) return; // 断线重连后不重放旧事件
    lastEventId = eventId || lastEventId;
    const effect = payload.effect;
    if (!effect || !effect.mp4Url) return;
    if (playing.size >= MAX_PLAYING) {
      if (pending.length >= MAX_PENDING) pending.shift(); // 超出排队的丢弃最旧
      pending.push(payload);
      return;
    }
    spawnEffect(payload);
  }

  function spawnEffect(payload) {
    const video = document.createElement('video');
    video.referrerPolicy = 'no-referrer'; // CDN 防盗链:第三方 Referer 403
    video.crossOrigin = 'anonymous';      // 抠黑需要读像素,依赖 CDN 的 ACAO:*
    video.muted = !SOUND_ON;
    video.loop = false;
    video.playsInline = true;
    video.src = payload.effect.mp4Url;

    const canvas = document.createElement('canvas');
    canvas.className = 'gift-effect-layer';
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const context = canvas.getContext('2d', { willReadFrequently: true });

    playing.set(payload.eventId, { video, canvas, context });
    stage.appendChild(canvas);

    video.addEventListener('playing', () => requestAnimationFrame(drawLoop(payload.eventId)));
    video.addEventListener('error', () => removeEffect(payload.eventId));
    video.addEventListener('ended', () => removeEffect(payload.eventId));
    video.play().catch(() => removeEffect(payload.eventId));
  }

  function drawLoop(eventId) {
    return function draw() {
      const layer = playing.get(eventId);
      if (!layer) return;
      const { video, canvas, context } = layer;
      if (video.readyState >= 2 && !video.paused && !video.ended) {
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        keyOutBlack(context, canvas.width, canvas.height);
      }
      requestAnimationFrame(draw);
    };
  }

  function keyOutBlack(context, width, height) {
    // 亮度抠黑:alpha = max(r,g,b)。黑底特效 MP4 在透明画面上只剩特效本体。
    const frame = context.getImageData(0, 0, width, height);
    const data = frame.data;
    for (let i = 0; i < data.length; i += 4) {
      data[i + 3] = Math.max(data[i], data[i + 1], data[i + 2]);
    }
    context.putImageData(frame, 0, 0);
  }

  function removeEffect(eventId) {
    const layer = playing.get(eventId);
    if (!layer) return;
    playing.delete(eventId);
    layer.video.pause();
    layer.video.removeAttribute('src');
    layer.video.load();
    layer.canvas.remove();
    if (pending.length > 0) spawnEffect(pending.shift());
  }
})();
```

`src/server/http-utils.js` 静态页映射表(约 86-90 行)追加一行:

```js
    ['/gift-effects', 'pages/overlays/gift-effects.html'],
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/gift-effects-overlay.test.js`

Expected: PASS(2 个用例)。

- [ ] **Step 5: Commit**

```bash
git add public/pages/overlays/gift-effects.html public/css/overlays/gift-effects.css public/js/overlays/gift-effects.js src/server/http-utils.js test/gift-effects-overlay.test.js
git commit -m "feat: add gift full-screen effect overlay with luma-key canvas compositing"
```

---

### Task 4: API 文档与弹幕字段注记更新

**Files:**
- Create: `docs/bilibili-live-api/gift-effect-config.md`
- Modify: `docs/bilibili-live-api/message_stream.md`(effect_id / face_effect_id 等"待调查"注记,约 663-664、677-680 行)
- Test: `test/gift-effects-overlay.test.js`(追加文档存在性断言,可选)

**Interfaces:**
- Consumes: 无代码依赖。
- Produces: 面向后续维护者的接口文档。

- [ ] **Step 1: Write the failing test**

在 `test/gift-effects-overlay.test.js` 追加:

```js
test('gift effect api docs explain the config endpoint and hotlink rules', () => {
  const doc = read('docs/bilibili-live-api/gift-effect-config.md');
  assert.match(doc, /GetEffectConfListV2/);
  assert.match(doc, /web_mp4/);
  assert.match(doc, /bind_gift_ids/);
  assert.match(doc, /no-referrer/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/gift-effects-overlay.test.js`

Expected: FAIL——文档文件不存在。

- [ ] **Step 3: Write minimal implementation**

`docs/bilibili-live-api/gift-effect-config.md`:

````markdown
# B站直播礼物全屏特效配置接口

几秒钟的全屏礼物特效(烟花、飞船等)由 web 直播间前端通过以下接口按需拉取,弹幕流里只带 `effect_id`,不带素材地址。

## 接口

```
GET https://api.live.bilibili.com/xlive/general-interface/v1/fullScSpecialEffect/GetEffectConfListV2
    ?platform=pc&room_id=0&area_parent_id=0&area_id=0&source=live&build=0&base_version=0
```

- 无需登录 Cookie,但请求头需带 `Referer: https://live.bilibili.com/` 与浏览器 UA。
- 2026-08-14 实测:2342 条全屏特效,其中 2138 条带 `web_mp4` 直链;仓库 902 个礼物中 520 个能匹配到特效。
- 响应结构:`data.full_sc_resource.conf_list[]`,每条约含:

| 字段 | 说明 |
| ---- | ---- |
| `id` | 特效 ID,同礼物多特效时取 id 最大(最新) |
| `type` | 特效类型(1=web MP4 为主) |
| `web_mp4` | 全屏特效 MP4 直链(黑底,无 alpha,几秒钟) |
| `bind_gift_ids` | 绑定的礼物 ID 列表(0 表示未绑定) |
| `horizontal_mp4` / `vertical_mp4` | 横/竖屏变体 |
| `web_mp4_md5` / `web_mp4_crc32` / `web_mp4_file_size` | 完整性校验 |
| `h265_conf` | H.265 版本配置 |

- 老 SVGA 特效(礼物 25 小电视飞船等 6 个)在本接口中 `web_mp4` 为空,地址在 `giftConfig` 接口的 `full_sc_web` 字段。

## MP4 下载/播放与防盗链

- 直链 `https://i0.hdslb.com/bfs/live/{hash}.mp4`,无需登录。
- 防盗链只查 Referer:无 Referer 或 bilibili 域 → 200;第三方 Referer(如 localhost overlay 页)→ 403。
- 网页内播放必须 `referrerpolicy="no-referrer"`(或页面级 `<meta name="referrer" content="no-referrer">`)。
- CDN 响应带 `access-control-allow-origin: *`,canvas 读像素无 CORS 障碍(视频元素需 `crossorigin="anonymous"`)。

## 透明合成

MP4 无 alpha 通道且底色为黑。overlay 页面背景透明时 `mix-blend-mode: screen` 没有底色可混合、黑色会保留,必须用 canvas 逐帧亮度抠黑:`alpha = max(r, g, b)`。实现见 `public/js/overlays/gift-effects.js` 的 `keyOutBlack`。

## 相关实现

- 服务端解析/缓存:`src/bilibili/gift/effect-config.js`
- 事件广播:`src/server.js` 的 `onGiftFlushed` → WS `{ type: 'gift:effect' }`
- Overlay:`/gift-effects`(`public/pages/overlays/gift-effects.html`)
````

`docs/bilibili-live-api/message_stream.md` 中以下行的「待调查」替换:

```markdown
| effect_id | num | 全屏特效 ID,配合 GetEffectConfListV2 解析素材,见 gift-effect-config.md |
| face_effect_id | num | 头衔/表情特效 ID,同上 |
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/gift-effects-overlay.test.js`

Expected: PASS(3 个用例)。

- [ ] **Step 5: 全量验证与提交**

Run: `npm run check && npm test`

Expected: 检查与全量测试通过(新增 2 个测试文件共 11 个用例,无既有用例破坏)。

```bash
git add docs/bilibili-live-api/gift-effect-config.md docs/bilibili-live-api/message_stream.md test/gift-effects-overlay.test.js
git commit -m "docs: document bilibili gift full-screen effect config api"
```

---

## 验证方式(手动)

1. `npm start` 启动,确认日志出现 `[Bilibili][GiftEffect] 特效配置已更新:xxxx 个礼物有全屏特效`。
2. 浏览器打开 `http://localhost:<port>/gift-effects`,页面空白(透明)且 WS 连接成功。
3. 在监听中的直播间发送一个带特效的礼物(如辣条),OBS/浏览器中应出现几秒钟全屏特效动画;连发多个验证叠加与排队上限。
4. OBS 浏览器源添加 `http://localhost:<port>/gift-effects`,确认画面上只显示特效本体、黑底透明。

## 后续可做(本期不做)

- **高频礼物 MP4 预加载**:overlay 维护最近 N 个 `mp4Url` 的 `<video preload="auto">` 池,消除首次播放的下载延迟。
- **SVGA 老礼物**(25 小电视飞船等 6 个):需要 SVGA 播放器或预先转码为 webm,本期保持静态图展示。
- **连击节奏**:当前在礼物落库(连击结束)时播一次;如要与 B 站同步连击过程,需按 `count_map` 的 `effect_id` 分档触发。
