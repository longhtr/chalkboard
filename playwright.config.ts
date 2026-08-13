/**
 * Local browser-test matrix and web-server startup. Chromium covers the complete
 * suite; Firefox runs the focused native editing/selection compatibility matrix.
 */
import { defineConfig, devices } from '@playwright/test';

// Keep the second-engine math matrix focused on caret, command, and multiline
// behavior that depends on native selection and editing implementations.
const firefoxMathStories = [
  'edits rendered mathematics directly and restores it locally',
  'edits the clicked line of a multiline mixed block',
  'completes a LaTeX structure at its original mid-equation caret',
  'fills unary accent commands with the next typed character',
  'keeps argument-taking commands when their first value is typed',
  'keeps command transactions anchored at the start, middle, and end',
  'undoes and redoes a command that replaces a math selection',
  'keeps math mode active after deleting every math character',
  'keeps a new draft active when its field temporarily misses pointer input',
  'places the caret at the clicked horizontal position on any row',
  'places the caret at the nearest character or symbol boundary',
  'preserves line breaks when pasting into a mixed text block',
  'preserves published rows when selection follows silent focus normalization',
  'selects and copies text across multiline rows with the mouse',
  'round-trips multiline text through the native clipboard',
  'shows in-progress LaTeX commands without overlapping existing math',
  'survives randomized multiline LaTeX editing',
  'switches input mode from the mixed text tool',
  'types backslashes literally in text mode',
  'types dollar signs literally without changing input mode',
  'undoes and redoes active multiline math edits without collapsing lines',
  'uses MathLive as the only visible renderer during active editing',
].join('|');

export default defineConfig({
  expect: {
    // Hosted browser runners occasionally pause rendering or IndexedDB work
    // beyond the interactive local budget. Keep exact assertions and no
    // retries, but allow the slower environment to finish the same transition.
    timeout: process.env.CI ? 10_000 : 5_000,
  },
  forbidOnly: Boolean(process.env.CI),
  fullyParallel: true,
  outputDir: 'test-results/playwright/local',
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      testMatch: [
        '**/equation-source-view.spec.ts',
        '**/math-line-spacing.spec.ts',
        '**/media-corpus.spec.ts',
        '**/product-states.spec.ts',
        '**/spline.spec.ts',
        '**/storage-recovery.spec.ts',
        '**/trapezoid.spec.ts',
        '**/workspace*.spec.ts',
      ],
      use: { ...devices['Desktop Firefox'] },
    },
    {
      grep: new RegExp(firefoxMathStories),
      name: 'firefox-math-mode',
      testMatch: '**/equation*.spec.ts',
      use: { ...devices['Desktop Firefox'] },
    },
  ],
  reporter: process.env.CI ? 'github' : 'list',
  retries: 0,
  testDir: './tests',
  testIgnore: '**/*.cloud.spec.ts',
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'pnpm --filter @chalkboard/web dev --port 4173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    url: 'http://127.0.0.1:4173',
  },
});
