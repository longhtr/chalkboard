/** Stabilizes animation, fonts, and transient UI before browser-level visual or geometry inspection. */
import type { Page } from '@playwright/test';

export const waitForPaint = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
