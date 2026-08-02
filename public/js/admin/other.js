// 编写人：Aurora
// 其他功能模块 — 预留扩展入口，当前内容待定
// 设计原则：低耦合，仅通过 window.AdminApp 公共接口与主应用通信
'use strict';

(function () {
  // ---- 模块私有引用 ----
  // 从 AdminApp.utils 获取共享工具函数（不直接依赖任何其他 admin 子模块）
  const utils = window.AdminApp && window.AdminApp.utils ? window.AdminApp.utils : {};
  const { toast, api } = utils;

  /**
   * 模块状态 — 所有可变状态集中管理，方便后续扩展
   * @type {{ initialized: boolean }}
   */
  const moduleState = {
    initialized: false
  };

  /**
   * 初始化「其他」页面
   * 职责：绑定 DOM 事件、加载页面数据
   * 调用时机：app.js 的 initApp() 中按需调用
   */
  function initOtherPage() {
    if (moduleState.initialized) {
      // 防止重复初始化
      return;
    }
    moduleState.initialized = true;

    // ---- 绑定页面事件 ----
    bindPageEvents();

    // ---- 加载页面初始数据 ----
    loadOtherData();

    console.log('[other-page] 其他页面初始化完成');
  }

  /**
   * 绑定「其他」页面内所有 DOM 事件
   * 注意：此函数仅处理 otherAssistantPage 内部的元素，不影响其他页面
   */
  function bindPageEvents() {
    // 预留：后续添加功能时在此处绑定事件
    // 示例：
    // const someBtn = document.getElementById('otherSomeButton');
    // if (someBtn) {
    //   someBtn.addEventListener('click', handleSomeAction);
    // }
  }

  /**
   * 加载「其他」页面数据
   * 预留：后续添加功能时在此处发起 API 请求
   */
  async function loadOtherData() {
    // 预留：后续添加数据加载逻辑
    // 示例：
    // try {
    //   const response = await api('/api/other-data');
    //   // 渲染数据…
    // } catch (error) {
    //   console.warn('[other-page] 数据加载失败:', error);
    // }
  }

  // ---- 导出到全局命名空间 ----
  // 遵循项目约定，挂载到 window.AdminApp.other
  if (typeof window !== 'undefined') {
    window.AdminApp = window.AdminApp || {};
    window.AdminApp.other = {
      initOtherPage
    };
  }
})();
