/** Visible shape, straight/orthogonal/freehand/Bézier path, arrowhead, grid, and gesture stories. */
import { expect, test } from '@playwright/test';

import { assertValue } from './helpers/assertions';

test('changes fill colors when the workspace starts in dark mode', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('chalkboard:theme', 'dark');
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Shape tool' }).click();

  const darkFill = page.getByRole('button', { name: 'Use #5c3130 fill' });
  await darkFill.click();
  await expect(darkFill).toHaveClass(/is-active/);

  const canvas = page.getByRole('application', {
    name: 'Chalkboard drawing canvas',
  });
  const bounds = await canvas.boundingBox();
  assertValue(bounds, 'drawing canvas bounds');
  await page.mouse.move(bounds.x + 320, bounds.y + 240);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 440, bounds.y + 320);
  await page.mouse.up();

  await expect
    .poll(() =>
      page.evaluate(() => {
        const boardId = window.location.pathname.split('/').at(-1) ?? '';
        const elements = JSON.parse(
          localStorage.getItem(`chalkboard:local-document:${boardId}`) ?? '[]',
        ) as { backgroundColor?: string; backgroundColorDark?: string }[];
        return elements[0];
      }),
    )
    .toMatchObject({
      backgroundColor: 'transparent',
      backgroundColorDark: '#5c3130',
    });
});

test('controls patterned-stroke gaps and partial ellipse arcs', async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForURL(/\/local\/[0-9a-f-]{36}$/iu);
  const canvas = page.getByRole('application', {
    name: 'Chalkboard drawing canvas',
  });
  const bounds = await canvas.boundingBox();
  assertValue(bounds, 'drawing canvas bounds');
  const center = {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  };

  await page.getByRole('button', { name: 'Shape tool' }).click();
  await page
    .getByRole('button', { name: 'Use circle / ellipse shape' })
    .click();
  await expect(
    page.getByRole('group', { name: 'Ellipse arc range' }),
  ).toBeVisible();
  const arcStartSlider = page.getByRole('slider', {
    name: 'Arc start angle slider',
  });
  const arcEndSlider = page.getByRole('slider', {
    name: 'Arc end angle slider',
  });
  await expect(arcStartSlider).toHaveValue('0');
  await expect(arcStartSlider).toHaveAttribute('min', '0');
  await expect(arcStartSlider).toHaveAttribute('max', '360');
  await expect(arcEndSlider).toHaveAttribute('min', '0');
  await expect(arcEndSlider).toHaveAttribute('max', '360');
  await page.getByRole('spinbutton', { name: 'Arc start angle' }).fill('300');
  await page
    .getByRole('spinbutton', { name: 'Arc start angle' })
    .press('Enter');
  await page.getByRole('spinbutton', { name: 'Arc end angle' }).fill('60');
  await page.getByRole('spinbutton', { name: 'Arc end angle' }).press('Enter');
  await expect(page.locator('.dual-range')).toHaveClass(/is-wrapped/);
  await page.getByRole('button', { name: 'Use #a5d8ff fill' }).click();

  await expect(
    page.getByRole('slider', { name: 'Gap between dashes slider' }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Use dashed stroke' }).click();
  const dashGap = page.getByRole('spinbutton', {
    name: 'Gap between dashes value',
  });
  await expect(dashGap).toBeVisible();
  await dashGap.fill('17');
  await dashGap.press('Enter');

  await page.mouse.move(center.x - 80, center.y - 80);
  await page.mouse.down();
  await page.mouse.move(center.x + 80, center.y + 80, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const elements = JSON.parse(
          localStorage.getItem(
            `chalkboard:local-document:${window.location.pathname.split('/').at(-1) ?? ''}`,
          ) ?? '[]',
        ) as Record<string, unknown>[];
        return elements[0];
      }),
    )
    .toMatchObject({
      backgroundColor: '#a5d8ff',
      ellipseEndAngle: 60,
      ellipseStartAngle: 300,
      shapeKind: 'ellipse',
      strokeDashGap: 17,
      strokeStyle: 'dashed',
    });

  // A 300°–60° arc wraps through 0°. Its fill closes directly between the
  // endpoints, so the right cap answers hit-testing without center spokes.
  await page.getByRole('button', { name: 'Selection tool' }).click();
  const deleteSelection = page.getByRole('button', {
    name: 'Delete selection',
  });
  await page.mouse.click(center.x - 200, center.y - 180);
  await expect(deleteSelection).toBeDisabled();
  await page.mouse.click(center.x - 80, center.y);
  await expect(deleteSelection).toBeDisabled();
  await page.mouse.click(center.x, center.y);
  await expect(deleteSelection).toBeDisabled();
  await page.mouse.click(center.x + 60, center.y);
  await expect(deleteSelection).toBeEnabled();
  await expect(
    page.getByRole('spinbutton', { name: 'Arc start angle' }),
  ).toHaveValue('300');
  await expect(
    page.getByRole('spinbutton', { name: 'Arc end angle' }),
  ).toHaveValue('60');
  await expect(
    page.getByRole('button', { name: 'Use transparent fill' }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Line / curve tool' }).click();
  await expect(
    page.getByRole('spinbutton', { name: 'Gap between dashes value' }),
  ).toHaveValue('17');
  await page.getByRole('button', { name: 'Use dotted stroke' }).click();
  await expect(
    page.getByRole('spinbutton', { name: 'Gap between dots value' }),
  ).toHaveValue('17');
  await page.mouse.move(center.x + 140, center.y - 60);
  await page.mouse.down();
  await page.mouse.move(center.x + 260, center.y + 20, { steps: 5 });
  await page.mouse.up();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const elements = JSON.parse(
          localStorage.getItem(
            `chalkboard:local-document:${window.location.pathname.split('/').at(-1) ?? ''}`,
          ) ?? '[]',
        ) as Record<string, unknown>[];
        return elements[1];
      }),
    )
    .toMatchObject({ strokeDashGap: 17, strokeStyle: 'dotted', type: 'line' });
});

test('nudges a selected object with Arrow keys and preserves undo and redo', async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForURL(/\/local\/[0-9a-f-]{36}$/iu);
  const canvas = page.getByRole('application', {
    name: 'Chalkboard drawing canvas',
  });
  const bounds = await canvas.boundingBox();
  assertValue(bounds, 'drawing canvas bounds');

  await page.getByRole('button', { name: 'Shape tool' }).click();
  await page.mouse.move(bounds.x + 400, bounds.y + 220);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 500, bounds.y + 300, { steps: 5 });
  await page.mouse.up();
  await page.getByRole('button', { name: 'Selection tool' }).click();

  const storedPosition = () =>
    page.evaluate(() => {
      const elements = JSON.parse(
        localStorage.getItem(
          `chalkboard:local-document:${window.location.pathname.split('/').at(-1) ?? ''}`,
        ) ?? '[]',
      ) as { x: number; y: number }[];
      const first = elements[0];
      return first === undefined ? null : { x: first.x, y: first.y };
    });
  await expect.poll(storedPosition).not.toBeNull();
  const initial = await storedPosition();
  assertValue(initial, 'stored shape position');

  await page.keyboard.press('ArrowRight');
  await expect.poll(storedPosition).toEqual({ x: initial.x + 1, y: initial.y });

  await page.keyboard.press('Shift+ArrowDown');
  await expect
    .poll(storedPosition)
    .toEqual({ x: initial.x + 1, y: initial.y + 10 });

  await page.keyboard.press('Control+z');
  await expect.poll(storedPosition).toEqual({ x: initial.x + 1, y: initial.y });
  await page.keyboard.press('Control+Shift+z');
  await expect
    .poll(storedPosition)
    .toEqual({ x: initial.x + 1, y: initial.y + 10 });
});

test('creates two editable endpoint handles for a single Straight segment', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Line / curve tool' }).click();
  const canvas = page.getByRole('application', {
    name: 'Chalkboard drawing canvas',
  });
  const bounds = await canvas.boundingBox();
  assertValue(bounds, 'drawing canvas bounds');
  const start = { x: bounds.x + 410, y: bounds.y + 240 };
  const end = { x: start.x + 120, y: start.y + 70 };

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 5 });
  await page.mouse.up();

  const straightState = () =>
    page.evaluate(() => {
      const elements = JSON.parse(
        localStorage.getItem(
          `chalkboard:local-document:${window.location.pathname.split('/').at(-1) ?? ''}`,
        ) ?? '[]',
      ) as {
        height: number;
        pathKind?: string;
        segments?: unknown[];
        width: number;
        x: number;
        y: number;
      }[];
      const line = elements[0];
      return line === undefined
        ? null
        : {
            count: elements.length,
            height: line.height,
            pathKind: line.pathKind,
            segmentCount: line.segments?.length,
            width: line.width,
            x: line.x,
            y: line.y,
          };
    });
  await expect.poll(straightState).not.toBeNull();
  const initial = await straightState();
  assertValue(initial, 'simple Straight state');
  expect(initial).toMatchObject({
    count: 1,
    height: 70,
    pathKind: 'straight',
    segmentCount: 1,
    width: 120,
  });

  // The first endpoint is a handle, not the beginning of a second path.
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 20, start.y + 10, { steps: 5 });
  await page.mouse.up();
  const firstMoved = {
    ...initial,
    height: initial.height - 10,
    width: initial.width - 20,
    x: initial.x + 20,
    y: initial.y + 10,
  };
  await expect.poll(straightState).toEqual(firstMoved);

  // The opposite endpoint independently edits the same one-segment path.
  await page.mouse.move(end.x, end.y);
  await page.mouse.down();
  await page.mouse.move(end.x + 30, end.y - 20, { steps: 5 });
  await page.mouse.up();
  await expect.poll(straightState).toEqual({
    ...firstMoved,
    height: initial.height - 30,
    width: initial.width + 10,
  });

  await page.keyboard.press('Control+z');
  await expect.poll(straightState).toEqual(firstMoved);
  await page.keyboard.press('Control+z');
  await expect.poll(straightState).toEqual(initial);
});

test('continues, snaps, and edits connected Straight lines', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Line / curve tool' }).click();
  await expect(page.getByRole('note')).toContainText(
    'While drawing, press Space or tap with a second finger to add another segment.',
  );

  const canvas = page.getByRole('application', {
    name: 'Chalkboard drawing canvas',
  });
  const bounds = await canvas.boundingBox();
  assertValue(bounds, 'drawing canvas bounds');
  const center = {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  };
  const start = { x: center.x - 160, y: center.y - 80 };
  const firstJoin = { x: center.x - 40, y: center.y - 80 };
  const secondJoin = { x: center.x - 40, y: center.y + 60 };

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(firstJoin.x, firstJoin.y, { steps: 4 });
  await page.keyboard.press('Space');
  await page.mouse.move(secondJoin.x, secondJoin.y, { steps: 4 });
  await page.keyboard.press('Space');
  await page.mouse.move(start.x + 8, start.y + 5, { steps: 4 });
  await page.mouse.up();

  const connectedState = () =>
    page.evaluate(() => {
      const elements = JSON.parse(
        localStorage.getItem(
          `chalkboard:local-document:${window.location.pathname.split('/').at(-1) ?? ''}`,
        ) ?? '[]',
      ) as {
        height: number;
        pathKind?: string;
        segments?: { end: { x: number; y: number } }[];
        width: number;
      }[];
      const line = elements[0];
      return line === undefined
        ? null
        : {
            endpoints: line.segments?.map(({ end }) => end),
            height: line.height,
            pathKind: line.pathKind,
            width: line.width,
          };
    });
  const original = {
    endpoints: [
      { x: 120, y: 0 },
      { x: 120, y: 140 },
      { x: 0, y: 0 },
    ],
    height: 0,
    pathKind: 'straight',
    width: 0,
  };
  await expect.poll(connectedState).toEqual(original);
  await expect(
    page.getByRole('button', { name: 'Delete selection' }),
  ).toBeEnabled();

  await page.keyboard.press('Control+z');
  await expect.poll(connectedState).toBeNull();
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(connectedState).toEqual(original);

  // Redo restores the just-created path's direct vertex handles too.
  await page.mouse.move(firstJoin.x, firstJoin.y);
  await page.mouse.down();
  await page.mouse.move(firstJoin.x + 30, firstJoin.y + 30, { steps: 5 });
  await page.mouse.up();
  const moved = {
    ...original,
    endpoints: [
      { x: 150, y: 30 },
      { x: 120, y: 140 },
      { x: 0, y: 0 },
    ],
  };
  await expect.poll(connectedState).toEqual(moved);

  await page.keyboard.press('Control+z');
  await expect.poll(connectedState).toEqual(original);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(connectedState).toEqual(moved);
  await page.keyboard.press('Control+z');
  await page.mouse.move(firstJoin.x, firstJoin.y);
  await page.mouse.down();
  await page.mouse.move(firstJoin.x + 30, firstJoin.y + 30, { steps: 5 });
  await page.mouse.up();
  await expect.poll(connectedState).toEqual(moved);
});

test('constructs cubic Bézier paths with editable control handles', async ({
  page,
}) => {
  await page.goto('/');
  const lineTool = page.getByRole('button', { name: 'Line / curve tool' });
  await lineTool.click();
  const pathTypes = page.getByRole('group', { name: 'Path type' });
  await expect(pathTypes.getByRole('button')).toHaveCount(4);
  await expect(pathTypes.getByRole('button', { name: /arc/i })).toHaveCount(0);
  await expect(pathTypes.getByRole('button', { name: /s-curve/i })).toHaveCount(
    0,
  );
  await page.getByRole('button', { name: 'Use #e03131 stroke' }).click();
  await page.getByRole('button', { name: 'Use 4 pixel stroke weight' }).click();
  await page.getByRole('button', { name: 'Use dashed stroke' }).click();

  const canvas = page.getByRole('application', {
    name: 'Chalkboard drawing canvas',
  });
  const bounds = await canvas.boundingBox();
  assertValue(bounds, 'drawing canvas bounds');
  const center = {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  };
  const draw = async (
    startX: number,
    endX: number,
    startY: number,
    endY: number,
  ) => {
    await page.mouse.move(center.x + startX, center.y + startY);
    await page.mouse.down();
    await page.mouse.move(center.x + endX, center.y + endY, { steps: 6 });
    await page.mouse.up();
  };

  await draw(-300, -140, -120, -40);
  const fittedCurveType = pathTypes.getByRole('button', {
    name: 'Use spline path',
  });
  await fittedCurveType.click();
  await expect(fittedCurveType).toHaveAttribute(
    'title',
    'Spline — Draw freely. On release, your stroke is fitted with smooth curves. Refine it with its handles.',
  );
  const continuityControls = page.getByRole('group', {
    name: 'Spline continuity',
  });
  const c0Continuity = continuityControls.getByRole('button', {
    name: 'Use C0 spline continuity',
  });
  const c1Continuity = continuityControls.getByRole('button', {
    name: 'Use C1 spline continuity',
  });
  const c2Continuity = continuityControls.getByRole('button', {
    name: 'Use C2 spline continuity',
  });
  await expect(c1Continuity).toHaveAttribute('aria-pressed', 'true');
  await c0Continuity.click();
  await expect(c0Continuity).toHaveAttribute('aria-pressed', 'true');
  await c2Continuity.click();
  await expect(c2Continuity).toHaveAttribute('aria-pressed', 'true');
  const maximumControls = page.getByRole('group', {
    name: 'Maximum curves',
  });
  const automaticSegments = maximumControls.getByRole('button', {
    name: 'Automatically choose curve count',
  });
  const maximumCurves = maximumControls.getByRole('slider', {
    name: 'Maximum curves slider',
  });
  await expect(maximumCurves).toHaveValue('4');
  await expect(automaticSegments).toHaveAttribute('aria-pressed', 'true');
  await expect(maximumCurves).toBeDisabled();
  const accuracy = page.getByRole('slider', {
    name: 'Automatic fitting accuracy slider',
  });
  await expect(accuracy).toHaveValue('1');
  await automaticSegments.click();
  await expect(automaticSegments).toHaveAttribute('aria-pressed', 'false');
  await maximumCurves.fill('4');
  await automaticSegments.click();
  await expect(automaticSegments).toHaveAttribute('aria-pressed', 'true');
  await expect(maximumCurves).toBeDisabled();
  await accuracy.fill('4');
  await automaticSegments.click();
  await expect(automaticSegments).toHaveAttribute('aria-pressed', 'false');
  await expect(accuracy).toHaveCount(0);
  await expect(maximumCurves).toBeEnabled();
  await expect(maximumCurves).toHaveValue('4');
  const arrowheads = page.getByRole('group', { name: 'Path arrowheads' });
  await expect(
    arrowheads.getByRole('button', { name: 'Use no arrows' }),
  ).toHaveAttribute('aria-pressed', 'true');
  const endArrow = arrowheads.getByRole('button', { name: 'Use end arrow' });
  await endArrow.click();
  await expect(endArrow).toHaveAttribute('aria-pressed', 'true');
  const doubleArrow = arrowheads.getByRole('button', {
    name: 'Use double arrow',
  });
  await doubleArrow.click();
  await expect(doubleArrow).toHaveAttribute('aria-pressed', 'true');
  await page.mouse.move(center.x - 100, center.y - 100);
  await page.mouse.down();
  for (const point of [
    { x: -50, y: -160 },
    { x: 0, y: -70 },
    { x: 50, y: -150 },
    { x: 100, y: -100 },
  ]) {
    await page.mouse.move(center.x + point.x, center.y + point.y, { steps: 5 });
  }
  await page.mouse.up();

  await expect(lineTool).toHaveAttribute('data-path-kind', 'bezier');
  await expect
    .poll(() =>
      page.evaluate(() => {
        const elements = JSON.parse(
          localStorage.getItem(
            `chalkboard:local-document:${window.location.pathname.split('/').at(-1) ?? ''}`,
          ) ?? '[]',
        ) as { segments?: unknown[]; splineContinuity?: string }[];
        return elements[1]?.segments?.length ?? 0;
      }),
    )
    .toBeGreaterThan(1);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const elements = JSON.parse(
          localStorage.getItem(
            `chalkboard:local-document:${window.location.pathname.split('/').at(-1) ?? ''}`,
          ) ?? '[]',
        ) as { segments?: unknown[] }[];
        return elements[1]?.segments?.length ?? Number.POSITIVE_INFINITY;
      }),
    )
    .toBe(4);
  await expect
    .poll(() =>
      page.evaluate(() =>
        JSON.parse(localStorage.getItem('chalkboard:bezier-fit-v2') ?? 'null'),
      ),
    )
    .toEqual({ accuracy: 4, continuity: 'c2', maxSegments: 4 });

  await expect(
    page.getByRole('button', { name: 'Delete selection' }),
  ).toBeEnabled();

  const firstControl = await page.evaluate(() => {
    const elements = JSON.parse(
      localStorage.getItem(
        `chalkboard:local-document:${window.location.pathname.split('/').at(-1) ?? ''}`,
      ) ?? '[]',
    ) as {
      segments: { control1: { x: number; y: number } }[];
      x: number;
      y: number;
    }[];
    const line = elements[1];
    const control = line?.segments[0]?.control1;
    if (line === undefined || control === undefined) return null;
    return {
      relativeY: control.y,
      x: line.x + control.x,
      y: line.y + control.y,
    };
  });
  assertValue(firstControl, 'first Bézier control point');
  await page.mouse.move(center.x + firstControl.x, center.y + firstControl.y);
  await page.mouse.down();
  await page.mouse.move(
    center.x + firstControl.x + 20,
    center.y + firstControl.y - 40,
    { steps: 5 },
  );
  await page.mouse.up();

  await expect
    .poll(() =>
      page.evaluate(() => {
        const elements = JSON.parse(
          localStorage.getItem(
            `chalkboard:local-document:${window.location.pathname.split('/').at(-1) ?? ''}`,
          ) ?? '[]',
        ) as {
          arrowheads?: string;
          pathKind: string;
          segments: { control1: { y: number } }[];
          splineContinuity?: string;
          strokeColor: string;
          strokeStyle: string;
          strokeWidth: number;
          type: string;
        }[];
        const line = elements[1];
        return line === undefined
          ? null
          : {
              arrowheads: line.arrowheads,
              controlY: Math.round(line.segments[0]?.control1.y ?? 0),
              pathKind: line.pathKind,
              segmentCount: line.segments.length,
              splineContinuity: line.splineContinuity,
              strokeColor: line.strokeColor,
              strokeStyle: line.strokeStyle,
              strokeWidth: line.strokeWidth,
              type: line.type,
            };
      }),
    )
    .toMatchObject({
      arrowheads: 'both',
      controlY: expect.any(Number),
      pathKind: 'bezier',
      splineContinuity: 'c2',
      strokeColor: '#e03131',
      strokeStyle: 'dashed',
      strokeWidth: 4,
      type: 'line',
    });
  await expect
    .poll(() =>
      page.evaluate(
        ({ expectedY }) => {
          const elements = JSON.parse(
            localStorage.getItem(
              `chalkboard:local-document:${window.location.pathname.split('/').at(-1) ?? ''}`,
            ) ?? '[]',
          ) as { segments?: { control1: { y: number } }[] }[];
          return Math.abs(
            (elements[1]?.segments?.[0]?.control1.y ?? Infinity) - expectedY,
          );
        },
        { expectedY: firstControl.relativeY - 40 },
      ),
    )
    .toBeLessThanOrEqual(1);

  const controlOffsetFromOriginal = () =>
    page.evaluate(
      ({ expectedY }) => {
        const elements = JSON.parse(
          localStorage.getItem(
            `chalkboard:local-document:${window.location.pathname.split('/').at(-1) ?? ''}`,
          ) ?? '[]',
        ) as { segments?: { control1: { y: number } }[] }[];
        return {
          count: elements.length,
          offset:
            Math.round(
              ((elements[1]?.segments?.[0]?.control1.y ?? Infinity) -
                expectedY) *
                1000,
            ) / 1000,
        };
      },
      { expectedY: firstControl.relativeY },
    );
  const firstMovedOffset = await controlOffsetFromOriginal();
  expect(firstMovedOffset.count).toBe(2);
  expect(Math.abs(firstMovedOffset.offset + 40)).toBeLessThanOrEqual(1);
  await page.keyboard.press('Control+z');
  await expect.poll(controlOffsetFromOriginal).toEqual({ count: 2, offset: 0 });
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(controlOffsetFromOriginal).toEqual(firstMovedOffset);
  await page.keyboard.press('Control+z');
  await page.mouse.move(center.x + firstControl.x, center.y + firstControl.y);
  await page.mouse.down();
  await page.mouse.move(
    center.x + firstControl.x + 20,
    center.y + firstControl.y - 40,
    { steps: 5 },
  );
  await page.mouse.up();
  await expect
    .poll(async () => {
      const result = await controlOffsetFromOriginal();
      return {
        count: result.count,
        withinOnePixel: Math.abs(result.offset + 40) <= 1,
      };
    })
    .toEqual({ count: 2, withinOnePixel: true });

  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Selection tool' }).click();
  await page.mouse.click(center.x - 100, center.y - 100);
  await expect(
    page.getByRole('button', { name: 'Delete selection' }),
  ).toBeEnabled();
  await expect(page.getByRole('group', { name: 'Path type' })).toBeVisible();
  await expect(
    page.getByRole('group', { name: 'Spline continuity' }),
  ).toBeVisible();
  await expect(page.getByRole('group', { name: 'Maximum curves' })).toHaveCount(
    0,
  );
});

test('fits freehand strokes with connected orthogonal lines', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Line / curve tool' }).click();
  const orthogonal = page.getByRole('button', {
    name: 'Use orthogonal path',
  });
  await orthogonal.click();
  await expect(orthogonal).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('group', { name: 'Maximum curves' })).toHaveCount(
    0,
  );
  await expect(page.getByRole('group', { name: 'Maximum lines' })).toHaveCount(
    0,
  );

  const canvas = page.getByRole('application', {
    name: 'Chalkboard drawing canvas',
  });
  const bounds = await canvas.boundingBox();
  assertValue(bounds, 'drawing canvas bounds');
  const center = {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  };
  await page.mouse.move(center.x - 180, center.y - 80);
  await page.mouse.down();
  for (const point of [
    { x: -100, y: -78 },
    { x: -20, y: -82 },
    { x: 0, y: -20 },
    { x: 3, y: 60 },
    { x: 80, y: 63 },
    { x: 160, y: 60 },
  ]) {
    await page.mouse.move(center.x + point.x, center.y + point.y, { steps: 8 });
  }
  await page.mouse.up();

  await expect
    .poll(() =>
      page.evaluate(() => {
        const elements = JSON.parse(
          localStorage.getItem(
            `chalkboard:local-document:${window.location.pathname.split('/').at(-1) ?? ''}`,
          ) ?? '[]',
        ) as {
          pathKind?: string;
          segments?: {
            control1: { x: number; y: number };
            control2: { x: number; y: number };
            end: { x: number; y: number };
          }[];
        }[];
        const path = elements[0];
        if (path?.pathKind !== 'orthogonal' || path.segments === undefined) {
          return null;
        }
        let previous = { x: 0, y: 0 };
        let previousOrientation: 'horizontal' | 'vertical' | null = null;
        const vertices = [previous];
        const connectedOrthogonalSegments = path.segments.every((segment) => {
          const horizontal =
            previous.y === segment.control1.y &&
            previous.y === segment.control2.y &&
            previous.y === segment.end.y;
          const vertical =
            previous.x === segment.control1.x &&
            previous.x === segment.control2.x &&
            previous.x === segment.end.x;
          const orientation = horizontal
            ? 'horizontal'
            : vertical
              ? 'vertical'
              : null;
          const turnsAtRightAngle =
            orientation !== null && orientation !== previousOrientation;
          previousOrientation = orientation;
          previous = segment.end;
          vertices.push(previous);
          return turnsAtRightAngle;
        });
        const horizontalExtent = Math.max(
          12,
          Math.max(...vertices.map(({ x }) => x)) -
            Math.min(...vertices.map(({ x }) => x)),
        );
        const verticalExtent = Math.max(
          12,
          Math.max(...vertices.map(({ y }) => y)) -
            Math.min(...vertices.map(({ y }) => y)),
        );
        const normalizedLengths = path.segments.map((segment, index) => {
          const start = vertices[index] ?? { x: 0, y: 0 };
          return segment.end.y === start.y
            ? Math.abs(segment.end.x - start.x) / horizontalExtent
            : Math.abs(segment.end.y - start.y) / verticalExtent;
        });
        return {
          connectedOrthogonalSegments,
          hasFittedLines: path.segments.length > 0,
          minimumLengthRatio:
            Math.min(...normalizedLengths) >=
            Math.max(...normalizedLengths) / 5,
          pathKind: path.pathKind,
        };
      }),
    )
    .toMatchObject({
      connectedOrthogonalSegments: true,
      hasFittedLines: true,
      minimumLengthRatio: true,
      pathKind: 'orthogonal',
    });

  const firstTurn = await page.evaluate(() => {
    const elements = JSON.parse(
      localStorage.getItem(
        `chalkboard:local-document:${window.location.pathname.split('/').at(-1) ?? ''}`,
      ) ?? '[]',
    ) as {
      segments?: { end: { x: number; y: number } }[];
      x: number;
      y: number;
    }[];
    const line = elements[0];
    const end = line?.segments?.[0]?.end;
    return line === undefined || end === undefined
      ? null
      : {
          original: JSON.stringify(line.segments),
          x: line.x + end.x,
          y: line.y + end.y,
        };
  });
  assertValue(firstTurn, 'first orthogonal turn');
  const dragFirstTurn = async () => {
    await page.mouse.move(center.x + firstTurn.x, center.y + firstTurn.y);
    await page.mouse.down();
    await page.mouse.move(
      center.x + firstTurn.x + 30,
      center.y + firstTurn.y + 20,
      {
        steps: 5,
      },
    );
    await page.mouse.up();
  };
  const orthogonalState = () =>
    page.evaluate(() => {
      const elements = JSON.parse(
        localStorage.getItem(
          `chalkboard:local-document:${window.location.pathname.split('/').at(-1) ?? ''}`,
        ) ?? '[]',
      ) as { segments?: unknown[] }[];
      return {
        count: elements.length,
        segments: JSON.stringify(elements[0]?.segments),
      };
    });
  await dragFirstTurn();
  await expect.poll(orthogonalState).not.toEqual({
    count: 1,
    segments: firstTurn.original,
  });
  const movedState = await orthogonalState();
  await page.keyboard.press('Control+z');
  await expect.poll(orthogonalState).toEqual({
    count: 1,
    segments: firstTurn.original,
  });
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(orthogonalState).toEqual(movedState);
  await page.keyboard.press('Control+z');
  await dragFirstTurn();
  await expect.poll(orthogonalState).toEqual(movedState);
});

test('migrates legacy curve presets to equivalent editable Bézier paths', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const base = {
      backgroundColor: 'transparent',
      createdBy: 'local',
      height: 0,
      opacity: 1,
      rotation: 0,
      strokeColor: '#1f2937',
      strokeStyle: 'solid',
      strokeWidth: 2,
      type: 'line',
      width: 120,
      x: -60,
    };
    localStorage.setItem(
      'chalkboard:local-document',
      JSON.stringify([
        { ...base, id: 'legacy-arc', pathKind: 'arc', y: -80 },
        { ...base, id: 'legacy-s-curve', pathKind: 's-curve', y: 80 },
      ]),
    );
  });
  await page.goto('/');

  await expect
    .poll(() =>
      page.evaluate(() => {
        const elements = JSON.parse(
          localStorage.getItem(
            `chalkboard:local-document:${window.location.pathname.split('/').at(-1) ?? ''}`,
          ) ?? '[]',
        ) as {
          pathKind: string;
          segments?: {
            control1: { x: number; y: number };
            control2: { x: number; y: number };
          }[];
        }[];
        return elements.map(({ pathKind, segments }) => ({
          control1: segments?.[0]?.control1,
          control2: segments?.[0]?.control2,
          pathKind,
          segmentCount: segments?.length ?? 0,
        }));
      }),
    )
    .toEqual([
      {
        control1: { x: 40, y: 28 },
        control2: { x: 80, y: 28 },
        pathKind: 'bezier',
        segmentCount: 1,
      },
      {
        control1: { x: 40, y: 42 },
        control2: { x: 80, y: -42 },
        pathKind: 'bezier',
        segmentCount: 1,
      },
    ]);
});

test('draws, compacts, persists, selects, and deletes freehand strokes', async ({
  page,
}) => {
  await page.goto('/');
  const lineTool = page.getByRole('button', { name: 'Line / curve tool' });
  await lineTool.click();
  const freehandPath = page.getByRole('button', {
    name: 'Use freehand path',
  });
  await freehandPath.click();
  await expect(lineTool).toHaveAttribute('aria-pressed', 'true');
  await expect(lineTool).toHaveAttribute('data-path-kind', 'freehand');
  await expect(freehandPath).toHaveAttribute('aria-pressed', 'true');
  const strokeWeight = page.getByLabel('Stroke weight value');
  await strokeWeight.click();
  await page.keyboard.press('Backspace');
  await expect(strokeWeight).toHaveValue('');
  await page.keyboard.type('5');
  await expect(strokeWeight).toHaveValue('5');

  const canvas = page.getByRole('application', {
    name: 'Chalkboard drawing canvas',
  });
  const bounds = await canvas.boundingBox();
  assertValue(bounds, 'drawing canvas bounds');
  const start = { x: bounds.x + 300, y: bounds.y + 250 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 30, start.y - 24, { steps: 10 });
  await page.mouse.move(start.x + 60, start.y + 22, { steps: 10 });
  await page.mouse.move(start.x + 95, start.y, { steps: 10 });
  await page.mouse.up();

  await expect(page.getByText('Canvas contains 1 object')).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const elements = JSON.parse(
          localStorage.getItem(
            `chalkboard:local-document:${window.location.pathname.split('/').at(-1) ?? ''}`,
          ) ?? '[]',
        ) as { points?: unknown[]; strokeWidth?: number; type?: string }[];
        const freehand = elements.find(({ type }) => type === 'freehand');
        return {
          pointCount: freehand?.points?.length,
          strokeWidth: freehand?.strokeWidth,
        };
      }),
    )
    .toEqual({ pointCount: expect.any(Number), strokeWidth: 5 });
  const pointCount = await page.evaluate(() => {
    const elements = JSON.parse(
      localStorage.getItem(
        `chalkboard:local-document:${window.location.pathname.split('/').at(-1) ?? ''}`,
      ) ?? '[]',
    ) as { points?: unknown[]; type?: string }[];
    return (
      elements.find(({ type }) => type === 'freehand')?.points?.length ?? 0
    );
  });
  expect(pointCount).toBeGreaterThan(2);
  expect(pointCount).toBeLessThan(31);

  await page.reload();
  await expect(page.getByText('Canvas contains 1 object')).toBeVisible();
  await page.getByRole('button', { name: 'Selection tool' }).click();
  const reloadedBounds = await canvas.boundingBox();
  assertValue(reloadedBounds, 'drawing canvas bounds after reload');
  await page.mouse.click(
    reloadedBounds.x + reloadedBounds.width / 2,
    reloadedBounds.y + reloadedBounds.height / 2 + 25,
  );
  const deleteButton = page.getByRole('button', { name: 'Delete selection' });
  await expect(deleteButton).toBeEnabled();
  await deleteButton.click();
  await expect(page.getByText('Canvas contains 0 objects')).toBeVisible();
});

test('constrains new shape proportions while Shift is held', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Shape tool' }).click();
  await page
    .getByRole('button', { name: 'Use circle / ellipse shape' })
    .click();
  const canvas = page.getByRole('application', {
    name: 'Chalkboard drawing canvas',
  });
  const bounds = await canvas.boundingBox();
  assertValue(bounds, 'drawing canvas bounds');

  const start = {
    x: bounds.x + bounds.width / 2 - 80,
    y: bounds.y + bounds.height / 2 - 60,
  };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.keyboard.down('Shift');
  await page.mouse.move(start.x + 160, start.y + 70, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up('Shift');

  await expect
    .poll(() =>
      page.evaluate(() => {
        const elements = JSON.parse(
          localStorage.getItem(
            `chalkboard:local-document:${window.location.pathname.split('/').at(-1) ?? ''}`,
          ) ?? '[]',
        ) as { height?: number; shapeKind?: string; width?: number }[];
        return elements[0];
      }),
    )
    .toMatchObject({ height: 160, shapeKind: 'ellipse', width: 160 });

  await page.getByRole('button', { name: 'Use triangle shape' }).click();
  const triangleStart = {
    x: bounds.x + bounds.width / 2 + 140,
    y: bounds.y + bounds.height / 2 - 80,
  };
  await page.keyboard.down('Shift');
  await page.mouse.move(triangleStart.x, triangleStart.y);
  await page.mouse.down();
  await page.mouse.move(triangleStart.x + 160, triangleStart.y + 60, {
    steps: 5,
  });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await expect
    .poll(() =>
      page.evaluate(() => {
        const elements = JSON.parse(
          localStorage.getItem(
            `chalkboard:local-document:${window.location.pathname.split('/').at(-1) ?? ''}`,
          ) ?? '[]',
        ) as unknown[];
        return elements.length;
      }),
    )
    .toBe(2);
  const triangle = await page.evaluate(() => {
    const elements = JSON.parse(
      localStorage.getItem(
        `chalkboard:local-document:${window.location.pathname.split('/').at(-1) ?? ''}`,
      ) ?? '[]',
    ) as { height: number; shapeKind: string; width: number }[];
    return elements[1];
  });
  assertValue(triangle, 'persisted triangle');
  expect(triangle.shapeKind).toBe('triangle');
  expect(triangle.width).toBeCloseTo(160, 5);
  expect(triangle.height).toBeCloseTo((160 * Math.sqrt(3)) / 2, 5);
});

test('resizes shapes along one axis from selection edge handles', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'chalkboard:local-document',
      JSON.stringify([
        {
          backgroundColor: 'transparent',
          cornerRadius: 0,
          createdBy: 'local',
          height: 80,
          id: 'edge-resize-shape',
          opacity: 1,
          rotation: 0,
          shapeKind: 'rectangle',
          strokeColor: '#1f2937',
          strokeStyle: 'solid',
          strokeWidth: 2,
          type: 'shape',
          width: 120,
          x: -240,
          y: -100,
        },
      ]),
    );
  });
  await page.goto('/');
  await expect(page.getByText('Canvas contains 1 object')).toBeVisible();
  const canvas = page.getByRole('application', {
    name: 'Chalkboard drawing canvas',
  });
  const bounds = await canvas.boundingBox();
  assertValue(bounds, 'drawing canvas bounds');
  const center = {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  };

  await page.mouse.click(center.x, center.y + 40);
  await expect(
    page.getByRole('button', { name: 'Delete selection' }),
  ).toBeEnabled();
  await page.mouse.move(center.x, center.y + 40);
  await expect
    .poll(() => canvas.evaluate((node) => getComputedStyle(node).cursor))
    .toBe('move');
  await page.mouse.move(center.x + 64, center.y + 25);
  await expect
    .poll(() => canvas.evaluate((node) => getComputedStyle(node).cursor))
    .toBe('ew-resize');
  await page.mouse.down();
  await page.mouse.move(center.x + 144, center.y + 75, { steps: 5 });
  await page.mouse.up();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const elements = JSON.parse(
          localStorage.getItem(
            `chalkboard:local-document:${window.location.pathname.split('/').at(-1) ?? ''}`,
          ) ?? '[]',
        ) as { height: number; width: number; x: number; y: number }[];
        return elements[0];
      }),
    )
    .toMatchObject({ height: 80, width: 204, x: -240, y: -100 });

  await page.mouse.move(center.x - 10, center.y - 4);
  await page.mouse.down();
  await page.mouse.move(center.x + 50, center.y - 44, { steps: 5 });
  await page.mouse.up();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const elements = JSON.parse(
          localStorage.getItem(
            `chalkboard:local-document:${window.location.pathname.split('/').at(-1) ?? ''}`,
          ) ?? '[]',
        ) as { height: number; width: number; x: number; y: number }[];
        return elements[0];
      }),
    )
    .toMatchObject({ height: 124, width: 204, x: -240, y: -144 });
});

test('keeps selection and handles through object-local undo and redo', async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForURL(/\/local\/[0-9a-f-]{36}$/iu);
  const canvas = page.getByRole('application', {
    name: 'Chalkboard drawing canvas',
  });
  const bounds = await canvas.boundingBox();
  assertValue(bounds, 'drawing canvas bounds');
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  const selectedCount = () =>
    page.evaluate(
      () =>
        document.querySelectorAll('[aria-pressed="true"][data-object-id]')
          .length,
    );

  await page.getByRole('button', { name: 'Shape tool' }).click();
  await page.mouse.move(centerX - 60, centerY - 40);
  await page.mouse.down();
  await page.mouse.move(centerX + 60, centerY + 40, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.press('Control+z');
  await expect(page.getByText('Canvas contains 0 objects')).toBeVisible();
  await page.keyboard.press('Control+Shift+z');
  await expect(page.getByText('Canvas contains 1 object')).toBeVisible();

  // Creation and immediate deletion are separate structural transactions,
  // even while the Shape tool remains active.
  await page.keyboard.press('Delete');
  await expect(page.getByText('Canvas contains 0 objects')).toBeVisible();
  await page.keyboard.press('Control+z');
  await expect(page.getByText('Canvas contains 1 object')).toBeVisible();
  await page.keyboard.press('Control+Shift+z');
  await expect(page.getByText('Canvas contains 0 objects')).toBeVisible();
  await page.keyboard.press('Control+z');
  await expect(page.getByText('Canvas contains 1 object')).toBeVisible();

  // With Selection active and no object chosen, creation remains globally
  // undoable and redoable.
  await page.getByRole('button', { name: 'Selection tool' }).click();
  await page.mouse.click(centerX + 260, centerY + 180);
  await expect.poll(selectedCount).toBe(0);
  await page.keyboard.press('Control+z');
  await expect(page.getByText('Canvas contains 0 objects')).toBeVisible();
  await page.keyboard.press('Control+Shift+z');
  await expect(page.getByText('Canvas contains 1 object')).toBeVisible();

  await page.getByRole('button', { name: 'Selection tool' }).click();
  await page.mouse.click(centerX, centerY);
  await expect.poll(selectedCount).toBe(1);

  await page.mouse.move(centerX + 64, centerY);
  await page.mouse.down();
  await page.mouse.move(centerX + 160, centerY, { steps: 10 });
  await page.mouse.up();

  // Undoing a resize corrects the object somebody is working on, so it stays
  // selected. Clearing it made them find the shape again to carry on.
  await page.keyboard.press('Control+z');
  await expect.poll(selectedCount).toBe(1);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(selectedCount).toBe(1);
  const objectWidth = () =>
    page.evaluate(() => {
      const elements = JSON.parse(
        localStorage.getItem(
          `chalkboard:local-document:${window.location.pathname.split('/').at(-1) ?? ''}`,
        ) ?? '[]',
      ) as { width: number }[];
      return elements[0]?.width;
    });
  await expect.poll(objectWidth).toBeGreaterThan(120);
  const editedWidth = await objectWidth();

  await page.getByRole('button', { name: 'Drag canvas tool' }).click();
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(objectWidth).toBe(editedWidth);
  await page.getByRole('button', { name: 'Selection tool' }).click();
  await page.mouse.click(centerX, centerY);
  const deleteSelection = page.getByRole('button', {
    name: 'Delete selection',
  });
  await expect(deleteSelection).toBeEnabled();

  // After its resize is undone, the object's next local history step is its
  // creation. Undo removes it; redo restores both the object and selection.
  await page.keyboard.press('Control+z');
  await expect.poll(objectWidth).toBe(120);
  await page.keyboard.press('Control+z');
  await expect(page.getByText('Canvas contains 0 objects')).toBeVisible();
  await expect(deleteSelection).toBeDisabled();
  await expect.poll(selectedCount).toBe(0);

  await page.keyboard.press('Control+Shift+z');
  await expect(page.getByText('Canvas contains 1 object')).toBeVisible();
  // Selection is restored even though the optional object navigator is closed;
  // its delete action is enabled only for an actual Selection target.
  await expect(deleteSelection).toBeEnabled();
  await expect.poll(objectWidth).toBe(120);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(objectWidth).toBe(editedWidth);
});
