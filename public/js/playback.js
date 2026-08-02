// 编写人：Aurora
// 播放助手模块 - 主入口（已重构为模块化）
// 此文件现在仅作为兼容层，实际逻辑已拆分到 playback/ 目录
'use strict';

// 导入新的模块化入口
import './playback/index.js';

// 注意：window.AdminApp.playback 已由 playback/index.js 初始化
// 原始 2402 行代码已拆分为以下模块：
//
// playback/index.js           - 主入口文件（26行）
// playback/controller.js      - 主控制器（负责协调所有模块）
// playback/core/              - 核心模块
//   ├── initializer.js        - 初始化逻辑
//   ├── event-handlers.js     - 事件处理
//   └── renderer.js           - 渲染协调
// playback/features/          - 功能模块
//   ├── radio-mode.js         - 电台模式
//   ├── stream-handler.js     - 流媒体处理
//   ├── playback-controls.js  - 播放控制
//   └── queue-operations.js   - 队列操作
// playback/integration/       - 集成模块（桥接逻辑已内联至 index.js）

console.log('[Playback] 模块化重构版本已加载');
