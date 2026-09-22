'use strict';

// 截图镜头清单：每项对应方案 6.3 的一个编号。
// type: 'admin'（管理页，需 token）| 'overlay'（投屏页，免登录）| 'license'（登录窗，桥桩驱动）
// 通用字段：
//   viewport  视口宽高（deviceScaleFactor 固定 1，方案 6.1 要求与图片真实宽高一致）
//   waitFor   数据就绪选择器；settleMs 额外等待
//   setup     async (page) => {} 进入目标状态（切页签、开弹窗…）
//   annotations [{ selector, label, all? }] 统一标注（细边框 + 序号圆圈）
//   covers    [{ selector, mode: 'text'|'blur'|'hide', text? }] 脱敏遮盖
//   clip      { selector } 元素截图；缺省整视口
//   skip      非空则跳过（原因写入产出清单）

const path = require('node:path');

const OUT_ROOT = path.resolve(__dirname, '../../screenshots/usage-guide');
const DATA_DIR = path.join(OUT_ROOT, 'data');

const SHOTS = [
  // ── Phase 0 样张 ──
  {
    id: 'A1',
    group: 'A',
    file: 'client-login-window',
    title: '登录窗口整屏（注册模式）',
    type: 'license',
    viewport: { width: 1280, height: 800 },
    license: { state: { state: 'needs_activation' } },
    waitFor: '#licenseForm',
    annotations: [
      { selector: '#licenseAccountName', label: 1 },
      { selector: '#licensePassword', label: 2 },
      { selector: '#licenseActivationCode', label: 3 },
      { selector: '#licenseSubmitBtn', label: 4 },
    ],
  },
  {
    id: 'B1',
    group: 'B',
    file: 'song-queue-overview',
    title: '点歌页整页',
    type: 'admin',
    viewport: { width: 1440, height: 900 },
    waitFor: '#queueList',
    settleMs: 600,
  },
  {
    id: 'C6',
    group: 'C',
    file: 'playback-queue-drawer',
    title: '播放队列弹窗',
    type: 'admin',
    viewport: { width: 1440, height: 900 },
    mainPage: 'playbackAssistantPage',
    waitFor: '#playbackQueueBtn',
    settleMs: 400,
    setup: async (page) => {
      // 播放器底栏在页内布局可能超出视口，用 JS 点击绕过
      await page.evaluate(() =>
        document.getElementById('playbackQueueBtn')?.click(),
      );
      await page.waitForSelector('#queuePopup.open', { timeout: 5000 });
    },
    annotations: [
      { selector: '#playbackImportSongQueue', label: 1 },
      { selector: '#playbackClearQueue', label: 2 },
      { selector: '#playbackQueueList', label: 3 },
    ],
  },
  {
    id: 'D1',
    group: 'D',
    file: 'gift-page-overview',
    title: '礼物页整页',
    type: 'admin',
    viewport: { width: 1440, height: 900 },
    mainPage: 'giftAssistantPage',
    waitFor: '#giftRecentList .gift-card',
    settleMs: 600,
  },
  {
    id: 'E1',
    group: 'E',
    file: 'toolbox-nav',
    title: '百宝箱左侧导航',
    type: 'admin',
    viewport: { width: 1440, height: 900 },
    mainPage: 'otherAssistantPage',
    waitFor: '[data-other-feature]',
    settleMs: 400,
  },
  {
    id: 'OV-WISH',
    group: 'F',
    file: 'gift-wishes-overlay',
    title: '礼物许愿投屏画面（overlay 样张，默认长效周期）',
    type: 'overlay',
    route: '/gift-wishes',
    viewport: { width: 440, height: 340 },
    settleMs: 800,
  },

  // ── 暂缓：需要真实数据/真实账号（等用户最终决定，见方案附录 D）──
  {
    id: 'E8',
    group: 'E',
    file: 'dynamic-lottery-setup',
    title: '动态抽奖设置',
    skip: '获取参与名单依赖 B 站真实动态，合成数据无法代替',
  },
  {
    id: 'E9',
    group: 'E',
    file: 'dynamic-lottery-progress',
    title: '名单获取进度 / 开奖',
    skip: '同上，依赖 B 站真实动态',
  },
  {
    id: 'E2',
    group: 'E',
    file: 'danmaku-connection',
    title: '弹幕姬连接状态（已连接）',
    skip: '已连接状态需要真实 B 站直播账号',
  },
  {
    id: 'C1',
    group: 'C',
    file: 'playback-platform-tabs',
    title: '音乐平台已登录态',
    skip: 'QQ 音乐/网易云已登录态需要真实扫码',
  },
  {
    id: 'F5',
    group: 'F',
    file: 'public-overlay-danmaku',
    title: '弹幕姬投屏效果',
    skip: '服务器侧功能，本地独立模式无弹幕流；可用合成事件注入再议',
  },
];

module.exports = { SHOTS, OUT_ROOT, DATA_DIR };
