/** Locks both font-family descriptors, complete face counts, URL resolution, caching, and failed-load recovery. */
import { describe, expect, it } from 'vitest';

import { EXCALIFONT_OPERATOR_LAYOUT_CSS } from './excalifontLayout';
import { workspaceFontCss } from './workspaceFontAssets';

describe('workspace font assets', () => {
  it('applies operator-limit optical alignment only to Excalifont', () => {
    const excalifont = workspaceFontCss('excalifont', new Map());
    const classic = workspaceFontCss('classic', new Map());

    expect(excalifont).toContain(EXCALIFONT_OPERATOR_LAYOUT_CSS);
    expect(excalifont).toContain('top: -0.8em');
    expect(classic).not.toContain('top: -0.8em');
    expect(classic).not.toContain('[style*="font-size"]');
  });
});
