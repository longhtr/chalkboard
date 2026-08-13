/**
 * Browser download orchestration for image, vector, and editable board exports.
 * It owns filenames, object-URL cleanup, progress, cancellation, and archive assets.
 */
import type { BoardElement, ColorTheme } from '@chalkboard/shared';

import { themedElements } from '../interaction/themedElements';

import type { WorkspaceFontChoice } from '../../math/workspaceFontAssets';
import { waitForWorkspaceFonts } from '../../math/mathLiveRuntime';
import type { BoardExportOptions } from './boardExport';
import {
  equationMarkupForExport,
  equationVectorMarkupForExport,
} from './equationSvgExport';
import type { LocalBoardRecord } from '../local/localBoardRecords';

interface EditableBoardExportInput {
  elements: BoardElement[];
  mixedContentByElementId?: LocalBoardRecord['mixedContentByElementId'];
  title: string;
}

interface EditableExportOptions {
  boardTitle: string;
  cloudConnectionState: string;
  cloudElements: BoardElement[];
  cloud: boolean;
  fontChoice: WorkspaceFontChoice;
  localBoardId: string;
  readLocalBoard(id: string): Promise<LocalBoardRecord | null>;
}

interface ImageExportOptions {
  boardTitle: string;
  elements: BoardElement[];
  fontChoice: WorkspaceFontChoice;
  options: BoardExportOptions;
  selectedIds: readonly string[];
  /** Theme the export should reproduce; defaults to light. */
  theme?: ColorTheme;
}

function downloadBoardExport(result: { blob: Blob; filename: string }): void {
  const url = URL.createObjectURL(result.blob);
  const anchor = document.createElement('a');
  anchor.download = result.filename;
  anchor.href = url;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Resolves the authoritative local/cloud board and every image into archive input. */
export async function resolveEditableBoardExportInput({
  boardTitle,
  cloud,
  cloudConnectionState,
  cloudElements,
  localBoardId,
  readLocalBoard,
}: Omit<
  EditableExportOptions,
  'fontChoice'
>): Promise<EditableBoardExportInput> {
  if (!cloud) {
    const local = await readLocalBoard(localBoardId);
    if (local === null) throw new Error('The local board could not be read.');
    return local;
  }
  if (
    cloudConnectionState !== 'saved' &&
    cloudConnectionState !== 'read-only'
  ) {
    throw new Error('Wait until cloud changes are saved before exporting.');
  }
  return {
    elements: cloudElements,
    title: boardTitle,
  };
}

/** Creates and downloads a validated editable board archive. */
export async function exportEditableWorkspaceBoard(
  options: EditableExportOptions,
): Promise<string> {
  const input = await resolveEditableBoardExportInput(options);
  const { createBoardArchive } = await import('./boardArchive');
  const result = await createBoardArchive({
    elements: input.elements,
    font: options.fontChoice,
    ...(input.mixedContentByElementId === undefined
      ? {}
      : { mixedContentByElementId: input.mixedContentByElementId }),
    title: input.title,
  });
  downloadBoardExport({
    blob: new Blob([new Uint8Array(result.bytes)], {
      type: 'application/vnd.chalkboard.board+zip',
    }),
    filename: result.filename,
  });
  return result.filename;
}

async function waitForPresentedWorkspaceFonts(): Promise<void> {
  await waitForWorkspaceFonts();
  await new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => resolve());
    });
  });
  if (document.fonts !== undefined) await document.fonts.ready;
}

/** Waits for presented fonts, then delegates visible PNG/SVG export. */
export async function exportWorkspaceImage({
  boardTitle,
  elements,
  fontChoice,
  options,
  selectedIds,
  theme = 'light',
}: ImageExportOptions): Promise<void> {
  await waitForPresentedWorkspaceFonts();
  // Equation markup embeds its own colors, so the theme has to be projected
  // before markup is generated — otherwise text would export light while the
  // shapes around it exported dark.
  const themed = [...themedElements(elements, theme)];
  const equationMarkup = equationMarkupForExport(themed);
  const equationVectorMarkup =
    options.format === 'png'
      ? equationVectorMarkupForExport(themed, equationMarkup)
      : undefined;
  const { exportBoard } = await import('./boardExport');
  downloadBoardExport(
    await exportBoard({
      elements: themed,
      equationMarkup,
      ...(equationVectorMarkup === undefined ? {} : { equationVectorMarkup }),
      fontChoice,
      options,
      selectedIds: new Set(selectedIds),
      theme,
      title: boardTitle,
    }),
  );
}
