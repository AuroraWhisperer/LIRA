// Reading position shares the directory's scroll marker and navigation callback.
export function initUsageGuideProgress(panel, sections, navigate, reduceMotionQuery) {
  const progress = panel.querySelector('.usage-guide-reading-track');
  if (!progress) return () => {};
  const fill = panel.querySelector('.usage-guide-reading-fill');
  const location = panel.querySelector('.usage-guide-toc-location');
  const detail = panel.querySelector('.usage-guide-toc-detail');
  const percent = panel.querySelector('.usage-guide-reading-percent');
  const remaining = panel.querySelector('.usage-guide-reading-remaining');
  const previous = panel.querySelector('.usage-guide-chapter-prev');
  const next = panel.querySelector('.usage-guide-chapter-next');
  const nextLabel = panel.querySelector('.usage-guide-chapter-label');
  const nextTitle = panel.querySelector('.usage-guide-chapter-title');
  const chapterLinks = Array.from(panel.querySelectorAll('.usage-guide-toc-links a'));
  const chapters = sections.map((section) => ({
    section,
    title: chapterLinks.find((link) => link.hash === `#${section.id}`).textContent.trim(),
    headings: Array.from(section.querySelectorAll('h4, .usage-guide-feature-head strong, .usage-guide-faq > summary')),
  }));
  let currentIndex = 0;
  let lastSection = null;
  let lastHeading = null;
  let lastPercent = -1;
  let titleAnimation;

  function goToChapter(index) {
    const { section } = chapters[index];
    navigate(section, section.id, true);
  }
  previous.addEventListener('click', () => goToChapter(currentIndex - 1));
  next.addEventListener('click', () => goToChapter(currentIndex + 1));

  return function updateReadingPosition(section, marker, atBottom) {
    currentIndex = sections.indexOf(section);
    const chapter = chapters[currentIndex];
    const following = chapters[currentIndex + 1];
    const preceding = chapters[currentIndex - 1];
    const rect = section.getBoundingClientRect();
    const end = following ? following.section.getBoundingClientRect().top : rect.bottom;
    // The last chapter reaches 100% at the actual scroll end, even on a short page.
    const value = atBottom ? 100 : Math.min(99, Math.max(0, Math.floor(
      ((marker - rect.top) / Math.max(1, end - rect.top)) * 100,
    )));
    let heading = null;
    for (const candidate of chapter.headings) {
      if (!candidate.getClientRects().length) continue;
      if (candidate.getBoundingClientRect().top > marker) break;
      heading = candidate;
    }
    const chapterChanged = section !== lastSection;
    if (chapterChanged) {
      previous.disabled = !preceding;
      previous.title = preceding ? `上一章：${preceding.title}` : '已是第一章';
      previous.setAttribute('aria-label', previous.title);
      next.disabled = !following;
      next.title = following ? `下一章：${following.title}` : '已是最后一章';
      next.setAttribute('aria-label', next.title);
      nextLabel.textContent = following ? '下一章' : '最后一章';
      nextTitle.textContent = following ? following.title : '已到文档末章';
    }
    if (chapterChanged || heading !== lastHeading) {
      detail.textContent = heading ? heading.textContent.replace(/\s+/g, ' ').trim() : '章节概览';
      detail.title = detail.textContent;
      titleAnimation?.cancel();
      if (lastSection && !reduceMotionQuery?.matches) {
        titleAnimation = location.animate([
          { opacity: 0.55, transform: 'translateY(4px)' },
          { opacity: 1, transform: 'translateY(0)' },
        ], { duration: 180, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
      }
    }
    if (chapterChanged || value !== lastPercent) {
      percent.textContent = `本章 ${value}%`;
      remaining.textContent = value === 100 ? '已到文档末尾'
        : following ? `距下一章还剩 ${100 - value}%` : `距本章结束还剩 ${100 - value}%`;
      progress.setAttribute('aria-valuenow', String(value));
      progress.setAttribute('aria-valuetext', `${chapter.title}，${value}%`);
      fill.style.transitionDuration = chapterChanged ? '0ms' : '';
      fill.style.transform = `scaleX(${value / 100})`;
    }
    lastSection = section;
    lastHeading = heading;
    lastPercent = value;
  };
}
