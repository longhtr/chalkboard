/** Seeded random editor command sequences with deterministic replay output and invariant checks after each step. */
import { expect, type Locator, type Page, test } from '@playwright/test';

import { assertValue, requiredValue } from './helpers/assertions';

const scenarioCount = positiveInteger(
  process.env.MATH_FUZZ_SCENARIOS,
  process.env.CI ? 4 : 8,
);
const stepsPerScenario = positiveInteger(process.env.MATH_FUZZ_STEPS, 60);
const baseSeed = positiveInteger(process.env.MATH_FUZZ_SEED, 0x5eed1234);
const initialFuzzElements = [
  {
    backgroundColor: 'transparent',
    createdBy: 'local',
    fontSize: 25,
    height: 125,
    id: 'math-fuzz-equation',
    lineSpacing: 1.4,
    opacity: 1,
    rotation: 0,
    source: String.raw`$\frac{a}{b}+\sqrt{x}$
$\sum_{i=0}^{n}i$
$\int_0^1 x\,dx$`,
    strokeColor: '#1f2937',
    strokeWidth: 2,
    type: 'equation',
    width: 210,
    x: -105,
    y: -65,
  },
];

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = value === undefined ? Number.NaN : Number.parseInt(value, 0);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function randomGenerator(seed: number) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function choose<T>(random: () => number, values: readonly T[]): T {
  return requiredValue(
    values[Math.floor(random() * values.length)],
    'a random candidate value',
  );
}

function integer(random: () => number, maximum: number) {
  return Math.floor(random() * maximum);
}

async function ensureMathMode(page: Page) {
  const indicator = page.locator('.mixed-text-tool-mode');
  if ((await indicator.textContent()) !== 'M') {
    await page.keyboard.press('Control+m');
  }
  await expect(indicator).toHaveText('M');
}

async function insertStructure(
  page: Page,
  random: () => number,
): Promise<string> {
  await ensureMathMode(page);
  const first = choose(random, ['a', 'b', 'x', 'y', 'n', '2']);
  const second = choose(random, ['c', 'd', 'i', 'j', 'm', '3']);
  const structure = integer(random, 8);
  if (structure === 0) {
    await page.keyboard.type('\\frac');
    await page.keyboard.press('Space');
    await page.keyboard.type(first);
    await page.keyboard.press('Tab');
    await page.keyboard.type(second);
    await page.keyboard.press('ArrowRight');
    return `fraction(${first},${second})`;
  }
  if (structure === 1) {
    await page.keyboard.type('\\sqrt');
    await page.keyboard.press('Space');
    await page.keyboard.type(first);
    await page.keyboard.press('ArrowRight');
    return `sqrt(${first})`;
  }
  if (structure === 2) {
    await page.keyboard.type('\\dot');
    await page.keyboard.press('Space');
    await page.keyboard.type(first);
    await page.keyboard.press('ArrowRight');
    return `dot(${first})`;
  }
  if (structure === 3) {
    await page.keyboard.type('\\overrightarrow');
    await page.keyboard.press('Space');
    await page.keyboard.type(first);
    await page.keyboard.press('ArrowRight');
    return `vector(${first})`;
  }
  if (structure === 4) {
    await page.keyboard.type('\\boxed');
    await page.keyboard.press('Space');
    await page.keyboard.type(first);
    await page.keyboard.press('ArrowRight');
    return `boxed(${first})`;
  }
  if (structure === 5) {
    await page.keyboard.type('\\mathbf');
    await page.keyboard.press('Space');
    await page.keyboard.type(first);
    await page.keyboard.press('ArrowRight');
    return `bold(${first})`;
  }
  if (structure === 6) {
    await page.keyboard.type('\\pdiff');
    await page.keyboard.press('Space');
    await page.keyboard.type(first);
    await page.keyboard.press('Tab');
    await page.keyboard.type(second);
    await page.keyboard.press('ArrowRight');
    return `partial(${first},${second})`;
  }
  await page.keyboard.type('\\underbrace');
  await page.keyboard.press('Space');
  await page.keyboard.type(first);
  await page.keyboard.press('ArrowRight');
  return `underbrace(${first})`;
}

async function pointerPoint(field: Locator, random: () => number) {
  const bounds = await field.boundingBox();
  assertValue(bounds, 'element bounds');
  if (bounds === null) return null;
  return {
    x: bounds.x + Math.max(2, random() * Math.max(2, bounds.width - 4)),
    y: bounds.y + Math.max(2, random() * Math.max(2, bounds.height - 4)),
  };
}

async function runRandomAction(
  page: Page,
  field: Locator,
  random: () => number,
): Promise<string> {
  const action = integer(random, 100);
  if (action < 13) {
    const atom = choose(random, ['a', 'b', 'x', 'y', '1', '2', '+', '-', '=']);
    await page.keyboard.type(atom);
    return `type ${atom}`;
  }
  if (action < 25) {
    await ensureMathMode(page);
    const command = choose(random, [
      '\\alpha',
      '\\beta',
      '\\gamma',
      '\\theta',
      '\\pi',
      '\\infty',
      '\\partial',
      '\\times',
      '\\leq',
      '\\neq',
      '\\rightarrow',
      '\\in',
    ]);
    await page.keyboard.type(command);
    await page.keyboard.press('Space');
    return `command ${command}`;
  }
  if (action < 39) return insertStructure(page, random);
  if (action < 48) {
    const key = choose(random, ['ArrowLeft', 'ArrowRight', 'Home', 'End']);
    const count = 1 + integer(random, 12);
    for (let index = 0; index < count; index += 1) {
      await page.keyboard.press(key);
    }
    return `${key} x${count}`;
  }
  if (action < 54) {
    const key = choose(random, ['ArrowUp', 'ArrowDown']);
    const count = 1 + integer(random, 4);
    for (let index = 0; index < count; index += 1) {
      await page.keyboard.press(key);
    }
    return `${key} x${count}`;
  }
  if (action < 61) {
    const edge = choose(random, ['Home', 'End']);
    const direction = edge === 'Home' ? 'ArrowRight' : 'ArrowLeft';
    const count = integer(random, 20);
    await page.keyboard.press(edge);
    for (let index = 0; index < count; index += 1) {
      await page.keyboard.press(direction);
    }
    return `place caret with ${edge}, then ${direction} x${count}`;
  }
  if (action < 68) {
    let point = await pointerPoint(field, random);
    if (point !== null) {
      point = await field.evaluate((mathField, candidate) => {
        const panel = document.querySelector('.style-panel');
        if (!(panel instanceof HTMLElement)) return candidate;
        const panelBounds = panel.getBoundingClientRect();
        const covered =
          candidate.x >= panelBounds.left &&
          candidate.x <= panelBounds.right &&
          candidate.y >= panelBounds.top &&
          candidate.y <= panelBounds.bottom;
        if (!covered) return candidate;
        const fieldBounds = mathField.getBoundingClientRect();
        const x = panelBounds.right + 4;
        return x < fieldBounds.right
          ? { x, y: candidate.y }
          : { x: fieldBounds.right - 4, y: candidate.y };
      }, point);
      await page.mouse.click(point.x, point.y);
    }
    return `pointer click (${point?.x.toFixed(1)},${point?.y.toFixed(1)})`;
  }
  if (action < 75) {
    const direction = choose(random, ['ArrowLeft', 'ArrowRight']);
    const count = 1 + integer(random, 8);
    for (let index = 0; index < count; index += 1) {
      await page.keyboard.press(`Shift+${direction}`);
    }
    const replacement = choose(random, ['q', '7', '+', '\\']);
    if (replacement === '\\') {
      await ensureMathMode(page);
      await page.keyboard.type('\\delta');
      await page.keyboard.press('Space');
    } else {
      await page.keyboard.type(replacement);
    }
    return `keyboard select ${direction} x${count}, replace with ${replacement}`;
  }
  if (action < 82) {
    const edge = choose(random, ['Home', 'End']);
    const direction = edge === 'Home' ? 'ArrowRight' : 'ArrowLeft';
    const skip = integer(random, 12);
    const count = 1 + integer(random, 10);
    await page.keyboard.press(edge);
    for (let index = 0; index < skip; index += 1) {
      await page.keyboard.press(direction);
    }
    for (let index = 0; index < count; index += 1) {
      await page.keyboard.press(`Shift+${direction}`);
    }
    const replacement = choose(random, ['r', '0', '-', '=']);
    await page.keyboard.type(replacement);
    return `${edge}, skip ${skip}, select ${direction} x${count}, replace with ${replacement}`;
  }
  if (action < 87) {
    const start = await pointerPoint(field, random);
    const end = await pointerPoint(field, random);
    if (start !== null && end !== null) {
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(end.x, end.y, { steps: 3 });
      await page.mouse.up();
      await page.keyboard.press(choose(random, ['Backspace', 'Delete']));
    }
    return `pointer drag and delete`;
  }
  if (action < 91) {
    await page.keyboard.press('Enter');
    return 'insert line break';
  }
  if (action < 94) {
    const selectionIsCollapsed = await field.evaluate(
      (mathField) => mathField.selectionIsCollapsed,
    );
    if (!selectionIsCollapsed || random() < 0.65) {
      await page.keyboard.press(choose(random, ['Backspace', 'Delete']));
      return 'delete';
    }
    return 'skip destructive delete';
  }
  if (action < 97) {
    await ensureMathMode(page);
    const latex = choose(random, [
      String.raw`$x^2+y^2$`,
      String.raw`\frac{m}{n}`,
      String.raw`\sqrt{z}`,
      String.raw`\sum_{k=0}^{p} k`,
    ]);
    await field.evaluate((mathField, text) => {
      const event = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', {
        value: { getData: () => text },
      });
      mathField.dispatchEvent(event);
    }, latex);
    return `paste ${latex}`;
  }
  await ensureMathMode(page);
  const grouped = choose(random, ['(x)', '[y]', '|a|']);
  await page.keyboard.type(grouped);
  return `type grouped expression ${grouped}`;
}

async function editorInvariant(field: Locator) {
  await field.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  return field.evaluate((mathField) => {
    const bounds = mathField.getBoundingClientRect();
    const selection = mathField.selection.ranges[0] ?? [
      mathField.position,
      mathField.position,
    ];
    const caret = mathField.shadowRoot?.querySelector(
      '.ML__caret, .ML__text-caret, .ML__latex-caret',
    );
    const caretBounds = caret?.getBoundingClientRect();
    const editor = mathField.closest<HTMLElement>('.inline-math-editor');
    const editorBounds = editor?.getBoundingClientRect();
    const rendered = [
      ...document.querySelectorAll<HTMLElement>('[data-mixed-text-id]'),
    ]
      .map((element) => {
        const bounds = element.getBoundingClientRect();
        return {
          distance:
            editorBounds === undefined
              ? Number.POSITIVE_INFINITY
              : Math.abs(bounds.left - editorBounds.left) +
                Math.abs(bounds.top - editorBounds.top),
          element,
        };
      })
      .sort((left, right) => left.distance - right.distance)[0]?.element;
    const internalBreaks = [...mathField.value].filter(
      (character) => character === '\u2063',
    ).length;
    const leadingInternalBreaks =
      mathField.value.match(/^\u2063+/u)?.[0].length ?? 0;
    const trailingInternalBreaks =
      mathField.value.match(/\u2063+$/u)?.[0].length ?? 0;
    const boundaryInternalBreaks = Math.min(
      internalBreaks,
      leadingInternalBreaks + trailingInternalBreaks,
    );
    const editorBreaks =
      mathField.shadowRoot?.querySelectorAll('.mixed-text-line-break').length ??
      0;
    const renderedBreaks =
      rendered?.querySelectorAll('.mixed-text-line-break').length ?? 0;
    const source = rendered?.getAttribute('aria-label') ?? '';
    const finiteRectangle = (rectangle: DOMRect | undefined) =>
      rectangle === undefined ||
      [rectangle.x, rectangle.y, rectangle.width, rectangle.height].every(
        Number.isFinite,
      );
    return {
      boundaryInternalBreaks,
      caretFinite: finiteRectangle(caretBounds),
      dimensionsFinite:
        finiteRectangle(bounds) && bounds.width > 0 && bounds.height > 0,
      editorBreaks,
      editorConnected: editor !== null && mathField.isConnected,
      errors: mathField.errors.map((error) => error.code),
      fieldValue: mathField.value,
      focused: document.activeElement === mathField,
      internalBreaks,
      position: mathField.position,
      positionValid:
        mathField.position >= 0 && mathField.position <= mathField.lastOffset,
      renderedBreaks,
      renderedError: rendered?.classList.contains('is-error') ?? false,
      renderedRawBreaks: [...(rendered?.textContent ?? '')].filter(
        (character) => character === '\u2063',
      ).length,
      selectionOverlayCount: document.querySelectorAll(
        '.inline-math-editor__selection-rect',
      ).length,
      selectionCollapsed: mathField.selectionIsCollapsed,
      selectionValid:
        selection[0] >= 0 &&
        selection[0] <= selection[1] &&
        selection[1] <= mathField.lastOffset,
      source,
      sourceBreaks: [...source].filter((character) => character === '\n')
        .length,
      sourceExists:
        rendered !== undefined ||
        mathField.value.replaceAll('\\placeholder{}', '').trim() === '',
      trailingInternalBreaks,
    };
  });
}

async function verifyControlledUndoRedo(page: Page, field: Locator) {
  const sourcesBefore = await page
    .locator('[data-mixed-text-id]')
    .evaluateAll((elements) =>
      Object.fromEntries(
        elements.map((element) => [
          (element as HTMLElement).dataset.mixedTextId ?? '',
          element.getAttribute('aria-label') ?? '',
        ]),
      ),
    );
  const marker = 'vz9';
  await page.keyboard.type(marker);
  let activeId: string | null = null;
  await expect
    .poll(async () => {
      activeId = await page.locator('[data-mixed-text-id]').evaluateAll(
        (elements, input) => {
          const occurrences = (source: string) =>
            source.split(input.marker).length - 1;
          return (
            elements
              .map((element) => ({
                id: (element as HTMLElement).dataset.mixedTextId ?? '',
                source: element.getAttribute('aria-label') ?? '',
              }))
              .find(
                ({ id, source }) =>
                  occurrences(source) >
                  occurrences(input.previousSources[id] ?? ''),
              )?.id ?? null
          );
        },
        { marker, previousSources: sourcesBefore },
      );
      return activeId;
    })
    .not.toBeNull();
  assertValue(activeId, 'active fuzz equation identity');
  const rendered = page.locator(`[data-mixed-text-id="${activeId}"]`);
  requiredValue(sourcesBefore[activeId], 'source before fuzz edit');
  const edited = await rendered.getAttribute('aria-label');
  assertValue(edited, 'edited source');

  await page.keyboard.press('Control+z');
  await expect.poll(() => rendered.getAttribute('aria-label')).not.toBe(edited);
  await page.keyboard.press('Control+Shift+z');
  await expect(rendered).toHaveAttribute('aria-label', edited);
  await expect(field).toBeFocused();
  return { id: activeId ?? '', source: edited ?? '' };
}

async function verifyCommitAndReopen(
  page: Page,
  activeId: string,
  expectedSource: string,
) {
  const rendered = page.locator(`[data-mixed-text-id="${activeId}"]`);
  await page.getByRole('button', { name: 'Selection tool' }).click();
  await expect(page.locator('math-field')).toHaveCount(0);
  await expect(rendered).toHaveAttribute('aria-label', expectedSource);
  await expect(rendered).not.toHaveClass(/is-error/);

  await page.getByRole('button', { name: 'Mixed text block tool' }).click();
  const bounds = await rendered.boundingBox();
  assertValue(bounds, 'element bounds');
  await page.mouse.click(
    bounds.x + Math.min(Math.max(2, bounds.width / 2), bounds.width - 2),
    bounds.y + Math.min(Math.max(2, bounds.height / 2), bounds.height - 2),
  );
  await expect(page.locator('.inline-math-editor')).toHaveClass(/is-ready/);
  await expect(page.locator('math-field')).toBeFocused();
  await expect(rendered).toHaveAttribute('aria-label', expectedSource);
}

test('survives randomized multiline LaTeX editing, navigation, selection, deletion, undo, and reopening', async ({
  page,
}, testInfo) => {
  test.setTimeout(Math.max(120_000, scenarioCount * stepsPerScenario * 350));
  const pageErrors: string[] = [];
  page.on('pageerror', (error) =>
    pageErrors.push(error.stack ?? error.message),
  );

  await page.addInitScript((elements) => {
    localStorage.setItem('chalkboard:input-mode', 'math');
    localStorage.setItem('chalkboard:local-document', JSON.stringify(elements));
  }, initialFuzzElements);
  await page.goto('/');
  await page.getByRole('button', { name: 'Mixed text block tool' }).click();
  const initialRendered = page.locator(
    '[data-mixed-text-id="math-fuzz-equation"]',
  );
  const initialBounds = await initialRendered.boundingBox();
  assertValue(initialBounds, 'initial element bounds');
  await page.mouse.click(
    initialBounds.x + initialBounds.width / 2,
    initialBounds.y + initialBounds.height / 2,
  );

  const field = page.locator('math-field');
  await expect(field).toBeFocused();
  await expect(page.locator('.inline-math-editor')).toHaveClass(/is-ready/);

  for (let scenario = 0; scenario < scenarioCount; scenario += 1) {
    const seed = (baseSeed + Math.imul(scenario, 0x9e3779b1)) >>> 0;
    const random = randomGenerator(seed);
    const actions: string[] = [];
    try {
      for (let step = 0; step < stepsPerScenario; step += 1) {
        const description = await runRandomAction(page, field, random);
        actions.push(`${step + 1}. ${description}`);
        const state = await editorInvariant(field);
        expect(pageErrors, `browser errors after ${description}`).toEqual([]);
        expect(
          state,
          `seed=${seed}, step=${step + 1}, action=${description}`,
        ).toMatchObject({
          caretFinite: true,
          dimensionsFinite: true,
          editorConnected: true,
          focused: true,
          positionValid: true,
          renderedError: false,
          selectionValid: true,
          sourceExists: true,
        });
        if (state.errors.length === 0) {
          expect(
            state.renderedRawBreaks,
            `rendered line break content: ${JSON.stringify(state)}`,
          ).toBe(state.sourceBreaks);
          expect(
            state.renderedBreaks,
            `decorated line breaks: ${JSON.stringify(state)}`,
          ).toBe(state.sourceBreaks);
        }
        if (state.selectionCollapsed) {
          expect(state.selectionOverlayCount).toBe(0);
        }
      }

      const edited = await verifyControlledUndoRedo(page, field);
      await verifyCommitAndReopen(page, edited.id, edited.source);
      expect(pageErrors, `seed=${seed}`).toEqual([]);
      if (scenario + 1 < scenarioCount) {
        const nextSeed = (baseSeed + Math.imul(scenario + 1, 0x9e3779b1)) >>> 0;
        const nextBoardId = `math-fuzz-${nextSeed}`;
        await page.evaluate(
          async ({ boardId, elements }) => {
            localStorage.setItem('chalkboard:input-mode', 'math');
            localStorage.setItem('chalkboard:caret-positions', '{}');
            localStorage.setItem(
              `chalkboard:local-document:${boardId}`,
              JSON.stringify(elements),
            );
            await new Promise<void>((resolve, reject) => {
              const request = indexedDB.open('chalkboard-local');
              request.addEventListener('error', () => reject(request.error));
              request.addEventListener('success', () => {
                const database = request.result;
                const transaction = database.transaction('boards', 'readwrite');
                transaction.objectStore('boards').put({
                  createdAt: Date.now(),
                  elements,
                  id: `local:${boardId}`,
                  schemaVersion: 2,
                  title: 'Fuzz board',
                  updatedAt: Date.now(),
                });
                transaction.addEventListener('complete', () => {
                  database.close();
                  resolve();
                });
                transaction.addEventListener('error', () =>
                  reject(transaction.error),
                );
              });
            });
          },
          { boardId: nextBoardId, elements: initialFuzzElements },
        );
        await page.goto(`/local/${nextBoardId}`);
        await page
          .getByRole('button', { name: 'Mixed text block tool' })
          .click();
        const nextRendered = page.locator(
          '[data-mixed-text-id="math-fuzz-equation"]',
        );
        const nextBounds = await nextRendered.boundingBox();
        assertValue(nextBounds, 'updated element bounds');
        await page.mouse.click(
          nextBounds.x + nextBounds.width / 2,
          nextBounds.y + nextBounds.height / 2,
        );
        await expect(field).toBeFocused();
        await expect(page.locator('.inline-math-editor')).toHaveClass(
          /is-ready/,
        );
      }
    } catch (error) {
      const replay = [
        `Replay with MATH_FUZZ_SEED=${seed} MATH_FUZZ_SCENARIOS=1 MATH_FUZZ_STEPS=${stepsPerScenario}`,
        '',
        ...actions,
        '',
        ...pageErrors,
      ].join('\n');
      await testInfo.attach(`math-fuzz-seed-${seed}.txt`, {
        body: replay,
        contentType: 'text/plain',
      });
      if (error instanceof Error) error.message += `\n\n${replay}`;
      throw error;
    }
  }
});
