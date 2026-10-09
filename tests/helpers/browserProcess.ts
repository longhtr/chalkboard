/** Starts an isolated browser process and profile so restart stories exercise real process durability. */
import { expect, type BrowserContext, type Page } from '@playwright/test';

export async function crashChromiumBrowser(
  context: BrowserContext,
  page: Page,
): Promise<void> {
  const browser = context.browser();
  if (browser === null) {
    throw new Error('Persistent Chromium browser is absent');
  }
  const session = await context.newCDPSession(page);
  void session.send('Browser.crash').catch(() => undefined);
  await expect.poll(() => browser.isConnected()).toBe(false);
}
