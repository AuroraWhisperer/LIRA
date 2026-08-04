'use strict';

const CATEGORY_SEPARATOR = /[\/／]/;

export function splitCategoryNames(categories) {
  const names = new Set();
  for (const category of categories) {
    const parts = String(category?.name ?? '').split(CATEGORY_SEPARATOR);
    for (const part of parts) {
      const name = part.trim();
      if (name && name !== '默认') names.add(name);
    }
  }
  return Array.from(names).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
}

export function closeFilterMenusOnOutsideClick(event, filters) {
  for (const filter of filters) {
    if (filter.open && !filter.contains(event.target)) {
      filter.open = false;
    }
  }
}

export function readSelectedCategories(root = document) {
  return Array.from(root.querySelectorAll('[data-category-filter]:checked'))
    .map((input) => input.value);
}

export function readSelectedTags(root = document) {
  return Array.from(root.querySelectorAll('[data-tag-filter]:checked'))
    .map((input) => input.value);
}
