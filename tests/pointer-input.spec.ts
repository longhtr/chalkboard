/** Mouse, pen, touch, capture, cancellation, pan, pinch, pressure, and coalesced pointer input stories. */
import { expect, test, type CDPSession, type Page } from '@playwright/test';

import { assertValue } from './helpers/assertions';

interface Point {
  x: number;
  y: number;
}

const seedEquation = async (page: Page) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'chalkboard:local-document',
      JSON.stringify([
        {
          backgroundColor: 'transparent',
          createdBy: 'local',
          fontSize: 25,
          height: 42,
          id: 'pointer-input-equation',
          lineSpacing: 1.2,
          opacity: 1,
          rotation: 0,
          source: 'Touch equation',
          strokeColor: '#1f2937',
          strokeStyle: 'solid',
          strokeWidth: 2,
          type: 'equation',
          width: 180,
          x: -90,
          y: -120,
        },
      ]),
    );
  });
};

const touchDrag = async (session: CDPSession, start: Point, end: Point) => {
  const touchPoint = (point: Point) => ({
    force: 0.7,
    id: 1,
    radiusX: 8,
    radiusY: 8,
    x: point.x,
    y: point.y,
  });
  await session.send('Input.dispatchTouchEvent', {
    touchPoints: [touchPoint(start)],
    type: 'touchStart',
  });
  for (let step = 1; step <= 5; step += 1) {
    const point = {
      x: start.x + ((end.x - start.x) * step) / 5,
      y: start.y + ((end.y - start.y) * step) / 5,
    };
    await session.send('Input.dispatchTouchEvent', {
      touchPoints: [touchPoint(point)],
      type: 'touchMove',
    });
  }
  await session.send('Input.dispatchTouchEvent', {
    touchPoints: [],
    type: 'touchEnd',
  });
};

const touchTap = async (session: CDPSession, point: Point) => {
  await session.send('Input.dispatchTouchEvent', {
    touchPoints: [
      {
        force: 0.7,
        id: 1,
        radiusX: 8,
        radiusY: 8,
        x: point.x,
        y: point.y,
      },
    ],
    type: 'touchStart',
  });
  await session.send('Input.dispatchTouchEvent', {
    touchPoints: [],
    type: 'touchEnd',
  });
};

const penDrag = async (session: CDPSession, start: Point, points: Point[]) => {
  await session.send('Input.dispatchMouseEvent', {
    pointerType: 'pen',
    type: 'mouseMoved',
    x: start.x,
    y: start.y,
  });
  await session.send('Input.dispatchMouseEvent', {
    button: 'left',
    buttons: 1,
    clickCount: 1,
    force: 0.6,
    pointerType: 'pen',
    type: 'mousePressed',
    x: start.x,
    y: start.y,
  });
  for (const point of points) {
    await session.send('Input.dispatchMouseEvent', {
      button: 'left',
      buttons: 1,
      force: 0.6,
      pointerType: 'pen',
      type: 'mouseMoved',
      x: point.x,
      y: point.y,
    });
  }
  const end = points.at(-1) ?? start;
  await session.send('Input.dispatchMouseEvent', {
    button: 'left',
    buttons: 0,
    clickCount: 1,
    force: 0,
    pointerType: 'pen',
    type: 'mouseReleased',
    x: end.x,
    y: end.y,
  });
};

const penTap = async (session: CDPSession, point: Point) => {
  await penDrag(session, point, []);
};

test('uses a held second touch as Shift while drawing', async ({
  context,
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/local');
  await page.getByRole('button', { name: 'Shape tool' }).click();
  const session = await context.newCDPSession(page);
  const touchPoint = (id: number, point: Point) => ({
    force: 0.7,
    id,
    radiusX: 8,
    radiusY: 8,
    x: point.x,
    y: point.y,
  });
  const start = { x: 80, y: 300 };
  const firstEnd = { x: 180, y: 350 };
  const constrainedEnd = { x: 200, y: 360 };
  const modifier = { x: 30, y: 600 };

  await session.send('Input.dispatchTouchEvent', {
    touchPoints: [touchPoint(1, start)],
    type: 'touchStart',
  });
  await session.send('Input.dispatchTouchEvent', {
    touchPoints: [touchPoint(1, firstEnd)],
    type: 'touchMove',
  });
  await session.send('Input.dispatchTouchEvent', {
    touchPoints: [touchPoint(1, firstEnd), touchPoint(2, modifier)],
    type: 'touchStart',
  });
  await session.send('Input.dispatchTouchEvent', {
    touchPoints: [touchPoint(1, constrainedEnd), touchPoint(2, modifier)],
    type: 'touchMove',
  });
  await session.send('Input.dispatchTouchEvent', {
    touchPoints: [],
    type: 'touchEnd',
  });

  await expect(page.getByText('Canvas contains 1 object')).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const elements = JSON.parse(
          localStorage.getItem(
            `chalkboard:local-document:${window.location.pathname.split('/').at(-1) ?? ''}`,
          ) ?? '[]',
        ) as { height?: number; type?: string; width?: number }[];
        const shape = elements.find(({ type }) => type === 'shape');
        return shape === undefined
          ? null
          : { height: shape.height, width: shape.width };
      }),
    )
    .toEqual({ height: 120, width: 120 });
});

test('pinch-zooms in and out with two touches', async ({ context, page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/local');
  const session = await context.newCDPSession(page);
  const touchPoint = (id: number, point: Point) => ({
    force: 0.7,
    id,
    radiusX: 8,
    radiusY: 8,
    x: point.x,
    y: point.y,
  });

  await session.send('Input.dispatchTouchEvent', {
    touchPoints: [touchPoint(1, { x: 120, y: 350 })],
    type: 'touchStart',
  });
  await session.send('Input.dispatchTouchEvent', {
    touchPoints: [
      touchPoint(1, { x: 120, y: 350 }),
      touchPoint(2, { x: 270, y: 350 }),
    ],
    type: 'touchStart',
  });
  await session.send('Input.dispatchTouchEvent', {
    touchPoints: [
      touchPoint(1, { x: 70, y: 350 }),
      touchPoint(2, { x: 320, y: 350 }),
    ],
    type: 'touchMove',
  });
  await expect(page.locator('.zoom-value')).toHaveText('167%');

  await session.send('Input.dispatchTouchEvent', {
    touchPoints: [
      touchPoint(1, { x: 145, y: 350 }),
      touchPoint(2, { x: 245, y: 350 }),
    ],
    type: 'touchMove',
  });
  await expect(page.locator('.zoom-value')).toHaveText('67%');
  await session.send('Input.dispatchTouchEvent', {
    touchPoints: [],
    type: 'touchEnd',
  });

  await expect(page.getByText('Canvas contains 0 objects')).toBeVisible();
});

test('supports touch and pen drawing, selection, panning, and equation editing', async ({
  context,
  page,
}) => {
  await seedEquation(page);
  await page.addInitScript(() => {
    const pointerTypes: string[] = [];
    Object.defineProperty(window, '__chalkboardTestPointerTypes', {
      value: pointerTypes,
    });
    document.addEventListener('pointerdown', (event) => {
      if (!pointerTypes.includes(event.pointerType)) {
        pointerTypes.push(event.pointerType);
      }
    });
  });
  await page.goto('/local');
  const session = await context.newCDPSession(page);
  const canvas = page.getByRole('application', {
    name: 'Chalkboard drawing canvas',
  });
  const bounds = await canvas.boundingBox();
  assertValue(bounds, 'element bounds');

  const equation = page.getByRole('group', {
    exact: true,
    name: 'Touch equation',
  });
  await expect(equation).toBeVisible();

  await page.getByRole('button', { name: 'Shape tool' }).click();
  await touchDrag(
    session,
    { x: bounds.x + 280, y: bounds.y + 310 },
    { x: bounds.x + 390, y: bounds.y + 390 },
  );
  await expect(page.getByText('Canvas contains 2 objects')).toBeVisible();

  await page.getByRole('button', { name: 'Line / curve tool' }).click();
  await page.getByRole('button', { name: 'Use freehand path' }).click();
  const penStart = { x: bounds.x + 510, y: bounds.y + 300 };
  await penDrag(session, penStart, [
    { x: penStart.x + 25, y: penStart.y - 24 },
    { x: penStart.x + 50, y: penStart.y + 20 },
    { x: penStart.x + 78, y: penStart.y },
  ]);
  await expect(page.getByText('Canvas contains 3 objects')).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const elements = JSON.parse(
          localStorage.getItem(
            `chalkboard:local-document:${window.location.pathname.split('/').at(-1) ?? ''}`,
          ) ?? '[]',
        ) as { type?: string }[];
        return elements.filter(({ type }) => type === 'freehand').length;
      }),
    )
    .toBe(1);

  await page.getByRole('button', { name: 'Selection tool' }).click();
  await penTap(session, { x: penStart.x + 25, y: penStart.y - 24 });
  await expect(
    page.getByRole('button', { name: 'Delete selection' }),
  ).toBeEnabled();

  const equationBeforePan = await equation.boundingBox();
  if (equationBeforePan === null) {
    throw new Error('Expected equation bounds before canvas pan');
  }
  await page.getByRole('button', { name: 'Drag canvas tool' }).click();
  await touchDrag(
    session,
    { x: bounds.x + 700, y: bounds.y + 500 },
    { x: bounds.x + 800, y: bounds.y + 555 },
  );
  const equationAfterPan = await equation.boundingBox();
  if (equationAfterPan === null) {
    throw new Error('Expected equation bounds after canvas pan');
  }
  expect(equationAfterPan.x - equationBeforePan.x).toBeCloseTo(100, 0);
  expect(equationAfterPan.y - equationBeforePan.y).toBeCloseTo(55, 0);

  await page.getByRole('button', { name: 'Mixed text block tool' }).click();
  await touchTap(session, {
    x: equationAfterPan.x + equationAfterPan.width / 2,
    y: equationAfterPan.y + equationAfterPan.height / 2,
  });
  await expect(page.locator('math-field')).toBeFocused();
  await page.keyboard.type(' updated');
  await page.getByRole('button', { name: 'Selection tool' }).click();
  await expect(page.getByRole('group', { name: /updated/u })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const elements = JSON.parse(
          localStorage.getItem(
            `chalkboard:local-document:${window.location.pathname.split('/').at(-1) ?? ''}`,
          ) ?? '[]',
        ) as { id?: string; source?: string }[];
        return elements.find(({ id }) => id === 'pointer-input-equation')
          ?.source;
      }),
    )
    .toContain(' updated');
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as typeof window & {
              __chalkboardTestPointerTypes?: string[];
            }
          ).__chalkboardTestPointerTypes,
      ),
    )
    .toEqual(expect.arrayContaining(['pen', 'touch']));
});
