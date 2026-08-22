/**
 * Converts inactive canonical source through MathLive, sanitizes the result, and
 * maintains a bounded cache keyed by source/font. Conversion failure returns a
 * safe readable fallback rather than unsafe or empty markup.
 */
import { convertLatexToMarkup } from 'mathlive';

import { decorateExcalifontStaticMarkup } from './excalifontLayout';
import { mathArrayStretch } from './mathLineSpacing';
import { expandTextColors, toMathLiveEditorSource } from './mixedMath';
import { sanitizeMathForStaticRender } from './renderSanitizer';

interface CachedMarkup {
  markup: string;
  weight: number;
}

interface StaticMathRenderOptions {
  baseColor: string;
  isMathOnly: boolean;
  lineSpacing?: number | undefined;
}

const STATIC_RENDERER_VERSION = 3;
const MAX_CACHE_ENTRIES = 512;
const MAX_CACHE_CODE_UNITS = 8_000_000;
const MAX_ENTRY_CODE_UNITS = 1_000_000;
const markupByRenderKey = new Map<string, CachedMarkup>();
let cacheCodeUnits = 0;

function renderKey(source: string, options: Required<StaticMathRenderOptions>) {
  return JSON.stringify([
    STATIC_RENDERER_VERSION,
    source,
    options.baseColor,
    options.isMathOnly,
    options.lineSpacing,
  ]);
}

function rememberMarkup(key: string, markup: string): void {
  const weight = key.length + markup.length;
  if (weight > MAX_ENTRY_CODE_UNITS) return;
  markupByRenderKey.set(key, { markup, weight });
  cacheCodeUnits += weight;
  while (
    markupByRenderKey.size > MAX_CACHE_ENTRIES ||
    cacheCodeUnits > MAX_CACHE_CODE_UNITS
  ) {
    const oldestKey = markupByRenderKey.keys().next().value;
    if (oldestKey === undefined) break;
    const oldest = markupByRenderKey.get(oldestKey);
    markupByRenderKey.delete(oldestKey);
    cacheCodeUnits -= oldest?.weight ?? 0;
  }
}

/**
 * Converts one complete inactive block and reuses successful safe markup across
 * detail transitions and viewport remounts. Failed conversions are never cached
 * so callers can retain their element-specific last valid render.
 */
export function staticMathMarkup(
  source: string,
  options: StaticMathRenderOptions,
): string {
  const { baseColor, isMathOnly, lineSpacing = 1.2 } = options;
  const key = renderKey(source, { baseColor, isMathOnly, lineSpacing });
  const cached = markupByRenderKey.get(key);
  if (cached !== undefined) {
    markupByRenderKey.delete(key);
    markupByRenderKey.set(key, cached);
    return cached.markup;
  }

  const expandedSource = sanitizeMathForStaticRender(
    expandTextColors(source, baseColor),
  );
  const registers = { arraystretch: mathArrayStretch(lineSpacing) };
  // The editor keeps one stable text root even for formula-only blocks so a
  // newline can always become a top-level sibling. Static and exported output
  // must use the same document shape; a direct math root has different struts
  // for radicals and other tall structures, producing a visible mode switch.
  const markup = decorateExcalifontStaticMarkup(
    convertLatexToMarkup(toMathLiveEditorSource(expandedSource), {
      defaultMode: 'text',
      registers,
    }),
  );
  rememberMarkup(key, markup);
  return markup;
}
