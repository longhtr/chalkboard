/**
 * Searchable LaTeX reference data grouped by mathematical purpose. Entries keep
 * source examples separate from the dialog so content changes cannot affect UI logic.
 */
interface LatexReferenceEntry {
  description: string;
  latex: string;
}

interface LatexReferenceSection {
  entries: LatexReferenceEntry[];
  title: string;
}

/** Searchable MathLive syntax examples shown by the in-application reference. */
export const LATEX_REFERENCE_SECTIONS: LatexReferenceSection[] = [
  {
    title: 'Basics & structure',
    entries: [
      { description: 'Superscript', latex: String.raw`x^{2}` },
      { description: 'Subscript', latex: String.raw`a_{n}` },
      { description: 'Fraction', latex: String.raw`\frac{a}{b}` },
      { description: 'Square root', latex: String.raw`\sqrt{x}` },
      { description: 'Nth root', latex: String.raw`\sqrt[n]{x}` },
      { description: 'Absolute value', latex: String.raw`\left|x\right|` },
      {
        description: 'Floor and ceiling',
        latex: String.raw`\lfloor x\rfloor\ \lceil x\rceil`,
      },
      {
        description: 'Scaling delimiters',
        latex: String.raw`\left(\frac{x}{y}\right)`,
      },
      { description: 'Combined scripts', latex: String.raw`x_{i}^{(n)}` },
      {
        description: 'Nested fraction',
        latex: String.raw`\frac{1}{1+\frac{1}{x}}`,
      },
      { description: 'Percentage', latex: String.raw`75\%` },
      {
        description: 'Grouped exponent',
        latex: String.raw`e^{-(x-\mu)^2}`,
      },
    ],
  },
  {
    title: 'Greek & constants',
    entries: [
      {
        description: 'Lowercase Greek I',
        latex: String.raw`\alpha\ \beta\ \gamma\ \delta`,
      },
      {
        description: 'Lowercase Greek II',
        latex: String.raw`\theta\ \lambda\ \mu\ \pi`,
      },
      {
        description: 'Greek variants',
        latex: String.raw`\varepsilon\ \varphi\ \vartheta`,
      },
      {
        description: 'Capital Greek I',
        latex: String.raw`\Gamma\ \Delta\ \Theta\ \Lambda`,
      },
      {
        description: 'Capital Greek II',
        latex: String.raw`\Pi\ \Sigma\ \Phi\ \Omega`,
      },
      { description: 'Infinity', latex: String.raw`\infty` },
      {
        description: 'Partial and nabla',
        latex: String.raw`\partial\ \nabla`,
      },
      {
        description: 'Angle and degrees',
        latex: String.raw`\angle 90^{\circ}`,
      },
      {
        description: 'Lowercase Greek III',
        latex: String.raw`\eta\ \kappa\ \rho\ \tau`,
      },
      {
        description: 'Lowercase Greek IV',
        latex: String.raw`\chi\ \psi\ \omega\ \xi`,
      },
      {
        description: 'More variants',
        latex: String.raw`\varpi\ \varrho\ \varsigma`,
      },
      {
        description: 'Common constants',
        latex: String.raw`\pi\quad e\quad i\quad \infty`,
      },
    ],
  },
  {
    title: 'Operators & relations',
    entries: [
      {
        description: 'Arithmetic',
        latex: String.raw`+\ -\ \pm\ \mp`,
      },
      {
        description: 'Multiplication',
        latex: String.raw`\times\ \div\ \cdot\ \ast`,
      },
      {
        description: 'Comparison',
        latex: String.raw`\leq\ \geq\ \neq\ \approx`,
      },
      {
        description: 'Equivalence',
        latex: String.raw`\equiv\ \sim\ \simeq\ \cong`,
      },
      {
        description: 'Proportional to',
        latex: String.raw`a\propto b`,
      },
      {
        description: 'Arrows',
        latex: String.raw`\leftarrow\ \rightarrow\ \leftrightarrow`,
      },
      {
        description: 'Mapping arrows',
        latex: String.raw`x\mapsto f(x)\quad x\to y`,
      },
      {
        description: 'Ellipses',
        latex: String.raw`\ldots\ \cdots\ \vdots\ \ddots`,
      },
      {
        description: 'Big operators',
        latex: String.raw`\bigoplus\ \bigotimes\ \bigcup\ \bigcap`,
      },
      {
        description: 'Binary operators',
        latex: String.raw`\oplus\ \otimes\ \circ\ \bullet`,
      },
      {
        description: 'Strict relations',
        latex: String.raw`\ll\ \gg\ \prec\ \succ`,
      },
      {
        description: 'Long arrows',
        latex: String.raw`\longleftarrow\ \longrightarrow\ \Longleftrightarrow`,
      },
    ],
  },
  {
    title: 'Sets & logic',
    entries: [
      {
        description: 'Membership',
        latex: String.raw`\in\ \notin\ \ni`,
      },
      {
        description: 'Containment',
        latex: String.raw`\subset\ \subseteq\ \supset\ \supseteq`,
      },
      {
        description: 'Set operations',
        latex: String.raw`\cup\ \cap\ \setminus\ \triangle`,
      },
      {
        description: 'Empty set',
        latex: String.raw`\emptyset\ \varnothing`,
      },
      {
        description: 'Quantifiers',
        latex: String.raw`\forall x\quad \exists y`,
      },
      {
        description: 'Logical operators',
        latex: String.raw`\neg p\quad p\land q\quad p\lor q`,
      },
      {
        description: 'Implication',
        latex: String.raw`p\implies q\quad p\iff q`,
      },
      {
        description: 'Number sets',
        latex: String.raw`\mathbb{N}\ \mathbb{Z}\ \mathbb{Q}\ \mathbb{R}\ \mathbb{C}`,
      },
      {
        description: 'Set complement',
        latex: String.raw`A^{c}\quad \overline{A}`,
      },
      {
        description: 'Power set',
        latex: String.raw`\mathcal{P}(A)`,
      },
      {
        description: 'Cartesian product',
        latex: String.raw`A\times B`,
      },
      {
        description: 'Cardinality',
        latex: String.raw`\left|A\right|=n`,
      },
    ],
  },
  {
    title: 'Calculus & functions',
    entries: [
      { description: 'Sum', latex: String.raw`\sum_{i=1}^{n} i` },
      { description: 'Product', latex: String.raw`\prod_{i=1}^{n} i` },
      { description: 'Integral', latex: String.raw`\int_{a}^{b} f(x)\,dx` },
      {
        description: 'Multiple integrals',
        latex: String.raw`\iint_D f\,dA\quad \iiint_V f\,dV`,
      },
      { description: 'Limit', latex: String.raw`\lim_{x\to 0} f(x)` },
      { description: 'Derivative', latex: String.raw`\frac{d}{dx}f(x)` },
      {
        description: 'Partial derivative',
        latex: String.raw`\frac{\partial f}{\partial x}`,
      },
      {
        description: 'Common functions',
        latex: String.raw`\sin x\ \cos x\ \log_b x\ \ln x`,
      },
      {
        description: 'Contour integral',
        latex: String.raw`\oint_C f(z)\,dz`,
      },
      {
        description: 'One-sided limit',
        latex: String.raw`\lim_{x\to a^{+}}f(x)`,
      },
      {
        description: 'Infinite series',
        latex: String.raw`\sum_{n=0}^{\infty}a_n x^n`,
      },
      {
        description: 'Evaluation bounds',
        latex: String.raw`\left.F(x)\right|_{a}^{b}`,
      },
    ],
  },
  {
    title: 'Accents & annotations',
    entries: [
      { description: 'Vector', latex: String.raw`\vec{v}` },
      {
        description: 'Hat and wide hat',
        latex: String.raw`\hat{x}\ \widehat{ABC}`,
      },
      {
        description: 'Dot and double dot',
        latex: String.raw`\dot{x}\ \ddot{x}`,
      },
      {
        description: 'Bar and overline',
        latex: String.raw`\bar{x}\ \overline{AB}`,
      },
      { description: 'Tilde', latex: String.raw`\tilde{x}\ \widetilde{ABC}` },
      {
        description: 'Over and under braces',
        latex: String.raw`\overbrace{a+b}^{n}\ \underbrace{x+y}_{m}`,
      },
      {
        description: 'Cancellation',
        latex: String.raw`\cancel{x+y}`,
      },
      { description: 'Boxed result', latex: String.raw`\boxed{x=42}` },
      {
        description: 'Arrow accents',
        latex: String.raw`\overrightarrow{AB}\ \overleftarrow{CD}`,
      },
      {
        description: 'Checks and breves',
        latex: String.raw`\check{x}\ \breve{x}\ \acute{x}`,
      },
      {
        description: 'Overset and underset',
        latex: String.raw`\overset{!}{=}\ \underset{n\to\infty}{\lim}`,
      },
      {
        description: 'Strike through',
        latex: String.raw`\cancel{x+y}`,
      },
    ],
  },
  {
    title: 'Fonts & spacing',
    entries: [
      {
        description: 'Bold',
        latex: String.raw`\mathbf{x}\ \boldsymbol{\alpha}`,
      },
      {
        description: 'Italic and upright',
        latex: String.raw`\mathit{ABC}\ \mathrm{ABC}`,
      },
      { description: 'Blackboard bold', latex: String.raw`\mathbb{R}` },
      { description: 'Calligraphic', latex: String.raw`\mathcal{F}` },
      { description: 'Fraktur', latex: String.raw`\mathfrak{g}` },
      {
        description: 'Sans and typewriter',
        latex: String.raw`\mathsf{ABC}\ \mathtt{ABC}`,
      },
      {
        description: 'Text in math',
        latex: String.raw`x>0\quad\text{for all }x`,
      },
      {
        description: 'Spacing',
        latex: String.raw`a\!b\,c\:d\;e\quad f\qquad g`,
      },
      {
        description: 'Bold italic',
        latex: String.raw`\mathbfit{x}\ \boldsymbol{\theta}`,
      },
      {
        description: 'Script font',
        latex: String.raw`\mathscr{L}`,
      },
      {
        description: 'Display style',
        latex: String.raw`\displaystyle\sum_{i=1}^{n}\frac{1}{i}`,
      },
      {
        description: 'Script styles',
        latex: String.raw`\textstyle x\quad\scriptstyle x\quad\scriptscriptstyle x`,
      },
    ],
  },
  {
    title: 'Matrices & layouts',
    entries: [
      {
        description: 'Matrix',
        latex: String.raw`\begin{matrix}a&b\\c&d\end{matrix}`,
      },
      {
        description: 'Bracketed matrix',
        latex: String.raw`\begin{bmatrix}a&b\\c&d\end{bmatrix}`,
      },
      {
        description: 'Parenthesized matrix',
        latex: String.raw`\begin{pmatrix}a&b\\c&d\end{pmatrix}`,
      },
      {
        description: 'Determinant',
        latex: String.raw`\begin{vmatrix}a&b\\c&d\end{vmatrix}`,
      },
      {
        description: 'Cases',
        latex: String.raw`\begin{cases}x&x>0\\-x&x\leq0\end{cases}`,
      },
      {
        description: 'Aligned equations',
        latex: String.raw`\begin{aligned}a&=b+c\\&=d+e\end{aligned}`,
      },
      { description: 'Binomial', latex: String.raw`\binom{n}{k}` },
      {
        description: 'Array',
        latex: String.raw`\begin{array}{cc}a&b\\c&d\end{array}`,
      },
      {
        description: 'Small matrix',
        latex: String.raw`\left(\begin{smallmatrix}a&b\\c&d\end{smallmatrix}\right)`,
      },
      {
        description: 'Equation array',
        latex: String.raw`\begin{array}{rcl}x+y&=&2\\x-y&=&0\end{array}`,
      },
      {
        description: 'Continued fraction',
        latex: String.raw`1+\cfrac{1}{2+\cfrac{1}{3}}`,
      },
      {
        description: 'Stacked limits',
        latex: String.raw`\sum_{\scriptstyle 1\leq i\leq n,\ i\text{ odd}}i`,
      },
    ],
  },
  {
    title: 'Trigonometry & functions',
    entries: [
      {
        description: 'Trigonometric',
        latex: String.raw`\sin x\ \cos x\ \tan x`,
      },
      {
        description: 'Reciprocal trig',
        latex: String.raw`\sec x\ \csc x\ \cot x`,
      },
      {
        description: 'Inverse trig',
        latex: String.raw`\arcsin x\ \arccos x\ \arctan x`,
      },
      {
        description: 'Hyperbolic',
        latex: String.raw`\sinh x\ \cosh x\ \tanh x`,
      },
      { description: 'Logarithms', latex: String.raw`\log_b x\quad \ln x` },
      { description: 'Exponential', latex: String.raw`\exp(x)=e^x` },
      {
        description: 'Minimum and maximum',
        latex: String.raw`\min_{x}f(x)\quad\max_{x}f(x)`,
      },
      { description: 'Modulo', latex: String.raw`a\equiv b\pmod n` },
      {
        description: 'Named operator',
        latex: String.raw`\operatorname{rank}(A)`,
      },
      { description: 'Function composition', latex: String.raw`(f\circ g)(x)` },
    ],
  },
  {
    title: 'Geometry & vectors',
    entries: [
      { description: 'Line segment', latex: String.raw`\overline{AB}` },
      { description: 'Ray', latex: String.raw`\overrightarrow{AB}` },
      { description: 'Line', latex: String.raw`\overleftrightarrow{AB}` },
      { description: 'Triangle', latex: String.raw`\triangle ABC` },
      {
        description: 'Parallel and perpendicular',
        latex: String.raw`AB\parallel CD\quad AB\perp CD`,
      },
      {
        description: 'Congruent and similar',
        latex: String.raw`\triangle A\cong\triangle B\quad A\sim B`,
      },
      {
        description: 'Vector components',
        latex: String.raw`\vec v=\langle v_1,v_2,v_3\rangle`,
      },
      { description: 'Vector norm', latex: String.raw`\left\|\vec v\right\|` },
      { description: 'Dot product', latex: String.raw`\vec a\cdot\vec b` },
      { description: 'Cross product', latex: String.raw`\vec a\times\vec b` },
    ],
  },
  {
    title: 'Probability & statistics',
    entries: [
      { description: 'Probability', latex: String.raw`\Pr(A)` },
      { description: 'Conditional probability', latex: String.raw`P(A\mid B)` },
      { description: 'Expectation', latex: String.raw`\mathbb{E}[X]` },
      { description: 'Variance', latex: String.raw`\operatorname{Var}(X)` },
      { description: 'Covariance', latex: String.raw`\operatorname{Cov}(X,Y)` },
      { description: 'Mean and variance', latex: String.raw`\mu\quad\sigma^2` },
      {
        description: 'Sample statistics',
        latex: String.raw`\bar{x}\quad s^2\quad\hat{p}`,
      },
      {
        description: 'Normal distribution',
        latex: String.raw`X\sim\mathcal{N}(\mu,\sigma^2)`,
      },
      { description: 'Factorial', latex: String.raw`n!=n(n-1)\cdots1` },
      {
        description: 'Combinations',
        latex: String.raw`\binom{n}{r}=\frac{n!}{r!(n-r)!}`,
      },
    ],
  },
  {
    title: 'Delimiters & sizing',
    entries: [
      { description: 'Parentheses', latex: String.raw`\left(x\right)` },
      { description: 'Brackets', latex: String.raw`\left[x\right]` },
      { description: 'Braces', latex: String.raw`\left\{x\right\}` },
      {
        description: 'Angle brackets',
        latex: String.raw`\left\langle x\right\rangle`,
      },
      { description: 'Absolute value', latex: String.raw`\left|x\right|` },
      { description: 'Norm', latex: String.raw`\left\|x\right\|` },
      {
        description: 'Manual delimiter sizes',
        latex: String.raw`\bigl(x\bigr)\ \Bigl[x\Bigr]`,
      },
      {
        description: 'Middle delimiter',
        latex: String.raw`\left\{x\middle|x>0\right\}`,
      },
      {
        description: 'Invisible delimiter',
        latex: String.raw`\left.\frac{dy}{dx}\right|_{x=0}`,
      },
      { description: 'Grouped braces', latex: String.raw`\{a,b,c\}` },
    ],
  },
];
