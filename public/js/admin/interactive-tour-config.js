'use strict';

/**
 * Static configuration and first-run state for the interactive tour.
 *
 * Keeping the step catalogue separate from the controller makes the runtime
 * orchestration easier to inspect without changing the public tour exports.
 */

export const TOUR_CONFIG_VERSION = 6;
export const TOUR_CONFIG_COMPLETION_CHECK_INTERVAL_MS = 1500;
export const TOUR_CONFIG_FIRST_RUN_SHOWN_KEY = 'liraTourFirstRunShown';
const TOUR_CONFIG_COMPLETED_KEY = 'liraTourCompleted';

export function claimFirstRunTourFromStorage(storage) {
  if (
    storage.getItem(TOUR_CONFIG_FIRST_RUN_SHOWN_KEY) !== null ||
    storage.getItem(TOUR_CONFIG_COMPLETED_KEY) !== null
  ) {
    return false;
  }
  storage.setItem(TOUR_CONFIG_FIRST_RUN_SHOWN_KEY, '1');
  return true;
}

// 引导步骤定义
export const TOUR_CONFIG_STEPS = [
  {
    id: 'welcome',
    title: '欢迎使用 LIRA',
    kicker: '第 0 步 · 认识 LIRA',
    content:
      'LIRA 的全称是 <strong>Live Interactive Request Assistant</strong>，中文可以理解为「直播互动点歌助手」。首次使用请先在桌面端完成「登录 LIRA」设备授权；进入管理页后，只要跟着提示依次认识主要功能、登录 Bilibili、填写直播间、导入歌单和选择音乐平台。<br><strong>页面会自动跳到要操作的位置</strong>，看到高亮区域后照着做即可。',
    targetPage: null, // 不切换页面
    targetSelector: null, // 不高亮元素
    position: 'center', // 居中显示
    waitForAction: false, // 不等待操作，直接下一步
  },
  {
    id: 'main-navigation',
    title: '先认识顶部四个按钮',
    kicker: '第 1 步 · 认识主功能',
    content:
      '<strong>点歌</strong>用来管理歌库和点歌队列；<strong>播放</strong>用来选择平台并控制音乐；<strong>礼物</strong>用来查看礼物数据和提示；<strong>百宝箱</strong>放着弹幕姬、加班机、使用文档等辅助工具。',
    note: '之后想切换功能，随时点击顶部对应的按钮即可。',
    targetPage: 'songAssistantPage',
    targetTab: null,
    targetSelector: '.main-page-tabs',
    position: 'bottom',
    waitForAction: false,
  },
  {
    id: 'bilibili-login',
    title: '登录你的 Bilibili 账号',
    kicker: '第 2 步 · 登录账号',
    content:
      '点击高亮区域里的<strong>「扫码登录 Bilibili」</strong>，再用手机 Bilibili 扫描弹出的二维码。登录成功后，LIRA 才能稳定收到你直播间里的弹幕和礼物。',
    note: '二维码会在新窗口中打开；请在这台电脑上的 LIRA 桌面版完成。',
    targetPage: 'songAssistantPage', // 切换到点歌页
    targetTab: '[data-tab="settingsPage"]', // 切换到设置子标签
    targetSelector: '.bilibili-auth-row', // 高亮账号登录状态行
    position: 'bottom',
    waitForAction: true, // 等待用户登录
    checkCompleted: async () => {
      if (!window.bilibiliAuth?.getAuthState) return false;
      try {
        const state = await window.bilibiliAuth.getAuthState();
        return Boolean(state.loggedIn);
      } catch {
        return false;
      }
    },
  },
  {
    id: 'room-id',
    title: '填写你的直播间',
    kicker: '第 3 步 · 填写直播间',
    content:
      '点击高亮的输入框，填写你正在直播的房间号；也可以直接粘贴直播间网址。填好后，这一步会自动显示为已完成。',
    note: '例如：房间号「123456」，或网址「https://live.bilibili.com/123456」。',
    targetPage: 'songAssistantPage',
    targetTab: '[data-tab="settingsPage"]',
    targetSelector: '#roomId',
    position: 'bottom',
    waitForAction: true,
    checkCompleted: () => {
      const input = document.getElementById('roomId');
      return input && input.value.trim().length > 0;
    },
  },
  {
    id: 'refresh-live',
    title: '让 LIRA 连接直播间',
    kicker: '第 4 步 · 刷新连接',
    content:
      '页面右上角一起框选的是<strong>直播间状态</strong>和<strong>「刷新直播」</strong>按钮。点击「刷新直播」，看到左边的直播间状态变为绿色，说明 LIRA 已经连上你的直播间。',
    note: '如果没有变绿，请先检查上一步的房间号，再点击一次「刷新直播」。',
    targetPage: 'songAssistantPage',
    targetTab: null,
    targetSelector: '#liveStatus, #reconnectBtn',
    position: 'bottom',
    waitForAction: true,
    checkCompleted: () => {
      // 检查直播状态是否已连接
      const liveStatus = document.getElementById('liveStatus');
      return liveStatus && !liveStatus.classList.contains('warn');
    },
  },
  {
    id: 'import-songs',
    title: '把歌单导入 LIRA',
    kicker: '第 5 步 · 导入歌单',
    content:
      '现在已打开「导入导出」。把你准备好的歌单选进来：可以选择 Excel（.xlsx）、CSV 或 TSV 文件，也可以把表格内容粘贴到下方，然后点击<strong>「导入歌库」</strong>。',
    note: '暂时没有歌单也没关系，可以先点「下一步」，以后再从「点歌 → 导入导出」回来添加。',
    targetPage: 'songAssistantPage',
    targetTab: '[data-tab="importPage"]',
    targetSelector: '#importFile',
    position: 'top',
    waitForAction: false,
  },
  {
    id: 'music-platform',
    title: '选择平时听歌的平台',
    kicker: '第 6 步 · 选择音乐',
    content:
      '现在已打开「播放」页。先在左上方选择你平时使用的平台：QQ音乐、网易云音乐或全民 K 歌。使用 QQ音乐或网易云音乐时，点击右上方的「登录」；使用全民 K 歌时，请先在全民 K 歌客户端登录。',
    note: '这一步只告诉你登录入口，不要求现在登录；选好后可以继续。',
    targetPage: 'playbackAssistantPage',
    targetTab: null,
    targetSelector: '.source-tabs',
    position: 'bottom',
    waitForAction: false, // 只是告知，不强制等待
  },
  {
    id: 'usage-guide',
    title: '不会用时，从这里找帮助',
    kicker: '第 7 步 · 查看帮助',
    content:
      '这里是「百宝箱 → 使用文档」。以后忘记怎么登录、导入歌单或设置其他功能，就点击左侧的<strong>「使用文档」</strong>，再按目录查找。',
    note: '使用文档顶部还有「重新打开交互式引导」按钮，随时可以从头再看一遍。',
    targetPage: 'otherAssistantPage',
    targetTab: '[data-other-feature="otherUsageGuideFeature"]',
    targetSelector: '[data-other-feature="otherUsageGuideFeature"]',
    position: 'right',
    waitForAction: false,
  },
  {
    id: 'complete',
    title: '新手引导已完成',
    kicker: '可以开始使用了',
    content:
      '你已经看完最常用的设置。现在可以开始接收点歌、播放音乐和查看礼物。<br><br>还有功能不会用时，打开「百宝箱 → 使用文档」即可。',
    targetPage: null,
    targetTab: null,
    targetSelector: null,
    position: 'center',
    waitForAction: false,
  },
];
