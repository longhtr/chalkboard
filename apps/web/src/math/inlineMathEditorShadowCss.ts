/** CSS injected into MathLive shadow DOM for caret, selection, multiline, placeholders, and font layout. */
import { EXCALIFONT_OPERATOR_SHADOW_LAYOUT_CSS } from './excalifontLayout';

/** Complete MathLive shadow-root overrides installed for one active editor. */
export const INLINE_MATH_EDITOR_SHADOW_CSS = `
  ${EXCALIFONT_OPERATOR_SHADOW_LAYOUT_CSS}
  .ML__container {
    vertical-align: top !important;
  }
  .ML__text {
    background: transparent !important;
    font-family: var(--text-font-family, KaTeX_Main, sans-serif) !important;
    line-height: var(--mixed-line-spacing, 1.2em) !important;
    font-synthesis: none;
  }
  .mixed-text-line-break {
    display: block !important;
    width: 0 !important;
    height: 0 !important;
    overflow: hidden !important;
  }
  .mixed-text-line-break + .mixed-text-line-break {
    height: var(--mixed-line-spacing, 1.2em) !important;
  }
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
  .ML__placeholder-selected {
    display: inline-block !important;
    width: 0 !important;
    overflow: hidden !important;
    color: transparent !important;
    background: transparent !important;
    outline: none !important;
  }
  .mixed-text-line-break {
    display: block !important;
    width: 0 !important;
    height: 0 !important;
    overflow: hidden !important;
  }
  .mixed-text-line-break + .mixed-text-line-break {
    height: 1.2em !important;
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
  .mixed-text-literal-dollar {
    position: relative !important;
    display: inline-block !important;
    width: 0.55em !important;
    overflow: visible !important;
    color: transparent !important;
  }
  .mixed-text-literal-backslash::after,
  .mixed-text-literal-dollar::after {
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
`;
