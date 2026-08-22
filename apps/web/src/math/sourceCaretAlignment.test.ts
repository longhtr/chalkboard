/**
 * Canonical source and the editor value built from it must describe the same
 * writing, token for token.
 *
 * The caret mapping aligns those two spellings by token identity. It cannot
 * check that they agree while running, because writing it has not reached looks
 * exactly like writing it disagrees about, so a divergence is silent: rows
 * spelled `\n` in source and `⁣` in the field drifted apart and a third of
 * the caret positions in an ordinary derivation stopped being reachable, with
 * every test still passing.
 *
 * These cover the half of the boundary this repository owns -- the encoder in
 * `mixedMath` -- for every construct that has its own spelling. The other half,
 * how MathLive re-serializes what it was given, is covered against a real field
 * in `tests/equation-source-caret-reachability.spec.ts`, because only a browser
 * can answer it.
 */
import { describe, expect, it } from 'vitest';

import * as mixedMath from './mixedMath';
import {
  expandTextColors,
  expandTextStyles,
  isReservedSentinel,
  MATHLIVE_SENTINEL_SPELLINGS,
  toMathLiveEditorSource,
} from './mixedMath';
import { alignmentDivergence } from './sourceCaretMapping';

const documents: Record<string, string> = {
  'accents and wide operators': String.raw`$\overline{z}+\sqrt{x^2+y^2}=\operatorname{tr}A$`,
  'aligned environment': String.raw`Proof: $\begin{aligned}H(x)&=x^2\\H(y)&=\frac{a}{b}\end{aligned}$`,
  'bare percent and braces in prose': String.raw`10% of { a } and } alone.`,
  'display mathematics': String.raw`Consider $$\frac{a}{b}$$ closely.`,
  'empty script and placeholder-shaped input': String.raw`$u^{}+\frac{1}{u^{}}$`,
  'escaped dollar in prose': String.raw`Costs \$5 and \$6 for $n$ items.`,
  // A literal backslash stands bare in canonical source; `\textbackslash` is
  // an incoming MathLive artifact that `normalizeMathLiveTextSource` removes.
  'literal backslash in prose': 'A \\ and a bare mark before $x$.',
  'mathematics only': String.raw`$\frac{d}{dz}\frac{1}{1+e^{-z}}$`,
  'nested fractions with text in math': String.raw`$\frac{d}{\differentialD\text{z}}\frac{1}{1+e^{-z}}$`,
  'prose only': 'Just some ordinary writing.',
  'prose with inline mathematics': String.raw`Let $u=1+e^{-z}$ and note $\frac{a}{b}$.`,
  'reported derivation': [
    String.raw`Evaluate $\frac{d}{\differentialD\text{z}}\frac{1}{1+e^{-z}}$. Let $u=1+e^{-z}$. `,
    String.raw`Then,$\frac{d}{\differentialD\text{z}}\frac{1}{1+e^{-z}}=\frac{d}{d}\frac{du}{dz}\frac{1}{u}=\frac{d}{du}\frac{1}{u^{}}\frac{du}{dz}$`,
    String.raw`$=\left(-\frac{1}{u^2}\right)\frac{d}{dz}\left(1+e^{-z}\right)=\left(-\frac{1}{1+e^{-z}}\right)\left(-e^{-z}\right)=\frac{e^{-z}}{1+e^{-z}}$`,
  ].join('\n'),
  'rows around mathematics': 'First $x$\nSecond $y$\nThird $z$',
  'rows of prose alone': 'One\nTwo\nThree',
  'sub and superscripts with braces': String.raw`$a_{ij}^{2}+b_{k}^{n+1}$`,
  'trailing and leading blank rows': '\nmiddle $x$\n',
  'unclosed dollar in prose': 'A price of $ and nothing more.',
};

describe('canonical source and editor value describe the same writing', () => {
  for (const [name, source] of Object.entries(documents)) {
    it(name, () => {
      expect(
        alignmentDivergence(source, toMathLiveEditorSource(source)),
      ).toBeNull();
    });
  }

  // Styles and colours never reach the field as commands, so they only appear
  // once the expansions that replace them with sentinels have run.
  it('styled prose expanded to sentinels', () => {
    const source = String.raw`A \textbf{bold} and \textit{emphatic} claim about $x$.`;
    const editorValue = expandTextStyles(toMathLiveEditorSource(source));
    expect(alignmentDivergence(source, editorValue)).toBeNull();
  });

  // `mixedDocument` escapes braces only inside a styled span, so canonical
  // source spells the same brace two ways depending on its neighbours.
  it('braces inside a styled span', () => {
    const source = String.raw`A \textbf{bold \textbraceleft brace\textbraceright} here.`;
    const editorValue = expandTextStyles(toMathLiveEditorSource(source));
    expect(alignmentDivergence(source, editorValue)).toBeNull();
  });

  it('coloured prose expanded to sentinels', () => {
    const source = String.raw`A \textcolor{#e03131}{red} word before $x$.`;
    const editorValue = expandTextColors(
      toMathLiveEditorSource(source),
      '#1f2937',
    );
    expect(alignmentDivergence(source, editorValue)).toBeNull();
  });
});

/**
 * A sentinel the alignment path does not know about is read as writing the
 * source does not contain, which is precisely how rows drifted. Reserving one
 * is what makes it either spelled back or dropped, so the guard is that every
 * sentinel is reserved -- not that this file lists them, which is a list that
 * would fall behind exactly when it mattered.
 */
describe('the sentinel vocabulary stays within the alignment path', () => {
  const declared = Object.entries(mixedMath).filter(
    (entry): entry is [string, string] =>
      entry[0].startsWith('MATHLIVE_') && typeof entry[1] === 'string',
  );

  it('declares sentinels for the tests to find', () => {
    expect(declared.length).toBeGreaterThan(5);
  });

  for (const [name, sentinel] of declared) {
    it(`${name} is reserved`, () => {
      expect(isReservedSentinel(sentinel)).toBe(true);
    });
  }

  it('spells back only characters it also reserves', () => {
    for (const sentinel of MATHLIVE_SENTINEL_SPELLINGS.keys()) {
      expect(isReservedSentinel(sentinel)).toBe(true);
    }
  });

  it('reads a run of formatting sentinels as no writing at all', () => {
    // Formatting sentinels have no spelling, so respelling must leave nothing
    // for the tokenizer to find. Against an empty source that means no
    // divergence; a sentinel that survived would be a token the source cannot
    // have, and every position after it would shift.
    const formatting = declared
      .map(([, sentinel]) => sentinel)
      .filter((sentinel) => !MATHLIVE_SENTINEL_SPELLINGS.has(sentinel))
      .join('');
    expect(formatting.length).toBeGreaterThan(0);
    expect(alignmentDivergence('', formatting)).toBeNull();
  });

  it('reads a spelled sentinel as exactly the writing it stands for', () => {
    for (const [sentinel, spelling] of MATHLIVE_SENTINEL_SPELLINGS) {
      expect(alignmentDivergence(spelling, sentinel)).toBeNull();
    }
  });
});
