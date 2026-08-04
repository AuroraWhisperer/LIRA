# Overlays 目录

此目录包含所有 overlay 页面，用于 OBS 投屏到直播间。

## 📁 文件列表

| 文件 | 说明 | 访问路径 |
|-----|------|---------|
| `lyric-window.html` | 桌面歌词窗口 | `/lyrics` |
| `blindbox.html` | 盲盒盈亏展示 | `/blindbox` |
| `queue.html` | 点歌队列展示 | `/queue` |
| `songs.html` | 可点歌单展示 | `/songlist` |

## 🎨 样式和脚本

所有 overlay 页面遵循统一的资源组织：

- **基础样式**: `/css/styles-base.css`
- **Overlay 通用样式**: `/css/overlays/base.css`
- **特定样式**: `/css/overlays/{name}.css`
- **脚本**: `/js/overlays/{name}.js`

## 📝 添加新 Overlay

1. 在此目录创建 HTML 文件
2. 引用基础样式和 overlay 通用样式
3. 在 `css/overlays/` 创建对应的样式文件（如需要）
4. 在 `js/overlays/` 创建对应的脚本文件
5. 在 `src/server/http-utils.js` 添加路由映射

## 🖼️ OBS 使用方法

1. 在 OBS 中添加"浏览器"源
2. 输入对应的访问路径（如 `http://127.0.0.1:3000/queue`）
3. 设置合适的宽度和高度
4. 启用"当源可见时刷新浏览器"（可选）
