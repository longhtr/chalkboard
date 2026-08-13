/** Lazily initializes MathJax only for SVG export fallback; interactive rendering remains MathLive-owned. */
import { MathJaxTexFont } from '@mathjax/mathjax-tex-font/js/svg.js';
import { liteAdaptor } from '@mathjax/src/js/adaptors/liteAdaptor.js';
import { RegisterHTMLHandler } from '@mathjax/src/js/handlers/html.js';
import { TeX } from '@mathjax/src/js/input/tex.js';
import '@mathjax/src/js/input/tex/ams/AmsConfiguration.js';
import '@mathjax/src/js/input/tex/boldsymbol/BoldsymbolConfiguration.js';
import '@mathjax/src/js/input/tex/cancel/CancelConfiguration.js';
import '@mathjax/src/js/input/tex/color/ColorConfiguration.js';
import '@mathjax/src/js/input/tex/configmacros/ConfigMacrosConfiguration.js';
import '@mathjax/src/js/input/tex/mathtools/MathtoolsConfiguration.js';
import '@mathjax/src/js/input/tex/newcommand/NewcommandConfiguration.js';
import '@mathjax/src/js/input/tex/textmacros/TextMacrosConfiguration.js';
import { mathjax } from '@mathjax/src/js/mathjax.js';
import { SVG } from '@mathjax/src/js/output/svg.js';

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);

const document = mathjax.document('', {
  InputJax: new TeX({
    macros: {
      capitalDifferentialD: String.raw`\mathrm{D}`,
      differentialD: String.raw`\mathrm{d}`,
      exponentialE: String.raw`\mathrm{e}`,
      imaginaryI: String.raw`\mathrm{i}`,
      imaginaryJ: String.raw`\mathrm{j}`,
      placeholder: [String.raw`\square`, 1],
    },
    packages: [
      'base',
      'ams',
      'boldsymbol',
      'cancel',
      'color',
      'configmacros',
      'mathtools',
      'newcommand',
      'textmacros',
    ],
  }),
  OutputJax: new SVG({
    fontData: MathJaxTexFont,
    fontCache: 'none',
    linebreaks: { inline: false },
  }),
});

/** Converts one LaTeX fragment to static MathJax HTML using the shared document. */
export function convertLatexToHtml(source: string): string {
  return adaptor.outerHTML(document.convert(source, { display: false }));
}
