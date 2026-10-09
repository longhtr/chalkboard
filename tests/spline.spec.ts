/** Bézier drawing, fitting, continuity, direct handles, undo, reload, and safety fallback stories. */
import { expect, test } from '@playwright/test';

test('keeps spline fitting stable across event density, C2 stress, and zoom', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Line / curve tool' }).click();
  await page.getByRole('button', { name: 'Use spline path' }).click();
  const automatic = page.getByRole('button', {
    name: 'Automatically choose curve count',
  });
  await automatic.click();
  const canvas = page.getByRole('application', {
    name: 'Chalkboard drawing canvas',
  });
  const bounds = await canvas.boundingBox();
  if (bounds === null) throw new Error('Expected drawing canvas bounds');
  const startX = bounds.x + 300;
  const width = Math.min(650, bounds.width - 350);
  const drawArc = async (y: number, sampleCount: number) => {
    await page.mouse.move(startX, y);
    await page.mouse.down();
    for (let index = 1; index < sampleCount; index += 1) {
      const progress = index / (sampleCount - 1);
      await page.mouse.move(
        startX + width * progress,
        y - 120 * Math.sin(Math.PI * progress),
      );
    }
    await page.mouse.up();
  };
  await drawArc(bounds.y + 230, 101);
  await drawArc(bounds.y + 450, 501);

  const storedSplines = () =>
    page.evaluate(() => {
      const key = Object.keys(localStorage).find((candidate) =>
        candidate.startsWith('chalkboard:local-document:'),
      );
      return JSON.parse(
        key === undefined ? '[]' : (localStorage.getItem(key) ?? '[]'),
      ) as {
        segments: {
          control1: { x: number; y: number };
          control2: { x: number; y: number };
          end: { x: number; y: number };
        }[];
        splineContinuity?: string;
      }[];
    });
  await expect.poll(async () => (await storedSplines()).length).toBe(2);
  const arcs = await storedSplines();
  const sampledCurve = (segments: (typeof arcs)[number]['segments']) => {
    let start = { x: 0, y: 0 };
    const points = [start];
    for (const segment of segments) {
      for (let index = 1; index <= 64; index += 1) {
        const parameter = index / 64;
        const inverse = 1 - parameter;
        points.push({
          x:
            inverse ** 3 * start.x +
            3 * inverse * inverse * parameter * segment.control1.x +
            3 * inverse * parameter ** 2 * segment.control2.x +
            parameter ** 3 * segment.end.x,
          y:
            inverse ** 3 * start.y +
            3 * inverse * inverse * parameter * segment.control1.y +
            3 * inverse * parameter ** 2 * segment.control2.y +
            parameter ** 3 * segment.end.y,
        });
      }
      start = segment.end;
    }
    return points;
  };
  const [sparseArc, denseArc] = arcs;
  if (sparseArc === undefined || denseArc === undefined) {
    throw new Error('Expected sparse and dense spline records');
  }
  const sparseCurve = sampledCurve(sparseArc.segments);
  const denseCurve = sampledCurve(denseArc.segments);
  const sparsePeak = Math.min(...sparseCurve.map(({ y }) => y));
  const densePeak = Math.min(...denseCurve.map(({ y }) => y));
  expect(sparsePeak).toBeLessThan(-115);
  expect(densePeak).toBeLessThan(-115);
  expect(Math.abs(sparsePeak - densePeak)).toBeLessThan(1);
  for (const progress of [0.25, 0.75]) {
    const nearestY = (curve: typeof sparseCurve) => {
      const nearest = curve.toSorted(
        (first, second) =>
          Math.abs(first.x - width * progress) -
          Math.abs(second.x - width * progress),
      )[0];
      if (nearest === undefined) {
        throw new Error('Expected sampled curve points');
      }
      return nearest.y;
    };
    expect(nearestY(sparseCurve)).toBeLessThan(-80);
    expect(nearestY(denseCurve)).toBeLessThan(-80);
    expect(Math.abs(nearestY(sparseCurve) - nearestY(denseCurve))).toBeLessThan(
      2.5,
    );
  }

  await page.getByRole('button', { name: 'Use C2 spline continuity' }).click();
  await page.getByRole('slider', { name: 'Maximum curves slider' }).fill('12');
  const zigzag = Array.from({ length: 31 }, (_, index) => ({
    x: startX + (width * index) / 30,
    y: bounds.y + 580 + (index % 2 === 0 ? 70 : -70),
  }));
  const firstZigzagPoint = zigzag[0];
  if (firstZigzagPoint === undefined) {
    throw new Error('Expected generated zigzag points');
  }
  await page.mouse.move(firstZigzagPoint.x, firstZigzagPoint.y);
  await page.mouse.down();
  for (const point of zigzag.slice(1)) await page.mouse.move(point.x, point.y);
  await page.mouse.up();
  await expect.poll(async () => (await storedSplines()).length).toBe(3);
  const stressed = (await storedSplines())[2];
  if (stressed === undefined) throw new Error('Expected C2 stress spline');
  expect(stressed.splineContinuity).toBe('c2');
  expect(stressed.segments.length).toBeGreaterThan(0);
  expect(
    Math.max(
      ...stressed.segments
        .flatMap(({ control1, control2, end }) => [control1, control2, end])
        .flatMap(({ x, y }) => [Math.abs(x), Math.abs(y)]),
    ),
  ).toBeLessThan(2_000);

  for (let index = 0; index < 9; index += 1) {
    await page.getByRole('button', { name: 'Zoom out' }).click();
  }
  await expect(page.locator('.zoom-value')).toHaveText('10%');
  await automatic.click();
  await page
    .getByRole('slider', { name: 'Automatic fitting accuracy slider' })
    .fill('5');
  await drawArc(bounds.y + 360, 15);
  await expect.poll(async () => (await storedSplines()).length).toBe(4);
  const zoomedSpline = (await storedSplines())[3];
  if (zoomedSpline === undefined) throw new Error('Expected zoomed spline');
  expect(zoomedSpline.segments.length).toBeGreaterThan(0);
});
