/**
 * Tracks the active LaTeX command around a MathLive caret and repairs incomplete
 * placeholder arguments without owning keyboard dispatch or publication.
 */
import type { MathfieldElement } from 'mathlive';

import { addCommandCompletionPlaceholders } from './commandCompletion';
import { EditorCommandTransaction } from './editorCommandTransaction';
import { mathDelimiterBody } from './mixedMath';

/** Tracks one MathLive LaTeX command transaction and repairs empty arguments. */
export class EditorCommandController {
  readonly #field: MathfieldElement;
  readonly #transaction = new EditorCommandTransaction();
  unselectableCompletion: string | null = null;

  constructor(field: MathfieldElement) {
    this.#field = field;
  }

  beginTransaction(fieldOffset: number): void {
    this.#transaction.begin(fieldOffset);
  }

  clearTransaction(): void {
    this.#transaction.clear();
  }

  restoreTransactionStartPosition(): number | null {
    const anchor = this.#transaction.consumeAnchor(this.#field.lastOffset);
    if (anchor !== null) this.#field.position = anchor;
    return anchor;
  }

  macroCommandCompletion(command: string): string | null {
    const definition = this.#field.macros[command.slice(1)];
    if (
      typeof definition !== 'object' ||
      definition === null ||
      !('args' in definition) ||
      !('def' in definition) ||
      typeof definition.args !== 'number' ||
      definition.args < 1 ||
      typeof definition.def !== 'string'
    ) {
      return null;
    }
    let expanded = definition.def;
    for (let argument = 1; argument <= definition.args; argument += 1) {
      expanded = expanded.replaceAll(`#${argument}`, '\\placeholder{}');
    }
    return expanded;
  }

  activeLatexCommand(): string | null {
    const end = this.#field.position;
    let command: string | null = null;
    for (let start = end; start >= Math.max(0, end - 64); start -= 1) {
      const candidate = this.#field.getValue([start, end]).trim();
      if (
        /^\\(?:[A-Za-z]+\*?|[!"',.:;=>^`~])$/.test(candidate) &&
        (command === null || candidate.length > command.length)
      ) {
        command = candidate;
      }
    }
    return command;
  }

  repairEmptyArguments(): boolean {
    if (this.#field.mode !== 'math') return false;
    let completion = addCommandCompletionPlaceholders(
      this.#field.getValue(this.#field.selection),
    );
    if (completion === null) {
      const center = this.#field.position;
      const firstOffset = Math.max(0, center - 8);
      const lastOffset = Math.min(this.#field.lastOffset, center + 8);
      let bestRange: [number, number] | null = null;
      let bestLength = Number.POSITIVE_INFINITY;
      for (let start = firstOffset; start <= center; start += 1) {
        for (let end = center + 1; end <= lastOffset; end += 1) {
          const candidate = addCommandCompletionPlaceholders(
            this.#field.getValue([start, end]),
          );
          if (candidate === null || end - start >= bestLength) continue;
          completion = candidate;
          bestRange = [start, end];
          bestLength = end - start;
        }
      }
      if (bestRange !== null) {
        this.#field.selection = { direction: 'none', ranges: [bestRange] };
      }
    }
    if (completion === null || this.#field.selectionIsCollapsed) return false;
    if (this.#transaction.active) {
      this.#field.insert('', {
        insertionMode: 'replaceSelection',
        mode: 'math',
        silenceNotifications: true,
      });
      const anchor = this.restoreTransactionStartPosition();
      if (anchor === 0) {
        this.#field.executeCommand(['switchMode', 'text']);
        this.#field.position = 0;
      }
    }
    this.#transaction.clear();
    this.#field.insert(completion, {
      focus: true,
      format: 'latex',
      insertionMode: 'replaceSelection',
      mode: 'math',
      selectionMode: 'placeholder',
      silenceNotifications: true,
    });
    if (this.#selectNestedPlaceholder(completion)) {
      this.unselectableCompletion = null;
      return true;
    }
    this.unselectableCompletion = completion;
    return false;
  }

  #selectNestedPlaceholder(completion: string): boolean {
    const rawSelection = this.#field.getValue(this.#field.selection).trim();
    const selected = mathDelimiterBody(rawSelection)?.trim() ?? rawSelection;
    if (selected.includes('\\placeholder{}') && selected !== completion) {
      return true;
    }

    const center = this.#field.position;
    const firstOffset = Math.max(0, center - 8);
    const lastOffset = Math.min(this.#field.lastOffset, center + 8);
    let bestRange: [number, number] | null = null;
    let bestLength = Number.POSITIVE_INFINITY;
    for (let start = firstOffset; start < lastOffset; start += 1) {
      for (let end = start + 1; end <= lastOffset; end += 1) {
        const rawValue = this.#field.getValue([start, end]).trim();
        const value = mathDelimiterBody(rawValue)?.trim() ?? rawValue;
        if (
          !value.includes('\\placeholder{}') ||
          value === completion ||
          end - start >= bestLength
        ) {
          continue;
        }
        bestRange = [start, end];
        bestLength = end - start;
      }
    }
    if (bestRange === null) return false;
    this.#field.selection = { direction: 'none', ranges: [bestRange] };
    return true;
  }
}
