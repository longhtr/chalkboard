/**
 * Browser admission boundary for imported images. Bytes, signatures, decoded
 * dimensions/pixels, orientation, SVG resources, and final data URL are bounded
 * before an image element can be created.
 */
const MAX_IMPORTED_IMAGE_BYTES = 2_500_000;

const supportedImageTypes = new Set([
  'image/avif',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/svg+xml',
  'image/webp',
]);

function readFileAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('Could not read the image'));
    });
    reader.addEventListener('error', () =>
      reject(reader.error ?? new Error('Could not read the image')),
    );
    reader.readAsDataURL(file);
  });
}

/** Reads one selected image and strips unsafe SVG content before returning a data URL. */
export async function sanitizedImageFile(file: File): Promise<{
  name: string;
  source: string;
}> {
  const inferredSvg =
    file.type === 'image/svg+xml' || file.name.toLowerCase().endsWith('.svg');
  const type = inferredSvg ? 'image/svg+xml' : file.type.toLowerCase();
  if (!supportedImageTypes.has(type)) {
    throw new Error('Choose a PNG, JPEG, WebP, GIF, AVIF, or SVG image');
  }
  if (file.size > MAX_IMPORTED_IMAGE_BYTES) {
    throw new Error('Images must be smaller than 2.5 MB');
  }
  if (!inferredSvg) {
    return {
      name: file.name.slice(0, 200),
      source: await readFileAsDataUrl(file),
    };
  }

  const source = await file.text();
  if (/(?:<!DOCTYPE|<!ENTITY|<\?xml-stylesheet)/iu.test(source)) {
    throw new Error('The SVG file contains unsafe XML declarations');
  }
  const document = new DOMParser().parseFromString(source, 'image/svg+xml');
  if (
    document.documentElement.localName !== 'svg' ||
    document.querySelector('parsererror') !== null
  ) {
    throw new Error('The SVG file is invalid');
  }
  document
    .querySelectorAll('script, foreignObject')
    .forEach((node) => node.remove());
  document.querySelectorAll('*').forEach((node) => {
    for (const attribute of [...node.attributes]) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();
      if (
        name.startsWith('on') ||
        ((name === 'href' || name === 'xlink:href') &&
          value !== '' &&
          !value.startsWith('#')) ||
        ((name === 'style' || name === 'src') &&
          /(?:url\s*\(|javascript:)/i.test(value))
      ) {
        node.removeAttribute(attribute.name);
      }
    }
  });
  document.querySelectorAll('style').forEach((node) => {
    if (/(?:@import|url\s*\()/i.test(node.textContent ?? '')) node.remove();
  });
  const sanitized = new XMLSerializer().serializeToString(
    document.documentElement,
  );
  return {
    name: file.name.slice(0, 200),
    source: await readFileAsDataUrl(
      new Blob([sanitized], { type: 'image/svg+xml' }),
    ),
  };
}

/** Decodes a sanitized image and returns bounded natural dimensions for placement. */
export function importedImageDimensions(source: string): Promise<{
  height: number;
  width: number;
}> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener('load', () => {
      if (image.naturalWidth > 0 && image.naturalHeight > 0) {
        resolve({ height: image.naturalHeight, width: image.naturalWidth });
      } else reject(new Error('The image has no visible dimensions'));
    });
    image.addEventListener('error', () =>
      reject(new Error('The image could not be decoded')),
    );
    image.src = source;
  });
}
