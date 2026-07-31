// 编写人：Aurora
// 播放状态管理器
'use strict';

/**
 * 创建初始播放状态
 * @returns {Object} 初始状态对象
 */
export function createInitialState() {
  return {
    current: null,
    currentOrigin: '',
    requestedQueue: [],
    normalQueue: [],
    normalQueueTracks: [],  // 完整歌单备份，用于循环重播
    radioQueue: [],
    queueType: 'queue',
    queueTitle: '播放队列',
    playlistIndex: -1,
    pendingRequests: [],
    history: [],
    displayHistory: [],
    mode: 'sequence',
    volume: 0.75,
    selectedSource: 'qq',
    shuffleOrder: [],
    shuffleCursor: 0,
    restoredTime: 0
  };
}

/**
 * 验证状态对象
 * @param {Object} state - 待验证的状态
 * @returns {boolean} 是否有效
 */
export function validateState(state) {
  if (!state || typeof state !== 'object') return false;

  // 验证必需字段
  const requiredFields = ['mode', 'volume', 'selectedSource'];
  for (const field of requiredFields) {
    if (!(field in state)) return false;
  }

  // 验证数组字段
  const arrayFields = ['requestedQueue', 'normalQueue', 'radioQueue', 'pendingRequests', 'history', 'displayHistory', 'shuffleOrder'];
  for (const field of arrayFields) {
    if (field in state && !Array.isArray(state[field])) return false;
  }

  // 验证播放模式
  const validModes = ['sequence', 'loop', 'single', 'shuffle'];
  if (!validModes.includes(state.mode)) return false;

  // 验证音量范围
  if (typeof state.volume !== 'number' || state.volume < 0 || state.volume > 1) return false;

  // 验证音乐源
  const validSources = ['qq', 'netease'];
  if (!validSources.includes(state.selectedSource)) return false;

  return true;
}

/**
 * 规范化状态对象（填充缺失字段）
 * @param {Object} state - 待规范化的状态
 * @returns {Object} 规范化后的状态
 */
export function normalizeState(state) {
  const initial = createInitialState();
  const normalized = { ...initial };

  if (!state || typeof state !== 'object') return normalized;

  // 合并状态
  Object.keys(initial).forEach((key) => {
    if (key in state) {
      normalized[key] = state[key];
    }
  });

  // 确保数组字段
  const arrayFields = ['requestedQueue', 'normalQueue', 'normalQueueTracks', 'radioQueue', 'pendingRequests', 'history', 'displayHistory', 'shuffleOrder'];
  arrayFields.forEach((field) => {
    if (!Array.isArray(normalized[field])) {
      normalized[field] = [];
    }
  });

  // 确保音量在合法范围
  if (typeof normalized.volume !== 'number' || normalized.volume < 0 || normalized.volume > 1) {
    normalized.volume = 0.75;
  }

  // 确保播放模式合法
  const validModes = ['sequence', 'loop', 'single', 'shuffle'];
  if (!validModes.includes(normalized.mode)) {
    normalized.mode = 'sequence';
  }

  // 确保音乐源合法
  const validSources = ['qq', 'netease'];
  if (!validSources.includes(normalized.selectedSource)) {
    normalized.selectedSource = 'qq';
  }

  // 确保 queueType 合法
  const validQueueTypes = ['queue', 'playlist', 'radio'];
  if (!validQueueTypes.includes(normalized.queueType)) {
    normalized.queueType = 'queue';
  }

  // 确保 playlistIndex 是数字
  if (typeof normalized.playlistIndex !== 'number') {
    normalized.playlistIndex = -1;
  }

  // 确保 shuffleCursor 是数字
  if (typeof normalized.shuffleCursor !== 'number') {
    normalized.shuffleCursor = 0;
  }

  // 确保 restoredTime 是数字
  if (typeof normalized.restoredTime !== 'number' || !Number.isFinite(normalized.restoredTime)) {
    normalized.restoredTime = 0;
  }

  return normalized;
}

/**
 * 深拷贝状态对象
 * @param {Object} state - 源状态
 * @returns {Object} 拷贝后的状态
 */
export function cloneState(state) {
  return JSON.parse(JSON.stringify(state));
}

/**
 * 状态管理器类
 */
export class StateManager {
  constructor() {
    this.state = createInitialState();
    this.listeners = [];
  }

  /**
   * 获取当前状态
   * @returns {Object}
   */
  getState() {
    return this.state;
  }

  /**
   * 设置状态
   * @param {Object} newState - 新状态
   * @param {boolean} notify - 是否通知监听器
   */
  setState(newState, notify = true) {
    this.state = normalizeState(newState);
    if (notify) {
      this.notifyListeners();
    }
  }

  /**
   * 更新部分状态
   * @param {Object} updates - 要更新的字段
   * @param {boolean} notify - 是否通知监听器
   */
  updateState(updates, notify = true) {
    this.state = { ...this.state, ...updates };
    if (notify) {
      this.notifyListeners();
    }
  }

  /**
   * 重置状态
   */
  resetState() {
    this.state = createInitialState();
    this.notifyListeners();
  }

  /**
   * 添加状态变化监听器
   * @param {Function} listener - 监听函数
   * @returns {Function} 取消监听的函数
   */
  subscribe(listener) {
    if (typeof listener !== 'function') return () => {};
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index > -1) {
        this.listeners.splice(index, 1);
      }
    };
  }

  /**
   * 通知所有监听器
   */
  notifyListeners() {
    this.listeners.forEach((listener) => {
      try {
        listener(this.state);
      } catch (error) {
        console.error('[StateManager] Listener error:', error);
      }
    });
  }
}
