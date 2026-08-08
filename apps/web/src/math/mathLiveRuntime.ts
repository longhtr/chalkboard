/**
 * One-time MathLive configuration and workspace-font selection. Runtime setup
 * installs macros and font URLs before fields mount; font changes wait for the
 * complete face set before notifying renderers to remeasure.
 */
import '../vendor/excalifont/mathlive-static-no-fonts.css';

import { bestEffortLocalStorage } from '../bestEffortStorage';
import { installMathLiveAdapter } from './excalifontAdapter';
import {
  workspaceFontCss,
  WORKSPACE_FONT_FACES,
  type WorkspaceFontChoice,
} from './workspaceFontAssets';

const WORKSPACE_FONT_CHOICE_KEY = 'chalkboard:font';
/** Window event emitted after a new workspace font is loaded and applied. */
export const WORKSPACE_FONT_READY_EVENT = 'chalkboard:font-ready';

const LEGACY_FONT_CHOICE_KEY = 'chalkboard:math-font';
const LEGACY_FONT_STYLE_ID = 'chalkboard-math-font-faces';
const FONT_STYLE_ID = 'chalkboard-font-faces';
const ADAPTER_STYLE_ID = 'excalifont-mathlive-adapter';

function loadStoredChoice(): WorkspaceFontChoice {
  const stored =
    bestEffortLocalStorage.getItem(WORKSPACE_FONT_CHOICE_KEY) ??
    bestEffortLocalStorage.getItem(LEGACY_FONT_CHOICE_KEY);
  const choice = stored === 'classic' ? 'classic' : 'excalifont';
  bestEffortLocalStorage.setItem(WORKSPACE_FONT_CHOICE_KEY, choice);
  bestEffortLocalStorage.removeItem(LEGACY_FONT_CHOICE_KEY);
  return choice;
}

let currentChoice = loadStoredChoice();
let fontLoadRevision = 0;
document.getElementById(LEGACY_FONT_STYLE_ID)?.remove();
const existingFontStyle = document.getElementById(FONT_STYLE_ID);
const fontStyle =
  existingFontStyle instanceof HTMLStyleElement
    ? existingFontStyle
    : document.createElement('style');
fontStyle.id = FONT_STYLE_ID;
fontStyle.dataset.workspaceFont = currentChoice;
fontStyle.textContent = workspaceFontCss(currentChoice);
if (!fontStyle.isConnected) document.head.append(fontStyle);

const mathLiveAdapterInstallation = installMathLiveAdapter();

function removeAdapterStyles(): void {
  document.querySelectorAll('math-field').forEach((field) => {
    field.shadowRoot?.getElementById(ADAPTER_STYLE_ID)?.remove();
  });
}

function configureAdapter(choice: WorkspaceFontChoice): void {
  if (choice === 'excalifont') {
    installMathLiveAdapter();
  } else {
    mathLiveAdapterInstallation.disconnect();
    removeAdapterStyles();
  }
}

async function awaitSelectedFonts(revision: number): Promise<void> {
  if (document.fonts === undefined) return;
  await Promise.all(
    WORKSPACE_FONT_FACES.map((face) => document.fonts.load(face)),
  );
  await document.fonts.ready;
  if (revision !== fontLoadRevision) return;
  window.dispatchEvent(
    new CustomEvent(WORKSPACE_FONT_READY_EVENT, {
      detail: { choice: currentChoice },
    }),
  );
}

configureAdapter(currentChoice);
let currentFontsReady = awaitSelectedFonts(fontLoadRevision);

/** Returns the currently applied workspace equation font. */
export function getWorkspaceFontChoice(): WorkspaceFontChoice {
  return currentChoice;
}

/** Resolves after the active adapter and browser font faces are ready. */
export function waitForWorkspaceFonts(): Promise<void> {
  return currentFontsReady;
}

/** Loads, applies, persists, and announces a workspace font choice. */
export async function setWorkspaceFontChoice(
  choice: WorkspaceFontChoice,
): Promise<void> {
  if (choice === currentChoice) return currentFontsReady;
  currentChoice = choice;
  bestEffortLocalStorage.setItem(WORKSPACE_FONT_CHOICE_KEY, choice);
  fontStyle.dataset.workspaceFont = choice;
  fontStyle.textContent = workspaceFontCss(choice);
  configureAdapter(choice);
  fontLoadRevision += 1;
  currentFontsReady = awaitSelectedFonts(fontLoadRevision);
  await currentFontsReady;
}
