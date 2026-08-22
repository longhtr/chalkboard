/**
 * Turning shapes, paths, and groups with the rotation handle.
 *
 * A rotation is stored as a single angle; nothing about the stored geometry
 * moves. Everything else -- the drawing, the hit test, the selection box, the
 * eight resize handles, the rotation handle itself, and the direct handles on
 * curves and trapezoids -- has to apply that angle for itself, and they are all
 * separate code paths. So each test here drags a real handle and then checks
 * what is DRAWN against what RESPONDS TO A CLICK. A test that only read back the
 * stored angle would pass while the shape sat upright on screen.
 *
 * Two conventions keep these tests independent of the camera, which is not
 * centred on the world origin:
 *
 *  - `inkBox` finds the shape on screen by reading pixels, so seeded world
 *    coordinates never have to be converted by hand.
 *  - handles are found by the cursor the canvas offers, so a layout change
 *    fails loudly instead of quietly missing a hard-coded offset.
 */
import { readFile } from 'node:fs/promises';

import { expect, test, type Locator, type Page } from '@playwright/test';

import { assertValue } from './helpers/assertions';

const RECTANGLE = {
  backgroundColor: 'transparent',
  cornerRadius: 0,
  createdBy: 'local',
  height: 120,
  id: 'rotation-shape',
  opacity: 1,
  rotation: 0,
  shapeKind: 'rectangle',
  strokeColor: '#1f2937',
  strokeStyle: 'solid',
  strokeWidth: 2,
  type: 'shape',
  width: 300,
  x: -150,
  y: -60,
};

/** A screen-space box, in the same client coordinates the mouse uses. */
interface ScreenBox {
  bottom: number;
  centreX: number;
  centreY: number;
  height: number;
  left: number;
  right: number;
  top: number;
  width: number;
}

/** Opens a board holding exactly the given elements. */
async function openBoard(page: Page, elements: unknown[]): Promise<void> {
  await page.addInitScript((items) => {
    localStorage.setItem('chalkboard:local-document', JSON.stringify(items));
  }, elements);
  await page.goto('/');
}

function drawingCanvas(page: Page): Locator {
  return page.getByRole('application', { name: 'Chalkboard drawing canvas' });
}

/** The middle of the drawing canvas, which is not the world origin. */
async function canvasCentre(
  canvas: Locator,
): Promise<{ x: number; y: number }> {
  const bounds = await canvas.boundingBox();
  assertValue(bounds, 'drawing canvas bounds');
  if (bounds === null) throw new Error('Expected drawing canvas bounds');
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
}

/**
 * The box around every non-transparent pixel on the matching canvases.
 *
 * This is the only honest answer to "where is the shape on screen", and it is
 * what makes these tests independent of the camera: a turned shape's ink box is
 * its turned extent, so its centre is the point it turns around.
 */
async function inkBox(page: Page, selector: string): Promise<ScreenBox | null> {
  return page.evaluate((match) => {
    let left: number | null = null;
    let right: number | null = null;
    let top: number | null = null;
    let bottom: number | null = null;
    for (const canvas of document.querySelectorAll<HTMLCanvasElement>(match)) {
      const context = canvas.getContext('2d');
      if (context === null) continue;
      const rect = canvas.getBoundingClientRect();
      if (canvas.width === 0 || canvas.height === 0) continue;
      const scaleX = rect.width / canvas.width;
      const scaleY = rect.height / canvas.height;
      const { data, height, width } = context.getImageData(
        0,
        0,
        canvas.width,
        canvas.height,
      );
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          if (data[(y * width + x) * 4 + 3]! <= 8) continue;
          const clientX = rect.left + x * scaleX;
          const clientY = rect.top + y * scaleY;
          left = left === null ? clientX : Math.min(left, clientX);
          right = right === null ? clientX : Math.max(right, clientX);
          top = top === null ? clientY : Math.min(top, clientY);
          bottom = bottom === null ? clientY : Math.max(bottom, clientY);
        }
      }
    }
    if (left === null || right === null || top === null || bottom === null) {
      return null;
    }
    return {
      bottom,
      centreX: (left + right) / 2,
      centreY: (top + bottom) / 2,
      height: bottom - top,
      left,
      right,
      top,
      width: right - left,
    };
  }, selector);
}

/**
 * The drawn board content: shapes and paths, without any selection chrome.
 *
 * The board centres itself on its content a moment after it loads, so this
 * waits for two readings in a row to agree. Measuring during that settle would
 * hand back coordinates that are stale by the time the mouse gets there.
 */
async function contentInk(page: Page): Promise<ScreenBox> {
  let previous: string | null = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const box = await inkBox(page, 'canvas.content-layer');
    const reading = JSON.stringify(box);
    if (box !== null && reading === previous) return box;
    previous = reading;
    await page.waitForTimeout(100);
  }
  throw new Error('The drawn board content never settled');
}

/** One stored element, as far as these tests care about it. */
interface StoredElement {
  height: number;
  id: string;
  rotation: number;
  trapezoidTopLeft?: number;
  width: number;
  x: number;
  y: number;
}

/** Reads the durable local board back out of IndexedDB. */
async function storedElements(page: Page): Promise<StoredElement[]> {
  return page.evaluate(async () => {
    const open = indexedDB.open('chalkboard-local');
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      open.addEventListener('success', () => resolve(open.result));
      open.addEventListener('error', () => reject(open.error));
    });
    const boards = await new Promise<{ elements?: unknown[] }[]>(
      (resolve, reject) => {
        const request = database
          .transaction('boards')
          .objectStore('boards')
          .getAll();
        request.addEventListener('success', () =>
          resolve((request.result as { elements?: unknown[] }[]) ?? []),
        );
        request.addEventListener('error', () => reject(request.error));
      },
    );
    database.close();
    const board = boards.find((entry) => (entry.elements ?? []).length > 0);
    return ((board?.elements ?? []) as Record<string, number & string>[]).map(
      (element) => ({
        height: Math.round(Number(element.height)),
        id: String(element.id),
        rotation: Number(element.rotation),
        trapezoidTopLeft:
          element.trapezoidTopLeft === undefined
            ? undefined
            : Number(element.trapezoidTopLeft),
        width: Math.round(Number(element.width)),
        x: Number(element.x),
        y: Number(element.y),
      }),
    );
  });
}

/** Moves the pointer somewhere and reports the cursor the canvas offers. */
async function cursorAt(
  page: Page,
  canvas: Locator,
  x: number,
  y: number,
): Promise<string> {
  await page.mouse.move(x, y);
  return canvas.evaluate((node) => getComputedStyle(node).cursor);
}

/**
 * Walks a straight line looking for a cursor, and reports where it changed.
 *
 * Handles are found this way rather than by arithmetic so that a handle which
 * has moved fails the test instead of being quietly missed.
 */
async function findCursor(
  page: Page,
  canvas: Locator,
  options: {
    from: { x: number; y: number };
    matches: (cursor: string) => boolean;
    step: { x: number; y: number };
    steps: number;
  },
): Promise<{ x: number; y: number } | null> {
  for (let index = 0; index < options.steps; index += 1) {
    const point = {
      x: options.from.x + options.step.x * index,
      y: options.from.y + options.step.y * index,
    };
    if (options.matches(await cursorAt(page, canvas, point.x, point.y))) {
      return point;
    }
  }
  return null;
}

/** Selects the single seeded element by clicking the middle of its ink. */
async function selectDrawnElement(page: Page): Promise<ScreenBox> {
  const ink = await contentInk(page);
  await page.mouse.click(ink.centreX, ink.centreY);
  await expect(
    page.getByRole('button', { name: 'Delete selection' }),
  ).toBeEnabled();
  return ink;
}

test('the rotation handle turns a shape, and the shape follows on screen', async ({
  page,
}) => {
  await openBoard(page, [RECTANGLE]);
  await expect(page.getByText('Canvas contains 1 object')).toBeVisible();

  const canvas = drawingCanvas(page);
  const uprightInk = await selectDrawnElement(page);
  expect(uprightInk.height, 'the shape is drawn at all').toBeGreaterThan(20);

  const handle = await findCursor(page, canvas, {
    from: { x: uprightInk.centreX, y: uprightInk.top - 4 },
    matches: (cursor) => cursor === 'grab',
    step: { x: 0, y: -3 },
    steps: 15,
  });
  expect(handle, 'the rotation handle offers a grab cursor').not.toBeNull();
  if (handle === null) return;

  // How tall the shape is on screen, measured by where the canvas offers the
  // move cursor. This reads the hit test, so it fails if rotation is only
  // stored, or only drawn, rather than both drawn and hit-tested.
  const verticalExtent = async (): Promise<number> => {
    let first: number | null = null;
    let last: number | null = null;
    for (let dy = -260; dy <= 260; dy += 5) {
      const cursor = await cursorAt(
        page,
        canvas,
        uprightInk.centreX,
        uprightInk.centreY + dy,
      );
      if (cursor !== 'move') continue;
      first ??= dy;
      last = dy;
    }
    return first === null || last === null ? 0 : last - first;
  };

  const uprightHeight = await verticalExtent();
  expect(uprightHeight, 'upright height on screen').toBeGreaterThan(60);
  expect(uprightHeight, 'upright height on screen').toBeLessThan(200);

  // The shape turns about the middle of its own ink, so swinging the grabbed
  // point a quarter turn about that middle is exactly a quarter turn -- however
  // far off centre the grab itself landed.
  const pivot = { x: uprightInk.centreX, y: uprightInk.centreY };
  const target = {
    x: pivot.x - (handle.y - pivot.y),
    y: pivot.y + (handle.x - pivot.x),
  };
  await page.mouse.move(handle.x, handle.y);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 12 });
  await page.mouse.up();

  // A quarter turn stands the 300-wide rectangle on end, so what was about 120
  // tall becomes about 300 tall.
  const turnedHeight = await verticalExtent();
  expect(
    turnedHeight,
    `a quarter turn should stand the rectangle on end (was ${uprightHeight})`,
  ).toBeGreaterThan(uprightHeight * 2);

  // Hit-testing and drawing are separate code paths, and a shape that answers
  // clicks where nothing is drawn is exactly the disagreement this guards
  // against. So measure the ink too, straight off the content canvas.
  const turnedInk = await contentInk(page);
  // Exactly as tall as it used to be wide. Anything less means the drawing was
  // cropped to where the shape would have been if it were still upright.
  expect(
    Math.abs(turnedInk.height - uprightInk.width),
    `the whole turned shape is drawn (${uprightInk.width} wide became ${turnedInk.height} tall)`,
  ).toBeLessThan(6);
  expect(
    Math.abs(turnedInk.width - uprightInk.height),
    'and no wider than it used to be tall',
  ).toBeLessThan(6);
});

test('a turned shape resizes along its own axes and holds the far edge still', async ({
  page,
}) => {
  // Already turned a quarter turn, so the shape's own x-axis points down the
  // screen. Dragging downward must therefore change its width, not its height.
  await openBoard(page, [{ ...RECTANGLE, rotation: 90 }]);
  await expect(page.getByText('Canvas contains 1 object')).toBeVisible();

  const canvas = drawingCanvas(page);
  const uprightInk = await selectDrawnElement(page);
  const [before] = await storedElements(page);
  expect(before, 'the seeded shape').not.toBeUndefined();
  if (before === undefined) return;

  // Find the handle below the shape by its cursor. It is only there because the
  // handles turned with the shape; upright they sit left and right.
  const handle = await findCursor(page, canvas, {
    from: { x: uprightInk.centreX, y: uprightInk.bottom - 12 },
    matches: (cursor) => cursor.includes('resize'),
    step: { x: 0, y: 3 },
    steps: 12,
  });
  expect(handle, 'a resize handle below the turned shape').not.toBeNull();
  if (handle === null) return;

  // It is the shape's own east handle, which after the turn drags up and down.
  // Naming it east would have shown a left-right cursor across that motion.
  expect(
    await cursorAt(page, canvas, handle.x, handle.y),
    'the cursor points the way the handle now moves',
  ).toBe('ns-resize');

  // Forty pixels, not four hundred: the shape has to stay inside the window,
  // or the ink measured afterwards is the window's edge rather than the shape's.
  await page.mouse.move(handle.x, handle.y);
  await page.mouse.down();
  await page.mouse.move(handle.x, handle.y + 40, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(400);

  const [after] = await storedElements(page);
  expect(after, 'the shape after the drag').not.toBeUndefined();
  if (after === undefined) return;
  expect(after.rotation, 'resizing leaves the angle alone').toBe(90);
  expect(
    after.width,
    `a downward drag grew the width (${before.width} to ${after.width})`,
  ).toBeGreaterThan(before.width + 25);
  expect(after.height, 'the other axis is untouched').toBe(before.height);

  // The edge opposite the one being dragged has to stay where it is on screen,
  // or the shape slides out from under the pointer as it grows.
  const turnedInk = await contentInk(page);
  expect(
    Math.abs(turnedInk.top - uprightInk.top),
    'the far edge stayed put on screen',
  ).toBeLessThan(6);
  expect(
    turnedInk.bottom - uprightInk.bottom,
    'and the dragged edge followed the pointer',
  ).toBeGreaterThan(25);
  // The drawn shape grew by exactly as much as the stored shape did, which is
  // the whole point: one angle, applied the same way by both.
  expect(
    Math.abs(
      turnedInk.height - uprightInk.height - (after.width - before.width),
    ),
    `the drawing grew by what the geometry says it did (ink ${uprightInk.height} to ${turnedInk.height}, width ${before.width} to ${after.width})`,
  ).toBeLessThan(6);
});

test('a group turns as one arrangement, not each piece in place', async ({
  page,
}) => {
  // Two 80 x 40 rectangles side by side, drawn with the mouse so their screen
  // positions are known exactly. Turning the pair a quarter turn has to stack
  // them vertically AND stand each one on end: each piece both turns and
  // travels around the shared centre. Oblong rather than square on purpose --
  // a square looks identical whether or not it was turned.
  await page.goto('/');
  const canvas = drawingCanvas(page);
  const centre = await canvasCentre(canvas);

  await page.getByRole('button', { name: 'Shape tool' }).click();
  for (const left of [centre.x - 160, centre.x + 80]) {
    await page.mouse.move(left, centre.y - 20);
    await page.mouse.down();
    await page.mouse.move(left + 80, centre.y + 20, { steps: 6 });
    await page.mouse.up();
  }
  await page.getByRole('button', { name: 'Selection tool' }).click();
  await expect(page.getByText('Canvas contains 2 objects')).toBeVisible();

  // Marquee across both, starting well clear of either rectangle.
  await page.mouse.move(centre.x - 320, centre.y - 140);
  await page.mouse.down();
  await page.mouse.move(centre.x + 320, centre.y + 140, { steps: 10 });
  await page.mouse.up();
  await expect(
    page.getByRole('button', { name: 'Delete selection' }),
  ).toBeEnabled();

  // The pair spans centre.x +/- 160 and centre.y +/- 20, so the shared centre
  // is the canvas centre and the handle sits 26px above the top edge.
  const handle = { x: centre.x, y: centre.y - 20 - 26 };
  await page.mouse.move(handle.x, handle.y);
  await expect
    .poll(() => canvas.evaluate((node) => getComputedStyle(node).cursor), {
      message: 'the rotation handle for a group offers a grab cursor',
    })
    .toBe('grab');

  // A quarter turn: swing the handle from straight above the centre to
  // straight to its right, keeping the same distance.
  await page.mouse.down();
  await page.mouse.move(centre.x + 46, centre.y, { steps: 12 });
  await page.mouse.up();

  // Deselect, so the next hover reports the rectangles rather than their chrome.
  await page.mouse.click(centre.x - 380, centre.y + 250);
  await expect(
    page.getByRole('button', { name: 'Delete selection' }),
  ).toBeDisabled();

  // Each rectangle's middle travelled a quarter turn around the shared centre.
  expect(
    await cursorAt(page, canvas, centre.x, centre.y - 120),
    'a rectangle arrived above the shared centre',
  ).toBe('move');
  expect(
    await cursorAt(page, canvas, centre.x, centre.y + 120),
    'and the other below it',
  ).toBe('move');
  expect(
    await cursorAt(page, canvas, centre.x - 120, centre.y),
    'nothing was left behind on the left',
  ).not.toBe('move');
  expect(
    await cursorAt(page, canvas, centre.x + 120, centre.y),
    'or on the right',
  ).not.toBe('move');

  // And each one is now standing on end. These two points tell a turned
  // rectangle apart from one that merely moved: 35px above the middle is inside
  // an 80-tall rectangle and outside a 40-tall one, and 35px to its side is the
  // other way round.
  expect(
    await cursorAt(page, canvas, centre.x, centre.y - 155),
    'the rectangle is 80 tall where it used to be 40',
  ).toBe('move');
  expect(
    await cursorAt(page, canvas, centre.x + 35, centre.y - 120),
    'and 40 wide where it used to be 80',
  ).not.toBe('move');
});

test('holding shift snaps the turn to fifteen degrees', async ({ page }) => {
  await openBoard(page, [RECTANGLE]);
  await expect(page.getByText('Canvas contains 1 object')).toBeVisible();

  const canvas = drawingCanvas(page);
  const ink = await selectDrawnElement(page);

  // Swing the handle to forty degrees, measured from straight up, keeping the
  // same distance from the centre. Forty is nowhere near a multiple of fifteen,
  // so an unsnapped turn cannot land on forty-five by accident.
  const radius = ink.centreY - ink.top + 26;
  const start = { x: ink.centreX, y: ink.centreY - radius };
  const degrees = 40;
  const radians = (degrees * Math.PI) / 180;
  const target = {
    x: ink.centreX + radius * Math.sin(radians),
    y: ink.centreY - radius * Math.cos(radians),
  };
  expect(
    await cursorAt(page, canvas, start.x, start.y),
    'the rotation handle is where the geometry says it is',
  ).toBe('grab');

  await page.keyboard.down('Shift');
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 12 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await page.waitForTimeout(400);

  const [turned] = await storedElements(page);
  expect(turned, 'the shape after the turn').not.toBeUndefined();
  expect(turned?.rotation, 'forty degrees snapped to forty-five').toBe(45);
});

test('the rotation handle rides around with the shape it turns', async ({
  page,
}) => {
  // A quarter turn carries the handle from above the shape to its right, still
  // over the shape's own top edge. A handle that stayed above would be pointing
  // at an edge that is no longer there.
  await openBoard(page, [{ ...RECTANGLE, rotation: 90 }]);
  await expect(page.getByText('Canvas contains 1 object')).toBeVisible();

  const canvas = drawingCanvas(page);
  const ink = await selectDrawnElement(page);

  const toTheRight = await findCursor(page, canvas, {
    from: { x: ink.right + 4, y: ink.centreY },
    matches: (cursor) => cursor === 'grab',
    step: { x: 4, y: 0 },
    steps: 12,
  });
  expect(toTheRight, 'the handle followed the top edge round').not.toBeNull();

  const above = await findCursor(page, canvas, {
    from: { x: ink.centreX, y: ink.top - 4 },
    matches: (cursor) => cursor === 'grab',
    step: { x: 0, y: -4 },
    steps: 12,
  });
  expect(above, 'and is no longer straight above the shape').toBeNull();
});

test('the selection box is drawn turned, around the turned shape', async ({
  page,
}) => {
  await openBoard(page, [{ ...RECTANGLE, rotation: 90 }]);
  await expect(page.getByText('Canvas contains 1 object')).toBeVisible();

  await selectDrawnElement(page);
  // Park the pointer off the chrome so nothing hover-related is drawn.
  await page.mouse.move(20, 700);

  const chrome = await inkBox(page, 'canvas.interaction-layer');
  expect(chrome, 'the selection box is drawn').not.toBeNull();
  if (chrome === null) return;
  // A 300 x 120 rectangle stood on end is 120 wide and 300 tall. An untouched
  // selection box would be the other way round.
  expect(
    chrome.height,
    `the box is as tall as the turned shape (${chrome.width} x ${chrome.height})`,
  ).toBeGreaterThan(280);
  expect(chrome.width, 'and no wider than it').toBeLessThan(230);
});

test('a Bezier node on a turned path follows the pointer in the path own frame', async ({
  page,
}) => {
  // A straight-looking cubic from (-150, -60) to (150, 60), turned a quarter
  // turn. On screen its far end is below and left of the centre; dragging that
  // end further left is, in the path's own upright frame, dragging it further
  // down -- so the path's stored height must grow while its width does not.
  await openBoard(page, [
    {
      ...RECTANGLE,
      arrowheads: 'none',
      cornerRadius: undefined,
      id: 'turned-curve',
      pathKind: 'bezier',
      rotation: 90,
      segments: [
        {
          control1: { x: 100, y: 40 },
          control2: { x: 200, y: 80 },
          end: { x: 300, y: 120 },
        },
      ],
      shapeKind: undefined,
      type: 'line',
    },
  ]);
  await expect(page.getByText('Canvas contains 1 object')).toBeVisible();

  const ink = await selectDrawnElement(page);
  const [before] = await storedElements(page);
  expect(before, 'the seeded path').not.toBeUndefined();
  if (before === undefined) return;

  // The far end sits at (150, 60) in the path's own frame; a quarter turn puts
  // it 60px left of the centre and 150px below it.
  const node = { x: ink.centreX - 60, y: ink.centreY + 150 };
  await page.mouse.move(node.x, node.y);
  await page.mouse.down();
  await page.mouse.move(node.x - 300, node.y, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(400);

  const [after] = await storedElements(page);
  expect(after, 'the path after the drag').not.toBeUndefined();
  if (after === undefined) return;
  expect(
    after.height,
    `300px left on screen is 300px down in the path's own frame (${before.height} to ${after.height})`,
  ).toBeGreaterThan(before.height + 240);
  expect(
    Math.abs(after.width - before.width),
    'and leaves the other axis alone',
  ).toBeLessThan(30);
});

test('a trapezoid corner on a turned shape follows the pointer in its own frame', async ({
  page,
}) => {
  // The top corners of a trapezoid are stored as fractions of its width, and
  // the handle only travels along the shape's own top edge. Turned a quarter
  // turn that edge runs down the right of the screen, so a downward drag is
  // what has to move the corner.
  await openBoard(page, [
    {
      ...RECTANGLE,
      id: 'turned-trapezoid',
      rotation: 90,
      shapeKind: 'trapezoid',
      trapezoidTopLeft: 0.25,
      trapezoidTopRight: 0.75,
    },
  ]);
  await expect(page.getByText('Canvas contains 1 object')).toBeVisible();

  const ink = await selectDrawnElement(page);
  const [before] = await storedElements(page);
  expect(before?.trapezoidTopLeft, 'the seeded corner').toBeCloseTo(0.25, 6);

  // The top-left corner is a quarter along a 300px top edge, so in the shape's
  // own frame it is 75px left of centre and 60px above it. A quarter turn puts
  // it 60px right of the centre and 75px above it.
  const corner = { x: ink.centreX + 60, y: ink.centreY - 75 };
  await page.mouse.move(corner.x, corner.y);
  await page.mouse.down();
  await page.mouse.move(corner.x, corner.y + 60, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(400);

  const [after] = await storedElements(page);
  expect(
    after?.trapezoidTopLeft,
    `60px down on screen is a fifth of the way along a 300px edge (was ${before?.trapezoidTopLeft})`,
  ).toBeCloseTo(0.45, 1);
});

test('a turned shape is exported the way it is drawn', async ({ page }) => {
  // Export sizes its page from the board's bounds. A wide rectangle stood on
  // end is tall, not wide, so a page sized from the stored box would crop the
  // two ends that now stick out.
  await openBoard(page, [{ ...RECTANGLE, rotation: 90 }]);
  await expect(page.getByText('Canvas contains 1 object')).toBeVisible();

  await page.getByRole('button', { name: 'Open board menu' }).click();
  await page.getByRole('button', { name: 'Export image' }).click();
  const dialog = page.getByRole('dialog', { name: 'Export image' });
  await dialog.getByText('SVG', { exact: true }).click();
  const svgDownload = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Export SVG' }).click();
  const svgPath = await (await svgDownload).path();
  assertValue(svgPath, 'SVG download path');
  if (svgPath === null) return;
  const svg = await readFile(svgPath, 'utf8');
  expect(svg, 'the turn is carried into the markup').toContain('rotate(90');
  const size = /width="([\d.]+)" height="([\d.]+)"/.exec(svg);
  expect(size, 'the page declares a size').not.toBeNull();
  expect(
    Number(size?.[2]),
    `the page is taller than it is wide (${size?.[1]} x ${size?.[2]})`,
  ).toBeGreaterThan(Number(size?.[1]));

  await page.getByRole('button', { name: 'Open board menu' }).click();
  await page.getByRole('button', { name: 'Export image' }).click();
  const pngDialog = page.getByRole('dialog', { name: 'Export image' });
  await pngDialog.getByText('PNG', { exact: true }).click();
  const pngDownload = page.waitForEvent('download');
  await pngDialog.getByRole('button', { name: 'Export PNG' }).click();
  const pngPath = await (await pngDownload).path();
  assertValue(pngPath, 'PNG download path');
  if (pngPath === null) return;
  const png = await readFile(pngPath);
  expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  // A PNG states its size in the IHDR chunk, at a fixed offset.
  const pngWidth = png.readUInt32BE(16);
  const pngHeight = png.readUInt32BE(20);
  expect(
    pngHeight,
    `the image is taller than it is wide (${pngWidth} x ${pngHeight})`,
  ).toBeGreaterThan(pngWidth);
});
