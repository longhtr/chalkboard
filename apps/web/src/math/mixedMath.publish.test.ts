/**
 * Publishing a block must never lose a row.
 *
 * `liftMathLineBreaks` moves rows out of a maths segment and leaves them
 * trailing it, so the value reaching the maths-only branch is already
 * delimited. Wrapping it again produced `$$…$$`, and the trim that followed
 * deleted exactly the rows that had just been lifted - so a block whose rows
 * were separated by blank lines collapsed, and stayed collapsed because the
 * loss was published to storage.
 */
import { describe, expect, it } from 'vitest';

import {
  mixedSourceFromMathLiveEditor,
  toMathLiveEditorSource,
} from './mixedMath';

interface PublishOptions {
  emptyMathRegion: boolean;
  hasExplicitMath: boolean;
  mode: 'latex' | 'math' | 'text';
  retainsMathOnlySource: boolean;
}

function publish(source: string, options: PublishOptions): string {
  return mixedSourceFromMathLiveEditor(toMathLiveEditorSource(source), {
    baseColor: '#1f2937',
    ...options,
  });
}

const SOURCES = [
  'one\n\n\n\ntwo',
  '\\textcolor{#e03131}{one}\n\n\n\n\\textcolor{#1971c2}{two}',
  '$\\textcolor{#e03131}{one}$\n\n\n\n$\\textcolor{#1971c2}{two}$',
  '$a$\n\n\n\n$b$',
  '$a\n\n\n\nb$',
];

const OPTION_SETS: PublishOptions[] = [];
for (const mode of ['text', 'math'] as const) {
  for (const hasExplicitMath of [false, true]) {
    for (const retainsMathOnlySource of [false, true]) {
      for (const emptyMathRegion of [false, true]) {
        OPTION_SETS.push({
          emptyMathRegion,
          hasExplicitMath,
          mode,
          retainsMathOnlySource,
        });
      }
    }
  }
}

const rows = (value: string) => (value.match(/\n/gu) ?? []).length;

describe('publishing a mixed block', () => {
  it('keeps every row through repeated publication', () => {
    const lost: string[] = [];
    for (const source of SOURCES) {
      for (const options of OPTION_SETS) {
        let current = source;
        for (let pass = 0; pass < 4; pass += 1) {
          current = publish(current, options);
          if (rows(current) < rows(source)) {
            lost.push(
              `${JSON.stringify(source)} ${JSON.stringify(options)} pass ${
                pass + 1
              } -> ${JSON.stringify(current)}`,
            );
            break;
          }
        }
      }
    }
    expect(lost).toEqual([]);
  });

  it('does not wrap an already delimited value a second time', () => {
    const published = publish('$a$\n\n$b$', {
      emptyMathRegion: false,
      hasExplicitMath: true,
      mode: 'math',
      retainsMathOnlySource: true,
    });

    expect(published).not.toContain('$$');
    expect(rows(published)).toBe(2);
  });
});
