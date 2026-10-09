/**
 * Characters LaTeX treats as syntax survive being written as prose.
 *
 * Canonical source stores a written `{`, `}`, `%` or undelimited `$` as itself,
 * but MathLive reads each as syntax: braces opened and closed a group and left
 * nothing behind, `%` commented out the rest of the row, and a `$` with no
 * partner reset everything after it into mathematics. Writing `50% of {x}` and
 * reopening the board therefore showed `50`.
 *
 * `$` and `\` already had sentinels for exactly this. These cover the rest.
 */
import { expect, test } from '@playwright/test';

import { assertValue } from './helpers/assertions';

interface Sample {
  readonly name: string;
  readonly source: string;
  readonly visible: string;
}

const SAMPLES: readonly Sample[] = [
  { name: 'brace pair', source: 'set {x, y} end', visible: 'set {x, y} end' },
  { name: 'unmatched close', source: 'a } b', visible: 'a } b' },
  { name: 'unmatched open', source: 'a { b', visible: 'a { b' },
  { name: 'percent', source: '50% of the row', visible: '50% of the row' },
  {
    name: 'unclosed dollar',
    source: 'costs $5 today',
    visible: 'costs $5 today',
  },
  {
    name: 'bare double dollar',
    source: 'lead $$ tail',
    visible: 'lead $$ tail',
  },
  {
    name: 'literals beside math',
    source: 'a {b} $x^2$ c% d',
    visible: 'a {b} x2 c% d',
  },
];

async function seed(page: import('@playwright/test').Page, source: string) {
  await page.addInitScript((value) => {
    localStorage.setItem(
      'chalkboard:local-document',
      JSON.stringify([
        {
          backgroundColor: 'transparent',
          createdBy: 'local',
          fontSize: 24,
          height: 120,
          id: 'literal-block',
          lineSpacing: 1.2,
          opacity: 1,
          rotation: 0,
          source: value,
          strokeColor: '#1f2937',
          strokeWidth: 2,
          type: 'equation',
          width: 400,
          x: -200,
          y: -80,
        },
      ]),
    );
  }, source);
  await page.goto('/');
  const rendered = page.locator('[data-mixed-text-id="literal-block"]');
  await rendered.waitFor();
  return rendered;
}

/** Reads what a reader sees, with the sentinels replaced by the glyphs drawn for them. */
async function drawnText(
  rendered: import('@playwright/test').Locator,
): Promise<string> {
  return rendered.evaluate((root) => {
    const drawn = (node: Node): string => {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
      if (!(node instanceof HTMLElement)) return '';
      if (node.classList.contains('ML__sr-only')) return '';
      const after = getComputedStyle(node, '::after').content;
      if (
        after !== 'none' &&
        after !== 'normal' &&
        node.className.includes('mixed-text-literal')
      ) {
        return after.replace(/^"|"$/gu, '').replace(/\\\\/gu, '\\');
      }
      if (node.classList.contains('mixed-text-color-marker')) return '';
      return [...node.childNodes].map(drawn).join('');
    };
    return drawn(root).replace(/\s+/gu, ' ').trim();
  });
}

test('publishes composed text before an immediate source switch', async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem('chalkboard:input-mode', 'text'),
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Mixed text block tool' }).click();
  const canvas = page.getByRole('application', {
    name: 'Chalkboard drawing canvas',
  });
  const bounds = await canvas.boundingBox();
  assertValue(bounds, 'drawing canvas bounds');
  await page.mouse.click(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  );
  const field = page.locator('math-field');
  await page.locator('.inline-math-editor.is-ready').waitFor();
  await field.evaluate((mathField) => {
    mathField.dispatchEvent(
      new CompositionEvent('compositionstart', {
        bubbles: true,
        data: '漢',
      }),
    );
    mathField.insert('漢', {
      insertionMode: 'replaceSelection',
      mode: 'text',
      selectionMode: 'after',
    });
    mathField.dispatchEvent(
      new CompositionEvent('compositionend', { bubbles: true, data: '漢' }),
    );
  });
  await page.keyboard.press('Control+e');
  await expect(page.getByRole('textbox', { name: 'Block source' })).toHaveValue(
    '漢',
  );
});

test('accepts printable AltGraph text without treating it as a shortcut', async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem('chalkboard:input-mode', 'text'),
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Mixed text block tool' }).click();
  const canvas = page.getByRole('application', {
    name: 'Chalkboard drawing canvas',
  });
  const bounds = await canvas.boundingBox();
  assertValue(bounds, 'drawing canvas bounds');
  await page.mouse.click(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  );
  const field = page.locator('math-field');
  await page.locator('.inline-math-editor.is-ready').waitFor();
  await field.evaluate((mathField) => {
    const event = new KeyboardEvent('keydown', {
      altKey: true,
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      key: '@',
    });
    Object.defineProperty(event, 'getModifierState', {
      value: (modifier: string) => modifier === 'AltGraph',
    });
    mathField.dispatchEvent(event);
  });
  await expect(page.locator('[data-mixed-text-id]').first()).toHaveAttribute(
    'aria-label',
    '@',
  );
});

for (const { name, source, visible } of SAMPLES) {
  test(`draws ${name} as written`, async ({ page }) => {
    const rendered = await seed(page, source);
    await expect.poll(() => drawnText(rendered)).toBe(visible);

    // Opening the block for editing must show the same characters, and closing
    // it again must not have rewritten the source.
    await page.getByRole('button', { name: 'Mixed text block tool' }).click();
    const box = await rendered.boundingBox();
    assertValue(box, 'block box');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.locator('.inline-math-editor.is-ready').waitFor();
    await page.getByRole('button', { name: 'Selection tool' }).click();
    await expect(page.locator('math-field')).toHaveCount(0);

    await expect
      .poll(() =>
        page.evaluate(() => {
          const boardId = window.location.pathname.split('/').at(-1) ?? '';
          const elements = JSON.parse(
            localStorage.getItem(`chalkboard:local-document:${boardId}`) ??
              '[]',
          ) as { source?: string }[];
          return elements[0]?.source;
        }),
      )
      .toBe(source);
  });
}
