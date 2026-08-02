# Pages 目录

此目录包含所有 HTML 页面文件。

## 📁 目录结构

```
pages/
├── admin.html          # 主应用（管理后台 + 播放界面）
├── gift-audit.html     # 礼物审计页面
├── debug-gifts.html    # 礼物调试页面
└── overlays/          # Overlay 页面（用于 OBS 投屏）
    ├── lyric-window.html    # 桌面歌词窗口
    ├── blindbox.html        # 盲盒盈亏展示
    ├── queue.html           # 点歌队列展示
    └── songs.html           # 可点歌单展示
```

## 🔗 路由映射

服务器路由映射（定义在 `src/server/http-utils.js`）：

| URL 路径      | 文件路径                          | 说明            |
|--------------|----------------------------------|----------------|
| `/`          | `pages/admin.html`               | 首页，重定向到管理后台 |
| `/admin`     | `pages/admin.html`               | 管理后台        |
| `/queue`     | `pages/overlays/queue.html`      | 点歌队列 overlay |
| `/songlist`  | `pages/overlays/songs.html`      | 歌单展示 overlay |
| `/blindbox`  | `pages/overlays/blindbox.html`   | 盲盒盈亏 overlay |
| `/lyrics`    | `pages/overlays/lyric-window.html` | 桌面歌词窗口    |

## 📝 添加新页面

1. 在相应目录下创建 HTML 文件
2. 在 `src/server/http-utils.js` 的 `pageMap` 中添加路由映射
3. 在 HTML 中使用绝对路径引用资源（从 `/` 开始）

示例：
```html
<link rel="stylesheet" href="/css/styles-base.css">
<script src="/js/shared/utils.js"></script>
```
