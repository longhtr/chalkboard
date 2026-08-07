/**
 * Reconciles canonical equation source with structured mixed content at archive
 * and persistence boundaries. Structured content wins when both are valid.
 */
import {
  isEquationElement,
  isMixedContentDocument,
  type BoardElement,
  type MixedContentDocument,
} from '@chalkboard/shared';

import {
  mixedDocumentFromSource,
  sourceFromMixedDocument,
} from '../../math/mixedDocument';

interface StructuredBoardContent {
  elements: BoardElement[];
  mixedContentByElementId: Record<string, MixedContentDocument>;
  sourceChanged: boolean;
}

/** Makes the structured mixed document authoritative over compatibility source. */
export function reconcileStructuredBoardContent(
  elements: readonly BoardElement[],
  documents?: Record<string, MixedContentDocument>,
): StructuredBoardContent {
  const mixedContentByElementId: Record<string, MixedContentDocument> = {};
  let sourceChanged = false;
  const reconciledElements = elements.map((element) => {
    if (!isEquationElement(element)) return element;
    const candidate = documents?.[element.id];
    const document = isMixedContentDocument(candidate)
      ? candidate
      : mixedDocumentFromSource(element.source, element.strokeColor);
    mixedContentByElementId[element.id] = document;
    const source = sourceFromMixedDocument(document, element.strokeColor);
    if (source === element.source) return element;
    sourceChanged = true;
    return { ...element, source };
  });
  return {
    elements: reconciledElements,
    mixedContentByElementId,
    sourceChanged,
  };
}

/** Reconstructs equation source from required structured rows or rejects missing data. */
export function reconcileRequiredStructuredBoardContent(
  elements: readonly BoardElement[],
  documents: Record<string, unknown>,
): StructuredBoardContent {
  const equationIds = new Set(
    elements.filter(isEquationElement).map(({ id }) => id),
  );
  const entries = Object.entries(documents);
  if (entries.length !== equationIds.size) {
    throw new Error('Board mixedContent references are inconsistent');
  }
  const validatedDocuments: Record<string, MixedContentDocument> = {};
  for (const [id, document] of entries) {
    if (!equationIds.has(id) || !isMixedContentDocument(document)) {
      throw new Error('Board mixedContent references are inconsistent');
    }
    validatedDocuments[id] = document;
  }
  return reconcileStructuredBoardContent(elements, validatedDocuments);
}

/** Derives structured mixed-content documents for every equation element. */
export function structuredContentForElements(
  elements: readonly BoardElement[],
): Record<string, MixedContentDocument> {
  return reconcileStructuredBoardContent(elements).mixedContentByElementId;
}
