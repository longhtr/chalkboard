/**
 * A caret must follow the pointer along a row of mathematics.
 *
 * Clicking a row resolves through measured geometry, and a row of mathematics
 * has no single height: a fraction is tall, its digits are short, and the caret
 * after a fraction is anchored to the tall box. Judging which boxes belong to
 * the row by height therefore discarded the row's real geometry whenever one
 * thin atom sat on it, and every click on the densest row of a derivation
 * collapsed onto the same one or two offsets -- the row could be seen but not
 * pointed at.
 *
 * The property here is what a reader actually relies on: moving the pointer
 * left to right across a row moves the caret left to right through it, landing
 * in meaningfully different places rather than the same one.
 */
import { expect, test } from '@playwright/test';

import { seedLocalBoard } from './helpers/seedLocalBoard.js';

const DERIVATION = [
  String.raw`Evaluate $\frac{d}{\differentialD\text{z}}\frac{1}{1+e^{-z}}$. Let $u=1+e^{-z}$. `,
  String.raw`Then,$\frac{d}{\differentialD\text{z}}\frac{1}{1+e^{-z}}=\frac{d}{d}\frac{du}{dz}\frac{1}{u}=\frac{d}{du}\frac{1}{u^{}}\frac{du}{dz}$`,
  String.raw`$=\left(-\frac{1}{u^2}\right)\frac{d}{dz}\left(1+e^{-z}\right)=\left(-\frac{1}{1+e^{-z}}\right)\left(-e^{-z}\right)=\frac{e^{-z}}{1+e^{-z}}$`,
].join('\n');

const ELEMENT = {
  backgroundColor: 'transparent',
  createdBy: '6805d9fc-7ca3-4d20-8f69-64360a3490e8',
  fontSize: 30,
  height: 225,
  id: '8158710d-7661-416c-9261-c9b91bb60ed6',
  lineSpacing: 1.2,
  opacity: 1,
  rotation: 0,
  source: DERIVATION,
  sourceFontSize: 27,
  strokeColor: '#1f2937',
  strokeColorDark: '#e6e6ea',
  strokeStyle: 'solid',
  strokeWidth: 2,
  type: 'equation',
  width: 751.95,
  x: -995.4,
  y: -703.2,
};

test('the caret follows the pointer along a dense middle row', async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForURL(/\/local\/([0-9a-f-]{36})$/i);
  const boardId = new URL(page.url()).pathname.split('/').pop() ?? '';
  await seedLocalBoard(page, boardId, [ELEMENT]);
  await page.reload();
  await expect(page.locator('[data-mixed-text-id]')).toBeVisible();

  await page.getByRole('button', { name: 'Mixed text block tool' }).click();
  const block = page.locator('[data-mixed-text-id]');
  const blockBounds = await block.boundingBox();
  expect(blockBounds).not.toBeNull();
  if (blockBounds === null) return;
  await page.mouse.click(blockBounds.x + 40, blockBounds.y + 20);
  await page.locator('.inline-math-editor.is-ready').waitFor();

  // The two line-break markers bracket the middle row.
  const geometry = await page.locator('math-field').evaluate((element) => {
    const markers = [
      ...(element.shadowRoot?.querySelectorAll('.mixed-text-line-break') ?? []),
    ].map((marker) => marker.getBoundingClientRect());
    const base = element.shadowRoot?.querySelector('.ML__base');
    const bounds =
      base instanceof HTMLElement ? base.getBoundingClientRect() : null;
    return {
      left: bounds?.left ?? null,
      markers: markers.map((rect) => ({ bottom: rect.bottom, top: rect.top })),
      right: bounds?.right ?? null,
    };
  });
  expect(geometry.markers).toHaveLength(2);
  expect(geometry.left).not.toBeNull();
  expect(geometry.right).not.toBeNull();
  if (geometry.left === null || geometry.right === null) return;

  const y = (geometry.markers[0]!.bottom + geometry.markers[1]!.top) / 2;
  // The middle of the row's width, away from either end, where every sample is
  // unambiguously inside the row's own writing.
  const from = geometry.left + (geometry.right - geometry.left) * 0.05;
  const to = geometry.left + (geometry.right - geometry.left) * 0.55;
  const samples = 9;

  const positions: number[] = [];
  for (let step = 0; step < samples; step += 1) {
    await page.mouse.click(from + ((to - from) * step) / (samples - 1), y);
    positions.push(
      await page.evaluate(() => {
        const element = document.querySelector('math-field');
        return element === null
          ? -1
          : (element as unknown as { position: number }).position;
      }),
    );
  }

  // Moving right must never move the caret left.
  expect(
    positions.flatMap((position, index) =>
      index > 0 && position < positions[index - 1]!
        ? [`${index}:${position} after ${index - 1}:${positions[index - 1]}`]
        : [],
    ),
    `caret ran backwards across the row: ${positions.join(',')}`,
  ).toEqual([]);

  // Distinct destinations are the point: the defect left nine clicks resolving
  // to two offsets, so the row could not be pointed at.
  expect(
    new Set(positions).size,
    `too few distinct caret positions across the row: ${positions.join(',')}`,
  ).toBeGreaterThanOrEqual(6);
});

test('a click anywhere in a row keeps the caret in that row', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.goto('/');
  await page.waitForURL(/\/local\/([0-9a-f-]{36})$/i);
  const boardId = new URL(page.url()).pathname.split('/').pop() ?? '';
  await seedLocalBoard(page, boardId, [ELEMENT]);
  await page.reload();
  await expect(page.locator('[data-mixed-text-id]')).toBeVisible();

  await page.getByRole('button', { name: 'Mixed text block tool' }).click();
  const block = page.locator('[data-mixed-text-id]');
  const box = await block.boundingBox();
  expect(box).not.toBeNull();
  if (box === null) return;
  await page.mouse.click(box.x + 40, box.y + 20);
  await page.locator('.inline-math-editor.is-ready').waitFor();

  // Each row's band on screen, beside the offsets it is allowed to hold.
  const model = await page.locator('math-field').evaluate((element) => {
    const field = element as unknown as {
      getValue(range: [number, number]): string;
      lastOffset: number;
    };
    const breaks: number[] = [];
    for (let offset = 0; offset < field.lastOffset; offset += 1) {
      if (field.getValue([offset, offset + 1]) === '⁣') breaks.push(offset);
    }
    const markers = [
      ...(element.shadowRoot?.querySelectorAll('.mixed-text-line-break') ?? []),
    ].map((marker) => marker.getBoundingClientRect());
    const base = element.shadowRoot?.querySelector('.ML__base');
    const bounds =
      base instanceof HTMLElement ? base.getBoundingClientRect() : null;
    return {
      base: bounds === null ? null : { left: bounds.left, right: bounds.right },
      breaks,
      lastOffset: field.lastOffset,
      markers: markers.map((rect) => ({ bottom: rect.bottom, top: rect.top })),
    };
  });
  expect(model.base).not.toBeNull();
  expect(model.breaks).toHaveLength(model.markers.length);
  if (model.base === null) return;

  const escaped: string[] = [];
  for (const [row, marker] of model.markers.entries()) {
    // A point safely inside this row's band, clear of both its neighbours.
    const above = row === 0 ? null : model.markers[row - 1]!;
    const y =
      above === null ? marker.top - 30 : (above.bottom + marker.top) / 2;
    const start = row === 0 ? 0 : model.breaks[row - 1]! + 1;
    const end = model.breaks[row]!;
    for (let step = 0; step <= 12; step += 1) {
      const x =
        model.base.left +
        ((model.base.right - model.base.left) * step) / 12 -
        1;
      await page.mouse.click(Math.max(model.base.left + 1, x), y);
      const position = await page.evaluate(() => {
        const element = document.querySelector('math-field');
        return element === null
          ? -1
          : (element as unknown as { position: number }).position;
      });
      if (position < start || position > end) {
        escaped.push(
          `row ${row} x=${Math.round(x)} -> ${position} (${start}..${end})`,
        );
      }
    }
  }

  // Which row the reader pointed at is something they can see. Nearness alone
  // used to override it: past the end of a short row the closest rendered atom
  // belongs to the row beneath, so the caret moved down a row.
  expect(escaped, 'clicks that left the row they were made in').toEqual([]);
});

test('rows survive editing, history and a commit', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/');
  await page.waitForURL(/\/local\/([0-9a-f-]{36})$/i);
  const boardId = new URL(page.url()).pathname.split('/').pop() ?? '';
  await seedLocalBoard(page, boardId, [ELEMENT]);
  await page.reload();
  await expect(page.locator('[data-mixed-text-id]')).toBeVisible();

  const renderedBreaks = () =>
    page.locator('[data-mixed-text-id] .mixed-text-line-break').count();
  const fieldBreaks = () =>
    page
      .locator('math-field')
      .evaluate(
        (element) =>
          (element.shadowRoot?.querySelectorAll('.mixed-text-line-break') ?? [])
            .length,
      );

  expect(await renderedBreaks(), 'rows before editing').toBe(2);

  await page.getByRole('button', { name: 'Mixed text block tool' }).click();
  const block = page.locator('[data-mixed-text-id]');
  const box = await block.boundingBox();
  expect(box).not.toBeNull();
  if (box === null) return;
  await page.mouse.click(box.x + 40, box.y + 20);
  await page.locator('.inline-math-editor.is-ready').waitFor();
  expect(await fieldBreaks(), 'rows on activation').toBe(2);

  // A reader's ordinary sequence: point somewhere, write, move, undo, redo.
  const steps: [string, () => Promise<unknown>][] = [
    [
      'click the middle row',
      () => page.mouse.click(box.x + box.width / 2, box.y + box.height / 2),
    ],
    ['type', () => page.keyboard.type('x')],
    ['arrow right', () => page.keyboard.press('ArrowRight')],
    ['arrow down', () => page.keyboard.press('ArrowDown')],
    ['type again', () => page.keyboard.type('y')],
    ['undo', () => page.keyboard.press('Control+z')],
    ['undo again', () => page.keyboard.press('Control+z')],
    ['redo', () => page.keyboard.press('Control+Shift+z')],
    [
      'click the last row',
      () => page.mouse.click(box.x + box.width / 2, box.y + box.height - 12),
    ],
  ];
  for (const [name, run] of steps) {
    await run();
    await page.waitForTimeout(150);
    expect(await fieldBreaks(), `rows after ${name}`).toBe(2);
  }

  // Committing is where rows were most at risk: MathLive can normalize adjacent
  // rows into one run as focus leaves the field without another input event.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  expect(await renderedBreaks(), 'rows after commit').toBe(2);

  await page.reload();
  await expect(page.locator('[data-mixed-text-id]')).toBeVisible();
  expect(await renderedBreaks(), 'rows after reload').toBe(2);
});
