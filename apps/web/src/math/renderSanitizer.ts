/**
 * Sanitizes generated static math markup before DOM insertion or SVG export.
 * Only a closed element/attribute/style/URL subset survives; source text is
 * separately normalized to remove unsupported commands and editor markers.
 */
import { isEscaped, matchingBrace } from './latexParsing';

const UNSAFE_PRESENTATION_COMMANDS = [
  'class',
  'cssId',
  'href',
  'htmlClass',
  'htmlData',
  'htmlId',
  'htmlStyle',
  'style',
] as const;

interface PresentationCommand {
  index: number;
  name: (typeof UNSAFE_PRESENTATION_COMMANDS)[number];
}

function nextPresentationCommand(
  source: string,
  from: number,
): PresentationCommand | null {
  let next: PresentationCommand | null = null;
  for (const name of UNSAFE_PRESENTATION_COMMANDS) {
    const needle = `\\${name}{`;
    let index = source.indexOf(needle, from);
    while (index >= 0 && isEscaped(source, index)) {
      index = source.indexOf(needle, index + needle.length);
    }
    if (index >= 0 && (next === null || index < next.index)) {
      next = { index, name };
    }
  }
  return next;
}

/**
 * Static board math is untrusted document content. MathLive's raw HTML,
 * identifier, class, style, and navigation commands can otherwise inject
 * arbitrary classes or inline CSS into the application and downloaded SVG.
 * Preserve each command's visible body while discarding its presentation
 * payload. Malformed in-progress input remains visible and non-throwing.
 */
export function sanitizeMathForStaticRender(source: string): string {
  let result = '';
  let cursor = 0;
  while (cursor < source.length) {
    const command = nextPresentationCommand(source, cursor);
    if (command === null) return result + source.slice(cursor);
    result += source.slice(cursor, command.index);
    const commandText = `\\${command.name}`;
    const firstOpen = command.index + commandText.length;
    const firstClose = matchingBrace(source, firstOpen);
    const bodyOpen = firstClose + 1;
    if (firstClose < 0 || source[bodyOpen] !== '{') {
      result += commandText;
      cursor = command.index + commandText.length;
      continue;
    }
    const bodyClose = matchingBrace(source, bodyOpen);
    if (bodyClose < 0) {
      result += source.slice(command.index);
      return result;
    }
    result += sanitizeMathForStaticRender(
      source.slice(bodyOpen + 1, bodyClose),
    );
    cursor = bodyClose + 1;
  }
  return result;
}
