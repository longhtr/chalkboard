/**
 * When a rendered block is rewritten and redecorated, and when it must not be.
 *
 * `MathElement` rerenders on every camera change, because the camera is a fresh
 * object each pan and zoom. React 19 compares props by reference and writes
 * innerHTML whenever the `dangerouslySetInnerHTML` object differs, without
 * looking inside it, so a fresh `{ __html }` literal per render reparsed every
 * visible block's entire MathLive markup on every frame of every scroll -- and
 * destroyed its decoration, which is why the decoration effect had to run
 * unconditionally to put it back.
 *
 * Holding that object steady while the markup is unchanged stops both. With 56
 * blocks on screen the old cadence cost 4,081 decoration runs across 73 frames
 * and roughly a quarter of a million rectangle reads.
 *
 * These tests pin both halves: nothing is rewritten or redecorated while only
 * the camera moves, and every input that genuinely changes the decoration still
 * redoes it.
 */
import { expect, test } from '@playwright/test';

import { assertValue } from './helpers/assertions';
import { canvasBounds, finishEditing } from './helpers/equationEditor';

const TALL = String.raw`\left[\begin{array}{c}\dfrac{a}{b}\\\dfrac{c}{d}\end{array}\right]`;
const SOURCE = `Prose above\n$${TALL}$\nCost \\$5 and 50\\% of \\{a\\}\n$\\int_0^1 x\\,dx$`;

function equation(id: string, index: number) {
  return {
    backgroundColor: 'transparent',
    createdBy: 'local',
    fontSize: 24,
    height: 260,
    id,
    lineSpacing: 1.2,
    opacity: 1,
    rotation: 0,
    source: SOURCE,
    strokeColor: '#111827',
    strokeWidth: 2,
    type: 'equation',
    width: 300,
    x: -600 + index * 320,
    y: -130,
  };
}

async function seed(page: import('@playwright/test').Page, count = 3) {
  await page.addInitScript(
    ([serialized]) => {
      localStorage.setItem('chalkboard:local-title', 'Cadence');
      localStorage.setItem('chalkboard:local-document', serialized ?? '[]');
      localStorage.setItem('chalkboard:font', 'excalifont');
    },
    [
      JSON.stringify(
        Array.from({ length: count }, (_unused, index) =>
          equation(`block-${index}`, index),
        ),
      ),
    ],
  );
  await page.goto('/');
  await page.locator('.ML__mtable').first().waitFor();
}

/** Everything the decoration pipeline is responsible for putting in the DOM. */
async function decorationState(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const host = document.querySelector('[data-mixed-text-id="block-0"]');
    if (host === null) return null;
    return {
      clearances: [
        ...host.querySelectorAll<HTMLElement>('.mixed-text-line-break'),
      ].map((node) => node.style.getPropertyValue('--line-clearance')),
      excalifont: host.querySelectorAll('[data-excalifont-op]').length,
      lineBreaks: host.querySelectorAll('.mixed-text-line-break').length,
      literalDollar: host.querySelectorAll('.mixed-text-literal-dollar').length,
      literalBrace: host.querySelectorAll('.mixed-text-literal-brace-left')
        .length,
      literalPercent: host.querySelectorAll('.mixed-text-literal-percent')
        .length,
    };
  });
}

/** Counts decoration runs by the one selector only that pipeline asks for. */
async function installDecorationCounter(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    const counts = { decorations: 0, rects: 0 };
    (window as unknown as { counts: typeof counts }).counts = counts;
    const rect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function patched() {
      counts.rects += 1;
      return rect.call(this);
    };
    const all = Element.prototype.querySelectorAll;
    Element.prototype.querySelectorAll = function patched(selector: string) {
      if (selector === '.ML__text') counts.decorations += 1;
      return all.call(this, selector);
    } as typeof all;
  });
}

async function readCounter(page: import('@playwright/test').Page) {
  return page.evaluate(
    () =>
      (window as unknown as { counts: { decorations: number; rects: number } })
        .counts,
  );
}

/** Wheel over the canvas, which is what this workspace zooms on. */
async function moveCamera(page: import('@playwright/test').Page, steps = 12) {
  await page.evaluate(async (count) => {
    const canvas = document.querySelector('.canvas-viewport') ?? document.body;
    for (let step = 0; step < count; step++) {
      canvas.dispatchEvent(
        new WheelEvent('wheel', {
          bubbles: true,
          cancelable: true,
          clientX: 640,
          clientY: 360,
          deltaY: step % 2 === 0 ? 14 : -14,
        }),
      );
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
  }, steps);
}

test('does not redecorate a block while the camera moves', async ({ page }) => {
  await seed(page);
  const before = await decorationState(page);
  expect(before).not.toBeNull();
  assertValue(before, 'decoration state');
  // Proves the fixture actually exercises the pipeline, so a later count of
  // zero cannot pass by decorating nothing at all.
  expect(before.lineBreaks).toBe(3);
  expect(before.literalDollar).toBeGreaterThan(0);
  expect(before.literalPercent).toBeGreaterThan(0);
  expect(before.excalifont).toBeGreaterThan(0);
  expect(before.clearances.filter((value) => value !== '')).toHaveLength(3);

  await installDecorationCounter(page);
  // A rewritten block replaces its children wholesale, so one childList record
  // on the content div is exactly the symptom being ruled out.
  await page.evaluate(() => {
    const content = document.querySelector(
      '[data-mixed-text-id="block-0"] .mixed-text-element__content',
    );
    const state = { rewrites: 0 };
    (window as unknown as { rewrites: typeof state }).rewrites = state;
    if (content === null) return;
    new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === 'childList') state.rewrites += 1;
      }
    }).observe(content, { childList: true, subtree: true });
  });
  await moveCamera(page);

  const counts = await readCounter(page);
  expect(counts.decorations).toBe(0);
  expect(counts.rects).toBeLessThan(200);
  expect(
    await page.evaluate(
      () => (window as unknown as { rewrites: { rewrites: number } }).rewrites,
    ),
  ).toEqual({ rewrites: 0 });

  // Surviving the camera move is the point; the decoration must still be there.
  expect(await decorationState(page)).toEqual(before);
});

test('keeps the clearance in scale-free units across zoom', async ({
  page,
}) => {
  await seed(page, 1);
  const before = await decorationState(page);
  assertValue(before, 'decoration state');

  await moveCamera(page, 6);
  await page.evaluate(async () => {
    const canvas = document.querySelector('.canvas-viewport') ?? document.body;
    for (let step = 0; step < 8; step++) {
      canvas.dispatchEvent(
        new WheelEvent('wheel', {
          bubbles: true,
          cancelable: true,
          clientX: 640,
          clientY: 360,
          deltaY: -20,
        }),
      );
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
  });

  // The clearance is measured in device pixels and stored in em, so a zoom must
  // leave the stored value alone. This is what lets the camera stay out of the
  // effect's dependencies.
  expect((await decorationState(page))?.clearances).toEqual(before.clearances);
});

test('redecorates when the source changes', async ({ page }) => {
  // Built through the editor rather than seeded, because the source change is
  // the point and a block has to be edited to change it.
  await page.goto('/');
  const { bounds } = await canvasBounds(page);
  assertValue(bounds, 'canvas bounds');
  await page.mouse.click(bounds.x + 420, bounds.y + 200);
  await page.locator('.inline-math-editor.is-ready').waitFor();
  await page.keyboard.type('Prose above');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Prose below');
  await finishEditing(page);

  const clearances = () =>
    page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('.mixed-text-line-break')]
        .map((node) => node.style.getPropertyValue('--line-clearance'))
        .filter((value) => value !== ''),
    );
  // Prose only, so nothing overruns and no break span carries a clearance.
  await expect.poll(clearances).toEqual([]);

  const first = page
    .locator('[data-mixed-text-id] .ML__text')
    .filter({ hasText: /^Prose above$/ });
  const box = await first.boundingBox();
  assertValue(box, 'line bounds');
  await page.mouse.click(box.x + box.width - 2, box.y + box.height / 2);
  await page.locator('.inline-math-editor.is-ready').waitFor();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Control+m');
  await page.keyboard.type('\\frac');
  await page.keyboard.press('Space');
  await page.keyboard.type('\\frac');
  await page.keyboard.press('Space');
  await page.keyboard.type('a');
  await page.keyboard.press('Tab');
  await page.keyboard.type('b');
  await page.keyboard.press('Tab');
  await page.keyboard.type('c');
  await finishEditing(page);

  // A tall run now sits between two prose lines, so the rendered block must
  // have been measured again rather than kept as it was.
  await expect.poll(clearances).not.toEqual([]);
});

test('redecorates when the workspace font changes', async ({ page }) => {
  await seed(page, 1);
  const before = await decorationState(page);
  assertValue(before, 'decoration state');

  await page.getByRole('button', { name: 'Open board menu' }).click();
  await page.getByRole('button', { name: 'Font', exact: true }).click();
  await page.getByRole('button', { name: 'Classic' }).click();
  await page.waitForFunction(() =>
    document.fonts.check('16px KaTeX_Main', '123+456=579'),
  );
  await page.keyboard.press('Escape');

  // Both faces draw the same characters, so the tagging is unchanged, but they
  // do not put the same ink in the same place. The clearance is measured, so it
  // has to be measured again against the face that is now installed.
  await expect
    .poll(async () => {
      const after = await decorationState(page);
      return {
        breaks: after?.lineBreaks ?? 0,
        clearances: after?.clearances ?? [],
        tagged: (after?.excalifont ?? 0) > 0,
      };
    })
    .toEqual({
      breaks: before.lineBreaks,
      clearances: expect.arrayContaining([expect.any(String)]),
      tagged: true,
    });

  const after = await decorationState(page);
  assertValue(after, 'decoration state');
  for (const value of after.clearances.filter((entry) => entry !== '')) {
    expect(value).toMatch(/em$/u);
  }
});
