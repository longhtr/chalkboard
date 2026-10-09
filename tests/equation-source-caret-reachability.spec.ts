/**
 * Every rendered caret position must be reachable from source view.
 *
 * This suite owns the assumption the caret mapping rests on: that a MathLive
 * serialization and the canonical source describe the same writing. Nothing in
 * the mapping can verify that on its own, and when it quietly stopped holding
 * a third of the caret positions in an ordinary derivation became impossible
 * to click into, with no failing test anywhere. The corpus below is therefore
 * checked against a real field rather than a recorded table, so a change in how
 * MathLive serializes fails here instead of reaching a reader.
 */
import { expect, test } from '@playwright/test';

import {
  fromMathLiveMultilineSource,
  mathSegments,
} from '../apps/web/src/math/mixedMath';
import {
  fieldOffsetForSourceOffset,
  sourceOffsetForFieldOffset,
  type SerializedCaretBoundary,
} from '../apps/web/src/math/sourceCaretMapping';
import { assertValue } from './helpers/assertions';

/**
 * The prose letters of a fragment, with mathematics removed.
 *
 * Reachability alone cannot catch a mapping that is uniformly wrong, and the
 * defect that started this suite was exactly that: every position stayed
 * reachable while landing in the wrong row. Prose is the part both spellings
 * agree on -- mathematics differs because MathLive aliases commands -- so
 * counting it compares the two descriptions without reusing the tokenizer the
 * mapping itself depends on.
 */
function proseLetters(value: string): number {
  const decoded = fromMathLiveMultilineSource(value);
  let prose = '';
  let cursor = 0;
  for (const segment of mathSegments(decoded)) {
    prose += decoded.slice(cursor, segment.openStart);
    cursor = segment.closeEnd;
  }
  prose += decoded.slice(cursor);
  return prose.replace(/\\[A-Za-z]+/gu, '').replace(/[^A-Za-z0-9]/gu, '')
    .length;
}

/**
 * The same count for a prefix of a document, whose mathematics is cut open.
 *
 * The regions come from the whole document because a prefix can stop inside a
 * `$ ... $` pair, and a lone delimiter would otherwise make the mathematics
 * after it read as prose.
 */
function proseLettersBefore(source: string, end: number): number {
  const ignored = new Array<boolean>(source.length).fill(false);
  for (const segment of mathSegments(source)) {
    for (let index = segment.openStart; index < segment.closeEnd; index += 1) {
      ignored[index] = true;
    }
  }
  // A command spells its name in letters the reader never sees, and the field
  // carries the same writing as a sentinel, so the name is not prose either.
  for (const match of source.matchAll(/\\[A-Za-z]+/gu)) {
    for (let offset = 0; offset < match[0].length; offset += 1) {
      ignored[match.index + offset] = true;
    }
  }
  let count = 0;
  for (let index = 0; index < Math.min(end, source.length); index += 1) {
    if (!ignored[index] && /[A-Za-z0-9]/u.test(source[index]!)) count += 1;
  }
  return count;
}

/**
 * `allowedDrift` is how far a caret may land from the writing it describes,
 * counted in prose letters. It records what this suite measured, not what the
 * mapping is entitled to: a number above zero marks a construct whose two
 * spellings still disagree, and each one names its cause where it is declared.
 * Tighten a number when its cause is fixed; never raise one to make a change
 * pass, because that is how the original defect stayed invisible.
 */
const corpus: { allowedDrift: number; name: string; source: string }[] = [
  {
    allowedDrift: 0,
    name: 'prose and inline mathematics on one line',
    source: String.raw`Let $u=1+e^{-z}$ and note $\frac{a}{b}$.`,
  },
  {
    // The reported document. Rows are what broke it: the canonical newline and
    // MathLive's line-break sentinel are the same writing spelled two ways.
    //
    // Two of its 177 positions are one prose letter out, both where a cut falls
    // inside `\text{z}` and MathLive serializes the `z` past the closing `$`.
    // The letter is then prose on one side and mathematics on the other. That
    // belongs to the serializer rather than to this mapping, and it moves no
    // caret out of order or out of reach.
    allowedDrift: 1,
    name: 'multi-row derivation with nested fractions and operators',
    source: [
      String.raw`Evaluate $\frac{d}{\differentialD\text{z}}\frac{1}{1+e^{-z}}$. Let $u=1+e^{-z}$. `,
      String.raw`Then,$\frac{d}{\differentialD\text{z}}\frac{1}{1+e^{-z}}=\frac{d}{d}\frac{du}{dz}\frac{1}{u}=\frac{d}{du}\frac{1}{u^{}}\frac{du}{dz}$`,
      String.raw`$=\left(-\frac{1}{u^2}\right)\frac{d}{dz}\left(1+e^{-z}\right)=\left(-\frac{1}{1+e^{-z}}\right)\left(-e^{-z}\right)=\frac{e^{-z}}{1+e^{-z}}$`,
    ].join('\n'),
  },
  {
    // Styled prose reaches the field as sentinels rather than as commands.
    allowedDrift: 0,
    name: 'styled prose across rows',
    source: [
      String.raw`A \textbf{bold} claim about $x^2$.`,
      String.raw`And an \textit{emphatic} one about $\sqrt{y}$.`,
    ].join('\n'),
  },
  {
    // Braces are escaped only inside a styled run, so one brace can reach the
    // field as a command and its neighbour as a bare character.
    allowedDrift: 0,
    name: 'styled prose holding literal braces',
    source: String.raw`A \textbf{bold \textbraceleft brace\textbraceright} and $x$.`,
  },
  {
    // Colour reaches the field as a marker, never as the command source keeps.
    allowedDrift: 0,
    name: 'coloured prose beside mathematics',
    source: String.raw`A \textcolor{#e03131}{red} word before $\frac{a}{b}$.`,
  },
  {
    // Each literal is written one way and serialized another. The spellings
    // are the ones canonical source actually uses: a brace and a percent stand
    // bare and become sentinels, while a dollar is escaped because a bare one
    // would open mathematics.
    allowedDrift: 0,
    name: 'literal characters that carry sentinels',
    source: String.raw`Costs \$5, 10% of $n$, a brace { and } and a slash.`,
  },
];

for (const { allowedDrift, name, source } of corpus) {
  test(`every rendered caret position is reachable: ${name}`, async ({
    page,
  }) => {
    await page.goto('/');
    await page.waitForURL(/\/local\/[0-9a-f-]{36}$/i);
    await page.evaluate(() =>
      localStorage.setItem('chalkboard:equation-editing-view', 'source'),
    );
    await page.reload();
    await page.getByRole('button', { name: 'Mixed text block tool' }).click();
    const canvas = page.getByRole('application', {
      name: 'Chalkboard drawing canvas',
    });
    const canvasBounds = await canvas.boundingBox();
    assertValue(canvasBounds, 'drawing canvas bounds');
    await page.mouse.click(
      canvasBounds.x + canvasBounds.width / 2,
      canvasBounds.y + canvasBounds.height / 2,
    );

    await page.getByRole('textbox', { name: 'Block source' }).fill(source);
    await page
      .getByRole('button', { name: 'Use rendered editing view' })
      .click();
    const field = page.locator('math-field');
    await expect(field).toBeVisible();

    const table = await field.evaluate((element) => {
      const mathfield = element as unknown as {
        lastOffset: number;
        getValue(range: [number, number]): string;
      };
      const last = mathfield.lastOffset;
      return Array.from({ length: last + 1 }, (_entry, fieldOffset) => ({
        fieldOffset,
        left: mathfield.getValue([0, fieldOffset]),
        right: mathfield.getValue([fieldOffset, last]),
      }));
    });
    const boundaries: SerializedCaretBoundary[] = table;
    expect(boundaries.length).toBeGreaterThan(1);

    // Offsets must rise with the positions they describe. A position that
    // resolves behind its predecessor has been matched into the wrong part of
    // the document, which is how a single mismatch used to move every later
    // caret.
    const offsets = boundaries.map((boundary) =>
      sourceOffsetForFieldOffset(source, boundaries, boundary.fieldOffset),
    );
    const descending = offsets.flatMap((offset, index) =>
      index > 0 && offset <= offsets[index - 1]!
        ? [`${index}:${offset} after ${index - 1}:${offsets[index - 1]}`]
        : [],
    );
    expect(descending, 'caret offsets that do not increase').toEqual([]);

    // The property the reader actually feels: no legal position may be
    // impossible to put a caret on.
    const reachable = new Set<number>();
    for (let offset = 0; offset <= source.length; offset += 1) {
      reachable.add(fieldOffsetForSourceOffset(source, boundaries, offset));
    }
    const unreachable = boundaries
      .map((boundary) => boundary.fieldOffset)
      .filter((fieldOffset) => !reachable.has(fieldOffset));
    expect(unreachable, 'rendered positions no source offset reaches').toEqual(
      [],
    );

    // Moving to source view and back must not move the caret.
    const drifted = boundaries.flatMap((boundary) => {
      const sourceOffset = sourceOffsetForFieldOffset(
        source,
        boundaries,
        boundary.fieldOffset,
      );
      const returned = fieldOffsetForSourceOffset(
        source,
        boundaries,
        sourceOffset,
      );
      return returned === boundary.fieldOffset
        ? []
        : [`${boundary.fieldOffset} via ${sourceOffset} to ${returned}`];
    });
    expect(drifted, 'positions that move on a round trip').toEqual([]);

    // A caret must land where the writing says, not merely somewhere legal.
    // Reachability alone would not notice a document mapped uniformly into the
    // wrong row, which is what the reported defect did.
    const drift = Math.max(
      ...boundaries.map((boundary) => {
        const sourceOffset = sourceOffsetForFieldOffset(
          source,
          boundaries,
          boundary.fieldOffset,
        );
        return Math.abs(
          proseLetters(boundary.left) -
            proseLettersBefore(source, sourceOffset),
        );
      }),
    );
    expect(
      drift,
      `worst caret drift in prose letters (allowed ${allowedDrift})`,
    ).toBeLessThanOrEqual(allowedDrift);
  });
}
