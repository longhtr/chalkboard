import { expect, test } from '@playwright/test';

const SOURCE = [
  String.raw`Evaluate $\frac{d}{dz}\frac{1}{1+e^{-z}}$. Let $u = 1+e^{-z}$.`,
  String.raw`Then, $\frac{d}{dz}\frac{1}{1+e^{-z}}$`,
  String.raw`$=\frac{d}{du}\frac{du}{dz}\frac{1}{u} = \frac{d}{du}\frac{1}{u}\frac{du}{dz}$`,
  String.raw`$=\left(-\frac{1}{u^2}\right)\frac{d}{dz}\left(1+e^{-z}\right)$`,
  String.raw`$=\left(-\frac{1}{1+e^{-z}}\right)\left(-e^{-z}\right)$`,
  String.raw`$=\frac{e^{-z}}{1+e^{-z}}$`,
].join('\n');

test('draws one highlight per line while the drag is still in progress', async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForURL(/\/local\/[0-9a-f-]{36}$/iu);
  await page.evaluate(() =>
    localStorage.setItem('chalkboard:equation-editing-view', 'source'),
  );
  await page.reload();
  await page.getByRole('button', { name: 'Mixed text block tool' }).click();
  const canvas = page.getByRole('application', {
    name: 'Chalkboard drawing canvas',
  });
  const box = await canvas.boundingBox();
  if (box === null) throw new Error('no canvas');
  await page.mouse.click(box.x + box.width / 2 - 250, box.y + 90);
  const source = page.getByRole('textbox', { name: 'Block source' });
  await expect(source).toBeFocused();
  await source.fill(SOURCE);
  await page
    .getByRole('group', { name: 'Editing view' })
    .getByRole('button', { name: 'Use rendered editing view' })
    .click();
  await page.waitForTimeout(2000);

  const lines = await page.evaluate(() => {
    const base = document
      .querySelector('math-field')
      ?.shadowRoot?.querySelector('.ML__base');
    if (!(base instanceof HTMLElement)) return null;
    const groups: DOMRect[][] = [[]];
    for (const child of base.children) {
      if (child.classList.contains('mixed-text-line-break')) {
        groups.push([]);
        continue;
      }
      const r = child.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) groups.at(-1)?.push(r);
    }
    return groups.map((g) =>
      g.length === 0
        ? null
        : {
            left: Math.min(...g.map((r) => r.left)),
            right: Math.max(...g.map((r) => r.right)),
            top: Math.min(...g.map((r) => r.top)),
            bottom: Math.max(...g.map((r) => r.bottom)),
          },
    );
  });
  if (!lines) throw new Error('no lines');
  const painted = lines.filter((line) => line !== null);
  expect(painted.length).toBeGreaterThan(4);
  const snapshot = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('.inline-math-editor__selection-rect')].map(
        (rectangle) => {
          const bounds = rectangle.getBoundingClientRect();
          return {
            bottom: bounds.bottom,
            right: bounds.right,
            top: bounds.top,
          };
        },
      ),
    );

  // Everything with a visible fill, ours and MathLive's alike. Reading only our
  // own highlights is what let a second highlight be drawn beside the block for
  // as long as it was: MathLive paints its selection from atom bounds it reads
  // back as if the block were one unwrapped row, so the boxes it drew for the
  // lines below the first landed hundreds of pixels to the right of any
  // writing, in a band beside the first line.
  const filled = () =>
    page.evaluate(() => {
      const field = document.querySelector('math-field');
      const root = field?.shadowRoot;
      if (!root) return null;
      const boxes: {
        bottom: number;
        left: number;
        right: number;
        top: number;
      }[] = [];
      const collect = (elements: Iterable<Element>) => {
        for (const element of elements) {
          const fill = getComputedStyle(element).backgroundColor;
          if (fill === 'transparent' || fill === 'rgba(0, 0, 0, 0)') continue;
          const bounds = element.getBoundingClientRect();
          if (bounds.width <= 0 || bounds.height <= 0) continue;
          boxes.push({
            bottom: bounds.bottom,
            left: bounds.left,
            right: bounds.right,
            top: bounds.top,
          });
        }
      };
      collect(root.querySelectorAll('*'));
      collect(document.querySelectorAll('.inline-math-editor__selection-rect'));
      return boxes;
    });

  const blockLeft = Math.min(...painted.map((line) => line.left));
  const blockRight = Math.max(...painted.map((line) => line.right));
  const blockTop = Math.min(...painted.map((line) => line.top));
  const blockBottom = Math.max(...painted.map((line) => line.bottom));

  const start = lines[0];
  if (!start) throw new Error('no first line');
  await page.mouse.move(start.left + 40, (start.top + start.bottom) / 2);
  await page.mouse.down();
  // Walk down through the block, reading the highlight at each stop without
  // releasing, which is when the reader actually sees it.
  for (const [index, line] of lines.entries()) {
    if (line === null || index === 0) continue;
    await page.mouse.move(line.left + 50, (line.top + line.bottom) / 2, {
      steps: 6,
    });
    await page.waitForTimeout(120);
    // Read mid-drag, which is when the reader sees it. Every earlier check ran
    // after the button came up, where the picture had already settled.
    const drawn = await snapshot();
    expect(drawn.length).toBe(index + 1);
    for (const [at, rect] of drawn.entries()) {
      const line = lines[at];
      if (line === null || line === undefined) continue;
      // On its own line, and never running past the writing on it.
      expect(rect.top).toBeGreaterThan(line.top - 6);
      expect(rect.bottom).toBeLessThan(line.bottom + 6);
      expect(rect.right).toBeLessThan(line.right + 3);
    }
    const fills = await filled();
    if (fills === null) throw new Error('no field');
    for (const box of fills) {
      expect(box.left).toBeGreaterThan(blockLeft - 4);
      expect(box.right).toBeLessThan(blockRight + 4);
      expect(box.top).toBeGreaterThan(blockTop - 4);
      expect(box.bottom).toBeLessThan(blockBottom + 4);
    }
  }
  await page.mouse.up();
  await page.waitForTimeout(400);
  expect((await snapshot()).length).toBe(painted.length);
});

test('highlights a keyboard selection on every line it covers', async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForURL(/\/local\/[0-9a-f-]{36}$/iu);
  await page.evaluate(() =>
    localStorage.setItem('chalkboard:equation-editing-view', 'source'),
  );
  await page.reload();
  await page.getByRole('button', { name: 'Mixed text block tool' }).click();
  const canvas = page.getByRole('application', {
    name: 'Chalkboard drawing canvas',
  });
  const box = await canvas.boundingBox();
  if (box === null) throw new Error('no canvas');
  await page.mouse.click(box.x + box.width / 2 - 250, box.y + 90);
  const source = page.getByRole('textbox', { name: 'Block source' });
  await expect(source).toBeFocused();
  await source.fill(SOURCE);
  await page
    .getByRole('group', { name: 'Editing view' })
    .getByRole('button', { name: 'Use rendered editing view' })
    .click();
  await page.waitForTimeout(2000);

  const lineTops = () =>
    page.evaluate(() => {
      const base = document
        .querySelector('math-field')
        ?.shadowRoot?.querySelector('.ML__base');
      if (!(base instanceof HTMLElement)) return null;
      return [...base.querySelectorAll('.mixed-text-line-break')].map((span) =>
        Math.round(span.getBoundingClientRect().top),
      );
    });
  const before = await lineTops();

  // Nothing drags here, so there is no pointer to read the selection from. The
  // highlight has to come from the marked writing itself.
  await page.keyboard.press('ControlOrMeta+a');
  await page.waitForTimeout(300);

  // Selecting writing must not move it. MathLive wraps a selected run in one
  // element reaching from the first selected line to the last, and the line
  // clearance measured that wrapper as ink overflowing the line it starts on:
  // select-all pushed the second line most of a page down.
  expect(await lineTops()).toEqual(before);

  const drawn = await page.evaluate(() => {
    const base = document
      .querySelector('math-field')
      ?.shadowRoot?.querySelector('.ML__base');
    if (!(base instanceof HTMLElement)) return null;
    const block = base.getBoundingClientRect();
    return {
      block: { left: block.left, right: block.right },
      rects: [
        ...document.querySelectorAll('.inline-math-editor__selection-rect'),
      ].map((rectangle) => {
        const bounds = rectangle.getBoundingClientRect();
        return {
          bottom: bounds.bottom,
          left: bounds.left,
          right: bounds.right,
          top: bounds.top,
        };
      }),
    };
  });
  if (drawn === null) throw new Error('no field');
  expect(drawn.rects.length).toBeGreaterThan(4);
  for (const rect of drawn.rects) {
    expect(rect.left).toBeGreaterThan(drawn.block.left - 4);
    expect(rect.right).toBeLessThan(drawn.block.right + 4);
  }
  // One per line rather than one box over the whole block: no two of them share
  // a row, and each is shorter than the block is tall.
  const height = Math.max(...drawn.rects.map((rect) => rect.bottom - rect.top));
  expect(height).toBeLessThan(100);
});

test('double-clicking a line selects that line and nothing else', async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForURL(/\/local\/[0-9a-f-]{36}$/iu);
  await page.evaluate(() =>
    localStorage.setItem('chalkboard:equation-editing-view', 'source'),
  );
  await page.reload();
  await page.getByRole('button', { name: 'Mixed text block tool' }).click();
  const canvas = page.getByRole('application', {
    name: 'Chalkboard drawing canvas',
  });
  const box = await canvas.boundingBox();
  if (box === null) throw new Error('no canvas');
  await page.mouse.click(box.x + box.width / 2 - 250, box.y + 90);
  const source = page.getByRole('textbox', { name: 'Block source' });
  await expect(source).toBeFocused();
  await source.fill(SOURCE);
  await page
    .getByRole('group', { name: 'Editing view' })
    .getByRole('button', { name: 'Use rendered editing view' })
    .click();
  await page.waitForTimeout(2000);

  const lines = await page.evaluate(() => {
    const base = document
      .querySelector('math-field')
      ?.shadowRoot?.querySelector('.ML__base');
    if (!(base instanceof HTMLElement)) return null;
    const groups: DOMRect[][] = [[]];
    for (const child of base.children) {
      if (child.classList.contains('mixed-text-line-break')) {
        groups.push([]);
        continue;
      }
      const r = child.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) groups.at(-1)?.push(r);
    }
    return groups.map((g) =>
      g.length === 0
        ? null
        : {
            bottom: Math.max(...g.map((r) => r.bottom)),
            left: Math.min(...g.map((r) => r.left)),
            right: Math.max(...g.map((r) => r.right)),
            top: Math.min(...g.map((r) => r.top)),
          },
    );
  });
  if (!lines) throw new Error('no lines');
  const third = lines[2];
  if (!third) throw new Error('no third line');

  await page.mouse.dblclick(third.left + 40, (third.top + third.bottom) / 2);
  await page.waitForTimeout(300);

  const drawn = await page.evaluate(() =>
    [...document.querySelectorAll('.inline-math-editor__selection-rect')].map(
      (rectangle) => {
        const bounds = rectangle.getBoundingClientRect();
        return {
          bottom: bounds.bottom,
          left: bounds.left,
          right: bounds.right,
          top: bounds.top,
        };
      },
    ),
  );
  // Exactly the line that was struck: one highlight, on that line, covering its
  // writing from end to end.
  expect(drawn.length).toBe(1);
  const rect = drawn[0];
  if (rect === undefined) throw new Error('no highlight');
  expect(rect.top).toBeGreaterThan(third.top - 6);
  expect(rect.bottom).toBeLessThan(third.bottom + 6);
  expect(rect.left).toBeLessThan(third.left + 6);
  expect(rect.right).toBeGreaterThan(third.right - 6);

  // Typing replaces that line alone: the block still has six lines, and the
  // five that were not struck still read as they did.
  const linesOf = () =>
    page.evaluate(() => {
      const field = document.querySelector('math-field') as {
        value?: string;
      } | null;
      return (field?.value ?? '').split('\u2063');
    });
  const before = await linesOf();
  expect(before.length).toBe(6);
  await page.keyboard.type('Z');
  await page.waitForTimeout(300);
  const after = await linesOf();
  expect(after.length).toBe(6);
  expect(after.filter((line, at) => line !== before[at])).toEqual([
    after[2] ?? '',
  ]);
});
