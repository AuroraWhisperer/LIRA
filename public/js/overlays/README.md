# JS Overlays 目录

此目录包含所有 overlay 页面的脚本文件。

## 📁 文件列表

| 文件 | 说明 | 对应页面 |
|-----|------|---------|
| `lyric-window.js` | 桌面歌词窗口逻辑 | `/lyrics` |
| `blindbox.js` | 盲盒盈亏展示逻辑 | `/blindbox` |
| `queue.js` | 点歌队列展示逻辑 | `/queue` |
| `songs.js` | 可点歌单展示逻辑 | `/songlist` |
| `overlay-utils.js` | Overlay 页面共享的格式化与滚动工具 | 多个 Overlay 页面 |

## 🔌 功能说明

### lyric-window.js
- 接收来自主应用的歌词数据
- 实时更新当前歌词行
- 支持翻译显示

### blindbox.js
- 连接 WebSocket 接收盲盒数据
- 展示今日盈亏汇总
- 维护欧皇榜排行

### queue.js
- 连接 WebSocket 接收队列更新
- 展示当前点歌队列
- 实时更新队列状态

### songs.js
- 获取可点歌单列表
- 自动滚动展示
- 支持暂停/继续滚动

## 📝 添加新 Overlay 脚本

1. 在此目录创建 `{name}.js`
2. 实现必要的功能逻辑
3. 在对应的 HTML 中引用：
   ```html
   <script src="/js/overlays/{name}.js"></script>
   ```

## 🔗 通用工具

非模块 Overlay 脚本如需使用共享工具函数，应先加载本目录的兼容层：
```html
<script src="/js/overlays/overlay-utils.js"></script>
<script src="/js/overlays/{name}.js"></script>
```

`public/js/shared/utils.js` 是 ESM，不能通过普通 `<script>` 标签加载；模块页面应改用 `type="module"` 或在模块入口中 `import`。

## 🔗 相关目录

- HTML 页面: `public/pages/overlays/`
- CSS 样式: `public/css/overlays/`
- 共享工具: `public/js/shared/`
