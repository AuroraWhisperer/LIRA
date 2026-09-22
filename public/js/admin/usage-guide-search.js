// 使用文档检索直接索引正文，包含尚未展开的常见问题。
'use strict';

const normalizeText = (text) => text.replace(/\s+/g, ' ').trim();

function buildSearchIndex(panel) {
  return Array.from(panel.querySelectorAll('.usage-guide-section[id]')).flatMap((section) => {
    const sectionTitle = normalizeText(section.querySelector('.usage-guide-section-title').textContent).replace(
      /^\d+\s*/,
      '',
    );
    const targets = [section, ...section.querySelectorAll('article, details, .usage-guide-steps > li')];
    return targets.map((target) => {
      const heading = target === section ? null : target.querySelector('.usage-guide-feature-head strong, strong');
      const title = heading ? normalizeText(heading.textContent) : sectionTitle;
      const body =
        target === section
          ? Array.from(section.children)
              .filter((child) => child.matches('p, h4'))
              .map((child) => child.textContent)
              .join(' ')
          : target.textContent;
      let text = normalizeText(body);
      if (text.startsWith(title)) text = text.slice(title.length).trim();
      return { target, sectionId: section.id, sectionTitle, title, text };
    });
  });
}

function appendHighlightedText(element, text, terms, markClass = '') {
  const lowerText = text.toLowerCase();
  let cursor = 0;
  while (cursor < text.length) {
    const next = terms
      .map((term) => ({ term, index: lowerText.indexOf(term, cursor) }))
      .filter(({ index }) => index >= 0)
      .sort((a, b) => a.index - b.index || b.term.length - a.term.length)[0];
    if (!next) {
      element.append(text.slice(cursor));
      break;
    }
    element.append(text.slice(cursor, next.index));
    const mark = document.createElement('mark');
    if (markClass) mark.className = markClass;
    mark.textContent = text.slice(next.index, next.index + next.term.length);
    element.append(mark);
    cursor = next.index + next.term.length;
  }
}

export function initUsageGuideSearch(panel, navigateToTarget) {
  const input = panel.querySelector('#usageGuideSearchInput');
  if (!input) return;
  const results = panel.querySelector('.usage-guide-search-results');
  const status = panel.querySelector('.usage-guide-search-status');
  const list = panel.querySelector('.usage-guide-search-list');
  const clearButton = panel.querySelector('.usage-guide-search-clear');
  let entries;
  let highlightedTarget;

  function clearTargetHighlight() {
    if (!highlightedTarget) return;
    highlightedTarget.querySelectorAll('.usage-guide-search-match').forEach((mark) => {
      mark.replaceWith(...mark.childNodes);
    });
    highlightedTarget.normalize();
    highlightedTarget = null;
  }

  function highlightTarget(target, terms) {
    clearTargetHighlight();
    const walker = document.createTreeWalker(target, window.NodeFilter.SHOW_TEXT);
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);
    for (const node of textNodes) {
      if (!terms.some((term) => node.textContent.toLowerCase().includes(term))) continue;
      const fragment = document.createDocumentFragment();
      appendHighlightedText(fragment, node.textContent, terms, 'usage-guide-search-match');
      node.replaceWith(fragment);
    }
    highlightedTarget = target;
    return target.querySelectorAll('.usage-guide-search-match');
  }

  function updateResults() {
    clearTargetHighlight();
    const query = normalizeText(input.value).toLowerCase();
    clearButton.hidden = !input.value;
    results.hidden = !query;
    list.replaceChildren();
    if (!query) {
      status.textContent = '';
      return;
    }
    entries ??= buildSearchIndex(panel);
    const terms = [...new Set(query.split(' '))];
    const matches = entries
      .filter((entry) => {
        const text = `${entry.sectionTitle} ${entry.title} ${entry.text}`.toLowerCase();
        return terms.every((term) => text.includes(term));
      })
      .sort((a, b) => {
        const score = (entry) =>
          terms.reduce((total, term) => total + (entry.title.toLowerCase().includes(term) ? 1 : 0), 0);
        return score(b) - score(a);
      });
    status.textContent = matches.length
      ? `找到 ${matches.length} 处相关内容，点击查看原文`
      : '没有找到相关内容，试试更短的关键词，例如“点歌”或“登录”。';
    for (const entry of matches) {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'usage-guide-search-result';
      const heading = document.createElement('span');
      heading.className = 'usage-guide-search-result-heading';
      const title = document.createElement('strong');
      appendHighlightedText(title, entry.title, terms);
      heading.append(title);
      if (entry.title !== entry.sectionTitle) {
        const section = document.createElement('span');
        section.className = 'usage-guide-search-section';
        section.textContent = entry.sectionTitle;
        heading.append(section);
      }
      button.append(heading);
      if (entry.text) {
        const snippet = document.createElement('span');
        snippet.className = 'usage-guide-search-snippet';
        const positions = terms.map((term) => entry.text.toLowerCase().indexOf(term)).filter((index) => index >= 0);
        const start = Math.max(0, (positions.length ? Math.min(...positions) : 0) - 24);
        const excerpt = `${start ? '…' : ''}${entry.text.slice(start, start + 100)}${entry.text.length > start + 100 ? '…' : ''}`;
        appendHighlightedText(snippet, excerpt, terms);
        button.append(snippet);
      }
      button.addEventListener('click', () => {
        if (entry.target.matches('details')) entry.target.open = true;
        const highlights = highlightTarget(entry.target, terms);
        navigateToTarget(entry.target, entry.sectionId, true, () => {
          highlights.forEach((mark) => mark.classList.add('is-locating'));
        });
      });
      item.append(button);
      list.append(item);
    }
    list.scrollTop = 0;
  }

  input.addEventListener('input', (event) => {
    if (!event.isComposing) updateResults();
  });
  input.addEventListener('compositionend', updateResults);
  function clearSearch() {
    input.value = '';
    updateResults();
    input.focus();
  }
  clearButton.addEventListener('click', clearSearch);
  input.addEventListener('keydown', (event) => {
    if (event.isComposing) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      clearSearch();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      list.querySelector('button')?.click();
    }
  });
}
