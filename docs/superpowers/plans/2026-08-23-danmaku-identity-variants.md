# 弹幕姬身份视觉分型 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让直播信号带、聊天气泡、极简字幕分别使用独立的五身份视觉，并让画我猜固定采用聊天气泡身份视觉。

**Architecture:** `danmaku-feed.js` 继续作为唯一安全 DOM 渲染器，只在每条消息上输出归一化的 `data-identity`（`viewer|fan|captain|admiral|governor`）。固定弹幕姬由 `body[data-style]` 组合身份选择器实现三套独立视觉；画我猜在自己的 feed 根节点声明 `data-style="bubble"`，由 `games.css` 实现同属气泡语言但适配窄栏的身份效果。

**Tech Stack:** Node.js 24+, Vanilla JavaScript ES modules, native CSS, Electron 43, `node:test`.

## Global Constraints

- 保留现有 `guardLevel`、`medalName`、`medalLevel` 数据契约和 `3=舰长、2=提督、1=总督` 映射。
- 大航海身份优先于粉丝团身份；大航海用户仍可同时显示灯牌徽标。
- 五种身份必须可由 DOM 稳定识别，不用昵称、文案或消息顺序推断。
- 三种固定弹幕姬不得共用一套身份视觉；消息顺序轮换色仍只作为装饰。
- 画我猜始终使用气泡身份视觉，不读取 `danmakuOverlayStyle`。
- 不新增依赖、接口、设置或持久化字段；不覆盖现有并行改动；不创建提交。

---

### Task 1: 输出五身份语义

**Files:**

- Modify: `public/js/overlays/danmaku-feed.js`
- Test: `test/danmaku-overlay.test.js`

**Interfaces:**

- Consumes: `{ guardLevel, medalName }`。
- Produces: 每个 `.draw-danmaku-item` 的 `data-identity="viewer|fan|captain|admiral|governor"`。

- [x] **Step 1: 写五种身份和“大航海优先”失败测试**

```js
feed.render([
  { message: '普通' },
  { message: '粉丝', medalName: '夜航', medalLevel: 8 },
  { message: '舰长', guardLevel: 3 },
  { message: '提督', guardLevel: 2 },
  { message: '总督', guardLevel: 1, medalName: '夜航' },
]);
assert.deepEqual(
  root.children.map((item) => item.dataset.identity),
  ['viewer', 'fan', 'captain', 'admiral', 'governor'],
);
```

- [x] **Step 2: 运行聚焦测试并确认 `dataset.identity` 断言失败**

Run: `node --test test/danmaku-overlay.test.js`

Expected: FAIL because rendered bubbles do not yet expose `data-identity`.

- [x] **Step 3: 添加最小身份归一化函数并写入 bubble dataset**

```js
function identityVariant(guardLevel, medalName) {
  if (Number(guardLevel) === 3) return 'captain';
  if (Number(guardLevel) === 2) return 'admiral';
  if (Number(guardLevel) === 1) return 'governor';
  return String(medalName || '').trim() ? 'fan' : 'viewer';
}
```

- [x] **Step 4: 运行聚焦测试确认通过**

Run: `node --test test/danmaku-overlay.test.js`

Expected: PASS.

### Task 2: 三套弹幕姬独立身份视觉

**Files:**

- Modify: `public/css/overlays/danmaku.css`
- Test: `test/danmaku-overlay.test.js`

**Interfaces:**

- Consumes: `body[data-style]` 与 `.draw-danmaku-item[data-identity]`。
- Produces: signal 的军衔刻度、bubble 的会员胶囊、minimal 的单字符身份签。

- [x] **Step 1: 添加三主题 × 五身份选择器的静态回归断言**

```js
for (const style of ['signal', 'bubble', 'minimal']) {
  for (const identity of ['viewer', 'fan', 'captain', 'admiral', 'governor']) {
    assert.match(
      styles,
      new RegExp(
        `body\\[data-style='${style}'\\][\\s\\S]+data-identity='${identity}'`,
      ),
    );
  }
}
```

- [x] **Step 2: 运行测试并确认缺少身份分型样式**

Run: `node --test test/danmaku-overlay.test.js`

Expected: FAIL on the first missing theme/identity selector.

- [x] **Step 3: 为每个主题实现独立的身份 token、徽标轮廓与高阶身份强调**

```css
body[data-style='signal'] .draw-danmaku-item[data-identity='captain'] {
  --signal-accent: #54c8f3;
  --signal-rank: 'CPT · III';
}
body[data-style='bubble'] .draw-danmaku-item[data-identity='fan'] {
  --bubble-accent: #b7adff;
  --bubble-role: '♥';
}
body[data-style='minimal'] .draw-danmaku-item[data-identity='governor'] {
  --minimal-accent: #f4c567;
  --minimal-role: '总';
}
```

- [x] **Step 4: 运行弹幕姬测试确认通过**

Run: `node --test test/danmaku-overlay.test.js`

Expected: PASS.

### Task 3: 画我猜固定气泡身份视觉

**Files:**

- Modify: `public/pages/overlays/games.html`
- Modify: `public/css/overlays/games.css`
- Modify: `docs/architecture/frontend/overlays.md`
- Test: `test/games-overlay.test.js`

**Interfaces:**

- Consumes: 共享 renderer 输出的 `data-identity`。
- Produces: `#drawDanmakuFeed[data-style='bubble']` 及画猜窄栏专属五身份气泡效果。

- [x] **Step 1: 添加固定气泡标记和五身份 CSS 失败断言**

```js
assert.match(html, /id="drawDanmakuFeed"[^>]+data-style="bubble"/);
for (const identity of ['viewer', 'fan', 'captain', 'admiral', 'governor']) {
  assert.match(
    styles,
    new RegExp(`data-style='bubble'[\\s\\S]+data-identity='${identity}'`),
  );
}
```

- [x] **Step 2: 运行游戏 Overlay 测试确认失败**

Run: `node --test test/games-overlay.test.js`

Expected: FAIL because the draw-guess feed has no explicit bubble style marker.

- [x] **Step 3: 给画猜 feed 添加固定标记，并在 `games.css` 增加窄栏气泡身份样式**

```html
<div
  id="drawDanmakuFeed"
  class="draw-danmaku-feed"
  data-style="bubble"
  role="log"
  aria-live="polite"
></div>
```

- [x] **Step 4: 更新 Overlay 事实文档并运行聚焦与快速门禁**

Run: `node --test test/danmaku-overlay.test.js test/games-overlay.test.js`

Run: `npm run check`

Run: `npm run verify:docs`

Expected: all commands PASS.
