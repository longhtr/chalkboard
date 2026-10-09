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

  /** Classifies a React element-source projection against the live editor. */
  classifySourceProjection(
    projectedSource: string,
    liveSource: string,
    external: boolean,
  ): 'apply' | 'ignore' | 'synchronize' {
    if (projectedSource === this.#state.source) return 'ignore';
    if (projectedSource === liveSource) return 'synchronize';
    // Local publication advances this controller before React renders. An
    // untagged mismatch is therefore an older local projection, whereas an
    // actor-tagged external mismatch is authoritative and must be merged.
    return external ? 'apply' : 'ignore';
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
