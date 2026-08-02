# 礼物管理模块

本目录包含礼物管理功能的各个子模块，已从原 `gifts.js`（677 行）拆分而来。

## 模块结构

```
public/js/admin/gifts/
├── index.js            (101 行) - 主入口，统一导出和兼容层
├── notification.js     (110 行) - 礼物通知 toast 显示
├── detection.js        (71 行)  - 礼物检测状态管理
├── sprint.js           (25 行)  - 月底冲刺统计
├── recent.js           (114 行) - 最近礼物列表渲染
├── blindbox.js         (231 行) - 盲盒映射配置和统计
└── history.js          (280 行) - 礼物流水抽屉和历史查询
```

总计：932 行（包含注释和空行）

## 模块说明

### index.js
- 主入口文件
- 提供 `renderGiftPanel` 统一渲染函数
- 提供向后兼容的 API 接口
- 检查子模块加载状态

### notification.js
- 礼物到账通知功能
- `notifyNewGift()` - 检测并显示新礼物 toast
- 支持不同礼物类型的样式变体（大航海、盲盒、高价值礼物等）

### detection.js
- 礼物检测开关和状态显示
- `renderDetectionStatus()` - 渲染检测状态指示器
- `renderGiftStatusLine()` - 渲染诊断统计信息

### sprint.js
- 月底冲刺目标管理
- `renderSprintStats()` - 渲染冲刺统计数据（目标、已收、还差、水晶球）

### recent.js
- 最近礼物列表渲染
- `renderGiftRecentList()` - 渲染最近礼物卡片
- `getGuardBadge()` - 获取大航海徽章信息
- `getBlindBoxIcon()` - 获取盲盒图标信息

### blindbox.js
- 盲盒映射配置管理
- `renderBlindBoxList()` - 渲染盲盒映射配置列表
- `loadBlindBoxStats()` - 加载今日盲盒统计
- `renderBlindBoxStats()` - 渲染盲盒盈亏统计
- `initBlindBoxStatsToggle()` - 初始化折叠面板

### history.js
- 礼物历史抽屉
- `initGiftHistoryDrawer()` - 初始化抽屉事件监听
- `loadGiftHistory()` - 加载礼物流水数据（分页、排序）
- `renderGiftHistory()` - 渲染礼物历史列表
- 支持清理显示和清空数据库操作

## 使用方式

所有功能通过 `window.AdminApp.gifts` 命名空间访问：

```javascript
// 主渲染函数
window.AdminApp.gifts.renderGiftPanel(gifts, sprint, live, diagnostics, settings);

// 访问子模块
window.AdminApp.gifts.notification.notifyNewGift(items);
window.AdminApp.gifts.recent.renderGiftRecentList(items);
window.AdminApp.gifts.blindbox.loadBlindBoxStats();
window.AdminApp.gifts.history.initGiftHistoryDrawer();
```

## 加载顺序

在 HTML 中按以下顺序加载（依赖关系）：

1. `notification.js` - 无依赖
2. `detection.js` - 无依赖
3. `sprint.js` - 无依赖
4. `recent.js` - 无依赖（提供工具函数）
5. `blindbox.js` - 依赖 `recent.js` 的工具函数
6. `history.js` - 依赖 `recent.js` 的工具函数
7. `index.js` - 统一入口，依赖所有子模块

## 向后兼容

`index.js` 提供了完整的向后兼容层，原有代码无需修改即可使用：

```javascript
// 这些调用方式仍然有效
window.AdminApp.gifts.renderGiftPanel(...);
window.AdminApp.gifts.notifyNewGift(...);
window.AdminApp.gifts.loadBlindBoxStats(...);
```
