# Dependency patches

Applied by `pnpm install` through `pnpm.patchedDependencies` in the root
`package.json`. Both Dockerfiles copy this directory into the build context
before their `pnpm install --frozen-lockfile` step, because pnpm applies patches
during install rather than at build time.

## `mathlive@0.110.0.patch`

Two edits to array layout, both removing a special case rather than adding one.

### 1. Center `\begin{array}` on the math axis

MathLive 0.110.0 gives `array` alone a top-aligned baseline:

```js
const offset = this.environmentName === 'array' && !this.isMultiline
  ? body[0].height
  : totalHeight / 2 + AXIS_HEIGHT;
...
if (this.environmentName === 'array' && !this.isMultiline) {
  inner.height = body[0].height;
  inner.depth = totalHeight - body[0].height;
}
```

`\left...\right` sizes and centers its delimiters on the math axis from the
height and depth the inner box reports. A top-aligned array reports almost all
of its size as depth, so the two disagree: for
`\left[\begin{array}{c}\dfrac{a}{b}\\\dfrac{c}{d}\\\dfrac{f}{g}\end{array}\right]`
the bracket came out roughly two thirds taller than the array and floated about
three ems above it, leaving the last row hanging out of the bottom. The taller
the rows, the further the two drifted apart. LaTeX, KaTeX, MathJax and Temml all
center `array`, and MathLive's own `bmatrix` already does, so the two arms of
that condition disagreed with each other as well.

The patch deletes both special cases, which leaves `array` on the same
`totalHeight / 2 + AXIS_HEIGHT` path as everything else.

### 2. Give every environment the same inter-row clearance

Rows are stacked with no space between them, so consecutive baselines sit
`depth(row) + height(next row)` apart and the boxes touch exactly. Rows tall
enough to matter therefore collide: an array of `\dfrac` rows draws the next
numerator on top of the previous denominator, in both workspace fonts. MathLive
already has the register for this and applies it to the align family, but
excludes matrices, `cases` and `array`:

```js
if (
  r < nr - 1 &&
  !isMatrixEnvironment(this.environmentName) &&
  this.environmentName !== 'cases' &&
  this.environmentName !== 'array'
)
  depth += innerContext.getRegisterAsEm('jot');
```

The exclusion contradicts the register's own definition two files over, which
reads "the vertical space between the lines for all math expressions which allow
multiple lines (see array, multline)". The patch drops the three environment
tests and keeps `r < nr - 1`, so every multi-row environment gets `\jot`, which
is 3pt. To retune the spacing, change the `jot` register rather than this
condition.

This has to happen in the layout metrics rather than in our own CSS: the space
has to be part of the array's height and depth, or `\left...\right` would keep
sizing its delimiters to the old, shorter body and we would be back to the
mismatch that edit 1 fixes.

### Coverage

The same edits are applied to all five shipped bundles, because the entry
point varies by condition: `mathlive.mjs` in development, `mathlive.min.mjs` in
production browser builds, `mathlive-ssr.min.mjs` under the `node` condition,
and the two CommonJS bundles for `require`. Patching only the entry point in use
today would leave the defect waiting behind a resolution change.

To re-derive after a MathLive upgrade:

```sh
pnpm patch mathlive@<version> --edit-dir tmp/patch-mathlive
# in every bundle: delete both `environmentName === "array" && !this.isMultiline`
# layout branches, and reduce the `\jot` condition to `r < nr - 1`
pnpm patch-commit tmp/patch-mathlive
```

Check upstream first, and drop whichever half MathLive has since fixed itself
rather than carrying it forward.
