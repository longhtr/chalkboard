/**
 * Browser accessibility contracts for keyboard reachability, names, focus,
 * dialogs, object navigation, reflow, forced colors, and automated Axe rules.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { assertValue } from './helpers/assertions';

const expectNoSeriousViolations = async (page: Page, state: string) => {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const violations = results.violations.filter(
    ({ impact }) => impact === 'critical' || impact === 'serious',
  );
  expect(
    violations.map(({ description, help, id, nodes }) => ({
      description,
      help,
      id,
      targets: nodes.map(({ target }) => target.join(' ')),
    })),
    `${state} has serious accessibility violations`,
  ).toEqual([]);
};

test('keeps the workspace and primary dialogs free of serious WCAG violations', async ({
  page,
}) => {
  await page.goto('/local');
  await expectNoSeriousViolations(page, 'Workspace');

  await page.getByRole('button', { name: 'Open account' }).click();
  await expect(
    page.getByRole('dialog', { name: /Sign in|Create account|Hello|Offline/u }),
  ).toBeVisible();
  await expectNoSeriousViolations(page, 'Account dialog');
  await page.getByRole('button', { name: 'Close account panel' }).click();

  await page.getByRole('button', { name: 'Open board menu' }).click();
  await page.getByRole('button', { name: 'Open boards' }).click();
  await expect(page.getByRole('dialog', { name: 'Boards' })).toBeVisible();
  await expectNoSeriousViolations(page, 'Local board library');
  await page.getByRole('button', { name: 'Close boards' }).click();

  await page.getByRole('button', { name: 'Open board menu' }).click();
  await page.getByRole('button', { name: 'Export image' }).click();
  await expect(
    page.getByRole('dialog', { name: 'Export image' }),
  ).toBeVisible();
  await expectNoSeriousViolations(page, 'Export dialog');
  await page.getByRole('button', { name: 'Close export' }).click();

  await page.getByRole('button', { name: 'Board objects' }).click();
  await expect(
    page.getByRole('complementary', { name: 'Board objects' }),
  ).toBeVisible();
  await expectNoSeriousViolations(page, 'Object navigator');
});

test('announces document changes through a polite live region', async ({
  page,
}) => {
  await page.goto('/local');
  const liveRegion = page.locator('[aria-live="polite"]').filter({
    hasText: 'Canvas contains',
  });
  await expect(liveRegion).toHaveText('Canvas contains 0 objects');
  await page.getByRole('button', { name: 'Shape tool' }).click();
  const canvas = page.getByRole('application', {
    name: 'Chalkboard drawing canvas',
  });
  const bounds = await canvas.boundingBox();
  assertValue(bounds, 'element bounds');
  await page.mouse.move(bounds.x + 300, bounds.y + 240);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 400, bounds.y + 320);
  await page.mouse.up();
  await expect(liveRegion).toHaveText('Canvas contains 1 object');
});

test('contains modal focus, restores the opener, and exposes canvas focus', async ({
  page,
}) => {
  await page.goto('/local');
  const menuButton = page.getByRole('button', { name: 'Open board menu' });
  await menuButton.click();
  await page.getByRole('button', { name: 'Export image' }).click();
  const close = page.getByRole('button', { name: 'Close export' });
  await expect(close).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('button', { name: 'Export PNG' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Export image' })).toHaveCount(
    0,
  );
  await expect(menuButton).toBeFocused();

  await menuButton.click();
  await page.getByRole('button', { name: 'Keyboard shortcuts' }).click();
  await expect(
    page.getByRole('button', { name: 'Close keyboard shortcuts' }),
  ).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('dialog', { name: 'Keyboard shortcuts' }),
  ).toHaveCount(0);
  await expect(menuButton).toBeFocused();

  const canvas = page.getByRole('application', {
    name: 'Chalkboard drawing canvas',
  });
  await canvas.focus();
  await expect(canvas).toBeFocused();
  await expect
    .poll(() =>
      canvas.evaluate((element) => getComputedStyle(element).outlineStyle),
    )
    .toBe('solid');
});

test('keeps local board management usable at 200% and 400% reflow', async ({
  page,
}) => {
  for (const viewport of [
    { height: 360, width: 640 },
    { height: 256, width: 320 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto('/local');
    await page.getByRole('button', { name: 'Open board menu' }).click();
    await page.getByRole('button', { name: 'Open boards' }).click();
    const library = page.getByRole('dialog', { name: 'Boards' });
    await expect(library).toBeVisible();
    await expect(
      library.getByRole('heading', { name: 'On this device' }),
    ).toBeVisible();
    await expect(
      library.getByRole('button', { name: 'Device trash' }),
    ).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() => ({
          documentOverflow:
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth,
          libraryOverflow: (() => {
            const dialog = document.querySelector('[role="dialog"]');
            return dialog instanceof HTMLElement
              ? dialog.scrollWidth - dialog.clientWidth
              : Number.POSITIVE_INFINITY;
          })(),
        })),
      )
      .toEqual({ documentOverflow: 0, libraryOverflow: 0 });
    await page.getByRole('button', { name: 'Close boards' }).click();
  }
});

test('preserves semantics and visible focus in forced colors', async ({
  page,
}) => {
  await page.emulateMedia({ forcedColors: 'active' });
  await page.goto('/local');
  await expect
    .poll(() =>
      page.evaluate(() => matchMedia('(forced-colors: active)').matches),
    )
    .toBe(true);
  await page.getByRole('button', { name: 'Open board menu' }).click();
  await page.getByRole('button', { name: 'Open boards' }).click();
  const library = page.getByRole('dialog', { name: 'Boards' });
  await expect(library).toBeVisible();
  const close = page.getByRole('button', { name: 'Close boards' });
  await close.focus();
  await page.keyboard.press('Tab');
  const keyboardFocused = page.locator(':focus');
  await expect(keyboardFocused).toBeFocused();
  await expect
    .poll(() =>
      keyboardFocused.evaluate(
        (element) => getComputedStyle(element).outlineStyle !== 'none',
      ),
    )
    .toBe(true);
  await expectNoSeriousViolations(page, 'Forced-colors local board library');
});

test('honors reduced motion while preserving control state changes', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/local');
  await expect
    .poll(() =>
      page.evaluate(
        () => matchMedia('(prefers-reduced-motion: reduce)').matches,
      ),
    )
    .toBe(true);
  await page.getByRole('button', { name: 'Open board menu' }).click();
  await page.getByRole('button', { name: 'Grid' }).click();
  const gridSwitch = page.getByRole('switch', { name: 'Grid' });
  const durationSeconds = await gridSwitch.evaluate((element) => {
    const duration = getComputedStyle(element).transitionDuration;
    const value = Number.parseFloat(duration);
    return duration.endsWith('ms') ? value / 1_000 : value;
  });
  expect(durationSeconds).toBeLessThanOrEqual(0.000_01);
  // The grid ships off, so the control state change to assert is off-to-on.
  await expect(gridSwitch).toHaveAttribute('aria-checked', 'false');
  await gridSwitch.click();
  await expect(gridSwitch).toHaveAttribute('aria-checked', 'true');
});
