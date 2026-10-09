/**
 * Copies plain text through the modern Clipboard API, then falls back to a
 * temporary selected textarea for supported older browser contexts.
 */
export async function copyTextToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    const previousFocus = document.activeElement;
    const textarea = document.createElement('textarea');
    textarea.value = text;
    // Selecting a read-only fallback avoids summoning the phone keyboard.
    textarea.readOnly = true;
    textarea.tabIndex = -1;
    textarea.setAttribute('aria-hidden', 'true');
    textarea.style.position = 'fixed';
    textarea.style.top = '0';
    textarea.style.left = '0';
    textarea.style.opacity = '0';
    document.body.append(textarea);
    textarea.select();
    let copied: boolean;
    try {
      copied = document.execCommand('copy');
    } finally {
      textarea.remove();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected)
        previousFocus.focus({ preventScroll: true });
    }
    if (!copied) throw new Error('Clipboard access was denied');
  }
}
