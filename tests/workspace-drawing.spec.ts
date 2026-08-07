/** Visible shape, straight/orthogonal/freehand/Bézier path, arrowhead, grid, and gesture stories. */
import { expect, test } from '@playwright/test';

import { assertValue } from './helpers/assertions';

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
