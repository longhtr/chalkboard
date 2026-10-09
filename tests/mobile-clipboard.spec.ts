/** Phone clipboard controls appear only for a long press, in the touched context. */
import { devices, expect, test, type Page } from '@playwright/test';
import { seedRectangles } from './helpers/workspace';

async function longPress(
  page: Page,
  point: { x: number; y: number },
  browserName: string,
  native = false,
) {
  if (browserName === 'chromium') {
    const input = await page.context().newCDPSession(page);
    await input.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [point],
    });
    if (native)
      await page.waitForTimeout(550); // Duration of the held touch.
    else
      await expect(
        page.getByRole('toolbar', { name: 'Clipboard actions' }),
      ).toBeVisible();
    await input.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    });
    await input.detach();
  } else {
    // Playwright exposes a native touch tap but no held touch for WebKit. Drive
    // the recognizer's pointer events, then exercise its real menu and editor.
    const field = page.locator('math-field');
    const source = page.getByRole('textbox', { name: 'Block source' });
    const target = (await source.isVisible())
      ? source
      : (await field.count())
        ? page.locator('.inline-math-editor')
        : page.locator('.canvas-viewport');
    await target.dispatchEvent('pointerdown', {
      pointerId: 5,
      pointerType: 'touch',
      clientX: point.x,
      clientY: point.y,
    });
    if (native)
      await page.waitForTimeout(550); // Duration of the held touch.
    else
      await expect(
        page.getByRole('toolbar', { name: 'Clipboard actions' }),
      ).toBeVisible();
    await target.dispatchEvent('pointerup', {
      pointerId: 5,
      pointerType: 'touch',
      clientX: point.x,
      clientY: point.y,
    });
  }
}

async function openWriting(page: Page) {
  await page.goto('/local');
  await page.getByRole('button', { name: 'Mixed text block tool' }).tap();
  await page
    .getByRole('application', { name: 'Chalkboard drawing canvas' })
    .tap({ position: { x: 180, y: 220 } });
  await expect(page.locator('.inline-math-editor')).toHaveClass(/is-ready/);
}

async function selectRectangle(page: Page) {
  await page.getByRole('button', { name: 'Board objects' }).click();
  const navigator = page.getByRole('complementary', { name: 'Board objects' });
  await navigator
    .getByRole('button', {
      name: 'Rectangle shape, object 1, position -240, -100',
    })
    .click();
  await navigator.getByRole('button', { name: 'Close board objects' }).click();
  const point = await page.evaluate(() => {
    const viewport = document
      .querySelector('.canvas-viewport')!
      .getBoundingClientRect();
    // The navigator centers the chosen rectangle in the viewport.
    return {
      x: viewport.x + viewport.width / 2,
      y: viewport.y + viewport.height / 2,
    };
  });
  return point;
}

// The same stories use native held touches in Chromium and controlled pointer
// events in WebKit; clipboard contents/permission failures are injected.
test.describe('phone clipboard', () => {
  test.use({
    viewport: devices['iPhone 13'].viewport,
    deviceScaleFactor: devices['iPhone 13'].deviceScaleFactor,
    isMobile: true,
    hasTouch: true,
    userAgent: devices['iPhone 13'].userAgent,
  });

  test.beforeEach(async ({ page }) => {
    // Exercise the async path consistently in both engines. Native Safari's
    // callout is platform UI; the native-path stories below model its response.
    await page.addInitScript(() => {
      const supported = document.queryCommandSupported.bind(document);
      document.queryCommandSupported = (command) =>
        command === 'paste' ? false : supported(command);
    });
  });

  test('releasing a hold beneath the top-edge menu waits for a separate Paste tap', async ({
    page,
    browserName,
  }) => {
    await page.goto('/local');
    await page.getByRole('button', { name: 'Selection tool' }).tap();
    await longPress(page, { x: 185, y: 20 }, browserName);
    const menu = page.getByRole('toolbar', { name: 'Clipboard actions' });
    await expect(menu).toBeVisible();
    const bounds = await menu.boundingBox();
    expect(bounds!.y).toBeLessThan(20);
    expect(bounds!.y + bounds!.height).toBeGreaterThan(20);
    await menu.getByRole('button', { name: 'Paste', exact: true }).tap();
    await expect(menu).toHaveCount(0);
    await expect(
      page.getByText('Copy or cut an object before pasting.'),
    ).toBeVisible();
  });

  test('long press in mixed text shows only Paste and inserts directly with undo', async ({
    page,
    browserName,
  }) => {
    await page.addInitScript(() =>
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        // A permission prompt can outlive the editor's blur grace period.
        value: {
          readText: () => {
            const field = document.querySelector('math-field');
            if (
              document.activeElement !== field ||
              !field?.shadowRoot?.activeElement?.matches('.ML__keyboard-sink')
            )
              throw new Error('Focus must be restored before requesting paste');
            return new Promise<string>((resolve) =>
              setTimeout(() => resolve('first\nsecond'), 300),
            );
          },
        },
      }),
    );
    await openWriting(page);
    const field = page.locator('math-field');
    await field.pressSequentially('abc');
    expect(
      await field.evaluate(
        (element) =>
          !element.dispatchEvent(
            new Event('selectstart', { bubbles: true, cancelable: true }),
          ),
      ),
    ).toBe(true);
    expect(
      await field.evaluate((element) => {
        const style = getComputedStyle(element);
        return (
          style.getPropertyValue('user-select') ||
          style.getPropertyValue('-webkit-user-select')
        );
      }),
    ).toBe('none');
    await expect(
      page.getByRole('button', { name: 'Paste', exact: true }),
    ).toHaveCount(0);
    // Press at the end of the writing, then paste at that insertion point.
    const bounds = await field.boundingBox();
    expect(bounds).not.toBeNull();
    await longPress(
      page,
      { x: bounds!.x + bounds!.width - 2, y: bounds!.y + bounds!.height / 2 },
      browserName,
    );
    const menu = page.getByRole('toolbar', { name: 'Clipboard actions' });
    await expect(menu.getByRole('button')).toHaveCount(1);
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(
      '',
    );
    const menuBounds = await menu.boundingBox();
    expect(menuBounds!.y + menuBounds!.height).toBeLessThanOrEqual(
      bounds!.y + bounds!.height / 2,
    );
    await menu.getByRole('button', { name: 'Paste', exact: true }).tap();
    await expect(menu).toHaveCount(0);
    await expect(
      page.getByRole('group', { name: 'abcfirst\nsecond', exact: true }),
    ).toBeAttached();
    await expect(field).toBeFocused();
    await page.getByRole('button', { name: 'Undo', exact: true }).tap();
    await expect(
      page.getByRole('group', { name: 'abc', exact: true }),
    ).toBeAttached();
    await expect(
      page.getByRole('textbox', { name: 'Text to paste' }),
    ).toHaveCount(0);
  });

  test('long-press paste respects math mode and source view', async ({
    page,
    browserName,
  }) => {
    await page.addInitScript(() =>
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { readText: () => Promise.resolve(String.raw`\sqrt{x}`) },
      }),
    );
    await openWriting(page);
    const field = page.locator('math-field');
    await field.press('Control+m');
    let bounds = await field.boundingBox();
    await longPress(
      page,
      { x: bounds!.x + bounds!.width / 2, y: bounds!.y + bounds!.height / 2 },
      browserName,
    );
    await page.getByRole('button', { name: 'Paste', exact: true }).tap();
    await expect
      .poll(() => field.evaluate((node) => node.value))
      .toContain(String.raw`\sqrt{x}`);
    await page
      .getByRole('button', { name: 'Open element style', exact: true })
      .tap();
    await page.getByRole('button', { name: 'Use source editing view' }).tap();
    const source = page.getByRole('textbox', { name: 'Block source' });
    expect(
      await source.evaluate((element) =>
        element.dispatchEvent(
          new Event('selectstart', { bubbles: true, cancelable: true }),
        ),
      ),
    ).toBe(true);
    await source.fill('');
    bounds = await source.boundingBox();
    await longPress(
      page,
      { x: bounds!.x + 5, y: bounds!.y + bounds!.height / 2 },
      browserName,
    );
    await expect(source).toHaveValue('');
    await page.getByRole('button', { name: 'Paste', exact: true }).tap();
    await expect(source).toHaveValue(String.raw`\sqrt{x}`);
    await expect(source).toBeFocused();
  });

  test('clipboard denial preserves writing, offers retry and opens no input dialog', async ({
    page,
    browserName,
  }) => {
    await page.addInitScript(() =>
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          readText: (() => {
            let denied = true;
            return () => {
              if (denied) {
                denied = false;
                return Promise.reject(
                  new DOMException('Denied', 'NotAllowedError'),
                );
              }
              return Promise.resolve(' pasted');
            };
          })(),
        },
      }),
    );
    await openWriting(page);
    await page.locator('math-field').pressSequentially('keep');
    const bounds = await page.locator('math-field').boundingBox();
    await longPress(
      page,
      { x: bounds!.x + bounds!.width - 2, y: bounds!.y + bounds!.height / 2 },
      browserName,
    );
    await page.getByRole('button', { name: 'Paste', exact: true }).tap();
    await expect(
      page.getByText('Allow clipboard access to paste.'),
    ).toHaveCount(0);
    await expect(
      page.getByRole('group', { name: 'keep', exact: true }),
    ).toBeAttached();
    await expect(page.locator('math-field')).toBeFocused();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('button', { name: 'Paste', exact: true }).tap();
    await expect(
      page.getByRole('group', { name: 'keep pasted', exact: true }),
    ).toBeAttached();
  });

  test('native Safari paste uses the existing editor without async clipboard access or extra buttons', async ({
    page,
    browserName,
  }) => {
    await openWriting(page);
    const field = page.locator('math-field');
    await field.pressSequentially('abc');
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          readText: () => {
            throw new Error('Must use native paste');
          },
        },
      });
      document.queryCommandSupported = (command) => command === 'paste';
      document.execCommand = (command) => {
        if (command !== 'paste') return false;
        const field = document.querySelector('math-field')!;
        const sink = field.shadowRoot?.activeElement;
        if (!sink?.matches('.ML__keyboard-sink'))
          throw new Error('Native paste must target the focused editor sink');
        // Model choosing Paste after the native callout has stayed open longer
        // than the editor's blur grace period. No async read permission exists.
        setTimeout(() => {
          const clipboardData = new DataTransfer();
          clipboardData.setData('text/plain', 'first\nsecond');
          sink.dispatchEvent(
            new ClipboardEvent('paste', {
              bubbles: true,
              cancelable: true,
              composed: true,
              clipboardData,
            }),
          );
        }, 300);
        return true;
      };
    });
    const bounds = await field.boundingBox();
    await longPress(
      page,
      { x: bounds!.x + bounds!.width - 2, y: bounds!.y + bounds!.height / 2 },
      browserName,
      true,
    );
    await expect(
      page.getByRole('toolbar', { name: 'Clipboard actions' }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('group', { name: 'abcfirst\nsecond', exact: true }),
    ).toBeAttached();
    await expect(field).toBeFocused();
    await page.getByRole('button', { name: 'Undo', exact: true }).tap();
    await expect(
      page.getByRole('group', { name: 'abc', exact: true }),
    ).toBeAttached();
  });

  test('cancelling native Paste leaves writing and focus intact without an error', async ({
    page,
    browserName,
  }) => {
    await openWriting(page);
    const field = page.locator('math-field');
    await field.pressSequentially('keep');
    await page.evaluate(() => {
      document.queryCommandSupported = (command) => command === 'paste';
      document.execCommand = () => false;
    });
    const bounds = await field.boundingBox();
    await longPress(
      page,
      { x: bounds!.x + bounds!.width - 2, y: bounds!.y + bounds!.height / 2 },
      browserName,
      true,
    );
    await expect(
      page.getByRole('group', { name: 'keep', exact: true }),
    ).toBeAttached();
    await expect(field).toBeFocused();
    await expect(
      page.getByText('Allow clipboard access to paste.'),
    ).toHaveCount(0);
    await field.pressSequentially(' typing');
    await expect(
      page.getByRole('group', { name: 'keep typing', exact: true }),
    ).toBeAttached();
  });

  test('selected-object long press shows Copy/Cut; empty-space long press shows Paste', async ({
    page,
    browserName,
  }) => {
    await page.addInitScript(() =>
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: undefined,
      }),
    );
    await seedRectangles(page);
    await page.goto('/local');
    await expect(page.getByText('Canvas contains 1 object')).toBeVisible();
    const point = await selectRectangle(page);
    await longPress(page, point, browserName);
    let menu = page.getByRole('toolbar', { name: 'Clipboard actions' });
    await expect(menu.getByRole('button')).toHaveText(['Copy', 'Cut']);
    await menu.getByRole('button', { name: 'Copy', exact: true }).tap();
    await expect(menu).toHaveCount(0);
    await expect(page.getByText('Canvas contains 1 object')).toBeVisible();
    await longPress(page, { x: 40, y: 220 }, browserName);
    menu = page.getByRole('toolbar', { name: 'Clipboard actions' });
    await expect(menu.getByRole('button')).toHaveText(['Paste']);
    await menu.getByRole('button', { name: 'Paste', exact: true }).tap();
    await expect(page.getByText('Canvas contains 2 objects')).toBeVisible();
    // Both rectangles overlap at the center; the pasted one remains selected.
    await longPress(page, { x: point.x + 20, y: point.y + 20 }, browserName);
    await page.getByRole('button', { name: 'Cut', exact: true }).tap();
    await expect(page.getByText('Canvas contains 1 object')).toBeVisible();
    await page.getByRole('button', { name: 'Undo', exact: true }).tap();
    await expect(page.getByText('Canvas contains 2 objects')).toBeVisible();
    await longPress(page, { x: 40, y: 220 }, browserName);
    await page.getByRole('button', { name: 'Paste', exact: true }).tap();
    await expect(page.getByText('Canvas contains 3 objects')).toBeVisible();
  });

  test('a tap, a drag and a second touch do not open clipboard controls', async ({
    page,
  }) => {
    await seedRectangles(page);
    await page.goto('/local');
    const point = await selectRectangle(page);
    const viewport = page.locator('.canvas-viewport');
    await viewport.dispatchEvent('pointerdown', {
      pointerId: 6,
      pointerType: 'touch',
      clientX: point.x,
      clientY: point.y,
    });
    await viewport.dispatchEvent('pointerup', {
      pointerId: 6,
      pointerType: 'touch',
    });
    await viewport.dispatchEvent('pointerdown', {
      pointerId: 7,
      pointerType: 'touch',
      clientX: point.x,
      clientY: point.y,
    });
    await viewport.dispatchEvent('pointermove', {
      pointerId: 7,
      pointerType: 'touch',
      clientX: point.x + 30,
      clientY: point.y,
    });
    await viewport.dispatchEvent('pointerup', {
      pointerId: 7,
      pointerType: 'touch',
    });
    await viewport.dispatchEvent('pointerdown', {
      pointerId: 8,
      pointerType: 'touch',
      clientX: point.x,
      clientY: point.y,
    });
    await viewport.dispatchEvent('pointerdown', {
      pointerId: 9,
      pointerType: 'touch',
      clientX: point.x,
      clientY: point.y,
    });
    await page.waitForTimeout(550);
    await viewport.dispatchEvent('pointerup', {
      pointerId: 8,
      pointerType: 'touch',
    });
    await viewport.dispatchEvent('pointerup', {
      pointerId: 9,
      pointerType: 'touch',
    });
    await expect(
      page.getByRole('toolbar', { name: 'Clipboard actions' }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: /^(Copy|Cut|Paste)$/ }),
    ).toHaveCount(0);
  });
});

test('desktop object cut and paste use standard shortcuts without extra buttons', async ({
  page,
}) => {
  await seedRectangles(page);
  await page.goto('/local');
  await selectRectangle(page);
  await page.keyboard.press('Control+x');
  await expect(page.getByText('Canvas contains 0 objects')).toBeVisible();
  await page.keyboard.press('Control+v');
  await expect(page.getByText('Canvas contains 1 object')).toBeVisible();
  await expect(
    page.getByRole('button', { name: /^(Copy|Cut|Paste)$/ }),
  ).toHaveCount(0);
});
