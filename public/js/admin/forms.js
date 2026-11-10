// 编写人：Aurora
// 表单工具和通用组件
('use strict');

import { value, setValue, normalizeRangeValue } from '../shared/utils.js';
import { initParameterRanges } from '../shared/parameter-range.js';

/**
 * 表单服务
 * 负责表单相关的工具函数和UI控制
 */
export class FormsService {
  /**
   * 绑定 range 输入和 number 输入的双向同步，可选换算数值框的显示倍率
   */
  bindRangePair(rangeId, numberId, min, max, fallback, displayScale = 1) {
    document.getElementById(rangeId).addEventListener('input', () => {
      const rangeValue = value(rangeId);
      const displayValue =
        displayScale === 1 ? rangeValue : String(Number((Number(rangeValue) * displayScale).toFixed(6)));
      setValue(numberId, displayValue);
    });
    document.getElementById(numberId).addEventListener('input', () => {
      setValue(rangeId, normalizeRangeValue(Number(value(numberId)) / displayScale, min, max, fallback));
      this.refreshParameterRanges(document.getElementById(rangeId));
    });
  }

  refreshParameterRanges(root = document) {
    return initParameterRanges(root);
  }

  /**
   * 初始化选项卡
   */
  initTabs() {
    document.querySelectorAll('.tabs[role="tablist"]').forEach((tablist) => {
      const tabs = [...tablist.querySelectorAll('.tab')];
      const select = (selected) => {
        for (const tab of tabs) {
          const active = tab === selected;
          tab.classList.toggle('active', active);
          tab.setAttribute('aria-selected', String(active));
          tab.tabIndex = active ? 0 : -1;
          const panel = document.getElementById(tab.dataset.tab);
          panel.classList.toggle('active', active);
          panel.hidden = !active;
        }
      };
      tabs.forEach((tab, index) => {
        const panel = document.getElementById(tab.dataset.tab);
        tab.id ||= `${tab.dataset.tab}Tab`;
        tab.setAttribute('role', 'tab');
        tab.setAttribute('aria-controls', panel.id);
        panel.setAttribute('role', 'tabpanel');
        panel.setAttribute('aria-labelledby', tab.id);
        tab.addEventListener('click', () => select(tab));
        tab.addEventListener('keydown', (event) => {
          let next;
          if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
          else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
          else if (event.key === 'Home') next = 0;
          else if (event.key === 'End') next = tabs.length - 1;
          else return;
          event.preventDefault();
          select(tabs[next]);
          tabs[next].focus();
        });
      });
      select(tabs.find((tab) => tab.classList.contains('active')) || tabs[0]);
    });
  }
}

// 创建单例实例
export const formsService = new FormsService();
