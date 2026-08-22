/**
 * Loads one complete, verified workspace font family. CSS URLs are parsed into
 * explicit face descriptors, all faces load before activation, and concurrent
 * callers share the same in-flight promise.
 */
import excalifontCss from '../vendor/excalifont/mathlive-fonts.css?raw';
import classicMathLiveCss from '../vendor/mathlive-classic/mathlive-static.css?raw';

import { EXCALIFONT_OPERATOR_LAYOUT_CSS } from './excalifontLayout';

/** Supported equation font families with complete local asset bundles. */
export type WorkspaceFontChoice = 'classic' | 'excalifont';

/** Exact font-family names that must load before equation measurement/export. */
export const WORKSPACE_FONT_FACES = [
  '16px KaTeX_AMS',
  '16px KaTeX_Caligraphic',
  'bold 16px KaTeX_Caligraphic',
  '16px KaTeX_Fraktur',
  'bold 16px KaTeX_Fraktur',
  '16px KaTeX_Main',
  'bold 16px KaTeX_Main',
  'italic 16px KaTeX_Main',
  'bold italic 16px KaTeX_Main',
  'italic 16px KaTeX_Math',
  'bold italic 16px KaTeX_Math',
  '16px KaTeX_SansSerif',
  'bold 16px KaTeX_SansSerif',
  'italic 16px KaTeX_SansSerif',
  '16px KaTeX_Script',
  '16px KaTeX_Size1',
  '16px KaTeX_Size2',
  '16px KaTeX_Size3',
  '16px KaTeX_Size4',
  '16px KaTeX_Typewriter',
] as const;

const excalifontUrls = import.meta.glob<string>(
  '../vendor/excalifont/fonts/*.woff2',
  { eager: true, import: 'default', query: '?url' },
);

const classicUrls = import.meta.glob<string>(
  '../vendor/mathlive-classic/fonts/*.woff2',
  { eager: true, import: 'default', query: '?url' },
);

function urlsByFilename(urls: Record<string, string>): Map<string, string> {
  return new Map(
    Object.entries(urls).map(([path, url]) => {
      const filename = path.split('/').at(-1) ?? path;
      return [filename, url];
    }),
  );
}

const excalifontUrlsByFilename = urlsByFilename(excalifontUrls);
const classicUrlsByFilename = urlsByFilename(classicUrls);
const EXCALIFONT_ASSET_VERSION = '0.1';

const classicFontCss =
  classicMathLiveCss.match(/@font-face\{[^}]*\}/g)?.join('') ?? '';

function resolveFontUrls(
  css: string,
  urls: ReadonlyMap<string, string>,
  options: { assetVersion?: string } = {},
): string {
  return css.replace(/fonts\/([^)'"\s]+)/g, (_match, name: string) => {
    const filename = name.split('?', 1)[0] ?? name;
    const url = urls.get(filename);
    if (url === undefined) return `fonts/${name}`;
    if (options.assetVersion === undefined || url.startsWith('data:')) {
      return url;
    }
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}v=${options.assetVersion}`;
  });
}

/** Returns static MathLive CSS with versioned, absolute local font URLs. */
export function workspaceFontCss(
  choice: WorkspaceFontChoice,
  urls = workspaceFontUrls(choice),
): string {
  return choice === 'excalifont'
    ? `${resolveFontUrls(excalifontCss, urls, {
        assetVersion: EXCALIFONT_ASSET_VERSION,
      })}\n${EXCALIFONT_OPERATOR_LAYOUT_CSS}`
    : resolveFontUrls(classicFontCss, urls);
}

/** Returns every local font URL referenced by the selected workspace CSS. */
export function workspaceFontUrls(
  choice: WorkspaceFontChoice,
): ReadonlyMap<string, string> {
  return choice === 'excalifont'
    ? excalifontUrlsByFilename
    : classicUrlsByFilename;
}
