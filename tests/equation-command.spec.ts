/** Visible LaTeX command entry for immediate, deferred, buffered, placeholder, cancellation, and undo cases. */
import { expect, test } from '@playwright/test';

import { assertValue } from './helpers/assertions';
import {
  activeMathLatex,
  canvasBounds,
  createEmptyMathRegion,
  finishEditing,
} from './helpers/equationEditor';

test('keeps LaTeX command suggestions hidden', async ({ page }) => {
  await page.goto('/');
  const { bounds } = await canvasBounds(page);
  assertValue(bounds, 'element bounds');

  await createEmptyMathRegion(page, bounds.x + 480, bounds.y + 260);
  const mathField = page.locator('math-field');
  await expect(mathField).toBeFocused();
  await page.keyboard.type('\\frac');
  await expect(mathField).toHaveJSProperty('popoverPolicy', 'off');
  await expect(page.locator('#mathlive-suggestion-popover')).toBeHidden();
  await page.keyboard.press('Space');
  await expect
    .poll(() => activeMathLatex(mathField))
    .toContain(String.raw`\frac`);
});

test('accepts a LaTeX command with Enter before Enter creates a row', async ({
  page,
}) => {
  await page.goto('/');
  const { bounds } = await canvasBounds(page);
  assertValue(bounds, 'element bounds');

  await createEmptyMathRegion(page, bounds.x + 480, bounds.y + 260);
  const mathField = page.locator('math-field');
  await page.keyboard.type('\\frac');
  await page.keyboard.press('Enter');
  await expect
    .poll(() => mathField.evaluate((field) => field.mode))
    .toBe('math');
  await page.keyboard.type('a');
  await page.keyboard.press('Tab');
  await page.keyboard.type('b');
  await expect
    .poll(() => activeMathLatex(mathField))
    .toBe(String.raw`\frac{a}{b}`);

  await page.keyboard.press('Enter');
  await page.keyboard.type('c');
  await page.keyboard.press('Control+e');
  await expect(page.getByRole('textbox', { name: 'Block source' })).toHaveValue(
    '$\\frac{a}{b}$\n$c$',
  );
});

test('preserves an in-progress command when switching to source view', async ({
  page,
}) => {
  await page.goto('/');
  const { bounds } = await canvasBounds(page);
  assertValue(bounds, 'element bounds');

  await createEmptyMathRegion(page, bounds.x + 480, bounds.y + 260);
  const mathField = page.locator('math-field');
  await page.keyboard.type('\\alpha');
  await expect
    .poll(() => mathField.evaluate((field) => field.mode))
    .toBe('latex');
  await page.keyboard.press('Control+e');
  await expect(page.getByRole('textbox', { name: 'Block source' })).toHaveValue(
    '$\\alpha$',
  );
});

test('commits an in-progress command when editing closes', async ({ page }) => {
  await page.goto('/');
  const { bounds } = await canvasBounds(page);
  assertValue(bounds, 'element bounds');

  await createEmptyMathRegion(page, bounds.x + 480, bounds.y + 260);
  const mathField = page.locator('math-field');
  await page.keyboard.type('\\alpha');
  await expect
    .poll(() => mathField.evaluate((field) => field.mode))
    .toBe('latex');
  await page.getByRole('button', { name: 'Selection tool' }).click();
  await expect(page.getByRole('math', { name: '\\alpha' })).toBeVisible();
});

test('uses MathLive as the only visible renderer during active editing', async ({
  page,
}) => {
  await page.goto('/');
  const { bounds } = await canvasBounds(page);
  assertValue(bounds, 'element bounds');

  await createEmptyMathRegion(page, bounds.x + 480, bounds.y + 260);
  const mathField = page.locator('math-field');
  await page.keyboard.type('abc');
  const rendered = page.locator('[data-mixed-text-id]');
  await expect(rendered).toHaveCSS('opacity', '0');
  await expect(mathField).toHaveCSS('color', 'rgb(31, 41, 55)');
  await expect
    .poll(() =>
      mathField.evaluate((field) => {
        const base = field.shadowRoot?.querySelector('.ML__base');
        return base?.textContent ?? '';
      }),
    )
    .toContain('abc');

  await page.getByRole('button', { name: 'Selection tool' }).click();
  await expect(mathField).toHaveCount(0);
  await expect(rendered).toHaveCSS('opacity', '1');
  await expect(page.getByRole('math', { name: 'abc' })).toBeVisible();
});

test('shows in-progress LaTeX commands without overlapping existing math', async ({
  page,
}) => {
  await page.goto('/');
  const { bounds } = await canvasBounds(page);
  assertValue(bounds, 'element bounds');

  await createEmptyMathRegion(page, bounds.x + 480, bounds.y + 260);
  const mathField = page.locator('math-field');
  await page.keyboard.type('abc');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.type('\\df');

  await expect(mathField).toHaveAttribute('data-latex-command-active', '');
  const rendered = page.locator('[data-mixed-text-id]');
  await expect(rendered).toHaveCSS('opacity', '0');
  await expect
    .poll(() =>
      mathField.evaluate((field) => {
        const rawLatex = [
          ...(field.shadowRoot?.querySelectorAll('.ML__raw-latex') ?? []),
        ];
        const lastCommandCharacter = rawLatex.at(-1);
        const followingB = [
          ...(field.shadowRoot?.querySelectorAll('.ML__mathit') ?? []),
        ].find((element) => element.textContent === 'b');
        if (
          !(lastCommandCharacter instanceof HTMLElement) ||
          !(followingB instanceof HTMLElement)
        ) {
          return false;
        }
        return (
          lastCommandCharacter.getBoundingClientRect().right <=
          followingB.getBoundingClientRect().left + 0.5
        );
      }),
    )
    .toBe(true);
  await expect
    .poll(() => mathField.evaluate((field) => getComputedStyle(field).color))
    .toBe('rgb(31, 41, 55)');

  await page.keyboard.press('Escape');
  await expect(mathField).not.toHaveAttribute('data-latex-command-active', '');
  await expect(rendered).toHaveCSS('opacity', '0');
  await expect
    .poll(() => mathField.evaluate((field) => field.mode))
    .toBe('math');
});

test('completes a LaTeX structure at its original mid-equation caret', async ({
  page,
}) => {
  await page.goto('/');
  const { bounds } = await canvasBounds(page);
  assertValue(bounds, 'element bounds');

  await createEmptyMathRegion(page, bounds.x + 480, bounds.y + 260);
  const mathField = page.locator('math-field');
  await page.keyboard.type('abc');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.type('\\dot');
  await page.keyboard.press('Space');
  await page.keyboard.type('x');

  await expect
    .poll(() => activeMathLatex(mathField))
    .toBe(String.raw`ab\dot{x}c`);
  await expect
    .poll(() => mathField.evaluate((field) => field.errors.length))
    .toBe(0);
});

test('keeps command transactions anchored at the start, middle, and end', async ({
  page,
}) => {
  await page.goto('/');
  const { bounds } = await canvasBounds(page);
  assertValue(bounds, 'element bounds');
  await createEmptyMathRegion(page, bounds.x + 480, bounds.y + 260);
  const mathField = page.locator('math-field');

  const commands = [
    {
      complete: async () => {
        await page.keyboard.type('\\alpha');
        await page.keyboard.press('Space');
      },
      latex: String.raw`\alpha`,
    },
    {
      complete: async () => {
        await page.keyboard.type('\\dot');
        await page.keyboard.press('Space');
        await page.keyboard.type('x');
      },
      latex: String.raw`\dot{x}`,
    },
    {
      complete: async () => {
        await page.keyboard.type('\\frac');
        await page.keyboard.press('Space');
        await page.keyboard.type('x');
        await page.keyboard.press('Tab');
        await page.keyboard.type('y');
        await page.keyboard.press('ArrowRight');
      },
      latex: String.raw`\frac{x}{y}`,
    },
    {
      complete: async () => {
        await page.keyboard.type('\\mathbf');
        await page.keyboard.press('Space');
        await page.keyboard.type('x');
      },
      latex: String.raw`\mathbf{x}`,
    },
    {
      complete: async () => {
        await page.keyboard.type('\\pdiff');
        await page.keyboard.press('Space');
        await page.keyboard.type('x');
        await page.keyboard.press('Tab');
        await page.keyboard.type('y');
        await page.keyboard.press('ArrowRight');
      },
      latex: String.raw`\frac{\partial x}{\partial y}`,
    },
  ];

  for (const position of [0, 1, 3]) {
    for (const command of commands) {
      await mathField.evaluate((field, nextPosition) => {
        field.setValue('', {
          mode: 'text',
          silenceNotifications: true,
        });
        field.defaultMode = 'text';
        field.executeCommand(['switchMode', 'text']);
        field.setValue('$abc$', {
          mode: 'text',
          silenceNotifications: true,
        });
        field.executeCommand(['switchMode', 'math']);
        field.position = nextPosition === 3 ? field.lastOffset : nextPosition;
        field.focus();
      }, position);
      await command.complete();
      const prefix = 'abc'.slice(0, position);
      const suffix = 'abc'.slice(position);
      const separator =
        command.latex === String.raw`\alpha` && /^[A-Za-z]/.test(suffix)
          ? ' '
          : '';
      await expect
        .poll(() => activeMathLatex(mathField))
        .toBe(`${prefix}${command.latex}${separator}${suffix}`);
    }
  }

  for (const direction of ['forward', 'backward'] as const) {
    for (const command of commands) {
      await mathField.evaluate((field, nextDirection) => {
        field.setValue('abcdef', {
          mode: 'math',
          silenceNotifications: true,
        });
        field.selection = {
          direction: nextDirection,
          ranges: [[2, 4]],
        };
        field.focus();
      }, direction);
      await command.complete();
      const separator = command.latex === String.raw`\alpha` ? ' ' : '';
      await expect
        .poll(() => activeMathLatex(mathField))
        .toBe(`ab${command.latex}${separator}ef`);
    }
  }
});

test('undoes and redoes a command that replaces a math selection', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'chalkboard:local-document',
      JSON.stringify([
        {
          backgroundColor: 'transparent',
          createdBy: 'local',
          fontSize: 32,
          height: 60,
          id: 'command-selection-history',
          opacity: 1,
          rotation: 0,
          source: '$abcdef$',
          strokeColor: '#1f2937',
          strokeWidth: 2,
          type: 'equation',
          width: 200,
          x: 0,
          y: 0,
        },
      ]),
    );
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Mixed text block tool' }).click();
  const rendered = page.locator(
    '[data-mixed-text-id="command-selection-history"]',
  );
  const bounds = await rendered.boundingBox();
  assertValue(bounds, 'element bounds');
  await page.mouse.click(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  );
  const mathField = page.locator('math-field');
  await expect(mathField).toBeFocused();
  const modeIndicator = page.locator('.mixed-text-tool-mode');
  if ((await modeIndicator.textContent()) !== 'M') {
    await page.keyboard.press('Control+m');
  }
  await expect(modeIndicator).toHaveText('M');
  await expect(page.locator('.inline-math-editor')).toHaveClass(/is-ready/u);
  await expect
    .poll(() =>
      mathField.evaluate((field) =>
        field.shadowRoot?.activeElement?.classList.contains(
          'ML__keyboard-sink',
        ),
      ),
    )
    .toBe(true);
  await mathField.evaluate((field) => {
    field.focus();
    field.selection = { direction: 'forward', ranges: [[2, 4]] };
  });
  await expect
    .poll(() => mathField.evaluate((field) => field.selection.ranges[0]))
    .toEqual([2, 4]);

  await page.keyboard.type('\\dot');
  await page.keyboard.press('Space');
  await page.keyboard.type('x');
  await expect.poll(() => activeMathLatex(mathField)).toBe('ab\\dot{x}ef');

  await page.keyboard.press('Control+z');
  await expect.poll(() => activeMathLatex(mathField)).toBe('abcdef');
  await expect
    .poll(() => mathField.evaluate((field) => field.position))
    .toBe(2);

  await page.keyboard.press('Control+Shift+z');
  await expect.poll(() => activeMathLatex(mathField)).toBe('ab\\dot{x}ef');
});

test('fills unary accent commands with the next typed character', async ({
  page,
}) => {
  await page.goto('/');
  const { bounds } = await canvasBounds(page);
  assertValue(bounds, 'element bounds');

  await createEmptyMathRegion(page, bounds.x + 480, bounds.y + 260);
  const mathField = page.locator('math-field');
  await page.keyboard.type('\\dot');
  await page.keyboard.press('Space');
  await expect
    .poll(() => mathField.evaluate((field) => field.getValue(field.selection)))
    .toContain(String.raw`\placeholder{}`);
  await page.keyboard.type('x');
  await expect.poll(() => activeMathLatex(mathField)).toBe(String.raw`\dot{x}`);

  await page.keyboard.press('ArrowRight');
  await page.keyboard.type('+\\hat');
  await page.keyboard.press('Space');
  await page.keyboard.type('y');
  await expect
    .poll(() => activeMathLatex(mathField))
    .toBe(String.raw`\dot{x}+\hat{y}`);
  await finishEditing(page);
  await expect(
    page.getByRole('math', { name: String.raw`\dot{x}+\hat{y}` }),
  ).toBeVisible();
});

test('keeps argument-taking commands when their first value is typed', async ({
  page,
}) => {
  await page.goto('/');
  const { bounds } = await canvasBounds(page);
  assertValue(bounds, 'element bounds');

  await createEmptyMathRegion(page, bounds.x + 480, bounds.y + 260);
  const mathField = page.locator('math-field');
  const commands = [
    ['\\underbrace', String.raw`\underbrace{x}`],
    ['\\sqrt', String.raw`\sqrt{x}`],
    ['\\cancel', String.raw`\cancel{x}`],
    ['\\overrightarrow', String.raw`\overrightarrow{x}`],
    ['\\boxed', String.raw`\boxed{x}`],
    ['\\underline', String.raw`\underline{x}`],
    ['\\^', String.raw`\^{x}`],
    ['\\mathbf', String.raw`\mathbf{x}`],
  ] as const;

  for (const [command, expected] of commands) {
    await mathField.evaluate((field) => {
      field.setValue('', { mode: 'math', silenceNotifications: true });
      field.focus();
    });
    await page.keyboard.type(command);
    await page.keyboard.press('Space');
    await expect
      .poll(() =>
        mathField.evaluate((field) => field.getValue(field.selection)),
      )
      .toContain(String.raw`\placeholder{}`);
    await page.keyboard.type('x');
    await expect.poll(() => activeMathLatex(mathField)).toBe(expected);
  }

  await mathField.evaluate((field) => {
    field.setValue('', { mode: 'math', silenceNotifications: true });
    field.focus();
  });
  await page.keyboard.type('\\underset');
  await page.keyboard.press('Space');
  await expect
    .poll(() =>
      mathField.evaluate(
        (field) => field.value.match(/\\placeholder\{\}/g)?.length ?? 0,
      ),
    )
    .toBe(2);
  await page.keyboard.type('x');
  await page.keyboard.press('Tab');
  await page.keyboard.type('y');
  await expect
    .poll(() => activeMathLatex(mathField))
    .toBe(String.raw`\underset{y}{x}`);

  await mathField.evaluate((field) => {
    field.setValue('', { mode: 'math', silenceNotifications: true });
    field.focus();
  });
  await page.keyboard.type('\\pdiff');
  await page.keyboard.press('Space');
  await page.keyboard.type('x');
  await page.keyboard.press('Tab');
  await page.keyboard.type('y');
  await expect
    .poll(() => activeMathLatex(mathField))
    .toBe(String.raw`\frac{\partial x}{\partial y}`);

  await mathField.evaluate((field) => {
    field.setValue('', { mode: 'math', silenceNotifications: true });
    field.focus();
  });
  await page.keyboard.type('\\nicefrac');
  await page.keyboard.press('Space');
  await page.keyboard.type('x');
  await page.keyboard.press('Tab');
  await page.keyboard.type('y');
  await expect
    .poll(() => activeMathLatex(mathField))
    .toBe(String.raw`^{x}\!\!/\!_{y}`);

  await mathField.evaluate((field) => {
    field.setValue('', { mode: 'math', silenceNotifications: true });
    field.focus();
  });
  await page.keyboard.type('\\ce');
  await page.keyboard.press('Space');
  await page.keyboard.type('H2O');
  await page.keyboard.press('Tab');
  await expect
    .poll(() => activeMathLatex(mathField))
    .toBe(String.raw`\ce{H2O}`);

  await mathField.evaluate((field) => {
    field.setValue('', { mode: 'math', silenceNotifications: true });
    field.focus();
  });
  await page.keyboard.type('\\color');
  await page.keyboard.press('Space');
  await page.keyboard.type('red');
  await page.keyboard.press('Tab');
  await page.keyboard.type('x+1');
  await page.keyboard.press('Tab');
  await expect
    .poll(() => activeMathLatex(mathField))
    .toBe(String.raw`\textcolor{red}{x+1}`);

  await mathField.evaluate((field) => {
    field.setValue('', { mode: 'math', silenceNotifications: true });
    field.focus();
  });
  await page.keyboard.type('\\mathchoice');
  await page.keyboard.press('Space');
  for (const argument of ['a', 'b', 'c', 'd']) {
    await page.keyboard.type(argument);
    await page.keyboard.press('Tab');
  }
  await expect
    .poll(() => activeMathLatex(mathField))
    .toBe(String.raw`\mathchoice{a}{b}{c}{d}`);

  await mathField.evaluate((field) => {
    field.setValue('', { mode: 'math', silenceNotifications: true });
    field.focus();
  });
  await page.keyboard.type('\\mathbf');
  await page.keyboard.press('Space');
  await page.keyboard.type('hello');
  await expect
    .poll(() => activeMathLatex(mathField))
    .toBe(String.raw`\mathbf{hello}`);

  await mathField.evaluate((field) => {
    field.setValue('', { mode: 'math', silenceNotifications: true });
    field.focus();
  });
  await page.keyboard.type('\\textbf');
  await page.keyboard.press('Space');
  await page.keyboard.type('hello');
  await expect
    .poll(() => activeMathLatex(mathField))
    .toBe(String.raw`\mathbf{hello}`);

  await mathField.evaluate((field) => {
    field.setValue('', { mode: 'math', silenceNotifications: true });
    field.focus();
  });
  await page.keyboard.type('\\bigl');
  await page.keyboard.press('Space');
  await page.keyboard.type('(');
  await expect.poll(() => activeMathLatex(mathField)).toBe(String.raw`\bigl(`);

  await mathField.evaluate((field) => {
    field.setValue('', { mode: 'math', silenceNotifications: true });
    field.focus();
  });
  await page.keyboard.type('\\the');
  await page.keyboard.press('Space');
  await page.keyboard.type('\\count0');
  await page.keyboard.press('Tab');
  await expect
    .poll(() => activeMathLatex(mathField))
    .toBe(String.raw`\the{\count0}`);

  await mathField.evaluate((field) => {
    field.setValue('', { mode: 'math', silenceNotifications: true });
    field.focus();
  });
  await page.keyboard.type('\\displaylines');
  await page.keyboard.press('Space');
  await page.keyboard.type('x');
  await page.keyboard.press('Tab');
  await expect.poll(() => activeMathLatex(mathField)).toBe('x');
});

test('renders a completed href body without exposing an active link', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'chalkboard:local-document',
      JSON.stringify([
        {
          backgroundColor: 'transparent',
          createdBy: 'local',
          fontSize: 25,
          height: 40,
          id: 'href-math',
          lineSpacing: 1.2,
          opacity: 1,
          rotation: 0,
          source: String.raw`\href{https://example.com}{x+1}`,
          strokeColor: '#1f2937',
          strokeWidth: 2,
          type: 'equation',
          width: 80,
          x: -100,
          y: -50,
        },
      ]),
    );
  });
  await page.goto('/');
  const rendered = page.locator('[data-mixed-text-id="href-math"]');
  await expect(rendered).toBeVisible();
  await expect(rendered).not.toHaveClass(/is-error/);
  await expect(rendered).toContainText('x+1');
  await expect(rendered.locator('a')).toHaveCount(0);
});
