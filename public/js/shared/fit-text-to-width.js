// 文本自适应：按元素可用宽度收缩字号，避免长名称被裁切或溢出。
// 调用方负责提供需要处理的元素集合，DOM 查询与选择器留在各自视图。
export function fitTextToWidth(elements) {
  for (const element of elements) {
    element.style.fontSize = '';
    const availableWidth = element.getBoundingClientRect().width;
    if (!availableWidth) continue;
    const range = document.createRange();
    range.selectNodeContents(element);
    const textWidth = range.getBoundingClientRect().width;
    if (textWidth > availableWidth) {
      const fontSize = parseFloat(getComputedStyle(element).fontSize);
      element.style.fontSize = `${Math.floor(((fontSize * availableWidth) / textWidth) * 10) / 10}px`;
    }
  }
}
