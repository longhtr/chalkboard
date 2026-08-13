/**
 * Shares one ResizeObserver across inactive equation elements. Each element keeps
 * independent callbacks, and the observer disconnects after the final unsubscribe.
 */
type ResizeCallback = () => void;

const callbacks = new WeakMap<Element, ResizeCallback>();
let observer: ResizeObserver | null = null;

function sharedObserver(): ResizeObserver | null {
  if (typeof ResizeObserver === 'undefined') return null;
  observer ??= new ResizeObserver((entries) => {
    for (const entry of entries) callbacks.get(entry.target)?.();
  });
  return observer;
}

/** Observe any number of static math elements through one browser observer. */
export function observeStaticMathResize(
  element: Element,
  callback: ResizeCallback,
): () => void {
  callbacks.set(element, callback);
  const activeObserver = sharedObserver();
  activeObserver?.observe(element);
  return () => {
    if (callbacks.get(element) !== callback) return;
    callbacks.delete(element);
    activeObserver?.unobserve(element);
  };
}
