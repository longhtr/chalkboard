// Runtime visual adjustments that cannot cross MathLive's shadow-DOM boundary.

const STYLE_ID = 'excalifont-mathlive-adapter';
const RADICAL_WEIGHT = `
.ML__sqrt-line:before {
  margin-top: min(-1px, -0.07em) !important;
  margin-left: -0.03em !important;
  min-height: max(1px, 0.06em) !important;
  width: calc(100% + 0.03em) !important;
}
`;

let observer = null;
let waitingForDom = false;

function patchMathfield(field, attempts = 12) {
  const root = field.shadowRoot;
  if (!root) {
    if (attempts > 0) requestAnimationFrame(() => patchMathfield(field, attempts - 1));
    return;
  }
  if (root.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = RADICAL_WEIGHT;
  root.append(style);
}

function patchTree(root) {
  if (root instanceof Element && root.matches('math-field')) patchMathfield(root);
  root.querySelectorAll?.('math-field').forEach(field => patchMathfield(field));
}

function startObserver() {
  waitingForDom = false;
  patchTree(document);
  if (observer) return;
  observer = new MutationObserver(records => {
    for (const record of records) {
      record.addedNodes.forEach(node => {
        if (node instanceof Element) patchTree(node);
      });
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

function disconnectObserver() {
  if (waitingForDom) {
    document.removeEventListener('DOMContentLoaded', startObserver);
    waitingForDom = false;
  }
  observer?.disconnect();
  observer = null;
}

const installation = Object.freeze({ disconnect: disconnectObserver });

/**
 * Install Excalifont's MathLive shadow-DOM adjustments for current and future
 * fields. Calls are idempotent and share one document observer. The returned
 * handle's disconnect() method removes that observer; a later call reinstalls
 * it without changing field values or LaTeX source.
 */
export function installMathLiveAdapter() {
  if (document.readyState === 'loading') {
    if (!waitingForDom) {
      waitingForDom = true;
      document.addEventListener('DOMContentLoaded', startObserver, { once: true });
    }
  } else {
    startObserver();
  }
  return installation;
}

installMathLiveAdapter();
