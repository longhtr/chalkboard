/** Supplies valid and hostile image files to prove media detection, SVG safety, dimensions, and byte limits. */
import { describe, expect, it } from 'vitest';

import { requiredTestValue } from '../../test/assertions';
import { sanitizedImageFile } from './imageImport';

function decodeDataUrl(source: string): string {
  const encoded = source.slice(source.indexOf(',') + 1);
  return atob(encoded);
}

describe('sanitizedImageFile', () => {
  it('removes executable and externally loaded SVG content', async () => {
    const file = new File(
      [
        `<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)">
          <script>alert(1)</script>
          <foreignObject><div>unsafe</div></foreignObject>
          <style>@import "https://example.com/style.css";</style>
          <image href="https://example.com/image.png" />
          <image href="data:image/png;base64,iVBORw0KGgo=" />
          <rect style="fill: url(https://example.com/fill.svg)" width="10" height="10" />
        </svg>`,
      ],
      'unsafe.svg',
      { type: 'image/svg+xml' },
    );

    const imported = await sanitizedImageFile(file);
    const document = new DOMParser().parseFromString(
      decodeDataUrl(imported.source),
      'image/svg+xml',
    );

    expect(imported.name).toBe('unsafe.svg');
    expect(document.querySelector('script, foreignObject, style')).toBeNull();
    expect(document.documentElement.hasAttribute('onload')).toBe(false);
    expect(
      [...document.querySelectorAll('image')].every(
        (image) => !image.hasAttribute('href'),
      ),
    ).toBe(true);
    expect(
      requiredTestValue(
        document.querySelector('rect'),
        'sanitized rectangle',
      ).hasAttribute('style'),
    ).toBe(false);
  });

  it('rejects XML declarations before parsing SVG', async () => {
    await expect(
      sanitizedImageFile(
        new File(
          [
            '<!DOCTYPE svg [<!ENTITY payload "expanded">]><svg xmlns="http://www.w3.org/2000/svg"><text>&payload;</text></svg>',
          ],
          'entity.svg',
          { type: 'image/svg+xml' },
        ),
      ),
    ).rejects.toThrow('unsafe XML declarations');
  });

  it('accepts supported raster images without rewriting their bytes', async () => {
    const file = new File(['image bytes'], 'example.png', {
      type: 'image/png',
    });

    const imported = await sanitizedImageFile(file);

    expect(imported.name).toBe('example.png');
    expect(imported.source).toMatch(/^data:image\/png;base64,/);
    expect(decodeDataUrl(imported.source)).toBe('image bytes');
  });

  it('rejects unsupported and oversized files', async () => {
    await expect(
      sanitizedImageFile(
        new File(['plain text'], 'notes.txt', { type: 'text/plain' }),
      ),
    ).rejects.toThrow('Choose a PNG');

    await expect(
      sanitizedImageFile(
        new File([new Uint8Array(2_500_001)], 'large.png', {
          type: 'image/png',
        }),
      ),
    ).rejects.toThrow('smaller than 2.5 MB');
  });
});
