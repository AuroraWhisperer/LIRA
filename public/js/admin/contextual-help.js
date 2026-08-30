'use strict';

const HELP_ELEMENT_NAME = 'lira-help';
const VIEWPORT_INSET = 12;
const TOOLTIP_GAP = 8;
let helpId = 0;

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

export function calculateContextualHelpPosition(
  anchorRect,
  tooltipSize,
  viewport,
) {
  const centeredLeft =
    anchorRect.left +
    (anchorRect.right - anchorRect.left - tooltipSize.width) / 2;
  const left = clamp(
    centeredLeft,
    VIEWPORT_INSET,
    viewport.width - tooltipSize.width - VIEWPORT_INSET,
  );
  const fitsAbove =
    anchorRect.top - TOOLTIP_GAP - tooltipSize.height >= VIEWPORT_INSET;
  const placement = fitsAbove ? 'top' : 'bottom';
  const preferredTop = fitsAbove
    ? anchorRect.top - TOOLTIP_GAP - tooltipSize.height
    : anchorRect.bottom + TOOLTIP_GAP;
  const top = clamp(
    preferredTop,
    VIEWPORT_INSET,
    viewport.height - tooltipSize.height - VIEWPORT_INSET,
  );

  return {
    left: Math.round(left),
    top: Math.round(top),
    placement,
  };
}

class LiraHelpElement extends HTMLElement {
  constructor() {
    super();
    this.tooltip = null;
    this.tooltipOpen = false;
    this.listenersConnected = false;
    this.handlePointerEnter = this.showTooltip.bind(this);
    this.handlePointerLeave = this.onPointerLeave.bind(this);
    this.handleFocus = this.showTooltip.bind(this);
    this.handleBlur = this.hideTooltip.bind(this);
    this.handleClick = this.onClick.bind(this);
    this.handleKeydown = this.onKeydown.bind(this);
    this.repositionTooltip = this.positionTooltip.bind(this);
  }

  connectedCallback() {
    if (this.dataset.helpReady !== 'true') {
      const descriptionNodes = [...this.childNodes];
      const preservedDescription =
        descriptionNodes.length === 1 && descriptionNodes[0]?.nodeType === 1
          ? descriptionNodes[0]
          : null;
      const tooltip = preservedDescription || document.createElement('span');
      const tooltipId =
        tooltip.id ||
        this.getAttribute('tooltip-id') ||
        `lira-help-${++helpId}`;
      if (!preservedDescription) tooltip.append(...descriptionNodes);

      const mark = document.createElement('span');
      mark.className = 'lira-help-mark';
      mark.setAttribute('aria-hidden', 'true');
      const glyph = document.createElement('span');
      glyph.className = 'lira-help-glyph';
      glyph.textContent = '?';
      mark.append(glyph);

      tooltip.id = tooltipId;
      tooltip.classList.add('lira-help-tooltip');
      tooltip.setAttribute('role', 'tooltip');
      tooltip.popover = 'manual';

      this.replaceChildren(mark, tooltip);
      this.tooltip = tooltip;
      this.tabIndex = 0;
      this.setAttribute('role', 'button');
      this.setAttribute('aria-label', this.getAttribute('label') || '查看说明');
      this.setAttribute('aria-describedby', tooltipId);
      this.setAttribute('aria-expanded', 'false');
      this.dataset.helpReady = 'true';
    }

    if (this.listenersConnected) return;

    this.addEventListener('mouseenter', this.handlePointerEnter);
    this.addEventListener('mouseleave', this.handlePointerLeave);
    this.addEventListener('focus', this.handleFocus);
    this.addEventListener('blur', this.handleBlur);
    this.addEventListener('click', this.handleClick);
    this.addEventListener('keydown', this.handleKeydown);
    this.listenersConnected = true;
  }

  disconnectedCallback() {
    this.hideTooltip();
    this.removeEventListener('mouseenter', this.handlePointerEnter);
    this.removeEventListener('mouseleave', this.handlePointerLeave);
    this.removeEventListener('focus', this.handleFocus);
    this.removeEventListener('blur', this.handleBlur);
    this.removeEventListener('click', this.handleClick);
    this.removeEventListener('keydown', this.handleKeydown);
    this.listenersConnected = false;
  }

  showTooltip() {
    if (!this.tooltip?.isConnected) return;

    if (!this.tooltipOpen) {
      this.tooltip.style.visibility = 'hidden';
      if (typeof this.tooltip.showPopover === 'function') {
        this.tooltip.showPopover();
      } else {
        this.tooltip.dataset.open = 'true';
      }
      this.tooltipOpen = true;
      window.addEventListener('resize', this.repositionTooltip);
      document.addEventListener('scroll', this.repositionTooltip, true);
    }

    this.setAttribute('aria-expanded', 'true');
    this.positionTooltip();
    this.tooltip.style.removeProperty('visibility');
  }

  hideTooltip() {
    this.setAttribute('aria-expanded', 'false');
    if (!this.tooltipOpen || !this.tooltip) return;

    if (typeof this.tooltip.hidePopover === 'function') {
      this.tooltip.hidePopover();
    } else {
      delete this.tooltip.dataset.open;
    }
    this.tooltipOpen = false;
    window.removeEventListener('resize', this.repositionTooltip);
    document.removeEventListener('scroll', this.repositionTooltip, true);
  }

  positionTooltip() {
    if (!this.tooltipOpen || !this.tooltip) return;
    const anchorRect = this.getBoundingClientRect();
    const tooltipRect = this.tooltip.getBoundingClientRect();
    const position = calculateContextualHelpPosition(
      anchorRect,
      { width: tooltipRect.width, height: tooltipRect.height },
      { width: window.innerWidth, height: window.innerHeight },
    );
    this.tooltip.style.left = `${position.left}px`;
    this.tooltip.style.top = `${position.top}px`;
    this.tooltip.dataset.placement = position.placement;
  }

  onPointerLeave() {
    if (!this.matches(':focus-visible')) this.hideTooltip();
  }

  onClick(event) {
    event.preventDefault();
    event.stopPropagation();
  }

  onKeydown(event) {
    if (event.key === 'Escape') {
      this.hideTooltip();
      return;
    }
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    event.stopPropagation();
    this.showTooltip();
  }
}

export function initializeContextualHelp() {
  if (
    typeof customElements === 'undefined' ||
    typeof HTMLElement === 'undefined'
  )
    return;
  if (!customElements.get(HELP_ELEMENT_NAME)) {
    customElements.define(HELP_ELEMENT_NAME, LiraHelpElement);
  }
}

initializeContextualHelp();
