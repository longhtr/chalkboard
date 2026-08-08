/**
 * Deduplicates active-editor publications by canonical source and measured
 * dimensions so persistence and board history observe one stable snapshot.
 */
import { preservePublishedLineBreaks } from './mixedMath';

interface EditorPublicationState {
  height: number;
  source: string;
  width: number;
}

interface StableEditorSourceOptions {
  currentSource: string;
  renderedEntrySource: string | null;
  renderedViewEdited: boolean;
  sourceView: boolean;
}

/** Deduplicates source/measurement publication and preserves the last stable snapshot. */
export class EditorPublicationController {
  readonly #state: EditorPublicationState;

  constructor(initial: EditorPublicationState) {
    this.#state = { ...initial };
  }

  get source(): string {
    return this.#state.source;
  }

  synchronizeSource(source: string): void {
    this.#state.source = source;
  }

  accept(source: string, width: number, height: number): boolean {
    if (
      source === this.#state.source &&
      width === this.#state.width &&
      height === this.#state.height
    ) {
      return false;
    }
    this.#state.source = source;
    this.#state.width = width;
    this.#state.height = height;
    return true;
  }

  stableSource({
    currentSource,
    renderedEntrySource,
    renderedViewEdited,
    sourceView,
  }: StableEditorSourceOptions): string {
    if (sourceView) return this.#state.source;
    return !renderedViewEdited && currentSource === renderedEntrySource
      ? this.#state.source
      : preservePublishedLineBreaks(this.#state.source, currentSource);
  }
}
