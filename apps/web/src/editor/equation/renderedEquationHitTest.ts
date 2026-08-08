/** Hit-tests visible rendered equation content for inactive equation activation. */
import type { Point } from '@chalkboard/shared';

/** Hit-tests visible glyph/decorative boxes without filling multiline whitespace. */
export function hitTestRenderedEquation(
  id: string,
  point: Point,
  tolerance: number,
  {
    allowMultilineContainerFallback = false,
  }: { allowMultilineContainerFallback?: boolean } = {},
): boolean {
  const container = document.querySelector(
    `[data-mixed-text-id="${CSS.escape(id)}"]`,
  );
  if (!(container instanceof HTMLElement)) return false;
  const textWalker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let textNode = textWalker.nextNode();
  while (textNode !== null) {
    if (textNode.textContent !== '') {
      const range = document.createRange();
      range.selectNodeContents(textNode);
      for (const bounds of range.getClientRects()) {
        if (
          bounds.width > 0 &&
          bounds.height > 0 &&
          point.x >= bounds.left - tolerance &&
          point.x <= bounds.right + tolerance &&
          point.y >= bounds.top - tolerance &&
          point.y <= bounds.bottom + tolerance
        ) {
          return true;
        }
      }
    }
    textNode = textWalker.nextNode();
  }
  const content = [...container.querySelectorAll('.ML__base > *')].filter(
    (child): child is HTMLElement =>
      child instanceof HTMLElement &&
      !child.classList.contains('mixed-text-line-break'),
  );
  const hitsRenderedChild = content.some((child) => {
    const bounds = child.getBoundingClientRect();
    return (
      bounds.width > 0 &&
      bounds.height > 0 &&
      point.x >= bounds.left - tolerance &&
      point.x <= bounds.right + tolerance &&
      point.y >= bounds.top - tolerance &&
      point.y <= bounds.bottom + tolerance
    );
  });
  if (hitsRenderedChild) return true;

  // Firefox can briefly return no text-node/client rects while replacing an
  // empty active field. A one-line container has no intentional internal
  // whitespace, so its measured box is a safe fallback. Multiline blocks keep
  // the child-only test so clicks between rows can still create a new block.
  const accessibleLabel = container.getAttribute('aria-label') ?? '';
  if (accessibleLabel.includes('\n') && !allowMultilineContainerFallback)
    return false;
  const bounds = container.getBoundingClientRect();
  return (
    bounds.width > 0 &&
    bounds.height > 0 &&
    point.x >= bounds.left - tolerance &&
    point.x <= bounds.right + tolerance &&
    point.y >= bounds.top - tolerance &&
    point.y <= bounds.bottom + tolerance
  );
}
