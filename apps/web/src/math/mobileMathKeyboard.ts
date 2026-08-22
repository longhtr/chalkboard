/** Compact, task-oriented MathLive keyboard layouts for phone-sized workspaces. */
import type {
  VirtualKeyboardKeycap,
  VirtualKeyboardLayout,
  VirtualKeyboardName,
} from 'mathlive';

type Keycap = string | Partial<VirtualKeyboardKeycap>;
type KeyboardLayout = VirtualKeyboardName | VirtualKeyboardLayout;

let defaultKeyboardLayouts: readonly KeyboardLayout[] | null = null;

const lineBreakKey = (): Partial<VirtualKeyboardKeycap> => ({
  class: 'action hide-shift chalkboard-line-break-key',
  label: '[return]',
  width: 1.5,
});

const latexCommandKey = (): Partial<VirtualKeyboardKeycap> => ({
  class: 'modifier hide-shift',
  key: '\\',
  label: '\\',
  tooltip: 'LaTeX command',
});

const editingRow = (): Keycap[] => [
  '[undo]',
  '[redo]',
  '[separator-5]',
  '[separator]',
  '[left]',
  '[right]',
  { label: '[backspace]', class: 'action hide-shift' },
  lineBreakKey(),
  '[hide-keyboard]',
];

const letter = (value: string): Partial<VirtualKeyboardKeycap> => ({
  class: 'hide-shift',
  key: value,
  label: value,
  shift: { key: value.toUpperCase(), label: value.toUpperCase() },
  variants: value,
});

const mathKey = (
  latex: string,
  tooltip: string,
  options: Partial<VirtualKeyboardKeycap> = {},
): Partial<VirtualKeyboardKeycap> => ({ latex, tooltip, ...options });

const greekKey = (
  name: string,
  variants: Partial<VirtualKeyboardKeycap>['variants'] = [],
): Partial<VirtualKeyboardKeycap> => ({
  class: 'chalkboard-greek-key',
  latex: `\\${name}`,
  tooltip: name,
  variants,
});

const layout = (
  id: string,
  label: string,
  tooltip: string,
  rows: Keycap[][],
): VirtualKeyboardLayout => ({
  displayEditToolbar: false,
  displayShiftedKeycaps: false,
  id,
  label,
  layers: [
    {
      id: `${id}-layer`,
      rows,
    },
  ],
  tooltip,
});

export const MOBILE_MATH_KEYBOARD_LAYOUTS: readonly VirtualKeyboardLayout[] = [
  layout('chalkboard-numbers', '123', 'Numbers and operations', [
    [
      '[+]',
      '[-]',
      '[*]',
      '[/]',
      '[=]',
      '[.]',
      '[(]',
      '[)]',
      mathKey('\\sqrt{#0}', 'Square root'),
      mathKey('#@^{#?}', 'Power'),
    ],
    ['[1]', '[2]', '[3]', '[4]', '[5]', '[6]', '[7]', '[8]', '[9]', '[0]'],
    [
      { key: 'x', label: 'x' },
      { key: 'y', label: 'y' },
      mathKey('\\pi', 'Pi'),
      mathKey('\\exponentialE', 'Euler’s number'),
      mathKey('\\%', 'Percent'),
      '[,]',
      { key: '[', label: '[' },
      { key: ']', label: ']' },
      mathKey('#@_{#?}', 'Subscript'),
      mathKey('\\left|x\\right|', 'Absolute value', {
        insert: '\\left|#0\\right|',
      }),
    ],
    editingRow(),
  ]),
  layout('chalkboard-letters', 'abc', 'Letters and writing', [
    [...'qwertyuiop'].map(letter),
    ['[separator-5]', ...[...'asdfghjkl'].map(letter), '[separator-5]'],
    ['[shift]', ...[...'zxcvbnm'].map(letter), '[backspace]'],
    [
      { key: ',', label: ',' },
      { key: ' ', label: 'space', width: 2 },
      { key: '.', label: '.' },
      latexCommandKey(),
      '[left]',
      '[right]',
      lineBreakKey(),
      '[hide-keyboard]',
    ],
  ]),
  layout('chalkboard-functions', 'f(x)', 'Functions and symbols', [
    [
      mathKey('\\sin', 'Sine', {
        insert: '\\sin\\left(#0\\right)',
        variants: ['\\sin^{-1}', '\\sinh'],
      }),
      mathKey('\\cos', 'Cosine', {
        insert: '\\cos\\left(#0\\right)',
        variants: ['\\cos^{-1}', '\\cosh'],
      }),
      mathKey('\\tan', 'Tangent', {
        insert: '\\tan\\left(#0\\right)',
        variants: ['\\tan^{-1}', '\\tanh'],
      }),
      mathKey('\\ln', 'Natural logarithm', {
        insert: '\\ln\\left(#0\\right)',
      }),
      mathKey('\\log', 'Logarithm', {
        insert: '\\log\\left(#0\\right)',
        variants: ['\\log_{10}', '\\log_{#0}'],
      }),
      mathKey('\\exp', 'Exponential', {
        insert: '\\exp\\left(#0\\right)',
      }),
      mathKey('\\sqrt{x}', 'Square root', { insert: '\\sqrt{#0}' }),
      mathKey('\\left|x\\right|', 'Absolute value', {
        insert: '\\left|#0\\right|',
      }),
      mathKey('x^n', 'Power', { insert: '#@^{#?}' }),
      mathKey('\\frac{a}{b}', 'Fraction', { insert: '\\frac{#@}{#?}' }),
    ],
    [
      mathKey('\\pi', 'Pi'),
      mathKey('\\exponentialE', 'Euler’s number'),
      mathKey('\\imaginaryI', 'Imaginary unit'),
      mathKey('\\infty', 'Infinity'),
      mathKey('\\frac{\\mathrm d}{\\mathrm d x}', 'Derivative', {
        class: 'small',
        insert: '\\frac{\\mathrm d}{\\mathrm d x}#0',
      }),
      mathKey('\\int', 'Integral', {
        insert: '\\int #0\\,\\mathrm{d}x',
        variants: ['\\int_{#?}^{#?}', '\\iint', '\\oint'],
      }),
      mathKey('\\sum', 'Sum', { insert: '\\sum_{#?}^{#?}' }),
      mathKey('\\prod', 'Product', { insert: '\\prod_{#?}^{#?}' }),
      mathKey('\\lim', 'Limit', { insert: '\\lim_{#?}' }),
      mathKey('\\partial', 'Partial derivative'),
    ],
    [
      mathKey('<', 'Less than'),
      mathKey('>', 'Greater than'),
      mathKey('\\le', 'Less than or equal'),
      mathKey('\\ge', 'Greater than or equal'),
      mathKey('\\ne', 'Not equal'),
      mathKey('\\approx', 'Approximately equal'),
      mathKey('\\in', 'Element of'),
      mathKey('\\notin', 'Not an element of'),
      mathKey('\\to', 'Approaches'),
      mathKey('\\pm', 'Plus or minus'),
    ],
    editingRow(),
  ]),
  layout('chalkboard-greek', 'αβ', 'Greek letters', [
    [
      greekKey('alpha'),
      greekKey('beta'),
      greekKey('gamma', ['\\Gamma']),
      greekKey('delta', ['\\Delta']),
      greekKey('epsilon', ['\\varepsilon']),
      greekKey('zeta'),
      greekKey('eta'),
      greekKey('theta', ['\\vartheta', '\\Theta']),
    ],
    [
      greekKey('iota'),
      greekKey('kappa', ['\\varkappa']),
      greekKey('lambda', ['\\Lambda']),
      greekKey('mu'),
      greekKey('nu'),
      greekKey('xi', ['\\Xi']),
      greekKey('omicron'),
      greekKey('pi', ['\\varpi', '\\Pi']),
    ],
    [
      greekKey('rho', ['\\varrho']),
      greekKey('sigma', ['\\varsigma', '\\Sigma']),
      greekKey('tau'),
      greekKey('upsilon', ['\\Upsilon']),
      greekKey('phi', ['\\varphi', '\\Phi']),
      greekKey('chi'),
      greekKey('psi', ['\\Psi']),
      greekKey('omega', ['\\Omega']),
    ],
    editingRow(),
  ]),
];

const usesMobileLayouts = (layouts: readonly KeyboardLayout[]): boolean =>
  layouts.length === MOBILE_MATH_KEYBOARD_LAYOUTS.length &&
  layouts.every(
    (entry, index) =>
      typeof entry !== 'string' &&
      entry.id === MOBILE_MATH_KEYBOARD_LAYOUTS[index]?.id,
  );

/** Installs the Chalkboard keyboard only where the on-screen keyboard is used. */
export function configureMobileMathKeyboard(): void {
  const keyboard = window.mathVirtualKeyboard;
  defaultKeyboardLayouts ??= [...keyboard.layouts];
  const mobile =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(max-width: 600px), (pointer: coarse)').matches;
  if (!mobile) {
    if (usesMobileLayouts(keyboard.layouts)) {
      keyboard.editToolbar = 'default';
      keyboard.layouts = defaultKeyboardLayouts;
    }
    return;
  }
  if (usesMobileLayouts(keyboard.layouts)) return;
  keyboard.editToolbar = 'none';
  keyboard.layouts = MOBILE_MATH_KEYBOARD_LAYOUTS;
}
