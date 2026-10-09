/** CSS injected into MathLive shadow DOM for caret, selection, multiline, placeholders, and font layout. */
import { EXCALIFONT_OPERATOR_SHADOW_LAYOUT_CSS } from './excalifontLayout';
import { LINE_BREAK_CSS } from './lineClearance';

/** Complete MathLive shadow-root overrides installed for one active editor. */
export const INLINE_MATH_EDITOR_SHADOW_CSS = `
  ${EXCALIFONT_OPERATOR_SHADOW_LAYOUT_CSS}
  .ML__container {
    vertical-align: top !important;
  }
  @media (pointer: coarse) {
    :host, .ML__container, .ML__content, .ML__base, .ML__text {
      -webkit-user-select: none !important;
      user-select: none !important;
      -webkit-touch-callout: none;
    }
    /* Keep native editing available in MathLive's invisible input owner. It
       cannot be hit by a touch, so it cannot select rendered page content. */
    .ML__keyboard-sink {
      -webkit-user-select: text !important;
      user-select: text !important;
      -webkit-touch-callout: default;
    }
  }
  .ML__text {
    background: transparent !important;
  }
  .ML__text:not(.ML__base) {
    font-family: var(--text-font-family, KaTeX_Main, sans-serif) !important;
    line-height: var(--mixed-line-spacing, 1.2em) !important;
    font-synthesis: none;
  }
  /*
   * A radical's rule carries a decorative ::after whose content is one space.
   * The mixed text root preserves that space, making a line box a whole line
   * tall. As the last line box in an inline-block it sets the rule's baseline
   * and lifts the bar off the radical. Match the inactive rule in
   * styles/board-content.css so neither view generates that line box.
   */
  .ML__sqrt-line::after {
    content: '' !important;
  }
  ${LINE_BREAK_CSS}
  @keyframes chalkboard-caret-blink {
    0%, 49% {
      opacity: 1;
    }
    50%, 100% {
      opacity: 0;
    }
  }
  .ML__caret::after,
  .ML__text-caret::after,
  .ML__latex-caret::after {
    animation: chalkboard-caret-blink 1s step-end infinite !important;
    transform: none !important;
    visibility: visible !important;
  }
  @media (prefers-reduced-motion: reduce) {
    .ML__caret::after,
    .ML__text-caret::after,
    .ML__latex-caret::after {
      animation: none !important;
      opacity: 1 !important;
    }
  }
  .ML__placeholder-selected,
  .mixed-text-terminal-placeholder {
    display: inline-block !important;
    width: 0 !important;
    overflow: hidden !important;
    color: transparent !important;
    background: transparent !important;
    outline: none !important;
  }
  .mixed-text-terminal-placeholder * {
    color: transparent !important;
    background: transparent !important;
    outline: none !important;
  }
  /* MathLive clips its content box, which cut the bottom off a lengthened
     delimiter while the block was being edited: the bar looked shorter inside
     the block than outside it. The box is sized to the writing, so letting a
     corrected glyph paint past it changes nothing else. */
  .ML__content {
    overflow: visible !important;
  }

  .mixed-text-color-marker,
  .mixed-text-style-marker {
    display: inline-block !important;
    width: 0 !important;
    height: 0 !important;
    overflow: hidden !important;
    color: transparent !important;
  }
  .mixed-text-literal-backslash,
  .mixed-text-literal-brace-left,
  .mixed-text-literal-brace-right,
  .mixed-text-literal-dollar,
  .mixed-text-literal-percent {
    position: relative !important;
    display: inline-block !important;
    width: 0.55em !important;
    overflow: visible !important;
    color: transparent !important;
  }
  .mixed-text-literal-brace-left,
  .mixed-text-literal-brace-right {
    width: 0.4em !important;
  }
  .mixed-text-literal-percent {
    width: 0.85em !important;
  }
  .mixed-text-literal-backslash::after,
  .mixed-text-literal-brace-left::after,
  .mixed-text-literal-brace-right::after,
  .mixed-text-literal-dollar::after,
  .mixed-text-literal-percent::after {
    position: absolute;
    left: 0;
    color: var(--run-color, var(--editor-color, #1f2937));
  }
  .mixed-text-literal-backslash::after {
    content: '\\\\';
  }
  .mixed-text-literal-dollar::after {
    content: '$';
  }
  .mixed-text-literal-brace-left::after {
    content: '{';
  }
  .mixed-text-literal-brace-right::after {
    content: '}';
  }
  .mixed-text-literal-percent::after {
    content: '%';
  }
`;
