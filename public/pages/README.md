# Pages 目录

此目录包含所有 HTML 页面文件。

## 📁 目录结构

```
pages/
├── admin/              # 主应用片段，由服务端按固定顺序组合
│   ├── song/           # 点歌工作区与设置页签
│   ├── gifts/          # 礼物助手及二级视图
│   ├── toolbox/        # 百宝箱壳层与独立功能
│   ├── playback/       # 播放页与播放弹层
│   └── shared/         # 全局确认弹窗
├── gift-audit.html     # 礼物审计页面
├── debug-gifts.html    # 礼物调试页面
└── overlays/          # Overlay 页面（用于 OBS 投屏）
    ├── lyric-window.html    # 桌面歌词浏览器源
    ├── blindbox.html        # 盲盒盈亏展示
    ├── queue.html           # 点歌队列展示
    └── songs.html           # 可点歌单展示
```

## 🔗 路由映射

服务器路由映射（定义在 `src/server/http-utils.js`）：

| URL 路径      | 文件路径                          | 说明            |
|--------------|----------------------------------|----------------|
| `/`          | `pages/admin/**` 固定组合         | 管理后台首页     |
| `/admin`     | `pages/admin/**` 固定组合         | 管理后台        |
| `/settings`  | `pages/admin/**` 固定组合         | 管理后台设置页入口 |
| `/songs`     | `pages/admin/**` 固定组合         | 管理后台歌库页入口 |
| `/queue`     | `pages/overlays/queue.html`      | 点歌队列 overlay |
| `/songlist`  | `pages/overlays/songs.html`      | 歌单展示 overlay |
| `/blindbox`  | `pages/overlays/blindbox.html`   | 盲盒盈亏 overlay |
| `/lyrics`    | `pages/overlays/lyric-window.html` | 桌面歌词浏览器源 |

## 📝 添加新页面

1. 在相应目录下创建 HTML 文件
2. 普通页面在 `src/server/http-utils.js` 的 `pageMap` 中添加路由；管理后台片段在 `src/server/admin-page.js` 的固定清单中登记
3. 在 HTML 中使用绝对路径引用资源（从 `/` 开始）

示例：
```html
<link rel="stylesheet" href="/css/styles-base.css">
<script type="module" src="/js/admin/index.js"></script>
```
