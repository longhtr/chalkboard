/** Classic/Excalifont loading, selection, reload, active/static alignment, export, and artifact identity. */
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';

import { expect, test } from '@playwright/test';

import { assertValue } from './helpers/assertions';

test('switches between Excalifont and classic MathLive faces persistently', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'chalkboard:local-document',
      JSON.stringify([
        {
          backgroundColor: 'transparent',
          createdBy: 'local',
          fontSize: 40,
          height: 70,
          id: 'font-choice-equation',
          lineSpacing: 1.2,
          opacity: 1,
          rotation: 0,
          source: String.raw`$\sum_{n=1}^{x}$`,
          strokeColor: '#1f2937',
          strokeStyle: 'solid',
          strokeWidth: 2,
          type: 'equation',
          width: 360,
          x: -180,
          y: -35,
        },
      ]),
    );
  });
  await page.goto('/');
  const equation = page.locator('[data-mixed-text-id="font-choice-equation"]');
  const lowerOperatorLimit =
    '.ML__op-group .ML__vlist > .ML__center:first-child > span:last-child[style*="font-size"]';
  await expect(equation).toBeVisible();
  await expect
    .poll(() =>
      equation.locator(lowerOperatorLimit).evaluate((limit) => ({
        position: getComputedStyle(limit).position,
        top: Number.parseFloat(getComputedStyle(limit).top),
      })),
    )
    // -0.5em against the script-sized limit, which is 0.7 of the block's 40px.
    .toEqual({ position: 'relative', top: -14 });

  await page.getByRole('button', { name: 'Open board menu' }).click();
  const fontButton = page.getByRole('button', { name: 'Font', exact: true });
  await fontButton.click();
  const fontPopover = page.getByRole('dialog', { name: 'Font options' });
  const [fontButtonBounds, fontPopoverBounds] = await Promise.all([
    fontButton.boundingBox(),
    fontPopover.boundingBox(),
  ]);
  assertValue(fontButtonBounds, 'font button bounds');
  assertValue(fontPopoverBounds, 'font popover bounds');
  if (fontButtonBounds !== null && fontPopoverBounds !== null) {
    expect(Math.abs(fontButtonBounds.y - fontPopoverBounds.y)).toBeLessThan(2);
    expect(fontPopoverBounds.x).toBeGreaterThan(
      fontButtonBounds.x + fontButtonBounds.width,
    );
  }
  await expect(
    page.getByRole('button', { name: 'Excalifont' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Classic' }).click();
  await page.waitForFunction(() =>
    document.fonts.check('16px KaTeX_Main', '123+456=579'),
  );
  await expect(page.getByRole('button', { name: 'Classic' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect
    .poll(() =>
      equation.locator(lowerOperatorLimit).evaluate((limit) => ({
        position: getComputedStyle(limit).position,
        top: getComputedStyle(limit).top,
      })),
    )
    .toEqual({ position: 'static', top: 'auto' });

  const fontAudit = await page.evaluate(() => {
    const faces = [...document.styleSheets].flatMap((sheet) => {
      try {
        return [...sheet.cssRules].filter(
          (rule): rule is CSSFontFaceRule => rule instanceof CSSFontFaceRule,
        );
      } catch {
        return [];
      }
    });
    return {
      choice: document.querySelector<HTMLStyleElement>('#chalkboard-font-faces')
        ?.dataset.workspaceFont,
      sources: faces.map((face) => face.style.getPropertyValue('src')),
      total: faces.length,
      unique: new Set(
        faces.map(
          (face) =>
            `${face.style.fontFamily}|${face.style.fontStyle}|${face.style.fontWeight}`,
        ),
      ).size,
    };
  });
  expect(fontAudit).toMatchObject({ choice: 'classic', total: 20, unique: 20 });
  expect(fontAudit.sources.some((source) => source.includes('v=0.1'))).toBe(
    false,
  );
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('chalkboard:font')))
    .toBe('classic');

  await page.reload();
  await page.getByRole('button', { name: 'Open board menu' }).click();
  await page.getByRole('button', { name: 'Font' }).click();
  await expect(page.getByRole('button', { name: 'Classic' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await page.getByRole('button', { name: 'Export image' }).click();
  const dialog = page.getByRole('dialog', { name: 'Export image' });
  await dialog.getByText('SVG', { exact: true }).click();
  const downloadPromise = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Export SVG' }).click();
  const download = await downloadPromise;
  const path = await download.path();
  if (path === null) throw new Error('Expected an SVG download path');
  const svg = await readFile(path, 'utf8');
  const embedded = [
    ...svg.matchAll(/@font-face\{[^}]*base64,([A-Za-z0-9+/=]+)\)/g),
  ].map((match) =>
    createHash('sha256')
      .update(Buffer.from(match[1] ?? '', 'base64'))
      .digest('hex'),
  );
  const classicDirectory = 'apps/web/src/vendor/mathlive-classic/fonts';
  const expected = await Promise.all(
    (await readdir(classicDirectory))
      .filter((name) => name.endsWith('.woff2'))
      .map(async (name) =>
        createHash('sha256')
          .update(await readFile(`${classicDirectory}/${name}`))
          .digest('hex'),
      ),
  );
  expect(embedded.sort()).toEqual(expected.sort());

  await page.getByRole('button', { name: 'Open board menu' }).click();
  await page.getByRole('button', { name: 'Font' }).click();
  await page.getByRole('button', { name: 'Excalifont' }).click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const style = document.querySelector<HTMLStyleElement>(
          '#chalkboard-font-faces',
        );
        const faces = [...(style?.sheet?.cssRules ?? [])].filter(
          (rule): rule is CSSFontFaceRule => rule instanceof CSSFontFaceRule,
        );
        return {
          choice: style?.dataset.workspaceFont,
          versionedFaces: faces.filter((face) =>
            face.style.getPropertyValue('src').includes('v=0.1'),
          ).length,
          total: faces.length,
        };
      }),
    )
    .toEqual({
      choice: 'excalifont',
      versionedFaces: 20,
      total: 20,
    });

  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Mixed text block tool' }).click();
  const equationBounds = await equation.boundingBox();
  if (equationBounds === null) {
    throw new Error('Expected equation bounds before activating the editor');
  }
  await page.mouse.click(
    equationBounds.x + equationBounds.width / 2,
    equationBounds.y + equationBounds.height / 2,
  );
  const mathField = page.locator('math-field[aria-label="Edit equation"]');
  await expect(mathField).toBeVisible();
  await expect
    .poll(() =>
      mathField.evaluate((field, selector) => {
        const limit = field.shadowRoot?.querySelector(selector);
        return {
          font: field.dataset.workspaceFont,
          position: limit === null ? null : getComputedStyle(limit).position,
          top:
            limit === null
              ? null
              : Number.parseFloat(getComputedStyle(limit).top),
        };
      }, lowerOperatorLimit),
    )
    .toEqual({ font: 'excalifont', position: 'relative', top: -14 });
});
