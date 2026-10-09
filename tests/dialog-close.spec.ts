/** Reference dialogs keep their close control reachable while their body scrolls. */
import { devices, expect, test } from '@playwright/test';

for (const viewport of [
  devices['iPhone 13'].viewport,
  { width: 1024, height: 600 },
]) {
  test(`reference close stays visible at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto('/local');
    for (const name of ['Keyboard shortcuts', 'MathLive / LaTeX cheatsheet']) {
      await page.getByRole('button', { name: 'Open board menu' }).click();
      await page.getByRole('button', { name, exact: true }).click();
      const dialog = page.getByRole('dialog', { name, exact: true });
      await expect(dialog).toBeVisible();
      const close = dialog.getByRole('button', {
        name:
          name === 'Keyboard shortcuts'
            ? 'Close keyboard shortcuts'
            : `Close ${name}`,
        exact: true,
      });
      const before = await close.boundingBox();
      const body = dialog.locator('.shortcuts-dialog__body');
      await body.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      await expect
        .poll(() => body.evaluate((element) => element.scrollTop))
        .toBeGreaterThan(0);
      await expect(close).toBeInViewport({ ratio: 1 });
      expect(await close.boundingBox()).toEqual(before);
      await close.click();
      await expect(dialog).toHaveCount(0);
    }
  });
}
