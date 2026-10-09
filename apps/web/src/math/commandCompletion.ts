/**
 * LaTeX command catalog and pure completion state transitions. Immediate,
 * deferred, and buffered commands remain data-driven and insert explicit
 * placeholders for required arguments.
 */
import { mathDelimiterBody } from './mixedMath';

const PLACEHOLDER = String.raw`\placeholder{}`;
const DEFERRED_VALUE = '#';

const mathWrapperCommands = new Set([
  String.raw`\^`,
  String.raw`\``,
  String.raw`\'`,
  String.raw`\"`,
  String.raw`\.`,
  String.raw`\=`,
  String.raw`\~`,
  String.raw`\Bbb`,
  String.raw`\bm`,
  String.raw`\bold`,
  String.raw`\boldsymbol`,
  String.raw`\frak`,
  String.raw`\mathbb`,
  String.raw`\mathbfit`,
  String.raw`\mathcal`,
  String.raw`\mathbf`,
  String.raw`\mathfrak`,
  String.raw`\mathit`,
  String.raw`\mathnormal`,
  String.raw`\mathrm`,
  String.raw`\mathscr`,
  String.raw`\mathsf`,
  String.raw`\mathtt`,
]);

const canonicalStyleCommands = new Map([
  [String.raw`\bf`, String.raw`\mathbf`],
  [String.raw`\bfseries`, String.raw`\mathbf`],
  [String.raw`\it`, String.raw`\mathit`],
  [String.raw`\mdseries`, String.raw`\mathrm`],
  [String.raw`\rmfamily`, String.raw`\mathrm`],
  [String.raw`\scshape`, String.raw`\mathrm`],
  [String.raw`\sffamily`, String.raw`\mathsf`],
  [String.raw`\slshape`, String.raw`\mathit`],
  [String.raw`\ttfamily`, String.raw`\mathtt`],
  [String.raw`\upshape`, String.raw`\mathrm`],
  [String.raw`\text`, String.raw`\mathrm`],
  [String.raw`\textbf`, String.raw`\mathbf`],
  [String.raw`\textit`, String.raw`\mathit`],
  [String.raw`\textmd`, String.raw`\mathrm`],
  [String.raw`\textnormal`, String.raw`\mathrm`],
  [String.raw`\textrm`, String.raw`\mathrm`],
  [String.raw`\textsc`, String.raw`\mathrm`],
  [String.raw`\textsf`, String.raw`\mathsf`],
  [String.raw`\textsl`, String.raw`\mathit`],
  [String.raw`\texttt`, String.raw`\mathtt`],
  [String.raw`\textup`, String.raw`\mathrm`],
]);

const sizeCommands = [
  String.raw`\tiny`,
  String.raw`\scriptsize`,
  String.raw`\footnotesize`,
  String.raw`\small`,
  String.raw`\normalsize`,
  String.raw`\large`,
  String.raw`\Large`,
  String.raw`\LARGE`,
  String.raw`\huge`,
  String.raw`\Huge`,
] as const;

const delimiterCommands = new Set([
  String.raw`\middle`,
  String.raw`\big`,
  String.raw`\Big`,
  String.raw`\bigg`,
  String.raw`\Bigg`,
  String.raw`\bigl`,
  String.raw`\Bigl`,
  String.raw`\biggl`,
  String.raw`\Biggl`,
  String.raw`\bigr`,
  String.raw`\Bigr`,
  String.raw`\biggr`,
  String.raw`\Biggr`,
  String.raw`\bigm`,
  String.raw`\Bigm`,
  String.raw`\biggm`,
  String.raw`\Biggm`,
]);

type BufferedArgumentMode = 'math' | 'raw' | 'text';

/** Multi-argument command template whose placeholders are filled in order. */
export interface BufferedCommandCompletion {
  argumentModes: BufferedArgumentMode[];
  template: string;
}

const bufferedCommandCompletions = new Map<string, BufferedCommandCompletion>([
  [String.raw`\c`, { argumentModes: ['raw'], template: String.raw`\c{#1}` }],
  [
    String.raw`\the`,
    { argumentModes: ['raw'], template: String.raw`\the{#1}` },
  ],
  [String.raw`\ce`, { argumentModes: ['raw'], template: String.raw`\ce{#1}` }],
  [String.raw`\pu`, { argumentModes: ['raw'], template: String.raw`\pu{#1}` }],
  [
    String.raw`\color`,
    {
      argumentModes: ['raw', 'math'],
      template: String.raw`\textcolor{#1}{#2}`,
    },
  ],
  [
    String.raw`\textcolor`,
    {
      argumentModes: ['raw', 'math'],
      template: String.raw`\textcolor{#1}{#2}`,
    },
  ],
  [
    String.raw`\colorbox`,
    {
      argumentModes: ['raw', 'math'],
      template: String.raw`\bbox[#1]{#2}`,
    },
  ],
  [
    String.raw`\fcolorbox`,
    {
      argumentModes: ['raw', 'raw', 'math'],
      template: String.raw`\fcolorbox{#1}{#2}{#3}`,
    },
  ],
  [
    String.raw`\class`,
    { argumentModes: ['raw', 'math'], template: String.raw`\class{#1}{#2}` },
  ],
  [
    String.raw`\htmlClass`,
    {
      argumentModes: ['raw', 'math'],
      template: String.raw`\htmlClass{#1}{#2}`,
    },
  ],
  [
    String.raw`\cssId`,
    { argumentModes: ['raw', 'math'], template: String.raw`\cssId{#1}{#2}` },
  ],
  [
    String.raw`\htmlId`,
    { argumentModes: ['raw', 'math'], template: String.raw`\htmlId{#1}{#2}` },
  ],
  [
    String.raw`\htmlData`,
    {
      argumentModes: ['raw', 'math'],
      template: String.raw`\htmlData{#1}{#2}`,
    },
  ],
  [
    String.raw`\style`,
    { argumentModes: ['raw', 'math'], template: String.raw`\style{#1}{#2}` },
  ],
  [
    String.raw`\htmlStyle`,
    {
      argumentModes: ['raw', 'math'],
      template: String.raw`\htmlStyle{#1}{#2}`,
    },
  ],
  [
    String.raw`\href`,
    { argumentModes: ['raw', 'math'], template: String.raw`\href{#1}{#2}` },
  ],
  [
    String.raw`\enclose`,
    {
      argumentModes: ['raw', 'math'],
      template: String.raw`\enclose{#1}{#2}`,
    },
  ],
  ...[
    String.raw`\hspace`,
    String.raw`\hspace*`,
    String.raw`\mkern`,
    String.raw`\kern`,
    String.raw`\mskip`,
    String.raw`\hskip`,
    String.raw`\mspace`,
    String.raw`\char`,
    String.raw`\unicode`,
  ].map((command): [string, BufferedCommandCompletion] => [
    command,
    { argumentModes: ['raw'], template: `${command}{#1}` },
  ]),
  [
    String.raw`\rule`,
    {
      argumentModes: ['raw', 'raw'],
      template: String.raw`\rule{#1}{#2}`,
    },
  ],
  [
    String.raw`\raisebox`,
    {
      argumentModes: ['raw', 'math'],
      template: String.raw`\raise{#1}{#2}`,
    },
  ],
  [
    String.raw`\raise`,
    {
      argumentModes: ['raw', 'math'],
      template: String.raw`\raise{#1}{#2}`,
    },
  ],
  [
    String.raw`\lower`,
    {
      argumentModes: ['raw', 'math'],
      template: String.raw`\lower{#1}{#2}`,
    },
  ],
  [
    String.raw`\mathchoice`,
    {
      argumentModes: ['math', 'math', 'math', 'math'],
      template: String.raw`\mathchoice{#1}{#2}{#3}{#4}`,
    },
  ],
  [
    String.raw`\displaylines`,
    { argumentModes: ['math'], template: String.raw`\displaylines{#1}` },
  ],
  ...sizeCommands.map((command): [string, BufferedCommandCompletion] => {
    const fontSize = {
      '\\tiny': '0.5em',
      '\\scriptsize': '0.7em',
      '\\footnotesize': '0.8em',
      '\\small': '0.9em',
      '\\normalsize': '1em',
      '\\large': '1.2em',
      '\\Large': '1.44em',
      '\\LARGE': '1.728em',
      '\\huge': '2.074em',
      '\\Huge': '2.488em',
    }[command];
    return [
      command,
      {
        argumentModes: ['math'],
        template: `\\style{font-size:${fontSize}}{#1}`,
      },
    ];
  }),
]);

/** Resolves a command name to a supported multi-argument completion. */
export function bufferedCommandCompletion(
  command: string,
): BufferedCommandCompletion | null {
  return bufferedCommandCompletions.get(command) ?? null;
}

/** Substitutes completed raw/math arguments into a buffered command template. */
export function fillBufferedCommandCompletion(
  template: string,
  arguments_: string[],
): string {
  return arguments_.reduce(
    (result, argument, index) => result.replaceAll(`#${index + 1}`, argument),
    template,
  );
}

interface DeferredCommandCompletion {
  template: string;
}

/** Resolves a command that can insert its complete structure immediately. */
export function immediateCommandCompletion(command: string): string | null {
  if (command === String.raw`\pdiff`) {
    return String.raw`\frac{\partial \placeholder{}}{\partial \placeholder{}}`;
  }
  if (command === String.raw`\overunderset`) {
    return String.raw`\overset{\placeholder{}}{\underset{\placeholder{}}{\placeholder{}}}`;
  }
  return null;
}

/** Resolves a command template that consumes the next typed character. */
export function deferredCommandCompletion(
  command: string,
): DeferredCommandCompletion | null {
  if (mathWrapperCommands.has(command)) {
    return { template: `${command}{${DEFERRED_VALUE}}` };
  }
  const canonicalCommand = canonicalStyleCommands.get(command);
  if (canonicalCommand !== undefined) {
    return { template: `${canonicalCommand}{${DEFERRED_VALUE}}` };
  }
  if (delimiterCommands.has(command)) {
    return { template: `${command}${DEFERRED_VALUE}` };
  }
  return null;
}

/** Substitutes the next escaped character into a deferred template. */
export function fillDeferredCommandCompletion(
  template: string,
  latex: string,
): string {
  return template.replace(DEFERRED_VALUE, latex);
}

/**
 * MathLive selects some completed commands as one empty atom instead of
 * creating an argument placeholder. The next key then replaces the command.
 * Add placeholders to every empty argument without maintaining a command
 * whitelist, so this also covers commands added by future MathLive releases.
 */
export function addCommandCompletionPlaceholders(
  selection: string,
): string | null {
  const trimmedSelection = selection.trim();
  const latex = mathDelimiterBody(trimmedSelection)?.trim() ?? trimmedSelection;
  if (latex.includes(PLACEHOLDER)) return null;

  if (
    latex === String.raw`\mathtip{}{}` ||
    latex === String.raw`\texttip{}{}`
  ) {
    return latex.replace('{}', `{${PLACEHOLDER}}`);
  }

  if (latex.startsWith(String.raw`\enclose{}`)) {
    return latex
      .replace(String.raw`\enclose{}`, String.raw`\enclose{box}`)
      .replaceAll('{}', `{${PLACEHOLDER}}`);
  }

  if (/^\\[A-Za-z]+\*?/.test(latex) && latex.includes('{}')) {
    return latex.replaceAll('{}', `{${PLACEHOLDER}}`);
  }

  const declaration = /^(\{\s*\\[A-Za-z]+\*?\s*)\}$/.exec(latex);
  if (declaration?.[1] !== undefined) {
    return `${declaration[1]}${PLACEHOLDER}}`;
  }

  return null;
}
